/**
 * DOSK BOT — Dashboard Server (Express + Socket.io)
 * Copyright © 2026 DOSK
 * Features: Password Auth, Live Logs, Hot-reload Config, Command Editor,
 * Live Messenger, Group Control Panel, AddLock, AI Studio, GitHub/Railway Deployment (No APK)
 */
"use strict";

const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const os = require("os");
const vm = require("vm");

let socketio = null;
try {
  socketio = require("socket.io");
} catch (_) {}

const ROOT = path.resolve(__dirname, "../../");
const CONFIG_PATH = path.join(ROOT, "config.json");
const CMDS_DIR = path.join(ROOT, "src", "commands");
const EDIT_BACKUP_DIR = path.join(ROOT, ".editor-backups");

let _io = null;
let _server = null;
let _logBuf = [];
const MAX_LOG_BUF = 500;

const stats = {
  totalMessages: 0,
  totalCommands: 0,
  activeThreads: new Set(),
  activeUsers: new Set(),
  msgLog: [],
};

const _threadMsgs = new Map();
const _threadLastMsg = new Map();

function _addBotMsg(threadID, body, attachments) {
  const tid = String(threadID || "");
  if (!tid) return;
  if (!_threadMsgs.has(tid)) _threadMsgs.set(tid, []);
  const msgs = _threadMsgs.get(tid);
  const botID = String(global.DoskBot?.botID || global.GoatBot?.botID || "bot");
  const msgObj = {
    messageID: null,
    body: body || "",
    senderID: botID,
    senderName: global.DoskBot?.config?.botName || "DOSK",
    ts: Date.now(),
    attachments: attachments || [],
    isFromBot: true,
  };
  msgs.push(msgObj);
  if (msgs.length > 300) msgs.shift();
  _threadLastMsg.set(tid, { body: body || "", ts: Date.now(), senderID: botID, isFromBot: true });
  if (_io) _io.emit("messenger-msg", { ...msgObj, tid });
}
global._addBotMsg = _addBotMsg;

function _bufferMsg(event) {
  stats.totalMessages++;
  const tid = event.threadID ? String(event.threadID) : null;
  if (tid) stats.activeThreads.add(tid);
  if (event.senderID) stats.activeUsers.add(String(event.senderID));
  if (stats.msgLog.length >= 60) stats.msgLog.shift();
  stats.msgLog.push({
    body: (event.body || "").slice(0, 100),
    ts: Date.now(),
    tid: event.threadID,
    sid: event.senderID
  });

  if (tid && (event.body || (event.attachments && event.attachments.length))) {
    if (!_threadMsgs.has(tid)) _threadMsgs.set(tid, []);
    const msgs = _threadMsgs.get(tid);
    const msgObj = {
      messageID: event.messageID || null,
      body: event.body || "",
      senderID: String(event.senderID || ""),
      senderName: event.senderName || "",
      ts: Date.now(),
      attachments: (event.attachments || []).map(a => ({
        type: a.type,
        url: a.url,
        filename: a.filename
      })),
      isFromBot: false,
    };
    msgs.push(msgObj);
    if (msgs.length > 300) msgs.shift();
    _threadLastMsg.set(tid, {
      body: event.body || "",
      ts: Date.now(),
      senderID: event.senderID,
      isFromBot: false
    });
    if (_io) _io.emit("messenger-msg", { ...msgObj, tid });
  }

  if (_io) _io.emit("stats-update", getStats());
}

function _trackMsg(tid, uid, body) {
  const px = global.DoskBot?.config?.prefix || "/";
  if (body?.trimStart().startsWith(px)) stats.totalCommands++;
}
global._bufferMsg = _bufferMsg;
global._trackMsg = _trackMsg;

// ── Auth Token store ─────────────────────────────────────────────────────────
const _tokens = new Map();
function genToken() {
  const tok = crypto.randomBytes(24).toString("hex");
  _tokens.set(tok, Date.now() + 12 * 3600 * 1000);
  return tok;
}
function validToken(tok) {
  const exp = _tokens.get(tok);
  if (!exp) return false;
  if (Date.now() > exp) {
    _tokens.delete(tok);
    return false;
  }
  return true;
}
function getDashPwd() {
  if (process.env.DASHBOARD_PASSWORD?.trim()) return process.env.DASHBOARD_PASSWORD.trim();
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch (_) {
    return "dosk";
  }
  if (cfg.dashboard?.password) return cfg.dashboard.password;
  return "dosk";
}

// ── Safe Editor File Ops ─────────────────────────────────────────────────────
function safeEditorWrite(file, content) {
  fs.mkdirSync(EDIT_BACKUP_DIR, { recursive: true });
  if (fs.existsSync(file)) {
    const rel = path.relative(ROOT, file).replace(/[^a-zA-Z0-9._-]/g, "_");
    const backup = path.join(EDIT_BACKUP_DIR, `${rel}.${Date.now()}.bak`);
    fs.copyFileSync(file, backup);
    try {
      const backups = fs.readdirSync(EDIT_BACKUP_DIR).filter(x => x.startsWith(rel + ".")).sort();
      for (const old of backups.slice(0, -5)) {
        try { fs.unlinkSync(path.join(EDIT_BACKUP_DIR, old)); } catch (_) {}
      }
    } catch (_) {}
  }
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, file);
}

function validateCommandCode(code, filePath) {
  new vm.Script(code, { filename: filePath || "command.js" });
  return true;
}

// ── Live Log Interceptor ─────────────────────────────────────────────────────
function interceptLogs() {
  const origWrite = process.stdout.write.bind(process.stdout);
  const errWrite = process.stderr.write.bind(process.stderr);
  const push = (data) => {
    const line = String(data).replace(/\x1b\[[0-9;]*m/g, "").trimEnd();
    if (!line) return;
    if (_logBuf.length >= MAX_LOG_BUF) _logBuf.shift();
    _logBuf.push({ ts: Date.now(), line });
    if (_io) _io.emit("log-line", { ts: Date.now(), line });
  };
  process.stdout.write = function (chunk, ...args) {
    push(chunk);
    return origWrite(chunk, ...args);
  };
  process.stderr.write = function (chunk, ...args) {
    push(chunk);
    return errWrite(chunk, ...args);
  };
}

function getStats() {
  const upMs = Date.now() - (global.DoskBot?.startTime || Date.now());
  const mem = process.memoryUsage();
  const cmds = getRegisteredCommandsList();
  const api = global.DoskBot?.api || global.GoatBot?.fcaApi;
  const botID = global.DoskBot?.userID || global.GoatBot?.botID || null;
  return {
    uptime: upMs,
    totalMessages: stats.totalMessages,
    totalCommands: stats.totalCommands,
    activeThreads: stats.activeThreads.size,
    activeUsers: stats.activeUsers.size,
    commands: cmds.length,
    botID: botID,
    botName: global.DoskBot?.config?.botName || "DOSK",
    memMB: +(mem.heapUsed / 1048576).toFixed(1),
    prefix: global.DoskBot?.config?.prefix || "/",
    protection: 1,
    online: !!api,
  };
}

function getRegisteredCommandsList() {
  const list = [];
  if (fs.existsSync(CMDS_DIR)) {
    try {
      const files = fs.readdirSync(CMDS_DIR).filter(f => f.endsWith(".js"));
      for (const f of files) {
        try {
          const p = path.join(CMDS_DIR, f);
          delete require.cache[require.resolve(p)];
          const mod = require(p);
          if (mod?.config?.name) {
            list.push({
              name: mod.config.name,
              aliases: mod.config.aliases || [],
              category: mod.config.category || "combat",
              role: mod.config.role ?? 0,
              description: mod.config.description || "",
              version: mod.config.version || "1.0",
              author: mod.config.author || "DOSK"
            });
          }
        } catch (_) {}
      }
    } catch (_) {}
  }
  return list;
}

// ── Auth middleware ──────────────────────────────────────────────────────────
function auth(req, res, next) {
  const tok = req.headers["x-dosk-token"] || req.headers["x-david-token"] || req.query.token;
  if (tok && validToken(tok)) return next();
  res.status(401).json({ ok: false, error: "Unauthorized" });
}

// ── Control Panel Helper ─────────────────────────────────────────────────────
function callApi(api, method, args, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const fn = api?.[method];
    if (typeof fn !== "function") return reject(new Error(`${method} غير مدعوم`));
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err instanceof Error ? err : new Error(String(err.message || err)));
      else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error(`انتهت مهلة ${method}`)), timeoutMs);
    try {
      fn.call(api, ...args, (err, val) => finish(err, val));
    } catch (e) {
      finish(e);
    }
  });
}

