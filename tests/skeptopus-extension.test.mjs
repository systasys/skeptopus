// SkeptOpus in an editor: what can be proved without the editor. The proof inside a real editor is
// scripts/skeptopus-try-in-editor.mjs, which opens a window and is therefore not part of this run.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve, sep } from "node:path";
import { test } from "node:test";
import { inflateRawSync } from "node:zlib";

import { glance } from "../core/cli.mjs";
import { stage, vsix, zip } from "../scripts/skeptopus-pack-extension.mjs";
import { absolute, stage as stageNpm } from "../scripts/skeptopus-pack-npm.mjs";
import { scratch } from "./tmp.mjs";

const require = createRequire(import.meta.url);
const host = require("../extension/lib/host.js");
const read = (...p) => readFileSync(resolve("extension", ...p), "utf8");
const manifest = JSON.parse(read("package.json"));

/** Reads a zip back the way an installer does: from its table at the end. */
function unzip(bytes) {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    assert.equal(bytes.readUInt32LE(at), 0x02014b50);
    const method = bytes.readUInt16LE(at + 10);
    const packed = bytes.readUInt32LE(at + 20);
    const nameLength = bytes.readUInt16LE(at + 28);
    const local = bytes.readUInt32LE(at + 42);
    const name = bytes.toString("utf8", at + 46, at + 46 + nameLength);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const body = bytes.subarray(start, start + packed);
    files[name] = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    at += 46 + nameLength + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
  }
  return files;
}

test("only files under tests/ are run as tests: nothing that opens a window runs with node --test", () => {
  // Found on 2026-11-12: scripts/skeptopus-host-test.mjs matched node --test's "*-test.mjs" pattern, so every run of
  // the suite (and SkeptOpus running it again when an agent says "the tests pass") opened a VS Code window.
  // Folders that hold no source of ours: dependencies, builds, data, and every hidden folder (git, tools' caches).
  const skip = new Set(["node_modules", "dist", "build", "data"]);
  const picked = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(e.name) || e.name.startsWith(".")) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.[cm]?[jt]s$/.test(e.name) && (/[.\-_]test\.[cm]?[jt]s$/.test(e.name) || /^test(-.*)?\.[cm]?[jt]s$/.test(e.name) || /[\\/]test[\\/]/.test(p))) picked.push(p);
    }
  };
  walk(resolve("."));
  const outside = picked.filter((p) => !p.startsWith(resolve("tests") + sep));
  assert.deepEqual(outside, [], "a file outside tests/ would be run by node --test");
  // The same check holds in the public repository, which carries only the two suites of the engine and the extension.
  for (const suite of ["skeptopus-core.test.mjs", "skeptopus-extension.test.mjs"]) assert.ok(picked.some((p) => p.endsWith(sep + suite)), suite + " is found");
});

test("extension: the language shown, and the one line in the status bar", () => {
  // The reader's own choice in the panel, then the user's SkeptOpus setting, then the editor's language, then English.
  assert.equal(host.pickLanguage("ar", "fr", "es"), "ar");
  assert.equal(host.pickLanguage(undefined, "fr", "es"), "fr");
  assert.equal(host.pickLanguage(undefined, null, "zh-cn"), "zh");
  assert.equal(host.pickLanguage(undefined, null, "de"), "en");
  assert.equal(host.pickLanguage("xx", "yy", undefined), "en");
  // The line is made from what the engine says about the day: nothing is worded here.
  const home = scratch("skeptopus-ext-");
  const day = (worst, n) => ({ ...glance(home), worst, texts: Object.fromEntries(host.LANGS.map((l) => [l, { mood: "mood " + l, short: worst + " " + n + " " + l, word: worst }])) });
  assert.deepEqual(host.statusLine(day("CONTRADICTED", 2), "fr"), { text: "$(skeptopus-eye) CONTRADICTED 2 fr", tooltip: "SkeptOpus\nmood fr", tone: "error" });
  assert.equal(host.statusLine(day("NOT_PROVEN", 4), "es").tone, "warning");
  // Could not look is said, without the alarm colours the editor keeps for errors and warnings.
  assert.deepEqual([host.statusLine(day("COULD_NOT_CHECK", 7), "en").text, host.statusLine(day("COULD_NOT_CHECK", 7), "en").tone], ["$(skeptopus-eye) COULD_NOT_CHECK 7 en", null]);
  // A good day, or a day with nothing yet: the name alone. The figures stay one hover away.
  assert.equal(host.statusLine(day("PROVEN", 9), "en").text, "$(skeptopus-eye) SkeptOpus");
  assert.equal(host.statusLine(glance(home), "zh").text, "$(skeptopus-eye) SkeptOpus");
  assert.match(host.statusLine(glance(home), "en").tooltip, /^SkeptOpus\nNothing to check so far today\.$/);
  // No engine answer at all: still a line, never a crash.
  assert.equal(host.statusLine(null, "fr").text, "$(skeptopus-eye) SkeptOpus");
  // A language the engine does not speak falls back on the original.
  assert.equal(host.statusLine(day("NOT_PROVEN", 1), "de").text, "$(skeptopus-eye) NOT_PROVEN 1 en");
});

