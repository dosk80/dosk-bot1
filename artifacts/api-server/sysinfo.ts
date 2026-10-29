import os from "os";
import fs from "fs";

// ── مساعدات التنسيق ──────────────────────────────────────────────────────────
function fmtBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 2 : 0)} ${units[i]}`;
}

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${d}ي ${h}س ${m}د ${s}ث`;
}

function bar(percent: number): string {
  const p = Math.max(0, Math.min(100, percent));
  const filled = Math.round(p / 10);
  return "█".repeat(filled) + "░".repeat(10 - filled) + ` ${p.toFixed(0)}%`;
}

function readNum(p: string): number | null {
  try {
    const v = fs.readFileSync(p, "utf-8").trim();
    if (v === "max") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

// ── الذاكرة: حد الحاوية (cgroup) إن وُجد، وإلا ذاكرة الجهاز ───────────────────
function getMemory(): { total: number; used: number; scope: string } {
  const v2Limit = readNum("/sys/fs/cgroup/memory.max");
  const v2Used = readNum("/sys/fs/cgroup/memory.current");
  if (v2Limit && v2Used !== null && v2Limit < os.totalmem() * 2) {
    return { total: v2Limit, used: v2Used, scope: "الحاوية" };
  }
  const v1Limit = readNum("/sys/fs/cgroup/memory/memory.limit_in_bytes");
  const v1Used = readNum("/sys/fs/cgroup/memory/memory.usage_in_bytes");
  if (v1Limit && v1Used !== null && v1Limit < os.totalmem() * 2) {
    return { total: v1Limit, used: v1Used, scope: "الحاوية" };
  }
  const total = os.totalmem();
  return { total, used: total - os.freemem(), scope: "الجهاز" };
}

// ── التخزين ──────────────────────────────────────────────────────────────────
function getDisk(): { total: number; used: number } | null {
  try {
    const s: any = (fs as any).statfsSync("/");
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    return { total, used: total - free };
  } catch {
    return null;
  }
}

// ── النص النهائي ─────────────────────────────────────────────────────────────
export function getSysInfo(botUserID?: string | null): string {
  const mem = getMemory();
  const memPct = (mem.used / mem.total) * 100;
  const disk = getDisk();
  const cpus = os.cpus();
  const load = os.loadavg();
  const proc = process.memoryUsage();

  const lines: string[] = [];
  lines.push("╔═══『 🖥️ معلومات البوت 』═══╗");
  lines.push("");
  lines.push("🤖 البوت");
  lines.push(`• الحساب: ${botUserID ?? "—"}`);
  lines.push(`• مدة تشغيل البوت: ${fmtUptime(process.uptime())}`);
  lines.push(`• Node.js: ${process.version}`);
  lines.push(`• PID: ${process.pid}`);
  lines.push(`• استهلاك البوت للرام: ${fmtBytes(proc.rss)}`);
  lines.push("");
  lines.push("🌐 المنصة");
  lines.push(`• النظام: ${os.type()} ${os.release()} (${os.arch()})`);
  lines.push(`• الاسم: ${os.hostname()}`);
  lines.push(`• مدة تشغيل السيرفر: ${fmtUptime(os.uptime())}`);
  lines.push(`• المنطقة الزمنية: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
  lines.push("");
  lines.push("⚙️ المعالج");
  lines.push(`• الموديل: ${cpus[0]?.model?.trim() ?? "—"}`);
  lines.push(`• الأنوية: ${cpus.length}${cpus[0]?.speed ? ` @ ${cpus[0].speed} MHz` : ""}`);
  lines.push(`• الحِمل (1/5/15 د): ${load.map((n) => n.toFixed(2)).join(" / ")}`);
  lines.push("");
  lines.push(`🧠 الرام (${mem.scope})`);
  lines.push(`${bar(memPct)}`);
  lines.push(`• ${fmtBytes(mem.used)} من ${fmtBytes(mem.total)}`);

  if (disk) {
    const diskPct = (disk.used / disk.total) * 100;
    lines.push("");
    lines.push("💾 التخزين");
    lines.push(`${bar(diskPct)}`);
    lines.push(`• ${fmtBytes(disk.used)} من ${fmtBytes(disk.total)}`);
  }

  lines.push("");
  lines.push("╚═══『 𝐃𝐎𝐒𝐊 𝐁𝐨𝐭 🌑 』═══╝");
  return lines.join("\n");
}

// ── الأمر: /botinfo  |  معلومات البوت ─────────────────────────────────────────
export function handleSysInfoCommand(
  text: string,
  reply: (msg: string) => void,
  botUserID?: string | null
): boolean {
  if (/^(\/botinfo|معلومات البوت)$/i.test(text)) {
    reply(getSysInfo(botUserID));
    return true;
  }
  return false;
}
