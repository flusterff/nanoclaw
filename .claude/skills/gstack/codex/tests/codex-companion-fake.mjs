#!/usr/bin/env node
// Test stand-in for codex-plugin-cc's codex-companion.mjs.
// Modes (evaluated in order):
//   1. CODEX_COMPANION_FAKE_PAYLOAD: emit that JSON file verbatim to stdout
//   2. spawn ${CODEX_BIN:-codex} with prompt, wrap stdout as plugin-shape JSON
//   3. if no codex binary resolves, emit {"status":1,...} so tests fail loud
//
// Exit code: CODEX_COMPANION_FAKE_EXIT if set, else 0 (except mode 1 override).
// Side log: CODEX_COMPANION_FAKE_LOG if set — append argv per invocation.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import process from "node:process";

function log(line) {
  if (process.env.CODEX_COMPANION_FAKE_LOG) {
    fs.appendFileSync(process.env.CODEX_COMPANION_FAKE_LOG, `${line}\n`);
  }
}

function exitWith(code) {
  const override = process.env.CODEX_COMPANION_FAKE_EXIT;
  process.exit(override != null ? parseInt(override, 10) : code);
}

function emitJson(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

log(`argv: ${process.argv.slice(2).join(" ")}`);

// Mode 1: direct payload override
const payloadPath = process.env.CODEX_COMPANION_FAKE_PAYLOAD;
if (payloadPath && fs.existsSync(payloadPath)) {
  process.stdout.write(fs.readFileSync(payloadPath, "utf8"));
  exitWith(0);
}

// Parse --prompt-file from argv (ignore other flags).
const args = process.argv.slice(2);
let promptFile = null;
let cwd = process.cwd();
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--prompt-file" && i + 1 < args.length) promptFile = args[i + 1];
  if (args[i] === "--cwd" && i + 1 < args.length) cwd = args[i + 1];
}

const prompt = promptFile && fs.existsSync(promptFile)
  ? fs.readFileSync(promptFile, "utf8")
  : "";

// Mode 2: delegate to ${CODEX_BIN:-codex}
const codexBin = process.env.CODEX_BIN || "codex";
// Pass -C <cwd> and the prompt as positional, mimicking `codex exec` shape
// so existing shell stubs that parse -C work without changes.
const child = spawnSync(codexBin, ["-C", cwd, prompt], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"]
});

// Mode 3: fail-loud if codex binary couldn't be invoked
if (child.error || child.status === null) {
  emitJson({
    status: 1,
    threadId: "fake-broken",
    rawOutput: `codex-companion-fake: failed to invoke ${codexBin}: ${child.error ? child.error.message : "no exit status"}`,
    touchedFiles: [],
    reasoningSummary: []
  });
  exitWith(0);
}

// Mode 2 continued: wrap stdout as plugin JSON
const threadId = `fake-${process.pid}-${Date.now()}`;
emitJson({
  status: child.status === 0 ? 0 : 1,
  threadId,
  rawOutput: (child.stdout || "").trim(),
  touchedFiles: [],
  reasoningSummary: []
});
exitWith(0);
