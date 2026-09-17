import { assert, test, run } from "./__testutil";
import { getPresetTheme, THEME_FAMILIES } from "../themes";
import { nameColorByHue } from "./tagColors";
import {
  hexEquals,
  nearestSlot,
  oklchChroma,
  parsePalette,
  planRecolor,
  resolveSlot,
  snapToPalette,
  type ColorSlotMap,
} from "./tagColorSlots";

const frostFamily = THEME_FAMILIES.find((family) => family.id === "a1");
const monoFamily = THEME_FAMILIES.find((family) => family.id === "mono");
assert.ok(frostFamily, "应能找到霜靛家族");
assert.ok(monoFamily, "应能找到素墨家族");

const frostCsv = getPresetTheme(frostFamily!.light)?.variables["tag-preset-colors"] ?? "";
const monoCsv = getPresetTheme(monoFamily!.light)?.variables["tag-preset-colors"] ?? "";
const frost = parsePalette(frostCsv);
const mono = parsePalette(monoCsv);

test("snapToPalette 只落在 8 位主题色上", () => {
  const snapped = snapToPalette("#111111", frost);
  assert.ok(frost.some((hex) => hexEquals(hex, snapped)), `应吸附到霜靛板，实际 ${snapped}`);
});

test("parsePalette 不足循环补齐、多余截断", () => {
  assert.deepEqual(parsePalette("#111111,#222222").length, 8);
  assert.equal(parsePalette("#111111,#222222")[2], "#111111");
  assert.equal(parsePalette("#1,#2,#3,#4,#5,#6,#7,#8,#9")[7], "#8");
});

test("霜靛板 → 素墨板 → 霜靛板 每个色位回到原 hex", () => {
  const tags = frost.map((color, index) => ({ id: index + 1, color }));
  const empty: ColorSlotMap = { tags: {}, cabinets: {} };

  const toMono = planRecolor({
    tags,
    cabinets: [],
    slotMap: empty,
    previousPalette: frost,
    nextPalette: mono,
  });
  const monoTags = tags.map((tag) => {
    const update = toMono.updates.tags.find((item) => item.id === tag.id);
    return { id: tag.id, color: update?.color ?? tag.color };
  });

  const back = planRecolor({
    tags: monoTags,
    cabinets: [],
    slotMap: toMono.nextSlotMap,
    previousPalette: mono,
    nextPalette: frost,
  });
  for (let i = 0; i < frost.length; i++) {
    const final = back.updates.tags.find((item) => item.id === i + 1)?.color ?? monoTags[i]?.color;
    assert.ok(hexEquals(final ?? "", frost[i] ?? ""), `色位 ${i} 应回到 ${frost[i]}，实际 ${final}`);
  }
});

test("素墨板上不残留饱和色（写回后 chroma < 0.04）", () => {
  const tags = frost.map((color, index) => ({ id: index + 1, color }));
  const planned = planRecolor({
    tags,
    cabinets: [],
    slotMap: { tags: {}, cabinets: {} },
    previousPalette: frost,
    nextPalette: mono,
  });
  const written = tags.map((tag) => {
    const update = planned.updates.tags.find((item) => item.id === tag.id);
    return update?.color ?? tag.color;
  });
  for (const color of written) {
    assert.ok(oklchChroma(color) < 0.04, `${color} 在素墨板应是中性色`);
  }
  for (const color of Object.values(planned.nextSlotMap.tags).map((record) => record.hex)) {
    assert.ok(oklchChroma(color) < 0.04, `记忆 hex ${color} 也应是中性色`);
  }
});

test("自定义 hex（Tailwind #3b82f6）在霜靛板落到蓝色位", () => {
  const slot = nearestSlot(frost, "#3b82f6");
  assert.equal(nameColorByHue(frost[slot] ?? ""), "晴蓝");
});

test("用户手改色后记录失效，重新按旧板最近", () => {
  const stale = { slot: 5, hex: frost[0] ?? "#5064d8" };
  const handEdited = "#ff0000";
  const resolved = resolveSlot(stale, handEdited, frost, mono);
  assert.equal(resolved, nearestSlot(frost, handEdited));
  assert.equal(resolveSlot(stale, stale.hex, frost, mono), 5, "hex 仍匹配时应保住原色位");
});

test("中性色在彩色板上不会抛错", () => {
  for (const hex of ["#111111", "#fafafa", "#6b7280", "#000000", "#ffffff"]) {
    const slot = nearestSlot(frost, hex);
    assert.ok(slot >= 0 && slot < 8, `${hex} 应落到合法色位`);
  }
});

test("planRecolor 空输入保留旧色位记录", () => {
  const slotMap: ColorSlotMap = {
    tags: { "7": { slot: 3, hex: "#22c55e" } },
    cabinets: { "2": { slot: 1, hex: "#111111" } },
    lastOfficialThemeId: "kept",
  };
  const planned = planRecolor({
    tags: [],
    cabinets: [],
    slotMap,
    previousPalette: frost,
    nextPalette: mono,
  });
  assert.deepEqual(planned.updates, { tags: [], cabinets: [] });
  assert.deepEqual(planned.nextSlotMap.tags, slotMap.tags);
  assert.deepEqual(planned.nextSlotMap.cabinets, slotMap.cabinets);
  assert.equal(planned.nextSlotMap.lastOfficialThemeId, "kept");
});

test("planRecolor 只覆写出现过的 id", () => {
  const slotMap: ColorSlotMap = {
    tags: {
      "1": { slot: 0, hex: frost[0] ?? "#000000" },
      "9": { slot: 2, hex: frost[2] ?? "#111111" },
    },
    cabinets: {},
  };
  const planned = planRecolor({
    tags: [{ id: 1, color: frost[0] ?? "#000000" }],
    cabinets: [],
    slotMap,
    previousPalette: frost,
    nextPalette: mono,
  });
  assert.equal(planned.nextSlotMap.tags["9"]?.slot, 2);
  assert.equal(planned.nextSlotMap.tags["9"]?.hex, frost[2]);
  assert.equal(planned.nextSlotMap.tags["1"]?.hex, mono[0]);
});

await run("tagColorSlots");
