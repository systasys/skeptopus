#!/usr/bin/env node
// SkeptOpus core / command line and Claude Code "Stop" hook.
//
//   node core/cli.mjs check --message "Done. Committed abc1234, pushed." [--cwd dir] [--also dir]... [--json] [--lang fr|en]
//   node core/cli.mjs check --message-file reply.txt
//   node core/cli.mjs transcript <session.jsonl> [--last N] [--also dir]... [--json]
//   node core/cli.mjs hook        (reads the Stop hook JSON on stdin, prints a message for the human, never blocks)
//
// Exit codes for `check`: 0 proven or nothing claimed, 1 not proven, 2 contradicted, 3 could not check, 64 usage.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createInterface } from "node:readline";

import { extractClaims } from "./claims.mjs";
import { DIR, LANGS, LANG_LABEL, LOCALE, PAGE, WORDS, pickLang, say, sourceLabel } from "./words.mjs";
import { VERDICT, homeOf, loadConfig, observe, overall, rootsOf } from "./observe.mjs";

const COLOR = { PROVEN: 32, NOT_PROVEN: 33, CONTRADICTED: 31, COULD_NOT_CHECK: 33, NOTHING_CLAIMED: 90 };
const paint = (verdict, text, on) => (on ? "\u001b[1;" + COLOR[verdict] + "m" + text + "\u001b[0m" : text);

export async function check(message, ctx) {
  const claims = extractClaims(message);
  const rows = [];
  for (const claim of claims) {
    const seen = await observe(claim, ctx);
    rows.push({ claim, ...seen, verdict: VERDICT[seen.outcome] });
  }
  return { verdict: overall(rows.map((r) => r.verdict)), rows };
}
export function render(report, lang = "en", color = false) {
  const w = WORDS[pickLang(lang)];
  const lines = [w.head + " · " + paint(report.verdict, "[ " + w[report.verdict] + " ]", color)];
  if (!report.rows.length) lines.push("  " + w.none);
  for (const row of report.rows) {
    const what = (row.claim.negated ? w.not : "") + w.kind[row.claim.kind] + (target(row.claim) ? " " + target(row.claim) : "");
    lines.push("  " + paint(row.verdict, ("[" + w[row.verdict] + "]").padEnd(15), color) + what + w.sep + say(lang, row.why) + (row.facts?.check ? w.open + row.facts.check + w.close : ""));
  }
  return lines.join("\n");
}

const SWITCHES = new Set(["--json", "--dry-run", "--no-shortcut", "--open", "--print", "--embedded"]);
function parse(argv) {
  const o = { also: [], _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--also") o.also.push(argv[++i]);
    else if (SWITCHES.has(a)) o[a.slice(2)] = true;
    else if (a.startsWith("--")) o[a.slice(2)] = argv[++i];
    else o._.push(a);
  }
  return o;
}
async function readTranscript(path) {
  const turns = [];
  let sessionStart = null;
  const rl = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec.timestamp && !sessionStart) sessionStart = rec.timestamp;
    if (rec.type !== "assistant" || rec.isSidechain) continue;
    const text = (Array.isArray(rec.message?.content) ? rec.message.content : []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    if (text.trim()) turns.push({ at: rec.timestamp, cwd: rec.cwd, text });
  }
  return { sessionStart, turns };
}
/** First timestamp of a session log, without reading the whole file (they grow to tens of megabytes). */
async function sessionStartOf(path) {
  const input = createReadStream(path, { encoding: "utf8" });
  const rl = createInterface({ input, crlfDelay: Infinity });
  try {
    let seen = 0;
    for await (const line of rl) {
      const at = /"timestamp":"([^"]+)"/.exec(line)?.[1];
      if (at) return at;
      if (++seen > 200) break;
    }
  } finally {
    rl.close();
    input.destroy();
  }
  return undefined;
}
export function summary(report, lang = "en") {
  const w = WORDS[pickLang(lang)];
  return w.head + " · [ " + w[report.verdict] + " ] " + w.checked(report.rows.length);
}
const exitOf = { PROVEN: 0, NOTHING_CLAIMED: 0, NOT_PROVEN: 1, CONTRADICTED: 2, COULD_NOT_CHECK: 3 };

async function main() {
  const [mode, ...rest] = process.argv.slice(2);
  const o = parse(rest);
  const langFor = (config) => pickLang(o.lang ?? config?.lang);
  if (mode === "check") {
    const message = o["message-file"] ? readFileSync(o["message-file"], "utf8") : o.message;
    if (!message) return usage();
    const cwd = o.cwd ?? process.cwd();
    const config = loadConfig(o.config, cwd);
    const report = await check(message, { roots: rootsOf(cwd, config, o.also), sessionStart: o.since, config, allowSlow: true });
    console.log(o.json ? JSON.stringify(report, null, 2) : render(report, langFor(config), process.stdout.isTTY));
    process.exit(exitOf[report.verdict]);
  }
  if (mode === "transcript") {
    if (!o._[0]) return usage();
    const { sessionStart, turns } = await readTranscript(o._[0]);
    const picked = o.last ? turns.slice(-Number(o.last)) : turns;
    const all = [];
    const memo = {}; // one test run for the whole transcript
    for (const turn of picked) {
      const roots = [...new Set([turn.cwd, ...o.also].filter(Boolean))];
      const report = await check(turn.text, { roots, sessionStart, memo, config: loadConfig(o.config, roots[0] ?? ".") });
      all.push({ at: turn.at, ...report });
      if (!o.json && report.rows.length) console.log(turn.at + "\n" + render(report, langFor(undefined), process.stdout.isTTY) + "\n");
    }
    if (o.json) console.log(JSON.stringify({ sessionStart, messages: all }, null, 2));
    return;
  }
  if (mode === "hook") {
    // Observe only: the human is told, the agent is never blocked. A broken checker must not break the session.
    try {
      // Some tools hand the event as an argument instead of stdin (and then stdin never closes).
      const inline = o._.find((a) => a.trim().startsWith("{"));
      let raw = inline ?? "";
      if (!inline) for await (const chunk of process.stdin) raw += chunk;
      const input = normalize(JSON.parse(raw));
      // The same turn can reach SkeptOpus twice (a trigger in the user's settings and another in a project's):
      // the human gets one answer, and the journal one entry.
      if (!firstForThisTurn(input)) process.exit(0);
      const cwd = input.cwd ?? process.cwd();
      const sessionStart = input.transcript ? await sessionStartOf(input.transcript).catch(() => undefined) : undefined;
      const config = loadConfig(undefined, cwd);
      const ctx = { roots: rootsOf(cwd, config), sessionStart, config };
      const report = await check(input.message, ctx);
      // Long measurements run on their own, after the turn: their answer goes to the journal and the notification.
      for (const sentence of [...new Set(ctx.deferred ?? [])]) {
        spawn(process.execPath, [SELF, "later", "--cwd", cwd, "--from", o.from ?? "claude", "--text", sentence], { detached: true, stdio: "ignore", windowsHide: true }).unref();
      }
      if (report.rows.length) {
        // The human must be able to come back to it later: every check is kept, and the journal page is refreshed.
        try {
          remember(report, { session: input.session, cwd, source: o.from ?? "claude" });
        } catch {
          // A journal that cannot be written must never cost the user their session.
        }
        // Quiet when everything was seen: one line. Detailed only when something needs the human's eye.
        const lang = langFor(config);
        const text = report.verdict === "PROVEN" ? summary(report, lang) : render(report, lang, false);
        const out = o.out ?? "claude";
        if (out === "claude") console.log(JSON.stringify({ systemMessage: text }));
        else if (out === "text") console.log(text);
        // "none": the journal, the sound and the notification are the only signals.
        signal(report, lang, config);
      }
    } catch (error) {
      console.error("skeptopus: " + String(error?.message ?? error).slice(0, 200));
    }
    process.exit(0);
  }
  if (mode === "later") {
    // The second half of a check: the measurements that were too long to hold a turn.
    const cwd = o.cwd ?? process.cwd();
    const config = loadConfig(o.config, cwd);
    const report = await check(String(o.text ?? ""), { roots: rootsOf(cwd, config), config, allowSlow: true });
    const kept = { ...report, rows: report.rows.filter((r) => r.claim.kind === "MEASURED") };
    kept.verdict = overall(kept.rows.map((r) => r.verdict));
    if (kept.rows.length) {
      remember(kept, { cwd, source: (o.from ?? "claude") + " · remeasured" });
      // The human was left waiting for this one: a good answer is told too.
      signal(kept, langFor(config), config, { whatever: true });
    }
    return;
  }
  if (mode === "version" || mode === "--version" || mode === "-v") {
    console.log(VERSION);
    return;
  }
  if (mode === "install" || mode === "uninstall" || mode === "status") {
    const options = { home: o.home, dryRun: Boolean(o["dry-run"]), shortcuts: !o["no-shortcut"], skip: String(o.skip ?? "").split(",").filter(Boolean) };
    const outcome = mode === "install" ? install(options) : mode === "uninstall" ? uninstall(options) : status(options);
    console.log(o.json ? JSON.stringify(outcome, null, 2) : tell(mode, outcome, langFor(loadConfig(undefined, process.cwd()))));
    process.exit(outcome.ok === false ? 1 : 0);
  }
  if (mode === "attach" || mode === "detach") {
    const tool = o._[0];
    const outcome = (mode === "attach" ? attach : detach)(tool, { home: o.home, dryRun: rest.includes("--dry-run") });
    console.log(JSON.stringify(outcome, null, 2));
    process.exit(outcome.ok ? 0 : 1);
  }
  if (mode === "glance") {
    // What a host shows in one line (an editor's status bar): the state of the day, in every language.
    const seen = glance();
    console.log(o.json ? JSON.stringify(seen) : seen.texts[pickLang(o.lang ?? seen.lang)].mood);
    return;
  }
  if (mode === "clip") {
    // Works with any AI, even a chat in a browser: copy its answer, then ask SkeptOpus.
    // A host that reads the clipboard itself hands the text over in a file.
    const text = o["text-file"] ? readFileSync(o["text-file"], "utf8") : await clipboard();
    const cwd = o.cwd ?? process.cwd();
    const config = loadConfig(o.config, cwd);
    if (text === null) {
      // No program on this machine reads the clipboard: said as such, never as "the clipboard is empty".
      console.log(WORDS[langFor(config)].noClipboard);
      process.exit(3);
    }
    const report = await check(text, { roots: rootsOf(cwd, config, o.also), config, allowSlow: true });
    remember(report, { cwd, source: "clipboard", excerpt: text.trim().slice(0, 160) });
    console.log(text.trim() ? render(report, langFor(config), process.stdout.isTTY) : WORDS[langFor(config)].clipboardEmpty);
    // The human asked and is looking: the answer has its sound, and needs no window.
    if (report.rows.length) signal(report, langFor(config), config, { whatever: true, window: false });
    if (rest.includes("--open")) {
      const page = writeJournal();
      if (!(await openPage(page))) console.log(WORDS[langFor(config)].noOpener(page));
    }
    return;
  }
  if (mode === "journal") {
    // Rebuild the page from the history and say where it is. --open shows it in the default browser.
    // --print hands the page itself to a host that shows it in its own window (an editor's side panel):
    // the file on disk is left as it is, and nothing is printed but the page.
    if (o.print) {
      process.stdout.write(journalFor(homeDir(), { embedded: Boolean(o.embedded), fonts: o.fonts, nonce: o.nonce, csp: o.csp, lang: o.lang }));
      return;
    }
    const page = writeJournal();
    console.log(page);
    // No desktop to open it with (a server, a Linux without one): the path is printed above; say what to do with it.
    if (rest.includes("--open") && !(await openPage(page))) console.log(WORDS[langFor(loadConfig(o.config, process.cwd()))].noOpener(page));
    return;
  }
  if (mode === "replay") {
    // Fill the journal from a past session. The look is taken now, and each entry says so.
    if (!o._[0]) return usage();
    const { sessionStart, turns } = await readTranscript(o._[0]);
    const memo = {};
    let kept = 0;
    for (const turn of turns) {
      const roots = [...new Set([turn.cwd, ...o.also].filter(Boolean))];
      const report = await check(turn.text, { roots, sessionStart, memo, config: loadConfig(o.config, roots[0] ?? ".") });
      if (!report.rows.length) continue;
      remember(report, { cwd: turn.cwd, at: turn.at, replayed: true }, false);
      kept++;
    }
    console.log(kept + " → " + writeJournal());
    return;
  }
  usage();
}