test("extension: the page gets exactly what it needs to run in the editor, and one small addition", () => {
  const policy = host.policy("vscode-resource://x", "abc");
  assert.equal(policy, "default-src 'none'; img-src data: vscode-resource://x; style-src 'unsafe-inline'; font-src vscode-resource://x; script-src 'nonce-abc'");
  assert.doesNotMatch(policy, /unsafe-eval|script-src[^;]*unsafe-inline|connect-src|https?:/, "no script but the marked ones, and no way out to the network");
  // The host's own lines go at the very end of the page, marked the way the policy requires.
  const page = host.withShim("<html><body><p>x</p></body></html>", "abc");
  assert.equal(page, '<html><body><p>x</p><script nonce="abc">' + host.SHIM + "</script></body></html>");
  assert.match(host.SHIM, /postMessage\(\{type:"lang",lang:/);
  assert.match(host.withShim("no body here", "n"), /^no body here<script nonce="n">/);
  // Trouble is said plainly, and whatever the engine printed cannot become markup.
  const trouble = host.troublePage("Could not start", '<img src=x onerror="alert(1)">');
  assert.match(trouble, /<b>Could not start<\/b>/);
  assert.doesNotMatch(trouble, /<img/);
  assert.match(trouble, /default-src 'none'/);
  // Only the journal's own files wake the panel up; several changes in a row make one refresh.
  assert.deepEqual(["historique.jsonl", "errata.json", "config.json", "journal.html", "verrous", null].map(host.concerns), [true, true, true, false, false, false]);
  let runs = 0;
  const pending = [];
  const later = host.debounce(() => runs++, 500, { set: (fn) => pending.push(fn) && pending.length, clear: (id) => (pending[id - 1] = null) });
  later();
  later();
  later();
  pending.filter(Boolean).forEach((fn) => fn());
  assert.equal(runs, 1);
});

test("extension: what it tells the editor about itself holds together", () => {
  // Every command a menu shows is declared, and the code registers every declared command.
  const declared = manifest.contributes.commands.map((c) => c.command);
  for (const item of manifest.contributes.menus["view/title"]) assert.ok(declared.includes(item.command), item.command);
  const code = read("extension.js");
  for (const id of declared) assert.ok(code.includes('registerCommand("' + id + '"'), id + " is registered");
  assert.ok(code.includes('const VIEW = "' + manifest.contributes.views.skeptopus[0].id + '"'));
  // The status bar glyph exists under the name the code uses.
  assert.ok(manifest.contributes.icons["skeptopus-eye"]);
  for (const file of ["media/eye.svg", "media/icon.png", "media/skeptopus-icons.woff", "README.md", "CHANGELOG.md"]) assert.ok(readFileSync(resolve("extension", file)).length > 100, file);
  // Menus exist in the editor's four languages that SkeptOpus speaks, each saying everything English says.
  const english = JSON.parse(read("package.nls.json"));
  const asked = [...JSON.stringify(manifest).matchAll(/%([\w.]+)%/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(asked)].sort(), Object.keys(english).sort(), "every placeholder has its English, and nothing is left over");
  for (const lang of ["fr", "es", "zh-cn"]) assert.deepEqual(Object.keys(JSON.parse(read("package.nls." + lang + ".json"))).sort(), Object.keys(english).sort(), lang);
  // Every sentence the code says to the human has its French, Spanish and Chinese.
  const said = [...code.matchAll(/\bt\("((?:[^"\\]|\\.)+)"/g)].map((m) => JSON.parse('"' + m[1] + '"'));
  assert.ok(said.length >= 6);
  for (const lang of ["fr", "es", "zh-cn"]) assert.deepEqual(Object.keys(JSON.parse(read("l10n", "bundle.l10n." + lang + ".json"))).sort(), [...new Set(said)].sort(), lang);
  // Nothing a human reads carries an em dash.
  for (const file of ["README.md", "CHANGELOG.md", "package.nls.json", "package.nls.fr.json", "package.nls.es.json", "package.nls.zh-cn.json", ...readdirSync(resolve("extension", "l10n")).map((f) => "l10n/" + f)]) assert.ok(!read(file).includes("—"), file);
  // It never asks for more than it uses: no dependency to install, and it runs in a folder that is not trusted.
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.capabilities.untrustedWorkspaces.supported, true);
  assert.equal(manifest.private, true, "nothing publishes it by accident");
  // In a remote window (SSH, WSL, a container) it runs where the work is, or not at all: never the journal of the
  // computer in front of you. Found on 13/11: allowed to run on that computer, a remote window showed its journal.
  assert.deepEqual(manifest.extensionKind, ["workspace"]);
  assert.equal(manifest.publisher, "systasys");
});

test("extension: the package carries the engine, opens like any zip, and comes out the same twice", () => {
  const work = scratch("skeptopus-pack-");
  const staged = stage(join(work, "a"));
  const bytes = vsix(staged);
  const files = unzip(bytes);
  // The two descriptions an editor reads first, then the extension.
  assert.deepEqual(Object.keys(files).slice(0, 2), ["extension.vsixmanifest", "[Content_Types].xml"]);
  const description = files["extension.vsixmanifest"].toString("utf8");
  // The version is the extension's own, read from its manifest: a test that fixed it broke at the first new version.
  const version = JSON.parse(readFileSync(resolve("extension", "package.json"), "utf8")).version;
  assert.ok(description.includes(`<Identity Language="en-US" Id="skeptopus" Version="${version}" Publisher="systasys"/>`));
  // The stores link back to the code and show the banner's colour.
  assert.match(description, /<Property Id="Microsoft\.VisualStudio\.Services\.Links\.Source" Value="https:\/\/github\.com\/systasys\/skeptopus"\/>/);
  assert.match(description, /<Property Id="Microsoft\.VisualStudio\.Services\.Branding\.Color" Value="#121110"\/>/);
  assert.match(description, /<Description xml:space="preserve">Your AI says it's done\. SkeptOpus goes and looks\.<\/Description>/);
  assert.match(description, /<Asset Type="Microsoft\.VisualStudio\.Code\.Manifest" Path="extension\/package\.json"/);
  // Every kind of file inside is declared (the list of kinds itself is not a part of the package).
  const types = files["[Content_Types].xml"].toString("utf8");
  for (const name of Object.keys(files)) if (name !== "[Content_Types].xml") assert.ok(types.includes('Extension="' + /\.[^./]+$/.exec(name)[0].toLowerCase() + '"'), name);
  // The engine comes along whole, byte for byte, with its pictures, typefaces and sounds.
  for (const f of ["cli.mjs", "claims.mjs", "observe.mjs", "words.mjs", "mcp.mjs", "package.json", "art/skeptopus.webp", "fonts/inter.woff2", "sounds/contradicted.wav"]) assert.ok(files["extension/engine/" + f].equals(readFileSync(resolve("core", f))), f);
  assert.ok(files["extension/extension.js"].equals(readFileSync(resolve("extension", "extension.js"))));
  // What only serves to try it in a real editor stays out.
  assert.equal(Object.keys(files).some((n) => n.includes("host-test")), false);
  // One version: the extension's is its engine's.
  assert.equal(JSON.parse(files["extension/package.json"]).version, JSON.parse(files["extension/engine/package.json"]).version);
  // The same files give the same package, on any day.
  assert.ok(vsix(stage(join(work, "b"))).equals(bytes));
  // And the zip writer itself: a text and bytes come back as they went in.
  const round = unzip(zip([["a/é.txt", "héllo ".repeat(200)], ["b.bin", Buffer.from([0, 1, 2, 255])]]));
  assert.equal(round["a/é.txt"].toString("utf8"), "héllo ".repeat(200));
  assert.deepEqual([...round["b.bin"]], [0, 1, 2, 255]);
});

test("npm: the engine as a package, publishable only on purpose, with a README that works away from the repository", () => {
  const work = scratch("skeptopus-npm-");
  const { dir, pkg } = stageNpm(join(work, "package"));
  const engine = JSON.parse(readFileSync(resolve("core", "package.json"), "utf8"));
  // The repository's own description stays private: only the one written by the script can go out.
  assert.equal(engine.private, true);
  assert.equal(pkg.private, undefined);
  assert.equal(JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version, engine.version);
  assert.equal(pkg.name, "skeptopus");
  assert.deepEqual(pkg.bin, { skeptopus: "cli.mjs" }, "npx skeptopus runs the engine");
  assert.ok(readFileSync(join(dir, "cli.mjs"), "utf8").startsWith("#!/usr/bin/env node"), "a command needs its first line on Linux and macOS");
  for (const f of ["cli.mjs", "claims.mjs", "observe.mjs", "words.mjs", "mcp.mjs", "art/skeptopus.webp", "fonts/inter.woff2", "sounds/contradicted.wav", "README.md", "LICENSE", "NOTICE"]) assert.ok(existsSync(join(dir, f)), f);
  assert.ok(readFileSync(join(dir, "cli.mjs")).equals(readFileSync(resolve("core", "cli.mjs"))), "the engine goes out byte for byte");
  // On npm's site no relative address resolves: every picture and link points at the tagged version.
  const readme = readFileSync(join(dir, "README.md"), "utf8");
  assert.doesNotMatch(readme, /\b(?:src|srcset|href)="(?![a-z]+:|#)/i);
  assert.doesNotMatch(readme, /\]\((?![a-z]+:|#)/i);
  assert.ok(readme.includes(`https://raw.githubusercontent.com/systasys/skeptopus/v${engine.version}/media/banner-dark.png`));
  assert.equal(absolute('<img src="core/art/x.webp"> [a](LICENSE) [b](https://x.y) <a href="#top">', "1.2.3"), '<img src="https://raw.githubusercontent.com/systasys/skeptopus/v1.2.3/core/art/x.webp"> [a](https://github.com/systasys/skeptopus/blob/v1.2.3/LICENSE) [b](https://x.y) <a href="#top">');
});

test("mcp registry: the package and server.json name the same server, at the same version", () => {
  const work = scratch("skeptopus-mcpname-");
  const { pkg } = stageNpm(join(work, "package"));
  const server = JSON.parse(readFileSync(resolve("release", "public", "server.json"), "utf8"));
  const engine = JSON.parse(readFileSync(resolve("core", "package.json"), "utf8"));
  // The registry reads mcpName in the published package.json and refuses the entry unless it equals name in
  // server.json. Retyping either one would publish a package the registry cannot tie to its server.
  assert.equal(pkg.mcpName, server.name, "mcpName is server.json's name, never retyped");
  assert.match(server.name, /^io\.github\.systasys\/[a-z0-9._-]+$/, "the namespace is the one the GitHub owner can claim");
  // A version left behind points the registry at a package that does not carry this entry.
  assert.equal(server.version, engine.version, "server.json follows the engine's version");
  assert.equal(server.packages.length, 1);
  const only = server.packages[0];
  assert.equal(only.identifier, pkg.name, "the package named is the one published");
  assert.equal(only.version, engine.version);
  assert.equal(only.registryType, "npm");
  assert.equal(only.registryBaseUrl, "https://registry.npmjs.org", "the registry accepts no other npm mirror");
  assert.deepEqual(only.transport, { type: "stdio" });
  // Without this argument a client would run the command line itself, which speaks no MCP on its own.
  assert.deepEqual(only.packageArguments, [{ type: "positional", value: "mcp" }]);
  // The registry's own limits, checked here so a refusal is not discovered at publishing time.
  assert.ok(server.description.length <= 100, "the registry caps a description at 100 characters");
  assert.ok(server.title.length <= 100);
});
