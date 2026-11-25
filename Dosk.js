/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║         DOSK BOT — Core Engine & Dashboard Launcher             ║
 * ║         Copyright © 2026 DOSK — All rights reserved             ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */
"use strict";

const path = require("path");
const fs = require("fs");
const { startDashboard, interceptLogs, _bufferMsg } = require("./src/dashboard/server");

const ROOT = __dirname;
const CONFIG_PATH = path.join(ROOT, "config.json");
const PORT = parseInt(process.env.PORT || process.env.DASHBOARD_PORT || "5000", 10);

// Intercept terminal logs for the dashboard live log stream
interceptLogs();

// Global Bot State
global.DoskBot = {
  startTime: Date.now(),
  config: {},
  api: null,
  userID: null,
  status: "disconnected",
  lastError: null,
  commands: new Map()
};

function emitBotStatus(extra = {}) {
  try {
    const status = global.DoskBot?.status || (global.DoskBot?.api ? "connected" : "disconnected");
    const payload = {
      status,
      online: status === "connected",
      uid: global.DoskBot?.userID || null,
      botName: global.DoskBot?.config?.botName || "DOSK",
      error: global.DoskBot?.lastError || null,
      ts: Date.now(),
      ...extra,
    };
    if (typeof global._emitBotStatus === "function") global._emitBotStatus(payload);
  } catch (_) {}
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      global.DoskBot.config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    }
  } catch (_) {
    global.DoskBot.config = {
      botName: "DOSK",
      prefix: "/",
      ownerID: "61594321502697",
      adminBot: ["61594321502697"]
    };
  }
}
loadConfig();

// Load Cookies
function loadCookies() {
  const candidates = [
    path.join(ROOT, "cookies.json"),
    path.join(ROOT, "artifacts", "api-server", "cookies.json")
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try {
        const raw = fs.readFileSync(c, "utf8").replace(/^\uFEFF/, "");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) return parsed;
      } catch (_) {}
    }
  }
  return null;
}

function normalizeAppState(cookies) {
  if (!Array.isArray(cookies)) return [];
  return cookies.map(c => ({
    key: c.key || c.name,
    value: c.value,
    domain: c.domain || "facebook.com",
    path: c.path || "/",
    hostOnly: c.hostOnly ?? false,
    creation: c.creation || new Date().toISOString(),
    lastAccessed: c.lastAccessed || new Date().toISOString(),
  })).filter(c => c.key && typeof c.value !== "undefined");
}

function hasRequiredCookies(cookies) {
  const arr = Array.isArray(cookies) ? cookies : [];
  const hasCUser = arr.some(c => (c.key === "c_user" || c.name === "c_user") && c.value);
  const hasXs = arr.some(c => (c.key === "xs" || c.name === "xs") && c.value);
  return hasCUser && hasXs;
}

function stopCurrentApi() {
  const api = global.DoskBot?.api;
  global.DoskBot.api = null;
  global.DoskBot.userID = null;
  if (!api) return;
  try {
    if (typeof api.stopListening === "function") api.stopListening();
  } catch (_) {}
  try {
    if (typeof api.removeAllListeners === "function") api.removeAllListeners();
  } catch (_) {}
}

let _loginPromise = null;
let _loginSeq = 0;

