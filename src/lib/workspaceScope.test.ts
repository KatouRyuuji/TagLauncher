import { assert, test, run } from "./__testutil";
import type { TagRelation } from "../types";
import { resolveWorkspaceScope, type WorkspaceScopeInput } from "./workspaceScope";

function rel(parentId: number, childId: number): TagRelation {
  return { parentId, childId };
}

function base(overrides: Partial<WorkspaceScopeInput> = {}): WorkspaceScopeInput {
  return {
    showFavorites: false,
    showRecent: false,
    selectedCabinetId: null,
    cabinets: [{ id: 1, name: "工作必备" }],
    selectedTagIds: [],
    excludedTagIds: [],
    tags: [
      { id: 10, name: "娱乐" },
      { id: 11, name: "电影" },
      { id: 20, name: "开发" },
      { id: 21, name: "自动化" },
      { id: 30, name: "游戏" },
    ],
    tagRelations: [rel(10, 11), rel(10, 30)],
    typeFilter: "all",
    searchQuery: "",
    visibleCount: 11,
    ...overrides,
  };
}

test("全部项目：无筛选", () => {
  const scope = resolveWorkspaceScope(base());
  assert.equal(scope.title, "全部项目");
  assert.deepEqual(scope.qualifiers, []);
  assert.equal(scope.count, 11);
});

test("收藏夹", () => {
  const scope = resolveWorkspaceScope(base({ showFavorites: true, visibleCount: 4 }));
  assert.equal(scope.title, "收藏夹");
  assert.deepEqual(scope.qualifiers, []);
  assert.equal(scope.count, 4);
});

test("文件柜用柜名", () => {
  const scope = resolveWorkspaceScope(base({ selectedCabinetId: 1, visibleCount: 3 }));
  assert.equal(scope.title, "工作必备");
  assert.deepEqual(scope.qualifiers, []);
  assert.equal(scope.count, 3);
});

test("单标签含下级", () => {
  const scope = resolveWorkspaceScope(base({ selectedTagIds: [10], visibleCount: 4 }));
  assert.equal(scope.title, "娱乐");
  assert.deepEqual(scope.qualifiers, ["含下级"]);
  assert.equal(scope.count, 4);
});

test("双标签且", () => {
  const scope = resolveWorkspaceScope(base({ selectedTagIds: [20, 21], visibleCount: 2 }));
  assert.equal(scope.title, "开发 且 自动化");
  assert.deepEqual(scope.qualifiers, []);
  assert.equal(scope.count, 2);
});

test("排除：正选加且非", () => {
  const scope = resolveWorkspaceScope(base({
    selectedTagIds: [10],
    excludedTagIds: [30],
    visibleCount: 3,
  }));
  assert.equal(scope.title, "娱乐 且非 游戏");
  assert.deepEqual(scope.qualifiers, ["含下级"]);
  assert.equal(scope.count, 3);
});

test("类型+搜索组合", () => {
  const scope = resolveWorkspaceScope(base({
    typeFilter: "image",
    searchQuery: "晴天",
    visibleCount: 1,
  }));
  assert.equal(scope.title, "全部项目");
  assert.deepEqual(scope.qualifiers, ["图片", "“晴天”"]);
  assert.equal(scope.count, 1);
});

await run("workspaceScope");
