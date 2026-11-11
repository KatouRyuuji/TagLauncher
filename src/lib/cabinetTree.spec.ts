import { describe, expect, it } from "vitest";
import type { Cabinet } from "../types";
import {
  cabinetDescendants, cabinetPathLabel, canNestCabinet, flattenCabinetTree, hasChildCabinets, parentCandidates,
} from "./cabinetTree";

const cab = (id: number, name: string, parent_id: number | null = null, folder_path: string | null = null): Cabinet => ({
  id, name, color: "#fff", created_at: "", folder_path, folder_truncated: false, parent_id,
});

// A ─ B ─ C ; D（关联文件夹，叶子）；E 顶层
const list = [cab(1, "A"), cab(2, "B", 1), cab(3, "C", 2), cab(4, "D", 1, "D:\\x"), cab(5, "E")];

describe("cabinetTree", () => {
  it("深度优先展开、同级保序，折叠隐藏子孙", () => {
    expect(flattenCabinetTree(list).map((r) => [r.cabinet.name, r.depth, r.hasChildren])).toEqual([
      ["A", 0, true], ["B", 1, true], ["C", 2, false], ["D", 1, false], ["E", 0, false],
    ]);
    expect(flattenCabinetTree(list, new Set([2])).map((r) => r.cabinet.name)).toEqual(["A", "B", "D", "E"]);
    expect(flattenCabinetTree(list, new Set([1])).map((r) => r.cabinet.name)).toEqual(["A", "E"]);
  });

  it("父不存在或成环时按顶层补出，不死循环", () => {
    const broken = [cab(1, "A", 2), cab(2, "B", 1), cab(3, "C", 99)];
    const names = flattenCabinetTree(broken).map((r) => r.cabinet.name).sort();
    expect(names).toEqual(["A", "B", "C"]);
    expect([...cabinetDescendants(broken, 1)]).toEqual([2]);
  });

  it("子孙、路径名与父柜候选（防环、关联柜只能是叶子）", () => {
    expect([...cabinetDescendants(list, 1)].sort()).toEqual([2, 3, 4]);
    expect(hasChildCabinets(list, 2)).toBe(true);
    expect(hasChildCabinets(list, 3)).toBe(false);
    expect(cabinetPathLabel(list, 3)).toBe("A / B / C");
    expect(parentCandidates(list, 2).map((c) => c.name)).toEqual(["A", "E"]);
    expect(canNestCabinet(list, 1, 3)).toBe(false);
    expect(canNestCabinet(list, 5, 4)).toBe(false);
    expect(canNestCabinet(list, 5, 3)).toBe(true);
    expect(canNestCabinet(list, 3, null)).toBe(true);
  });
});
