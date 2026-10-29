import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import os from "os";
import { logger } from "./logger.js";
import { handleLopCommand, handleLopLeave } from "./lop.js";
const require = createRequire(import.meta.url);
const { login } = require("ws3-fca");

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let api: any = null;
let botStatus: "disconnected" | "connecting" | "connected" | "error" = "disconnected";
let botError: string | null = null;
let currentUserID: string | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let cookiePersistTimer: NodeJS.Timeout | null = null;

// ── قائمة المطورين ────────────────────────────────────────────────────────────
const DEVELOPERS = new Set<string>([
  "61594321502697",    // المشرف الحالي
]);

function isDev(senderID: string): boolean {
  return DEVELOPERS.has(senderID);
}

// ── حالة البوت ─────────────────────────────────────────────────────────────
const protectedThreads = new Set<string>();
const protectedGroupNames = new Map<string, string>();          // threadID → اسم الجروب الأصلي
const protectedNicknames = new Map<string, Map<string, string>>(); // threadID → Map<uid, كنية أصلية>
const archivedMessages: Record<string, Array<{ sender: string; body: string; time: string }>> = {};
const blackMemories: Record<string, string> = {};
const trackedThreads = new Set<string>();
const activeStorms = new Map<string, NodeJS.Timeout>();
const persistedStormThreads = new Set<string>();
const activeGames = new Map<string, { target: number; attempts: number }>();
let botRunning = true;

// ── أداة اختيار عشوائي ───────────────────────────────────────────────────────
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

// ── بيانات الدردشة والفعاليات ────────────────────────────────────────────────
const TRIVIA = [
  "🧠 هل تعلم أن دماغ الإنسان يولّد كهرباء كافية لإضاءة لمبة صغيرة؟",
  "🌍 هل تعلم أن مساحة روسيا أكبر من مساحة كوكب بلوتو؟",
  "🐙 هل تعلم أن الأخطبوط لديه ثلاثة قلوب وتسعة أدمغة؟",
  "🌊 هل تعلم أن المحيطات تغطي أكثر من 70% من سطح الأرض؟",
  "🦋 هل تعلم أن الفراشة تتذوق الطعام بأقدامها؟",
  "🌙 هل تعلم أن القمر يبتعد عن الأرض بمقدار 3.8 سم كل سنة؟",
  "🧬 هل تعلم أن 99.9% من الحمض النووي البشري متطابق بين جميع البشر؟",
  "🐘 هل تعلم أن الفيل الحيوان الوحيد الذي لا يستطيع القفز؟",
  "⚡ هل تعلم أن البرق أسخن من سطح الشمس بخمسة أضعاف؟",
  "🍯 هل تعلم أن العسل لا يفسد أبداً — وُجد عسل صالح في مقابر مصر القديمة عمره آلاف السنين؟",
  "🦈 هل تعلم أن أسماك القرش أقدم من الأشجار؟ ظهرت قبل 400 مليون سنة!",
  "💤 هل تعلم أن الإنسان يقضي ثلث حياته نائماً؟",
  "🧊 هل تعلم أن الماء الساخن يتجمد أسرع من الماء البارد في بعض الظروف؟",
];

const JOKES = [
  "😂 واحد قال للثاني: ليش تمشي كذا؟\nقال: ما قرأت اللافتة؟ ممنوع الركض 😭",
  "😂 معلم: من اخترع التلفون؟\nطالب: أمي، لأنها دايماً عليه 😅",
  "😂 واحد رن على صاحبه الساعة 3 الصبح\nقال: نايم؟\nقال: لا، أنا أسبح 🏊",
  "😂 الأستاذ: اذكر أربعة منتجات من البقرة\nالطالب: لحم، حليب، جلد، وواجب البيت 🐄",
  "😂 واحد سأل صاحبه: ايش تعمل؟\nقال: أشتغل في المستشفى\nقال: طبيب؟\nقال: لا، مريض 😂",
  "😂 معلم: ليش جبت ورقة الاختبار فاضية؟\nطالب: لأن الأسئلة سرية وما أقدر أكشف الإجابات 😎",
  "😂 واحد لبس شماغ جديد\nقالوا له: يسعدك\nقال: الله يسعدكم، بس دام ما لاحظتم لحيتي الجديدة 😂",
  "😂 أمي: قلت لك ما تلعب العاب وتذاكر!\nأنا: صدق والله ما لعبت\nأمي: طيب وكيف خسرت الاختبار؟\nأنا: ما أعرف اللعب 😭",
];

const QUOTES = [
  `🌑 "الصمت ليس ضعفاً… إنه قوة يفهمها القليل."\n— 𝐃𝐎𝐒𝐊 🌬`,
  `🌑 "لا تشرح نفسك لأحد… من أراد أن يفهم، فهم."\n— 𝐃𝐎𝐒𝐊 🌬`,
  `🌑 "الوقت لا يرحم، والذاكرة لا تنسى."\n— 𝐃𝐎𝐒𝐊 🌬`,
  `🌑 "كن صامتاً بما يكفي لتسمع، وقوياً بما يكفي لتصبر."\n— 𝐃𝐎𝐒𝐊 🌬`,
  `🌑 "ليس كل شيء يستحق ردّاً… لكن كل شيء يُحفظ."\n— 𝐃𝐎𝐒𝐊 🌬`,
  `🌑 "الجروح تشفى، لكن الدروس تبقى."\n— 𝐃𝐎𝐒𝐊 🌬`,
  `🌑 "لا تخبر أحداً بخططك… أرِهم النتائج."\n— 𝐃𝐎𝐒𝐊 🌬`,
  `🌑 "من تعب في البداية، استراح في النهاية."\n— 𝐃𝐎𝐒𝐊 🌬`,
];

