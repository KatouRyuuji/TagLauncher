import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AiTaggingModal } from "./AiTaggingModal";
import type { AiTagProgress } from "../hooks/useAiTagging";

function progress(partial: Partial<AiTagProgress>): AiTagProgress {
  return {
    running: false,
    silent: false,
    total: 0,
    done: 0,
    succeeded: 0,
    skipped: 0,
    failed: 0,
    lastNames: [],
    currentName: null,
    errors: [],
    canceled: false,
    ...partial,
  };
}

describe("AI 打标进度口音", () => {
  it("开始瞬间用读取句代替全零收据", () => {
    render(
      <AiTaggingModal
        progress={progress({ running: true, total: 8 })}
        onCancel={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("正在自动打标…")).toBeInTheDocument();
    expect(screen.getByText("正在读取第 1 / 8 个对象…")).toBeInTheDocument();
    expect(screen.queryByText("已打标")).not.toBeInTheDocument();
  });

  it("进行中把当前对象写成主视觉，建议标签用小字", () => {
    render(
      <AiTaggingModal
        progress={progress({
          running: true,
          total: 8,
          done: 2,
          succeeded: 2,
          currentName: "日落.mp4",
          lastNames: ["风景", "傍晚"],
        })}
        onCancel={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("日落.mp4")).toBeInTheDocument();
    expect(screen.getByText("最近建议：风景、傍晚")).toBeInTheDocument();
    expect(screen.getByText("已打标")).toBeInTheDocument();
  });

  it("完成态保留打标完成与关闭，三格统计呈现结果", () => {
    render(
      <AiTaggingModal
        progress={progress({
          running: false,
          total: 8,
          done: 8,
          succeeded: 5,
          skipped: 2,
          failed: 1,
        })}
        onCancel={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("打标完成")).toBeInTheDocument();
    // 结果由三格统计呈现（已打标/无建议/失败），不再附重复总结句
    expect(screen.getByText("已打标")).toBeInTheDocument();
    expect(screen.getByText("无建议")).toBeInTheDocument();
    expect(screen.getAllByText("失败").length).toBeGreaterThan(0);
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();
  });
});
