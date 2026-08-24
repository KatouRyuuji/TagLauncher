// ============================================================================
// lib/contract.test.ts — 前后端 IPC 命令契约核对（静态文本比对，非运行时）
// ============================================================================
// 目的：防止"前端新增/改名了 invoke 命令，却忘了在后端 generate_handler! 注册"
// 或反过来"后端注册了命令，前端 db.ts 却没有任何调用"这类拼写漂移，在编译期/
// 测试期就发现，而不是等到运行时才收到 Tauri 的 "command not found"。
//
// 做法：分别用正则从 src/lib/db.ts 与 src-tauri/src/lib.rs 源码文本中提取命令名
// 集合，断言两者完全一致（双向 diff 均为空）。纯文本静态分析，不依赖编译/运行。
//
// 注意：本文件假设以仓库根目录为 cwd 执行（与 npm scripts / scripts/run-tests.mjs
// 的既有约定一致），若单独手动运行需先 cd 到仓库根目录。
//
// 特例说明：db.ts 的 searchItems（search_items）当前无 UI 调用方，属有意保留的
// 后端 FTS5 路径（功能清单已声明的边界），本契约测试的双向一致规则因此成立、
// 该封装不得当作死代码删除。
// ============================================================================

import { assert, test, run } from "./__testutil";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DB_TS_PATH = resolve(process.cwd(), "src/lib/db.ts");
const LIB_RS_PATH = resolve(process.cwd(), "src-tauri/src/lib.rs");

/** 提取 db.ts 中所有 `invokeCmd("xxx", ...)` 调用的命令名字面量（保留出现顺序，可能含重复）。 */
function extractFrontendCommands(source: string): string[] {
  const names: string[] = [];
  const re = /invokeCmd\(\s*"([a-zA-Z0-9_]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    names.push(match[1]);
  }
  return names;
}

/** 取出 `tauri::generate_handler![ ... ]` 方括号内的原始文本。 */
function extractGenerateHandlerBody(source: string): string {
  const startMarker = "tauri::generate_handler![";
  const startIdx = source.indexOf(startMarker);
  if (startIdx === -1) {
    throw new Error(
      "未在 lib.rs 中找到 `tauri::generate_handler![` 起始标记，契约测试的提取逻辑需要随 lib.rs 结构调整更新",
    );
  }
  const bodyStart = startIdx + startMarker.length;
  const endIdx = source.indexOf("]", bodyStart);
  if (endIdx === -1) {
    throw new Error("未找到 `generate_handler!` 的闭合 `]`，契约测试的提取逻辑需要调整");
  }
  return source.slice(bodyStart, endIdx);
}

/** 解析 generate_handler! 方括号内的命令名列表：逐行剥离 `//` 注释后按逗号切分（保留出现顺序与重复）。 */
function extractBackendCommandList(source: string): string[] {
  const body = extractGenerateHandlerBody(source);
  const names: string[] = [];
  for (const rawLine of body.split("\n")) {
    const withoutComment = rawLine.split("//")[0];
    for (const part of withoutComment.split(",")) {
      const name = part.trim();
      if (name) names.push(name);
    }
  }
  return names;
}

const dbSource = readFileSync(DB_TS_PATH, "utf-8");
const libRsSource = readFileSync(LIB_RS_PATH, "utf-8");

const frontendList = extractFrontendCommands(dbSource);
const backendList = extractBackendCommandList(libRsSource);
const frontendSet = new Set(frontendList);
const backendSet = new Set(backendList);

test("提取逻辑健全性：两侧都提取到了数量合理的命令（避免正则失效后误报「全部一致」）", () => {
  assert.ok(
    frontendList.length >= 40,
    `db.ts 仅提取到 ${frontendList.length} 个 invokeCmd 调用，远低于预期，提取正则可能已失效`,
  );
  assert.ok(
    backendList.length >= 40,
    `lib.rs 仅提取到 ${backendList.length} 个注册命令，远低于预期，提取正则可能已失效`,
  );
});

test("命令名格式健全性：提取结果均为合法 snake_case 标识符", () => {
  const badFrontend = frontendList.filter((n) => !/^[a-z][a-z0-9_]*$/.test(n));
  const badBackend = backendList.filter((n) => !/^[a-z][a-z0-9_]*$/.test(n));
  assert.deepEqual(badFrontend, [], `db.ts 提取到形如非法标识符的命令名：${badFrontend.join(", ")}`);
  assert.deepEqual(badBackend, [], `lib.rs 提取到形如非法标识符的命令名：${badBackend.join(", ")}`);
});

test("双向一致：前端调用的命令都已在后端注册（否则运行时会报 command not found）", () => {
  const missingInBackend = [...frontendSet].filter((c) => !backendSet.has(c)).sort();
  assert.deepEqual(
    missingInBackend,
    [],
    `前端 db.ts 调用了但后端 generate_handler! 未注册的命令：${missingInBackend.join(", ")}`,
  );
});

test("双向一致：后端注册的命令都被前端调用（否则可能是拼写漂移或死代码）", () => {
  const missingInFrontend = [...backendSet].filter((c) => !frontendSet.has(c)).sort();
  assert.deepEqual(
    missingInFrontend,
    [],
    `后端 generate_handler! 注册了但前端 db.ts 未调用的命令：${missingInFrontend.join(", ")}`,
  );
});

test("后端命令列表内部无重复注册（重复通常意味着复制粘贴遗漏改名）", () => {
  const counts = new Map<string, number>();
  for (const name of backendList) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const duplicates = [...counts.entries()].filter(([, n]) => n > 1).map(([name]) => name);
  assert.deepEqual(duplicates, [], `generate_handler! 中重复注册的命令：${duplicates.join(", ")}`);
});

await run("contract");
