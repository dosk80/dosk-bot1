/**
 * DOSK BOT — /status
 * Copyright © 2026 DOSK
 */
"use strict";

const os = require("os");

module.exports = {
  config: {
    name: "status",
    aliases: ["حالة", "info", "ping"],
    version: "2.0",
    author: "DOSK",
    countDown: 3,
    role: 0,
    category: "system",
    description: "فحص حالة بوت دوسك والنظام",
    guide: { en: "/status" }
  },
  onStart: async function({ message }) {
    const memMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
    const uptimeSec = Math.floor(process.uptime());
    const h = Math.floor(uptimeSec / 3600);
    const m = Math.floor((uptimeSec % 3600) / 60);
    const s = uptimeSec % 60;
    
    await message.reply(
      `📊 𝐃𝐎𝐒𝐊 𝐁𝐎𝐓 𝐒𝐓𝐀𝐓𝐔𝐒 📊\n\n` +
      `🟢 الحالة: متصل ونشط\n` +
      `⏱ مدة التشغيل: ${h}h ${m}m ${s}s\n` +
      `💾 استهلاك الذاكرة: ${memMB} MB\n` +
      `🖥 المعالج: ${os.cpus()[0]?.model || "Standard"}\n` +
      `🌑 𝐃𝐎𝐒𝐊 🌬 We hunt blood 🩸`
    );
  }
};

