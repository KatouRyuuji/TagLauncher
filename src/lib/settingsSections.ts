// ============================================================================
// lib/settingsSections.ts — 设置面板区块注册表（纯逻辑，供 SettingsPanel 使用）
// ============================================================================
// 设置面板按主题、AI、数据、云同步、更新、扩展分区展示。
// 区块 id 供导航与页面关联使用；区块首次访问时挂载，同次打开期间保留草稿。
// ============================================================================

export interface SettingsSectionDef {
  /** 区块稳定 id（用于 DOM 锚点，勿随文案变动） */
  id: string;
  /** 导航 chip 上显示的中文标签 */
  label: string;
}

export const SETTINGS_SECTIONS: SettingsSectionDef[] = [
  { id: "theme", label: "主题外观" },
  { id: "ai", label: "AI 打标" },
  { id: "data", label: "数据管理" },
  { id: "sync", label: "云同步" },
  { id: "update", label: "更新" },
  { id: "mods", label: "扩展" },
];

/** 区块的 DOM 锚点 id（统一前缀避免与页面其他 id 冲突）。 */
export function settingsSectionDomId(sectionId: string): string {
  return `settings-section-${sectionId}`;
}
