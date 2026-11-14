// SkeptOpus in an editor / the proof taken inside a real editor.
//
// This file is run by the editor itself (VS Code, Cursor), in its own extension host, when it is started by
// scripts/skeptopus-try-in-editor.mjs. It is not a `node --test` file: it needs the real editor around it.
// What it finds is written to the file named in SKEPTOPUS_HOST_TEST_OUT, pass or fail.
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vscode = require("vscode");

// Where the launcher said to look and to write: folders made for the occasion, nothing secret.
const env = process.env;

const until = async (what, test, ms = 20000) => {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await test()) return;
    await new Promise((done) => setTimeout(done, 150));
  }
  throw new Error("never happened within " + ms + " ms: " + what);
};

exports.run = async function run() {
  const out = env.SKEPTOPUS_HOST_TEST_OUT;
  const seen = { editor: vscode.env.appName, editorVersion: vscode.version, node: process.versions.node, steps: [] };
  const step = (name, extra = {}) => seen.steps.push({ name, ...extra });
  try {
    const extension = vscode.extensions.getExtension("systasys.skeptopus");
    assert.ok(extension, "the editor knows the extension");
    const api = await extension.activate();
    await api.ready;
    step("activated", { version: extension.packageJSON.version });

    // The engine it carries answers, with the editor's own runtime, about the journal folder it was given.
    assert.ok(api.state.glance, "the engine answered: " + api.state.trouble);
    assert.equal(api.state.glance.home, env.SKEPTOPUS_HOME, "it reads the folder it was told to read");
    step("engine answered", { engineVersion: api.state.glance.version, checks: api.state.glance.checks, worst: api.state.glance.worst });

    // The status bar says the worst answer of the day, in the language of the user's settings.
    assert.match(api.state.status, /^\$\(skeptopus-eye\) /);
    assert.equal(api.state.lang, env.SKEPTOPUS_HOST_TEST_LANG);
    assert.equal(api.state.status, "$(skeptopus-eye) " + api.state.glance.texts[api.state.lang].short);
    step("status bar", { text: api.state.status, lang: api.state.lang });

    // Everything the menus promise exists.
    const commands = await vscode.commands.getCommands(true);
    for (const id of ["skeptopus.openJournal", "skeptopus.checkClipboard", "skeptopus.refresh", "skeptopus.hookTools", "skeptopus.journal.focus"]) assert.ok(commands.includes(id), id);
    step("commands", { count: 5 });

    // The side panel shows the journal page the engine wrote.
    await vscode.commands.executeCommand("skeptopus.journal.focus");
    await until("the side panel is drawn", () => api.state.renders >= 1 && api.state.lastHtml > 20000);
    step("side panel", { pageBytes: api.state.lastHtml });

    // The same page opens in a tab.
    const before = api.state.renders;
    await vscode.commands.executeCommand("skeptopus.openJournal");
    await until("the tab is drawn", () => api.state.renders > before);
    assert.ok(vscode.window.tabGroups.all.some((g) => g.tabs.some((tab) => tab.label === "SkeptOpus")), "a tab named SkeptOpus is open");
    step("tab");

    // A new answer written by the engine reaches the editor by itself: the folder is watched.
    assert.equal(api.state.watching, env.SKEPTOPUS_HOME);
    const checksBefore = api.state.glance.checks;
    const drawn = api.state.renders;
    fs.appendFileSync(env.SKEPTOPUS_HOME + "/historique.jsonl", JSON.stringify({ at: new Date().toISOString(), verdict: "CONTRADICTED", source: "host-test", cwd: "x", rows: [{ verdict: "CONTRADICTED", kind: "PUSHED", target: "", why: "REMOTE_DOES_NOT_HAVE_THIS_COMMIT" }] }) + "\n");
    await until("the new answer is seen", () => api.state.glance.checks === checksBefore + 1 && api.state.renders > drawn);
    assert.equal(api.state.glance.worst, "CONTRADICTED");
    step("a new answer arrives by itself", { status: api.state.status });

    // An AI's answer handed over as text (what "Check what I just copied" does with the clipboard) is checked and
    // kept, and the panel follows. The real clipboard of whoever runs this is not touched.
    const answer = await api.checkText("I created `nowhere/at-all.md`.");
    assert.equal(answer.ok, true, answer.stderr);
    const last = JSON.parse(fs.readFileSync(env.SKEPTOPUS_HOME + "/historique.jsonl", "utf8").trim().split("\n").at(-1));
    assert.deepEqual([last.source, last.verdict, last.rows[0].target], ["clipboard", "NOT_PROVEN", "nowhere/at-all.md"]);
    assert.equal(fs.readdirSync(require("node:os").tmpdir()).filter((f) => /^skeptopus-[0-9a-f]{16}\.txt$/.test(f)).length, 0, "the text handed over does not stay behind");
    step("a copied answer is checked", { firstLine: answer.stdout.split("\n")[0] });

    seen.ok = true;
  } catch (error) {
    seen.ok = false;
    seen.error = String(error?.stack ?? error);
  }
  if (out) fs.writeFileSync(out, JSON.stringify(seen, null, 2));
  if (!seen.ok) throw new Error(seen.error);
};