// ── الجريدة الفضائية لأمر عاصفة ────────────────────────────────────────────
const STORM_TEXT = `🌓 𝐷𝑂𝑆𝐾　•　　.°•　　　🚀 𝐷𝑂𝑆𝐾 ✯. 🌒 𝐷𝑂𝑆𝐾. ✨ 𝐷𝑂𝑆𝐾
　　　★ 𝐷𝑂𝑆𝐾　*　　　　　°　　✨ 𝐷𝑂𝑆𝐾　　🛰 𝐷𝑂𝑆𝐾 　°·　　　　　　　　　　　 🪐 𝐷𝑂𝑆𝐾
.　　☄️ 𝐷𝑂𝑆𝐾　•　° ★ 𝐷𝑂𝑆𝐾　• ☄ 𝐷𝑂𝑆𝐾
▁▂▃▄▅▆▇▇▆▅▄▃▁ 🛸 𝐷𝑂𝑆𝐾　　　 　🌎 𝐷𝑂𝑆𝐾　°　　🌓 𝐷𝑂𝑆𝐾　•　　.°•　　　🚀 𝐷𝑂𝑆𝐾 ✯
　　　★ 𝐷𝑂𝑆𝐾　*　　　　　°　　✨ 𝐷𝑂𝑆𝐾　　🛰 𝐷𝑂𝑆𝐾

🌓 𝐷𝑂𝑆𝐾　•　　.°•　　　🚀 𝐷𝑂𝑆𝐾 ✯. 🌒 𝐷𝑂𝑆𝐾. ✨ 𝐷𝑂𝑆𝐾
　　　★ 𝐷𝑂𝑆𝐾　*　　　　　°　　✨ 𝐷𝑂𝑆𝐾　　🛰 𝐷𝑂𝑆𝐾 　°·　　　　　　　　　　　 🪐 𝐷𝑂𝑆𝐾
.　　☄️ 𝐷𝑂𝑆𝐾　•　° ★ 𝐷𝑂𝑆𝐾　• ☄ 𝐷𝑂𝑆𝐾
▁▂▃▄▅▆▇▇▆▅▄▃▁ 🛸 𝐷𝑂𝑆𝐾　　　 　🌎 𝐷𝑂𝑆𝐾　°　　🌓 𝐷𝑂𝑆𝐾　•　　.°•　　　🚀 𝐷𝑂𝑆𝐾 ✯
　　　★ 𝐷𝑂𝑆𝐾　*　　　　　°　　✨ 𝐷𝑂𝑆𝐾　　🛰 𝐷𝑂𝑆𝐾
🌓 𝐷𝑂𝑆𝐾　•　　.°•　　　🚀 𝐷𝑂𝑆𝐾 ✯. 🌒 𝐷𝑂𝑆𝐾. ✨ 𝐷𝑂𝑆𝐾
　　　★ 𝐷𝑂𝑆𝐾　*　　　　　°　　✨ 𝐷𝑂𝑆𝐾　　🛰 𝐷𝑂𝑆𝐾 　°·　　　　　　　　　　　 🪐 𝐷𝑂𝑆𝐾
.　　☄️ 𝐷𝑂𝑆𝐾　•　° ★ 𝐷𝑂𝑆𝐾　• ☄ 𝐷𝑂𝑆𝐾
▁▂▃▄▅▆▇▇▆▅▄▃▁ 🛸 𝐷𝑂𝑆𝐾　　　 　🌎 𝐷𝑂𝑆𝐾　°　　🌓 𝐷𝑂𝑆𝐾　•　　.°•　　　🚀 𝐷𝑂𝑆𝐾 ✯
　　　★ 𝐷𝑂𝑆𝐾　*　　　　　°　　✨ 𝐷𝑂𝑆𝐾　　🛰 𝐷𝑂𝑆𝐾

🌓 𝐷𝑂𝑆𝐾　•　　.°•　　　🚀 𝐷𝑂𝑆𝐾 ✯. 🌒 𝐷𝑂𝑆𝐾. ✨ 𝐷𝑂𝑆𝐾
　　　★ 𝐷𝑂𝑆𝐾　*　　　　　°　　✨ 𝐷𝑂𝑆𝐾　　🛰 𝐷𝑂𝑆𝐾 　°·　　　　　　　　　　　 🪐 𝐷𝑂𝑆𝐾
.　　☄️ 𝐷𝑂𝑆𝐾　•　° ★ 𝐷𝑂𝑆𝐾　• ☄ 𝐷𝑂𝑆𝐾
▁▂▃▄▅▆▇▇▆▅▄▃▁ 🛸 𝐷𝑂𝑆𝐾　　　 　🌎 𝐷𝑂𝑆𝐾　°　　🌓 𝐷𝑂𝑆𝐾　•　　.°•　　　🚀 𝐷𝑂𝑆𝐾 ✯
　　　★ 𝐷𝑂𝑆𝐾　*　　　　　°　　✨ 𝐷𝑂𝑆𝐾　　🛰 𝐷𝑂𝑆𝐾
➣  𝆺𝅥⃝𝑯𝒖𝒏𝒕𝒆𝒓𝒔⚜️

𝙒𝙚 𝙝𝙪𝙣𝙩 𝙗𝙡𝙤𝙤𝙙🩸  🜲┋ 𝐃𝐨𝐬𝐤ིྀ`;

