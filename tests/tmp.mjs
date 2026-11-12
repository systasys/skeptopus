// A folder made for a test is removed when the test file ends: a test leaves nothing behind.
//
// Found on 2026-11-12: every run left its folders in the system's temporary folder, and SkeptOpus runs this
// suite again each time an agent says "the tests pass". More than five thousand folders had piled up on a disk
// that was 99 % full.
//
// Where they are made: the system's temporary folder, unless this machine names another one in
// tests/tmp-root.local (one line, an absolute folder; ignored by git), for a machine whose system disk is short
// of space. A folder that is not absolute here, or cannot be made, is ignored.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function rootFrom(file, fallback = tmpdir()) {
  try {
    const wanted = readFileSync(file, "utf8").trim();
    if (wanted && isAbsolute(wanted)) {
      mkdirSync(wanted, { recursive: true });
      return resolve(wanted);
    }
  } catch {
    // No such file, or the folder cannot be made: the system's temporary folder.
  }
  return fallback;
}
export const TEST_ROOT = rootFrom(join(dirname(fileURLToPath(import.meta.url)), "tmp-root.local"));

const made = [];
process.on("exit", () => {
  for (const dir of made) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    } catch {
      // Still held by a process started by the test: the next run of the same suite cannot remove it either.
    }
  }
});

/** A new empty folder, gone when this test file ends. */
export function scratch(prefix) {
  const dir = mkdtempSync(join(TEST_ROOT, prefix));
  made.push(dir);
  return dir;
}
