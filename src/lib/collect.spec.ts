import { describe, expect, it } from "vitest";
import {
  collectableCabinets,
  collectContext,
  describeChoice,
  pathName,
  planCollect,
  readFolderMode,
  toPreference,
  usablePreference,
  type CollectChoice,
} from "./collect";
import type { Cabinet, Tag } from "../types";

const tag = (id: number, name: string) => ({ id, name, color: "#000" }) as unknown as Tag;
const cabinet = (id: number, name: string, folder_path: string | null = null) =>
  ({ id, name, color: "#000", folder_path }) as unknown as Cabinet;

const tags = [tag(1, "设计"), tag(2, "参考")];
const cabinets = [cabinet(10, "项目"), cabinet(11, "关联", "D:\\Linked")];
const choice = (over: Partial<CollectChoice>): CollectChoice => ({ action: "import", tagIds: [], cabinetId: null, folderMode: "folder", ...over });

describe("collect planning", () => {
  it("passes plain files through without hiding anything", () => {
    const plan = planCollect({ files: ["C:\\a.txt", "C:\\b.txt"], folders: [] }, "contents", []);
    expect(plan).toEqual({ paths: ["C:\\a.txt", "C:\\b.txt"], hideFromAllPaths: [] });
  });

  it("folder mode adds only the folder and ignores any expansion", () => {
    const plan = planCollect({ files: ["C:\\x.txt"], folders: ["C:\\Dir"] }, "folder", ["C:\\Dir\\in.txt"]);
    expect(plan).toEqual({ paths: ["C:\\Dir", "C:\\x.txt"], hideFromAllPaths: [] });
  });

  it("both mode keeps the dropped folder visible and hides its contents from the overview", () => {
    const plan = planCollect({ files: [], folders: ["C:\\Dir"] }, "both", ["C:\\Dir\\sub\\in.txt"]);
    expect(plan.paths).toEqual(expect.arrayContaining(["C:\\Dir", "C:\\Dir\\sub", "C:\\Dir\\sub\\in.txt"]));
    expect(plan.hideFromAllPaths).toEqual(expect.arrayContaining(["C:\\Dir\\sub", "C:\\Dir\\sub\\in.txt"]));
    expect(plan.hideFromAllPaths).not.toContain("C:\\Dir");
  });

  it("builds the add_items context for each action", () => {
    const plan = { paths: ["C:\\Dir", "C:\\Dir\\a"], hideFromAllPaths: ["C:\\Dir\\a"] };
    expect(collectContext(choice({ action: "tag", tagIds: [1, 2] }), plan)).toEqual({ tagIds: [1, 2], hideFromAllPaths: ["C:\\Dir\\a"] });
    expect(collectContext(choice({ action: "cabinet", cabinetId: 10 }), plan)).toEqual({ cabinetId: 10, hideFromAllPaths: ["C:\\Dir\\a"] });
    expect(collectContext(choice({ action: "import", tagIds: [1], cabinetId: 10 }), { paths: ["C:\\f"], hideFromAllPaths: [] })).toEqual({});
  });

  it("excludes linked cabinets from the targets", () => {
    expect(collectableCabinets(cabinets).map((c) => c.id)).toEqual([10]);
  });
});

describe("remembered choice", () => {
  it("drops deleted tags and rejects a preference with none left", () => {
    expect(usablePreference({ action: "tag", tagIds: [2, 99], cabinetId: null, folderMode: "both" }, tags, cabinets))
      .toEqual({ action: "tag", tagIds: [2], cabinetId: null, folderMode: "both" });
    expect(usablePreference({ action: "tag", tagIds: [99], cabinetId: null, folderMode: null }, tags, cabinets)).toBeNull();
  });

  it("rejects deleted or linked cabinets", () => {
    expect(usablePreference({ action: "cabinet", tagIds: [], cabinetId: 10, folderMode: "folder" }, tags, cabinets)?.cabinetId).toBe(10);
    expect(usablePreference({ action: "cabinet", tagIds: [], cabinetId: 11, folderMode: null }, tags, cabinets)).toBeNull();
    expect(usablePreference({ action: "cabinet", tagIds: [], cabinetId: 12, folderMode: null }, tags, cabinets)).toBeNull();
    expect(usablePreference(null, tags, cabinets)).toBeNull();
  });

  it("stores only the fields of the chosen action and the folder mode when folders were involved", () => {
    expect(toPreference(choice({ action: "tag", tagIds: [1], cabinetId: 10, folderMode: "contents" }), true))
      .toEqual({ action: "tag", tagIds: [1], cabinetId: null, folderMode: "contents" });
    expect(toPreference(choice({ action: "cabinet", tagIds: [1], cabinetId: 10, folderMode: "both" }), false))
      .toEqual({ action: "cabinet", tagIds: [], cabinetId: 10, folderMode: null });
  });

  it("falls back to the main window's last folder mode", () => {
    expect(readFolderMode({ getItem: () => "both" })).toBe("both");
    expect(readFolderMode({ getItem: () => "junk" })).toBe("folder");
    expect(readFolderMode(null)).toBe("folder");
  });

  it("describes the choice by name", () => {
    expect(describeChoice(choice({ action: "tag", tagIds: [1, 2] }), tags, cabinets)).toBe("打标签「设计、参考」");
    expect(describeChoice(choice({ action: "cabinet", cabinetId: 10 }), tags, cabinets)).toBe("放入文件柜「项目」");
    expect(describeChoice(choice({}), tags, cabinets)).toBe("仅导入");
  });

  it("names paths, including drive roots and trailing separators", () => {
    expect(pathName("C:\\Users\\me\\doc.txt")).toBe("doc.txt");
    expect(pathName("C:\\Users\\me\\Dir\\")).toBe("Dir");
    expect(pathName("D:\\")).toBe("D:");
  });
});
