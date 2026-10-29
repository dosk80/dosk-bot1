/**
 * DOSK BOT — /help
 * Copyright © 2026 DOSK
 */
"use strict";

module.exports = {
  config: {
    name: "help",
    aliases: ["مساعدة", "اوامر", "commands"],
    version: "2.0",
    author: "DOSK",
    countDown: 3,
    role: 0,
    category: "system",
    description: "عرض قائمة أوامر دوسك بوت",
    guide: { en: "/help" }
  },
  onStart: async function({ message }) {
    const text = `╔═══『 ⚔️ DOSK BOT COMMANDS ⚔️ 』═══╗

🌑 𝐃𝐎𝐒𝐊 • 𝐒𝐘𝐒𝐓𝐄𝐌
⚡ /help — المساعدة
🛡️ /protection — الحماية
📊 /status — الحالة
👑 /admin — المشرفين
🔧 /settings — الإعدادات
🔄 /restart — إعادة التشغيل
⛔ /stop — إيقاف البوت

╔═══『 ⚔️ 𝐂𝐎𝐌𝐁𝐀𝐓 ⚔️ 』═══╗
💀 /storm — العاصفة
🔥 /attack — الهجوم
⚔️ /strike — الضربة
🚫 /kick — الطرد
🩸 /destroy — التدمير

╔═══『 🛡️ 𝐏𝐑𝐎𝐓𝐄𝐂𝐓𝐈𝐎𝐍 🛡️ 』═══╗
🔒 /nm — قفل اسم الغروب
🏷️ /nick — قفل الكنية
👥 /addlock — حماية الإضافة

╚═══『 🌑 𝐃𝐎𝐒𝐊 𝐄𝐍𝐃 🌑 』═══╝`;
    await message.reply(text);
  }
};

