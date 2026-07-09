#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const gitleaksBin = process.env.GITLEAKS_BIN || "gitleaks";
const staged = process.argv.includes("--staged");
const args = staged
  ? ["protect", "--staged", "--config", ".gitleaks.toml", "--redact", "--verbose"]
  : ["detect", "--source", ".", "--config", ".gitleaks.toml", "--no-git", "--redact", "--verbose"];

const result = spawnSync(gitleaksBin, args, {
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error?.code === "ENOENT") {
  console.error(
    "Gitleaks is not installed. Install it from https://github.com/gitleaks/gitleaks, " +
      "or set GITLEAKS_BIN to the scanner executable path.",
  );
  process.exit(127);
}

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