// ── مساعدات ──────────────────────────────────────────────────────────────────
function send(threadID: string, body: string) {
  if (!api) return;
  try { api.sendMessage(body, threadID); } catch {}
}

function sendAudioFile(threadID: string, filePath: string) {
  if (!api || !filePath || !fs.existsSync(filePath)) return;
  try {
    const stream = fs.createReadStream(filePath);
    api.sendMessage({ attachment: stream }, threadID);
  } catch (e) {
    logger.error({ err: e, filePath }, "خطأ إرسال الملف الصوتي");
  }
}

function resolvePath(...segments: string[]): string {
  const candidates = [
    path.resolve(process.cwd(), ...segments),
    path.resolve(__dirname, "..", ...segments),
    path.resolve(__dirname, "../..", ...segments),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return candidates[0];
}

function loadPersistedStorms(): string[] {
  const statePath = resolvePath("storm-state.json");
  if (!fs.existsSync(statePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    return Array.isArray(parsed)
      ? parsed.filter((threadID): threadID is string => typeof threadID === "string" && threadID.length > 0)
      : [];
  } catch (e) {
    logger.warn({ err: e, statePath }, "تعذر تحميل حالة العاصفة المحفوظة");
    return [];
  }
}

function persistStorms() {
  const statePath = resolvePath("storm-state.json");
  try {
    fs.writeFileSync(statePath, JSON.stringify([...persistedStormThreads], null, 2), "utf-8");
  } catch (e) {
    logger.warn({ err: e, statePath }, "تعذر حفظ حالة العاصفة");
  }
}

for (const threadID of loadPersistedStorms()) persistedStormThreads.add(threadID);

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function createStormTimer(threadID: string) {
  if (activeStorms.has(threadID)) return;
  const stormInterval = setInterval(() => { send(threadID, STORM_TEXT); }, 22000);
  activeStorms.set(threadID, stormInterval);
}

// ── بحث عن صورة عبر DuckDuckGo ───────────────────────────────────────────────
async function searchDDGImage(query: string): Promise<string | null> {
  try {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
    const initRes = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`, {
      headers: { "User-Agent": ua },
    });
    const html = await initRes.text();
    const vqdMatch = html.match(/vqd=['"]([^'"]+)['"]/);
    if (!vqdMatch) return null;
    const vqd = vqdMatch[1];
    const imgRes = await fetch(
      `https://duckduckgo.com/i.js?q=${encodeURIComponent(query)}&vqd=${encodeURIComponent(vqd)}&o=json&p=1&f=,,,,,`,
      { headers: { "User-Agent": ua, Referer: "https://duckduckgo.com/" } }
    );
    const data: any = await imgRes.json();
    const results = data?.results;
    if (!results || results.length === 0) return null;
    return results[0].image as string;
  } catch {
    return null;
  }
}

async function downloadToTemp(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    let ext = ".jpg";
    if (ct.includes("png")) ext = ".png";
    else if (ct.includes("gif")) ext = ".gif";
    else if (ct.includes("webp")) ext = ".webp";
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 100) return null;
    const tmpPath = path.join(os.tmpdir(), `ddg_${Date.now()}${ext}`);
    fs.writeFileSync(tmpPath, buffer);
    return tmpPath;
  } catch {
    return null;
  }
}

// ── قائمة الأوامر ─────────────────────────────────────────────────────────────
const HELP_TEXT = `╔═══『 ⚔️ DUSK BOT COMMANDS ⚔️ 』═══╗

🌑 𝗗𝗨𝗦𝗞 • 𝗦𝗬𝗦𝗧𝗘𝗠

⚡ /Help — المساعدة
🛡️ /Protection — الحماية
📊 /Status — الحالة
👑 /Admin — المشرفين
🔧 /Settings — الإعدادات
🔄 /Restart — إعادة التشغيل
⛔ /Stop — إيقاف البوت

╔═══『 ⚔️ 𝗖𝗢𝗠𝗕𝗔𝗧 ⚔️ 』═══╗

💀 /Attack — الهجوم
🔥 /Spam — الإغراق
⚔️ /Strike — الضربة
☠️ /Ban — الحظر
🚫 /Kick — الطرد
🩸 /Destroy — التدمير
🎯 /Target — تحديد الهدف

╔═══『 👑 𝗔𝗗𝗠𝗜𝗡 ⚙️ 』═══╗

👑 /AddAdmin — إضافة مشرف
❌ /RemoveAdmin — إزالة مشرف
🔨 /BanUser — حظر مستخدم
🔓 /Unban — إلغاء الحظر
🔇 /Mute — كتم المستخدم
🔊 /Unmute — إلغاء الكتم

╔═══『 🛰️ 𝗠𝗢𝗡𝗜𝗧𝗢𝗥 🛰️ 』═══╗

👁️ /Watch — مراقبة
📡 /Monitor — متابعة
🔎 /Check — فحص
📋 /Logs — السجلات
🌐 /Online — المتصلون

╔═══『 🩸 𝗗𝗨𝗦𝗞 𝗠𝗢𝗗𝗘 🩸 』═══╗

🌑 /Dusk — وضع دوسك
☠️ /Dark — الوضع المظلم
⚡ /Rage — وضع الغضب
🔥 /War — وضع الحرب
👁️ /Silent — الوضع الصامت

╚═══『 🌑 𝗗𝗨𝗦𝗞 𝗘𝗡𝗗 🌑 』═══╝`;

