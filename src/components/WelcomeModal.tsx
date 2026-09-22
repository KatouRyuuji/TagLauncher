import { useEffect, useState, type MouseEvent } from "react";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import {
  ArrowRight,
  Check,
  ExternalLink,
  FilePlus2,
  Heart,
  Search,
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
  icon: LucideIcon;
}

const STEPS: FeatureEntry[] = [
  {
    title: "添加文件或文件夹",
    description: "拖进工作台，或点右上角「添加文件 / 添加文件夹」。侧栏「文件柜」只是分组，不是磁盘目录。",
    icon: FilePlus2,
  },
  {
    title: "打一个标签",
    description: "从侧栏把标签拖到项目上，或右键选择「管理标签」",
    icon: Tags,
  },
  {
    title: "搜索并打开",
    description: "按 / 或 F3 搜索，双击打开。Ctrl+K 打开命令面板",
    icon: Search,
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
        style={{
          backgroundColor: "var(--overlay-bg)",
        }}
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
              <h2 id="welcome-modal-title" className="truncate text-lg font-semibold text-[var(--text-primary)]">
                欢迎使用 TagLauncher
                {appVersion && (
                  <span className="data-readout ml-2 align-middle text-[13px] font-normal text-[var(--text-faint)]">
                    v{appVersion}
                  </span>
                )}
              </h2>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* 关闭只做弱呈现：纯图标无底无边，视觉重量让位给底部主按钮 */}
            <button
              type="button"
              onClick={() => onClose(hideNextTime)}
              className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-faint)] transition-colors hover:text-[var(--text-primary)]"
              title="关闭欢迎页"
              aria-label="关闭欢迎页"
            >
              <X aria-hidden="true" size={16} strokeWidth={1.8} />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="border-b border-[var(--line-hairline)] bg-[var(--surface-recessed)] px-4 py-3 sm:px-6">
            <p className="font-body text-sm font-medium text-[var(--text-primary)]">{GREETING}</p>
            <p className="mt-1 font-body text-xs leading-5 text-[var(--text-muted)]">
              不再翻文件夹：给文件打上标签，按标签一秒找到并打开。
            </p>
          </div>

          <section className="min-w-0 px-4 py-5 sm:px-6" aria-labelledby="welcome-steps-title">
            <h3 id="welcome-steps-title" className="text-base font-semibold text-[var(--text-primary)]">
              三步上手
            </h3>
            <ol className="mt-3 grid gap-2 sm:grid-cols-3">
              {STEPS.map((step) => {
                const Icon = step.icon;
                return (
                  <li
                    key={step.title}
                    className="flex min-w-0 gap-3 rounded-[var(--radius-md)] border border-[var(--line-hairline)] bg-[var(--bg-card)] px-3 py-3"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]">
                      <Icon aria-hidden="true" size={16} strokeWidth={1.8} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[var(--text-primary)]">
                        {step.title}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{step.description}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          <aside
            className="mx-4 mb-5 flex items-center gap-4 rounded-[var(--radius-md)] border border-[var(--line-hairline)] bg-[var(--surface-recessed)] p-4 sm:mx-6"
            aria-label="赞助开发者"
          >
            <img
              src={qrCodeImage}
              alt="赞赏码"
              className="h-32 w-32 shrink-0 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-white object-contain p-1.5"
              draggable={false}
            />
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-[var(--text-primary)]">
                <Heart aria-hidden="true" size={16} strokeWidth={1.8} className="text-[var(--accent-primary)]" />
                赞助开发者
              </p>
              <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                扫码请作者喝一杯咖啡，帮助 TagLauncher 继续迭代。
              </p>
              <a
                href={BILIBILI_URL}
                onClick={handleOpenBilibili}
                className="mt-2 inline-flex min-h-8 items-center gap-1.5 text-sm font-semibold text-[var(--accent-primary-ink)] underline-offset-4 hover:underline"
              >
                B 站主页
                <ExternalLink aria-hidden="true" size={14} strokeWidth={1.8} />
              </a>
            </div>
          </aside>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[var(--line-hairline)] bg-[var(--bg-surface)] px-4 py-3 sm:px-6">
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
