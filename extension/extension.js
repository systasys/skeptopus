// SkeptOpus in an editor (VS Code, Cursor and their relatives).
//
// A thin shell. Everything a human reads comes from the engine that ships inside this extension (engine/):
// the journal page, the words, the figures. The extension gives them a place in the editor: a side panel
// with the journal and its octopus, one line in the status bar, and a way to check a copied answer.
// It never checks anything by itself, and it never touches a tool's settings unless asked to.
"use strict";

const vscode = require("vscode");
const cp = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { pickLanguage, statusLine, policy, withShim, troublePage, debounce, concerns } = require("./lib/host");

const VIEW = "skeptopus.journal";
const t = (message, ...args) => vscode.l10n.t(message, ...args);

function activate(context) {
  const engine = path.join(context.extensionPath, "engine", "cli.mjs");
  // What a test (or a curious user) can read back: what was last seen and shown.
  const state = { engine, glance: null, lang: "en", status: "", renders: 0, lastHtml: 0, trouble: null, watching: null };

  /** Runs the engine with the editor's own runtime: no Node.js is needed on the machine for this. */
  const run = (args, { cwd, timeout = 30000 } = {}) =>
    new Promise((resolve) => {
      cp.execFile(process.execPath, [engine, ...args], { cwd, timeout, windowsHide: true, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } }, (error, stdout, stderr) =>
        resolve({ ok: !error, code: typeof error?.code === "number" ? error.code : error ? -1 : 0, stdout: String(stdout ?? ""), stderr: String(stderr ?? error?.message ?? "") }),
      );
    });

  const item = vscode.window.createStatusBarItem("skeptopus.status", vscode.StatusBarAlignment.Right, 80);
  item.name = "SkeptOpus";
  item.command = VIEW + ".focus";
  context.subscriptions.push(item);

  const surfaces = new Set(); // every webview that currently shows the journal: the side panel, and a tab if open

  async function look() {
    const out = await run(["glance", "--json"]);
    try {
      state.glance = JSON.parse(out.stdout);
      state.trouble = null;
    } catch {
      state.glance = null;
      state.trouble = (out.stderr || out.stdout || "no answer").trim();
    }
    state.lang = pickLanguage(context.globalState.get("skeptopus.lang"), state.glance?.lang, vscode.env.language);
    const line = statusLine(state.glance, state.lang);
    item.text = state.status = line.text;
    item.tooltip = line.tooltip;
    item.backgroundColor = line.tone ? new vscode.ThemeColor(line.tone === "error" ? "statusBarItem.errorBackground" : "statusBarItem.warningBackground") : undefined;
    if (vscode.workspace.getConfiguration("skeptopus").get("statusBar", true)) item.show();
    else item.hide();
    watch();
    return state.glance;
  }

  /** The journal folder is watched, so an answer shows up the moment the engine writes it. */
  function watch() {
    const home = state.glance?.home;
    if (!home || state.watching === home || !fs.existsSync(home)) return;
    try {
      const watcher = fs.watch(home, { persistent: false }, (_event, file) => concerns(file) && changed());
      watcher.on("error", () => {
        state.watching = null;
      });
      context.subscriptions.push({ dispose: () => watcher.close() });
      state.watching = home;
    } catch {
      state.watching = null; // The five-minute look below still keeps the panel honest.
    }
  }

  async function show(webview) {
    if (!state.glance) await look();
    if (!state.glance) {
      webview.html = troublePage(t("SkeptOpus could not start its engine."), state.trouble ?? "");
      return;
    }
    const fonts = vscode.Uri.file(path.join(state.glance.home, "fonts"));
    webview.options = { enableScripts: true, localResourceRoots: [fonts] };
    const nonce = crypto.randomBytes(16).toString("hex");
    const out = await run(["journal", "--print", "--embedded", "--lang", state.lang, "--fonts", webview.asWebviewUri(fonts).toString() + "/", "--nonce", nonce, "--csp", policy(webview.cspSource, nonce)]);
    state.renders++;
    state.lastHtml = out.stdout.length;
    webview.html = out.ok && out.stdout.startsWith("<!doctype html>") ? withShim(out.stdout, nonce) : troublePage(t("SkeptOpus could not start its engine."), out.stderr || out.stdout);
  }

  async function refresh() {
    await look();
    for (const surface of surfaces) if (surface.visible()) await show(surface.webview);
  }
  const changed = debounce(() => void refresh(), 500);

  function adopt(webview, visible, onGone) {
    const surface = { webview, visible };
    surfaces.add(surface);
    const heard = webview.onDidReceiveMessage(async (message) => {
      // The reader chose a language in the panel: the status bar and the next pages follow.
      if (message?.type === "lang" && typeof message.lang === "string") {
        await context.globalState.update("skeptopus.lang", message.lang);
        await look();
      }
    });
    onGone(() => {
      surfaces.delete(surface);
      heard.dispose();
    });
    return surface;
  }

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW, {
      resolveWebviewView(view) {
        adopt(view.webview, () => view.visible, (gone) => view.onDidDispose(gone));
        view.onDidChangeVisibility(() => view.visible && void show(view.webview));
        return show(view.webview);
      },
    }),
  );

  /** Has the engine check a text the human handed over, keeps the answer in the journal, and says it. */
  async function checkText(text) {
    const file = path.join(os.tmpdir(), "skeptopus-" + crypto.randomBytes(8).toString("hex") + ".txt");
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
    let out;
    try {
      fs.writeFileSync(file, String(text ?? ""), { mode: 0o600 });
      // Declared measurements can take minutes (a test suite run again): the human sees that it is looking.
      out = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t("SkeptOpus is looking…") }, () => run(["clip", "--text-file", file, "--cwd", cwd, "--lang", state.lang], { cwd, timeout: 10 * 60 * 1000 }));
    } finally {
      fs.rmSync(file, { force: true }); // What was copied is the user's: it does not stay behind.
    }
    await refresh();
    const first = (out.stdout.trim() || out.stderr.trim() || t("SkeptOpus could not start its engine.")).split("\n")[0];
    const open = t("Open the journal");
    const say = state.glance?.lastVerdict === "PROVEN" || !String(text ?? "").trim() ? vscode.window.showInformationMessage : vscode.window.showWarningMessage;
    // The message waits for the human; the answer itself is already in the journal.
    void say(first, open).then((picked) => picked === open && vscode.commands.executeCommand(VIEW + ".focus"));
    return out;
  }

  let tab = null;
  context.subscriptions.push(
    vscode.commands.registerCommand("skeptopus.openJournal", async () => {
      if (tab) return tab.reveal();
      tab = vscode.window.createWebviewPanel("skeptopus.journalTab", "SkeptOpus", vscode.ViewColumn.Active, { enableScripts: true });
      tab.iconPath = vscode.Uri.file(path.join(context.extensionPath, "media", "icon.png"));
      adopt(tab.webview, () => Boolean(tab?.visible), (gone) =>
        tab.onDidDispose(() => {
          gone();
          tab = null;
        }),
      );
      tab.onDidChangeViewState(() => tab?.visible && void show(tab.webview));
      await show(tab.webview);
    }),
    vscode.commands.registerCommand("skeptopus.refresh", refresh),
    // Works with any AI, in or out of the editor: copy its answer, run this.
    vscode.commands.registerCommand("skeptopus.checkClipboard", async () => checkText(await vscode.env.clipboard.readText())),
    vscode.commands.registerCommand("skeptopus.hookTools", async () => {
      // The triggers are run by the tools themselves, later, outside the editor: they need a real Node.js.
      const node = await new Promise((resolve) => cp.execFile(process.platform === "win32" ? "where" : "which", ["node"], { windowsHide: true }, (error, stdout) => resolve(error ? null : String(stdout).split(/\r?\n/)[0].trim() || null)));
      if (!node) {
        void vscode.window.showWarningMessage(t("SkeptOpus's triggers need Node.js 18 or later on this machine (nodejs.org). The journal and the clipboard check work without it."));
        return null;
      }
      const real = (args) => new Promise((resolve) => cp.execFile(node, [engine, ...args], { windowsHide: true, timeout: 60000 }, (error, stdout, stderr) => resolve({ ok: !error, stdout: String(stdout), stderr: String(stderr) })));
      const plan = await real(["install", "--dry-run", "--lang", state.lang]);
      const yes = t("Hook them");
      const answer = await vscode.window.showInformationMessage(t("Hook the AI tools found on this machine?"), { modal: true, detail: plan.stdout.trim() + "\n\n" + t("SkeptOpus adds one line to each tool's settings and keeps a copy of the settings as they were.") }, yes);
      if (answer !== yes) return null;
      const done = await real(["install", "--lang", state.lang]);
      const channel = vscode.window.createOutputChannel("SkeptOpus");
      channel.appendLine(done.stdout.trim() || done.stderr.trim());
      channel.show(true);
      await refresh();
      return done;
    }),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration("skeptopus") && void look()),
  );

  // Time passes even when nothing is written (the octopus falls asleep, a new day starts): a slow look keeps up.
  const slow = setInterval(() => void refresh(), 5 * 60 * 1000);
  context.subscriptions.push({ dispose: () => clearInterval(slow) });

  const ready = look();
  return { state, ready, refresh, checkText };
}

function deactivate() {}

module.exports = { activate, deactivate };