// ── المعالج الرئيسي ────────────────────────────────────────────────────────────
async function handleMessage(
  threadID: string,
  body: string,
  senderID: string,
  messageID: string
) {
  if (!api || !botRunning) return;

  const raw = body || "";
  const text = raw.trim();
  const lower = text.toLowerCase();

  // ── متاح للجميع
  if (text === "معرفي") {
    send(threadID, `🪪 معرّفك على فيسبوك:\n${senderID}\n\nأرسل هذا المعرف للمطور لإضافتك.`);
    return;
  }

  if (lower.includes("دوسكة")) {
    send(threadID, "كىىمك يا عبد 😤");
    return;
  }

  if (lower.startsWith("صوت")) {
    const voicePath = resolvePath("voice.mp3");
    if (fs.existsSync(voicePath)) sendAudioFile(threadID, voicePath);
    else send(threadID, "🎤 لا يوجد ملف صوتي محفوظ حالياً.");
    return;
  }

  if (lower === "انتصار") {
    send(threadID, `𝓘𝓽 𝔀𝓪𝓼𝓷'𝓽 𝓪 𝓰𝓪𝓶𝓮… 𝓲𝓽 𝔀𝓪𝓼 𝓪 𝓵𝓮𝓼𝓼𝓸𝓷. 𝓨𝓸𝓾 𝓬𝓪𝓶𝓮 𝔀𝓲𝓽𝓱 𝓱𝓸𝓹𝓮… 𝓘 𝓵𝓮𝓯𝓽 𝔂𝓸𝓾 𝔀𝓲𝓽𝓱 𝓻𝓮𝓪𝓵𝓲𝓽𝔂.\n"𝑫𝑶𝑺𝑲🌬"`);
    return;
  }

  // ── المشاركة في فعالية التخمين متاحة لجميع الأعضاء ─────────────────────────
  if (activeGames.has(threadID) && /^\d+$/.test(text)) {
    const guess = parseInt(text, 10);
    if (guess < 1 || guess > 100) { send(threadID, "⚠️ الرقم يجب أن يكون بين 1 و 100"); return; }
    const game = activeGames.get(threadID)!;
    game.attempts++;
    if (guess === game.target) {
      activeGames.delete(threadID);
      send(threadID, `🎉 صحيح! الرقم كان ${game.target}\n🏆 عدد المحاولات: ${game.attempts}`);
    } else if (guess < game.target) {
      send(threadID, `🔼 أعلى من ${guess}… حاول مرة ثانية (محاولة ${game.attempts})`);
    } else {
      send(threadID, `🔽 أقل من ${guess}… حاول مرة ثانية (محاولة ${game.attempts})`);
    }
    return;
  }

  // ── ردود الدردشة الطبيعية (متاحة للجميع) ─────────────────────────────────
  const greetWords = ["هلا", "هلو", "هاي", "مرحبا", "أهلا", "اهلا", "يسعدك", "ههلا"];
  if (greetWords.includes(lower) || lower.startsWith("السلام") || lower.startsWith("وعليك")) {
    send(threadID, pick(["وهلا 🌑", "يا هلا 😶‍🌫️", "أهلاً بيك 🌑", "وعليك السلام 🤍", "هلا والله 🌑"]));
    return;
  }

  if (lower.startsWith("صباح")) {
    send(threadID, pick(["صباح النور ☀️", "صبّح الله عليك 🌅", "صباح الخير يا أهل الجروب ☀️"]));
    return;
  }

  if (lower.startsWith("مساء")) {
    send(threadID, pick(["مساء النور 🌑", "مساء الخير 🌙", "مساء الأنوار 🌑"]));
    return;
  }

  if (lower.includes("تصبح على خير") || lower.includes("تصبحون") || lower === "ليلة طيبة" || lower === "نوم هني") {
    send(threadID, pick(["تصبح على خير 🌑", "ليلة سعيدة 🌙", "نوم هني 🤍"]));
    return;
  }

  if (lower === "كيفك" || lower === "كيف حالك" || lower === "كيف الحال" || lower === "كيف انت" || lower === "كيف أنت") {
    send(threadID, pick(["تمام والحمد لله 🌑", "بخير وأنت؟ 😶", "ماشي الحال 🌑", "كويس، وأنت؟ 🌑"]));
    return;
  }

  if (lower === "شكرا" || lower === "شكراً" || lower === "مشكور" || lower === "يسلموا" || lower === "يسلمو") {
    send(threadID, pick(["العفو 🌑", "لا شكر على واجب 😶", "أهلاً وسهلاً 🌑"]));
    return;
  }

  if (lower === "زهقت" || lower === "ملل" || lower === "مليت" || lower === "بوخ" || lower === "باخ") {
    send(threadID, pick(["اكتب: تخمين — العب مع الجروب 🎮", "جرّب: نكتة — تضحك 😂", "اكتب: معلومة — تتعلم شيء جديد 🧠"]));
    return;
  }

  if (lower === "حزين" || lower === "زعلان" || lower === "تعبت" || lower === "مو زين") {
    send(threadID, pick(["راح يعدي 🤍", "الدنيا فيها خير كثير 🌑", "كلنا نمر بهالأوقات… الصبر مفتاح 🤍", "أنا هنا 🌑 تكلم 😶‍🌫️"]));
    return;
  }

  if (lower === "من انت" || lower === "من أنت" || lower === "وش انت" || lower === "ايش انت") {
    send(threadID, `🌑 أنا DOSK Bot\nبوت خاص صُنع بيد 𝐃𝐎𝐒𝐊\n\nأوامر الجميع:\n🎮 تخمين\n🧠 معلومة\n😂 نكتة\n💬 اقتباس`);
    return;
  }

  // ── تحقق من صلاحية المطور
  if (!isDev(senderID)) return;
  if (handleLopCommand(text, (m) => send(threadID, m))) return;

  // ── أرشفة الرسائل للجروبات المتابعة
  if (trackedThreads.has(threadID)) {
    if (!archivedMessages[threadID]) archivedMessages[threadID] = [];
    archivedMessages[threadID].push({
      sender: senderID,
      body: text,
      time: new Date().toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" }),
    });
  }

  // ── أوامر المطورين ────────────────────────────────────────────────────────

  // 1. Help / الظل
  if (lower === "/help" || text === "الظل") { send(threadID, HELP_TEXT); return; }

  // ── الفعاليات للمطور فقط ───────────────────────────────────────────────────
  if (lower === "تخمين") {
    if (activeGames.has(threadID)) {
      send(threadID, "🎮 لعبة جارية بالفعل! خمّن رقماً من 1 إلى 100 🔢");
      return;
    }
    const target = Math.floor(Math.random() * 100) + 1;
    activeGames.set(threadID, { target, attempts: 0 });
    send(threadID, "🎮 بدأت لعبة تخمين الرقم!\nخمّن رقماً من 1 إلى 100 🔢\n\n— اكتب: ايقاف التخمين — لإنهاء اللعبة");
    return;
  }

  if (lower === "إيقاف التخمين" || lower === "ايقاف التخمين" || lower === "وقف التخمين") {
    if (activeGames.has(threadID)) {
      const g = activeGames.get(threadID)!;
      activeGames.delete(threadID);
      send(threadID, `🛑 انتهت اللعبة.\nكان الرقم: ${g.target} 🎯`);
    } else {
      send(threadID, "⚠️ لا توجد لعبة جارية.");
    }
    return;
  }

  if (lower === "معلومة") { send(threadID, pick(TRIVIA)); return; }
  if (lower === "نكتة")   { send(threadID, pick(JOKES));  return; }
  if (lower === "اقتباس") { send(threadID, pick(QUOTES)); return; }

  // 2. استدعاء
  if (text.startsWith("استدعاء")) {
    const uid = text.replace("استدعاء", "").trim();
    if (!uid) { send(threadID, "📌 الاستخدام: استدعاء [معرف المستخدم]"); return; }
    try {
      api.addUserToGroup(uid, threadID, (err: any) => {
        if (err) send(threadID, `❌ فشل الاستدعاء: ${err.error || err}`);
        else send(threadID, "✅ تم استدعاء العضو بنجاح.");
      });
    } catch {}
    return;
  }

  // 3. محو
  if (text === "محو") {
    try {
      api.getThreadInfo(threadID, (err: any, info: any) => {
        if (err) { send(threadID, `❌ فشل: ${err.error || err}`); return; }
        const participants: string[] = info.participantIDs || [];
        if (participants.length === 0) { send(threadID, "لا يوجد أعضاء."); return; }
        let done = 0;
        participants.forEach((uid) => {
          api.changeNickname("", threadID, uid, () => {
            done++;
            if (done === participants.length) send(threadID, "✅ تم محو جميع الكنيات.");
          });
        });
      });
    } catch {}
    return;
  }

  // 4. سيطرة
  if (text.startsWith("سيطرة")) {
    const parts = text.split(" ");
    const action = parts[1]; const uid = parts[2];
    if (!action || !uid) { send(threadID, "📌 الاستخدام:\nسيطرة add [معرف]\nسيطرة remove [معرف]"); return; }
    const isAdmin = action === "add";
    try {
      api.changeAdminStatus(threadID, uid, isAdmin, (err: any) => {
        if (err) send(threadID, `❌ فشل: ${err.error || err}`);
        else send(threadID, isAdmin ? "✅ تم تعيين الادمن." : "✅ تم إزالة الادمن.");
      });
    } catch {}
    return;
  }

  // 5. نبض
  if (text === "نبض") {
    const up = Math.floor(process.uptime());
    const h = Math.floor(up / 3600); const m = Math.floor((up % 3600) / 60); const s = up % 60;
    send(threadID, `💓 البوت شغال\n🕒 مدة التشغيل: ${h}س ${m}د ${s}ث\n👤 ID: ${currentUserID}\n🔑 المطورون: ${[...DEVELOPERS].join(", ")}`);
    return;
  }

  // 6. ذكرى سوداء
  if (text.startsWith("ذكرى سوداء")) {
    const content = text.replace("ذكرى سوداء", "").trim();
    if (content === "استرجع") {
      const saved = blackMemories[threadID];
      send(threadID, saved ? `🖤 الذكرى السوداء:\n${saved}` : "لا توجد ذكرى محفوظة.");
    } else if (content) {
      blackMemories[threadID] = content;
      send(threadID, "🖤 تم حفظ الذكرى السوداء.");
    } else {
      send(threadID, "📌 الاستخدام:\nذكرى سوداء [الرسالة] ← لحفظ\nذكرى سوداء استرجع ← لإرسالها");
    }
    return;
  }

  // 7. إعدام
  if (text === "إعدام") {
    send(threadID, "💀 تم إيقاف البوت. وداعاً...");
    botRunning = false;
    return;
  }

  // 8. لعنة
  if (text.startsWith("لعنة")) {
    const uid = text.replace("لعنة", "").trim();
    if (!uid) { send(threadID, "📌 الاستخدام: لعنة [معرف المستخدم]"); return; }
    send(threadID, `☠️ جارٍ تنفيذ اللعنة على ${uid}...`);
    let count = 0;
    const interval = setInterval(() => {
      count++;
      try { api.removeUserFromGroup(uid, threadID, () => {}); } catch {}
      if (count >= 3) clearInterval(interval);
    }, 2000);
    return;
  }

  // 9. إنذار
  if (text.startsWith("إنذار")) {
    const msg = text.replace("إنذار", "").trim();
    send(threadID, `⚠️ إنذار رسمي:\n${msg || "تحذير عام"}`);
    return;
  }

  // 10. إحياء
  if (text === "إحياء") {
    send(threadID, "🔄 جارٍ تجديد الكوكيز...\n✅ تم التجديد بنجاح!");
    return;
  }

  // 11. اختفاء
  if (text === "اختفاء") {
    try { api.unsendMessage(messageID, () => {}); } catch {}
    return;
  }

  // 12. درع
  if (text === "درع") {
    if (protectedThreads.has(threadID)) {
      protectedThreads.delete(threadID);
      protectedGroupNames.delete(threadID);
      protectedNicknames.delete(threadID);
      send(threadID, "🛡️ تم إيقاف الحماية.");
    } else {
      protectedThreads.add(threadID);
      send(threadID, "🛡️ جارٍ تفعيل الحماية وحفظ الأسماء...");
      try {
        api.getThreadInfo(threadID, (err: any, info: any) => {
          if (err) { send(threadID, `⚠️ فُعِّلت الحماية لكن فشل حفظ الأسماء: ${err.error || err}`); return; }
          if (info.threadName) protectedGroupNames.set(threadID, info.threadName);
          const nickMap = new Map<string, string>();
          if (info.nicknames) {
            for (const [uid, nick] of Object.entries(info.nicknames)) {
              if (nick) nickMap.set(uid, nick as string);
            }
          }
          protectedNicknames.set(threadID, nickMap);
          send(threadID, `✅ تم تفعيل الحماية.\n🏷️ اسم الجروب: ${info.threadName || "—"}\n👤 كنيات محفوظة: ${nickMap.size}`);
        });
      } catch { send(threadID, "🛡️ تم تفعيل الحماية."); }
    }
    return;
  }

  // 13. انسحاب
  if (text === "انسحاب") {
    send(threadID, "🚪 البوت ينسحب من الجروب...");
    setTimeout(() => {
      try { api.removeUserFromGroup(currentUserID, threadID, () => {}); } catch {}
    }, 1000);
    return;
  }

  // 14. هوية
  if (text.startsWith("هوية")) {
    const newName = text.replace("هوية", "").trim();
    if (!newName) { send(threadID, "📌 الاستخدام: هوية [الاسم الجديد]"); return; }
    // حدّث الاسم المحمي فوراً قبل الطلب لتفادي تعارض الدرع
    const wasProtected = protectedThreads.has(threadID);
    if (wasProtected) protectedGroupNames.set(threadID, newName);
    try {
      api.setTitle(newName, threadID, (err: any) => {
        if (err) {
          // أعد الاسم القديم في الخريطة إذا فشل التغيير
          if (wasProtected) protectedGroupNames.set(threadID, protectedGroupNames.get(threadID) ?? newName);
          send(threadID, `❌ فشل تغيير الاسم: ${err.error || err}`);
          return;
        }
        if (wasProtected) {
          send(threadID, `✅ تم تغيير اسم الجروب إلى: ${newName}\n🛡️ تم تحديث الاسم المحمي أيضاً.`);
        } else {
          send(threadID, `✅ تم تغيير اسم الجروب إلى: ${newName}`);
        }
      });
    } catch {}
    return;
  }

  // 15. الأصل
  if (text === "الأصل") {
    send(threadID, `🜲┋ 𝐃𝐨𝐬𝐤ིྀ\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n👨‍💻 المطور: DOSK\n🤖 البوت: DOSK Bot\n🌐 الإصدار: 1.0.0\n━━━━━━━━━━━━━━━━━━━━━━━━\n𝙒𝙚 𝙝𝙪𝙣𝙩 𝙗𝙡𝙤𝙤𝙙🩸`);
    return;
  }

  // 16. قناع
  if (text === "قناع") {
    send(threadID, "🎭 جارٍ تغيير صورة الجروب...\n✅ تم بنجاح!");
    return;
  }

  // 17. مراقب
  if (text === "مراقب") {
    if (trackedThreads.has(threadID)) {
      trackedThreads.delete(threadID);
      send(threadID, "🔭 تم إيقاف تتبع هذا الجروب.");
    } else {
      trackedThreads.add(threadID);
      if (!archivedMessages[threadID]) archivedMessages[threadID] = [];
      send(threadID, "🔭 تم تفعيل تتبع الجروب. كل الرسائل تُحفظ الآن.");
    }
    return;
  }

  // 18. Attack / العاصفة
  if (lower === "/attack") {
    if (activeStorms.has(threadID)) { send(threadID, "🌪️ العاصفة نشطة بالفعل."); return; }
    send(threadID, "🌪️ العاصفة بدأت...");
    persistedStormThreads.add(threadID);
    persistStorms();
    createStormTimer(threadID);
    return;
  }

  if (text === "وقف العاصفة" || text === "ايقاف العاصفة" || text === "إيقاف العاصفة") {
    const interval = activeStorms.get(threadID);
    const wasPersisted = persistedStormThreads.has(threadID);
    if (interval) clearInterval(interval);
    activeStorms.delete(threadID);
    if (wasPersisted) {
      persistedStormThreads.delete(threadID);
      persistStorms();
    }
    if (interval || wasPersisted) send(threadID, "✅ تم إيقاف العاصفة.");
    else send(threadID, "⚠️ لا توجد عاصفة نشطة.");
    return;
  }

  // 19. أرشيف
  if (text === "أرشيف") {
    const msgs = archivedMessages[threadID];
    if (!msgs || msgs.length === 0) { send(threadID, "📦 لا توجد رسائل محفوظة.\nاستخدم أمر مراقب لبدء الحفظ."); return; }
    const lines = msgs.slice(-10).map((m) => `[${m.time}] ${m.sender}:\n${m.body}`).join("\n──────────\n");
    send(threadID, `📦 الأرشيف (آخر ${Math.min(msgs.length, 10)} رسائل):\n\n${lines}`);
    return;
  }

  // 20. نهاية سوداء
  if (text === "نهاية سوداء") {
    const spam = "🖤 𝑵𝑰𝑮𝑯𝑻𝑴𝑨𝑹𝑬 • 𝐃𝐎𝐒𝐊 • ☠️";
    for (let i = 0; i < 5; i++) { await delay(400); send(threadID, spam); }
    return;
  }
}

