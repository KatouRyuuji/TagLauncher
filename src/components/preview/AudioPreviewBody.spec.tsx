import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AudioPreviewBody } from "./AudioPreviewBody";
import type { ItemWithTags } from "../../types";
import type { AudioPreviewInfo } from "../../lib/db";

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (p: string) => `asset://${p}` }));

const item: ItemWithTags = { id: 1, name: "静音.wav", path: "D:\\a\\静音.wav", type: "file", created_at: "2026-10-08 00:00:00", is_favorite: false, tags: [] };

function setDuration(el: HTMLAudioElement, seconds: number) {
  Object.defineProperty(el, "duration", { configurable: true, get: () => seconds });
}

describe("AudioPreviewBody", () => {
  it("元数据时长先到、<audio> 还没有 duration 时拖动进度：元数据就绪后定位到同一比例", () => {
    const audio = { duration_ms: 3000 } as unknown as AudioPreviewInfo;
    const { container } = render(<AudioPreviewBody item={item} info={null} audio={audio} coverFallbackUrl={null} onTagSelect={() => {}} />);
    const el = container.querySelector("audio")!;
    setDuration(el, NaN);
    fireEvent.change(screen.getByLabelText("播放进度"), { target: { value: "1.5" } });
    expect(el.currentTime).toBe(0);
    setDuration(el, 3);
    fireEvent.loadedMetadata(el);
    expect(el.currentTime).toBeCloseTo(1.5);
  });

  it("duration 已就绪时直接定位", () => {
    const audio = { duration_ms: 3000 } as unknown as AudioPreviewInfo;
    const { container } = render(<AudioPreviewBody item={item} info={null} audio={audio} coverFallbackUrl={null} onTagSelect={() => {}} />);
    const el = container.querySelector("audio")!;
    setDuration(el, 3);
    fireEvent.loadedMetadata(el);
    fireEvent.change(screen.getByLabelText("播放进度"), { target: { value: "2" } });
    expect(el.currentTime).toBeCloseTo(2);
  });
});
