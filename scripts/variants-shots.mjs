// 方案探索截图：浅色/深色 × 标准/特大，2x 像素密度。
// 把手合成在 1920×1080 真实任务栏桌面上。Linux Chromium（Noto Sans SC Variable）。
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const PORT = Number(process.env.PORT || 3457);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = process.env.OUT || "/workspace/ui-variants";
const SINGLES = path.join(OUT, "singles");
const MOTION = path.join(OUT, "motion");

const SURFACES = {
  quick: { variants: ["current", "glass", "rail", "peek"], states: ["results"], emptyFor: ["glass", "current"] },
  collect: { variants: ["current", "actions", "inbox", "steps"], states: ["home"] },
  pin: { variants: ["current", "dock", "cards", "strip"], states: ["home"] },
  handle: { variants: ["current", "tab", "jewel", "peek"], states: ["rest", "hover"] },
};

const MODES = ["light", "dark"];
const FONTS = ["1", "1.25"];

const VIEW = {
  quick: { current: [680, 440], glass: [720, 520], rail: [640, 460], peek: [860, 500] },
  collect: { current: [680, 440], actions: [740, 540], inbox: [900, 560], steps: [760, 520] },
  pin: { current: [320, 480], dock: [280, 500], cards: [380, 540], strip: [340, 520] },
};

function url(q) {
  const p = new URLSearchParams(q);
  return `${BASE}/variants.html?${p}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitServer() {
  const t = Date.now() + 40000;
  while (Date.now() < t) {
    try {
      const r = await fetch(`${BASE}/variants.html`);
      if (r.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error("vite not ready on " + BASE);
}

async function prepare(page) {
  await page.waitForSelector("[data-testid='quick'], [data-testid='collect'], [data-testid='pin'], [data-testid='handle']", { timeout: 15000 });
  await page.evaluate(async () => {
    await document.fonts.ready;
    const img = document.querySelector(".v-desktop-bg");
    if (img && !img.complete) {
      await new Promise((res, rej) => {
        img.addEventListener("load", res, { once: true });
        img.addEventListener("error", res, { once: true });
        setTimeout(res, 2000);
      });
    }
  });
  await sleep(120);
}

async function shotPanel(page, surface, variant, dest) {
  const [pw, ph] = VIEW[surface][variant];
  const padX = 72;
  const padY = 64;
  const el = page.locator("[data-testid='shot-target']");
  const box = await el.boundingBox();
  if (!box) throw new Error("no shot-target");
  // include wallpaper padding around the panel (acrylic needs context)
  const clip = {
    x: Math.max(0, box.x - padX),
    y: Math.max(0, box.y - padY),
    width: box.width + padX * 2,
    height: box.height + padY * 2,
  };
  await page.screenshot({ path: dest, clip, animations: "disabled", type: "png" });
}

async function shotDesktop(page, dest) {
  await page.screenshot({ path: dest, animations: "disabled", type: "png", fullPage: false });
}

async function main() {
  fs.mkdirSync(SINGLES, { recursive: true });
  fs.mkdirSync(MOTION, { recursive: true });
  await waitServer();

  const browser = await chromium.launch({
    headless: true,
    channel: "chrome",
    args: ["--font-render-hinting=medium", "--hide-scrollbars"],
  });

  const jobs = [];
  for (const [surface, cfg] of Object.entries(SURFACES)) {
    for (const variant of cfg.variants) {
      for (const mode of MODES) {
        for (const font of FONTS) {
          for (const state of cfg.states) {
            jobs.push({ surface, variant, mode, font, state });
          }
        }
      }
    }
    // empty states: light + standard only (enough to show the empty design)
    for (const v of cfg.emptyFor || []) {
      jobs.push({ surface, variant: v, mode: "light", font: "1", state: "empty" });
    }
  }
  // handle drawer (for still + later motion), light standard
  jobs.push({ surface: "handle", variant: "tab", mode: "light", font: "1", state: "drawer" });
  jobs.push({ surface: "handle", variant: "tab", mode: "dark", font: "1", state: "drawer" });

  console.log(`shots planned: ${jobs.length}`);
  let i = 0;
  for (const j of jobs) {
    i += 1;
    const desktop = j.surface === "handle";
    const vp = desktop
      ? { width: 1920, height: 1080 }
      : (() => {
          const [pw, ph] = VIEW[j.surface][j.variant];
          return { width: Math.max(pw + 160, 720), height: Math.max(ph + 140, 560) };
        })();
    const context = await browser.newContext({
      viewport: vp,
      deviceScaleFactor: 2,
      colorScheme: j.mode,
      locale: "zh-CN",
    });
    const page = await context.newPage();
    const href = url({
      surface: j.surface,
      variant: j.variant,
      mode: j.mode,
      font: j.font,
      state: j.state,
      desktop: desktop ? "1" : "0",
    });
    const fontTag = j.font === "1.25" ? "f1.25" : "f1";
    const name = `${j.surface}-${j.variant}-${j.mode}-${fontTag}-${j.state}.png`;
    const dest = path.join(SINGLES, name);
    if (fs.existsSync(dest) && !process.env.RESHOT) {
      console.log(`  [${i}/${jobs.length}] ${name}  skip`);
      await context.close();
      continue;
    }
    await page.goto(href, { waitUntil: "networkidle" });
    await prepare(page);
    if (desktop) await shotDesktop(page, dest);
    else await shotPanel(page, j.surface, j.variant, dest);
    const st = fs.statSync(dest);
    console.log(`  [${i}/${jobs.length}] ${name}  ${(st.size / 1024).toFixed(0)}k`);
    await context.close();
  }

  // ---- motion clips ----
  async function recordClip(name, viewport, setup, act, durationMs) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1, // video at 1x is enough and smaller
      recordVideo: { dir: MOTION, size: viewport },
      colorScheme: "light",
      locale: "zh-CN",
    });
    const page = await context.newPage();
    await setup(page);
    await prepare(page);
    await sleep(200);
    await act(page);
    await sleep(durationMs);
    const vid = page.video();
    await context.close();
    const raw = await vid.path();
    const dest = path.join(MOTION, name);
    // move / rename; playwright names randomly
    fs.renameSync(raw, dest);
    console.log("  video", name);
  }

  // Quick glass pop
  try {
    await recordClip(
      "quick-glass-pop.webm",
      { width: 880, height: 660 },
      async (page) => {
        await page.goto(
          url({ surface: "quick", variant: "glass", mode: "light", font: "1", state: "results", enter: "0" }),
          { waitUntil: "networkidle" },
        );
      },
      async (page) => {
        await page.evaluate(() => {
          const el = document.querySelector(".v-quick");
          el?.classList.remove("is-enter");
          void el?.offsetWidth;
          el?.classList.add("is-enter");
        });
      },
      800,
    );
  } catch (e) {
    console.warn("pop video failed", e.message);
  }

  // Handle tab drawer slide
  try {
    await recordClip(
      "handle-tab-drawer.webm",
      { width: 1920, height: 1080 },
      async (page) => {
        await page.goto(
          url({ surface: "handle", variant: "tab", mode: "light", font: "1", state: "hover", desktop: "1" }),
          { waitUntil: "networkidle" },
        );
      },
      async (page) => {
        await page.evaluate(() => {
          const d = document.querySelector(".v-drawer");
          d?.classList.add("is-open");
        });
      },
      900,
    );
  } catch (e) {
    console.warn("drawer video failed", e.message);
  }

  await browser.close();
  console.log("shots done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
