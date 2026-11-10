import { assert, test, run } from "./__testutil";
import { ItemStore, MAX_CACHED, PAGE_SIZE, WARM_BATCH, orderByView } from "./itemView";
import type { ItemWithTags } from "../types";

const make = (id: number, name = `o${id}`): ItemWithTags =>
  ({ id, name, path: `D:/${name}`, type: "text", created_at: "2026-01-01", is_favorite: false, tags: [] }) as ItemWithTags;

function backend(n: number) {
  const db = new Map(Array.from({ length: n }, (_, i) => [i + 1, make(i + 1)] as const));
  const calls: number[][] = [];
  const kinds: string[] = [];
  const fetch = async (ids: number[], kind: string = "visible") => {
    calls.push(ids);
    kinds.push(kind);
    return ids.flatMap((id) => db.get(id) ?? []);
  };
  return { db, calls, kinds, fetch };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test("按页对齐补取可视区间，已缓存的页不重取；可视页先取，前后相邻页随后单独预取", async () => {
  const b = backend(500);
  const store = new ItemStore(b.fetch);
  store.setIds(Array.from({ length: 500 }, (_, i) => i + 1));
  store.ensureRange(10, 30);
  await tick();
  assert.deepEqual(b.calls.map((c) => [c[0], c.length]), [[1, PAGE_SIZE], [51, PAGE_SIZE]]);
  store.ensureRange(0, 50);
  store.ensureRange(40, 60);
  await tick();
  assert.deepEqual(b.calls.map((c) => [c[0], c.length]), [[1, 50], [51, 50], [101, 50]]);
  assert.equal(store.getSnapshot().at(59)?.name, "o60");
  store.ensureRange(260, 270);
  await tick();
  assert.deepEqual(b.calls.slice(3).map((c) => [c[0], c.length]), [[251, 50], [201, 100]], "跳转：可视页在前，上一页与下一页合并在后");
});

test("取页到达只通知数据订阅者、不换视图快照；ID/写入变化换快照", async () => {
  const b = backend(100);
  const store = new ItemStore(b.fetch);
  store.setIds(Array.from({ length: 100 }, (_, i) => i + 1));
  const snap = store.getSnapshot();
  let full = 0;
  let data = 0;
  store.subscribe(() => full++);
  snap.subscribeData(() => data++);
  const v0 = snap.dataVersion();
  snap.ensureRange(0, 10);
  await tick();
  assert.equal(store.getSnapshot(), snap, "快照不变（工作台不因每页重渲染）");
  assert.equal(full, 0);
  assert.ok(data >= 1 && snap.dataVersion() > v0);
  assert.equal(snap.get(1)?.name, "o1");
  store.upsert([make(1, "改名")]);
  assert.notEqual(store.getSnapshot(), snap);
  assert.equal(full, 1);
});

test("相邻页预取等可视页返回后才发；预取到达不在可视区间时不通知列表", async () => {
  const db = new Map(Array.from({ length: 500 }, (_, i) => [i + 1, make(i + 1)] as const));
  const calls: number[][] = [];
  const pending: (() => void)[] = [];
  const store = new ItemStore((ids) => {
    calls.push(ids);
    return new Promise((resolve) => pending.push(() => resolve(ids.flatMap((id) => db.get(id) ?? []))));
  });
  store.setIds(Array.from({ length: 500 }, (_, i) => i + 1));
  const snap = store.getSnapshot();
  let data = 0;
  snap.subscribeData(() => data++);
  store.ensureRange(260, 270);
  await tick();
  assert.deepEqual(calls.map((c) => [c[0], c.length]), [[251, 50]], "可视页未返回前不发预取");
  pending.shift()!();
  await tick();
  assert.equal(data, 1, "可视页到达通知一次");
  assert.deepEqual(calls.map((c) => [c[0], c.length]), [[251, 50], [201, 100]]);
  pending.shift()!();
  await tick();
  assert.equal(data, 1, "预取页在可视区间外：不重渲染");
  assert.equal(snap.get(201)?.name, "o201", "但已进缓存");
  // 预取在途时滚到预取页：到达时在可视区间内，照常通知
  store.ensureRange(400, 410);
  await tick();
  pending.shift()!();
  await tick();
  assert.equal(data, 2);
  store.ensureRange(350, 360);
  await tick();
  assert.deepEqual(calls.at(-1)!.slice(0, 1), [351], "上一页预取在途");
  store.ensureRange(350, 360);
  pending.shift()!();
  await tick();
  assert.equal(data, 3, "在途预取页已进入可视区间：到达即通知");
});

test("小视图空闲补齐：分批只取没取过的，可视页在途时让路；补齐到达不通知；超过上限的视图不补齐", async () => {
  const n = WARM_BATCH * 2 + 10;
  const b = backend(n);
  const queue: (() => void)[] = [];
  const store = new ItemStore(b.fetch, { warm: true, maxCached: n, idle: (fn) => queue.push(fn) });
  let data = 0;
  store.getSnapshot().subscribeData(() => data++);
  store.setIds(Array.from({ length: n }, (_, i) => i + 1));
  store.ensureRange(0, 10);
  assert.equal(queue.length, 1);
  queue.shift()!(); // 可视页在途：本轮让路，重新排队
  assert.deepEqual(b.calls.map((c) => c.length), [PAGE_SIZE]);
  await tick();
  data = 0;
  while (queue.length) {
    queue.shift()!();
    await tick();
  }
  const sizes = b.calls.slice(2).map((c) => c.length);
  assert.deepEqual(sizes, [WARM_BATCH, n - 2 * PAGE_SIZE - WARM_BATCH], "跳过已取过的可视页与预取页");
  assert.deepEqual(b.kinds, ["visible", "ahead", "warm", "warm"], "补齐按 warm 取（后端只放行卡片直接显示的路径）");
  assert.equal(data, 0, "补齐的对象不在可视区间：不重渲染");
  assert.equal(store.stats().cached, n);
  // 全量刷新后只是过期：补齐不重取
  store.invalidateAll();
  store.setIds(store.getSnapshot().ids);
  while (queue.length) queue.shift()!();
  await tick();
  assert.equal(b.calls.length, 4);

  const big = backend(30);
  const q2: (() => void)[] = [];
  const s2 = new ItemStore(big.fetch, { warm: true, maxCached: 20, idle: (fn) => q2.push(fn) });
  s2.setIds(Array.from({ length: 30 }, (_, i) => i + 1));
  assert.equal(q2.length, 0, "视图大于上限：不补齐");
});

test("缓存有上限：超过 MAX_CACHED 时淘汰最久未用的页", async () => {
  const n = MAX_CACHED + 500;
  const b = backend(n);
  const store = new ItemStore(b.fetch);
  store.setIds(Array.from({ length: n }, (_, i) => i + 1));
  for (let start = 0; start < n; start += PAGE_SIZE) {
    store.ensureRange(start, start + PAGE_SIZE);
    await tick();
  }
  const view = store.getSnapshot();
  assert.equal(view.get(1), undefined, "最早的页已淘汰");
  assert.equal(view.get(n)?.id, n);
  let cached = 0;
  for (let id = 1; id <= n; id++) if (view.get(id)) cached++;
  assert.equal(cached, MAX_CACHED);
});

test("全量刷新只把缓存标为过期：旧数据先照常显示，用到时重取", async () => {
  const b = backend(60);
  const store = new ItemStore(b.fetch);
  store.setIds(Array.from({ length: 60 }, (_, i) => i + 1));
  store.ensureRange(0, 50);
  await tick();
  b.db.set(1, make(1, "renamed"));
  store.invalidateAll();
  assert.equal(store.getSnapshot().get(1)?.name, "o1", "过期数据仍可显示，不闪空");
  store.ensureRange(0, 50);
  await tick();
  assert.equal(store.getSnapshot().get(1)?.name, "renamed");
});

test("取回时已删除的对象去掉缓存；写入就地更新", async () => {
  const b = backend(3);
  const store = new ItemStore(b.fetch);
  store.setIds([1, 2, 3]);
  store.ensureRange(0, 3);
  await tick();
  b.db.delete(2);
  store.invalidateAll();
  store.ensureRange(0, 3);
  await tick();
  assert.equal(store.getSnapshot().get(2), undefined);
  store.upsert([make(3, "patched")]);
  assert.equal(store.getSnapshot().get(3)?.name, "patched");
});

test("大批量 load（全选后批量操作）按请求顺序返回全部对象，且不挤掉可视页", async () => {
  const n = MAX_CACHED + 1000;
  const b = backend(n);
  const store = new ItemStore(b.fetch);
  const ids = Array.from({ length: n }, (_, i) => i + 1);
  store.setIds(ids);
  store.ensureRange(0, 50);
  await tick();
  const all = await store.load([...ids].reverse());
  assert.equal(all.length, n);
  assert.equal(all[0].id, n);
  assert.equal(store.getSnapshot().get(1)?.id, 1, "可视页仍在缓存");
});

test("orderByView 按视图顺序排列并去掉不在视图里的 ID", () => {
  const b = backend(5);
  const store = new ItemStore(b.fetch);
  store.setIds([5, 3, 1]);
  assert.deepEqual(orderByView(store.getSnapshot(), [1, 9, 5]), [5, 1]);
});

await run("itemView");
