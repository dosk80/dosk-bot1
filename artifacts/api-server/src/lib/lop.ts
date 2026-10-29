import fs from "fs";
import path from "path";
import { logger } from "./logger.js";

// ── قائمة الحسابات التي تُضاف تلقائياً عند مغادرة أي عضو ───────────────────
const FILE = path.resolve(process.cwd(), "lop-list.json");
const list = new Set<string>();
const busy = new Set<string>();

try {
  const parsed = JSON.parse(fs.readFileSync(FILE, "utf-8"));
  if (Array.isArray(parsed)) {
    for (const id of parsed) if (typeof id === "string") list.add(id);
  }
} catch {}

function save() {
  try {
    fs.writeFileSync(FILE, JSON.stringify([...list], null, 2), "utf-8");
  } catch (e) {
    logger.warn({ err: e }, "تعذر حفظ قائمة lop");
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── الأوامر: *lop  |  *lops <id>  |  *lop off ────────────────────────────────
export function handleLopCommand(text: string, reply: (msg: string) => void): boolean {
  if (/^\*lop$/i.test(text)) {
    reply("📌 أعطني ايدي الحساب بهذه الصيغة:\n*lops ايدي_الحساب\n\nلمسح القائمة وإيقاف الميزة: *lop off");
    return true;
  }

  if (/^\*lop\s+off$/i.test(text)) {
    list.clear();
    save();
    reply("✅ تم مسح قائمة الإضافة وإيقاف الميزة.");
    return true;
  }

  if (/^\*lops(\s|$)/i.test(text)) {
    const ids = text.split(/\s+/).slice(1).filter((a) => /^\d{5,}$/.test(a));
    if (!ids.length) {
      reply("⚠️ اكتب الايدي بعد الأمر، مثال:\n*lops 100012345678901");
      return true;
    }
    let added = 0;
    for (const id of ids) {
      if (!list.has(id)) {
        list.add(id);
        added++;
      }
    }
    save();
    reply(`✅ تمت إضافة ${added} إلى القائمة. العدد الآن: ${list.size}`);
    return true;
  }

  return false;
}

// ── حدث مغادرة عضو: أضف حسابات القائمة تلقائياً ───────────────────────────────
export function handleLopLeave(api: any, message: any, botID: string | null): boolean {
  if (message?.type !== "event" || message.logMessageType !== "log:unsubscribe") return false;

  const threadID: string = message.threadID;
  const leftId = String(message.logMessageData?.leftParticipantFbId ?? "");
  const author = String(message.author ?? "");

  if (!api || list.size === 0 || busy.has(threadID)) return true;
  if (leftId && leftId === botID) return true; // البوت نفسه خرج

  void addAll(api, threadID, leftId, author);
  return true;
}

async function addAll(api: any, threadID: string, leftId: string, author: string) {
  busy.add(threadID);
  try {
    const info: any = await new Promise((resolve) => {
      try {
        api.getThreadInfo(threadID, (err: any, i: any) => resolve(err ? null : i));
      } catch {
        resolve(null);
      }
    });
    if (!info) return;

    const members = new Set<string>((info.participantIDs ?? []).map(String));
    members.delete(leftId);

    for (const uid of list) {
      if (members.has(uid)) continue; // موجود في الجروب مسبقاً
      if (uid === leftId && author === leftId) continue; // حساب من القائمة خرج بنفسه: لا نعيده
      await new Promise<void>((resolve) => {
        try {
          api.addUserToGroup(uid, threadID, () => resolve());
        } catch {
          resolve();
        }
      });
      await delay(1000); // فاصل بين كل إضافة
    }
  } finally {
    busy.delete(threadID);
  }
}
