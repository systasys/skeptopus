#!/usr/bin/env node
// SkeptOpus core / the receipt on a pull request written by an AI agent.
//
// Run by action.yml on `pull_request`. It reads what the pull request says it did (its title, its description,
// its commit messages), checks available evidence with the same engine as everywhere else, and leaves one comment on the
// pull request: the four answers, with what was seen. The comment is updated in place on every push, and keeps
// the answers of the earlier pushes in one line, so the history of a pull request stays on the pull request.
//
// What it talks to: this repository's GitHub API, with the run's own token, to read the pull request and its
// commits and to write the comment. Nothing else is sent anywhere, and nothing is counted.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { asides, check, failsOn, target, VERSION } from "./cli.mjs";
import { loadConfig, rootsOf, run } from "./observe.mjs";
import { PAGE, WORDS, pickLang, say } from "./words.mjs";

// ---------- who wrote it: read from GitHub's record and the commits, never guessed ----------
// Each agent is known by what it leaves behind: the account that opens or pushes, the author of its commits,
// a trailer in a commit message, a line it writes in the description, the prefix of the branch it makes.
// A branch prefix is the weakest of these (a person can name a branch "claude/..."), so the receipt always
// says which of them was seen, and the reader judges.
export const AGENTS = [
  { name: "GitHub Copilot", login: /^(copilot|copilot-swe-agent(\[bot\])?)$/i, author: /^copilot$|copilot@users\.noreply/i, trailer: /^co-authored-by:\s*copilot\b/im, branch: /^copilot\//i },
  { name: "OpenAI Codex", login: /^(chatgpt-codex-connector|codex)(\[bot\])?$/i, mark: /chatgpt\.com\/codex\/tasks\//i, trailer: /^co-authored-by:\s*codex\b/im, branch: /^codex\//i },
  { name: "Claude Code", login: /^claude(\[bot\])?$/i, author: /^claude(\[bot\])?$/i, trailer: /^co-authored-by:\s*claude\b/im, mark: /generated with \[?claude code\b/i, branch: /^claude\//i },
  { name: "Cursor", login: /^cursor(agent)?(\[bot\])?$/i, author: /^cursor agent$|@cursor\.com$/i, trailer: /^co-authored-by:\s*cursor\b/im, branch: /^cursor\//i },
  { name: "Devin", login: /^devin-ai-integration(\[bot\])?$/i, author: /^devin(-ai-integration)?(\[bot\])?$/i, branch: /^devin\//i },
  { name: "Jules", login: /^google-labs-jules(\[bot\])?$/i, author: /^google-labs-jules(\[bot\])?$/i, branch: /^jules\//i },
  { name: "Gemini", login: /^gemini-code-assist(\[bot\])?$/i, trailer: /^co-authored-by:\s*gemini\b/im },
  { name: "Amazon Q", login: /^amazon-q-developer(\[bot\])?$/i, author: /^amazon q developer$/i },
  { name: "Aider", trailer: /^co-authored-by:\s*aider\b/im, author: /\(aider\)$/i },
  { name: "OpenHands", login: /^openhands(-agent)?(\[bot\])?$/i, trailer: /^co-authored-by:\s*openhands\b/im, branch: /^openhands\//i },
];

/**
 * The agents seen on a pull request, each with the places it was seen.
 * @param {{author?:string, pusher?:string, branch?:string, title?:string, body?:string, commits?:{message:string, author?:string, email?:string, login?:string}[]}} pr
 * @returns {{name:string, seen:{where:string, what:string, count?:number}[]}[]}
 */
export function agentsOn(pr) {
  const commits = pr.commits ?? [];
  const found = [];
  for (const a of AGENTS) {
    const seen = [];
    if (a.login && pr.author && a.login.test(pr.author)) seen.push({ where: "opened", what: pr.author });
    if (a.login && pr.pusher && pr.pusher !== pr.author && a.login.test(pr.pusher)) seen.push({ where: "pushed", what: pr.pusher });
    const authored = commits.filter((c) => (a.author && [c.author, c.email].some((x) => x && a.author.test(x))) || (a.login && c.login && a.login.test(c.login)));
    if (authored.length) seen.push({ where: "author", what: authored[0].login || authored[0].author, count: authored.length });
    const trailed = a.trailer ? commits.filter((c) => a.trailer.test(c.message ?? "")) : [];
    if (trailed.length) seen.push({ where: "trailer", what: (a.trailer.exec(trailed[0].message)?.[0] ?? "").trim(), count: trailed.length });
    // Shown as words: "[Claude Code](https://...)" in the description is read "Claude Code".
    if (a.mark && a.mark.test(pr.body ?? "")) seen.push({ where: "description", what: (a.mark.exec(pr.body)?.[0] ?? "").replace(/[[\]]/g, "").trim() });
    if (a.branch && pr.branch && a.branch.test(pr.branch)) seen.push({ where: "branch", what: pr.branch });
    if (seen.length) found.push({ name: a.name, seen });
  }
  return found;
}

// ---------- the words of the receipt ----------
const TEXT = {
  en: {
    title: "SkeptOpus receipt",
    by: (names) => "Written by " + names + ".",
    seenAs: "seen as",
    where: {
      opened: (w) => "opened by `" + w + "`",
      pushed: (w) => "pushed by `" + w + "`",
      author: (w, n, all) => "author `" + w + "` of " + n + " of " + all + " commits",
      trailer: (w, n, all) => "`" + w + "` in " + n + " of " + all + " commits",
      description: (w) => "“" + w + "” in the description",
      branch: (w) => "branch `" + w + "`",
    },
    read: (sha) => "SkeptOpus read what this pull request claims and checked available evidence at `" + sha + "`.",
    readAll: (sha) => "No AI agent was seen on this pull request; it was checked anyway, as this repository asks. SkeptOpus examined the available evidence at `" + sha + "`.",
    head: ["Answer", "What it says", "What SkeptOpus saw"],
    none: "Nothing in this pull request says something was done in a way SkeptOpus can check. That is not a verdict on the work.",
    earlier: "Earlier on this pull request:",
    run: "Checked inside this run",
    alone: "nothing was sent anywhere else",
    noAgent: (looked) => "No AI agent seen on this pull request, so nothing was checked. Looked at: " + looked + ". To check every pull request, set `who: everyone`.",
    looked: (n) => "who opened it, who pushed, the authors and trailers of " + n + " commit" + (n === 1 ? "" : "s") + ", the description, the branch name",
    notPosted: (why) => "The receipt could not be left on the pull request (" + why + "). It is here, in the run's summary.",
    readOnly: "this run's token can only read, as for a pull request from a fork",
    badge: "A badge for your README (green while the last AI pull request carries no contradiction):",
    commitsUnread: (why) => "The commit messages could not be read (" + why + "): only the title and the description were checked.",
  },
  fr: {
    title: "Reçu SkeptOpus",
    by: (names) => "Écrite par " + names + ".",
    seenAs: "vu à",
    where: {
      opened: (w) => "ouverte par `" + w + "`",
      pushed: (w) => "poussée par `" + w + "`",
      author: (w, n, all) => "auteur `" + w + "` de " + n + " commit" + (n > 1 ? "s" : "") + " sur " + all,
      trailer: (w, n, all) => "`" + w + "` dans " + n + " commit" + (n > 1 ? "s" : "") + " sur " + all,
      description: (w) => "« " + w + " » dans la description",
      branch: (w) => "branche `" + w + "`",
    },
    read: (sha) => "SkeptOpus a lu les affirmations de cette demande de fusion et vérifié les éléments accessibles, à `" + sha + "`.",
    readAll: (sha) => "Aucun agent IA vu sur cette demande de fusion ; elle est vérifiée quand même, comme ce dépôt le demande. SkeptOpus a examiné les éléments accessibles, à `" + sha + "`.",
    head: ["Réponse", "Ce qu'elle dit", "Ce que SkeptOpus a vu"],
    none: "Rien dans cette demande de fusion ne dit qu'une chose a été faite d'une façon que SkeptOpus sache vérifier. Ce n'est pas un jugement sur le travail.",
    earlier: "Plus tôt sur cette demande :",
    run: "Vérifié dans ce run",
    alone: "rien n'a été envoyé ailleurs",
    noAgent: (looked) => "Aucun agent IA vu sur cette demande de fusion, donc rien n'a été vérifié. Regardé : " + looked + ". Pour vérifier toutes les demandes, mettre `who: everyone`.",
    looked: (n) => "qui l'a ouverte, qui a poussé, les auteurs et les mentions de " + n + " commit" + (n > 1 ? "s" : "") + ", la description, le nom de la branche",
    notPosted: (why) => "Le reçu n'a pas pu être posé sur la demande de fusion (" + why + "). Il est ici, dans le résumé du run.",
    readOnly: "le jeton de ce run ne peut que lire, comme pour une demande venue d'une copie du dépôt",
    badge: "Un badge pour votre README (vert tant que la dernière demande écrite par une IA ne porte aucune contradiction) :",
    commitsUnread: (why) => "Les messages des commits n'ont pas pu être lus (" + why + ") : seuls le titre et la description ont été vérifiés.",
  },
};
const textOf = (lang) => TEXT[pickLang(lang)] ?? TEXT.en;
const MARK = { PROVEN: "✅", NOT_PROVEN: "🟠", CONTRADICTED: "🔴", COULD_NOT_CHECK: "⚪", NOTHING_CLAIMED: "⚪" };
const ORDER = ["PROVEN", "NOT_PROVEN", "CONTRADICTED", "COULD_NOT_CHECK"];
const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const code = (s) => "`" + String(s).replace(/`/g, "'") + "`";
const plain = (html) => String(html).replace(/<\/?strong>/g, "**").replace(/<[^>]+>/g, "");
export const MARKER = "<!-- skeptopus:receipt -->";

/** One line of who wrote it, and where that was seen. */
function byLine(agents, commitCount, lang) {
  const t = textOf(lang);
  const one = (a) => "**" + a.name + "** (" + t.seenAs + " " + a.seen.map((s) => t.where[s.where](s.what, s.count, commitCount)).join(" ; ") + ")";
  return t.by(agents.map(one).join(", "));
}

/**
 * The comment itself. Everything in it comes from the report and from the pull request: no number is made up,
 * and an answer SkeptOpus could not reach is shown as such, never as a zero or as seen.
 */
export function receiptMarkdown({ report, agents, pr, lang = "en", runUrl, history = [], notes = [] }) {
  const t = textOf(lang);
  const w = WORDS[pickLang(lang)];
  const sha = String(pr.head ?? "").slice(0, 7);
  const counts = Object.fromEntries(ORDER.map((v) => [v, report.rows.filter((r) => r.verdict === v).length]));
  const lines = [MARKER, "### " + t.title + " · " + MARK[report.verdict] + " " + w[report.verdict], ""];
  lines.push(agents.length ? byLine(agents, pr.commits?.length ?? 0, lang) + " " + t.read(sha) : t.readAll(sha), "");
  if (!report.rows.length) lines.push(t.none);
  else {
    lines.push(ORDER.map((v) => MARK[v] + " **" + w[v] + "** " + counts[v]).join(" · "), "");
    lines.push("| " + t.head.join(" | ") + " |", "| --- | --- | --- |");
    for (const r of report.rows) {
      const what = (r.claim.negated ? w.not : "") + (w.kind[r.claim.kind] ?? r.claim.kind) + (target(r.claim) ? " " + code(target(r.claim)) : "");
      lines.push("| " + MARK[r.verdict] + " " + w[r.verdict] + " | " + cell(what) + " | " + cell(say(lang, r.why) + asides(lang, r.facts)) + " |");
    }
  }
  for (const note of notes) lines.push("", "> " + note);
  if (history.length) lines.push("", t.earlier + " " + history.map((h) => code(String(h.head).slice(0, 7)) + " " + MARK[h.verdict] + " " + (w[h.verdict] ?? h.verdict)).join(" · "));
  lines.push("", "<sub>" + plain(PAGE[pickLang(lang)]?.what?.[1] ?? PAGE.en.what[1]) + "</sub>");
  lines.push("<sub>" + (runUrl ? "[" + t.run + "](" + runUrl + ")" : t.run) + " · " + t.alone + " · SkeptOpus " + VERSION + " · MIT</sub>");
  lines.push(dataBlock({ report, agents, pr, history }));
  return lines.join("\n");
}

// ---------- what the comment keeps for later: the history of this pull request, on the pull request ----------
// A compact record in an HTML comment: GitHub does not show it, a reader of the comment's source does. It holds
// the answers of each push, so the history stays where the work is, owned by the repository. A later tool
// reads it from there, with the repository's own permission; nothing is collected anywhere else.
const DATA = /<!-- skeptopus:data (\{.*?\}) -->/s;
function dataBlock({ report, agents, pr, history }) {
  const now = { head: pr.head, verdict: report.verdict, at: new Date().toISOString(), counts: Object.fromEntries(ORDER.map((v) => [v, report.rows.filter((r) => r.verdict === v).length])) };
  const record = {
    v: 1,
    tool: "skeptopus",
    version: VERSION,
    pr: pr.number,
    agents: agents.map((a) => a.name),
    runs: [...history, now].slice(-20),
    claims: report.rows.map((r) => ({ kind: r.claim.kind, target: target(r.claim) || undefined, verdict: r.verdict, why: r.why })),
  };
  // "--" cannot appear inside an HTML comment; in JSON it can only sit inside a string, where - reads the same.
  return "<!-- skeptopus:data " + JSON.stringify(record).replace(/--/g, "-\\u002d") + " -->";
}
/** The runs an earlier receipt recorded, other than the one for this same commit (a run started again). */
export function historyFrom(body, head) {
  try {
    const runs = JSON.parse(DATA.exec(body ?? "")?.[1] ?? "null")?.runs;
    return Array.isArray(runs) ? runs.filter((r) => r && typeof r.head === "string" && r.head !== head && typeof r.verdict === "string").slice(-19) : [];
  } catch {
    return [];
  }
}

// ---------- GitHub, with the run's own token ----------
let API = "https://api.github.com";
async function gh(method, path, token, body) {
  try {
    const res = await fetch(API + path, {
      method,
      headers: { accept: "application/vnd.github+json", authorization: "Bearer " + token, "user-agent": "SkeptOpus action", "x-github-api-version": "2022-11-28", ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, json };
  } catch (error) {
    return { status: 0, error: String(error?.cause?.code ?? error?.name ?? error).slice(0, 60) };
  }
}
const failed = (r) => (r.error ? r.error : "HTTP " + r.status);

async function commitsOf(repo, number, token) {
  const all = [];
  for (let page = 1; page <= 3; page++) {
    const got = await gh("GET", `/repos/${repo}/pulls/${number}/commits?per_page=100&page=${page}`, token);
    if (got.status !== 200 || !Array.isArray(got.json)) return { error: failed(got), commits: all };
    for (const c of got.json) all.push({ sha: c.sha, message: c.commit?.message ?? "", author: c.commit?.author?.name, email: c.commit?.author?.email, login: c.author?.login });
    if (got.json.length < 100) break;
  }
  return { commits: all };
}
async function earlierReceipt(repo, number, token) {
  for (let page = 1; page <= 10; page++) {
    const got = await gh("GET", `/repos/${repo}/issues/${number}/comments?per_page=100&page=${page}`, token);
    if (got.status !== 200 || !Array.isArray(got.json)) return null;
    const mine = got.json.find((c) => typeof c.body === "string" && c.body.startsWith(MARKER));
    if (mine) return mine;
    if (got.json.length < 100) return null;
  }
  return null;
}

/**
 * The engine's commands, with the token lent to GitHub's own tool when it only reads (a pull request viewed, a
 * plain GET), so a private repository can be looked at. Nothing else gets it: not the test command, which runs
 * the pull request's code, and not a `gh` call that writes, whatever a settings file declares.
 */
export function readingWith(token, runner = run) {
  const reads = (args) => (args[0] === "pr" && args[1] === "view") || (args[0] === "api" && !args.some((a) => /^(-X|--method|-f|-F|--field|--raw-field|--input)$/.test(a) || /^(-X|--method=)/.test(a)));
  return (cmd, args, options = {}) => runner(cmd, args, token && cmd === "gh" && reads(args) ? { ...options, env: { ...options.env, GH_TOKEN: token } } : options);
}

// ---------- the run ----------
export async function main(env = process.env) {
  const input = (name, fallback = "") => (env["INPUT_" + name.toUpperCase().replace(/-/g, "_")] ?? "").trim() || fallback;
  const output = (name, value) => env.GITHUB_OUTPUT && appendFileSync(env.GITHUB_OUTPUT, name + "=" + String(value).replace(/\r?\n/g, " ") + "\n");
  const summary = (text) => (env.GITHUB_STEP_SUMMARY ? appendFileSync(env.GITHUB_STEP_SUMMARY, text + "\n\n") : console.log(text));
  // The token is taken out of the environment before anything runs: the test command a repository declares
  // runs code from the pull request, and must not find a token that can write.
  const token = env.SKEPTOPUS_TOKEN ?? "";
  delete env.SKEPTOPUS_TOKEN;
  delete process.env.SKEPTOPUS_TOKEN;
  API = (env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "");
  const lang = pickLang(input("lang", "en"));
  const t = textOf(lang);
  const who = input("who", "ai-agents");
  const failOn = input("fail-on", "contradicted");
  if (!["contradicted", "problems", "anything", "never"].includes(failOn)) {
    console.error("skeptopus: fail-on takes contradicted, problems, anything or never");
    return 64;
  }
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
  const p = event.pull_request;
  if (!p) {
    summary("SkeptOpus: this run is not about a pull request (" + (env.GITHUB_EVENT_NAME ?? "?") + "): nothing to read.");
    return 0;
  }
  const repo = env.GITHUB_REPOSITORY;
  const pr = { number: p.number, head: p.head?.sha, branch: p.head?.ref, author: p.user?.login, pusher: event.sender?.login, title: p.title ?? "", body: p.body ?? "" };
  const got = token ? await commitsOf(repo, pr.number, token) : { error: "no token", commits: [] };
  pr.commits = got.commits;
  const notes = got.error ? [t.commitsUnread(got.error)] : [];
  const agents = agentsOn(pr);
  output("agents", agents.map((a) => a.name).join(", "));
  if (!agents.length && who !== "everyone") {
    summary("### SkeptOpus\n\n" + t.noAgent(t.looked(pr.commits.length)));
    output("verdict", "NOT_CHECKED");
    return 0;
  }

  // What the pull request says, in one text: the title, the description, then each commit message.
  const message = [pr.title, pr.body, ...pr.commits.map((c) => c.message)].filter(Boolean).join("\n\n");
  const cwd = env.GITHUB_WORKSPACE || process.cwd();
  const settings = input("settings");
  const config = loadConfig(settings ? join(cwd, settings) : undefined, cwd);
  const report = await check(message, { roots: rootsOf(cwd, config, []), config, allowSlow: true, run: readingWith(token) });

  const server = (env.GITHUB_SERVER_URL || "https://github.com").replace(/\/+$/, "");
  const runUrl = env.GITHUB_RUN_ID ? `${server}/${repo}/actions/runs/${env.GITHUB_RUN_ID}` : undefined;
  const before = token ? await earlierReceipt(repo, pr.number, token) : null;
  const body = receiptMarkdown({ report, agents, pr, lang, runUrl, history: historyFrom(before?.body, pr.head), notes });

  // The receipt in the run's summary too, so it can be read even when it cannot be posted.
  let posted = null;
  if (token) posted = before ? await gh("PATCH", `/repos/${repo}/issues/comments/${before.id}`, token, { body }) : await gh("POST", `/repos/${repo}/issues/${pr.number}/comments`, token, { body });
  const ok = posted && (posted.status === 200 || posted.status === 201);
  const lines = [body.replace(MARKER, "").replace(DATA, "").trim()];
  if (!ok) lines.push("> " + t.notPosted(!token ? "no token" : posted.status === 403 ? t.readOnly : failed(posted)));
  const workflow = /^[^/]+\/[^/]+\/(\.github\/workflows\/[^@]+)@/.exec(env.GITHUB_WORKFLOW_REF ?? "")?.[1];
  if (workflow) {
    const page = `${server}/${repo}/actions/workflows/${workflow.split("/").pop()}`;
    lines.push(t.badge + "\n\n```markdown\n[![SkeptOpus](" + page + "/badge.svg?event=pull_request)](" + page + ")\n```");
  }
  summary(lines.join("\n\n"));

  const file = join(env.RUNNER_TEMP || cwd, "skeptopus-receipt.json");
  writeFileSync(file, JSON.stringify({ tool: "skeptopus", version: VERSION, repo, pr: pr.number, head: pr.head, agents, ...report }, null, 2) + "\n");
  output("verdict", report.verdict);
  output("receipt-file", file);
  if (ok) output("comment-url", posted.json?.html_url ?? "");
  console.log("SkeptOpus · " + report.verdict + " · " + report.rows.length + " claim(s)" + (ok ? " · receipt " + (before ? "updated" : "posted") + (posted.json?.html_url ? ": " + posted.json.html_url : "") : " · receipt not posted"));
  return failsOn(report.verdict, failOn) ? 1 : 0;
}

// Started by the action, not imported by a test.
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await main();
