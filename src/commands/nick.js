/**
 * DOSK BOT — /nick — قفل الكنى
 * Copyright © 2026 DOSK
 */
"use strict";

const fs = require("fs");
const path = require("path");

const DATA = path.join(process.cwd(), "database", "data", "nickData.json");

function load() {
  try {
    if (fs.existsSync(DATA)) return JSON.parse(fs.readFileSync(DATA, "utf8"));
  } catch (_) {}
  return {};
}

function save(d) {
  try {
    fs.mkdirSync(path.dirname(DATA), { recursive: true });
    fs.writeFileSync(DATA, JSON.stringify(d, null, 2), "utf8");
  } catch (_) {}
}

if (!global._nickLocks) global._nickLocks = {};

function dashboardState(tid) {
  const lock = global._nickLocks[tid] || {};
  return {
    active: !!lock.active,
    globalName: String(lock.globalName || ""),
    timerMin: Number(lock.timerMin) || 30,
    timerMax: Number(lock.timerMax) || 90,
    perUser: lock.perUser || {}
  };
}

async function dashboardControl(action, rawTid, options = {}, api) {
  const tid = String(rawTid || "");
  if (!/^\d+$/.test(tid)) throw new Error("معرّف الغروب غير صالح");

  if (!global._nickLocks[tid]) {
    const d = load();
    global._nickLocks[tid] = d[tid] || { active: false, globalName: "", timerMin: 30, timerMax: 90, perUser: {} };
  }
  const lock = global._nickLocks[tid];
  const data = load();

  if (action === "get") return dashboardState(tid);

  if (action === "stop-all") {
    lock.active = false;
  } else if (action === "global-all-start" || action === "start") {
    lock.active = true;
    if (options.globalName !== undefined) lock.globalName = String(options.globalName).trim();
    if (options.timerMin !== undefined) lock.timerMin = Number(options.timerMin) || 30;
    if (options.timerMax !== undefined) lock.timerMax = Number(options.timerMax) || 90;
  } else if (action === "set-user") {
    const uid = String(options.uid || "").trim();
    const nickname = String(options.nickname || "").trim();
    if (uid) {
      lock.perUser = lock.perUser || {};
      if (nickname) lock.perUser[uid] = nickname;
      else delete lock.perUser[uid];
    }
  }

  data[tid] = { ...lock };
  save(data);
  return dashboardState(tid);
}

module.exports = {
  config: {
    name: "nick",
    aliases: ["nickname", "قفل_الكنية", "locknick"],
    version: "2.0",
    author: "DOSK",
    countDown: 3,
    role: 2,
    category: "protection",
    description: "قفل الكنى في المجموعة ومنع التغيير",
    guide: {
      en: "/nick [كنية] — قفل كنية موحدة\n/nick off — إيقاف القفل"
    }
  },
  onStart: async function({ api, event, args, message }) {
    const tid = String(event.threadID);
    const sub = (args[0] || "").toLowerCase();

    if (sub === "off" || sub === "تعطيل") {
      if (global._nickLocks[tid]) global._nickLocks[tid].active = false;
      const d = load(); if (d[tid]) { d[tid].active = false; save(d); }
      return message.reply("✅ تم تعطيل درع قفل الكنى.");
    }

    const nickName = args.join(" ").trim();
    if (!nickName) return message.reply("❌ اكتب الكنية المطلوب تعميمها وقفلها.");

    global._nickLocks[tid] = { active: true, globalName: nickName, perUser: {} };
    const d = load(); d[tid] = global._nickLocks[tid]; save(d);
    message.reply(`🛡️ تم تفعيل درع قفل الكنى:\n🏷️ "${nickName}"`);
  },
  _dashboardControl: dashboardControl
};

