// ============================================================================
// lib/toast.test.ts — toast 文案不带内部命令名前缀（小 UX：「[backup_data]」）
// ============================================================================
import { assert, test, run } from "./__testutil";
import { stripCommandPrefix } from "./toast";

test("去掉 invokeCmd 命令名前缀，保留正文", () => {
  assert.equal(stripCommandPrefix("[backup_data] 磁盘已满"), "磁盘已满");
  assert.equal(stripCommandPrefix("保存失败：[save_ai_config] 网络错误"), "保存失败：网络错误");
  assert.equal(stripCommandPrefix("[plugin:dialog|save] 取消"), "取消");
});

test("普通方括号文案不受影响", () => {
  assert.equal(stripCommandPrefix("[注意] 已存在"), "[注意] 已存在");
  assert.equal(stripCommandPrefix("标签 [Game] 已存在"), "标签 [Game] 已存在");
  assert.equal(stripCommandPrefix("标签 [work] 已存在"), "标签 [work] 已存在");
  assert.equal(stripCommandPrefix("已备份到：C:\\x\\[a]"), "已备份到：C:\\x\\[a]");
});

await run("toast");
