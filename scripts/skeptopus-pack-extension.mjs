#!/usr/bin/env node
// SkeptOpus / puts the editor extension together: its own few files plus the engine it carries.
//
//   node scripts/skeptopus-pack-extension.mjs                 writes dist/skeptopus-<version>.vsix
//   node scripts/skeptopus-pack-extension.mjs --stage <dir>   only lays the files out in <dir> (to try them in an editor)
//
// A .vsix is a zip with two small descriptions beside the extension's folder. It is written here, by hand, so that
// packing needs nothing downloaded and the same files always give the same package. Nothing is published:
// the package is a local file, installed with "Install from VSIX" or `code --install-extension`.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as zlib from "node:zlib";

const { deflateRawSync } = zlib;
// zlib.crc32 arrived with Node 20.15 and 22.2. On an older Node (18 is supported) the same arithmetic is written out:
// found on 2026-11-13, when this file could not even load under Linux with Node 18.
const crc32 =
  zlib.crc32 ??
  ((data) => {
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    return (crc ^ 0xffffffff) >>> 0;
  });

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// What the extension is made of. The folder of tests that need a real editor stays out of the package.
const OWN = ["package.json", "package.nls.json", "package.nls.fr.json", "package.nls.es.json", "package.nls.zh-cn.json", "extension.js", "README.md", "CHANGELOG.md", "lib", "l10n", "media"];
const ENGINE = ["cli.mjs", "claims.mjs", "observe.mjs", "words.mjs", "mcp.mjs", "package.json", "art", "fonts", "sounds"];
const TYPES = { ".json": "application/json", ".js": "application/javascript", ".mjs": "application/javascript", ".md": "text/markdown", ".txt": "text/plain", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp", ".wav": "audio/wav", ".woff": "application/font-woff", ".woff2": "font/woff2", ".vsixmanifest": "text/xml" };

function walk(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, base));
    else out.push(relative(base, full).split(sep).join("/"));
  }
  return out;
}

/** Lays out, in `dir`, exactly what an editor loads: the extension and, inside it, a copy of the engine. */
export function stage(dir, { withHostTest = false, root = ROOT } = {}) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "engine"), { recursive: true });
  for (const name of [...OWN, ...(withHostTest ? ["host-test"] : [])]) {
    const from = join(root, "extension", name);
    if (!existsSync(from)) throw new Error("missing in extension/: " + name);
    cpSync(from, join(dir, name), { recursive: true });
  }
  for (const name of ENGINE) {
    const from = join(root, "core", name);
    if (!existsSync(from)) throw new Error("missing in core/: " + name);
    cpSync(from, join(dir, "engine", name), { recursive: true });
  }
  // One version, the engine's: an extension that carries an engine says which one.
  const engine = JSON.parse(readFileSync(join(dir, "engine", "package.json"), "utf8")).version;
  const own = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  if (own.version !== engine) throw new Error(`the extension says ${own.version} and its engine ${engine}: they ship as one`);
  return { dir, version: own.version, files: walk(dir) };
}

