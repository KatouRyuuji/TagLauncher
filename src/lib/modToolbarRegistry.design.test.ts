import { assert, test, run } from "./__testutil";
import {
  registerToolbarButton,
  unregisterToolbarButton,
  unregisterAllToolbarButtons,
  getToolbarButtons,
  subscribeToolbarButtons,
} from "./modToolbarRegistry";

function noop() {}

test("registerToolbarButton：注册后可通过 getToolbarButtons 取回，字段一致", () => {
  registerToolbarButton("modA", "btn1", { text: "按钮A", icon: "<svg/>", onClick: noop });
  const found = getToolbarButtons().find((b) => b.modId === "modA" && b.id === "btn1");
  assert.ok(found);
  assert.equal(found!.text, "按钮A");
  assert.equal(found!.icon, "<svg/>");
  unregisterAllToolbarButtons("modA");
});

test("registerToolbarButton：相同 modId+buttonId 二次注册覆盖而非追加", () => {
  registerToolbarButton("modB", "btn1", { text: "v1", onClick: noop });
  registerToolbarButton("modB", "btn1", { text: "v2", onClick: noop });
  const matches = getToolbarButtons().filter((b) => b.modId === "modB" && b.id === "btn1");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].text, "v2");
  unregisterAllToolbarButtons("modB");
});

test("不同 modId 下相同 buttonId 相互独立（key 按 modId::buttonId 命名空间）", () => {
  registerToolbarButton("modC1", "shared", { text: "C1", onClick: noop });
  registerToolbarButton("modC2", "shared", { text: "C2", onClick: noop });
  assert.equal(getToolbarButtons().filter((b) => b.id === "shared").length, 2);
  unregisterAllToolbarButtons("modC1");
  unregisterAllToolbarButtons("modC2");
});

test("unregisterToolbarButton：按 modId+buttonId 精确移除", () => {
  registerToolbarButton("modD", "btn1", { text: "d", onClick: noop });
  unregisterToolbarButton("modD", "btn1");
  assert.equal(getToolbarButtons().some((b) => b.modId === "modD"), false);
});

test("unregisterAllToolbarButtons：仅移除该 mod 名下的按钮，不影响其它 mod", () => {
  registerToolbarButton("modE", "btn1", { text: "e1", onClick: noop });
  registerToolbarButton("modE", "btn2", { text: "e2", onClick: noop });
  registerToolbarButton("modF", "btn1", { text: "f1", onClick: noop });
  unregisterAllToolbarButtons("modE");
  assert.equal(getToolbarButtons().some((b) => b.modId === "modE"), false);
  assert.equal(getToolbarButtons().some((b) => b.modId === "modF"), true);
  unregisterAllToolbarButtons("modF");
});

test("subscribeToolbarButtons：注册/注销触发订阅回调，取消订阅后不再触发", () => {
  let calls = 0;
  const unsubscribe = subscribeToolbarButtons(() => { calls += 1; });

  registerToolbarButton("modG", "btn1", { text: "g", onClick: noop });
  assert.equal(calls, 1);

  unregisterToolbarButton("modG", "btn1");
  assert.equal(calls, 2);

  unsubscribe();
  registerToolbarButton("modG", "btn1", { text: "g", onClick: noop });
  assert.equal(calls, 2); // 取消订阅后不再增加
  unregisterAllToolbarButtons("modG");
});

test("unregisterToolbarButton：对不存在的按钮调用是无操作，不触发订阅通知", () => {
  let calls = 0;
  const unsubscribe = subscribeToolbarButtons(() => { calls += 1; });
  unregisterToolbarButton("modH-nonexistent", "nope");
  assert.equal(calls, 0);
  unsubscribe();
});

test("subscribeToolbarButtons：某个监听器抛异常不影响其它监听器执行、也不影响调用方", () => {
  let secondCalled = false;
  const unsub1 = subscribeToolbarButtons(() => { throw new Error("boom"); });
  const unsub2 = subscribeToolbarButtons(() => { secondCalled = true; });

  assert.doesNotThrow(() => {
    registerToolbarButton("modI", "btn1", { text: "i", onClick: noop });
  });
  assert.equal(secondCalled, true);

  unsub1();
  unsub2();
  unregisterAllToolbarButtons("modI");
});

await run("modToolbarRegistry");
