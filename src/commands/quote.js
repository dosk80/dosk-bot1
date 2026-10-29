/**
 * DOSK BOT — /quote
 * Copyright © 2026 DOSK
 */
"use strict";

const QUOTES = [
  `🌑 "الصمت ليس ضعفاً… إنه قوة يفهمها القليل."\n— 𝐃𝐎𝐒𝐊 🌬`,
  `🌑 "لا تشرح نفسك لأحد… من أراد أن يفهم، فهم."\n— 𝐃𝐎𝐒𝐊 🌬`,
  `🌑 "الوقت لا يرحم، والذاكرة لا تنسى."\n— 𝐃𝐎𝐒𝐊 🌬`,
  `🌑 "كن صامتاً بما يكفي لتسمع، وقوياً بما يكفي لتصبر."\n— 𝐃𝐎𝐒𝐊 🌬`,
  `🌑 "ليس كل شيء يستحق ردّاً… لكن كل شيء يُحفظ."\n— 𝐃𝐎𝐒𝐊 🌬`,
  `🌑 "الجروح تشفى، لكن الدروس تبقى."\n— 𝐃𝐎𝐒𝐊 🌬`,
  `🌑 "لا تخبر أحداً بخططك… أرِهم النتائج."\n— 𝐃𝐎𝐒𝐊 🌬`
];

module.exports = {
  config: {
    name: "quote",
    aliases: ["اقتباس", "حكمة"],
    version: "2.0",
    author: "DOSK",
    countDown: 3,
    role: 0,
    category: "fun",
    description: "اقتباسات دوسك الفلسفية والمظلمة",
    guide: { en: "/quote" }
  },
  onStart: async function({ message }) {
    const q = QUOTES[Math.floor(Math.random() * QUOTES.length)];
    await message.reply(q);
  }
};

