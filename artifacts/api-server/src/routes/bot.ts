import { Router } from "express";
import { getBotStatus, getBotApi, startBot, addDeveloper, removeDeveloper, reloadCookies } from "../lib/bot.js";

const botRouter = Router();

botRouter.get("/bot/status", (_req, res) => {
  res.json(getBotStatus());
});

botRouter.post("/bot/send", (req, res) => {
  const api = getBotApi();
  if (!api) { res.status(503).json({ error: "البوت غير متصل" }); return; }
  const { threadID, message } = req.body;
  if (!threadID || !message) { res.status(400).json({ error: "threadID و message مطلوبان" }); return; }
  api.sendMessage(message, threadID, (err: any) => {
    if (err) { res.status(500).json({ error: String(err) }); return; }
    res.json({ success: true });
  });
});

botRouter.post("/bot/restart", (_req, res) => {
  startBot();
  res.json({ message: "جارٍ إعادة تشغيل البوت..." });
});

botRouter.post("/bot/developer/add", (req, res) => {
  const { uid } = req.body;
  if (!uid) { res.status(400).json({ error: "uid مطلوب" }); return; }
  addDeveloper(uid);
  res.json({ success: true, message: `تمت إضافة ${uid} كمطور.` });
});

botRouter.post("/bot/developer/remove", (req, res) => {
  const { uid } = req.body;
  if (!uid) { res.status(400).json({ error: "uid مطلوب" }); return; }
  removeDeveloper(uid);
  res.json({ success: true, message: `تمت إزالة ${uid} من المطورين.` });
});

// تحديث الكوكيز لحظياً بدون إعادة تشغيل السيرفر
botRouter.post("/bot/reload-cookies", (req, res) => {
  const cookies = req.body;
  if (!Array.isArray(cookies) || cookies.length === 0) {
    res.status(400).json({ error: "يجب إرسال مصفوفة كوكيز صحيحة" });
    return;
  }
  reloadCookies(cookies);
  res.json({ success: true, message: "تم تحديث الكوكيز وإعادة الاتصال فوراً ✓" });
});

export default botRouter;
