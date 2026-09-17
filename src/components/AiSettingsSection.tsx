import { useEffect, useState, type CSSProperties } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import * as db from "../lib/db";
import type { AiConfig } from "../lib/db";
import { copyText } from "../lib/clipboard";
import { showToast } from "../lib/toast";
import { SettingsField, SettingsToggle, inputClass } from "./SettingsField";

/** 触发 App 层的批量打标编排 */
export const AI_TAG_ALL_EVENT = "taglauncher-ai-tag-all";
export interface AiTagAllDetail {
  scope: "all" | "untagged";
}

const EMPTY_CONFIG: AiConfig = {
  baseUrl: "",
  apiKey: "",
  model: "",
  autoTagOnAdd: false,
  maxTags: 5,
  allowNewTags: true,
  extraPrompt: "",
};

export function AiSettingsSection() {
  const [config, setConfig] = useState<AiConfig>(EMPTY_CONFIG);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<"save" | "test" | "tag" | null>(null);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    void db
      .aiGetConfig()
      .then((c) => setConfig({ ...EMPTY_CONFIG, ...c }))
      .catch((e) => showToast(`读取 AI 配置失败：${e instanceof Error ? e.message : String(e)}`, "error"))
      .finally(() => setLoaded(true));
  }, []);

  const update = <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => {
    setConfig((c) => ({ ...c, [key]: value }));
  };

  // 后端不再下发明文密钥：已存密钥用 hasApiKey 判定，用户新输入的 apiKey 也算已配置。
  // 模型改为用户必填（无内置默认），故三项（地址/密钥/模型）齐全才算已配置。
  const hasStoredKey = config.hasApiKey === true;
  const configured =
    config.baseUrl.trim() !== "" &&
    (hasStoredKey || config.apiKey.trim() !== "") &&
    config.model.trim() !== "";

  const handleSave = async () => {
    setBusy("save");
    try {
      await db.aiSetConfig(config);
      // 保存后清空本地明文输入；若填过新密钥则标记为已存（后端已保存，UI 不再持有明文）。
      setConfig((c) => ({ ...c, apiKey: "", hasApiKey: c.hasApiKey === true || c.apiKey.trim() !== "" }));
      showToast("AI 配置已保存", "success");
    } catch (e) {
      showToast(`保存失败：${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setBusy(null);
    }
  };

  const handleTest = async () => {
    setBusy("test");
    // 先保存再测试，避免测的是旧配置。两段 try 分开：保存失败保留用户输入；
    // 保存成功（即使随后测试失败）密钥已落库，UI 同步为"已存"并清空本地明文。
    try {
      await db.aiSetConfig(config);
    } catch (e) {
      showToast(`保存失败：${e instanceof Error ? e.message : String(e)}`, "error");
      setBusy(null);
      return;
    }
    setConfig((c) => ({ ...c, apiKey: "", hasApiKey: c.hasApiKey === true || c.apiKey.trim() !== "" }));
    try {
      const reply = await db.aiTestConnection();
      showToast(`连接成功：${reply.slice(0, 40) || "ok"}`, "success");
    } catch (e) {
      showToast(`连接失败：${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setBusy(null);
    }
  };

  const requestTagAll = async (scope: AiTagAllDetail["scope"]) => {
    // 打标按钮始终可点击，故此处统一做配置校验与防重入
    if (busy === "tag") return;
    // 校验后端已保存配置（而非本地未保存的输入），口径与 flushQueuedAutoTag 一致
    let saved: AiConfig;
    try {
      saved = await db.aiGetConfig();
    } catch (e) {
      showToast(`读取 AI 配置失败：${e instanceof Error ? e.message : String(e)}`, "error");
      return;
    }
    if (!saved.baseUrl.trim() || saved.hasApiKey !== true || !saved.model.trim()) {
      showToast("请先填写并保存 API 地址、密钥与模型", "warning");
      return;
    }
    // 先统计待打标对象数并弹确认：每个对象 1 次 API 调用，批量打标可能产生可观耗时与费用
    setBusy("tag");
    let count: number;
    try {
      const items = await db.getItems(false);
      count = scope === "untagged" ? items.filter((item) => item.tags.length === 0).length : items.length;
    } catch (e) {
      showToast(`统计对象失败：${e instanceof Error ? e.message : String(e)}`, "error");
      return;
    } finally {
      setBusy(null);
    }
    if (count === 0) {
      showToast(scope === "untagged" ? "没有未打标的对象" : "当前没有对象", "info");
      return;
    }
    let confirmed: boolean;
    try {
      confirmed = await ask(
        `将为 ${count} 个对象调用 AI 打标，预计发起 ${count} 次 API 请求。是否继续？`,
        { title: "AI 批量打标", kind: "info" },
      );
    } catch (e) {
      showToast(`操作失败：${e instanceof Error ? e.message : String(e)}`, "error");
      return;
    }
    if (!confirmed) return;
    window.dispatchEvent(new CustomEvent<AiTagAllDetail>(AI_TAG_ALL_EVENT, { detail: { scope } }));
  };

  // 显式清除已存密钥（"留空=不修改"语义下删除密钥的专用通道）。
  const handleClearKey = async () => {
    setBusy("save");
    try {
      await db.aiClearApiKey();
      setConfig((c) => ({ ...c, apiKey: "", hasApiKey: false }));
      showToast("已清除保存的 API 密钥", "success");
    } catch (e) {
      showToast(`清除失败：${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="surface-card-soft mt-6 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">AI 自动打标</h3>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            填写兼容 Anthropic 协议的 API，即可一键为对象智能打标
          </p>
        </div>
        <span
          className="mt-1 shrink-0 rounded-[var(--radius-full)] px-2.5 py-1 text-xs font-medium"
          style={{
            background: configured ? "var(--status-success-bg)" : "var(--bg-hover)",
            color: configured ? "var(--color-success-ink)" : "var(--text-muted)",
          }}
        >
          {configured ? "已配置" : "未配置"}
        </span>
      </div>

      <fieldset disabled={!loaded || busy !== null} className="mt-4 min-w-0 space-y-3">
        <SettingsField label="API 地址（Base URL）">
          <input
            type="text"
            value={config.baseUrl}
            onChange={(e) => update("baseUrl", e.target.value)}
            placeholder="https://api.anthropic.com"
            spellCheck={false}
            className={inputClass}
          />
        </SettingsField>

        <SettingsField label="API 密钥" htmlFor="ai-api-key">
          <div className="flex gap-2">
            <input
              id="ai-api-key"
              type={showKey ? "text" : "password"}
              value={config.apiKey}
              onChange={(e) => update("apiKey", e.target.value)}
              placeholder={hasStoredKey ? "已保存密钥（留空表示不修改）" : "sk-..."}
              spellCheck={false}
              autoComplete="off"
              className={inputClass}
            />
            <button type="button" onClick={() => setShowKey((v) => !v)} className="action-button min-h-[44px] shrink-0 px-3 text-xs">
              {showKey ? "隐藏" : "显示"}
            </button>
          </div>
        </SettingsField>

        <div className="grid gap-4 sm:grid-cols-2">
          <SettingsField label="模型">
            <input
              type="text"
              value={config.model}
              onChange={(e) => update("model", e.target.value)}
              placeholder="claude-haiku-4-5-20251001"
              spellCheck={false}
              className={inputClass}
            />
          </SettingsField>
          <SettingsField label={`每个对象最多标签数（${config.maxTags}）`}>
            <input
              type="range"
              min={1}
              max={20}
              value={config.maxTags}
              onChange={(e) => update("maxTags", Number(e.target.value))}
              className="settings-range"
              style={{ "--range-progress": `${((config.maxTags - 1) / 19) * 100}%` } as CSSProperties}
            />
          </SettingsField>
        </div>

        <SettingsField label="补充打标偏好（可选）">
          <input
            type="text"
            value={config.extraPrompt}
            onChange={(e) => update("extraPrompt", e.target.value)}
            placeholder="例如：偏向按用途分类、使用中文标签"
            className={inputClass}
          />
        </SettingsField>

        <SettingsToggle
          checked={config.allowNewTags}
          onChange={(v) => update("allowNewTags", v)}
          title="允许创建新标签"
          description="开启时可生成新标签，关闭时从已有标签中挑选。"
          disabled={!loaded}
        />
        <SettingsToggle
          checked={config.autoTagOnAdd}
          onChange={(v) => update("autoTagOnAdd", v)}
          title="新对象自动打标"
          description="导入新对象时后台自动调用 AI 打标。"
          disabled={!loaded}
        />
      </fieldset>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void handleSave()} disabled={!loaded || busy !== null} className="action-button action-button-primary px-4 text-xs disabled:opacity-50">
          {busy === "save" ? "保存中…" : "保存配置"}
        </button>
        <button type="button" onClick={() => void handleTest()} disabled={!loaded || busy !== null || !configured} className="action-button px-4 text-xs disabled:opacity-50">
          {busy === "test" ? "测试中…" : "测试连接"}
        </button>
        {hasStoredKey && (
          <button type="button" onClick={() => void handleClearKey()} disabled={!loaded || busy !== null} className="action-button px-4 text-xs disabled:opacity-50">
            清除密钥
          </button>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--line-hairline)] pt-3">
        <p className="mr-auto text-xs text-[var(--text-faint)]">运行打标</p>
        <button
          type="button"
          onClick={() => void requestTagAll("untagged")}
          aria-disabled={!configured}
          title={configured ? undefined : "未配置 AI 服务"}
          className={`action-button action-button-primary px-4 text-xs ${configured ? "" : "opacity-50"}`}
        >
          {busy === "tag" ? "统计中…" : "为未打标对象打标"}
        </button>
        <button
          type="button"
          onClick={() => void requestTagAll("all")}
          aria-disabled={!configured}
          title={configured ? undefined : "未配置 AI 服务"}
          className={`action-button px-4 text-xs ${configured ? "" : "opacity-50"}`}
        >
          {busy === "tag" ? "统计中…" : "为全部重新打标"}
        </button>
      </div>

      <CliIntegrationBlock />
    </section>
  );
}

/** AI 集成区块：CLI（tl）与 MCP 接入说明 + 配置一键复制 */
function CliIntegrationBlock() {
  const [info, setInfo] = useState<db.CliIntegrationInfo | null>(null);

  useEffect(() => {
    void db
      .getCliIntegrationInfo()
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);

  if (!info) return null;

  return (
    <div className="mt-5 border-t border-[var(--line-hairline)] pt-4">
      <div className="text-label">AI 集成</div>
      <p className="mt-2 text-sm text-[var(--text-muted)]">
        应用随附命令行 <code className="text-[var(--text-secondary)]">tl</code>，供终端脚本与 AI 客户端直接管理对象库：
        <code className="text-[var(--text-secondary)]">tl search / launch / tag / fav</code>、
        <code className="text-[var(--text-secondary)]">tl tui</code>（终端界面）、
        <code className="text-[var(--text-secondary)]">tl mcp</code>（MCP 服务）。
      </p>
      {info.cli_available ? (
        <div className="mt-3 space-y-2">
          <SettingsField label="Claude Desktop 等 MCP 客户端配置（复制后粘贴到客户端配置文件）">
            <textarea
              readOnly
              rows={7}
              value={prettyJson(info.mcp_config)}
              spellCheck={false}
              className={`${inputClass} font-mono text-xs`}
              onFocus={(e) => e.target.select()}
            />
          </SettingsField>
          <button
            type="button"
            className="action-button px-4 text-xs"
            onClick={() =>
              void copyText(
                prettyJson(info.mcp_config),
                "MCP 配置已复制",
              )
            }
          >
            复制 MCP 配置
          </button>
        </div>
      ) : (
        <p className="mt-3 text-sm text-[var(--color-warning-ink)]">
          未检测到 tl.exe——开发模式下请运行 <code>cargo build --bin tl</code>；安装版/便携版会自带于主程序同级目录。
        </p>
      )}
    </div>
  );
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