async function getControlPanelRequests(api) {
  if (typeof api?.getThreadList !== "function") return { requests: [], warnings: ["getThreadList غير مدعوم"] };
  const folders = ["PENDING", "OTHER"];
  const results = await Promise.allSettled(folders.map(folder =>
    callApi(api, "getThreadList", [30, null, [folder]])
  ));

  const seen = new Set();
  const requests = [];
  const warnings = [];
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      warnings.push(`${folders[index]}: ${result.reason?.message || "تعذر الجلب"}`);
      return;
    }
    for (const thread of Array.isArray(result.value) ? result.value : []) {
      const tid = String(thread?.threadID || thread?.id || "");
      if (!/^\d+$/.test(tid) || seen.has(tid)) continue;
      seen.add(tid);
      requests.push({
        tid,
        name: thread.name || thread.threadName || `طلب ${tid}`,
        snippet: thread.snippet || thread.lastMessageSnippet || thread.lastMessage || "",
        ts: Number(thread.timestamp || thread.lastMessageTimestamp || 0),
        isGroup: !!thread.isGroup,
        folder: folders[index],
        imageSrc: thread.imageSrc || thread.image || null,
        participantCount: (thread.participantIDs || []).length,
      });
    }
  });
  return { requests, warnings };
}

async function acceptControlPanelRequest(api, tid) {
  if (typeof api?.sendMessage !== "function") throw new Error("sendMessage غير مدعوم");
  if (typeof api.markAsRead === "function") {
    await callApi(api, "markAsRead", [tid, true], 3000).catch(() => {});
  }
  await callApi(api, "sendMessage", [".", tid]);
  if (typeof api.markAsRead === "function") {
    await callApi(api, "markAsRead", [tid, true], 3000).catch(() => {});
  }
}

// ── AI Helper ────────────────────────────────────────────────────────────────
const AI_ACTIVE = new Set();
const AI_MAX_CONCURRENT = 2;
const AI_TIMEOUT_MS = 45000;

function _getAIProvider() {
  const forced = String(process.env.DASHBOARD_AI_PROVIDER || "auto").toLowerCase();
  if (forced === "anthropic" && process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (forced === "openai" && process.env.OPENAI_API_KEY) return "openai";
  if (forced === "groq" && process.env.GROQ_API_KEY) return "groq";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.GROQ_API_KEY) return "groq";
  return "free";
}

async function _callAI(systemPrompt, userMsg, history = [], maxTokens = 2000) {
  if (AI_ACTIVE.size >= AI_MAX_CONCURRENT) throw new Error("AI_BUSY");
  const job = `${Date.now()}-${Math.random()}`;
  AI_ACTIVE.add(job);
  try {
    const provider = _getAIProvider();
    const msgs = [];
    if (Array.isArray(history)) {
      for (const h of history.slice(-8)) {
        if (h?.role && h?.content) {
          msgs.push({
            role: h.role === "assistant" ? "assistant" : "user",
            content: String(h.content).slice(0, 8000)
          });
        }
      }
    }
    msgs.push({ role: "user", content: String(userMsg).slice(0, 30000) });

    if (provider === "anthropic") {
      try {
        const Anthropic = require("@anthropic-ai/sdk");
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const resp = await client.messages.create({
          model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
          max_tokens: Math.min(Number(maxTokens) || 2000, 12000),
          system: String(systemPrompt).slice(0, 20000),
          messages: msgs
        });
        return {
          text: (resp.content || []).map(x => x?.text || "").join("\n").trim(),
          provider: "anthropic"
        };
      } catch (err) {
        throw new Error(`Anthropic Error: ${err.message}`);
      }
    }

    if (provider === "openai" || provider === "groq") {
      const baseUrl = provider === "groq"
        ? "https://api.groq.com/openai/v1/chat/completions"
        : (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1/chat/completions");
      const apiKey = provider === "groq" ? process.env.GROQ_API_KEY : process.env.OPENAI_API_KEY;
      const model = provider === "groq"
        ? (process.env.GROQ_MODEL || "llama-3.3-70b-versatile")
        : (process.env.OPENAI_MODEL || "gpt-4o-mini");

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
      try {
        const r = await fetch(baseUrl, {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "system", content: systemPrompt }, ...msgs],
            max_tokens: Math.min(Number(maxTokens) || 2000, 12000)
          })
        });
        if (!r.ok) throw new Error(`${provider.toUpperCase()} ${r.status}`);
        const data = await r.json();
        return {
          text: data.choices?.[0]?.message?.content || "",
          provider
        };
      } finally {
        clearTimeout(timer);
      }
    }

    // Free AI fallback
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
    try {
      const r = await fetch(process.env.FREE_AI_URL || "https://text.pollinations.ai/", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "openai-large",
          messages: [{ role: "system", content: systemPrompt }, ...msgs],
          stream: false,
          private: true
        })
      });
      if (!r.ok) throw new Error(`Free AI ${r.status}`);
      return { text: (await r.text()).trim(), provider: "free" };
    } finally {
      clearTimeout(timer);
    }
  } finally {
    AI_ACTIVE.delete(job);
  }
}

// ── File Tree Helper ─────────────────────────────────────────────────────────
const ALLOWED_EXTS = new Set([
  ".js", ".ts", ".json", ".txt", ".md", ".html", ".css", ".env", ".toml", ".yml", ".yaml"
]);
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".cache", "dist", "build", "coverage", ".editor-backups", "attached_assets"
]);

function buildTree(dir, maxDepth = 6, depth = 0) {
  if (depth > maxDepth) return [];
  const items = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith(".") && e.name !== ".env") continue;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        const children = buildTree(path.join(dir, e.name), maxDepth, depth + 1);
        items.push({
          name: e.name,
          type: "dir",
          path: path.relative(ROOT, path.join(dir, e.name)),
          children
        });
      } else {
        const ext = path.extname(e.name).toLowerCase();
        if (!ALLOWED_EXTS.has(ext)) continue;
        items.push({
          name: e.name,
          type: "file",
          path: path.relative(ROOT, path.join(dir, e.name)),
          ext
        });
      }
    }
  } catch (_) {}
  return items.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// ── Dashboard Setup & Router ─────────────────────────────────────────────────
