// ============================================================================
// hooks/useSidebarPanels.ts — Sidebar 位置的 Mod 面板订阅
// ============================================================================
// 监听 Mod 面板生命周期事件（创建/销毁/显隐/改标题），维护 position==="sidebar"
// 的面板描述符列表。floating / modal 面板由 FloatingPanels.tsx 单独管理。
// 从 App.tsx 抽离，行为完全保持一致。
// ============================================================================

import { useEffect, useState } from "react";
import {
  PANEL_CREATE, PANEL_DESTROY, PANEL_SHOW, PANEL_HIDE, PANEL_TITLE,
} from "../lib/panelRegistry";
import type { PanelDescriptor } from "../types/panel";

export function useSidebarPanels(): PanelDescriptor[] {
  const [sidebarPanels, setSidebarPanels] = useState<PanelDescriptor[]>([]);

  useEffect(() => {
    const onCreate = (e: Event) => {
      const desc = (e as CustomEvent<PanelDescriptor>).detail;
      if (desc.position !== "sidebar") return;
      setSidebarPanels((prev) =>
        prev.some((p) => p.id === desc.id) ? prev : [...prev, desc],
      );
    };
    const onDestroy = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      setSidebarPanels((prev) => prev.filter((p) => p.id !== id));
    };
    const onShow = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      setSidebarPanels((prev) => prev.map((p) => p.id === id ? { ...p, visible: true } : p));
    };
    const onHide = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      setSidebarPanels((prev) => prev.map((p) => p.id === id ? { ...p, visible: false } : p));
    };
    const onTitle = (e: Event) => {
      const { id, title } = (e as CustomEvent<{ id: string; title: string }>).detail;
      setSidebarPanels((prev) => prev.map((p) => p.id === id ? { ...p, title } : p));
    };
    window.addEventListener(PANEL_CREATE, onCreate);
    window.addEventListener(PANEL_DESTROY, onDestroy);
    window.addEventListener(PANEL_SHOW, onShow);
    window.addEventListener(PANEL_HIDE, onHide);
    window.addEventListener(PANEL_TITLE, onTitle);
    return () => {
      window.removeEventListener(PANEL_CREATE, onCreate);
      window.removeEventListener(PANEL_DESTROY, onDestroy);
      window.removeEventListener(PANEL_SHOW, onShow);
      window.removeEventListener(PANEL_HIDE, onHide);
      window.removeEventListener(PANEL_TITLE, onTitle);
    };
  }, []);

  return sidebarPanels;
}
