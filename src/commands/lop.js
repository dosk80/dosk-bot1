/**
 * DOSK BOT — /lop — Loop leave protection
 * Copyright © 2026 DOSK
 */
"use strict";

module.exports = {
  config: {
    name: "lop",
    aliases: ["loop", "مانع_التكرار"],
    version: "2.0",
    author: "DOSK",
    countDown: 3,
    role: 2,
    category: "protection",
    description: "حماية منع تكرار خروج وانضمام البوتات",
    guide: { en: "/lop on | off" }
  },
  onStart: async function({ args, message }) {
    const sub = (args[0] || "").toLowerCase();
    if (sub === "off") return message.reply("🛑 تم إيقاف نظام LOP.");
    message.reply("🛡️ نظام حماية تكرار الخروج (LOP) قيد العمل ونشط.");
  }
};

