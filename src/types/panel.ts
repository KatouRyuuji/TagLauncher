// ============================================================================
// types/panel.ts — Mod Panel API 类型定义
// ============================================================================

/** Panel 挂载位置 */
export type PanelPosition = "sidebar" | "floating" | "modal";

/** 模态面板按钮定义 */
export interface ModalButton {
  /** 显示文字 */
  label: string;
  /** 操作类型：confirm / cancel / custom */
  action: "confirm" | "cancel" | "custom";
  /** 自定义操作的 id（action="custom" 时使用） */
  id?: string;
}

/** Panel 创建选项 */
export interface PanelOptions {
  /** 挂载位置 */
  position: PanelPosition;
  /** 面板标题（默认 mod id） */
  title?: string;
  /** 初始宽度（floating 有效，px，默认 320） */
  width?: number;
  /** 初始高度（floating 有效，px，默认 240） */
  height?: number;
  /** 初始 X（floating，默认居中） */
  x?: number;
  /** 初始 Y（floating，默认居中） */
  y?: number;
  /** 是否可调整大小（floating 有效，默认 true） */
  resizable?: boolean;
  /** 是否可折叠（sidebar 有效，默认 true） */
  collapsible?: boolean;
  /** 模态面板按钮（modal 有效，不传则无按钮栏） */
  modalButtons?: ModalButton[];
}

/** Panel 生命周期事件 */
export type PanelEvent =
  | "close"
  | "show"
  | "hide"
  | "modal-confirm"
  | "modal-cancel"
  | "modal-button";

/** Panel 操作句柄（createPanel 返回值） */
export interface PanelHandle {
  /** 全局唯一 id（格式：modId::panelId） */
  readonly id: string;
  /** 内容容器 div，mod 可向此写入 innerHTML 或 appendChild */
  readonly container: HTMLElement;
  /** 显示面板 */
  show(): void;
  /** 隐藏面板（不销毁） */
  hide(): void;
  /** 关闭并销毁面板 */
  close(): void;
  /** 更新标题 */
  setTitle(title: string): void;
  /**
   * 监听面板事件。
   * 返回取消监听函数（onDisable 清理时无需手动调用，panelRegistry 会自动清理）
   */
  on(event: PanelEvent, cb: (data?: unknown) => void): () => void;
}

/** React 侧管理的面板描述符（内部使用） */
export interface PanelDescriptor {
  /** 全局唯一 id */
  id: string;
  /** 所属 mod id */
  modId: string;
  /** 挂载位置 */
  position: PanelPosition;
  /** 面板标题 */
  title: string;
  /** 初始宽度（floating） */
  width: number;
  /** 初始高度（floating） */
  height: number;
  /** 初始 X（floating） */
  x: number;
  /** 初始 Y（floating） */
  y: number;
  /** 是否可调整大小 */
  resizable: boolean;
  /** 是否可折叠（sidebar） */
  collapsible: boolean;
  /** 模态按钮 */
  modalButtons: ModalButton[];
  /** 当前是否可见 */
  visible: boolean;
}
