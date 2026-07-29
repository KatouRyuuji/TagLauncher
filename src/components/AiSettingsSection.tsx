import { useEffect, useState } from "react";
import * as db from "../lib/db";
import type { AiConfig } from "../lib/db";
import { showToast } from "../lib/toast";

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
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
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

  const requestTagAll = (scope: AiTagAllDetail["scope"]) => {
    if (!configured) {
      showToast("请先填写并保存 API 配置", "warning");
      return;
    }
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
          <div className="text-label">AI</div>
          <h3 className="mt-2 text-lg font-semibold text-[var(--text-primary)]">AI 自动打标</h3>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            填写兼容 Anthropic 协议的 API，即可一键为对象智能打标
          </p>
        </div>
        <span
          className="mt-1 shrink-0 rounded-none px-2.5 py-1 text-xs font-medium"
          style={{
            background: configured ? "var(--status-success-bg)" : "var(--bg-hover)",
            color: configured ? "var(--color-success)" : "var(--text-muted)",
          }}
        >
          {configured ? "已配置" : "未配置"}
        </span>
      </div>

      <div className="mt-4 space-y-3">
        <Field label="API 地址（Base URL）">
          <input
            type="text"
            value={config.baseUrl}
            onChange={(e) => update("baseUrl", e.target.value)}
            placeholder="https://api.anthropic.com"
            spellCheck={false}
            className={inputClass}
          />
        </Field>

        <Field label="API 密钥">
          <div className="flex gap-2">
            <input
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
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="模型">
            <input
              type="text"
              value={config.model}
              onChange={(e) => update("model", e.target.value)}
              placeholder="claude-haiku-4-5-20251001"
              spellCheck={false}
              className={inputClass}
            />
          </Field>
          <Field label={`每个对象最多标签数（${config.maxTags}）`}>
            <input
              type="range"
              min={1}
              max={12}
              value={config.maxTags}
              onChange={(e) => update("maxTags", Number(e.target.value))}
              className="mt-3 w-full accent-[var(--accent-primary)]"
            />
          </Field>
        </div>

        <Field label="补充打标偏好（可选）">
          <input
            type="text"
            value={config.extraPrompt}
            onChange={(e) => update("extraPrompt", e.target.value)}
            placeholder="例如：偏向按用途分类、使用中文标签"
            className={inputClass}
          />
        </Field>

        <ToggleRow
          checked={config.allowNewTags}
          onChange={(v) => update("allowNewTags", v)}
          title="允许创建新标签"
          desc="关闭后只会从已有标签中挑选"
        />
        <ToggleRow
          checked={config.autoTagOnAdd}
          onChange={(v) => update("autoTagOnAdd", v)}
          title="新对象自动打标"
          desc="导入新对象时后台自动调用 AI 打标"
        />
      </div>

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
        <div className="mx-1 h-6 w-px bg-[var(--border-subtle)]" />
        <button type="button" onClick={() => requestTagAll("untagged")} disabled={!configured} className="action-button px-4 text-xs disabled:opacity-50">
          为未打标对象打标
        </button>
        <button type="button" onClick={() => requestTagAll("all")} disabled={!configured} className="action-button px-4 text-xs disabled:opacity-50">
          为全部对象打标
        </button>
      </div>
    </section>
  );
}

const inputClass =
  "w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-placeholder)] focus:border-[var(--accent-primary)] focus:outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-[var(--text-muted)]">{label}</span>
      {children}
    </label>
  );
}

function ToggleRow({
  checked,
  onChange,
  title,
  desc,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className="flex w-full items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-4 py-3 text-left"
    >
      <span>
        <span className="block text-sm font-medium text-[var(--text-primary)]">{title}</span>
        <span className="block text-xs text-[var(--text-muted)]">{desc}</span>
      </span>
      <span
        className="relative h-6 w-11 shrink-0 rounded-none transition-colors"
        style={{ background: checked ? "var(--accent-primary)" : "var(--border-medium)" }}
      >
        <span
          className="absolute top-0.5 h-5 w-5 rounded-none bg-white transition-[left]"
          style={{ left: checked ? "22px" : "2px" }}
        />
      </span>
    </button>
  );
}
