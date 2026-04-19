import { useEffect, useState } from "react";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import welcomeImage from "../assets/welcome.png";

interface WelcomeModalProps {
  open: boolean;
  onClose: (hideNextTime: boolean) => void;
}

const BILIBILI_URL = "https://space.bilibili.com/445111";
const INTRO_LINES = [
  "欢迎使用 RyuuJi 的实用小工具 TagLauncher，这是一个免费、轻量、直观、便捷的标签化文件管理器。",
  "如果这个工具对你有帮助，欢迎关注我的 B 站主页：",
];
const SERVICE_ITEMS = [
  "Unity 外包",
  "软件开发外包",
  "技术交流与咨询",
  "建议与意见反馈",
];

export function WelcomeModal({ open, onClose }: WelcomeModalProps) {
  const [hideNextTime, setHideNextTime] = useState(false);

  useEffect(() => {
    if (open) setHideNextTime(false);
  }, [open]);

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
      className="fixed inset-0 flex items-center justify-center p-5"
      style={{ zIndex: "var(--z-welcome-modal)" as unknown as number }}
    >
      <div
        className="absolute inset-0"
        style={{ backgroundColor: "var(--overlay-bg)", backdropFilter: "blur(4px)" }}
        onClick={() => onClose(hideNextTime)}
      />

      <section
        className="modal-surface relative isolate flex w-[min(980px,92vw)] max-w-[980px] overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="欢迎弹窗"
      >
        <div className="pointer-events-none absolute inset-0" style={{ background: "var(--welcome-accent-gradient)" }} />

        <div className="grid w-full md:grid-cols-[42%_58%]">
          <div className="relative min-h-[280px] border-r border-[var(--border-subtle)] bg-[var(--bg-card)]">
            <img src={welcomeImage} alt="欢迎图片" className="h-full w-full object-cover object-center" />
            <div
              className="absolute inset-x-0 bottom-0 px-5 py-4 text-xs tracking-[0.18em] text-white/90"
              style={{ background: "var(--media-caption-gradient)" }}
            >
              RYUUJI UTILITY TOOLKIT
            </div>
          </div>

          <div className="flex min-h-[560px] flex-col px-7 py-6">
            <div>
              <div className="text-label">Welcome</div>
              <h2 className="mt-2 text-[32px] font-semibold leading-tight text-[var(--text-primary)]">
                欢迎使用 TagLauncher
              </h2>
              <p className="mt-2 text-sm text-[var(--text-muted)]">
                免费、轻量、直观、便捷的标签化文件管理器
              </p>
            </div>

            <div className="surface-card-soft mt-5 flex-1 overflow-y-auto p-5">
              {INTRO_LINES.map((line) => (
                <p key={line} className="text-[15px] leading-8 text-[var(--text-primary)]">
                  {line}
                </p>
              ))}

              <a
                href={BILIBILI_URL}
                onClick={handleOpenBilibili}
                className="mt-2 inline-block break-all text-[15px] leading-7 text-[var(--accent-primary)] underline underline-offset-4"
              >
                {BILIBILI_URL}
              </a>

              <div className="mt-6">
                <div className="text-label">Services</div>
                <ul className="mt-3 space-y-2 text-sm text-[var(--text-secondary)]">
                  {SERVICE_ITEMS.map((item) => (
                    <li key={item} className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-[var(--accent-primary)]" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-4">
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
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
