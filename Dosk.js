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
  commands: new Map()
};

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
        return JSON.parse(fs.readFileSync(c, "utf8"));
      } catch (_) {}
    }
  }
  return null;
}

// Start FCA Bot Engine
function startBot() {
  let login = null;
  try {
    const fca = require("ws3-fca");
    login = fca.login || fca;
  } catch (_) {
    try {
      const fca2 = require("@dongdev/fca-unofficial");
      login = fca2.login || fca2;
    } catch (_) {}
  }

  const cookies = loadCookies();
  if (!cookies) {
    console.log("⚠️ [DOSK BOT] Cookies file not found yet. Use the dashboard to enter cookies.");
    return;
  }

  if (!login) {
    console.log("ℹ️ [DOSK BOT] FCA package not installed locally. Dashboard is fully active.");
    return;
  }

  const appState = cookies.map(c => ({
    key: c.key || c.name,
    value: c.value,
    domain: c.domain || "facebook.com",
    path: c.path || "/",
    hostOnly: c.hostOnly ?? false,
    creation: c.creation || new Date().toISOString(),
    lastAccessed: c.lastAccessed || new Date().toISOString(),
  }));

  console.log("🚀 [DOSK BOT] Logging in to Facebook Messenger...");
  login(
    {
      appState,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      logLevel: "silent"
    },
    (err, api) => {
      if (err) {
        console.error("❌ [DOSK BOT] Login failed:", err.error || err.message || err);
        return;
      }
      global.DoskBot.api = api;
      global.DoskBot.userID = api.getCurrentUserID?.() || "bot";
      console.log(`✅ [DOSK BOT] Logged in successfully! User ID: ${global.DoskBot.userID}`);

      api.setOptions({
        selfListen: false,
        listenEvents: true,
        autoMarkDelivery: false,
        autoMarkRead: false,
        logLevel: "silent"
      });

      api.listenMqtt((listenErr, message) => {
        if (listenErr) return;
        if (!message) return;
        _bufferMsg(message);

        // Handle group name protection
        if (message.type === "event" && message.logMessageType === "log:thread-name") {
          const tid = String(message.threadID);
          const nmCmd = require("./src/commands/nm");
          nmCmd.onEvent?.({ api, event: message });
        }
      });
    }
  );
}

global.startBot = startBot;
global.DoskBot.startBot = startBot;
global.DoskBot.reloadCookies = (newCookies) => {
  const p = path.join(ROOT, "cookies.json");
  fs.writeFileSync(p, JSON.stringify(newCookies, null, 2), "utf8");
  startBot();
};

async function main() {
  console.log("🌑 Starting DOSK BOT System...");
  await startDashboard(PORT);
  startBot();
}

main().catch(err => {
  console.error("Fatal error:", err);
});

