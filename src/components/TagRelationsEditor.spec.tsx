import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TagRelationsEditor } from "./TagRelationsEditor";
import { useAppStore } from "../stores/appStore";
import type { Tag } from "../types";

const tags: Tag[] = [
  { id: 1, name: "父", color: "#111" },
  { id: 2, name: "子", color: "#222" },
  { id: 3, name: "旁", color: "#333" },
];

describe("TagRelationsEditor 添加子标签", () => {
  beforeEach(() => {
    useAppStore.setState({ tagRelations: [] });
  });

  function renderEditor(overrides: Partial<React.ComponentProps<typeof TagRelationsEditor>> = {}) {
    const onAddRelation = vi.fn(async () => {});
    const onAddTag = vi.fn(async (name: string) => ({ id: 9, name, color: "#abc" }));
    const onRemoveTag = vi.fn(async () => {});
    render(
      <TagRelationsEditor
        tags={tags}
        allItems={[]}
        onAddRelation={onAddRelation}
        onRemoveRelation={vi.fn(async () => {})}
        onAddTag={onAddTag}
        onRemoveTag={onRemoveTag}
        onClose={vi.fn()}
        {...overrides}
      />,
    );
    return { onAddRelation, onAddTag, onRemoveTag };
  }

  it("搜索已有标签建立父子关系，保留添加父入口", async () => {
    const { onAddRelation } = renderEditor();
    expect(screen.getByText("添加父标签")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "子" }));
    await userEvent.click(screen.getByRole("button", { name: "添加子标签「旁」" }));
    await waitFor(() => expect(onAddRelation).toHaveBeenCalledWith(2, 3));
  });

  it("新建子标签并写入关系", async () => {
    const { onAddRelation, onAddTag } = renderEditor();
    await userEvent.type(screen.getByRole("textbox", { name: "新建子标签" }), "新子");
    await userEvent.click(screen.getByRole("button", { name: "添加" }));
    await waitFor(() => expect(onAddTag).toHaveBeenCalledWith("新子", expect.any(String)));
    await waitFor(() => expect(onAddRelation).toHaveBeenCalledWith(1, 9));
  });

  it("同名复用已有标签，不新建", async () => {
    const { onAddRelation, onAddTag } = renderEditor();
    await userEvent.type(screen.getByRole("textbox", { name: "新建子标签" }), "旁");
    await userEvent.click(screen.getByRole("button", { name: "添加" }));
    await waitFor(() => expect(onAddRelation).toHaveBeenCalledWith(1, 3));
    expect(onAddTag).not.toHaveBeenCalled();
  });

  it("关系失败时回滚刚创建的标签", async () => {
    const onAddRelation = vi.fn(async () => {
      throw new Error("无法添加：该关系会形成循环继承");
    });
    const onAddTag = vi.fn(async (name: string) => ({ id: 9, name, color: "#abc" }));
    const onRemoveTag = vi.fn(async () => {});
    render(
      <TagRelationsEditor
        tags={tags}
        allItems={[]}
        onAddRelation={onAddRelation}
        onRemoveRelation={vi.fn(async () => {})}
        onAddTag={onAddTag}
        onRemoveTag={onRemoveTag}
        onClose={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByRole("textbox", { name: "新建子标签" }), "新子");
    await userEvent.click(screen.getByRole("button", { name: "添加" }));
    await waitFor(() => expect(onRemoveTag).toHaveBeenCalledWith(9));
    expect(screen.getByText("无法添加：该关系会形成循环继承")).toBeInTheDocument();
  });

  it("取消不创建标签", async () => {
    const onClose = vi.fn();
    const onAddTag = vi.fn(async (name: string) => ({ id: 9, name, color: "#abc" }));
    render(
      <TagRelationsEditor
        tags={tags}
        allItems={[]}
        onAddRelation={vi.fn(async () => {})}
        onRemoveRelation={vi.fn(async () => {})}
        onAddTag={onAddTag}
        onRemoveTag={vi.fn(async () => {})}
        onClose={onClose}
      />,
    );
    await userEvent.type(screen.getByRole("textbox", { name: "新建子标签" }), "草稿");
    await userEvent.click(screen.getByRole("button", { name: "完成" }));
    expect(onAddTag).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});

describe("TagRelationsEditor 打开时对准指定标签", () => {
  beforeEach(() => {
    useAppStore.setState({ tagRelations: [] });
    Element.prototype.scrollIntoView = vi.fn();
  });

  function renderAt(initialTagId: number | null, onAddRelation = vi.fn(async () => {})) {
    const onAddTag = vi.fn(async (name: string) => ({ id: 9, name, color: "#abc" }));
    render(
      <TagRelationsEditor
        tags={tags}
        allItems={[]}
        initialTagId={initialTagId}
        onAddRelation={onAddRelation}
        onRemoveRelation={vi.fn(async () => {})}
        onAddTag={onAddTag}
        onRemoveTag={vi.fn(async () => {})}
        onClose={vi.fn()}
      />,
    );
    return { onAddRelation, onAddTag };
  }

  it("指定父标签：新建子写入该父且输入框获得焦点", async () => {
    const { onAddRelation } = renderAt(3);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    const input = screen.getByRole("textbox", { name: "新建子标签" });
    await waitFor(() => expect(input).toHaveFocus());
    await userEvent.type(input, "新子");
    await userEvent.click(screen.getByRole("button", { name: "添加" }));
    await waitFor(() => expect(onAddRelation).toHaveBeenCalledWith(3, 9));
  });

  it("指定标签已不存在时回退第一个标签", async () => {
    const { onAddRelation } = renderAt(404);
    await userEvent.click(screen.getByRole("button", { name: "添加子标签「旁」" }));
    await waitFor(() => expect(onAddRelation).toHaveBeenCalledWith(1, 3));
  });

  it("输入上级标签名作子标签：本地拒绝间接成环，不调用后端也不新建", async () => {
    // 父(1) → 子(2) → 旁(3)：对准「旁」时把「父」设为子会成环
    useAppStore.setState({ tagRelations: [{ parentId: 1, childId: 2 }, { parentId: 2, childId: 3 }] });
    const { onAddRelation, onAddTag } = renderAt(3);
    await userEvent.type(screen.getByRole("textbox", { name: "新建子标签" }), "父");
    await userEvent.click(screen.getByRole("button", { name: "添加" }));
    expect(await screen.findByText(/会成环/)).toBeInTheDocument();
    expect(onAddRelation).not.toHaveBeenCalled();
    expect(onAddTag).not.toHaveBeenCalled();
  });
});