/**
 * True for the first trigger that brings a given turn, false for a second one arriving within seconds.
 * The claim is taken by creating a folder, which only one process can do. On any other trouble it answers
 * true: better two answers than none.
 */
export function firstForThisTurn(input, dir = homeDir(), now = Date.now()) {
  if (!String(input?.message ?? "").trim()) return true;
  try {
    const locks = join(dir, "verrous");
    mkdirSync(locks, { recursive: true });
    for (const name of readdirSync(locks)) {
      try {
        if (now - statSync(join(locks, name)).mtimeMs > 15000) rmdirSync(join(locks, name));
      } catch {
        // Another process is tidying the same folder.
      }
    }
    const key = createHash("sha256").update(String(input.session ?? "") + "\n" + input.message).digest("hex").slice(0, 24);
    mkdirSync(join(locks, key));
    return true;
  } catch (error) {
    return error?.code !== "EEXIST";
  }
}

// ---------- any tool: one way in ----------
/**
 * Tools name things differently ("last_assistant_message", "last-assistant-message", "text"...).
 * SkeptOpus takes the first field that holds the agent's final words, and the first that holds a folder.
 */
export function normalize(input, env = process.env) {
  const at = (path) => path.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), input);
  const pick = (...paths) => {
    for (const p of paths) {
      const v = at(p);
      if (typeof v === "string" && v.trim()) return v;
    }
    return undefined;
  };
  const roots = [input?.workspace_roots, input?.workspaceRoots, input?.workspacePaths, input?.workspace_folders].find(Array.isArray) ?? [];
  return {
    message: pick("last_assistant_message", "last-assistant-message", "lastAssistantMessage", "final_message", "finalMessage", "prompt_response", "response", "assistant_message", "text", "message", "output") ?? "",
    cwd:
      pick("cwd", "workspace_root", "workspaceRoot", "working_directory", "workingDirectory", "project_dir") ??
      roots.find((r) => typeof r === "string") ??
      [env.CURSOR_PROJECT_DIR, env.GEMINI_CWD, env.GEMINI_PROJECT_DIR, env.DEVIN_PROJECT_DIR, env.CLAUDE_PROJECT_DIR].find((v) => typeof v === "string" && v),
    session: pick("session_id", "sessionId", "conversation_id", "conversationId", "thread-id", "thread_id", "generation_id"),
    transcript: pick("transcript_path", "transcriptPath"),
  };
}
// A Linux machine may have no desktop, or one of several clipboards: each need lists the usual programs, and the
// first one present does the job. Seen under Linux on 2026-11-12: with no xdg-open, "journal --open" crashed.
const inWsl = (env = process.env) => Boolean(env.WSL_DISTRO_NAME);
const WINDOWS_CLIPBOARD = ["-NoProfile", "-Command", "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard -Raw"];
const openers = (page) =>
  process.platform === "win32" ? [["cmd", ["/c", "start", "", page]]] : process.platform === "darwin" ? [["open", [page]]] : [["xdg-open", [page]], ...(inWsl() ? [["wslview", [page]]] : [])];
const pasters = () =>
  process.platform === "win32"
    ? [["powershell", WINDOWS_CLIPBOARD]]
    : process.platform === "darwin"
      ? [["pbpaste", []]]
      : [["wl-paste", ["--no-newline"]], ["xclip", ["-selection", "clipboard", "-o"]], ["xsel", ["--clipboard", "--output"]], ...(inWsl() ? [["powershell.exe", WINDOWS_CLIPBOARD]] : [])];
