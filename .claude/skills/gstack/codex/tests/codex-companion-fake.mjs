#!/usr/bin/env node
// Test stand-in for codex-plugin-cc's codex-companion.mjs.
// Modes (evaluated in order):
//   1. CODEX_COMPANION_FAKE_PAYLOAD: emit that JSON file verbatim to stdout
//   2. (Task 3) spawn ${CODEX_BIN:-codex} with prompt, wrap stdout as plugin JSON
//   3. (Task 3) if no codex binary resolves, emit {"status":1,...} so tests fail loud
//
// Exit code: CODEX_COMPANION_FAKE_EXIT if set, else 0.
// Side log: if CODEX_COMPANION_FAKE_LOG is set, append argv to that file.
import fs from "node:fs";
import process from "node:process";

if (process.env.CODEX_COMPANION_FAKE_LOG) {
  fs.appendFileSync(
    process.env.CODEX_COMPANION_FAKE_LOG,
    `argv: ${process.argv.slice(2).join(" ")}\n`
  );
}

const payloadPath = process.env.CODEX_COMPANION_FAKE_PAYLOAD;
if (payloadPath && fs.existsSync(payloadPath)) {
  process.stdout.write(fs.readFileSync(payloadPath, "utf8"));
  const exitCode = process.env.CODEX_COMPANION_FAKE_EXIT
    ? parseInt(process.env.CODEX_COMPANION_FAKE_EXIT, 10)
    : 0;
  process.exit(exitCode);
}

// Subprocess-delegation mode lands in Task 3.
process.stderr.write("codex-companion-fake: TODO Task 3 implementation\n");
process.exit(2);
