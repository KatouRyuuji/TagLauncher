import { assert, test, run } from "./__testutil";
import { SETTINGS_SECTIONS, settingsSectionDomId } from "./settingsSections";

test("SETTINGS_SECTIONS：id 全局唯一（重复 id 会让锚点跳转指向错误区块）", () => {
  const ids = SETTINGS_SECTIONS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("SETTINGS_SECTIONS：id 与 label 均非空，id 仅含小写字母（DOM id 安全）", () => {
  for (const section of SETTINGS_SECTIONS) {
    assert.ok(section.id.length > 0, "id 不得为空");
    assert.ok(section.label.trim().length > 0, `区块 ${section.id} 的 label 不得为空`);
    assert.ok(/^[a-z][a-z-]*$/.test(section.id), `id "${section.id}" 应仅含小写字母/连字符`);
  }
});

test("SETTINGS_SECTIONS：覆盖全部六大设置区块", () => {
  const ids = new Set(SETTINGS_SECTIONS.map((s) => s.id));
  for (const required of ["theme", "ai", "data", "sync", "update", "mods"]) {
    assert.ok(ids.has(required), `缺少区块 ${required}`);
  }
});

test("settingsSectionDomId：稳定前缀，锚点 id 可预测", () => {
  assert.equal(settingsSectionDomId("theme"), "settings-section-theme");
  assert.equal(settingsSectionDomId("mods"), "settings-section-mods");
});

await run("settingsSections");
