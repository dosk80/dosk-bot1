/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║         DOSK BOT — Watchdog & Process Supervisor                ║
 * ║         Copyright © 2026 DOSK — All rights reserved             ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */
"use strict";

const { spawn } = require("child_process");
const path = require("path");

const MAX_RESTARTS = 30;
const BASE_DELAY_MS = 3000;
const RESET_STABLE_MS = 10 * 60 * 1000;

let restarts = 0;
let child = null;
let stableTimer = null;

const ts = () => new Date().toTimeString().slice(0, 8);
const log = (msg) => console.log(`${ts()} [DOSK WATCHDOG] ${msg}`);

function start() {
  if (restarts >= MAX_RESTARTS) {
    log(`وصل لأقصى عدد إعادات التشغيل (${MAX_RESTARTS}). توقف.`);
    process.exit(1);
  }

  restarts++;
  log(`تشغيل DOSK BOT... (محاولة ${restarts})`);

  child = spawn(process.execPath, [
    "--max-old-space-size=400",
    path.join(__dirname, "Dosk.js")
  ], {
    stdio: "inherit",
    env: { ...process.env }
  });

  if (stableTimer) clearTimeout(stableTimer);
  stableTimer = setTimeout(() => {
    restarts = 0;
    log("البوت مستقر — تم إعادة تعيين العداد");
  }, RESET_STABLE_MS);

  child.on("exit", (code, signal) => {
    if (stableTimer) clearTimeout(stableTimer);
    if (code === 0) {
      log("خروج نظيف — إعادة تشغيل فورية…");
      restarts = 0;
      setTimeout(start, 1000);
      return;
    }
    log(`خرج بكود ${code}/${signal} — إعادة بعد 3 ثوانٍ`);
    setTimeout(start, BASE_DELAY_MS);
  });
}

start();

