import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const BASE = "http://127.0.0.1:3457";
const TMP = "/tmp/motion-frames";
const OUT = "/workspace/ui-variants/motion";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ffmpeg(args) {
  return new Promise((res, rej) => {
    const p = spawn("ffmpeg", args, { stdio: "inherit" });
    p.on("exit", (c) => (c === 0 ? res() : rej(new Error("ffmpeg " + c))));
  });
}

async function record({ name, viewport, url, act, frames = 36, fps = 30, hold = 12 }) {
  const dir = path.join(TMP, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    channel: "chrome",
    args: ["--hide-scrollbars"],
  });
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    locale: "zh-CN",
    colorScheme: "light",
  });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const img = await page.$(".v-desktop-bg");
  if (img) {
    await page.waitForFunction(() => {
      const i = document.querySelector(".v-desktop-bg");
      return !i || i.complete;
    });
  }
  await sleep(250);
  // baseline frames
  for (let i = 0; i < 6; i++) {
    await page.screenshot({ path: path.join(dir, `f${String(i).padStart(3, "0")}.png`), animations: "disabled" });
    await sleep(1000 / fps);
  }
  // trigger
  await act(page);
  const start = Date.now();
  for (let i = 6; i < frames; i++) {
    await page.screenshot({ path: path.join(dir, `f${String(i).padStart(3, "0")}.png`) });
    const target = start + ((i - 6) * 1000) / fps;
    const wait = target - Date.now();
    if (wait > 0) await sleep(wait);
  }
  // hold last
  const last = path.join(dir, `f${String(frames - 1).padStart(3, "0")}.png`);
  for (let i = frames; i < frames + hold; i++) {
    fs.copyFileSync(last, path.join(dir, `f${String(i).padStart(3, "0")}.png`));
  }
  await browser.close();
  const dest = path.join(OUT, `${name}.mp4`);
  await ffmpeg([
    "-y",
    "-framerate",
    String(fps),
    "-i",
    path.join(dir, "f%03d.png"),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    "18",
    "-movflags",
    "+faststart",
    dest,
  ]);
  console.log("wrote", dest, fs.statSync(dest).size);
}

async function main() {
  await record({
    name: "quick-glass-pop",
    viewport: { width: 900, height: 680 },
    url: `${BASE}/variants.html?surface=quick&variant=glass&mode=light&font=1&state=results`,
    act: async (page) => {
      await page.evaluate(() => {
        const el = document.querySelector(".v-quick");
        el?.classList.remove("is-enter");
        void el?.offsetWidth;
        el?.classList.add("is-enter");
      });
    },
    frames: 30,
    fps: 30,
    hold: 18,
  });
  await record({
    name: "handle-tab-drawer",
    viewport: { width: 1920, height: 1080 },
    url: `${BASE}/variants.html?surface=handle&variant=tab&mode=light&font=1&state=hover&desktop=1`,
    act: async (page) => {
      await page.evaluate(() => {
        document.querySelector(".v-drawer")?.classList.add("is-open");
      });
    },
    frames: 36,
    fps: 30,
    hold: 20,
  });
  console.log("motion done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
