/**
 * DOSK BOT — /admin
 * Copyright © 2026 DOSK
 */
"use strict";

module.exports = {
  config: {
    name: "admin",
    aliases: ["مطور", "ادمن", "مشرف"],
    version: "2.0",
    author: "DOSK",
    countDown: 3,
    role: 0,
    category: "admin",
    description: "معلومات مطوري ومشرفي دوسك بوت",
    guide: { en: "/admin" }
  },
  onStart: async function({ message }) {
    await message.reply(
      `👑 𝐃𝐎𝐒𝐊 𝐁𝐎𝐓 𝐀𝐃𝐌𝐈𝐍𝐒 👑\n\n` +
      `👤 المشرف الرئيسي: 61594321502697\n` +
      `⚜️ Hunters Team 🩸\n` +
      `🌑 𝐃𝐎𝐒𝐊 🌬`
    );
  }
};