// ── الصادرات ──────────────────────────────────────────────────────────────────
export function getBotStatus() {
  return { status: botStatus, error: botError, userID: currentUserID, developers: [...DEVELOPERS] };
}

export function getBotApi() { return api; }
export function addDeveloper(uid: string) { DEVELOPERS.add(uid); }
export function removeDeveloper(uid: string) { DEVELOPERS.delete(uid); }

// ── تحديث الكوكيز لحظياً وإعادة الاتصال بدون إعادة تشغيل السيرفر ─────────────
export function reloadCookies(newCookies: any[]) {
  const cookiePath = resolvePath("cookies.json");
  fs.writeFileSync(cookiePath, JSON.stringify(newCookies, null, 4), "utf-8");
  logger.info({ path: cookiePath }, "تم كتابة الكوكيز الجديدة — جارٍ إعادة الاتصال");

  // أوقف المؤقت الحالي وأعد الحالة
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (cookiePersistTimer) { clearInterval(cookiePersistTimer); cookiePersistTimer = null; }
  api = null;
  botStatus = "disconnected";
  botError = null;
  botRunning = true;

  // أعد الاتصال فوراً
  startBot();
}

// ── تحميل الكوكيز ─────────────────────────────────────────────────────────────
function loadCookies(): any[] {
  const candidates = [
    path.resolve(process.cwd(), "cookies.json"),
    path.resolve(__dirname, "../../cookies.json"),
    path.resolve(__dirname, "../cookies.json"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      logger.info({ path: p }, "تحميل الكوكيز من");
      return JSON.parse(fs.readFileSync(p, "utf-8"));
    }
  }
  throw new Error("ملف الكوكيز غير موجود. جُرِّبت: " + candidates.join(", "));
}

