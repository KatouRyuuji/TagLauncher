// ============================================================================
// lib/settingsSections.ts — 设置面板区块注册表（纯逻辑，供 SettingsPanel 使用）
// ============================================================================
// 设置面板内容已增长到六大区块（主题/AI/数据/云同步/更新/扩展），一屏放不下、
// 纯靠滚动定位效率低。区块清单集中登记于此：快速导航 chips 与区块锚点 id
// 共用同一份数据，新增区块只需在这里加一行，不会出现「有区块没锚点」的漂移。
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
