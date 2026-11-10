// ============================================================================
// lib/latestOnly.design.test.ts — 最新请求调度：在途期间只保留最后一次调用
// ============================================================================
import { assert, test, run } from "./__testutil";
import { latestOnly, SKIPPED } from "./latestOnly";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("在途期间的中间调用被跳过，只发出最后一次", async () => {
  const calls: string[] = [];
  const pending = new Map<string, ReturnType<typeof deferred<string>>>();
  const runQ = latestOnly((q: string) => {
    calls.push(q);
    const d = deferred<string>();
    pending.set(q, d);
    return d.promise;
  });
  const a = runQ("a");
  const b = runQ("ab");
  const c = runQ("abc");
  assert.deepEqual(calls, ["a"]);
  pending.get("a")!.resolve("A");
  assert.equal(await a, "A");
  assert.equal(await b, SKIPPED);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls, ["a", "abc"]);
  pending.get("abc")!.resolve("ABC");
  assert.equal(await c, "ABC");
});

test("失败不卡住队列：保留的调用照常发出", async () => {
  const calls: string[] = [];
  const pending = new Map<string, ReturnType<typeof deferred<string>>>();
  const runQ = latestOnly((q: string) => {
    calls.push(q);
    const d = deferred<string>();
    pending.set(q, d);
    return d.promise;
  });
  const a = runQ("a");
  const b = runQ("b");
  pending.get("a")!.reject(new Error("boom"));
  await a.then(
    () => assert.fail("应当失败"),
    (e: Error) => assert.equal(e.message, "boom"),
  );
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls, ["a", "b"]);
  pending.get("b")!.resolve("B");
  assert.equal(await b, "B");
});

test("空闲时直接发出", async () => {
  const runQ = latestOnly(async (q: number) => q * 2);
  assert.equal(await runQ(1), 2);
  assert.equal(await runQ(2), 4);
});

await run("latestOnly");