function setupDashboardRoutes(app) {
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));
  app.use(express.static(path.join(__dirname, "public")));

  // Health
  app.get("/health", (_, res) => res.json({ ok: true, bot: "DOSK", status: "running", ts: Date.now() }));
  app.get("/ping", (_, res) => res.send("pong"));

  // Auth
  app.post("/api/login", (req, res) => {
    const { password } = req.body || {};
    const dashboardPassword = getDashPwd();
    if (password === dashboardPassword) {
      const tok = genToken();
      res.json({ ok: true, token: tok });
    } else {
      res.json({ ok: false, error: "كلمة المرور غير صحيحة" });
    }
  });

  app.post("/api/logout", auth, (req, res) => {
    const tok = req.headers["x-dosk-token"] || req.headers["x-david-token"] || req.query.token;
    _tokens.delete(tok);
    res.json({ ok: true });
  });

  app.get("/api/auth-check", auth, (_, res) => res.json({ ok: true }));

  // Stats & Status
  app.get("/api/stats", auth, (_, res) => res.json(getStats()));
  app.get("/api/status", auth, (_, res) => {
    const api = global.DoskBot?.api || global.GoatBot?.fcaApi;
    const botID = global.DoskBot?.userID || global.GoatBot?.botID || null;
    res.json({
      ok: true,
      online: !!api,
      botID,
      botName: global.DoskBot?.config?.botName || "DOSK"
    });
  });

  // Config
  app.get("/api/config", auth, (_, res) => {
    try {
      let cfg = {};
      if (fs.existsSync(CONFIG_PATH)) {
        cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
      }
      res.json({ ok: true, config: cfg });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  app.post("/api/config", auth, (req, res) => {
    try {
      let old = {};
      if (fs.existsSync(CONFIG_PATH)) {
        old = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
      }
      const updated = Object.assign({}, old, req.body);
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2), "utf8");
      if (global.DoskBot) global.DoskBot.config = updated;
      if (_io) _io.emit("config-reloaded", { ts: Date.now() });
      res.json({ ok: true });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  // Cookies
  app.post("/api/cookies", auth, (req, res) => {
    const raw = req.body?.cookies;
    if (!raw) return res.json({ ok: false, error: "لا توجد بيانات كوكيز" });
    try {
      let parsed = [];
      if (typeof raw === "string") {
        const trimmed = raw.trim();
        if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
          parsed = JSON.parse(trimmed);
        } else if (trimmed.includes("c_user") && trimmed.includes("xs")) {
          // Parse cookie header string
          const parts = trimmed.split(";").map(p => p.trim());
          for (const p of parts) {
            const idx = p.indexOf("=");
            if (idx > 0) {
              parsed.push({
                key: p.slice(0, idx).trim(),
                value: p.slice(idx + 1).trim(),
                domain: "facebook.com",
                path: "/"
              });
            }
          }
        }
      } else if (Array.isArray(raw)) {
        parsed = raw;
      }

      if (!parsed.length) return res.json({ ok: false, error: "صيغة الكوكيز غير معروفة" });
      const hasCUser = parsed.some(c => (c.key === "c_user" || c.name === "c_user") && c.value);
      const hasXs = parsed.some(c => (c.key === "xs" || c.name === "xs") && c.value);
      if (!hasCUser || !hasXs) {
        return res.json({ ok: false, error: "كوكيز ناقصة (c_user أو xs مفقود)" });
      }

      const cookieCandidates = [
        path.join(ROOT, "cookies.json"),
        path.join(ROOT, "artifacts", "api-server", "cookies.json")
      ];
      for (const cp of cookieCandidates) {
        try {
          fs.writeFileSync(cp, JSON.stringify(parsed, null, 2), "utf8");
        } catch (_) {}
      }

      // Hot reload in bot if available
      try {
        if (typeof global.DoskBot?.reloadCookies === "function") {
          global.DoskBot.reloadCookies(parsed);
        } else if (typeof global.startBot === "function") {
          global.startBot();
        }
      } catch (_) {}

      res.json({ ok: true, count: parsed.length });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  // Admins
  app.get("/api/admins", auth, (_, res) => {
    try {
      let cfg = {};
      if (fs.existsSync(CONFIG_PATH)) cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
      res.json({
        ok: true,
        adminBot: cfg.adminBot || ["61594321502697"],
        superAdminBot: cfg.superAdminBot || ["61594321502697"],
        ownerID: cfg.ownerID || "61594321502697"
      });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  app.post("/api/admins", auth, (req, res) => {
    try {
      let cfg = {};
      if (fs.existsSync(CONFIG_PATH)) cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
      const { adminBot, superAdminBot, ownerID } = req.body;
      if (Array.isArray(adminBot)) cfg.adminBot = adminBot.map(String).filter(Boolean);
      if (Array.isArray(superAdminBot)) cfg.superAdminBot = superAdminBot.map(String).filter(Boolean);
      if (ownerID !== undefined) cfg.ownerID = String(ownerID).trim();
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
      if (global.DoskBot) global.DoskBot.config = cfg;
      if (_io) _io.emit("config-reloaded", { ts: Date.now() });
      res.json({ ok: true });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  // Bot Control
  app.post("/api/control", auth, (req, res) => {
    const { action } = req.body || {};
    if (action === "restart") {
      res.json({ ok: true });
      setTimeout(() => {
        try {
          if (typeof global.startBot === "function") global.startBot();
          else if (typeof global.DoskBot?.startBot === "function") global.DoskBot.startBot();
        } catch (_) {}
      }, 500);
    } else if (action === "stop") {
      res.json({ ok: true });
      setTimeout(() => process.exit(0), 500);
    } else {
      res.json({ ok: false, error: "إجراء غير معروف" });
    }
  });

  // Bot Lock & Silent Mode
  app.get("/api/bot-lock", auth, (_, res) => {
    res.json({
      ok: true,
      locked: !!global._botLocked,
      silent: !!global._silentMode
    });
  });

  app.post("/api/bot-lock", auth, (req, res) => {
    const { state } = req.body || {};
    global._botLocked = typeof state === "boolean" ? state : !global._botLocked;
    res.json({ ok: true, locked: global._botLocked });
  });

  app.post("/api/silent-mode", auth, (req, res) => {
    const { state } = req.body || {};
    global._silentMode = typeof state === "boolean" ? state : !global._silentMode;
    res.json({ ok: true, silent: global._silentMode });
  });

  // Engine Control (Storm / Combat)
  app.get("/api/engine/:tid", auth, (req, res) => {
    const tid = String(req.params.tid || "");
    try {
      const stormCmd = require("../commands/storm");
      return res.json({ ok: true, engine: stormCmd._dashboardControl("get", tid) });
    } catch (e) {
      return res.json({ ok: true, engine: { active: false, status: "idle", tid } });
    }
  });

  app.post("/api/engine/:tid", auth, (req, res) => {
    const tid = String(req.params.tid || "");
    const api = global.DoskBot?.api || global.GoatBot?.fcaApi;
    try {
      const stormCmd = require("../commands/storm");
      const state = stormCmd._dashboardControl(req.body?.action, tid, req.body, api);
      return res.json({ ok: true, engine: state });
    } catch (e) {
      return res.status(400).json({ ok: false, error: e.message });
    }
  });

  // Group Locks (NM / Nick)
  app.get("/api/ctrlpanel/groups/:tid/locks", auth, async (req, res) => {
    const tid = String(req.params.tid || "");
    const api = global.DoskBot?.api || global.GoatBot?.fcaApi;
    try {
      const nmCmd = require("../commands/nm");
      const nickCmd = require("../commands/nick");
      const [nm, nick] = await Promise.all([
        nmCmd._dashboardControl("get", tid, {}, api),
        nickCmd._dashboardControl("get", tid, {}, api)
      ]);
      return res.json({ ok: true, nm, nick });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/ctrlpanel/groups/:tid/nm", auth, async (req, res) => {
    const tid = String(req.params.tid || "");
    const api = global.DoskBot?.api || global.GoatBot?.fcaApi;
    try {
      const nmCmd = require("../commands/nm");
      const state = await nmCmd._dashboardControl(req.body?.action, tid, req.body || {}, api);
      return res.json({ ok: true, nm: state });
    } catch (e) {
      return res.status(400).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/ctrlpanel/groups/:tid/nick", auth, async (req, res) => {
    const tid = String(req.params.tid || "");
    const api = global.DoskBot?.api || global.GoatBot?.fcaApi;
    try {
      const nickCmd = require("../commands/nick");
      const state = await nickCmd._dashboardControl(req.body?.action, tid, req.body || {}, api);
      return res.json({ ok: true, nick: state });
    } catch (e) {
      return res.status(400).json({ ok: false, error: e.message });
    }
  });

  // Groups list
  app.get("/api/ctrlpanel/groups", auth, async (_, res) => {
    const api = global.DoskBot?.api || global.GoatBot?.fcaApi;
    const groups = [];
    const seen = new Set();

    if (api && typeof api.getThreadList === "function") {
      try {
        const threads = await callApi(api, "getThreadList", [50, null, ["INBOX"]], 12000);
        for (const t of Array.isArray(threads) ? threads : []) {
          if (t?.isGroup) {
            const tid = String(t.threadID || t.id);
            seen.add(tid);
            groups.push({
              tid,
              name: t.name || t.threadName || `مجموعة ${tid}`,
              memberCount: (t.participantIDs || []).length || 0,
              imageSrc: t.imageSrc || t.image || null
            });
          }
        }
      } catch (_) {}
    }

    for (const [tid, msgs] of _threadMsgs.entries()) {
      if (!seen.has(tid)) {
        groups.push({
          tid,
          name: `مجموعة ${tid}`,
          memberCount: 0,
          imageSrc: null
        });
      }
    }

    res.json({ ok: true, groups });
  });

  // Message Requests
  app.get("/api/ctrlpanel/message-requests", auth, async (_, res) => {
    const api = global.DoskBot?.api || global.GoatBot?.fcaApi;
    if (!api) return res.json({ ok: true, requests: [], warnings: ["البوت غير متصل"] });
    try {
      const result = await getControlPanelRequests(api);
      res.json({ ok: true, ...result });
    } catch (e) {
      res.json({ ok: false, error: e.message, requests: [] });
    }
  });

  app.post("/api/ctrlpanel/message-requests/accept", auth, async (req, res) => {
    const api = global.DoskBot?.api || global.GoatBot?.fcaApi;
    const tid = String(req.body?.tid || "").trim();
    if (!api) return res.status(503).json({ ok: false, error: "البوت غير متصل" });
    try {
      await acceptControlPanelRequest(api, tid);
      res.json({ ok: true, accepted: true });
    } catch (e) {
      res.status(502).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/ctrlpanel/message-requests/decline", auth, async (req, res) => {
    const api = global.DoskBot?.api || global.GoatBot?.fcaApi;
    const tid = String(req.body?.tid || "").trim();
    if (!api) return res.status(503).json({ ok: false, error: "البوت غير متصل" });
    const method = typeof api.deleteThread === "function" ? "deleteThread" : null;
    if (!method) return res.status(501).json({ ok: false, error: "deleteThread غير مدعوم" });
    try {
      await callApi(api, method, [tid]);
      res.json({ ok: true });
    } catch (e) {
      res.status(502).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/ctrlpanel/message-requests/accept-all", auth, async (_, res) => {
    const api = global.DoskBot?.api || global.GoatBot?.fcaApi;
    if (!api) return res.status(503).json({ ok: false, error: "البوت غير متصل" });
    try {
      const { requests } = await getControlPanelRequests(api);
      let accepted = 0;
      for (const r of requests) {
        try {
          await acceptControlPanelRequest(api, r.tid);
          accepted++;
        } catch (_) {}
        await new Promise(res => setTimeout(res, 300));
      }
      res.json({ ok: true, accepted });
    } catch (e) {
      res.status(502).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/ctrlpanel/message-requests/decline-all", auth, async (_, res) => {
    const api = global.DoskBot?.api || global.GoatBot?.fcaApi;
    if (!api) return res.status(503).json({ ok: false, error: "البوت غير متصل" });
    if (typeof api.deleteThread !== "function") return res.status(501).json({ ok: false, error: "deleteThread غير مدعوم" });
    try {
      const { requests } = await getControlPanelRequests(api);
      let declined = 0;
      for (const r of requests) {
        try {
          await callApi(api, "deleteThread", [r.tid]);
          declined++;
        } catch (_) {}
        await new Promise(res => setTimeout(res, 200));
      }
      res.json({ ok: true, declined });
    } catch (e) {
      res.status(502).json({ ok: false, error: e.message });
    }
  });

  // Messenger
  app.get("/api/messenger/threads", auth, async (_, res) => {
    const api = global.DoskBot?.api || global.GoatBot?.fcaApi;
    const threads = [];
    const seen = new Set();

    if (api && typeof api.getThreadList === "function") {
      try {
        const list = await callApi(api, "getThreadList", [40, null, ["INBOX"]], 10000);
        for (const t of Array.isArray(list) ? list : []) {
          const tid = String(t.threadID || t.id);
          seen.add(tid);
          const last = _threadLastMsg.get(tid);
          threads.push({
            tid,
            name: t.name || t.threadName || `محادثة ${tid}`,
            type: t.isGroup ? "group" : "dm",
            memberCount: (t.participantIDs || []).length || 0,
            lastBody: last?.body || t.snippet || "",
            lastTs: last?.ts || Number(t.timestamp || 0),
            lastIsFromBot: last?.isFromBot || false
          });
        }
      } catch (_) {}
    }

    for (const [tid, msgs] of _threadMsgs.entries()) {
      if (!seen.has(tid)) {
        const last = _threadLastMsg.get(tid);
        threads.push({
          tid,
          name: `محادثة ${tid}`,
          type: "group",
          memberCount: 0,
          lastBody: last?.body || "",
          lastTs: last?.ts || 0,
          lastIsFromBot: last?.isFromBot || false
        });
      }
    }

    threads.sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));
    res.json({ ok: true, threads });
  });

  app.get("/api/messenger/thread/:tid/messages", auth, (req, res) => {
    const tid = String(req.params.tid);
    const msgs = _threadMsgs.get(tid) || [];
    res.json({ ok: true, messages: msgs.slice(-100) });
  });

  app.get("/api/messenger/thread/:tid/info", auth, (req, res) => {
    const api = global.DoskBot?.api || global.GoatBot?.fcaApi;
    if (!api) return res.json({ ok: false, error: "البوت غير متصل" });
    const fn = api.getThreadInfo || api.getThreadInfoByID;
    if (!fn) return res.json({ ok: false, error: "getThreadInfo غير مدعوم" });
    fn.call(api, req.params.tid, (err, info) => {
      if (err) return res.json({ ok: false, error: err.message });
      res.json({ ok: true, info });
    });
  });

  app.post("/api/messenger/send", auth, (req, res) => {
    const api = global.DoskBot?.api || global.GoatBot?.fcaApi;
    if (!api) return res.json({ ok: false, error: "البوت غير متصل" });
    const { threadID, body, silent } = req.body || {};
    if (!threadID || !body) return res.json({ ok: false, error: "threadID و body مطلوبان" });
    const msg = { body: String(body) };
    if (silent) msg.noNotif = true;
    api.sendMessage(msg, String(threadID), (err, info) => {
      if (err) return res.json({ ok: false, error: err.message });
      _addBotMsg(threadID, body);
      res.json({ ok: true, messageID: info?.messageID });
    });
  });

  app.post("/api/messenger/send-file", auth, async (req, res) => {
    const api = global.DoskBot?.api || global.GoatBot?.fcaApi;
    if (!api) return res.json({ ok: false, error: "البوت غير متصل" });
    const { threadID, data, filename, caption } = req.body || {};
    if (!threadID || !data) return res.json({ ok: false, error: "threadID و data مطلوبان" });
    const safeName = (filename || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
    const tmpPath = path.join(os.tmpdir(), `dosk-${Date.now()}-${safeName}`);
    try {
      fs.writeFileSync(tmpPath, Buffer.from(data, "base64"));
      const stream = fs.createReadStream(tmpPath);
      const msg = caption ? { body: String(caption), attachment: stream } : { attachment: stream };
      api.sendMessage(msg, String(threadID), (err, info) => {
        try { fs.unlinkSync(tmpPath); } catch (_) {}
        if (err) return res.json({ ok: false, error: err.message });
        _addBotMsg(threadID, caption || `[ملف: ${filename || "file"}]`);
        res.json({ ok: true, messageID: info?.messageID });
      });
    } catch (e) {
      try { fs.unlinkSync(tmpPath); } catch (_) {}
      res.json({ ok: false, error: e.message });
    }
  });

  app.post("/api/messenger/send-with-caption", auth, async (req, res) => {
    const api = global.DoskBot?.api || global.GoatBot?.fcaApi;
    if (!api) return res.json({ ok: false, error: "البوت غير متصل" });
    const { threadID, data, filename, caption } = req.body || {};
    const safeName = (filename || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
    const tmpPath = path.join(os.tmpdir(), `dosk-${Date.now()}-${safeName}`);
    try {
      fs.writeFileSync(tmpPath, Buffer.from(data, "base64"));
      const stream = fs.createReadStream(tmpPath);
      const msg = caption ? { body: String(caption), attachment: stream } : { attachment: stream };
      api.sendMessage(msg, String(threadID), (err, info) => {
        try { fs.unlinkSync(tmpPath); } catch (_) {}
        if (err) return res.json({ ok: false, error: err.message });
        _addBotMsg(threadID, caption || `[ملف: ${filename || "file"}]`);
        res.json({ ok: true, messageID: info?.messageID });
      });
    } catch (e) {
      try { fs.unlinkSync(tmpPath); } catch (_) {}
      res.json({ ok: false, error: e.message });
    }
  });

  app.post("/api/messenger/set-title", auth, (req, res) => {
    const api = global.DoskBot?.api || global.GoatBot?.fcaApi;
    if (!api) return res.json({ ok: false, error: "البوت غير متصل" });
    const { threadID, title } = req.body;
    api.setTitle(String(title), String(threadID), (err) => {
      if (err) return res.json({ ok: false, error: err.message });
      res.json({ ok: true });
    });
  });

  app.post("/api/messenger/set-nick", auth, (req, res) => {
    const api = global.DoskBot?.api || global.GoatBot?.fcaApi;
    if (!api) return res.json({ ok: false, error: "البوت غير متصل" });
    const { threadID, userID, nickname } = req.body;
    api.changeNickname(String(nickname || ""), String(threadID), String(userID), (err) => {
      if (err) return res.json({ ok: false, error: err.message });
      res.json({ ok: true });
    });
  });

  app.post("/api/messenger/set-bot-nick-all", auth, async (req, res) => {
    const api = global.DoskBot?.api || global.GoatBot?.fcaApi;
    if (!api) return res.json({ ok: false, error: "البوت غير متصل" });
    const { nickname } = req.body;
    const botID = api.getCurrentUserID?.() || global.DoskBot?.userID;
    if (!botID) return res.json({ ok: false, error: "تعذر الحصول على ID البوت" });
    const threads = [..._threadMsgs.keys()];
    let success = 0, failed = 0;
    for (const tid of threads) {
      try {
        await new Promise((resolve) => {
          api.changeNickname(String(nickname), String(tid), String(botID), (err) => {
            if (err) failed++; else success++;
            resolve();
          });
        });
        await new Promise(r => setTimeout(r, 200));
      } catch (_) { failed++; }
    }
    res.json({ ok: true, total: threads.length, success, failed });
  });

  app.post("/api/messenger/set-image", auth, async (req, res) => {
    const api = global.DoskBot?.api || global.GoatBot?.fcaApi;
    if (!api) return res.json({ ok: false, error: "البوت غير متصل" });
    const { threadID, data } = req.body;
    const tmpPath = path.join(os.tmpdir(), `dosk-img-${Date.now()}.jpg`);
    try {
      fs.writeFileSync(tmpPath, Buffer.from(data, "base64"));
      const stream = fs.createReadStream(tmpPath);
      const fn = api.changeGroupImage || api.setGroupImage;
      if (!fn) return res.json({ ok: false, error: "changeGroupImage غير مدعوم" });
      fn.call(api, stream, String(threadID), (err) => {
        try { fs.unlinkSync(tmpPath); } catch (_) {}
        if (err) return res.json({ ok: false, error: err.message });
        res.json({ ok: true });
      });
    } catch (e) {
      try { fs.unlinkSync(tmpPath); } catch (_) {}
      res.json({ ok: false, error: e.message });
    }
  });

  app.post("/api/messenger/kick", auth, (req, res) => {
    const api = global.DoskBot?.api || global.GoatBot?.fcaApi;
    if (!api) return res.json({ ok: false, error: "البوت غير متصل" });
    const { threadID, userID } = req.body;
    api.removeUserFromGroup(String(userID), String(threadID), (err) => {
      if (err) return res.json({ ok: false, error: err.message });
      res.json({ ok: true });
    });
  });

  app.post("/api/messenger/add-member", auth, (req, res) => {
    const api = global.DoskBot?.api || global.GoatBot?.fcaApi;
    if (!api) return res.json({ ok: false, error: "البوت غير متصل" });
    const { threadID, userID } = req.body;
    api.addUserToGroup(String(userID), String(threadID), (err) => {
      if (err) return res.json({ ok: false, error: err.message });
      res.json({ ok: true });
    });
  });

  // Commands Management
  app.get("/api/commands", auth, (_, res) => {
    res.json({ ok: true, commands: getRegisteredCommandsList() });
  });

  app.post("/api/commands/new", auth, (req, res) => {
    try {
      const rawName = String(req.body?.name || "").trim().toLowerCase();
      const name = rawName.replace(/[^a-z0-9_-]/g, "");
      if (!name || name.length < 2) return res.json({ ok: false, error: "اسم الأمر غير صالح" });
      const file = path.join(CMDS_DIR, `${name}.js`);
      if (fs.existsSync(file)) return res.json({ ok: false, error: "هذا الأمر موجود بالفعل" });
      const template = `/**\n * DOSK BOT — /${name}\n * Copyright © 2026 DOSK\n */\n"use strict";\n\nmodule.exports = {\n  config: {\n    name: "${name}",\n    aliases: [],\n    version: "1.0",\n    author: "DOSK",\n    countDown: 3,\n    role: 0,\n    category: "combat",\n    description: "وصف أمر ${name}",\n    guide: { en: "/${name}" }\n  },\n\n  onStart: async function ({ api, event, args, message }) {\n    await message.reply("مرحباً من /${name} — 𝐃𝐎𝐒𝐊 ⚔️");\n  }\n};\n`;
      safeEditorWrite(file, template);
      if (_io) _io.emit("command-updated", { name });
      res.json({ ok: true, name, code: template, message: `✅ تم إنشاء /${name}` });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  app.get("/api/commands/:name/source", auth, (req, res) => {
    const name = req.params.name.toLowerCase().replace(/[^a-z0-9_-]/g, "");
    const file = path.join(CMDS_DIR, `${name}.js`);
    if (!fs.existsSync(file)) return res.json({ ok: false, error: "الأمر غير موجود" });
    try {
      const code = fs.readFileSync(file, "utf8");
      res.json({ ok: true, name, code });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  app.post("/api/commands/:name/source", auth, (req, res) => {
    const name = req.params.name.toLowerCase().replace(/[^a-z0-9_-]/g, "");
    const { code } = req.body;
    if (!code || typeof code !== "string") return res.json({ ok: false, error: "الكود فارغ" });
    const file = path.join(CMDS_DIR, `${name}.js`);
    const oldCode = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    try {
      validateCommandCode(code, file);
    } catch (syntaxErr) {
      return res.json({ ok: false, error: "خطأ في JavaScript: " + syntaxErr.message });
    }
    try {
      safeEditorWrite(file, code);
      if (_io) _io.emit("command-updated", { name });
      res.json({ ok: true, message: `✅ تم تحديث أمر /${name} بدون إعادة تشغيل` });
    } catch (e) {
      if (oldCode !== null) safeEditorWrite(file, oldCode);
      res.json({ ok: false, error: e.message });
    }
  });

  app.post("/api/commands/:name/update-meta", auth, (req, res) => {
    const nameParam = req.params.name.toLowerCase().replace(/[^a-z0-9_-]/g, "");
    const { newName, aliases, description, role, guide } = req.body;
    const file = path.join(CMDS_DIR, `${nameParam}.js`);
    if (!fs.existsSync(file)) return res.json({ ok: false, error: "الأمر غير موجود" });
    try {
      let code = fs.readFileSync(file, "utf8");
      if (newName && newName !== nameParam) {
        code = code.replace(/name:\s*["']([^"']+)["']/, `name: "${newName}"`);
      }
      if (Array.isArray(aliases)) {
        code = code.replace(/aliases:\s*\[([^\]]*)\]/, `aliases: ${JSON.stringify(aliases)}`);
      }
      if (description) {
        code = code.replace(/description:\s*["']([^"']*)["']/, `description: "${description.replace(/"/g, '\\"')}"`);
      }
      if (role !== undefined) {
        code = code.replace(/role:\s*\d/, `role: ${parseInt(role) || 0}`);
      }
      if (guide) {
        code = code.replace(/guide:\s*\{[^}]*\}/, `guide: { en: "${guide.replace(/"/g, '\\"').replace(/\n/g, '\\n')}" }`);
      }
      safeEditorWrite(file, code);
      if (_io) _io.emit("command-updated", { name: newName || nameParam });
      res.json({ ok: true, message: "✅ تم تحديث بيانات الأمر بنجاح" });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  // Thread Commands (Activation)
  app.get("/api/thread-commands", auth, (_, res) => {
    try {
      const ctrl = require("../utils/cmdControl");
      ctrl.reload();
      res.json({ ok: true, data: ctrl.getAll() });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  app.get("/api/thread-commands/:tid", auth, (req, res) => {
    try {
      const ctrl = require("../utils/cmdControl");
      res.json({ ok: true, config: ctrl.getThreadConfig(req.params.tid) });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  app.post("/api/thread-commands/:tid", auth, (req, res) => {
    try {
      const ctrl = require("../utils/cmdControl");
      const { mode, commands: cmds } = req.body;
      ctrl.setThreadConfig(req.params.tid, { mode, commands: Array.isArray(cmds) ? cmds : [] });
      res.json({ ok: true });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  app.delete("/api/thread-commands/:tid", auth, (req, res) => {
    try {
      const ctrl = require("../utils/cmdControl");
      ctrl.resetThread(req.params.tid);
      res.json({ ok: true });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  // Messages & Logs
  app.get("/api/messages", auth, (_, res) => {
    res.json({ ok: true, messages: [...stats.msgLog].reverse().slice(0, 40) });
  });

  app.get("/api/logs", auth, (_, res) => {
    res.json({ ok: true, logs: _logBuf.slice(-200) });
  });

  // AI Studio
  app.get("/api/ai/provider", auth, (_, res) => {
    const p = _getAIProvider();
    const names = {
      anthropic: "Claude API (Anthropic)",
      openai: "OpenAI API",
      groq: "Groq LLaMA",
      free: "Free AI fallback"
    };
    res.json({ ok: true, provider: p, name: names[p] });
  });

  app.post("/api/ai/generate", auth, async (req, res) => {
    try {
      const { description, contextFiles } = req.body || {};
      if (!description) return res.json({ ok: false, error: "الوصف مطلوب" });

      let contextContent = "";
      if (Array.isArray(contextFiles) && contextFiles.length) {
        for (const rel of contextFiles.slice(0, 5)) {
          try {
            const full = path.join(ROOT, rel);
            if (full.startsWith(ROOT) && fs.existsSync(full)) {
              contextContent += `\n\n// === ملف السياق: ${rel} ===\n${fs.readFileSync(full, "utf8").slice(0, 3000)}`;
            }
          } catch (_) {}
        }
      }

      const systemPrompt = `أنت مطور خبير في Node.js وبوتات فيسبوك ماسنجر لنظام DOSK BOT.
مهمتك كتابة أمر JavaScript كامل للبوت وفق البنية التالية:
\`\`\`js
"use strict";
module.exports = {
  config: {
    name: "command_name",
    aliases: [],
    version: "1.0",
    author: "DOSK",
    countDown: 3,
    role: 0,
    category: "combat",
    description: "وصف الأمر",
    guide: { en: "/command_name" }
  },
  onStart: async function({ api, event, args, message }) {
    await message.reply("الرد هنا");
  }
};
\`\`\`
اكتب كود JavaScript صالحاً فقط بدون markdown fences أو شروحات.`;

      const result = await _callAI(systemPrompt, description, [], 2500);
      let code = result.text;
      const match = code.match(/```(?:javascript|js)?\n?([\s\S]+?)```/);
      if (match) code = match[1].trim();

      res.json({ ok: true, code, provider: result.provider });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  app.post("/api/ai/chat", auth, async (req, res) => {
    try {
      const { message: userMsg, history } = req.body || {};
      if (!userMsg) return res.json({ ok: false, error: "الرسالة مطلوبة" });
      const result = await _callAI(
        "أنت مساعد ذكي ومطور خبير في بوت DOSK ونظام فيسبوك ماسنجر. أجب باللغة العربية باختصار ودقة.",
        userMsg,
        history || [],
        1200
      );
      res.json({ ok: true, reply: result.text, provider: result.provider });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  app.post("/api/ai/edit-command", auth, async (req, res) => {
    try {
      const { name, code, instruction } = req.body || {};
      if (!name || !code || !instruction) return res.json({ ok: false, error: "البيانات ناقصة" });
      const safeName = String(name).toLowerCase().replace(/[^a-z0-9_-]/g, "");
      const systemPrompt = `أنت مهندس صيانة لـ DOSK BOT. عدّل كود JavaScript المعطى حسب طلب المستخدم. حافظ على الوظائف الأصلية ما لم يُطلب حذفها. أعد الكود كاملاً وصالحاً للتشغيل فقط بدون شروحات.`;
      const result = await _callAI(systemPrompt, `الأمر: /${safeName}\n\nالطلب: ${instruction}\n\nالكود الحالي:\n${code}`, [], 3000);
      let edited = String(result.text || "").trim();
      const match = edited.match(/```(?:javascript|js)?\s*([\s\S]+?)```/i);
      if (match) edited = match[1].trim();
      validateCommandCode(edited, path.join(CMDS_DIR, `${safeName}.js`));
      res.json({ ok: true, code: edited, provider: result.provider });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  app.post("/api/ai/save-command", auth, (req, res) => {
    try {
      const { name, code } = req.body || {};
      const safeName = String(name || "").toLowerCase().replace(/[^a-z0-9_-]/g, "");
      if (!safeName || !code) return res.json({ ok: false, error: "name و code مطلوبان" });
      const file = path.join(CMDS_DIR, `${safeName}.js`);
      validateCommandCode(code, file);
      safeEditorWrite(file, code);
      if (_io) _io.emit("command-updated", { name: safeName });
      res.json({ ok: true, message: `✅ تم حفظ أمر /${safeName} بنجاح` });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  // File Browser
  app.get("/api/files/tree", auth, (_, res) => {
    try {
      const tree = buildTree(ROOT);
      res.json({ ok: true, tree });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  app.get("/api/files/read", auth, (req, res) => {
    try {
      const rel = req.query.path || "";
      if (!rel || rel.includes("..")) return res.json({ ok: false, error: "مسار غير صالح" });
      const full = path.join(ROOT, rel);
      if (!full.startsWith(ROOT)) return res.json({ ok: false, error: "مسار خارج النطاق" });
      if (!fs.existsSync(full)) return res.json({ ok: false, error: "الملف غير موجود" });
      const stat = fs.statSync(full);
      if (stat.size > 1024 * 1024) return res.json({ ok: false, error: "الملف كبير جداً" });
      const content = fs.readFileSync(full, "utf8");
      res.json({ ok: true, content, path: rel, size: stat.size });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  app.post("/api/files/write", auth, (req, res) => {
    try {
      const { path: rel, content } = req.body || {};
      if (!rel || rel.includes("..")) return res.json({ ok: false, error: "مسار غير صالح" });
      const full = path.join(ROOT, rel);
      if (!full.startsWith(ROOT)) return res.json({ ok: false, error: "مسار خارج النطاق" });
      fs.mkdirSync(path.dirname(full), { recursive: true });
      safeEditorWrite(full, String(content || ""));
      res.json({ ok: true });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  app.post("/api/files/new", auth, (req, res) => {
    try {
      const { path: rel, isDir } = req.body || {};
      if (!rel || rel.includes("..")) return res.json({ ok: false, error: "مسار غير صالح" });
      const full = path.join(ROOT, rel);
      if (!full.startsWith(ROOT)) return res.json({ ok: false, error: "مسار خارج النطاق" });
      if (isDir) {
        fs.mkdirSync(full, { recursive: true });
      } else {
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, "", "utf8");
      }
      res.json({ ok: true });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  app.delete("/api/files/delete", auth, (req, res) => {
    try {
      const rel = req.query.path || "";
      if (!rel || rel.includes("..")) return res.json({ ok: false, error: "مسار غير صالح" });
      const full = path.join(ROOT, rel);
      if (!full.startsWith(ROOT)) return res.json({ ok: false, error: "مسار خارج النطاق" });
      if (!fs.existsSync(full)) return res.json({ ok: false, error: "الملف غير موجود" });
      fs.rmSync(full, { recursive: true, force: true });
      res.json({ ok: true });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  // GitHub & Railway (NO APK)
  app.get("/api/github/repo-info", auth, async (req, res) => {
    try {
      const { token, repo } = req.query;
      if (!repo) return res.json({ ok: false, error: "اسم الريبو مطلوب" });
      const headers = { "User-Agent": "DOSK-BOT", Accept: "application/vnd.github.v3+json" };
      if (token) headers["Authorization"] = `token ${token}`;
      const r = await fetch(`https://api.github.com/repos/${repo}`, { headers });
      if (!r.ok) return res.json({ ok: false, error: `GitHub API: ${r.status} ${r.statusText}` });
      const info = await r.json();
      res.json({ ok: true, info });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  app.post("/api/env/set", auth, (req, res) => {
    try {
      const { pairs } = req.body || {};
      if (!pairs || typeof pairs !== "object") return res.json({ ok: false, error: "pairs مطلوب" });
      const envPath = path.join(ROOT, ".env");
      let content = "";
      try { content = fs.readFileSync(envPath, "utf8"); } catch (_) {}
      const lines = content.split("\n");
      for (const [key, val] of Object.entries(pairs)) {
        if (!val) continue;
        process.env[key] = val;
        const idx = lines.findIndex(l => l.startsWith(key + "="));
        if (idx >= 0) lines[idx] = `${key}=${val}`;
        else lines.push(`${key}=${val}`);
      }
      fs.writeFileSync(envPath, lines.filter(Boolean).join("\n") + "\n", "utf8");
      res.json({ ok: true });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  app.post("/api/github/push", auth, async (req, res) => {
    const log = [];
    const L = (msg, type = "info") => { log.push({ msg, type }); };
    try {
      const { token, repo, message = "🤖 DOSK BOT — Auto Update" } = req.body || {};
      if (!token || !repo) return res.json({ ok: false, error: "Token و Repo مطلوبان", log });

      const ghHeaders = {
        Authorization: `token ${token}`,
        "User-Agent": "DOSK-BOT",
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json"
      };

      L("🔑 التحقق من حساب GitHub…", "info");
      const userRes = await fetch("https://api.github.com/user", { headers: ghHeaders });
      if (!userRes.ok) return res.json({ ok: false, error: "توكن GitHub غير صالح", log });
      const user = await userRes.json();
      L(`✅ مسجل كـ: ${user.login}`, "ok");

      L(`📡 فحص المستودع: ${repo}…`, "info");
      const repoRes = await fetch(`https://api.github.com/repos/${repo}`, { headers: ghHeaders });
      if (!repoRes.ok) return res.json({ ok: false, error: `المستودع غير متاح: ${repoRes.status}`, log });
      const repoInfo = await repoRes.json();
      const defaultBranch = repoInfo.default_branch || "main";

      const refRes = await fetch(`https://api.github.com/repos/${repo}/git/refs/heads/${defaultBranch}`, { headers: ghHeaders });
      let latestSha = null;
      let baseTreeSha = null;
      if (refRes.ok) {
        const refData = await refRes.json();
        latestSha = refData.object?.sha;
        if (latestSha) {
          const commitRes = await fetch(`https://api.github.com/repos/${repo}/git/commits/${latestSha}`, { headers: ghHeaders });
          if (commitRes.ok) {
            const cd = await commitRes.json();
            baseTreeSha = cd.tree?.sha;
          }
        }
      }

      // Collect Bot files strictly (NO APK)
      const filesToPush = [];
      const skipPatterns = [
        ".git", "node_modules", ".editor-backups", ".env", "*.log", "tmp", ".DS_Store", "coverage", "dist/"
      ];
      const shouldSkip = (p) => skipPatterns.some(s => {
        if (s.endsWith("/")) return p.startsWith(s);
        if (s.startsWith("*.")) return p.endsWith(s.slice(1));
        return p === s || p.includes("/" + s + "/") || p.includes("/" + s);
      });

      const collectFiles = (dir, base = "") => {
        try {
          const entries = fs.readdirSync(dir);
          for (const e of entries) {
            const full = path.join(dir, e);
            const rel = base ? base + "/" + e : e;
            if (shouldSkip(rel) || shouldSkip(e)) continue;
            const stat = fs.statSync(full);
            if (stat.isDirectory()) collectFiles(full, rel);
            else if (stat.size < 500000) filesToPush.push({ path: rel, fullPath: full });
          }
        } catch (_) {}
      };

      // Collect source files
      ["src", "artifacts", "package.json", "config.json", "tsconfig.json"].forEach(f => {
        const full = path.join(ROOT, f);
        if (!fs.existsSync(full)) return;
        if (fs.statSync(full).isDirectory()) collectFiles(full, f);
        else filesToPush.push({ path: f, fullPath: full });
      });

      L(`📦 إجمالي الملفات المعالجة: ${filesToPush.length}`, "info");
      const treeItems = [];
      for (const f of filesToPush) {
        try {
          const content = fs.readFileSync(f.fullPath);
          const blobRes = await fetch(`https://api.github.com/repos/${repo}/git/blobs`, {
            method: "POST",
            headers: ghHeaders,
            body: JSON.stringify({ content: content.toString("base64"), encoding: "base64" })
          });
          if (blobRes.ok) {
            const blob = await blobRes.json();
            treeItems.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
          }
        } catch (_) {}
      }

      L(`🌳 إنشاء شجرة الملفات (${treeItems.length} عنصر)…`, "info");
      const treeBody = { tree: treeItems };
      if (baseTreeSha) treeBody.base_tree = baseTreeSha;
      const treeRes = await fetch(`https://api.github.com/repos/${repo}/git/trees`, {
        method: "POST",
        headers: ghHeaders,
        body: JSON.stringify(treeBody)
      });
      if (!treeRes.ok) return res.json({ ok: false, error: "فشل إنشاء tree", log });
      const tree = await treeRes.json();

      L("📝 حفظ التغييرات (Commit)…", "info");
      const commitRes2 = await fetch(`https://api.github.com/repos/${repo}/git/commits`, {
        method: "POST",
        headers: ghHeaders,
        body: JSON.stringify({ message, tree: tree.sha, parents: latestSha ? [latestSha] : [] })
      });
      if (!commitRes2.ok) return res.json({ ok: false, error: "فشل إنشاء Commit", log });
      const newCommit = await commitRes2.json();

      L("🔄 تحديث الفرع…", "info");
      const updateBody = { sha: newCommit.sha, force: true };
      const refUpdateRes = await fetch(`https://api.github.com/repos/${repo}/git/refs/heads/${defaultBranch}`, {
        method: "PATCH",
        headers: ghHeaders,
        body: JSON.stringify(updateBody)
      });
      if (!refUpdateRes.ok) return res.json({ ok: false, error: "فشل تحديث الفرع", log });

      L(`🎉 تم الرفع بنجاح! Commit: ${newCommit.sha.slice(0, 7)}`, "ok");
      res.json({ ok: true, sha: newCommit.sha, files: treeItems.length, log });
    } catch (e) {
      L("❌ خطأ: " + e.message, "err");
      res.json({ ok: false, error: e.message, log });
    }
  });

  // Railway API
  app.get("/api/railway/status", auth, async (req, res) => {
    try {
      const { token, projectId } = req.query;
      if (!token || !projectId) return res.json({ ok: false, error: "token و projectId مطلوبان" });
      const query = `query { deployments(input: { projectId: "${projectId}" }, first: 1) { edges { node { id status createdAt url } } } }`;
      const r = await fetch("https://backboard.railway.app/graphql/v2", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query })
      });
      if (!r.ok) return res.json({ ok: false, error: `Railway API: ${r.status}` });
      const data = await r.json();
      const dep = data.data?.deployments?.edges?.[0]?.node;
      if (!dep) return res.json({ ok: false, error: "لا يوجد deployment" });
      res.json({ ok: true, status: { status: dep.status, deploymentId: dep.id, url: dep.url, createdAt: dep.createdAt } });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  app.post("/api/railway/deploy", auth, async (req, res) => {
    try {
      const { token, projectId } = req.body;
      if (!token || !projectId) return res.json({ ok: false, error: "token و projectId مطلوبان" });
      const query = `mutation { deploymentTrigger(input: { projectId: "${projectId}" }) { id } }`;
      const r = await fetch("https://backboard.railway.app/graphql/v2", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query })
      });
      if (!r.ok) return res.json({ ok: false, error: `Railway API: ${r.status}` });
      res.json({ ok: true, message: "✅ تم إطلاق Deploy" });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  // AddLock API
  const addLockStore = require("../utils/addLockStore");

  app.get("/api/addlock", auth, (_, res) => {
    try {
      res.json({ ok: true, config: addLockStore.load() });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  app.post("/api/addlock", auth, (req, res) => {
    try {
      const { tid, enabled, links } = req.body || {};
      if (!tid) return res.json({ ok: false, error: "tid مطلوب" });
      const cfg = addLockStore.load();
      if (!cfg[tid]) cfg[tid] = { enabled: false, accounts: [], links: [] };
      if (typeof enabled === "boolean") cfg[tid].enabled = enabled;
      if (Array.isArray(links)) {
        const accs = links.map(v => String(v || "").trim()).filter(Boolean);
        cfg[tid].accounts = accs;
        cfg[tid].links = accs;
      }
      addLockStore.save(cfg);
      res.json({ ok: true });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  app.delete("/api/addlock/:tid", auth, (req, res) => {
    try {
      const cfg = addLockStore.load();
      delete cfg[req.params.tid];
      addLockStore.save(cfg);
      res.json({ ok: true });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  app.get("/api/addlock/threads", auth, async (_, res) => {
    const api = global.DoskBot?.api || global.GoatBot?.fcaApi;
    const threads = [];
    const seen = new Set();
    if (api && typeof api.getThreadList === "function") {
      try {
        const list = await callApi(api, "getThreadList", [50, null, ["INBOX"]], 10000);
        for (const t of Array.isArray(list) ? list : []) {
          if (t?.isGroup) {
            const tid = String(t.threadID || t.id);
            seen.add(tid);
            threads.push({
              tid,
              name: t.name || t.threadName || `مجموعة ${tid}`,
              memberCount: (t.participantIDs || []).length || 0,
              imageSrc: t.imageSrc || t.image || null
            });
          }
        }
      } catch (_) {}
    }
    for (const [tid] of _threadMsgs.entries()) {
      if (!seen.has(tid)) {
        threads.push({ tid, name: `مجموعة ${tid}`, memberCount: 0, imageSrc: null });
      }
    }
    threads.sort((a, b) => b.memberCount - a.memberCount);
    res.json({ ok: true, threads });
  });

  // Catch-all SPA
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(__dirname, "public", "index.html"));
  });
}

// ── Start Standalone Dashboard Server ────────────────────────────────────────
function startDashboard(port = 5000) {
  const app = express();
  _server = http.createServer(app);

  if (socketio) {
    _io = socketio(_server, { cors: { origin: "*" } });
    _io.on("connection", socket => {
      const tok = socket.handshake.query?.token;
      if (!validToken(tok)) {
        socket.disconnect();
        return;
      }
      socket.emit("stats-update", getStats());
      socket.emit("bot-status", {
        status: global.DoskBot?.api ? "online" : "offline",
        uid: global.DoskBot?.userID || null,
        botName: global.DoskBot?.config?.botName || "DOSK",
      });
      socket.emit("log-history", _logBuf.slice(-100));
      socket.on("ping-bot", () => socket.emit("pong-bot", { ts: Date.now() }));
    });
  }

  setupDashboardRoutes(app);

  setInterval(() => {
    if (_io) _io.emit("stats-update", getStats());
  }, 5000);

  return new Promise((resolve, reject) => {
    _server.listen(port, "0.0.0.0", () => {
      console.log(`\n🌑 [DOSK BOT] Panel is running at: http://0.0.0.0:${port}\n`);
      resolve({ app, server: _server, io: _io });
    });
    _server.on("error", reject);
  });
}

module.exports = {
  startDashboard,
  setupDashboardRoutes,
  interceptLogs,
  getStats,
  _bufferMsg,
  _addBotMsg,
  _trackMsg,
  getIO: () => _io,
  attachSocketIO: (server) => {
    if (socketio && !_io) {
      _io = socketio(server, { cors: { origin: "*" } });
      _io.on("connection", socket => {
        const tok = socket.handshake.query?.token;
        if (!validToken(tok)) {
          socket.disconnect();
          return;
        }
        socket.emit("stats-update", getStats());
        socket.emit("bot-status", {
          status: global.DoskBot?.api ? "online" : "offline",
          uid: global.DoskBot?.userID || null,
          botName: global.DoskBot?.config?.botName || "DOSK",
        });
        socket.emit("log-history", _logBuf.slice(-100));
        socket.on("ping-bot", () => socket.emit("pong-bot", { ts: Date.now() }));
      });
    }
    return _io;
  }
};

