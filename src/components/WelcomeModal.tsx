import { useEffect, useState, type ReactNode } from "react";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import qrCodeImage from "../assets/QRCode.png";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { getAppVersion } from "../lib/db";

interface WelcomeModalProps {
  open: boolean;
  onClose: (hideNextTime: boolean) => void;
}

const BILIBILI_URL = "https://space.bilibili.com/445111";
const GREETING = "轻量、极速的标签式资源管理器";

interface FeatureEntry {
  title: string;
  description: string;
  isNew?: boolean;
  icon: ReactNode;
}

const featureIconClass = "h-5 w-5";

const FEATURES: FeatureEntry[] = [
  {
    title: "命令面板与快捷键",
    description: "Ctrl+K 命令面板，空格快速预览，键盘即可搜索、筛选与启动",
    isNew: true,
    icon: (
      <svg className={featureIconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
      </svg>
    ),
  },
  {
    title: "标签化组织",
    description: "标签、文件柜、收藏三个维度组织文件与程序，多标签交集筛选",
    icon: (
      <svg className={featureIconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6Z" />
      </svg>
    ),
  },
  {
    title: "智能搜索",
    description: "覆盖名称、路径、标签、拼音、首字母与同义词，支持表达式语法",
    icon: (
      <svg className={featureIconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
      </svg>
    ),
  },
  {
    title: "一键启动",
    description: "双击即可启动对象，右键快捷打开所在目录，拖拽导入批量归类",
    icon: (
      <svg className={featureIconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
      </svg>
    ),
  },
  {
    title: "主题与 Mod 扩展",
    description: "内置与自定义 JSON 主题，CSS / JS Mod 扩展体系可深度定制",
    icon: (
      <svg className={featureIconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.53 16.122a3 3 0 0 0-5.78 1.128 2.25 2.25 0 0 1-2.4 2.245 4.5 4.5 0 0 0 8.4-2.245c0-.399-.078-.78-.22-1.128Zm0 0a15.998 15.998 0 0 0 3.388-1.62m-5.043-.025a15.994 15.994 0 0 1 1.622-3.395m3.42 3.42a15.995 15.995 0 0 0 4.764-4.648l3.876-5.814a1.151 1.151 0 0 0-1.597-1.597L14.146 6.32a15.996 15.996 0 0 0-4.649 4.763m3.42 3.42a6.776 6.776 0 0 0-3.42-3.42" />
      </svg>
    ),
  },
  {
    title: "对象身份追踪",
    description: "NTFS 文件ID识别对象，重命名或移动自动跟踪，跨盘签名找回",
    isNew: true,
    icon: (
      <svg className={featureIconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 0 1-1.043 3.296 3.745 3.745 0 0 1-3.296 1.043A3.745 3.745 0 0 1 12 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 0 1-3.296-1.043 3.745 3.745 0 0 1-1.043-3.296A3.745 3.745 0 0 1 3 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 0 1 1.043-3.296 3.746 3.746 0 0 1 3.296-1.043A3.746 3.746 0 0 1 12 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 0 1 3.296 1.043 3.746 3.746 0 0 1 1.043 3.296A3.745 3.745 0 0 1 21 12Z" />
      </svg>
    ),
  },
  {
    title: "标签关系图谱",
    description: "标签支持多父继承构成图状层级，提供关系编辑器与图谱视图",
    isNew: true,
    icon: (
      <svg className={featureIconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <circle cx="6" cy="6" r="2.4" />
        <circle cx="18" cy="6" r="2.4" />
        <circle cx="12" cy="18" r="2.4" />
        <path strokeLinecap="round" d="M7.5 7.8 10.8 16M16.5 7.8 13.2 16M8.4 6h7.2" />
      </svg>
    ),
  },
  {
    title: "批量操作与音频对象",
    description: "框选批量打标、归档与移除；支持音频对象与元数据预览",
    isNew: true,
    icon: (
      <svg className={featureIconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9 3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5 5.25 5.25" />
      </svg>
    ),
  },
  {
    title: "AI 自动打标",
    description: "配置 Anthropic 协议 API 后一键为全库对象打标，新对象可自动打标",
    isNew: true,
    icon: (
      <svg className={featureIconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z" />
      </svg>
    ),
  },
  {
    title: "数据管理",
    description: "自定义数据存放目录，支持一键导出、导入与备份应用数据",
    isNew: true,
    icon: (
      <svg className={featureIconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 5.625c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
      </svg>
    ),
  },
];

export function WelcomeModal({ open, onClose }: WelcomeModalProps) {
  const [hideNextTime, setHideNextTime] = useState(false);
  const [appVersion, setAppVersion] = useState<string>("");
  const trapRef = useFocusTrap<HTMLElement>({ active: open });

  useEffect(() => {
    if (open) setHideNextTime(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    void getAppVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion(""));
  }, [open]);

  useEscapeKey(() => onClose(hideNextTime), open);

  if (!open) return null;

  const handleOpenBilibili = async (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    try {
      await shellOpen(BILIBILI_URL);
    } catch {
      window.open(BILIBILI_URL, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div
      data-welcome-overlay=""
      data-workspace-overlay=""
      className="fixed inset-0 flex items-center justify-center p-5"
      style={{ zIndex: "var(--z-welcome-modal)" }}
    >
      <div
        className="absolute inset-0"
        style={{ backgroundColor: "var(--overlay-bg)", backdropFilter: "blur(4px)" }}
        onClick={() => onClose(hideNextTime)}
      />

      <section
        ref={trapRef}
        className="modal-surface relative isolate flex max-h-[90vh] w-[min(920px,94vw)] flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="欢迎弹窗"
      >
        <div className="pointer-events-none absolute inset-0" style={{ background: "var(--welcome-accent-gradient)" }} />

        {/* 头部：标题 + 版本 + WELCOME 字标 */}
        <header className="relative flex items-start justify-between gap-4 px-7 pt-6">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]">
              <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6Z" />
              </svg>
            </div>
            <div>
              <h2 className="text-[26px] font-semibold leading-tight text-[var(--text-primary)]">
                欢迎使用 TagLauncher
              </h2>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                免费、轻量、直观、便捷的标签化文件管理器{appVersion ? ` · v${appVersion}` : ""}
              </p>
            </div>
          </div>
          <div className="hidden select-none text-2xl font-black tracking-widest text-[var(--accent-primary)] md:block">
            WELCOME
          </div>
        </header>

        <p className="relative mt-3 px-7 text-sm text-[var(--text-secondary)]">{GREETING}</p>

        {/* 主体：左侧特性列表 + 右侧赞助卡片 */}
        <div className="relative mt-3 grid min-h-0 flex-1 gap-3 overflow-hidden px-7 md:grid-cols-[minmax(0,1fr)_248px]">
          <div className="min-h-0 space-y-1 overflow-y-auto pb-1 pr-1">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="surface-card-soft flex items-center gap-2 px-3 py-1.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]">
                  {feature.icon}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-[var(--text-primary)]">{feature.title}</span>
                    {feature.isNew && (
                      <span className="rounded-none bg-[var(--accent-primary-bg)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--accent-primary)]">
                        新
                      </span>
                    )}
                  </div>
                  <p className="mt-0 truncate text-xs text-[var(--text-muted)]" title={feature.description}>
                    {feature.description}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <aside className="surface-card-soft hidden h-fit flex-col items-center px-4 py-4 text-center md:flex">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-[var(--accent-primary)]">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
              </svg>
              扫码支持作者
            </div>
            <div className="mt-3 w-full rounded-[var(--radius-md)] bg-white p-2">
              <img src={qrCodeImage} alt="赞助二维码" className="w-full" draggable={false} />
            </div>
            <p className="mt-2 text-xs text-[var(--text-muted)]">“谢谢你请我喝一杯咖啡~”</p>
            <div className="my-3 h-px w-full bg-[var(--border-subtle)]" />
            <a
              href={BILIBILI_URL}
              onClick={handleOpenBilibili}
              className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--accent-primary)]"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
              </svg>
              B 站主页
            </a>
            <p className="mt-1 break-all text-xs text-[var(--text-faint)]">space.bilibili.com/445111</p>
          </aside>
        </div>

        {/* 提示条 */}
        <div className="relative mx-7 mt-4 flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--accent-primary-bg-light)] px-4 py-2.5 text-[13px] text-[var(--text-secondary)]">
          <svg className="h-4 w-4 shrink-0 text-[var(--accent-primary)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
          </svg>
          AI 打标：在设置中填写兼容 Anthropic 协议的 API 地址与密钥，即可一键为全库对象自动打标。
        </div>

        {/* 底部操作区 */}
        <footer className="relative mx-7 mt-4 mb-6 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-4">
          <button
            type="button"
            onClick={() => setHideNextTime((value) => !value)}
            aria-pressed={hideNextTime}
            className="action-button"
          >
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-[4px] border border-[var(--border-default)]">
              {hideNextTime && (
                <svg className="h-3 w-3 text-[var(--accent-primary)]" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            下次不再显示
          </button>

          <button
            type="button"
            onClick={() => onClose(hideNextTime)}
            className="action-button action-button-primary"
          >
            开始使用
          </button>
        </footer>
      </section>
    </div>
  );
}
