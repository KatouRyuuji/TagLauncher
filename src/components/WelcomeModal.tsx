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
  "拜托拜托关注我一下，这是我的 B 站首页：",
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
    if (open) {
      setHideNextTime(false);
    }
  }, [open]);

  if (!open) return null;

  const handleOpenBilibili = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    try {
      await shellOpen(BILIBILI_URL);
    } catch {
      // 兜底：如果 shell 打开失败，仍尝试使用浏览器默认行为
      window.open(BILIBILI_URL, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-5">
      <div className="absolute inset-0 bg-black/72 backdrop-blur-[2px]" onClick={() => onClose(hideNextTime)} />

      <section
        className="relative isolate bg-[var(--bg-elevated)] border border-[var(--border-medium)] rounded-[var(--radius-xl)] overflow-hidden"
        style={{ boxShadow: 'var(--shadow-overlay)', width: "min(90vw, calc(82vh * 4 / 3), 980px)", aspectRatio: "4 / 3" }}
        role="dialog"
        aria-modal="true"
        aria-label="欢迎弹窗"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_12%,rgba(56,189,248,0.18),transparent_38%)]" />

        <div className="grid grid-cols-[43%_57%] h-full">
          <div className="relative h-full bg-[var(--bg-card)] border-r border-[var(--border-default)]">
            <img src={welcomeImage} alt="欢迎图片占位" className="w-full h-full object-cover object-center" />
            <div className="absolute inset-x-0 bottom-0 px-4 py-3 text-[12px] text-[var(--text-secondary)] tracking-wide bg-gradient-to-t from-black/65 to-transparent">
              RYUUJI UTILITY TOOLKIT
            </div>
          </div>
          <div className="h-full min-h-0 px-7 pt-6 pb-5 flex flex-col">
            <div className="shrink-0">
              <h2 className="text-[var(--text-primary)] text-[38px] font-semibold tracking-tight leading-none">欢迎使用 TagLauncher</h2>
              <p className="mt-2 text-[var(--text-muted)] text-[13px]">免费、轻量、直观、便捷的标签化文件管理器</p>
            </div>

            <div className="mt-4 min-h-0 flex-1 overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] px-4 py-3.5">
              {INTRO_LINES.map((line) => (
                <p key={line} className="text-[var(--text-primary)] text-[16px] leading-8 break-words">
                  {line}
                </p>
              ))}
              <a
                href={BILIBILI_URL}
                onClick={handleOpenBilibili}
                className="mt-2.5 inline-block text-[16px] leading-8 text-[var(--accent-primary)] hover:text-[var(--accent-primary)] underline underline-offset-4 break-all"
              >
                {BILIBILI_URL}
              </a>

              <p className="mt-4 text-[var(--text-secondary)] text-[16px] leading-8">支持内容：</p>
              <ul className="pl-5 text-[var(--text-secondary)] text-[15px] leading-7 list-disc space-y-1">
                {SERVICE_ITEMS.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>

            <div className="mt-4 border-t border-[var(--border-default)] pt-3.5 flex items-center justify-between gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setHideNextTime((v) => !v)}
                aria-pressed={hideNextTime}
                className="inline-flex items-center gap-2.5 text-[15px] text-[var(--text-primary)] cursor-pointer select-none bg-[var(--bg-hover)] border border-[var(--border-medium)] rounded-[var(--radius-md)] px-3 py-2.5 hover:bg-[var(--bg-active)] transition-colors"
              >
                <span className="relative inline-flex w-5 h-5 items-center justify-center rounded border border-[var(--border-strong)] bg-transparent">
                  <svg
                    className={`w-3.5 h-3.5 text-[var(--accent-primary)] transition-opacity duration-150 ${hideNextTime ? "opacity-100" : "opacity-0"}`}
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3.5 8.5l3 3 6-7" />
                  </svg>
                </span>
                <span>下次不再显示</span>
              </button>
              <button
                onClick={() => onClose(hideNextTime)}
                className="px-3.5 py-2 rounded-[var(--radius-md)] text-[14px] bg-[var(--accent-primary-bg)] border border-[var(--accent-primary)] text-[var(--accent-primary)] hover:bg-[var(--accent-primary-bg)] hover:text-[var(--text-primary)] transition-colors"
              >
                我知道了
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
