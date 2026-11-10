import { describe, expect, it } from "vitest";
import { itemAlias, itemDisplayName, itemNameTitle } from "./itemDisplay";

describe("显示别名", () => {
  it("有别名时显示别名，提示里保留磁盘名", () => {
    const item = { name: "setup.exe", alias: "安装器" };
    expect(itemDisplayName(item)).toBe("安装器");
    expect(itemNameTitle(item)).toBe("安装器（磁盘名：setup.exe）");
  });

  it("空白或缺省别名回退磁盘名", () => {
    expect(itemAlias({ name: "a.txt", alias: "   " })).toBeNull();
    expect(itemDisplayName({ name: "a.txt", alias: null })).toBe("a.txt");
    expect(itemNameTitle({ name: "a.txt" })).toBe("a.txt");
  });
});
