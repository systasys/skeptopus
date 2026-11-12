// SkeptOpus core / going to look. Each observer checks one kind of claim against the world,
// never against the agent's own record. Read-only, except the test command the USER declared.
//
// Four outcomes, never fewer:
//   SEEN           the world agrees with the claim
//   NOT_SEEN       SkeptOpus looked and did not find it
//   AGAINST        SkeptOpus looked and found the opposite
//   COULD_NOT_LOOK SkeptOpus could not look. This is never a verdict about the agent.
import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export const run = (cmd, args, options = {}) =>
  new Promise((done) =>
    execFile(
      cmd,
      args,
      { windowsHide: true, timeout: options.timeout ?? 20000, maxBuffer: 8 * 1024 * 1024, cwd: options.cwd, env: { ...process.env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0", NO_COLOR: "1" } },
      (error, stdout, stderr) =>
        done({
          ok: !error,
          code: error ? (typeof error.code === "number" ? error.code : null) : 0,
          missing: error?.code === "ENOENT",
          timedOut: Boolean(error?.killed),
          stdout: String(stdout ?? "").trim(),
          stderr: String(stderr ?? "").trim(),
        }),
    ),
  );

const result = (outcome, why, facts = {}) => ({ outcome, why, facts });
async function repos(ctx) {
  const out = [];
  for (const root of ctx.roots) {
    const top = await ctx.run("git", ["-C", root, "rev-parse", "--show-toplevel"]);
    if (top.ok && !out.includes(top.stdout)) out.push(top.stdout);
  }
  return out;
}

async function fileWritten(claim, ctx) {
  const candidates = isAbsolute(claim.path) ? [claim.path] : ctx.roots.map((root) => join(root, claim.path));
  const found = candidates.find((p) => existsSync(p));
  if (!found) return result("NOT_SEEN", "FILE_ABSENT", { looked: candidates.length });
  let info;
  try {
    info = statSync(found);
  } catch {
    return result("COULD_NOT_LOOK", "FILE_UNREADABLE", { path: found });
  }
  if (info.isDirectory() && claim.kind === "FILE_REFERENCED") return result("SEEN", "FOLDER_PRESENT", { path: found });
  if (!info.isFile()) return result("NOT_SEEN", "NOT_A_FILE", { path: found });
  if (info.size === 0) return result("AGAINST", "FILE_EMPTY", { path: found });
  const facts = { path: found, bytes: info.size, modifiedAt: info.mtime.toISOString() };
  // Pointing at a file claims that it exists, not that it is new.
  if (claim.kind === "FILE_REFERENCED") return result("SEEN", "FILE_PRESENT", facts);
  // A file older than the session was not written by it: that is the recycler's trick.
  if (ctx.sessionStart && info.mtime.getTime() < Date.parse(ctx.sessionStart) - 2000)
    return result("NOT_SEEN", "FILE_OLDER_THAN_SESSION", { ...facts, sessionStart: ctx.sessionStart });
  return result("SEEN", ctx.sessionStart ? "FILE_PRESENT_AND_FRESH" : "FILE_PRESENT_AGE_UNKNOWN", facts);
}

async function committed(claim, ctx) {
  const list = await repos(ctx);
  if (!list.length) return result("COULD_NOT_LOOK", "NO_GIT_REPOSITORY_HERE");
  if (claim.sha) {
    for (const repo of list) {
      const hit = await ctx.run("git", ["-C", repo, "rev-parse", "--verify", "--quiet", claim.sha + "^{commit}"]);
      if (hit.ok) {
        const when = await ctx.run("git", ["-C", repo, "show", "-s", "--format=%cI", hit.stdout]);
        return result("SEEN", "COMMIT_EXISTS", { repo, sha: hit.stdout, committedAt: when.stdout });
      }
    }
    // Unknown here is not unknown everywhere: a commit merged on the server may not have been fetched yet.
    let blind = false;
    const declared = Array.isArray(ctx.config?.repos) ? ctx.config.repos.filter((r) => typeof r === "string") : [];
    for (const repo of declared) {
      const got = await ctx.run("gh", ["api", "repos/" + repo + "/commits/" + claim.sha, "--jq", "{sha: .sha, at: .commit.committer.date}"], { timeout: 25000 });
      if (got.missing) break;
      if (got.ok) {
        try {
          const info = JSON.parse(got.stdout);
          return result("SEEN", "COMMIT_EXISTS_ON_GITHUB", { repo, sha: info.sha, committedAt: info.at ?? null });
        } catch {
          blind = true;
        }
      } else if (!/HTTP (404|422)|Not Found|No commit found/i.test(got.stderr + got.stdout)) blind = true;
    }
    if (blind) return result("COULD_NOT_LOOK", "GITHUB_UNREACHABLE", { sha: claim.sha });
    return result("NOT_SEEN", "COMMIT_UNKNOWN_IN_THESE_REPOSITORIES", { repositories: list.length, askedGitHub: declared.length });
  }
  const repo = list[0];
  const head = await ctx.run("git", ["-C", repo, "show", "-s", "--format=%H %cI", "HEAD"]);
  if (!head.ok) return result("NOT_SEEN", "NO_COMMIT_YET", { repo });
  const [sha, committedAt] = head.stdout.split(" ");
  const dirty = await ctx.run("git", ["-C", repo, "status", "--porcelain"]);
  const pending = dirty.ok ? dirty.stdout.split("\n").filter(Boolean).length : null;
  if (ctx.sessionStart && Date.parse(committedAt) < Date.parse(ctx.sessionStart) - 2000)
    return result("NOT_SEEN", "LAST_COMMIT_OLDER_THAN_SESSION", { repo, sha, committedAt, pending });
  if (pending) return result("NOT_SEEN", "CHANGES_STILL_UNCOMMITTED", { repo, sha, committedAt, pending });
  return result("SEEN", "HEAD_COMMITTED_AND_TREE_CLEAN", { repo, sha, committedAt });
}

async function pushed(claim, ctx) {
  const list = await repos(ctx);
  if (!list.length) return result("COULD_NOT_LOOK", "NO_GIT_REPOSITORY_HERE");
  const repo = list[0];
  const remotes = await ctx.run("git", ["-C", repo, "remote"]);
  const remote = remotes.stdout.split("\n").filter(Boolean)[0];
  // "Pushed" with nowhere to push to is not unproven, it is impossible.
  if (!remote) return result("AGAINST", "NO_REMOTE_CONFIGURED", { repo });
  const branch = await ctx.run("git", ["-C", repo, "rev-parse", "--abbrev-ref", "HEAD"]);
  const head = await ctx.run("git", ["-C", repo, "rev-parse", "HEAD"]);
  if (!branch.ok || !head.ok || branch.stdout === "HEAD") return result("COULD_NOT_LOOK", "NO_CURRENT_BRANCH", { repo });
  // Ask the remote itself. The local "origin/branch" pointer can be stale or forged.
  const far = await ctx.run("git", ["-C", repo, "ls-remote", remote, "refs/heads/" + branch.stdout], { timeout: 25000 });
  if (!far.ok) return result("COULD_NOT_LOOK", "REMOTE_UNREACHABLE", { repo, remote });
  const remoteSha = far.stdout.split(/\s+/)[0] || null;
  const facts = { repo, remote, branch: branch.stdout, localSha: head.stdout, remoteSha };
  if (!remoteSha) return result("NOT_SEEN", "BRANCH_ABSENT_ON_REMOTE", facts);
  if (remoteSha === head.stdout) return result("SEEN", "REMOTE_HAS_THIS_COMMIT", facts);
  const behind = await ctx.run("git", ["-C", repo, "merge-base", "--is-ancestor", head.stdout, remoteSha]);
  return behind.ok ? result("SEEN", "REMOTE_CONTAINS_THIS_COMMIT", facts) : result("NOT_SEEN", "REMOTE_DOES_NOT_HAVE_THIS_COMMIT", facts);
}

async function pullRequest(claim, ctx) {
  // Named by its link: the link says which repository, so that one is asked, wherever the agent works.
  const list = claim.repo ? [] : await repos(ctx);
  if (!claim.repo && !list.length) return result("COULD_NOT_LOOK", "NO_GIT_REPOSITORY_HERE");
  let view = claim.repo
    ? await ctx.run("gh", ["pr", "view", String(claim.pr), "--repo", claim.repo, "--json", "state,mergedAt,url"], { timeout: 25000 })
    : await ctx.run("gh", ["pr", "view", String(claim.pr), "--json", "state,mergedAt,url"], { cwd: list[0], timeout: 25000 });
  if (view.missing) return result("COULD_NOT_LOOK", "GITHUB_CLI_MISSING");
  // The folder at hand may have no link to GitHub (a local-only project): ask the repositories the user declared.
  // A request number alone does not say which repository: the answer is used only if exactly one of them knows it.
  if (!claim.repo && !view.ok && !/could not resolve|not found|no pull requests? found/i.test(view.stderr)) {
    const declared = Array.isArray(ctx.config?.repos) ? ctx.config.repos.filter((r) => typeof r === "string") : [];
    const known = [];
    for (const repo of declared) {
      const far = await ctx.run("gh", ["pr", "view", String(claim.pr), "--repo", repo, "--json", "state,mergedAt,url"], { timeout: 25000 });
      if (far.ok) known.push(far);
    }
    if (known.length === 1) view = known[0];
  }
  if (!view.ok) {
    return /could not resolve|not found|no pull requests? found/i.test(view.stderr)
      ? result("NOT_SEEN", "PULL_REQUEST_UNKNOWN", { pr: claim.pr })
      : result("COULD_NOT_LOOK", "GITHUB_UNREACHABLE", { pr: claim.pr });
  }
  let pr;
  try {
    pr = JSON.parse(view.stdout);
  } catch {
    return result("COULD_NOT_LOOK", "GITHUB_ANSWER_UNREADABLE");
  }
  const facts = { pr: claim.pr, state: pr.state, mergedAt: pr.mergedAt ?? null };
  if (claim.kind === "PR_OPENED") return result("SEEN", "PULL_REQUEST_EXISTS", facts);
  if (pr.state === "MERGED") return result("SEEN", "PULL_REQUEST_MERGED", facts);
  return result("AGAINST", pr.state === "CLOSED" ? "PULL_REQUEST_CLOSED_UNMERGED" : "PULL_REQUEST_STILL_OPEN", facts);
}

/** The names of the tests a run reports as failed, in the two shapes common runners print. */
function failedNames(ran) {
  const out = String(ran.stdout ?? "") + "\n" + String(ran.stderr ?? "");
  const names = [...out.matchAll(/^\s*(?:✖|not ok \d+ -)\s+(.+?)(?:\s+\(\d[\d.]*m?s\))?\s*$/gm)].map((m) => m[1].trim());
  return [...new Set(names)].slice(0, 3).join(" ; ").slice(0, 200);
}

async function testsPass(claim, ctx) {
  // SkeptOpus only runs a command the USER declared, as an argument list, never a shell string.
  const command = ctx.config?.test;
  if (!Array.isArray(command) || !command.length || !command.every((part) => typeof part === "string"))
    return result("COULD_NOT_LOOK", "NO_TEST_COMMAND_DECLARED");
  // One real run per check, however many sentences talk about the tests.
  ctx.memo.tests ??= (async () => {
    const started = Date.now();
    const once = () => ctx.run(command[0], command.slice(1), { cwd: ctx.config.testCwd ?? ctx.config.cwd ?? ctx.roots[0], timeout: ctx.config.testTimeoutMs ?? 300000 });
    let ran = await once();
    let firstFailure = null;
    // "Contradicted" is a heavy word. A run that fails is run once more, and both results are told:
    // failing twice is a contradiction with the names of what failed; failing once is said as such, never hidden.
    if (!ran.ok && !ran.missing && !ran.timedOut) {
      firstFailure = failedNames(ran);
      ran = await once();
    }
    return { ran, firstFailure, seconds: Math.round((Date.now() - started) / 100) / 10 };
  })();
  const { ran, firstFailure, seconds } = await ctx.memo.tests;
  const facts = { command: command.join(" "), exitCode: ran.code, seconds };
  if (ran.missing) return result("COULD_NOT_LOOK", "TEST_COMMAND_NOT_FOUND", facts);
  if (ran.timedOut) return result("COULD_NOT_LOOK", "TEST_COMMAND_TIMED_OUT", facts);
  if (!ran.ok) return result("AGAINST", "TESTS_FAIL_NOW", { ...facts, check: failedNames(ran) || undefined });
  if (firstFailure !== null)
    return result("SEEN", "TESTS_PASS_ON_SECOND_RUN", { ...facts, check: firstFailure || undefined });
  // Counts are compared only when the runner prints the same shape ("pass N").
  // The declared tests pass, but they are not the number the agent spoke of: it may have run other tests (another
  // project's, a browser suite). Found on 2026-11-12: 4 answers out of 60 said "seen" for tests SkeptOpus had not run.
  // Passing tests that are not the ones claimed prove nothing about the claim: could not look, and both numbers are told.
  const pass = /(?:^|\n)\D{0,3}pass\s+(\d+)/i.exec(ran.stdout);
  if (claim.total && pass && Number(pass[1]) !== claim.total)
    return result("COULD_NOT_LOOK", "TESTS_PASS_NOW_BUT_COUNT_DIFFERS", { ...facts, passedNow: Number(pass[1]), claimed: claim.total, check: pass[1] + " ≠ " + claim.total });
  return result("SEEN", "TESTS_PASS_NOW", { ...facts, passedNow: pass ? Number(pass[1]) : null });
}

const flat = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const is404 = (r) => /HTTP 404|Not Found/i.test(r.stderr);

async function repositoriesToAsk(claim, ctx) {
  if (claim.repo) return [claim.repo];
  const list = [...(Array.isArray(ctx.config?.repos) ? ctx.config.repos.filter((r) => typeof r === "string") : [])];
  for (const repo of await repos(ctx)) {
    const url = await ctx.run("git", ["-C", repo, "remote", "get-url", "origin"]);
    const m = /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(url.stdout);
    if (url.ok && m && !list.includes(m[1])) list.push(m[1]);
  }
  return list;
}

/** "I posted comment 123": ask GitHub whether that comment exists, and on the issue that was named. */
async function commentPosted(claim, ctx) {
  const list = await repositoriesToAsk(claim, ctx);
  if (!list.length) return result("COULD_NOT_LOOK", "NO_REPOSITORY_TO_ASK", { id: claim.id });
  let blind = false;
  for (const repo of list) {
    const got = await ctx.run("gh", ["api", "repos/" + repo + "/issues/comments/" + claim.id, "--jq", "{at: .created_at, issue: .issue_url}"], { timeout: 25000 });
    if (got.missing) return result("COULD_NOT_LOOK", "GITHUB_CLI_MISSING");
    if (got.ok) {
      let info = {};
      try {
        info = JSON.parse(got.stdout);
      } catch {
        return result("COULD_NOT_LOOK", "GITHUB_ANSWER_UNREADABLE");
      }
      const facts = { repo, id: claim.id, createdAt: info.at ?? null };
      if (claim.issue && !String(info.issue ?? "").endsWith("/" + claim.issue)) return result("AGAINST", "COMMENT_IS_ON_ANOTHER_ISSUE", facts);
      return result("SEEN", "COMMENT_EXISTS", facts);
    }
    if (!is404(got)) {
      blind = true;
      continue;
    }
    // A 404 also hides repositories we may not see: "absent" needs the repository to be visible.
    const visible = await ctx.run("gh", ["api", "repos/" + repo, "--jq", ".full_name"], { timeout: 25000 });
    if (!visible.ok) blind = true;
  }
  return blind ? result("COULD_NOT_LOOK", "GITHUB_UNREACHABLE", { id: claim.id }) : result("NOT_SEEN", "COMMENT_UNKNOWN", { id: claim.id, asked: list.length });
}

/** "I created the private repository X": it must exist, be recent, and be private if said so. */
async function repoCreated(claim, ctx) {
  let full = claim.name;
  if (!full.includes("/")) {
    ctx.memo.login ??= ctx.run("gh", ["api", "user", "--jq", ".login"], { timeout: 25000 });
    const me = await ctx.memo.login;
    if (me.missing) return result("COULD_NOT_LOOK", "GITHUB_CLI_MISSING");
    if (!me.ok || !me.stdout) return result("COULD_NOT_LOOK", "GITHUB_UNREACHABLE");
    full = me.stdout + "/" + claim.name;
  }
  const got = await ctx.run("gh", ["api", "repos/" + full, "--jq", "{private: .private, at: .created_at}"], { timeout: 25000 });
  if (got.missing) return result("COULD_NOT_LOOK", "GITHUB_CLI_MISSING");
  if (!got.ok) return is404(got) ? result("NOT_SEEN", "REPOSITORY_UNKNOWN", { repo: full }) : result("COULD_NOT_LOOK", "GITHUB_UNREACHABLE", { repo: full });
  let info;
  try {
    info = JSON.parse(got.stdout);
  } catch {
    return result("COULD_NOT_LOOK", "GITHUB_ANSWER_UNREADABLE");
  }
  const facts = { repo: full, private: info.private, createdAt: info.at };
  // Said private, found public: this is the one that matters most.
  if (claim.private && info.private !== true) return result("AGAINST", "REPOSITORY_IS_PUBLIC", facts);
  if (ctx.sessionStart && Date.parse(info.at) < Date.parse(ctx.sessionStart) - 2000) return result("NOT_SEEN", "REPOSITORY_OLDER_THAN_SESSION", facts);
  return result("SEEN", claim.private ? "REPOSITORY_EXISTS_AND_IS_PRIVATE" : "REPOSITORY_EXISTS", facts);
}

/** "No overflow", "typecheck clean": SkeptOpus measures again, but only the way the USER declared. */
async function measured(claim, ctx) {
  const said = flat(claim.sentence ?? claim.text ?? "");
  const checks = Array.isArray(ctx.config?.checks) ? ctx.config.checks : [];
  const found = checks.find((c) => {
    if (!c || typeof c.match !== "string" || !Array.isArray(c.run) || !c.run.length || !c.run.every((p) => typeof p === "string")) return false;
    try {
      return new RegExp(c.match, "i").test(said);
    } catch {
      return false;
    }
  });
  if (!found) return result("COULD_NOT_LOOK", "NO_WAY_TO_MEASURE_DECLARED", { said: claim.text });
  const label = found.name ?? found.match;
  // A measurement that takes minutes must not hold the end of a turn: it is handed to a background run.
  if (found.slow && !ctx.allowSlow) {
    ctx.deferred.push(claim.sentence ?? claim.text ?? "");
    return result("COULD_NOT_LOOK", "MEASURE_STARTED_IN_BACKGROUND", { check: label });
  }
  const key = "check:" + label;
  ctx.memo[key] ??= (async () => {
    const started = Date.now();
    const ran = await ctx.run(found.run[0], found.run.slice(1), { cwd: found.cwd ?? ctx.config.cwd ?? ctx.roots[0], timeout: found.timeoutMs ?? 300000 });
    return { ran, seconds: Math.round((Date.now() - started) / 100) / 10 };
  })();
  const { ran, seconds } = await ctx.memo[key];
  const facts = { check: label, command: found.run.join(" "), exitCode: ran.code, seconds };
  if (ran.missing) return result("COULD_NOT_LOOK", "MEASURE_COMMAND_NOT_FOUND", facts);
  if (ran.timedOut) return result("COULD_NOT_LOOK", "MEASURE_TIMED_OUT", facts);
  // By convention a measurement exits 3 when it could not measure at all (server stopped...).
  // That is not a bad result: nothing was seen.
  const blind = Array.isArray(found.unknownCodes) ? found.unknownCodes : [3];
  if (!ran.ok && blind.includes(ran.code)) return result("COULD_NOT_LOOK", "MEASURE_COULD_NOT_RUN", facts);
  return ran.ok ? result("SEEN", "MEASURED_AGAIN_OK", facts) : result("AGAINST", "MEASURED_AGAIN_FAILED", facts);
}

const OBSERVERS = { COMMENT_POSTED: commentPosted, REPO_CREATED: repoCreated, MEASURED: measured, FILE_REFERENCED: fileWritten, FILE_WRITTEN: fileWritten, COMMITTED: committed, PUSHED: pushed, PR_MERGED: pullRequest, PR_OPENED: pullRequest, TESTS_PASS: testsPass };

/** Reads the user's own configuration. Looked up in the user's home first: the agent works in the project, not there. */
/** The folder that holds the user's settings and journal: ~/.skeptopus, or the one SKEPTOPUS_HOME names. */
export function homeOf(env = process.env, userHome = homedir()) {
  return env.SKEPTOPUS_HOME || join(userHome, ".skeptopus"); // an empty variable is no folder
}

export function loadConfig(explicit, cwd, env = process.env) {
  // Sources are combined. Lists add up (repositories to ask, folders to look in, declared measurements).
  // For single values the user's own folder wins over the project's: an agent works in the project,
  // so a project file must not be able to replace the test command the user declared.
  const mine = join(homeOf(env), "config.json");
  const project = join(cwd, ".skeptopus.json");
  const fromEnv = env.SKEPTOPUS_CONFIG;
  const order = [project, mine, fromEnv, explicit].filter(Boolean);
  const read = (path) => {
    try {
      const one = JSON.parse(readFileSync(path, "utf8"));
      return one && typeof one === "object" && !Array.isArray(one) ? one : null;
    } catch {
      return null; // Missing or unreadable means "nothing declared here", not an error.
    }
  };
  // A project file arrives with the project: cloned, or written by the agent being checked.
  // It may say where to look, never what to run, unless the user listed that folder as trusted.
  const trusted = [mine, fromEnv, explicit]
    .filter(Boolean)
    .flatMap((p) => (Array.isArray(read(p)?.trusted) ? read(p).trusted : []))
    .some((t) => typeof t === "string" && resolve(t).toLowerCase() === resolve(cwd).toLowerCase());
  let merged = null;
  for (const path of order) {
    let one = read(path);
    if (!one) continue;
    if (path === project && !trusted) one = Object.fromEntries(Object.entries(one).filter(([key]) => key === "repos" || key === "roots"));
    merged ??= { sources: [] };
    for (const [key, value] of Object.entries(one)) {
      if (Array.isArray(value) && key !== "test") merged[key] = [...(Array.isArray(merged[key]) ? merged[key] : []), ...value];
      else merged[key] = value;
    }
    merged.sources.push(resolve(path));
  }
  return merged;
}
/** Folders SkeptOpus may look in: where the agent works, plus the ones the user declared. */
export const rootsOf = (cwd, config, extra = []) => [...new Set([cwd, ...extra, ...(Array.isArray(config?.roots) ? config.roots.filter((r) => typeof r === "string") : [])].filter(Boolean))];

/**
 * @param claim one claim from extractClaims()
 * @param ctx { roots: string[], sessionStart?: string, config?: object, run?: typeof run }
 */
export async function observe(claim, ctx) {
  ctx.memo ??= {};
  ctx.deferred ??= [];
  const context = { run, ...ctx };
  if (claim.kind === "VAGUE_DONE") return result("COULD_NOT_LOOK", "NOTHING_CHECKABLE_WAS_CLAIMED");
  const observer = OBSERVERS[claim.kind];
  if (!observer) return result("COULD_NOT_LOOK", "NO_OBSERVER_FOR_THIS_CLAIM");
  let seen;
  try {
    seen = await observer(claim, context);
  } catch (error) {
    return result("COULD_NOT_LOOK", "OBSERVER_CRASHED", { error: String(error?.message ?? error).slice(0, 160) });
  }
  if (!claim.negated) return seen;
  // "I did NOT push": the claim is true when SkeptOpus looks and does not find it.
  if (seen.outcome === "COULD_NOT_LOOK") return seen;
  return seen.outcome === "SEEN" ? result("AGAINST", "IT_HAPPENED_ANYWAY:" + seen.why, seen.facts) : result("SEEN", "INDEED_NOT:" + seen.why, seen.facts);
}

export const VERDICT = { SEEN: "PROVEN", NOT_SEEN: "NOT_PROVEN", AGAINST: "CONTRADICTED", COULD_NOT_LOOK: "COULD_NOT_CHECK" };
const RANK = ["CONTRADICTED", "NOT_PROVEN", "COULD_NOT_CHECK", "PROVEN"];
/** The whole message is only as good as its weakest claim. No claim at all is its own answer. */
export function overall(verdicts) {
  if (!verdicts.length) return "NOTHING_CLAIMED";
  return RANK.find((v) => verdicts.includes(v)) ?? "COULD_NOT_CHECK";
}
