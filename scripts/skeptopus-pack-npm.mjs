#!/usr/bin/env node
// SkeptOpus / puts the npm package together: the engine as it is in core/, with the README, the license and the
// notice beside it, and the description npm needs. So that `npx skeptopus install` works on any machine with Node.js.
//
//   node scripts/skeptopus-pack-npm.mjs                  writes dist/npm/skeptopus-<version>.tgz
//   node scripts/skeptopus-pack-npm.mjs --stage <dir>    only lays the files out in <dir>
//
// Nothing is published. `npm publish dist/npm/skeptopus-<version>.tgz` stays a separate gesture, made from the
// account that owns the name. The engine's own package.json stays private, so nothing goes out by accident: only
// the description written here can be published.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOME = "https://github.com/systasys/skeptopus";

/** The name that signs the package: the publisher of the extension in the stores, so npm and the stores agree. */
function signer() {
  try {
    return JSON.parse(readFileSync(join(ROOT, "extension", "package.json"), "utf8")).publisher.toUpperCase();
  } catch {
    return undefined; // no extension beside the engine: npm simply shows no author
  }
}

/** The README, the license and the notice: written for the public repository, kept beside the engine there. */
function beside(root, name) {
  for (const at of [join(root, "release", "public", name), join(root, name)]) if (existsSync(at)) return at;
  throw new Error("missing: " + name);
}

/**
 * A README read on npm's site has no repository around it: every relative address is made absolute, pointing at
 * the tagged version on GitHub, pictures at their raw bytes and links at their page.
 */
export function absolute(text, version) {
  const tag = "v" + version;
  const raw = (p) => `https://raw.githubusercontent.com/systasys/skeptopus/${tag}/${p}`;
  const page = (p) => `${HOME}/blob/${tag}/${p}`;
  const relative = (p) => !/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(p);
  const picture = (p) => /\.(?:png|jpe?g|gif|webp|svg)$/i.test(p);
  return text
    .replace(/\b(src|srcset)="([^"]+)"/g, (whole, attr, p) => (relative(p) ? `${attr}="${raw(p)}"` : whole))
    .replace(/\bhref="([^"]+)"/g, (whole, p) => (relative(p) ? `href="${page(p)}"` : whole))
    .replace(/\]\(([^)\s]+)\)/g, (whole, p) => (relative(p) ? `](${picture(p) ? raw(p) : page(p)})` : whole));
}

/** Lays out, in `dir`, exactly what npm will carry, and the description that makes it publishable. */
export function stage(dir, { root = ROOT } = {}) {
  const core = JSON.parse(readFileSync(join(root, "core", "package.json"), "utf8"));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const name of core.files) {
    const from = join(root, "core", name);
    if (!existsSync(from)) throw new Error("missing in core/: " + name);
    cpSync(from, join(dir, name), { recursive: true });
  }
  writeFileSync(join(dir, "README.md"), absolute(readFileSync(beside(root, "README.md"), "utf8"), core.version));
  for (const name of ["LICENSE", "NOTICE"]) cpSync(beside(root, name), join(dir, name));
  const pkg = {
    name: core.name,
    version: core.version,
    description: core.description,
    keywords: ["ai", "agent", "verification", "claude-code", "codex", "cursor", "gemini-cli", "mcp", "vibe-coding", "hooks"],
    homepage: HOME + "#readme",
    bugs: { url: HOME + "/issues" },
    repository: { type: "git", url: "git+" + HOME + ".git" },
    license: core.license,
    author: signer(),
    type: core.type,
    bin: core.bin,
    files: [...core.files, "NOTICE"],
    engines: core.engines,
  };
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
  return { dir, version: pkg.version, pkg };
}

const startedAs = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (startedAs === import.meta.url) {
  const args = process.argv.slice(2);
  const at = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  if (at("--stage")) {
    const staged = stage(resolve(at("--stage")));
    console.log(staged.dir, "version " + staged.version);
  } else {
    const out = join(ROOT, "dist", "npm");
    const staged = stage(join(out, "package"));
    // npm itself packs, the way it will when it publishes: what it lists is what will go out.
    const windows = process.platform === "win32";
    const listed = execFileSync(windows ? "npm.cmd" : "npm", ["pack", "--pack-destination", out], { cwd: staged.dir, encoding: "utf8", shell: windows });
    rmSync(staged.dir, { recursive: true, force: true });
    console.log(join(out, listed.trim().split(/\r?\n/).pop()), "version " + staged.version);
  }
}
