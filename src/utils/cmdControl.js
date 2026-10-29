/**
 * DOSK BOT — Command Control (per-thread enable/disable)
 * Copyright © 2026 DOSK
 */
"use strict";

const fs = require("fs");
const path = require("path");

const CTRL_PATH = path.join(process.cwd(), "database", "data", "cmdControl.json");

function loadCtrl() {
  try {
    if (!fs.existsSync(CTRL_PATH)) return {};
    return JSON.parse(fs.readFileSync(CTRL_PATH, "utf8")) || {};
  } catch (_) { return {}; }
}

function saveCtrl(data) {
  try {
    fs.mkdirSync(path.dirname(CTRL_PATH), { recursive: true });
    fs.writeFileSync(CTRL_PATH, JSON.stringify(data, null, 2), "utf8");
  } catch (_) {}
}

let _ctrl = loadCtrl();

function reload() { _ctrl = loadCtrl(); }

function getThreadConfig(tid) {
  return _ctrl[String(tid)] || { mode: "blacklist", commands: [] };
}

function setThreadConfig(tid, config) {
  _ctrl[String(tid)] = config;
  saveCtrl(_ctrl);
}

function resetThread(tid) {
  delete _ctrl[String(tid)];
  saveCtrl(_ctrl);
}

function isEnabled(tid, cmdName) {
  if (String(cmdName).toLowerCase() === "help") return true;
  const cfg = getThreadConfig(tid);
  const inList = (cfg.commands || []).map(c => String(c).toLowerCase()).includes(String(cmdName).toLowerCase());
  if (cfg.mode === "whitelist") return inList;
  return !inList;
}

function setCommandEnabled(tid, cmdName, enabled) {
  const name = String(cmdName || "").trim().toLowerCase();
  if (!name || name === "help") return getThreadConfig(tid);

  const current = getThreadConfig(tid);
  const commands = new Set((current.commands || []).map(v => String(v).toLowerCase()));

  if (current.mode === "whitelist") {
    if (enabled) commands.add(name);
    else commands.delete(name);
  } else {
    if (enabled) commands.delete(name);
    else commands.add(name);
  }

  current.commands = Array.from(commands);
  setThreadConfig(tid, current);
  return current;
}

function getAll() {
  return _ctrl;
}

function getAllThreads() {
  return Object.keys(_ctrl);
}

module.exports = {
  reload,
  getThreadConfig,
  setThreadConfig,
  resetThread,
  isEnabled,
  setCommandEnabled,
  getAll,
  getAllThreads
};

