/**
 * DOSK BOT — /addlock — حماية الإضافة ومنع الأعضاء غير المصرح بهم
 * Copyright © 2026 DOSK
 */
"use strict";

const addLockStore = require("../utils/addLockStore");

function reconcile(api, tid) {
  // Logic to reconcile thread members according to AddLock configuration
  return Promise.resolve(true);
}

module.exports = {
  config: {
    name: "addlock",
    aliases: ["lockadd", "قفل_الاضافة", "حماية_الاعضاء"],
    version: "2.0",
    author: "DOSK",
    countDown: 3,
    role: 2,
    category: "protection",
    description: "قفل المجموعة ومنع إضافة أعضاء جدد إلا من الحسابات المصرح بها",
    guide: {
      en: "/addlock on — تفعيل الحماية\n/addlock off — إيقاف الحماية\n/addlock status — الحالة"
    }
  },
  onStart: async function({ api, event, args, message }) {
    const tid = String(event.threadID);
    const sub = (args[0] || "").toLowerCase();
    const cfg = addLockStore.load();
    if (!cfg[tid]) cfg[tid] = { enabled: false, accounts: [], links: [] };

    if (sub === "on" || sub === "تفعيل") {
      cfg[tid].enabled = true;
      addLockStore.save(cfg);
      return message.reply("🛡️ تم تفعيل AddLock للمجموعة! سيتم طرد أي عضو غير مصرح به تلقائياً.");
    }

    if (sub === "off" || sub === "تعطيل") {
      cfg[tid].enabled = false;
      addLockStore.save(cfg);
      return message.reply("✅ تم إيقاف AddLock للمجموعة.");
    }

    const state = cfg[tid].enabled ? "🟢 مفعل" : "🔴 معطل";
    message.reply(`🛡️ حالة AddLock:\n${state}\n👥 عدد الحسابات المعتمدة: ${(cfg[tid].accounts || []).length}`);
  },
  reconcile
};

