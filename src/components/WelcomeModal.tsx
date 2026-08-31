import { useEffect, useState, type MouseEvent } from "react";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import {
  ArrowRight,
  Boxes,
  Check,
  Command,
  Database,
  ExternalLink,
  Fingerprint,
  GitBranch,
  Heart,
  MousePointer2,
  Play,
  Search,
  Sparkles,
  Tag,
  Tags,
  X,
  type LucideIcon,
} from "lucide-react";
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
  icon: LucideIcon;
}

const FEATURES: FeatureEntry[] = [
  {
    title: "命令面板与快捷键",
    description: "Ctrl+K 命令面板，空格快速预览，键盘即可搜索、筛选与启动",
    isNew: true,
    icon: Command,
  },
  {
    title: "标签化组织",
    description: "标签、文件柜、收藏三个维度组织文件与程序，多标签交集筛选",
    icon: Tags,
  },
  {
    title: "智能搜索",
    description: "覆盖名称、路径、标签、拼音、首字母与同义词，支持表达式语法",
    icon: Search,
  },
  {
    title: "一键启动",
    description: "双击即可启动对象，右键快捷打开所在目录，拖拽导入批量归类",
    icon: Play,
  },
  {
    title: "主题与 Mod 扩展",
    description: "内置与自定义 JSON 主题，CSS / JS Mod 扩展体系可深度定制",
    icon: Boxes,
  },
  {
    title: "对象身份追踪",
    description: "NTFS 文件 ID 识别对象，重命名或移动自动跟踪，跨盘签名找回",
    isNew: true,
    icon: Fingerprint,
  },
  {
    title: "标签关系图谱",
    description: "标签支持多父继承构成图状层级，提供关系编辑器与图谱视图",
    isNew: true,
    icon: GitBranch,
  },
  {
    title: "批量操作与音频对象",
    description: "框选批量打标、归档与移除；支持音频对象与元数据预览",
    isNew: true,
    icon: MousePointer2,
  },
  {
    title: "AI 自动打标",
    description: "配置 Anthropic 协议 API 后一键为全库对象打标，新对象可自动打标",
    isNew: true,
    icon: Sparkles,
  },
  {
    title: "数据管理",
    description: "自定义数据存放目录，支持一键导出、导入与备份应用数据",
    isNew: true,
    icon: Database,
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

  const handleOpenBilibili = async (event: MouseEvent<HTMLAnchorElement>) => {
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
      className="fixed inset-0 flex items-center justify-center p-3 sm:p-5"
      style={{ zIndex: "var(--z-welcome-modal)" }}
    >
      <div
        className="absolute inset-0"
        style={{ backgroundColor: "var(--overlay-bg)", backdropFilter: "blur(4px)" }}
        onClick={() => onClose(hideNextTime)}
      />

      <section
        ref={trapRef}
        className="modal-surface relative flex max-h-[90dvh] w-[min(860px,calc(100vw-24px))] flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-modal-title"
      >
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[var(--line-hairline)] px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]">
              <Tag aria-hidden="true" size={21} strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <div className="instrument-label">Welcome / TagLauncher</div>
              <h2 id="welcome-modal-title" className="mt-1 truncate text-lg font-semibold text-[var(--text-primary)]">
                欢迎使用 TagLauncher
              </h2>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {appVersion && (
              <span className="data-readout hidden rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-recessed)] px-2 py-1 text-[11px] text-[var(--text-muted)] sm:inline">
                v{appVersion}
              </span>
            )}
            <button
              type="button"
              onClick={() => onClose(hideNextTime)}
              className="icon-button"
              title="关闭欢迎页"
              aria-label="关闭欢迎页"
            >
              <X aria-hidden="true" size={17} strokeWidth={1.8} />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="border-b border-[var(--line-hairline)] bg-[var(--surface-recessed)] px-4 py-3 sm:px-6">
            <p className="text-sm font-medium text-[var(--text-primary)]">{GREETING}</p>
            <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
              免费、轻量、直观、便捷。用标签、搜索与快捷操作整理并启动本地资源。
            </p>
          </div>

          <div className="grid lg:grid-cols-[minmax(0,1fr)_220px]">
            <section className="min-w-0 px-4 py-5 sm:px-6" aria-labelledby="welcome-features-title">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className="instrument-label">Capabilities</div>
                  <h3 id="welcome-features-title" className="mt-1 text-base font-semibold text-[var(--text-primary)]">
                    工作区能力
                  </h3>
                </div>
                <span className="data-readout text-[11px] text-[var(--text-faint)]">10 MODULES</span>
              </div>

              <ul className="mt-3 grid border-l border-t border-[var(--line-hairline)] sm:grid-cols-2">
                {FEATURES.map((feature) => {
                  const Icon = feature.icon;
                  return (
                    <li
                      key={feature.title}
                      className="flex min-w-0 gap-3 border-b border-r border-[var(--line-hairline)] bg-[var(--bg-card)] px-3 py-3"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]">
                        <Icon aria-hidden="true" size={16} strokeWidth={1.8} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-[var(--text-primary)]">{feature.title}</span>
                          {feature.isNew && (
                            <span className="data-readout bg-[var(--accent-primary-bg)] px-1.5 py-0.5 text-[9px] text-[var(--accent-primary)]">
                              NEW
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{feature.description}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-4 flex items-start gap-2 border-l-2 border-[var(--accent-primary)] bg-[var(--accent-primary-bg-light)] px-3 py-2.5 text-xs leading-5 text-[var(--text-secondary)]">
                <Sparkles aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--accent-primary)]" size={15} strokeWidth={1.8} />
                在设置中填写兼容 Anthropic 协议的 API 地址与密钥，即可一键为全库对象自动打标。
              </div>
            </section>

            <aside className="flex items-center gap-4 border-t border-[var(--line-hairline)] bg-[var(--surface-recessed)] p-5 lg:flex-col lg:items-stretch lg:border-l lg:border-t-0">
              <div className="w-24 shrink-0 border border-[var(--border-subtle)] bg-white p-2 lg:w-full">
                <img src={qrCodeImage} alt="赞助二维码" className="aspect-square w-full object-contain" draggable={false} />
              </div>
              <div className="min-w-0 lg:text-center">
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)] lg:justify-center">
                  <Heart aria-hidden="true" size={16} strokeWidth={1.8} className="text-[var(--accent-primary)]" />
                  支持作者
                </div>
                <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">感谢你帮助 TagLauncher 持续迭代。</p>
                <a
                  href={BILIBILI_URL}
                  onClick={handleOpenBilibili}
                  className="mt-3 inline-flex min-h-8 items-center gap-1.5 text-sm font-semibold text-[var(--accent-primary)] hover:text-[var(--accent-primary-hover)]"
                >
                  B 站主页
                  <ExternalLink aria-hidden="true" size={14} strokeWidth={1.8} />
                </a>
              </div>
            </aside>
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[var(--line-hairline)] bg-[var(--bg-surface)] px-4 py-4 sm:px-6">
          <button
            type="button"
            onClick={() => setHideNextTime((value) => !value)}
            aria-pressed={hideNextTime}
            className="inline-flex min-h-8 items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-input)]">
              {hideNextTime && <Check aria-hidden="true" size={12} strokeWidth={2.2} className="text-[var(--accent-primary)]" />}
            </span>
            下次不再显示
          </button>

          <button
            type="button"
            onClick={() => onClose(hideNextTime)}
            className="action-button action-button-primary"
          >
            开始使用
            <ArrowRight aria-hidden="true" size={16} strokeWidth={1.9} />
          </button>
        </footer>
      </section>
    </div>
  );
}
