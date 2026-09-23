import { assert, test, run } from "./__testutil";
import { FALLBACK_TAG_PRESET_COLORS, nameColorByHue } from "./tagColors";

// nameColorByHue：色名由色值推导（色板随主题变化，固定色名会错位）。
// 低饱和度按明度命名，其余按色相段命名；非法输入兜底「自定义」。

test("回退色板 10 色各自得到语义相符的色名", () => {
  const expected = ["蔷薇", "蜜橙", "琥珀", "翠绿", "青碧", "晴蓝", "藤紫", "莓红", "铅灰", "赭棕"];
  const actual = FALLBACK_TAG_PRESET_COLORS.map(nameColorByHue);
  assert.deepEqual(actual, expected);
});

test("默认主题色板（index.css --tag-preset-colors）色名与色值语义一致", () => {
  const themePalette = ["#365e9d", "#7050a0", "#a34469", "#59616b", "#826a23", "#3e754f", "#a05e31", "#247b71", "#a14e48", "#755940"];
  assert.deepEqual(themePalette.map(nameColorByHue), ["晴蓝", "藤紫", "莓红", "铅灰", "琥珀", "翠绿", "蜜橙", "青碧", "蔷薇", "赭棕"]);
});

test("支持 3 位与 8 位 hex（8 位忽略 alpha）", () => {
  assert.equal(nameColorByHue("#f00"), "蔷薇");
  assert.equal(nameColorByHue("#3b82f6ff"), "晴蓝");
  assert.equal(nameColorByHue("#22c55e00"), "翠绿");
});

test("非法输入兜底「自定义」", () => {
  for (const bad of ["", "red", "#gg0000", "#1234", "ef4444", "rgb(239,68,68)", " #ef4444 额外"]) {
    assert.equal(nameColorByHue(bad), "自定义", `输入 ${JSON.stringify(bad)}`);
  }
});

test("低饱和度色按明度命名为墨黑/铅灰/米白", () => {
  assert.equal(nameColorByHue("#111111"), "墨黑");
  assert.equal(nameColorByHue("#000000"), "墨黑");
  assert.equal(nameColorByHue("#6b7280"), "铅灰");
  assert.equal(nameColorByHue("#fafafa"), "米白");
  assert.equal(nameColorByHue("#ffffff"), "米白");
});

test("输入容忍首尾空白", () => {
  assert.equal(nameColorByHue("  #ef4444 "), "蔷薇");
});

await run("tagColors");
