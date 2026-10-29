/**
 * DOSK BOT — /nm — قفل اسم الغروب
 * Copyright © 2026 DOSK
 */
"use strict";

const fs = require("fs");
const path = require("path");

const DATA = path.join(process.cwd(), "database", "data", "nmData.json");

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

function rand(a, b) {
  return Math.floor(Math.random() * (b - a + 1)) + a;
}

if (!global._nmLocks) global._nmLocks = {};
if (!global._nmTimers) global._nmTimers = {};
if (!global._nmRestoring) global._nmRestoring = {};

function stopTimer(tid) {
  if (global._nmTimers[tid]) {
    clearTimeout(global._nmTimers[tid]);
    delete global._nmTimers[tid];
  }
}

function startTimer(api, tid) {
  stopTimer(tid);
  const lock = global._nmLocks[tid];
  if (!api || !lock?.active || !lock?.name) return;

  const ms = rand(lock.minDelay ?? 30, lock.maxDelay ?? 60) * 1000;
  global._nmTimers[tid] = setTimeout(async () => {
    const cur = global._nmLocks[tid];
    if (!cur?.active || !cur?.name) return;
    try { if (typeof api.setTitle === "function") await api.setTitle(cur.name, tid); } catch (_) {}
    startTimer(api, tid);
  }, ms);
}

function dashboardState(tid) {
  const lock = global._nmLocks[tid] || {};
  return {
    active: !!lock.active,
    name: String(lock.name || ""),
    minDelay: Number(lock.minDelay) || 30,
    maxDelay: Number(lock.maxDelay) || 90
  };
}

async function dashboardControl(action, rawTid, options = {}, api) {
  const tid = String(rawTid || "");
  if (!/^\d+$/.test(tid)) throw new Error("معرّف الغروب غير صالح");
  
  if (!global._nmLocks[tid]) {
    const d = load();
    global._nmLocks[tid] = d[tid] || { active: false, name: "", minDelay: 30, maxDelay: 90 };
  }
  const lock = global._nmLocks[tid];
  const data = load();

  if (action === "get") return dashboardState(tid);

  if (action === "stop") {
    lock.active = false;
    stopTimer(tid);
  } else if (action === "start" || action === "set-name") {
    const name = options.name === undefined ? lock.name : String(options.name).trim();
    const minDelay = Number(options.minDelay ?? lock.minDelay ?? 30);
    const maxDelay = Number(options.maxDelay ?? lock.maxDelay ?? 90);
    if (action === "start" && !name) throw new Error("اكتب اسم الغروب أولاً");
    lock.name = name;
    lock.minDelay = minDelay;
    lock.maxDelay = maxDelay;
    if (action === "start") {
      lock.active = true;
      if (api && typeof api.setTitle === "function") {
        try { await api.setTitle(lock.name, tid); } catch (_) {}
      }
      startTimer(api, tid);
    }
  }

  data[tid] = { ...lock };
  save(data);
  return dashboardState(tid);
}

module.exports = {
  config: {
    name: "nm",
    aliases: ["namemute", "قفل_الاسم", "lockname"],
    version: "2.0",
    author: "DOSK",
    countDown: 3,
    role: 2,
    category: "protection",
    description: "قفل اسم الغروب ومنع تغييره واستعادته فورياً",
    guide: {
      en: "/nm [اسم] [min] [max] — تفعيل القفل مع وقت التجديد\n/nm off — إيقاف القفل\n/nm status — الحالة"
    }
  },
  onStart: async function({ api, event, args, message }) {
    const tid = String(event.threadID);
    const sub = (args[0] || "").toLowerCase();

    if (sub === "status" || sub === "حالة") {
      const lock = global._nmLocks[tid];
      if (!lock?.active) return message.reply("💤 قفل اسم الغروب غير مفعل.");
      return message.reply(`🔒 درع قفل الاسم نشط:\n📝 "${lock.name}"\n⏱ تجديد كل ${lock.minDelay}–${lock.maxDelay} ثانية`);
    }

    if (sub === "off" || sub === "تعطيل") {
      stopTimer(tid);
      if (global._nmLocks[tid]) global._nmLocks[tid].active = false;
      const d = load(); if (d[tid]) { d[tid].active = false; save(d); }
      return message.reply("✅ تم تعطيل قفل اسم الغروب.");
    }

    const name = args.join(" ").trim();
    if (!name) return message.reply("❌ اكتب اسم الغروب المطلوب قفله.\nمثال: /nm 𝐃𝐎𝐒𝐊 𝐇𝐔𝐍𝐓𝐄𝐑𝐒");

    global._nmLocks[tid] = { active: true, name, minDelay: 30, maxDelay: 60 };
    const d = load(); d[tid] = global._nmLocks[tid]; save(d);
    try { if (typeof api.setTitle === "function") await api.setTitle(name, tid); } catch (_) {}
    startTimer(api, tid);
    message.reply(`🛡️ تم تفعيل درع قفل الاسم:\n📝 "${name}"`);
  },
  _dashboardControl: dashboardControl
};