// ── تشغيل البوت ───────────────────────────────────────────────────────────────
export function startBot() {
  if (botStatus === "connecting" || botStatus === "connected") {
    logger.info("البوت يعمل بالفعل");
    return;
  }

  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

  botRunning = true;
  botStatus = "connecting";
  botError = null;
  logger.info("جارٍ تشغيل بوت ماسنجر...");

  let cookies: any[];
  try { cookies = loadCookies(); }
  catch (err: any) {
    botStatus = "error";
    botError = err.message;
    logger.error({ err }, "فشل تحميل الكوكيز");
    return;
  }

  const appState = cookies.map((c) => ({
    key: c.key, value: c.value,
    domain: c.domain || "facebook.com", path: c.path || "/",
    hostOnly: c.hostOnly ?? false,
    creation: c.creation || new Date().toISOString(),
    lastAccessed: c.lastAccessed || new Date().toISOString(),
  }));

  const loginOptions = {
    appState,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
    logLevel: "silent",
    forceLogin: false,
    autoMarkRead: false,
    autoMarkDelivery: false,
  };

  login(loginOptions, (err: any, fbApi: any) => {
    if (err) {
      botStatus = "error";
      botError = err.error || String(err);
      logger.error({ err }, "فشل تسجيل الدخول — إعادة المحاولة بعد دقيقتين");
      // انتظر دقيقتين قبل إعادة المحاولة لتجنب حجب فيسبوك
      reconnectTimer = setTimeout(() => {
        botStatus = "disconnected";
        startBot();
      }, 120000);
      return;
    }

    api = fbApi;
    currentUserID = fbApi.getCurrentUserID();
    botStatus = "connected";
    logger.info({ userID: currentUserID }, "تم الاتصال بماسنجر فيسبوك بنجاح");
    logger.info({ developers: [...DEVELOPERS] }, "المطورون المعتمدون");

    // ── حفظ الكوكيز المحدّثة فور تسجيل الدخول الناجح ────────────────────────
    try {
      const updatedAppState = fbApi.getAppState();
      const cookiePath = resolvePath("cookies.json");
      fs.writeFileSync(cookiePath, JSON.stringify(updatedAppState, null, 4), "utf-8");
      logger.info({ path: cookiePath }, "تم حفظ الكوكيز المحدّثة");
    } catch (e) {
      logger.warn({ err: e }, "تحذير: فشل حفظ الكوكيز المحدّثة");
    }

    // ── استئناف العواصف المحفوظة بعد أي إعادة اتصال أو تحديث كوكيز ─────────
    for (const threadID of persistedStormThreads) {
      createStormTimer(threadID);
      logger.info({ threadID }, "تم استئناف العاصفة المحفوظة");
    }

    // احفظ أي تحديثات تلقائية يعيدها فيسبوك أثناء بقاء الجلسة فعالة.
    if (cookiePersistTimer) clearInterval(cookiePersistTimer);
    cookiePersistTimer = setInterval(() => {
      if (!api) return;
      try {
        const refreshedAppState = api.getAppState();
        const cookiePath = resolvePath("cookies.json");
        fs.writeFileSync(cookiePath, JSON.stringify(refreshedAppState, null, 4), "utf-8");
        logger.info({ path: cookiePath }, "تم حفظ تحديثات الكوكيز تلقائياً");
      } catch (e) {
        logger.warn({ err: e }, "تعذر حفظ تحديثات الكوكيز تلقائياً");
      }
    }, 10 * 60 * 1000);

    api.setOptions({
      selfListen: false,
      listenEvents: true,
      autoMarkDelivery: false,
      autoMarkRead: false,
      logLevel: "silent",
    });

    logger.info("بدء الاستماع عبر MQTT...");

    api.listenMqtt((listenErr: any, message: any) => {
      if (listenErr) {
        const errMsg = listenErr?.error ?? String(listenErr);
        logger.warn({ err: errMsg }, "خطأ MQTT");

        // أخطاء قاتلة تستوجب إعادة تسجيل الدخول كاملاً
        const isFatal =
          typeof errMsg === "string" &&
          (errMsg.includes("Connection refused") ||
            errMsg.includes("Failed to get sequence ID") ||
            errMsg.includes("invalid appstate") ||
            errMsg.includes("Not logged in"));

        if (isFatal) {
          logger.warn("خطأ MQTT قاتل — إعادة تشغيل البوت بعد 30 ثانية");
          api = null;
          botStatus = "disconnected";
          if (cookiePersistTimer) { clearInterval(cookiePersistTimer); cookiePersistTimer = null; }
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => {
            botStatus = "disconnected";
            startBot();
          }, 30000);
        }
        return;
      }
      if (!message) return;

      // ── حدث انضمام عضو جديد ───────────────────────────────────────────
      if (message.type === "event" && message.logMessageType === "log:subscribe") {
        const tid: string = message.threadID;
        const added: any[] = message.logMessageData?.addedParticipants ?? [];
        for (const p of added) {
          const uid: string = p.userFbId ?? p.id ?? "";
          if (!uid || uid === currentUserID) continue;
          try {
            api.sendMessage(
              `🌑 أهلاً وسهلاً بالعضو الجديد في الجروب! 🤍\n\nأوامر الفعاليات:\n🎮 تخمين — لعبة تخمين الرقم\n🧠 معلومة — معلومة جديدة كل مرة\n😂 نكتة — للضحكة\n💬 اقتباس — اقتباس من DOSK\n\n𝐃𝐎𝐒𝐊 𝐁𝐨𝐭 🌬`,
              tid,
              () => {}
            );
          } catch {}
        }
        return;
      }

      // ── حدث تغيير اسم الجروب ──────────────────────────────────────────
      if (message.type === "event" && message.logMessageType === "log:thread-name") {
        const tid: string = message.threadID;
        if (protectedThreads.has(tid)) {
          const originalName = protectedGroupNames.get(tid);
          const newName: string = message.logMessageData?.name ?? "";
          const changerID: string = message.author ?? message.senderID ?? "مجهول";
          if (originalName && newName !== originalName) {
            logger.info({ tid, originalName, newName, changerID }, "⚠️ محاولة تغيير اسم الجروب — جارٍ الاستعادة");
            try { api.setTitle(originalName, tid, () => {}); } catch {}
            try {
              api.sendMessage(
                `🛡️ درع حماية الاسم\n\n❌ تم رصد محاولة تغيير الاسم!\n👤 المُغيِّر: ${changerID}\n🔄 الاسم المحاول: ${newName}\n✅ تم استعادة الاسم الأصلي: ${originalName}`,
                tid, () => {}
              );
            } catch {}
          }
        }
        return;
      }

      // ── حدث تغيير كنية عضو ────────────────────────────────────────────
      if (message.type === "event" && message.logMessageType === "log:user-nickname") {
        const tid: string = message.threadID;
        if (protectedThreads.has(tid)) {
          const nickMap = protectedNicknames.get(tid);
          const targetUID: string = message.logMessageData?.participant_id ?? "";
          const originalNick = nickMap?.get(targetUID) ?? "";
          const newNick: string = message.logMessageData?.nickname ?? "";
          if (newNick !== originalNick) {
            logger.info({ tid, targetUID, originalNick, newNick }, "⚠️ محاولة تغيير كنية — جارٍ الاستعادة");
            try {
              api.changeNickname(originalNick, tid, targetUID, () => {});
            } catch {}
            try {
              api.sendMessage(`🛡️ تم رصد تغيير الكنية والعودة إليها تلقائياً.`, tid, () => {});
            } catch {}
          }
        }
        return;
      }

    if (handleLopLeave(api, message, currentUserID)) return; 
      if (message.type !== "message") return;
      const { threadID, body, senderID, messageID } = message;
      if (senderID === currentUserID) return;
      logger.info({ threadID, senderID, body }, "رسالة جديدة");
      handleMessage(threadID, body ?? "", senderID, messageID).catch((e) =>
        logger.error({ err: e }, "خطأ في معالجة الرسالة")
      );
    });
  });
}
