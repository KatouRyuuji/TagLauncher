import { assert, test, run } from "./__testutil";
import { ItemStore, MAX_CACHED, PAGE_SIZE, orderByView } from "./itemView";
import type { ItemWithTags } from "../types";

const make = (id: number, name = `o${id}`): ItemWithTags =>
  ({ id, name, path: `D:/${name}`, type: "text", created_at: "2026-01-01", is_favorite: false, tags: [] }) as ItemWithTags;

function backend(n: number) {
  const db = new Map(Array.from({ length: n }, (_, i) => [i + 1, make(i + 1)] as const));
  const calls: number[][] = [];
  const fetch = async (ids: number[]) => {
    calls.push(ids);
    return ids.flatMap((id) => db.get(id) ?? []);
  };
  return { db, calls, fetch };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test("按页对齐补取可视区间，已缓存的页不重取", async () => {
  const b = backend(500);
  const store = new ItemStore(b.fetch);
  store.setIds(Array.from({ length: 500 }, (_, i) => i + 1));
  store.ensureRange(10, 30);
  await tick();
  assert.deepEqual(b.calls.map((c) => [c[0], c.length]), [[1, PAGE_SIZE]]);
  store.ensureRange(0, 50);
  store.ensureRange(40, 60);
  await tick();
  assert.deepEqual(b.calls.map((c) => [c[0], c.length]), [[1, 50], [51, 50]]);
  assert.equal(store.getSnapshot().at(59)?.name, "o60");
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
