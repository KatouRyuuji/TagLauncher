import { assert, test, run } from "./__testutil";
import { hasPotentialExternalFileDrag, fileUriToPath, extractDroppedPaths } from "./dropPaths";

// DataTransfer 在 node 下不存在真实 DOM 实现，这里按其结构手工构造最小可用 mock。
// esbuild 只做语法转译不做类型检查，且本文件已被 tsconfig 排除，无需担心类型报错。
interface MockOptions {
  types?: string[];
  files?: Array<{ path?: string }>;
  items?: unknown[];
  data?: Record<string, string>;
}

function mockDataTransfer(opts: MockOptions = {}): DataTransfer {
  const data = opts.data ?? {};
  const mock = {
    types: opts.types ?? [],
    files: opts.files ?? [],
    items: opts.items ?? [],
    getData: (format: string) => data[format] ?? "",
  };
  return mock as unknown as DataTransfer;
}

// ── hasPotentialExternalFileDrag ────────────────────────────────────────

test("hasPotentialExternalFileDrag：types 含 Files 判定为外部拖拽", () => {
  assert.equal(hasPotentialExternalFileDrag(mockDataTransfer({ types: ["Files"] })), true);
});

test("hasPotentialExternalFileDrag：types 含 text/uri-list 判定为外部拖拽", () => {
  assert.equal(hasPotentialExternalFileDrag(mockDataTransfer({ types: ["text/uri-list"] })), true);
});

test("hasPotentialExternalFileDrag：files 非空即判定为外部拖拽（即使 types 未标注）", () => {
  assert.equal(hasPotentialExternalFileDrag(mockDataTransfer({ files: [{ path: "a" }] })), true);
});

test("hasPotentialExternalFileDrag：items 非空即判定为外部拖拽", () => {
  assert.equal(hasPotentialExternalFileDrag(mockDataTransfer({ items: [{}] })), true);
});

test("hasPotentialExternalFileDrag：types 为空数组时兜底允许（WebView2 拖入阶段不稳定暴露类型）", () => {
  assert.equal(hasPotentialExternalFileDrag(mockDataTransfer({ types: [] })), true);
});

test("hasPotentialExternalFileDrag：仅有无关 types 且 files/items 皆空时判定为非外部拖拽", () => {
  assert.equal(hasPotentialExternalFileDrag(mockDataTransfer({ types: ["text/html"] })), false);
});

// ── fileUriToPath ────────────────────────────────────────────────────────

test("fileUriToPath：带盘符的 file URI 转为反斜杠 Windows 路径", () => {
  assert.equal(fileUriToPath("file:///D:/foo/bar.txt"), "D:\\foo\\bar.txt");
});

test("fileUriToPath：带 host 的 UNC file URI 转为 \\\\server\\share 形式", () => {
  assert.equal(fileUriToPath("file://server/share/foo.txt"), "\\\\server\\share\\foo.txt");
});

test("fileUriToPath：百分号编码字符被正确解码", () => {
  assert.equal(fileUriToPath("file:///D:/foo%20bar/baz.txt"), "D:\\foo bar\\baz.txt");
});

test("fileUriToPath：非 file 协议返回 null", () => {
  assert.equal(fileUriToPath("http://example.com"), null);
});

test("fileUriToPath：无法解析为 URL 的字符串返回 null，不抛异常", () => {
  assert.equal(fileUriToPath("not a url::: at all"), null);
});

test("fileUriToPath：空白字符串返回 null", () => {
  assert.equal(fileUriToPath("   "), null);
});

// ── extractDroppedPaths ────────────────────────────────────────────────

test("extractDroppedPaths：files 数组中带 path 的项被收集，空白 path 被忽略", () => {
  const dt = mockDataTransfer({ files: [{ path: "D:\\a.txt" }, { path: "   " }, {}] });
  assert.deepEqual(extractDroppedPaths(dt), ["D:\\a.txt"]);
});

test("extractDroppedPaths：text/uri-list 跳过空行与注释行，解析出文件 URI", () => {
  const dt = mockDataTransfer({
    data: { "text/uri-list": "# comment\n\nfile:///D:/b.txt\nhttp://example.com" },
  });
  assert.deepEqual(extractDroppedPaths(dt), ["D:\\b.txt"]);
});

test("extractDroppedPaths：text/plain 仅解析以 file:// 开头的行，其余文本忽略", () => {
  const dt = mockDataTransfer({ data: { "text/plain": "just some text\nfile:///D:/c.txt" } });
  assert.deepEqual(extractDroppedPaths(dt), ["D:\\c.txt"]);
});

test("extractDroppedPaths：多来源解析出同一路径时去重", () => {
  const dt = mockDataTransfer({
    files: [{ path: "D:\\dup.txt" }],
    data: { "text/uri-list": "file:///D:/dup.txt" },
  });
  assert.deepEqual(extractDroppedPaths(dt), ["D:\\dup.txt"]);
});

test("extractDroppedPaths：三个来源皆为空时返回空数组", () => {
  assert.deepEqual(extractDroppedPaths(mockDataTransfer()), []);
});

await run("dropPaths");