const xml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function manifest(pkg, description) {
  const repo = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  // What a store shows beside the extension: where its code lives, where to ask, and the colour behind its name.
  const shown = [
    ["Links.Source", repo],
    ["Links.Getstarted", repo],
    ["Links.GitHub", /^https:\/\/github\.com\//.test(repo ?? "") ? repo : null],
    ["Links.Support", pkg.bugs?.url],
    ["Links.Learn", pkg.homepage],
    ["Branding.Color", pkg.galleryBanner?.color],
    ["Branding.Theme", pkg.galleryBanner?.theme],
  ]
    .filter(([, value]) => value)
    .map(([key, value]) => `\n      <Property Id="Microsoft.VisualStudio.Services.${key}" Value="${xml(value)}"/>`)
    .join("");
  return `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${xml(pkg.name)}" Version="${xml(pkg.version)}" Publisher="${xml(pkg.publisher)}"/>
    <DisplayName>${xml(pkg.displayName)}</DisplayName>
    <Description xml:space="preserve">${xml(description)}</Description>
    <Tags>${xml((pkg.keywords ?? []).join(","))}</Tags>
    <Categories>${xml((pkg.categories ?? []).join(","))}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${xml(pkg.engines.vscode)}"/>
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value=""/>
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value=""/>
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="${xml((pkg.extensionKind ?? ["workspace"]).join(","))}"/>
      <Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value=""/>
      <Property Id="Microsoft.VisualStudio.Services.GitHubFlavoredMarkdown" Value="true"/>
      <Property Id="Microsoft.VisualStudio.Services.Content.Pricing" Value="Free"/>${shown}
    </Properties>
    <Icon>extension/${xml(pkg.icon)}</Icon>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code"/>
  </Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Content.Changelog" Path="extension/CHANGELOG.md" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/${xml(pkg.icon)}" Addressable="true"/>
  </Assets>
</PackageManifest>
`;
}

function contentTypes(files) {
  const seen = [...new Set(files.map((f) => (/\.[^./]+$/.exec(f)?.[0] ?? "").toLowerCase()))].sort();
  const unknown = seen.filter((e) => !TYPES[e]);
  if (unknown.length) throw new Error("no content type known for: " + unknown.join(" "));
  return `<?xml version="1.0" encoding="utf-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${seen.map((e) => `<Default Extension="${e}" ContentType="${TYPES[e]}"/>`).join("")}</Types>\n`;
}

/** A zip, written entry by entry. Fixed date: the same files give the same bytes on any day. */
export function zip(entries) {
  const DATE = ((2026 - 1980) << 9) | (11 << 5) | 12; // 2026-11-12
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
    const packed = deflateRawSync(raw, { level: 9 });
    const store = packed.length >= raw.length;
    const body = store ? raw : packed;
    const file = Buffer.from(name, "utf8");
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6); // names are UTF-8
    head.writeUInt16LE(store ? 0 : 8, 8);
    head.writeUInt16LE(0, 10);
    head.writeUInt16LE(DATE, 12);
    head.writeUInt32LE(crc32(raw), 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(raw.length, 22);
    head.writeUInt16LE(file.length, 26);
    head.writeUInt16LE(0, 28);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    head.copy(dir, 6, 4, 30); // version needed, flags, method, time, date, crc, sizes, name length, extra length
    dir.writeUInt32LE(offset, 42);
    parts.push(head, file, body);
    central.push(dir, file);
    offset += 30 + file.length + body.length;
  }
  const dirBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dirBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dirBytes, end]);
}

/** The package itself, from a staged folder. */
export function vsix(staged) {
  const pkg = JSON.parse(readFileSync(join(staged.dir, "package.json"), "utf8"));
  const words = JSON.parse(readFileSync(join(staged.dir, "package.nls.json"), "utf8"));
  const description = String(pkg.description).replace(/^%(.+)%$/, (_, key) => words[key] ?? key);
  const inside = staged.files.map((f) => "extension/" + f);
  return zip([["extension.vsixmanifest", manifest(pkg, description)], ["[Content_Types].xml", contentTypes([...inside, "extension.vsixmanifest"])], ...staged.files.map((f) => ["extension/" + f, readFileSync(join(staged.dir, f))])]);
}

const startedAs = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (startedAs === import.meta.url) {
  const args = process.argv.slice(2);
  const at = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  if (at("--stage")) {
    const staged = stage(resolve(at("--stage")), { withHostTest: args.includes("--with-host-test") });
    console.log(staged.dir, staged.files.length + " files", "version " + staged.version);
  } else {
    const work = join(ROOT, "dist", "skeptopus-extension");
    const staged = stage(work);
    const out = resolve(at("--out") ?? join(ROOT, "dist", "skeptopus-" + staged.version + ".vsix"));
    mkdirSync(dirname(out), { recursive: true });
    const bytes = vsix(staged);
    writeFileSync(out, bytes);
    rmSync(work, { recursive: true, force: true });
    console.log(out, bytes.length + " bytes", staged.files.length + " files", "version " + staged.version);
  }
}
