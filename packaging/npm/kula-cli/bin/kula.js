#!/usr/bin/env node
// Launcher: resolves the prebuilt binary shipped in the matching
// @kula-cli/<platform>-<arch> optional dependency and execs it.
"use strict";
const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const exe = process.platform === "win32" ? "kula.exe" : "kula";
const pkg = `@kula-cli/${process.platform}-${process.arch}`;

function locate() {
  if (process.env.KULA_BINARY) return process.env.KULA_BINARY;
  try {
    return require.resolve(`${pkg}/bin/${exe}`);
  } catch {}
  const local = path.join(__dirname, exe); // dev / fallback layout
  if (fs.existsSync(local)) return local;
  return null;
}

const bin = locate();
if (!bin) {
  console.error(`kula: no prebuilt binary for ${process.platform}-${process.arch} (${pkg}).`);
  console.error("Install from source instead:  cargo install kula");
  process.exit(1);
}
const r = spawnSync(bin, process.argv.slice(2), { stdio: "inherit" });
if (r.error) {
  console.error(`kula: ${r.error.message}`);
  process.exit(1);
}
process.exit(r.status ?? 1);
