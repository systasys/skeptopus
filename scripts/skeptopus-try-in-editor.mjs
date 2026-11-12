#!/usr/bin/env node
// SkeptOpus / tries the editor extension inside a real editor, the one installed on this machine.
//
//   node scripts/skeptopus-try-in-editor.mjs ["C:/path/to/Code.exe" | "C:/path/to/Cursor.exe"] [--keep]
//
// The editor is started on folders of its own (settings, extensions, journal), all made for the occasion and
// removed afterwards: the user's editor settings, extensions and SkeptOpus journal are not read and not touched.
// A window of the editor opens for a few seconds: this is the real thing, not a stand-in.
// Nothing is downloaded. Exit code 0 only if every step passed inside the editor.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { stage } from "./skeptopus-pack-extension.mjs";

// Folder names only (where editors are installed): nothing secret is read from the environment.
const here = process.env;
const args = process.argv.slice(2);
const keep = args.includes("--keep");
const given = args.find((a) => !a.startsWith("--"));
const usual = process.platform === "win32" ? join(here.LOCALAPPDATA ?? "", "Programs", "Microsoft VS Code", "Code.exe") : process.platform === "darwin" ? "/Applications/Visual Studio Code.app/Contents/MacOS/Electron" : "/usr/share/code/code";
const editor = given ?? usual;
if (!existsSync(editor)) {
  console.error("No editor found at " + editor + ". Give the path of the editor's program.");
  process.exit(64);
}

const work = mkdtempSync(join(tmpdir(), "skeptopus-host-"));
const home = join(work, "home");
const out = join(work, "seen.json");
mkdirSync(home);
mkdirSync(join(work, "ws"));
// A journal for the occasion: one thing seen and one not found today, in French, so the status bar has something to say.
const today = new Date();
const at = (minutesAgo) => new Date(today.getTime() - minutesAgo * 60000).toISOString();
const row = (verdict, why) => ({ verdict, kind: "FILE_WRITTEN", target: verdict === "PROVEN" ? "a.md" : "b.md", why });
writeFileSync(join(home, "config.json"), JSON.stringify({ lang: "fr" }));
writeFileSync(
  join(home, "historique.jsonl"),
  [{ at: at(2), verdict: "PROVEN", source: "claude", cwd: "x", rows: [row("PROVEN", "FILE_PRESENT")] }, { at: at(1), verdict: "NOT_PROVEN", source: "cursor", cwd: "x", rows: [row("NOT_PROVEN", "FILE_ABSENT")] }].map((e) => JSON.stringify(e)).join("\n") + "\n",
);
const staged = stage(join(work, "ext"), { withHostTest: true });

// The editor must start as an editor, on its own: nothing inherited from another editor's terminal.
const env = Object.fromEntries(Object.entries(here).filter(([key]) => !/^(ELECTRON_|VSCODE_)/.test(key)));
Object.assign(env, { SKEPTOPUS_HOME: home, SKEPTOPUS_HOST_TEST_OUT: out, SKEPTOPUS_HOST_TEST_LANG: "fr" });
const child = spawn(
  editor,
  [join(work, "ws"), "--extensionDevelopmentPath=" + staged.dir, "--extensionTestsPath=" + join(staged.dir, "host-test", "suite.js"), "--user-data-dir=" + join(work, "user"), "--extensions-dir=" + join(work, "exts"), "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes", "--disable-updates", "--disable-extensions"],
  // Asked to stay out of the way of whoever is working on this machine; an editor may show its window all the same.
  { env, stdio: "ignore", windowsHide: true },
);
const timer = setTimeout(() => child.kill(), 150000);
child.on("exit", (code) => {
  clearTimeout(timer);
  let seen = null;
  try {
    seen = JSON.parse(readFileSync(out, "utf8"));
  } catch {
    seen = null;
  }
  if (!seen) console.log("The editor left (code " + code + ") without writing what it saw.");
  else {
    console.log(`${seen.editor} ${seen.editorVersion} (node ${seen.node}): ${seen.ok ? "every step passed" : "FAILED"}`);
    for (const s of seen.steps) console.log("  ok  " + s.name + (Object.keys(s).length > 1 ? "  " + JSON.stringify(Object.fromEntries(Object.entries(s).filter(([k]) => k !== "name"))) : ""));
    if (!seen.ok) console.log("\n" + seen.error);
  }
  if (keep) console.log("kept: " + work);
  else {
    // The editor may still be letting go of its files for a moment.
    for (let i = 0; i < 20; i++) {
      try {
        rmSync(work, { recursive: true, force: true });
        break;
      } catch {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
      }
    }
    if (existsSync(work)) console.log("could not remove " + work + " yet: it can be deleted by hand");
  }
  process.exit(seen?.ok && code === 0 ? 0 : 1);
});
