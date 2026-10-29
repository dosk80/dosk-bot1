import fs from "fs";
import path from "path";
import { logger } from "./logger.js";

// ── حماية اسم الجروب: يغيّر الاسم ثم يراقبه كل 10 ثوانٍ ويعيده إن تغيّر ─────────
const FILE = path.resolve(process.cwd(), "name-guard.json");
const CHECK_EVERY_MS = 10_000;        // فترة المراقبة
const GAP_BETWEEN_THREADS_MS = 1_000; // فاصل بين فحص جروب وآخر داخل نفس الدورة
const MAX_GUARDED = 10;               // أقصى عدد جروبات محمية (لحماية الحساب من القيود)

const guarded = new Map<string, string>(); // threadID → الاسم المحمي
let timer: NodeJS.Timeout | null = null;
let running = false;
let failures = 0;
let pausedUntil = 0;

try {
  const parsed = JSON.parse(fs.readFileSync(FILE, "utf-8"));
  if (parsed && typeof parsed === "object") {
    for (const [tid, name] of Object.entries(parsed)) {
      if (typeof name === "string" && name.trim()) guarded.set(tid, name);
    }
  }
} catch {}

function save() {
  try {
    fs.writeFileSync(FILE, JSON.stringify(Object.fromEntries(guarded), null, 2), "utf-8");
  } catch (e) {
    logger.warn({ err: e }, "تعذر حفظ حالة حماية الاسم");
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function withTimeout<T>(p: Promise<T>, fallback: T, ms = 15_000): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

function getName(api: any, threadID: string): Promise<{ ok: boolean; name: string }> {
  return new Promise((resolve) => {
    try {
      api.getThreadInfo(threadID, (err: any, info: any) => {
        if (err || !info) resolve({ ok: false, name: "" });
        else resolve({ ok: true, name: String(info.threadName ?? "") });
      });
    } catch {
      resolve({ ok: false, name: "" });
    }
  });
}

function setName(api: any, threadID: string, name: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      api.setTitle(name, threadID, (err: any) => resolve(!err));
    } catch {
      resolve(false);
    }
  });
}

// ── دورة المراقبة ─────────────────────────────────────────────────────────────
async function tick(getApi: () => any) {
  if (running || Date.now() < pausedUntil) return;
  const api = getApi();
  if (!api || guarded.size === 0) return;

  running = true;
  try {
    for (const threadID of [...guarded.keys()]) {
      const wanted = guarded.get(threadID);
      if (!wanted) continue; // أُوقفت الحماية أثناء الدورة

      const cur = await withTimeout(getName(api, threadID), { ok: false, name: "" });
      if (!cur.ok) {
        failures++;
        if (failures >= 5) {
          pausedUntil = Date.now() + 120_000;
          failures = 0;
          logger.warn("حماية الاسم: أخطاء متتالية — إيقاف مؤقت لمدة دقيقتين");
          break;
        }
      } else {
        failures = 0;
        if (cur.name.trim() !== wanted.trim()) {
          logger.info({ threadID, wanted, current: cur.name }, "حماية الاسم: تغيير مرصود — جارٍ الاستعادة");
          await withTimeout(setName(api, threadID, wanted), false);
        }
      }
      await delay(GAP_BETWEEN_THREADS_MS);
    }
  } finally {
    running = false;
  }
}

// استدعِها مرة واحدة عند تشغيل البوت: startNameGuard(() => api)
export function startNameGuard(getApi: () => any) {
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    void tick(getApi);
  }, CHECK_EVERY_MS);
}

// ── الأوامر: اسم <الاسم>  |  اسم  |  اسم ايقاف ───────────────────────────────
export function handleNameCommand(
  text: string,
  api: any,
  threadID: string,
  reply: (msg: string) => void
): boolean {
  const m = text.match(/^اسم(?:\s+([\s\S]+))?$/);
  if (!m) return false;
  const arg = (m[1] ?? "").trim();
  const secs = CHECK_EVERY_MS / 1000;

  if (!arg) {
    const cur = guarded.get(threadID);
    reply(
      cur
        ? `🛡️ حماية الاسم مفعّلة\n🏷️ الاسم المحمي: ${cur}\n⏱️ المراقبة كل ${secs} ثوانٍ\n\nلإيقافها: اسم ايقاف`
        : "📌 الاستخدام:\nاسم [الاسم الجديد] ← يغيّر الاسم ويحميه ويراقبه\nاسم ايقاف ← إيقاف الحماية"
    );
    return true;
  }

  if (/^(ايقاف|إيقاف|وقف)$/.test(arg)) {
    if (guarded.delete(threadID)) {
      save();
      reply("✅ تم إيقاف حماية الاسم لهذا الجروب.");
    } else {
      reply("⚠️ لا توجد حماية مفعّلة في هذا الجروب.");
    }
    return true;
  }

  if (!guarded.has(threadID) && guarded.size >= MAX_GUARDED) {
    reply(`⚠️ وصلت للحد الأقصى (${MAX_GUARDED} جروبات محمية). أوقف الحماية في جروب آخر أولاً.`);
    return true;
  }

  if (!api) {
    reply("⚠️ البوت غير متصل حالياً.");
    return true;
  }

  void (async () => {
    const ok = await withTimeout(setName(api, threadID, arg), false);
    if (ok) {
      guarded.set(threadID, arg);
      save();
      reply(`✅ تم تغيير الاسم إلى: ${arg}\n🛡️ الحماية مفعّلة، والمراقبة كل ${secs} ثوانٍ.`);
    } else {
      reply("❌ فشل تغيير الاسم. قد لا يملك الحساب صلاحية، أو الجروب لا يسمح بذلك.");
    }
  })();
  return true;
}
