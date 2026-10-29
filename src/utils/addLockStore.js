/**
 * DOSK BOT — AddLock Data Store
 * Copyright © 2026 DOSK
 */
"use strict";

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.resolve(
  process.env.ADDLOCK_DATA_DIR || path.join(process.cwd(), "database", "data", "addlock")
);
const CONFIG_FILE = path.join(process.cwd(), "database", "data", "addLockConfig.json");

function ensureDirectory() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
}

function load() {
  ensureDirectory();
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
      if (data && typeof data === "object" && !Array.isArray(data)) {
        return data;
      }
    }
  } catch (_) {}
  return {};
}

function save(cfg) {
  ensureDirectory();
  const tmp = `${CONFIG_FILE}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(cfg || {}, null, 2), "utf8");
    fs.renameSync(tmp, CONFIG_FILE);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

module.exports = {
  load,
  save
};

