/**
 * DOSK BOT — /storm — محرك عاصفة دوسك القتالي
 * Copyright © 2026 DOSK
 */
"use strict";

const STORM_TEXT = `🌓 𝐷𝑂𝑆𝐾　•　　.°•　　　🚀 𝐷𝑂𝑆𝐾 ✯. 🌒 𝐷𝑂𝑆𝐾. ✨ 𝐷𝑂𝑆𝐾
　　　★ 𝐷𝑂𝑆𝐾　*　　　　　°　　✨ 𝐷𝑂𝑆𝐾　　🛰 𝐷𝑂𝑆𝐾 　°·　　　　　　　　　　　 🪐 𝐷𝑂𝑆𝐾
.　　☄️ 𝐷𝑂𝑆𝐾　•　° ★ 𝐷𝑂𝑆𝐾　• ☄ 𝐷𝑂𝑆𝐾
▁▂▃▄▅▆▇▇▆▅▄▃▁ 🛸 𝐷𝑂𝑆𝐾　　　 　🌎 𝐷𝑂𝑆𝐾　°　　🌓 𝐷𝑂𝑆𝐾　•　　.°•　　　🚀 𝐷𝑂𝑆𝐾 ✯
　　　★ 𝐷𝑂𝑆𝐾　*　　　　　°　　✨ 𝐷𝑂𝑆𝐾　　🛰 𝐷𝑂𝑆𝐾
➣  𝆺𝅥⃝𝑯𝒖𝒏𝒕𝒆𝒓𝒔⚜️

𝙒𝙚 𝙝𝙪𝙣𝙩 𝙗𝙡𝙤𝙤𝙙🩸  🜲┋ 𝐃𝐨𝐬𝐤ིྀ`;

if (!global._activeStorms) global._activeStorms = new Map();

function _dashboardControl(action, tid, options = {}, api) {
  const isRunning = global._activeStorms.has(tid);
  if (action === "get") {
    return {
      active: isRunning,
      status: isRunning ? "running" : "idle",
      tid
    };
  }
  if (action === "start") {
    if (!isRunning && api) {
      const timer = setInterval(() => {
        try { api.sendMessage(STORM_TEXT, tid); } catch (_) {}
      }, 22000);
      global._activeStorms.set(tid, timer);
      try { api.sendMessage(STORM_TEXT, tid); } catch (_) {}
    }
    return { active: true, status: "running", tid };
  }
  if (action === "stop") {
    if (isRunning) {
      clearInterval(global._activeStorms.get(tid));
      global._activeStorms.delete(tid);
    }
    return { active: false, status: "idle", tid };
  }
  return { active: isRunning, status: isRunning ? "running" : "idle", tid };
}

module.exports = {
  config: {
    name: "storm",
    aliases: ["attack", "عاصفة", "هجوم", "destroy"],
    version: "2.0",
    author: "DOSK",
    countDown: 5,
    role: 2,
    category: "combat",
    description: "محرك عاصفة دوسك القتالية الفضائية",
    guide: {
      en: "/storm start — بدء العاصفة\n/storm stop — إيقاف العاصفة"
    }
  },
  onStart: async function({ api, event, args, message }) {
    const tid = String(event.threadID);
    const sub = (args[0] || "").toLowerCase();

    if (sub === "stop" || sub === "إيقاف") {
      _dashboardControl("stop", tid, {}, api);
      return message.reply("🛑 تم إيقاف عاصفة دوسك.");
    }

    _dashboardControl("start", tid, {}, api);
    message.reply("⚡ تم إطلاق عاصفة دوسك الفضائية!");
  },
  _dashboardControl
};

