// ============================================================================
// lib/__testutil.ts — 零依赖测试辅助（纯 node，无第三方依赖）
// ============================================================================
// 配合项目现有测试模式使用：esbuild --bundle --platform=node 打包后由 node 直接执行。
// 与 search.design.test.ts 的"顶层 assert 脚本"风格并存，供新增测试文件使用：
// test() 归组用例，单个用例失败会被捕获记录、不阻断同文件内其余用例继续执行，
// 便于一次运行看到该文件的所有失败点，而不是只看到第一个。
//
// 用法：
//   import { assert, test, run } from "./__testutil";
//   test("描述", () => { assert.equal(1, 1); });
//   await run("模块名"); // 文件末尾调用一次（run 为 async，需 await 以等待异步用例）
// ============================================================================

import assert from "node:assert/strict";

export { assert };

interface Failure {
  name: string;
  error: unknown;
}

let total = 0;
const failures: Failure[] = [];
const pending: Promise<void>[] = [];

/**
 * 注册并立即执行一个用例。同步用例立即跑完；若 fn 返回 Promise，
 * 会被加入待收敛队列，由 run() 统一 await，失败同样被捕获记录。
 * 无论同步异步，单个用例失败都不会阻断同文件内其余用例继续执行。
 */
export function test(name: string, fn: () => void | Promise<void>): void {
  total += 1;
  try {
    const result = fn();
    if (result instanceof Promise) {
      pending.push(result.catch((error) => { failures.push({ name, error }); }));
    }
  } catch (error) {
    failures.push({ name, error });
  }
}

/**
 * 文件末尾调用一次（需 await）：等待所有异步用例收敛后打印结果，
 * 有失败时以非零码退出进程。输出含 [TESTRESULT] 前缀的机器可读行，
 * 供 scripts/run-tests.mjs 解析汇总。
 */
export async function run(moduleName: string): Promise<void> {
  await Promise.all(pending);

  const passed = total - failures.length;

  for (const { name, error } of failures) {
    console.error(`[FAIL] ${moduleName} > ${name}`);
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  }

  console.log(`[TESTRESULT] ${moduleName} passed=${passed} total=${total}`);

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}
