// e2e IPC 桩：拦截 Tauri custom-protocol IPC 的 fetch（http://ipc.localhost/<cmd>）。
// 为什么不包 __TAURI_INTERNALS__.invoke：core.js 用 defineProperty 定义为不可写不可配置（spike 结论）。
// 只对 stubs 表里的命令返回伪造响应；其余直通真实后端。
(() => {
  if (window.__e2e) return;
  const e2e = {
    calls: [],
    toasts: [],
    errors: [],
    consoleErrors: [],
    stubs: {},
    stub(cmd, spec) { this.stubs[cmd] = spec; },
    unstub(cmd) { delete this.stubs[cmd]; },
    callsOf(cmd) { return this.calls.filter((c) => c.cmd === cmd); },
    clipboard: [],
  };
  // 剪贴板：记录写入而不改动用户真实剪贴板
  try {
    const clip = navigator.clipboard;
    Object.defineProperty(clip, "writeText", { configurable: true, value: async (t) => { e2e.clipboard.push(String(t)); } });
    Object.defineProperty(clip, "readText", { configurable: true, value: async () => e2e.clipboard[e2e.clipboard.length - 1] || "" });
  } catch {}
  // 默认桩：不访问 GitHub、不弹系统对话框、不打开外部程序
  const NO_UPDATE = { currentVersion: "", latestVersion: "0.0.0", hasUpdate: false, releaseUrl: "", releaseNotes: "", installerUrl: "", installerSize: 0 };
  const DEFAULTS = {
    update_check: { value: NO_UPDATE },
    "plugin:dialog|open": { value: null },
    "plugin:dialog|save": { value: null },
    "plugin:dialog|ask": { value: true },
    "plugin:dialog|confirm": { value: true },
    "plugin:dialog|message": { value: "Ok" },
    "plugin:shell|open": { value: null },
    "plugin:opener|open_url": { value: null },
    "plugin:opener|open_path": { value: null },
    "plugin:opener|reveal_item_in_dir": { value: null },
    // 这几个会拉起真实资源管理器/外部程序：一律桩掉，只断言调用参数
    open_in_explorer: { value: null },
    open_in_explorer_by_id: { value: null },
    open_object_path: { value: null },
  };
  Object.defineProperty(window, "__e2e", { value: e2e });
  window.addEventListener("taglauncher-toast", (e) => e2e.toasts.push({ ...(e.detail || {}), t: Date.now() }));
  window.addEventListener("error", (e) => e2e.errors.push(String(e.message || e)));
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    e2e.errors.push("unhandledrejection: " + String((r && (r.message || r)) || r));
  });
  const origConsoleError = console.error.bind(console);
  console.error = (...args) => {
    try { e2e.consoleErrors.push(args.map((a) => (a && a.message) || String(a)).join(" ")); } catch {}
    origConsoleError(...args);
  };

  const realFetch = window.fetch.bind(window);
  const IPC_PREFIX = "http://ipc.localhost/";
  function parseBody(body) {
    if (typeof body === "string") { try { return JSON.parse(body); } catch { return body; } }
    return body == null ? null : "[binary]";
  }
  function respond(ok, value) {
    const text = JSON.stringify(value === undefined ? null : value);
    return new Response(text, { status: 200, headers: { "Tauri-Response": ok ? "ok" : "error", "Content-Type": "application/json" } });
  }
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    if (url.startsWith(IPC_PREFIX)) {
      const cmd = decodeURIComponent(url.slice(IPC_PREFIX.length).split("?")[0]);
      const spec = Object.prototype.hasOwnProperty.call(e2e.stubs, cmd) ? e2e.stubs[cmd] : DEFAULTS[cmd];
      const rec = { cmd, t: Date.now(), stubbed: !!spec };
      rec.args = parseBody(init && init.body);
      e2e.calls.push(rec);
      if (spec) {
        let s = spec;
        if (Array.isArray(spec.queue)) {
          s = spec.queue.length > 1 ? spec.queue.shift() : spec.queue[0];
        }
        if (s.error !== undefined) return Promise.resolve(respond(false, s.error));
        if (s.passthrough) return realFetch(input, init);
        return Promise.resolve(respond(true, s.value));
      }
      return realFetch(input, init).then(async (r) => {
        rec.ok = r.headers.get("Tauri-Response") !== "error";
        if (!rec.ok) { try { rec.error = (await r.clone().text()).slice(0, 500); } catch {} }
        rec.done = Date.now();
        return r;
      });
    }
    return realFetch(input, init);
  };
})();