/** Shows the page with the first program present that opens one. False when this machine has none. */
export function openPage(page, candidates = openers(page)) {
  return new Promise((done) => {
    const next = (i) => {
      if (i >= candidates.length) return done(false);
      const child = spawn(candidates[i][0], candidates[i][1], { detached: true, stdio: "ignore", windowsHide: true });
      child.on("error", () => next(i + 1)); // Not on this machine: the next one.
      child.on("spawn", () => {
        child.unref();
        done(true);
      });
    };
    next(0);
  });
}
/** What was copied, read by the first clipboard program present. "" when one ran and found nothing, null when there is none. */
export function clipboard(candidates = pasters()) {
  return new Promise((done) => {
    let ranOne = false;
    const next = (i) => {
      if (i >= candidates.length) return done(ranOne ? "" : null);
      let out = "";
      let moved = false;
      const move = (then) => {
        if (moved) return;
        moved = true;
        then();
      };
      const child = spawn(candidates[i][0], candidates[i][1], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
      child.stdout.on("data", (d) => (out += d));
      child.on("error", () => move(() => next(i + 1)));
      child.on("spawn", () => (ranOne = true));
      // A program that runs but fails (a Wayland reader in an X session) leaves the next one its chance.
      child.on("close", (code) => move(() => (code === 0 ? done(out) : next(i + 1))));
    };
    next(0);
  });
}
// ---------- what reaches the human outside the agent's conversation ----------
// A sound of SkeptOpus's own for each answer (core/sounds, written by scripts/skeptopus-make-sounds.mjs), and on
// Windows a small window. Each follows its own setting: "always", "problems" (anything but "seen") or "never".
// The sound follows the window's setting until the user says otherwise ("sound" in config.json).
const wanted = (wish, verdict, whatever) => wish === "always" || (wish === "problems" && (whatever || verdict !== "PROVEN"));
/**
 * What will be played and shown for this answer, decided from the settings alone: no sound is started here.
 * `whatever` is for an answer the human is waiting for (a long measurement that comes back): "problems" then
 * lets a good answer through too.
 */
export function signalPlan(report, config = {}, { whatever = false, platform = process.platform, sounds = join(dirname(SELF), "sounds") } = {}) {
  const file = join(sounds, String(report.verdict).toLowerCase() + ".wav");
  return {
    window: platform === "win32" && wanted(config?.notify ?? "never", report.verdict, whatever),
    sound: wanted(config?.sound ?? config?.notify ?? "never", report.verdict, whatever) && existsSync(file) ? file : null,
  };
}
function signal(report, lang, config, options = {}) {
  const plan = signalPlan(report, config, options);
  if (options.window === false) plan.window = false;
  if (!plan.window && !plan.sound) return;
  const quiet = { detached: true, stdio: "ignore", windowsHide: true };
  try {
    if (process.platform === "win32") {
      // One hidden process for both: the sound first, the window beside it.
      const player = plan.sound ? "(New-Object System.Media.SoundPlayer '" + plan.sound.replace(/'/g, "''") + "')" : "";
      let script = player ? player + (plan.window ? ".Play(); " : ".PlaySync()") : "";
      if (plan.window) {
        const w = WORDS[pickLang(lang)];
        const icon = report.verdict === "PROVEN" ? "Info" : report.verdict === "CONTRADICTED" ? "Error" : "Warning";
        const worst = report.rows.find((r) => r.verdict === report.verdict);
        const line = worst ? (w.kind[worst.claim.kind] ?? "") + w.sep + say(lang, worst.why) : "";
        const clean = (s) => String(s).replace(/['`$"\r\n]/g, " ").slice(0, 180);
        script +=
          "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; " +
          "$n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Information; $n.Visible = $true; " +
          "$n.ShowBalloonTip(6000, 'SkeptOpus" + clean(w.sep) + clean(w[report.verdict]) + "', '" + clean(line) + "', [System.Windows.Forms.ToolTipIcon]::" + icon + "); Start-Sleep -Seconds 7; $n.Dispose()";
      }
      spawn("powershell", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", script], quiet).unref();
    } else if (plan.sound) {
      // macOS has its own player. Elsewhere, the first of the usual two that exists. Not tried on a Mac.
      const players = process.platform === "darwin" ? [["afplay", [plan.sound]]] : [["paplay", [plan.sound]], ["aplay", ["-q", plan.sound]]];
      const tryNext = (i) => {
        if (i >= players.length) return;
        const child = spawn(players[i][0], players[i][1], quiet);
        child.on("error", () => tryNext(i + 1)); // That player is not on this machine.
        child.unref();
      };
      tryNext(0);
    }
  } catch {
    // A missing sound or window is not worth an error.
  }
}

// ---------- attaching SkeptOpus to a tool ----------
// Contracts read in each vendor's official documentation on 2026-11-12. Only tools that hand the agent's
// final words to a hook can be attached; the others are named, with the reason, instead of being faked.
const SELF = fileURLToPath(import.meta.url);
/**
 * How a tool is told to start SkeptOpus. A tool opened from the desktop does not always inherit the terminal's
 * search path, so the trigger names the very program that is running now, by its full path. Two exceptions,
 * where the plain name is the one that lasts:
 *  - a path with a space would need quotes at the head of the line, and the shells a tool may use
 *    (cmd, PowerShell, bash) do not agree on what a line starting with a quote means;
 *  - version managers keep each version in its own folder, and that path dies at the next upgrade.
 */
export function nodeForHooks(execPath = process.execPath) {
  const path = String(execPath).replace(/\\/g, "/");
  const fragile = /\s/.test(path) || !path.includes("/") || /\/(\.?nvm|\.?fnm|fnm_multishells|\.volta|\.asdf|\.nodenv|\.n|nodebrew)\//i.test(path);
  // SkeptOpus can be started by a program that only plays node for the occasion (an editor running its own
  // extension). Written into a trigger, that program would open the editor at every answer: never named.
  const itself = /\/node(\.exe)?$/i.test(path);
  return fragile || !itself ? "node" : path;
}
/**
 * Claude Code runs its triggers through bash (Git Bash on Windows), where a quoted full path is safe even with a
 * space: on the machine this was built on, its eight other triggers are written that way and fire.
 * Not verified: a Windows setup of Claude Code without Git Bash.
 */
const quotedNode = (execPath = process.execPath) => {
  const plain = nodeForHooks(String(execPath).replace(/\s/g, "_"));
  return plain === "node" ? "node" : '"' + String(execPath).replace(/\\/g, "/") + '"';
};
const hookCommand = (tool, out, engine = SELF) => (TOOLS[tool]?.posixShell ? quotedNode() : nodeForHooks()) + ' "' + engine.replace(/\\/g, "/") + '" hook --from ' + tool + " --out " + out;
const TOOLS = {
  claude: {
    file: (home) => join(home, ".claude", "settings.json"),
    posixShell: true,
    // Claude Code shows systemMessage to the human at the end of the turn.
    add: (cfg, cmd) => {
      cfg.hooks ??= {};
      (cfg.hooks.Stop ??= []).push({ hooks: [{ type: "command", command: cmd, timeout: 30 }] });
    },
    strip: (cfg) => stripNested(cfg?.hooks?.Stop),
    out: "claude",
    then: "",
    thenEn: "",
  },
  codex: {
    file: (home) => join(home, ".codex", "hooks.json"),
    // Codex shows systemMessage as a warning in its interface.
    add: (cfg, cmd) => {
      cfg.hooks ??= {};
      (cfg.hooks.Stop ??= []).push({ hooks: [{ type: "command", command: cmd, timeout: 30 }] });
    },
    strip: (cfg) => stripNested(cfg?.hooks?.Stop),
    out: "claude",
    then: "Dans Codex, ouvrez /hooks et acceptez le nouveau déclencheur : Codex ignore un déclencheur tant qu'il n'est pas approuvé.",
    thenEn: "In Codex, open /hooks and accept the new hook: Codex ignores a hook until it is approved.",
  },
  cursor: {
    file: (home) => join(home, ".cursor", "hooks.json"),
    // Cursor documents no field shown to the human: the journal and the notification carry the answer.
    add: (cfg, cmd) => {
      cfg.version ??= 1;
      cfg.hooks ??= {};
      (cfg.hooks.afterAgentResponse ??= []).push({ command: cmd });
    },
    strip: (cfg) => stripFlat(cfg?.hooks?.afterAgentResponse),
    out: "none",
    then: "Cursor n'affiche rien venant d'un déclencheur : le verdict arrive dans le journal SkeptOpus et par la notification.",
    thenEn: "Cursor shows nothing coming from a hook: the verdict arrives in the SkeptOpus journal and as a notification.",
  },
  gemini: {
    file: (home) => join(home, ".gemini", "settings.json"),
    add: (cfg, cmd) => {
      cfg.hooks ??= {};
      (cfg.hooks.AfterAgent ??= []).push({ matcher: "*", hooks: [{ name: "skeptopus", type: "command", command: cmd, timeout: 30000 }] });
    },
    strip: (cfg) => stripNested(cfg?.hooks?.AfterAgent),
    out: "claude",
    then: "",
  },
};
const NOT_YET = {
  kiro: "Kiro ne transmet à ses déclencheurs ni le dernier message de l'agent ni son journal : SkeptOpus n'a rien à lire. Passez par le copier-coller.",
  copilot: "GitHub Copilot ne transmet pas le dernier message de l'agent à ses déclencheurs, seulement un journal au format non documenté. Passez par le copier-coller.",
  devin: "Devin (ex-Windsurf) ne transmet ni le dernier message ni un journal à ses déclencheurs. Passez par le copier-coller.",
  windsurf: "Windsurf est devenu Devin, qui ne transmet ni le dernier message ni un journal à ses déclencheurs. Passez par le copier-coller.",
};
// SkeptOpus's own line, wherever its engine lives: a home set with SKEPTOPUS_HOME can be any folder, so the line is
// known by the exact shape SkeptOpus writes. Lines written before that shape carried the product's name in their path.
// Found on 2026-11-12, when a test run from a folder named otherwise failed: such a line was never taken back out.
const ours = (command) =>
  typeof command === "string" && /cli\.mjs"? hook --from (?:claude|codex|cursor|gemini)\b/.test(command) && (/ --out (?:claude|text|none)\s*$/.test(command) || /skeptopus/i.test(command));
function stripNested(groups) {
  if (!Array.isArray(groups)) return 0;
  let removed = 0;
  for (const group of groups) {
    if (!Array.isArray(group?.hooks)) continue;
    const before = group.hooks.length;
    group.hooks = group.hooks.filter((h) => !ours(h?.command));
    removed += before - group.hooks.length;
  }
  for (let i = groups.length - 1; i >= 0; i--) if (Array.isArray(groups[i]?.hooks) && !groups[i].hooks.length) groups.splice(i, 1);
  return removed;
}
function stripFlat(list) {
  if (!Array.isArray(list)) return 0;
  const before = list.length;
  for (let i = list.length - 1; i >= 0; i--) if (ours(list[i]?.command)) list.splice(i, 1);
  return before - list.length;
}
function readSettings(file) {
  if (!existsSync(file)) return { cfg: {}, existed: false };
  const raw = readFileSync(file, "utf8");
  if (!raw.trim()) return { cfg: {}, existed: true };
  const cfg = JSON.parse(raw); // A file SkeptOpus cannot read is left alone: the caller reports it.
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) throw new Error("not an object");
  return { cfg, existed: true };
}
export function attach(tool, { home = homedir(), dryRun = false, engine = SELF } = {}) {
  if (NOT_YET[tool]) return { ok: false, tool, reason: "NO_FINAL_MESSAGE_GIVEN_TO_HOOKS", explain: NOT_YET[tool] };
  const spec = TOOLS[tool];
  if (!spec) return { ok: false, tool, reason: "UNKNOWN_TOOL", known: [...Object.keys(TOOLS), ...Object.keys(NOT_YET)] };
  const file = spec.file(home);
  let state;
  try {
    state = readSettings(file);
  } catch {
    return { ok: false, tool, file, reason: "SETTINGS_FILE_UNREADABLE", explain: "Le fichier de réglages existe mais SkeptOpus ne sait pas le lire. Il n'y touche pas." };
  }
  const command = hookCommand(tool, spec.out, engine);
  const already = spec.strip(JSON.parse(JSON.stringify(state.cfg))) > 0;
  if (already) spec.strip(state.cfg); // Re-attaching replaces SkeptOpus's own line, never duplicates it.
  spec.add(state.cfg, command);
  const result = { ok: true, tool, file, command, replaced: already, written: false, backup: null, then: spec.then, thenEn: spec.thenEn ?? "" };
  if (dryRun) return result;
  mkdirSync(dirname(file), { recursive: true });
  if (state.existed) {
    result.backup = file + ".avant-skeptopus";
    if (!existsSync(result.backup)) copyFileSync(file, result.backup);
  }
  writeFileSync(file, JSON.stringify(state.cfg, null, 2) + "\n");
  result.written = true;
  return result;
}
export function detach(tool, { home = homedir(), dryRun = false } = {}) {
  const spec = TOOLS[tool];
  if (!spec) return { ok: false, tool, reason: "UNKNOWN_TOOL" };
  const file = spec.file(home);
  let state;
  try {
    state = readSettings(file);
  } catch {
    return { ok: false, tool, file, reason: "SETTINGS_FILE_UNREADABLE" };
  }
  const removed = spec.strip(state.cfg);
  // Leave the file as it would be had SkeptOpus never come: no empty list left behind.
  if (removed && state.cfg.hooks && typeof state.cfg.hooks === "object")
    for (const [event, list] of Object.entries(state.cfg.hooks)) if (Array.isArray(list) && !list.length) delete state.cfg.hooks[event];
  if (removed && !dryRun) writeFileSync(file, JSON.stringify(state.cfg, null, 2) + "\n");
  return { ok: true, tool, file, removed, written: Boolean(removed) && !dryRun };
}

// ---------- one command: install, status, uninstall ----------
const ENGINE_FILES = ["cli.mjs", "claims.mjs", "observe.mjs", "words.mjs", "package.json"];
const ENGINE_FOLDERS = ["art", "fonts", "sounds"];
export const VERSION = (() => {
  try {
    return String(JSON.parse(readFileSync(join(dirname(SELF), "package.json"), "utf8")).version ?? "0.0.0");
  } catch {
    return "0.0.0-dev";
  }
})();
// A tool is "on this machine" when its own settings folder exists in the user's home.
const PRESENT = { claude: ".claude", cursor: ".cursor", codex: ".codex", gemini: ".gemini" };
const TOOL_NAME = { claude: "Claude Code", cursor: "Cursor", codex: "Codex", gemini: "Gemini CLI" };
const SHORTCUT = "SkeptOpus - journal.url";
const SHORTCUT_CLIP = "SkeptOpus - verifier ce que j ai copie.cmd";

/**
 * Install in one go: copy the engine to a stable folder, create the user's settings once,
 * hook every tool found, write the journal page, and leave something to click on.
 * Nothing outside the user's home is touched, and no existing setting of a tool is lost.
 */
export function install({ home = homedir(), env = process.env, dryRun = false, shortcuts = true, source = dirname(SELF), skip = [] } = {}) {
  const base = env.SKEPTOPUS_HOME || join(home, ".skeptopus"); // an empty variable is no folder
  const app = join(base, "app");
  const engine = join(app, "cli.mjs");
  const report = { ok: true, version: VERSION, home: base, engine, copied: [], tools: [], shortcut: null, journal: null, dryRun };
  // 1. The engine goes to a stable place: the tools must not point at a download folder that may vanish.
  if (resolve(source) !== resolve(app)) {
    const files = [...ENGINE_FILES.filter((f) => existsSync(join(source, f))), ...ENGINE_FOLDERS.flatMap((d) => (existsSync(join(source, d)) ? readdirSync(join(source, d)).map((f) => join(d, f)) : []))];
    if (!files.includes("cli.mjs")) return { ...report, ok: false, reason: "ENGINE_NOT_FOUND", source };
    for (const f of files) {
      if (!dryRun) {
        mkdirSync(dirname(join(app, f)), { recursive: true });
        copyFileSync(join(source, f), join(app, f));
      }
      report.copied.push(f.replace(/\\/g, "/"));
    }
  }
  // 2. The settings belong to the user: created once, never overwritten.
  const config = join(base, "config.json");
  if (!existsSync(config) && !dryRun) {
    mkdirSync(base, { recursive: true });
    writeFileSync(config, JSON.stringify({ notify: "problems", repos: [], roots: [] }, null, 2) + "\n");
  }
  // 3. Every tool found gets the trigger. A tool that is not there is said, not guessed.
  for (const [tool, folder] of Object.entries(PRESENT)) {
    if (!existsSync(join(home, folder))) {
      report.tools.push({ tool, state: "ABSENT" });
      continue;
    }
    // The user may keep a tool out of it: it is left exactly as it is.
    if (skip.includes(tool)) {
      report.tools.push({ tool, state: "SKIPPED" });
      continue;
    }
    const got = attach(tool, { home, dryRun, engine });
    if (got.ok) report.tools.push({ tool, state: dryRun ? "WOULD_ATTACH" : "ATTACHED", file: got.file, backup: got.backup, replaced: got.replaced, then: got.then, thenEn: got.thenEn });
    else {
      report.tools.push({ tool, state: "FAILED", file: got.file, reason: got.reason });
      report.ok = false;
    }
  }
  // 4. Something to open: the journal page, and on Windows a shortcut on the Desktop.
  if (!dryRun) report.journal = writeJournal(base);
  const desktop = join(home, "Desktop");
  if (shortcuts && process.platform === "win32" && existsSync(desktop)) {
    report.shortcut = join(desktop, SHORTCUT);
    if (!dryRun) {
      writeFileSync(report.shortcut, "[InternetShortcut]\r\nURL=" + pathToFileURL(join(base, "journal.html")).href + "\r\n");
      // The second one works with any AI, even a chat in a browser: copy its answer, double-click.
      writeFileSync(
        join(desktop, SHORTCUT_CLIP),
        "@echo off\r\nrem SkeptOpus : verifie le texte que vous venez de copier, puis ouvre le journal.\r\nrem Marche avec n'importe quelle IA : copiez sa reponse, puis double-cliquez ici.\r\n" +
          '"' + process.execPath + '" "' + engine + '" clip --open\r\n',
      );
    }
  }
  return report;
}

/** Take the triggers back out of every tool. The journal, the settings and the engine copy stay: they are the user's. */
export function uninstall({ home = homedir(), env = process.env, dryRun = false } = {}) {
  const base = homeOf(env, home);
  const report = { ok: true, home: base, tools: [], shortcut: null, dryRun };
  for (const tool of Object.keys(PRESENT)) {
    const got = detach(tool, { home, dryRun });
    report.tools.push({ tool, removed: got.removed ?? 0, file: got.file, ok: got.ok });
    if (!got.ok) report.ok = false;
  }
  for (const name of [SHORTCUT, SHORTCUT_CLIP]) {
    const link = join(home, "Desktop", name);
    if (!existsSync(link)) continue;
    report.shortcut = join(home, "Desktop", SHORTCUT);
    if (!dryRun) unlinkSync(link);
  }
  return report;
}

/** What is in place right now, read from the files, never from memory. */
export function status({ home = homedir(), env = process.env, cwd = process.cwd() } = {}) {
  const base = homeOf(env, home);
  const hooked = (file) => {
    const { cfg } = readSettings(file);
    return stripNested(JSON.parse(JSON.stringify(cfg))?.hooks?.Stop) > 0;
  };
  const tools = Object.entries(PRESENT).map(([tool, folder]) => {
    if (!existsSync(join(home, folder))) return { tool, state: "ABSENT" };
    try {
      const { cfg } = readSettings(TOOLS[tool].file(home));
      if (TOOLS[tool].strip(JSON.parse(JSON.stringify(cfg))) > 0) return { tool, state: "ATTACHED" };
      // Claude Code also reads settings kept inside a project folder.
      if (tool === "claude" && ["settings.local.json", "settings.json"].some((f) => existsSync(join(cwd, ".claude", f)) && hooked(join(cwd, ".claude", f)))) return { tool, state: "ATTACHED_HERE_ONLY", folder: cwd };
      return { tool, state: "NOT_ATTACHED" };
    } catch {
      return { tool, state: "SETTINGS_FILE_UNREADABLE" };
    }
  });
  let last = null;
  let checks = 0;
  try {
    const lines = readFileSync(join(base, "historique.jsonl"), "utf8").trim().split("\n").filter(Boolean);
    checks = lines.length;
    last = JSON.parse(lines[lines.length - 1]).at ?? null;
  } catch {
    // Nothing checked yet.
  }
  return { version: VERSION, home: base, engine: existsSync(join(base, "app", "cli.mjs")), tools, checks, last };
}

/** The same facts, said to a human. Plain marks only: some Windows consoles garble symbols. */
export function tell(kind, r, lang = "fr") {
  const fr = lang === "fr";
  const lines = [];
  if (kind === "install") {
    if (r.reason === "ENGINE_NOT_FOUND") return fr ? "Le moteur de SkeptOpus est introuvable à côté de cette commande. Rien n'a été installé." : "SkeptOpus's engine was not found next to this command. Nothing was installed.";
    lines.push(fr ? `SkeptOpus ${r.version} ${r.dryRun ? "serait installé" : "est installé"} dans ${r.home}` : `SkeptOpus ${r.version} ${r.dryRun ? "would be installed" : "is installed"} in ${r.home}`, "");
    for (const t of r.tools) {
      const name = TOOL_NAME[t.tool];
      if (t.state === "ABSENT") lines.push(fr ? `  [ -- ]  ${name} : pas trouvé sur cette machine` : `  [ -- ]  ${name}: not found on this machine`);
      else if (t.state === "SKIPPED") lines.push(fr ? `  [ -- ]  ${name} : laissé tel quel, à votre demande` : `  [ -- ]  ${name}: left as it is, as you asked`);
      else if (t.state === "FAILED") lines.push(fr ? `  [ !! ]  ${name} : ses réglages sont illisibles, rien n'a été touché (${t.file})` : `  [ !! ]  ${name}: its settings cannot be read, nothing was touched (${t.file})`);
      else {
        lines.push(fr ? `  [ OK ]  ${name} : ${r.dryRun ? "serait accroché" : "accroché"}${t.backup ? " (vos réglages d'avant sont gardés : " + t.backup + ")" : ""}` : `  [ OK ]  ${name}: ${r.dryRun ? "would be hooked" : "hooked"}${t.backup ? " (your previous settings are kept: " + t.backup + ")" : ""}`);
        const then = fr ? t.then : t.thenEn;
        if (then) lines.push("          " + then);
      }
    }
    if (!r.tools.some((t) => t.state === "ATTACHED" || t.state === "WOULD_ATTACH")) lines.push("", fr ? "Aucun outil reconnu n'a été trouvé. SkeptOpus marche quand même avec n'importe quelle IA : copiez sa réponse, puis lancez « skeptopus clip »." : "No known tool was found. SkeptOpus still works with any AI: copy its answer, then run \"skeptopus clip\".");
    lines.push("");
    if (r.journal) lines.push(fr ? `Votre journal : ${r.journal}` : `Your journal: ${r.journal}`);
    if (r.shortcut) lines.push(fr ? `Deux raccourcis ${r.dryRun ? "seraient" : "sont"} sur votre Bureau : le journal, et « vérifier ce que j'ai copié ».` : `Two shortcuts ${r.dryRun ? "would be" : "are"} on your Desktop: the journal, and "check what I copied".`);
    lines.push(fr ? "Ouvrir le journal : skeptopus journal --open     Tout retirer : skeptopus uninstall" : "Open the journal: skeptopus journal --open     Remove everything: skeptopus uninstall");
  } else if (kind === "uninstall") {
    lines.push(fr ? (r.dryRun ? "SkeptOpus serait retiré de :" : "SkeptOpus est retiré de :") : r.dryRun ? "SkeptOpus would be removed from:" : "SkeptOpus is removed from:");
    for (const t of r.tools) if (t.removed) lines.push(`  [ OK ]  ${TOOL_NAME[t.tool]}`);
    if (!r.tools.some((t) => t.removed)) lines.push(fr ? "  (il n'était accroché à aucun outil)" : "  (it was not hooked to any tool)");
    lines.push("", fr ? `Votre journal et vos réglages restent dans ${r.home}. Supprimez ce dossier si vous ne voulez rien garder.` : `Your journal and settings stay in ${r.home}. Delete that folder if you want to keep nothing.`);
  } else {
    lines.push(`SkeptOpus ${r.version}  ·  ${r.home}`, fr ? (r.engine ? "Moteur : en place" : "Moteur : absent de ce dossier") : r.engine ? "Engine: in place" : "Engine: not in this folder");
    for (const t of r.tools) {
      const word = { ATTACHED: fr ? "accroché" : "hooked", ATTACHED_HERE_ONLY: fr ? "accroché pour ce dossier seulement (" + t.folder + ")" : "hooked for this folder only (" + t.folder + ")", NOT_ATTACHED: fr ? "présent, pas accroché" : "present, not hooked", ABSENT: fr ? "pas trouvé" : "not found", SETTINGS_FILE_UNREADABLE: fr ? "réglages illisibles" : "settings unreadable" }[t.state];
      lines.push(`  ${t.state.startsWith("ATTACHED") ? "[ OK ]" : "[ -- ]"}  ${TOOL_NAME[t.tool]} : ${word}`);
    }
    lines.push(fr ? `Vérifications gardées : ${r.checks}${r.last ? " (dernière : " + r.last + ")" : ""}` : `Checks kept: ${r.checks}${r.last ? " (last: " + r.last + ")" : ""}`);
  }
  return lines.join("\n");
}

// ---------- the journal: what SkeptOpus checked, kept where the human can open it ----------
// The folder of this standalone tool (its journal and settings). It holds no secret. See homeOf() in observe.mjs.
const homeDir = () => homeOf();
const target = (c) => c.path ?? c.sha ?? c.id ?? c.name ?? c.text ?? (c.pr ? "#" + c.pr : c.total ? c.passed + "/" + c.total : "");
export function remember(report, meta = {}, refresh = true) {
  const dir = homeDir();
  mkdirSync(dir, { recursive: true });
  const entry = {
    at: meta.at ?? new Date().toISOString(),
    seenAt: new Date().toISOString(),
    replayed: Boolean(meta.replayed),
    session: meta.session ?? null,
    source: meta.source ?? null,
    excerpt: meta.excerpt ?? null,
    cwd: meta.cwd ?? null,
    verdict: report.verdict,
    rows: report.rows.map((r) => ({ verdict: r.verdict, kind: r.claim.kind, negated: r.claim.negated, target: target(r.claim), why: r.why, note: r.facts?.check ?? null, said: String(r.claim.sentence ?? "").slice(0, 220) })),
  };
  appendFileSync(join(dir, "historique.jsonl"), JSON.stringify(entry) + "\n");
  if (refresh) writeJournal();
  return entry;
}
function history(limit = 400, dir = homeDir()) {
  let raw = "";
  try {
    raw = readFileSync(join(dir, "historique.jsonl"), "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // One damaged line does not hide the others.
    }
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
}
// The characters live in the page. Pictures are optional: without them the page still works, without faces.
// They ship as WebP with transparency, made from the full-size originals: sharp on a phone screen, and light.
const HERO = "skeptopus.webp";
// The octopus on top takes the pose of the day's worst answer (drawn to be read at a glance):
// arms crossed for "not found", pointing in anger for "contradicted", blindfolded for "couldn't look".
// A good day, or a day with nothing yet, keeps him as he is. A missing picture keeps him too.
const POSE = { CONTRADICTED: "skeptopus-contredit.webp", NOT_PROVEN: "skeptopus-refuse.webp", COULD_NOT_CHECK: "skeptopus-paspu.webp" };
export const poseOf = (worst) => (POSE[worst] && art(POSE[worst]) ? POSE[worst] : HERO);
// One character per answer: the one who really did it, the two whose proof is missing
// (not there yet, or "sent" and never arrived), the one the facts contradict, the one nobody could look at.
// Nothing to check keeps the octopus himself.
const CAST = { PROVEN: "fourmi.webp", NOT_PROVEN: "albatros.webp", SENT: "pigeon.webp", CONTRADICTED: "grenouille.webp", COULD_NOT_CHECK: "taupe.webp" };
const CAST_KEY = { "fourmi.webp": "ant", "albatros.webp": "albatross", "pigeon.webp": "pigeon", "grenouille.webp": "frog", "taupe.webp": "mole" };
const CREW = [["fourmi.webp", "PROVEN"], ["albatros.webp", "NOT_PROVEN"], ["pigeon.webp", "NOT_PROVEN"], ["grenouille.webp", "CONTRADICTED"], ["taupe.webp", "COULD_NOT_CHECK"]];
// What was said to be sent somewhere and never arrived belongs to the courier; the rest of what is missing, to the one who will do it tomorrow.
const SENT_KINDS = new Set(["PUSHED", "PR_OPENED", "PR_MERGED", "COMMENT_POSTED", "COMMITTED", "REPO_CREATED"]);
export function castOf(entry) {
  const v = entry.verdict;
  let name = CAST[v];
  if (v === "NOT_PROVEN" && (entry.rows ?? []).some((r) => r.verdict === "NOT_PROVEN" && SENT_KINDS.has(r.kind))) name = CAST.SENT;
  return name && art(name) ? name : HERO;
}
const artCache = {};
function art(name) {
  if (name in artCache) return artCache[name];
  try {
    return (artCache[name] = "data:image/" + (name.endsWith(".webp") ? "webp" : "png") + ";base64," + readFileSync(join(dirname(SELF), "art", name)).toString("base64"));
  } catch {
    return (artCache[name] = "");
  }
}
// Each picture is written once in the page, as a style, however many answers show it: the page stays light as the history grows.
// "skeptopus-refuse.webp" and "skeptopus.webp" must not share a class: the whole name, without its extension.
const faceClass = (name) => "f-" + name.replace(/\.[^.]+$/, "").replace(/\W+/g, "-");
const face = (name, alt, kind) => (art(name) ? `<span class="face ${kind} ${faceClass(name)}" role="img" aria-label="${esc(alt)}"></span>` : "");
// Only the pose of the day is written in the page, not the three others.
const faceStyles = (pose = HERO) => [...new Set([HERO, pose, ...Object.values(CAST)])].filter(art).map((n) => `.${faceClass(n)}{background-image:url(${art(n)})}`).join("");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const TONE = { PROVEN: "ok", NOT_PROVEN: "warn", CONTRADICTED: "bad", COULD_NOT_CHECK: "unk", NOTHING_CLAIMED: "unk" };
// French puts a thin no-break space before : ; ? ! and inside « ». Applied to the French part of the page only.
const frenchSpaces = (html) => html.replace(/ ([:;?!»])/g, " $1").replace(/« /g, "« ");
// The slogan is a question and its answer. On a narrow screen the line breaks between the two, never inside one
// ("C'est fait ? Fais / voir." was seen at 320 px on 2026-11-12). A long slogan keeps the ordinary wrapping.
const sloganHtml = (s) => {
  const m = /^(.{1,20}?[?？؟])(\s*)(.{1,20})$/u.exec(String(s));
  return m ? `<span class="nb">${esc(m[1])}</span>${m[2]}<span class="nb">${esc(m[3])}</span>` : esc(s);
};
const dayKey = (iso) => {
  const d = new Date(iso);
  return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
};
// The typefaces (direction "Enquête"): a serif with character for the name,
// the slogan and the AI's own words; a plain sans for everything one reads; a mono for evidence.
// They sit in a folder beside the page. Without them the page falls back to the system's faces.
const ARABIC = "U+0600-06FF,U+0750-077F,U+0870-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC,U+102E0-102FB,U+10E60-10E7E,U+10EC2-10EC7,U+10EC9-10EEE,U+10EF0-10EFF,U+1EE00-1EE03,U+1EE05-1EE1F,U+1EE21-1EE22,U+1EE24,U+1EE27,U+1EE29-1EE32,U+1EE34-1EE37,U+1EE39,U+1EE3B,U+1EE42,U+1EE47,U+1EE49,U+1EE4B,U+1EE4D-1EE4F,U+1EE51-1EE52,U+1EE54,U+1EE57,U+1EE59,U+1EE5B,U+1EE5D,U+1EE5F,U+1EE61-1EE62,U+1EE64,U+1EE67-1EE6A,U+1EE6C-1EE72,U+1EE74-1EE77,U+1EE79-1EE7C,U+1EE7E,U+1EE80-1EE89,U+1EE8B-1EE9B,U+1EEA1-1EEA3,U+1EEA5-1EEA9,U+1EEAB-1EEBB,U+1EEF0-1EEF1";
const FONT_FILES = [
  ["Fraunces", "fraunces-roman.woff2", "100 900", "normal"],
  ["Fraunces", "fraunces-italic.woff2", "100 900", "italic"],
  ["Inter", "inter.woff2", "100 900", "normal"],
  ["JetBrains Mono", "jetbrains-mono.woff2", "100 800", "normal"],
  // Arabic: fetched by the browser only when Arabic text is on screen (the range says which characters they cover).
  ["Noto Sans Arabic", "noto-sans-arabic.woff2", "100 900", "normal", ARABIC],
  ["Noto Naskh Arabic", "noto-naskh-arabic.woff2", "400 700", "normal", ARABIC],
];
const fontFaces = (dir) => (dir ? FONT_FILES.map(([family, file, weight, style, range]) => `@font-face{font-family:"${family}";font-style:${style};font-weight:${weight};font-display:swap;src:url(${dir}${file}) format("woff2")${range ? ";unicode-range:" + range : ""}}`).join("") : "");

const PAGE_CSS = `
:root{--ink:#171717;--paper:#EFEAE0;--sea:#0E3B43;--red:#E44940;--d:"Fraunces","Noto Naskh Arabic","Songti SC","Noto Serif SC",Georgia,serif;--t:"Inter","Noto Sans Arabic","PingFang SC","Microsoft YaHei","Noto Sans SC",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--m:"JetBrains Mono",ui-monospace,"Cascadia Mono",Consolas,monospace}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}[hidden]{display:none!important}
body{margin:0;padding:0;background:var(--paper);color:var(--ink);font:400 16.5px/1.6 var(--t);overflow-x:hidden;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
.langs{position:absolute;top:10px;inset-inline-end:12px;z-index:10;display:flex;gap:2px;padding:3px;border-radius:999px;background:rgba(255,255,255,.78)}
.langs button{all:unset;cursor:pointer;font:600 11px/1 var(--t);letter-spacing:.06em;padding:6px 9px;border-radius:999px;color:#3d3833}
.langs button[data-set="ar"]{letter-spacing:0;font-size:12px}.langs button[aria-pressed="true"]{background:var(--ink);color:#fff}.langs button:focus-visible{outline:2px solid var(--red);outline-offset:1px}
.sea{position:relative;overflow:hidden;background:radial-gradient(70% 90% at 88% 70%,rgba(14,59,67,.20),transparent 70%),radial-gradient(50% 70% at 8% 10%,rgba(228,73,64,.10),transparent 70%),linear-gradient(#E9F0EA,#CFE3DF 62%,#B9D6D2)}
.sea-in{position:relative;z-index:2;max-width:860px;margin:0 auto;padding:46px 16px 96px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.id{min-width:0;flex:1}
.over{margin:0 0 10px;font:600 11.5px/1 var(--t);letter-spacing:.2em;text-transform:uppercase;color:var(--sea)}
.brand{display:flex;align-items:center;direction:ltr;margin:0;font:900 clamp(48px,13vw,80px)/.92 var(--d);font-variation-settings:"opsz" 144;letter-spacing:-.04em}[dir="rtl"] .brand{justify-content:flex-end}
.brand i{position:relative;flex:none;width:.72em;height:.72em;margin:0 .025em 0 .015em;border:.105em solid var(--red);border-radius:50%;background:#fff;overflow:hidden;transform:translateY(.035em)}
.brand i::before{content:"";position:absolute;right:0;top:.2em;width:.2em;height:.2em;border-radius:50%;background:var(--ink);animation:dart 7s ease-in-out infinite}
.brand i::after{content:"";position:absolute;left:-.12em;right:-.12em;top:-.1em;height:.27em;background:var(--red);transform:rotate(-9deg);transform-origin:50% 0;animation:blink 7s ease-in-out infinite}
.alert .brand i::after{height:.34em}.alert .brand i{animation:ring 2.4s ease-out 1}
.asleep .brand i::after{height:.9em;animation:none;transform:none}.asleep .brand i::before{animation:none;z-index:1;top:.235em;left:.06em;right:.06em;width:auto;height:.035em;border-radius:1em;background:#9c2f29}
.slogan{margin:14px 0 0;font:italic 500 clamp(21px,5.6vw,27px)/1.2 var(--d);font-variation-settings:"opsz" 40;letter-spacing:-.012em}.slogan .nb{white-space:nowrap}
.mood{display:inline-block;margin:16px 0 0;padding:7px 13px;border-radius:27px;background:rgba(255,255,255,.72);font:600 13.5px/1.35 var(--t)}
.alert .mood{background:var(--ink);color:#fff}
.hero{position:relative;flex:none;width:clamp(128px,34vw,230px);margin-bottom:-58px}
.face{display:block;background-size:contain;background-repeat:no-repeat;background-position:center bottom}
.face.hero-face{width:100%;aspect-ratio:1;filter:drop-shadow(0 12px 10px rgba(14,59,67,.28));animation:float 5.5s ease-in-out infinite}
.hero .ground{position:absolute;left:18%;right:18%;bottom:2px;height:12px;border-radius:50%;background:rgba(14,59,67,.22);filter:blur(4px);animation:ground 5.5s ease-in-out infinite}
.face.hero-face.anim{aspect-ratio:300/507;animation-duration:7s}
.asleep .face.hero-face,.asleep .hero .ground{animation:none}.asleep .face.hero-face{filter:grayscale(.45) drop-shadow(0 8px 8px rgba(14,59,67,.2))}
.zz{display:none;position:absolute;right:6%;top:2%;font:italic 700 22px/1 var(--d);color:var(--sea);opacity:.6}.asleep .zz{display:block;animation:zz 3s ease-in-out infinite}
.bubbles{position:absolute;inset:0;z-index:1;pointer-events:none}.bubbles i{position:absolute;bottom:-20px;border:2px solid rgba(14,59,67,.38);border-radius:50%;background:rgba(255,255,255,.35);animation:rise linear infinite}
.wave{position:absolute;left:0;bottom:-1px;width:200%;height:54px;z-index:3;animation:drift 16s linear infinite}.wave.back{opacity:.5;height:70px;animation-duration:26s;animation-direction:reverse}
main{position:relative;z-index:4;max-width:860px;margin:-34px auto 0;padding:0 16px calc(80px + env(safe-area-inset-bottom))}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:0 0 18px;padding-inline-end:clamp(0px,calc(34vw - 60px),190px)}
.tile{border-radius:16px;padding:14px 16px 12px;background:#fff;box-shadow:0 6px 18px rgba(14,59,67,.12)}
.tile b{display:block;font:800 38px/1 var(--t);letter-spacing:-.045em;font-variant-numeric:tabular-nums}
.tile span{display:block;margin-top:4px;font:500 12.5px/1.3 var(--t);color:#4a443d}
details.what{border-radius:16px;background:rgba(255,255,255,.7);padding:6px 18px;margin:0 0 6px}
details.what summary{cursor:pointer;font:650 16px/1.4 var(--t);padding:10px 0;list-style:none}details.what summary::-webkit-details-marker{display:none}
details.what summary::after{content:" +";color:var(--red)}details.what[open] summary::after{content:" −"}details.what p{margin:6px 0 12px;font-size:15.5px}
details.what p.crew-title{margin:16px 0 8px}.crew{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px 20px;margin:4px 0 16px}.who{display:flex;gap:12px;align-items:center;margin:0}.face.who-face{flex:none;width:64px;height:84px;filter:drop-shadow(0 4px 4px rgba(14,59,67,.22))}.who figcaption{min-width:0;font:400 15px/1.35 var(--t)}.who figcaption b{font-weight:700}.who .stamp{display:inline-block;font-size:9.5px;padding:3px 6px 2px;margin-inline-start:8px;vertical-align:2px;transform:rotate(-2deg)}.who .line{display:block;font:italic 500 15.5px/1.35 var(--d);color:#3d3833;margin-top:3px}:lang(ar) .who .line,:lang(zh) .who .line{font-style:normal}:lang(ar) .who .stamp{font-size:11px;padding:3px 7px 4px}
h2{font:600 11.5px/1 var(--t);letter-spacing:.2em;text-transform:uppercase;margin:34px 0 14px;border-top:1.5px solid var(--ink);padding-top:12px}
article{position:relative;overflow-wrap:anywhere;border-radius:18px;background:#fff;margin:22px 0;padding:14px 16px;box-shadow:0 1px 0 rgba(23,23,23,.9),0 10px 24px rgba(14,59,67,.10);opacity:0;transform:translateY(14px);transition:opacity .45s ease,transform .45s ease}
article.in,.nojs article{opacity:1;transform:none}
article.err{background:#F4F1EA}article.err .stamp{color:#8a8479!important;text-decoration:line-through}article.err ul{opacity:.6}
.erratum{margin:0 0 10px;margin-inline-end:78px;padding:9px 13px;border-radius:12px;background:var(--ink);color:#fff;font:400 14.5px/1.5 var(--t)}
article.bad{box-shadow:0 0 0 2px #CD3435,0 10px 24px rgba(205,52,53,.16)}article.warn{box-shadow:0 0 0 2px #B7690B,0 10px 24px rgba(183,105,11,.14)}
article header{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:0 0 6px;margin-inline-end:78px}
article>.face.mini{position:absolute;inset-inline-end:8px;top:-22px;width:84px;height:84px;transform:rotate(4deg);filter:drop-shadow(0 6px 6px rgba(14,59,67,.25));transition:transform .3s ease}
article:hover>.face.mini{transform:rotate(-3deg) translateY(-3px)}
time{font:500 13px/1 var(--m)}small{font:400 12px/1.4 var(--t);color:#5b544e;overflow-wrap:anywhere}.where{flex-basis:100%;font:400 11.5px/1.4 var(--m);opacity:.85}
code,.where{direction:ltr;unicode-bidi:isolate}[dir="rtl"] .where{text-align:right}
ul{list-style:none;margin:0;padding:0}li{display:flex;gap:14px;padding:10px 0;border-top:1px solid #e6dfd2}li div{min-width:0}
li strong{display:block;font:650 16px/1.4 var(--t);word-break:break-word}li em{display:block;font:400 15.5px/1.5 var(--t);font-style:normal;color:#3d3833}
.said{margin:4px 0 0;font:italic 400 15.5px/1.5 var(--d);font-variation-settings:"opsz" 14;color:#5a534b}
code{display:inline-block;max-width:100%;vertical-align:baseline;font:500 12.5px/1.5 var(--m);color:inherit;background:var(--paper);border-radius:5px;padding:1px 6px;overflow-wrap:anywhere}
.stamp{flex:none;align-self:flex-start;font:800 11.5px/1 var(--t);letter-spacing:.16em;text-transform:uppercase;white-space:nowrap;border:2px solid currentColor;border-radius:3px;padding:6px 9px 5px;transform:rotate(-3deg)}.stamp.big{font-size:12.5px}
.ok .stamp,.tile.ok b{color:#137A4B}.warn .stamp,.tile.warn b{color:#B7690B}.bad .stamp,.tile.bad b{color:#CD3435}.unk .stamp,.tile.unk b{color:#6f6a60}
li.ok .stamp{color:#137A4B}li.warn .stamp{color:#B7690B}li.bad .stamp{color:#CD3435}li.unk .stamp{color:#6f6a60}
article.fresh .stamp.big{animation:slam .55s cubic-bezier(.2,1.5,.4,1) both}
.new{display:none;font:600 10.5px/1 var(--t);letter-spacing:.14em;text-transform:uppercase;background:var(--ink);color:#fff;border-radius:999px;padding:4px 8px}article.fresh .new{display:inline-block}
.none{margin:4px 0;color:#5b544e;font-size:14.5px}.empty{border-radius:18px;border:2px dashed #9fb9b5;padding:24px;text-align:center;color:#3d3833}
:lang(ar){line-height:1.85}:lang(ar) .slogan,:lang(ar) .said,:lang(ar) .zz{font-style:normal}
:lang(ar) .slogan{font-weight:700;font-size:clamp(25px,6.6vw,32px);line-height:1.5;letter-spacing:0}:lang(ar) .stamp,:lang(ar) .over,:lang(ar) h2,:lang(ar) .new{letter-spacing:0}
:lang(ar) .stamp{font-size:13.5px;padding:4px 10px 6px}:lang(ar) .stamp.big{font-size:14.5px}:lang(ar) .over,:lang(ar) h2{font-size:14px}:lang(ar) .tile span{font-size:13.5px}:lang(ar) li strong{font-size:17px}:lang(ar) li em,:lang(ar) .said{font-size:16.5px}:lang(ar) .mood{font-size:14.5px}
:lang(zh) .slogan,:lang(zh) .said,:lang(zh) .zz{font-style:normal}:lang(zh) .slogan,:lang(zh) .said{font-family:"Fraunces","Songti SC","Noto Serif SC","Source Han Serif SC","PingFang SC","Microsoft YaHei",sans-serif}:lang(zh) .slogan{font-weight:600;letter-spacing:.02em}:lang(zh) .stamp{letter-spacing:.1em;font-size:13px}:lang(zh) .over,:lang(zh) h2{letter-spacing:.3em}
@keyframes float{0%,100%{transform:translateY(0) rotate(-1.2deg)}50%{transform:translateY(-10px) rotate(1.4deg)}}
@keyframes ground{0%,100%{transform:scaleX(1);opacity:1}50%{transform:scaleX(.82);opacity:.7}}
@keyframes rise{0%{transform:translate(0,0);opacity:0}12%{opacity:1}100%{transform:translate(14px,-340px);opacity:0}}
@keyframes drift{from{transform:translateX(0)}to{transform:translateX(-50%)}}
@keyframes dart{0%,54%,100%{transform:translateX(0)}60%,78%{transform:translateX(-.26em)}84%{transform:translateX(-.08em)}}
@keyframes blink{0%,44%,50%,100%{transform:rotate(-9deg) scaleY(1)}47%{transform:rotate(0) scaleY(2.9)}}
@keyframes ring{0%{box-shadow:0 0 0 0 rgba(228,73,64,.45)}100%{box-shadow:0 0 0 .3em rgba(228,73,64,0)}}
@keyframes slam{0%{transform:scale(2.6) rotate(-16deg);opacity:0}60%{opacity:1}100%{transform:scale(1) rotate(-3deg);opacity:1}}
@keyframes zz{0%,100%{transform:translateY(0);opacity:.25}50%{transform:translateY(-8px);opacity:.7}}
@media(max-width:560px){.sea-in{padding:44px 16px 86px}.tiles{grid-template-columns:repeat(2,1fr);padding-inline-end:0}li{flex-direction:column;gap:6px}article{padding:14px}article>.face.mini{width:68px;height:68px;top:-20px;inset-inline-end:4px}article header{margin-inline-end:62px}.erratum{margin-inline-end:62px}.hero{margin-bottom:-46px}}
@media(max-width:340px){.sea-in{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:10px;align-items:center;padding:44px 14px 72px}.id{display:contents}.over{grid-area:1/1/2/-1}.brand{grid-area:2/1/3/-1;font-size:min(48px,calc((100vw - 30px)/4.6))}.slogan{grid-area:3/1;margin-top:10px}.hero{grid-area:3/2;width:clamp(84px,32vw,108px);margin:8px 0 0}.mood{grid-area:4/1/5/-1;justify-self:start;margin-top:12px}main{padding-inline:12px}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}article{opacity:1;transform:none}}
`;

// What runs in the reader's browser. No template text here: the page is already written, in every language.
const PAGE_SCRIPT = `
(function(){
  var b=document.body,loaded=Date.now(),hosted=b.hasAttribute("data-embedded");b.classList.remove("nojs");
  var store={get:function(k){try{return localStorage.getItem(k)}catch(e){return null}},set:function(k,v){try{localStorage.setItem(k,v)}catch(e){}}};
  var still=window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Awake only while the last check is recent: the motion says "it is watching right now".
  var last=Date.parse(b.getAttribute("data-last")||""),age=isNaN(last)?Infinity:(Date.now()-last)/60000;
  // A day with something to look at keeps its sentence: in the morning, that is the line one opens the page for.
  if(age>30){b.classList.add("asleep");if(isFinite(age)&&!b.classList.contains("alert")){[].forEach.call(document.querySelectorAll(".mood"),function(m){try{var t=JSON.parse(m.getAttribute("data-asleep")),h=Math.round(age/60);m.textContent=age<50?t[0].replace("{n}",Math.round(age)):age<90?t[1]:h===2&&t[3]?t[3]:h>=11&&t[4]?t[4].replace("{n}",h):t[2].replace("{n}",h)}catch(e){}})}}
  // The explanation is open the first time only; in a host's side panel, where room is short, it starts closed.
  if(store.get("sk-seen")||hosted)[].forEach.call(document.querySelectorAll("details.what"),function(d){d.removeAttribute("open")});
  store.set("sk-seen","1");
  // Numbers count up to their real value.
  function countUp(root){[].forEach.call(root.querySelectorAll(".tile b"),function(el){var n=+el.getAttribute("data-n")||0,t0=null;if(!n||still||el.getAttribute("data-done"))return;el.setAttribute("data-done","1");el.textContent="0";requestAnimationFrame(function step(t){t0=t0||t;var p=Math.min(1,(t-t0)/700);el.textContent=Math.round(n*(1-Math.pow(1-p,3)));if(p<1)requestAnimationFrame(step)})})}
  // Answers that arrived since the last visit get their stamp slammed when they come into view.
  var seenUntil=Date.parse(store.get("sk-until")||"")||0,newest=0;
  function mark(a){a.classList.add("in");var at=Date.parse(a.getAttribute("data-at")||"");if(seenUntil&&at>seenUntil)a.classList.add("fresh")}
  var io="IntersectionObserver" in window?new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){mark(e.target);io.unobserve(e.target)}})},{rootMargin:"0px 0px -6% 0px"}):null;
  function reveal(root){if(!root)return;countUp(root);[].forEach.call(root.querySelectorAll("article:not(.in)"),function(a){if(io)io.observe(a);else mark(a)})}
  [].forEach.call(document.querySelectorAll("article"),function(a){var at=Date.parse(a.getAttribute("data-at")||"");if(at>newest)newest=at});
  if(newest)setTimeout(function(){store.set("sk-until",new Date(newest).toISOString())},4000);
  // One page, every language: the reader's choice is kept; otherwise the user's setting, then the browser's language.
  var langs=[].map.call(document.querySelectorAll(".L"),function(x){return x.getAttribute("data-lang")});
  function show(l,keep){
    var on=null;
    [].forEach.call(document.querySelectorAll(".L"),function(x){var mine=x.getAttribute("data-lang")===l;x.hidden=!mine;if(mine)on=x});
    [].forEach.call(document.querySelectorAll(".langs button"),function(x){x.setAttribute("aria-pressed",String(x.getAttribute("data-set")===l))});
    if(on){document.documentElement.lang=on.getAttribute("lang");document.documentElement.dir=on.getAttribute("dir")||"ltr"}
    if(keep)store.set("sk-lang",l);
    reveal(on);
  }
  var want=store.get("sk-lang")||b.getAttribute("data-lang")||"",nav=(navigator.language||"").slice(0,2).toLowerCase();
  if(langs.indexOf(want)<0)want=langs.indexOf(nav)>=0?nav:"en";
  [].forEach.call(document.querySelectorAll(".langs button"),function(x){x.addEventListener("click",function(){show(x.getAttribute("data-set"),true)})});
  show(want,false);
  // Coming back to the tab shows what happened meanwhile. A host that shows the page itself rewrites it instead.
  document.addEventListener("visibilitychange",function(){if(!hosted&&!document.hidden&&Date.now()-loaded>15000)location.reload()});
})();
`;

// Nothing moves for decoration. Every motion in the page is driven by a real field:
//   bubbles        one per thing seen today (capped)
//   the octopus    floats while the last check is recent; still, eye shut, when nothing has been checked for a while
//   his pose       the worst answer of the day
//   the eye        narrows when something was refused or contradicted today
//   a stamp slams  on answers that arrived since the reader's last visit
// The page is written once, in every language; the reader switches with the buttons at the top.
/** The day's figures, from what the journal keeps: the page's header and a host's one line show the same ones. */
export function dayOf(entries, now = new Date()) {
  const today = entries.filter((e) => dayKey(e.at) === dayKey(now.toISOString()) && !e.erratum);
  const count = (v) => today.reduce((n, e) => n + e.rows.filter((r) => r.verdict === v).length, 0);
  const day = { checks: today.length, seen: count("PROVEN"), refused: count("NOT_PROVEN"), against: count("CONTRADICTED"), blind: count("COULD_NOT_CHECK") };
  // The worst answer of the day: contradicted, then refused, then could not look. "Seen" is the best one.
  day.worst = day.against ? "CONTRADICTED" : day.refused ? "NOT_PROVEN" : day.blind ? "COULD_NOT_CHECK" : day.seen ? "PROVEN" : null;
  return day;
}
// A day where it could not look is said as such, never as "nothing to report": the octopus is blindfolded then.
const moodOf = (p, day) =>
  !day.checks ? p.moodNone : day.against || day.refused ? p.moodAlert(day.against, day.refused) : day.blind ? p.moodBlind(day.blind, day.seen) : p.moodCalm(day.seen);
/**
 * The state of the day in a few words, for a host that has one line to show it in (an editor's status bar).
 * Every language is given: the host shows the one its reader chose.
 */
export function glance(dir = homeDir(), now = new Date()) {
  const day = dayOf(kept(dir), now);
  const n = { CONTRADICTED: day.against, NOT_PROVEN: day.refused, COULD_NOT_CHECK: day.blind, PROVEN: day.seen }[day.worst] ?? 0;
  const texts = {};
  for (const lang of LANGS) {
    const p = PAGE[lang];
    const w = WORDS[lang];
    texts[lang] = { mood: moodOf(p, day), short: day.worst ? p.tiles[day.worst] + w.sep + n : "", word: day.worst ? w[day.worst] : "", slogan: p.slogan };
    if (lang === "fr") for (const key of ["mood", "short", "slogan"]) texts.fr[key] = frenchSpaces(texts.fr[key]);
  }
  const first = kept(dir)[0];
  let lang = null;
  try {
    const set = JSON.parse(readFileSync(join(dir, "config.json"), "utf8")).lang;
    if (typeof set === "string") lang = set;
  } catch {
    // No setting: the host falls back on its own language.
  }
  return { version: VERSION, home: dir, lang, at: now.toISOString(), last: first?.at ?? null, lastVerdict: first?.verdict ?? null, ...day, texts };
}
export function journalHtml(entries, now = new Date(), options = {}) {
  const figures = dayOf(entries, now);
  const { seen, refused, against, blind } = figures;
  const pose = poseOf(figures.worst);
  // The animated octopus is the "on watch" state. A contradiction keeps its own still pose: that one must not be missed.
  const animated = typeof options.anim === "string" && options.anim && !against;
  const bubbles = Array.from({ length: Math.min(14, seen) }, (_, i) => {
    const size = 6 + ((i * 5) % 11);
    return `<i style="left:${(i * 37 + 11) % 94}%;width:${size}px;height:${size}px;animation-duration:${7 + ((i * 3) % 6)}s;animation-delay:-${((i * 17) % 90) / 10}s"></i>`;
  }).join("");
  const first = pickLang(options.lang);
  const block = (lang) => {
    const w = WORDS[lang];
    const p = PAGE[lang];
    const loc = LOCALE[lang];
    const day = (iso) => new Date(iso).toLocaleDateString(loc, { weekday: "long", day: "numeric", month: "long" });
    const hour = (iso) => new Date(iso).toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" });
    const mood = moodOf(p, figures);
    const hero = animated
      ? `<span class="face hero-face anim" role="img" aria-label="${esc(p.heroAlt)}" style="background-image:url(${esc(options.anim)})"></span>`
      : face(pose, p.heroAlt, "hero-face");
    const tile = (v, n) => `<div class="tile ${TONE[v]}"><b data-n="${n}">${n}</b><span>${esc(p.tiles[v])}</span></div>`;
    const stop = lang === "zh" ? "。" : ".";
    // The crew sits in the explanation, next to the four answers: each character stands for one of them and says its own sentence.
    const crew = CREW.every(([f]) => art(f))
      ? `<p class="crew-title"><b>${esc(p.crewTitle)}</b></p><div class="crew">` +
        CREW.map(([f, v]) => {
          const c = p.crew[CAST_KEY[f]];
          return `<figure class="who ${TONE[v]}">${face(f, c.name, "who-face")}<figcaption><b>${esc(c.name)}</b><span class="stamp">${esc(w[v])}</span><span class="line">${p.quotes[0]}${esc(c.line)}${p.quotes[1]}</span></figcaption></figure>`;
        }).join("") +
        "</div>"
      : "";
    let last = "";
    const body = entries
      .map((e) => {
        const head = dayKey(e.at) !== last ? ((last = dayKey(e.at)), `<h2>${esc(day(e.at))}</h2>`) : "";
        const rows = e.rows
          .map((r) => `<li class="${TONE[r.verdict]}"><span class="stamp">${esc(w[r.verdict])}</span><div><strong>${r.negated ? esc(p.not) : ""}${esc(w.kind[r.kind] ?? r.kind)}${r.target ? " <code>" + esc(r.target) + "</code>" : ""}</strong><em>${esc(say(lang, r.why))}${r.note ? " <b>" + esc(w.open.trim() + r.note + w.close) + "</b>" : ""}</em>${r.said ? `<p class="said" dir="auto">${p.quotes[0]}${esc(r.said)}${p.quotes[1]}</p>` : ""}</div></li>`)
          .join("");
        const erratum = e.erratum ? `<p class="erratum"><b>${esc(p.erratum)}</b> ${esc(e.erratum)}</p>` : "";
        const source = sourceLabel(lang, e.source);
        const who = castOf(e);
        const whoName = p.crew[CAST_KEY[who]]?.name;
        const nothing = '<p class="none">' + esc(p.none) + (e.excerpt ? w.sep + p.quotes[0] + esc(e.excerpt) + p.quotes[1] : "") + stop + "</p>";
        return `${head}<article class="${e.erratum ? "err" : TONE[e.verdict]}" data-at="${esc(e.at)}">${erratum}${face(who, whoName ? whoName + " · " + w[e.verdict] : w[e.verdict], "mini")}<header><time dir="auto">${esc(hour(e.at))}</time><span class="stamp big">${esc(w[e.verdict])}</span><span class="new">${esc(p.fresh)}</span>${source ? "<small><b>" + esc(source) + "</b></small>" : ""}${e.replayed ? "<small>" + esc(p.replayed) + "</small>" : ""}<small class="where">${esc(e.cwd ?? "")}</small></header>${e.rows.length ? "<ul>" + rows + "</ul>" : nothing}</article>`;
      })
      .join("\n");
    const html = `<div class="L" data-lang="${lang}" lang="${loc}" dir="${DIR[lang]}"${lang === first ? "" : " hidden"}>
<header class="sea">
<div class="bubbles" aria-hidden="true">${bubbles}</div>
<div class="sea-in"><div class="id"><p class="over">${esc(p.over)} · ${esc(now.toLocaleDateString(loc, { day: "numeric", month: "long" }))}</p><h1 class="brand" aria-label="SkeptOpus"><span aria-hidden="true">Skept</span><i aria-hidden="true"></i><span aria-hidden="true">pus</span></h1>
<p class="slogan">${sloganHtml(options.slogan ?? p.slogan)}</p><p class="mood" data-asleep="${esc(JSON.stringify(p.asleep))}">${esc(mood)}</p></div>
<div class="hero"><span class="zz" aria-hidden="true">z z</span><span class="ground" aria-hidden="true"></span>${hero}</div></div>
<svg class="wave back" viewBox="0 0 1200 60" preserveAspectRatio="none" aria-hidden="true"><path fill="#E4E6DA" d="M0 30 Q75 4 150 30 T300 30 T450 30 T600 30 T750 30 T900 30 T1050 30 T1200 30 V60 H0Z"/></svg>
<svg class="wave" viewBox="0 0 1200 60" preserveAspectRatio="none" aria-hidden="true"><path fill="#EFEAE0" d="M0 34 Q50 14 100 34 T200 34 T300 34 T400 34 T500 34 T600 34 T700 34 T800 34 T900 34 T1000 34 T1100 34 T1200 34 V60 H0Z"/></svg>
</header>
<main>
<div class="tiles">${tile("PROVEN", seen)}${tile("NOT_PROVEN", refused)}${tile("CONTRADICTED", against)}${tile("COULD_NOT_CHECK", blind)}</div>
<details class="what" open><summary>${esc(p.whatTitle)}</summary>${p.what.map((t) => "<p>" + t + "</p>").join("")}${crew}</details>
${entries.length ? body : '<div class="empty">' + esc(p.empty) + "</div>"}
<h2>${esc(p.updTitle)}</h2><p><small>${esc(p.upd(now.toLocaleString(loc), entries.length))}</small></p>
</main>
</div>`;
    return lang === "fr" ? frenchSpaces(html) : html;
  };
  // A host that shows the page in its own window (an editor's side panel) says so: the page then leaves reloading
  // to the host, and carries what that host requires to let it run (a policy, and a mark on its one script).
  const policy = options.csp ? `<meta http-equiv="Content-Security-Policy" content="${esc(options.csp)}">` : "";
  const mark = options.nonce ? ` nonce="${esc(options.nonce)}"` : "";
  return `<!doctype html><html lang="${LOCALE[first]}" dir="${DIR[first]}"><head><meta charset="utf-8">${policy}<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#CFE3DF"><title>SkeptOpus</title><style>${fontFaces(options.fonts)}${PAGE_CSS}${faceStyles(pose)}.asleep .face.hero-face.anim{aspect-ratio:1;background-image:url(${art(HERO)})!important}
@media(prefers-reduced-motion:reduce){.face.hero-face.anim{aspect-ratio:1;background-image:url(${art(HERO)})!important}}</style></head><body class="nojs${against || refused ? " alert" : ""}" data-last="${esc(entries[0]?.at ?? "")}" data-lang="${esc(options.lang ?? "")}"${options.embedded ? " data-embedded" : ""}>
<nav class="langs" aria-label="Language">${LANGS.map((l) => `<button type="button" data-set="${l}" aria-pressed="${l === first}">${LANG_LABEL[l]}</button>`).join("")}</nav>
${LANGS.map(block).join("\n")}
<script${mark}>${PAGE_SCRIPT}</script>
</body></html>`;
}
export function writeJournal(dir = homeDir()) {
  mkdirSync(dir, { recursive: true });
  const page = join(dir, "journal.html");
  writeFileSync(page, journalFor(dir));
  return page;
}
/**
 * The page as text, from what a home folder holds. `host` is what a host that shows the page in its own window
 * adds: where it serves the typefaces from, and what it needs to let the page run (see journalHtml).
 */
export function journalFor(dir = homeDir(), host = {}) {
  mkdirSync(dir, { recursive: true });
  const json = (file) => {
    try {
      return JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch {
      return {};
    }
  };
  // What is heavy sits beside the page, not inside it: a clip if there is one, and the typefaces.
  const beside = (folder, keep) => {
    try {
      const from = join(dirname(SELF), folder);
      if (!existsSync(from)) return [];
      const files = readdirSync(from).filter(keep);
      if (files.length) mkdirSync(join(dir, folder), { recursive: true });
      for (const f of files) {
        const to = join(dir, folder, f);
        if (!existsSync(to) || statSync(to).size !== statSync(join(from, f)).size) copyFileSync(join(from, f), to);
      }
      return files;
    } catch {
      return []; // Nothing to copy, or it cannot be copied: the page falls back (still picture, system typefaces).
    }
  };
  let anim = null;
  try {
    const clip = join(dirname(SELF), "art", "heros-anime.webp");
    if (existsSync(clip)) {
      const size = statSync(clip).size;
      if (!existsSync(join(dir, "journal-anime.webp")) || statSync(join(dir, "journal-anime.webp")).size !== size) copyFileSync(clip, join(dir, "journal-anime.webp"));
      anim = "journal-anime.webp?v=" + size;
    }
  } catch {
    anim = null;
  }
  const fonts = beside("fonts", (f) => f.endsWith(".woff2")).length ? (typeof host.fonts === "string" && host.fonts ? host.fonts : "fonts/") : null;
  // The language shown first: the one the host's reader chose, else the user's setting.
  const lang = typeof host.lang === "string" && host.lang ? host.lang : typeof json("config.json").lang === "string" ? json("config.json").lang : undefined;
  return journalHtml(kept(dir), new Date(), { anim: host.embedded ? null : anim, fonts, lang, embedded: host.embedded, nonce: host.nonce, csp: host.csp });
}
/** What the journal keeps, newest first, each answer found wrong carrying its correction. */
function kept(dir = homeDir()) {
  // Errata live beside the log, never inside it: the log of what was said at the time is not rewritten.
  let errata = {};
  try {
    errata = JSON.parse(readFileSync(join(dir, "errata.json"), "utf8")) ?? {};
  } catch {
    errata = {};
  }
  return history(400, dir).map((e) => (typeof errata[e.at] === "string" ? { ...e, erratum: errata[e.at] } : e));
}
function usage() {
  console.error("SkeptOpus " + VERSION + "\n       skeptopus install [--dry-run] [--skip claude,cursor,...]   (hook every AI coding tool found on this machine)\n       skeptopus status   |   skeptopus uninstall [--dry-run]   |   skeptopus journal --open");
  console.error("       skeptopus attach <claude|codex|cursor|gemini> [--dry-run]   skeptopus detach <tool>");
  console.error("       skeptopus clip [--open] [--text-file path]   (check the text you just copied, from any AI)\n       skeptopus hook [--from tool] [--out claude|text|none]   (payload on stdin, or as a JSON argument)");
  console.error("       skeptopus glance [--json]   (the state of the day in one line)\n       skeptopus journal --print [--embedded] [--fonts url] [--nonce n] [--csp policy] [--lang xx]   (the page itself, for a host that shows it)");
  console.error("usage: skeptopus check --message <text> | --message-file <path> [--cwd dir] [--also dir]... [--json] [--lang fr|en]\n       skeptopus transcript <session.jsonl> [--last N] [--also dir]... [--json]\n       skeptopus hook   (Claude Code Stop hook: JSON on stdin)");
  process.exit(64);
}
// Started as a command (directly, or through the link a package manager creates), not imported as a library.
const startedAs = (() => {
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return "";
  }
})();
if (startedAs === import.meta.url || startedAs === pathToFileURL(realpathSync(SELF)).href) await main();