// Start FCA Bot Engine
function startBot(options = {}) {
  const { cookies: inputCookies, force = false } = options || {};
  if (_loginPromise && !force) return _loginPromise;

  const seq = ++_loginSeq;
  _loginPromise = (async () => {
    let login = null;
    let loginLoadError = null;
    const fcaCandidates = ["ws3-fca", "@dongdev/fca-unofficial", "fca-unofficial"];
    const tryLoadFca = () => {
      const errors = [];
      for (const name of fcaCandidates) {
        try {
          const mod = require(name);
          const fn = mod?.login || mod?.default?.login || mod?.default || mod;
          if (typeof fn === "function") {
            console.log(`✅ [DOSK BOT] FCA loaded: ${name}`);
            return { fn, error: null, errors };
          }
          errors.push(`${name}: did not export a login function`);
        } catch (e) {
          errors.push(`${name}: ${e?.message || String(e)}`);
        }
      }
      return { fn: null, error: errors.join(" | "), errors };
    };

    let loaded = tryLoadFca();
    login = loaded.fn;
    loginLoadError = loaded.error;

    if (!login) {
      console.warn("⚠️ [DOSK BOT] FCA not found, attempting runtime install...");
      let installError = null;
      try {
        const { execSync } = require("child_process");
        execSync("npm install --omit=dev --legacy-peer-deps --no-audit --no-fund tough-cookie@4.1.4 ws3-fca@3.5.2", {
          cwd: ROOT,
          stdio: "pipe",
          timeout: 180000,
        });
        Object.keys(require.cache).forEach(k => { if (k.includes("ws3-fca") || k.includes("tough-cookie") || k.includes("axios-cookiejar-support") || k.includes("http-cookie-agent")) delete require.cache[k]; });
        try { const mc = require('module')._pathCache || {}; Object.keys(mc).forEach(k => { if (k.includes('ws3-fca') || k.includes('tough-cookie')) delete mc[k]; }); } catch (_) {}
      } catch (e) {
        installError = (e?.stderr?.toString?.() || e?.stdout?.toString?.() || e?.message || String(e)).slice(0, 500);
        console.error("❌ [DOSK BOT] Runtime FCA install failed:", installError);
      }
      loaded = tryLoadFca();
      login = loaded.fn;
      loginLoadError = [loaded.error, installError ? `install: ${installError}` : null].filter(Boolean).join(" | ");
    }

    const cookies = Array.isArray(inputCookies) && inputCookies.length ? inputCookies : loadCookies();
    if (!cookies) {
      stopCurrentApi();
      global.DoskBot.status = "disconnected";
      global.DoskBot.lastError = "ملف الكوكيز غير موجود";
      emitBotStatus();
      console.log("⚠️ [DOSK BOT] Cookies file not found yet. Use the dashboard to enter cookies.");
      return { ok: false, error: global.DoskBot.lastError };
    }

    if (!hasRequiredCookies(cookies)) {
      stopCurrentApi();
      global.DoskBot.status = "error";
      global.DoskBot.lastError = "كوكيز ناقصة (c_user أو xs مفقود)";
      emitBotStatus();
      console.log("❌ [DOSK BOT] Cookies missing c_user/xs.");
      return { ok: false, error: global.DoskBot.lastError };
    }

    if (!login || typeof login !== "function") {
      stopCurrentApi();
      global.DoskBot.status = "error";
      global.DoskBot.lastError = loginLoadError
        ? `حزمة FCA غير متاحة: ${loginLoadError}`
        : "حزمة FCA غير مثبتة";
      emitBotStatus();
      console.error("❌ [DOSK BOT] FCA unavailable:", loginLoadError || "not found");
      return { ok: false, error: global.DoskBot.lastError };
    }

    const appState = normalizeAppState(cookies);
    if (!appState.length) {
      stopCurrentApi();
      global.DoskBot.status = "error";
      global.DoskBot.lastError = "فشل تجهيز appState من الكوكيز";
      emitBotStatus();
      return { ok: false, error: global.DoskBot.lastError };
    }

    stopCurrentApi();
    global.DoskBot.status = "connecting";
    global.DoskBot.lastError = null;
    emitBotStatus();
    console.log("🚀 [DOSK BOT] Logging in to Facebook Messenger...");

    return await new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const timer = setTimeout(() => {
        if (settled) return;
        stopCurrentApi();
        global.DoskBot.status = "error";
        global.DoskBot.lastError = "انتهت مهلة تسجيل الدخول";
        emitBotStatus();
        console.error("❌ [DOSK BOT] Login timeout");
        finish({ ok: false, error: global.DoskBot.lastError });
      }, 45000);
      if (typeof timer.unref === "function") timer.unref();

      try {
        login(
          {
            appState,
            userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
            logLevel: "silent",
            forceLogin: true,
          },
          (err, api) => {
            clearTimeout(timer);
            if (seq !== _loginSeq) return finish({ ok: false, error: "تم بدء محاولة دخول أحدث" });
            if (err) {
              const msg = err?.error || err?.message || (typeof err === "string" ? err : JSON.stringify(err));
              stopCurrentApi();
              global.DoskBot.status = "error";
              global.DoskBot.lastError = String(msg || "فشل تسجيل الدخول");
              emitBotStatus();
              console.error("❌ [DOSK BOT] Login failed:", global.DoskBot.lastError);
              return finish({ ok: false, error: global.DoskBot.lastError });
            }

            try {
              global.DoskBot.api = api;
              global.DoskBot.userID = api.getCurrentUserID?.() || "bot";
              global.DoskBot.status = "connected";
              global.DoskBot.lastError = null;
              console.log(`✅ [DOSK BOT] Logged in successfully! User ID: ${global.DoskBot.userID}`);

              try {
                api.setOptions({
                  selfListen: false,
                  listenEvents: true,
                  autoMarkDelivery: false,
                  autoMarkRead: false,
                  logLevel: "silent",
                  forceLogin: true,
                });
              } catch (_) {}

              try {
                const refreshed = typeof api.getAppState === "function" ? api.getAppState() : null;
                if (Array.isArray(refreshed) && refreshed.length) {
                  fs.writeFileSync(path.join(ROOT, "cookies.json"), JSON.stringify(refreshed, null, 2), "utf8");
                  try { fs.writeFileSync(path.join(ROOT, "artifacts", "api-server", "cookies.json"), JSON.stringify(refreshed, null, 2), "utf8"); } catch (_) {}
                }
              } catch (_) {}

              const listen = api.listenMqtt || api.listen;
              if (typeof listen === "function") {
                listen.call(api, (listenErr, message) => {
                  if (seq !== _loginSeq) return;
                  if (listenErr) {
                    const lmsg = listenErr?.error || listenErr?.message || listenErr;
                    console.error("⚠️ [DOSK BOT] Listen error:", lmsg);
                    // Don't immediately kill on transient errors; mark disconnected only for fatal-looking ones
                    const fatal = typeof lmsg === "string" && /(not logged in|logged out|invalid appstate|login|checkpoint|session)/i.test(lmsg);
                    if (fatal) {
                      stopCurrentApi();
                      global.DoskBot.status = "error";
                      global.DoskBot.lastError = String(lmsg);
                      emitBotStatus();
                      setTimeout(() => {
                        if (seq === _loginSeq && global.DoskBot.status !== "connected") {
                          console.log("♻️ [DOSK BOT] محاولة إعادة الاتصال بعد خطأ جلسة...");
                          startBot({ force: true }).catch(() => {});
                        }
                      }, 15000);
                    }
                    return;
                  }
                  if (!message) return;
                  try { _bufferMsg(message); } catch (_) {}

                  // Handle group name protection
                  if (message.type === "event" && message.logMessageType === "log:thread-name") {
                    try {
                      const nmCmd = require("./src/commands/nm");
                      nmCmd.onEvent?.({ api, event: message });
                    } catch (_) {}
                  }
                });
              }

              emitBotStatus();
              finish({ ok: true, userID: global.DoskBot.userID });
            } catch (e) {
              stopCurrentApi();
              global.DoskBot.status = "error";
              global.DoskBot.lastError = e?.message || String(e);
              emitBotStatus();
              finish({ ok: false, error: global.DoskBot.lastError });
            }
          }
        );
      } catch (e) {
        clearTimeout(timer);
        stopCurrentApi();
        global.DoskBot.status = "error";
        global.DoskBot.lastError = e?.message || String(e);
        emitBotStatus();
        finish({ ok: false, error: global.DoskBot.lastError });
      }
    });
  })();

  const p = _loginPromise;
  p.finally(() => {
    if (_loginPromise === p) _loginPromise = null;
  });
  return p;
}

global.startBot = startBot;
global.DoskBot.startBot = startBot;
global.DoskBot.reloadCookies = async (newCookies) => {
  const cookies = Array.isArray(newCookies) ? newCookies : loadCookies();
  if (Array.isArray(newCookies) && newCookies.length) {
    const p = path.join(ROOT, "cookies.json");
    fs.writeFileSync(p, JSON.stringify(newCookies, null, 2), "utf8");
    try { fs.writeFileSync(path.join(ROOT, "artifacts", "api-server", "cookies.json"), JSON.stringify(newCookies, null, 2), "utf8"); } catch (_) {}
  }
  return await startBot({ cookies, force: true });
};
global.DoskBot.getStatus = () => ({
  status: global.DoskBot.status,
  online: global.DoskBot.status === "connected" && !!global.DoskBot.api,
  userID: global.DoskBot.userID,
  error: global.DoskBot.lastError,
  botName: global.DoskBot?.config?.botName || "DOSK",
});

async function main() {
  console.log("🌑 Starting DOSK BOT System...");
  await startDashboard(PORT);
  startBot();
}

main().catch(err => {
  console.error("Fatal error:", err);
});

