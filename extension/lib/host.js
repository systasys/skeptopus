// SkeptOpus in an editor / what the extension decides without the editor.
// Pure functions: no editor, no file, no clock, so they are tested on their own.
"use strict";

const LANGS = ["en", "fr", "es", "zh", "ar"];

/**
 * The language shown first: the one the reader chose in the panel, else the user's SkeptOpus setting,
 * else the editor's own language, else English (the original).
 */
function pickLanguage(choice, setting, editorLanguage) {
  for (const wish of [choice, setting, String(editorLanguage ?? "").slice(0, 2).toLowerCase()]) if (LANGS.includes(wish)) return wish;
  return "en";
}

/**
 * The status bar: the worst answer of the day and how many, or just the name when there is nothing to say.
 * Only two things earn a coloured background, the two the editor itself reserves colours for.
 */
function statusLine(glance, lang) {
  const t = glance?.texts?.[lang] ?? glance?.texts?.en;
  if (!t) return { text: "$(skeptopus-eye) SkeptOpus", tooltip: "SkeptOpus", tone: null };
  const tone = glance.worst === "CONTRADICTED" ? "error" : glance.worst === "NOT_PROVEN" ? "warning" : null;
  // Nothing wrong today: the name alone. The figures stay one hover away.
  const quiet = !glance.worst || glance.worst === "PROVEN";
  return { text: "$(skeptopus-eye) " + (quiet ? "SkeptOpus" : t.short), tooltip: "SkeptOpus\n" + t.mood, tone };
}

/** What a webview must allow for the journal page to run, and nothing more. */
function policy(cspSource, nonce) {
  return ["default-src 'none'", "img-src data: " + cspSource, "style-src 'unsafe-inline'", "font-src " + cspSource, "script-src 'nonce-" + nonce + "'"].join("; ");
}

// The one thing the page cannot tell the editor by itself: which language its reader just chose.
const SHIM = '(function(){var api=acquireVsCodeApi();document.addEventListener("click",function(e){var b=e.target&&e.target.closest&&e.target.closest(".langs button[data-set]");if(b)api.postMessage({type:"lang",lang:b.getAttribute("data-set")})},true)})();';

/** The page the engine wrote, plus the host's own few lines, marked the way the policy requires. */
function withShim(html, nonce) {
  const at = html.lastIndexOf("</body>");
  const script = '<script nonce="' + nonce + '">' + SHIM + "</script>";
  return at < 0 ? html + script : html.slice(0, at) + script + html.slice(at);
}

/** A page for the rare case where the engine itself could not be started: said plainly, in the panel's own colours. */
function troublePage(title, detail) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  return (
    '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'">' +
    "<style>body{font:14px/1.5 var(--vscode-font-family,system-ui);color:var(--vscode-foreground);padding:16px}pre{white-space:pre-wrap;font:12px/1.5 var(--vscode-editor-font-family,monospace);opacity:.8}</style></head><body><p><b>" +
    esc(title) +
    "</b></p><pre>" +
    esc(String(detail).slice(0, 1200)) +
    "</pre></body></html>"
  );
}

/** Many changes in a row (the engine writes several files per answer) become one refresh. */
function debounce(fn, wait, timers = { set: setTimeout, clear: clearTimeout }) {
  let pending = null;
  return () => {
    if (pending) timers.clear(pending);
    pending = timers.set(() => {
      pending = null;
      fn();
    }, wait);
  };
}

/** The files whose change means "the journal has something new to show". */
const WATCHED = new Set(["historique.jsonl", "errata.json", "config.json"]);
const concerns = (file) => WATCHED.has(String(file ?? ""));

module.exports = { LANGS, pickLanguage, statusLine, policy, withShim, troublePage, debounce, concerns, SHIM };
