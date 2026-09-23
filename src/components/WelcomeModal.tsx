import { useEffect, useState, type MouseEvent } from "react";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ExternalLink,
  Heart,
  Tag,
  X,
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
const GREETING = "把常用内容收在一个地方，用标签快速找到。";

interface FeatureEntry {
  title: string;
  description: string;
}

const STEPS: FeatureEntry[] = [
  {
    title: "添加文件或文件夹",
    description: "拖进工作台，或点右上角「添加文件 / 添加文件夹」。侧栏「文件柜」只是分组，不是磁盘目录。",
  },
  {
    title: "打一个标签",
    description: "从侧栏把标签拖到项目上，或右键选择「管理标签」",
  },
  {
    title: "搜索并打开",
    description: "按 / 或 F3 搜索，双击打开。Ctrl+K 打开命令面板",
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
        className="modal-surface relative flex max-h-[90dvh] w-[min(620px,calc(100vw-24px))] flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-modal-title"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 px-5 pt-6 pb-4 sm:px-8 sm:pt-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]">
              <Tag aria-hidden="true" size={20} strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <h2 id="welcome-modal-title" className="truncate text-[21px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
                欢迎使用 TagLauncher
                {appVersion && (
                  <span className="data-readout ml-2 align-middle text-[13px] font-normal text-[var(--text-faint)]">
                    v{appVersion}
                  </span>
                )}
              </h2>
              <p className="mt-1 text-[13px] text-[var(--text-muted)]">{GREETING}</p>
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
          <section className="min-w-0 px-5 pt-2 pb-5 sm:px-8" aria-labelledby="welcome-steps-title">
            <h3 id="welcome-steps-title" className="text-[12px] font-semibold text-[var(--text-muted)]">从这里开始</h3>
            <ol className="mt-4 space-y-4">
              {STEPS.map((step, index) => (
                <li key={step.title} className="flex min-w-0 gap-4">
                  <span className="data-readout w-6 shrink-0 pt-0.5 text-[12px] text-[var(--accent-primary)]">0{index + 1}</span>
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-[var(--text-primary)]">{step.title}</p>
                    <p className="mt-1 text-[13px] leading-5 text-[var(--text-muted)]">{step.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <details className="mx-5 mb-5 rounded-[var(--radius-md)] bg-[var(--surface-recessed)] px-4 py-3 sm:mx-8">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-[13px] font-medium text-[var(--text-secondary)] [&::-webkit-details-marker]:hidden">
              <Heart aria-hidden="true" size={15} strokeWidth={1.8} />
              支持开发者
              <ChevronDown aria-hidden="true" size={14} strokeWidth={1.8} className="ml-auto" />
            </summary>
            <div className="mt-4 flex items-center gap-4" aria-label="赞助开发者">
              <img
                src={qrCodeImage}
                alt="赞赏码"
                className="h-24 w-24 shrink-0 rounded-[var(--radius-sm)] bg-white object-contain p-1.5"
                draggable={false}
              />
              <div className="min-w-0">
                <p className="text-xs leading-5 text-[var(--text-muted)]">
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
            </div>
          </details>
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
