// SkeptOpus core: reading real claims, then going to look. Uses real git in temp folders (with a local
// bare repository standing in for "the remote"), never the network.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { extractClaims } from "../core/claims.mjs";
import { attach, castOf, check, clipboard, dayOf, detach, firstForThisTurn, glance, install, journalHtml, nodeForHooks, normalize, openPage, poseOf, render, signalPlan, status, summary, tell, uninstall } from "../core/cli.mjs";
import { homeOf, observe, overall } from "../core/observe.mjs";
import { DIR, LANGS, PAGE, WHY, WORDS, say, sourceLabel } from "../core/words.mjs";
import { TEST_ROOT, rootFrom, scratch } from "./tmp.mjs";

const kinds = (text) => extractClaims(text).map((c) => (c.negated ? "!" : "") + c.kind + (c.path ? ":" + c.path : c.sha ? ":" + c.sha : c.pr ? ":" + c.pr : c.id ? ":" + c.id : c.name ? ":" + c.name + (c.private ? ":private" : "") : c.text ? ":" + c.text : c.total ? ":" + c.passed + "/" + c.total : ""));

test("claims: plain English and plain French say the same things", () => {
  assert.deepEqual(kinds("I created `src/app.ts`. Committed abc1234 and pushed. All tests pass."), ["FILE_WRITTEN:src/app.ts", "COMMITTED:abc1234", "PUSHED", "TESTS_PASS"]);
  assert.deepEqual(kinds("J'ai créé `src/app.ts`. Commit local `abc1234`. Les tests passent."), ["FILE_WRITTEN:src/app.ts", "COMMITTED:abc1234", "TESTS_PASS"]);
});

test("claims: polarity is read clause by clause", () => {
  assert.deepEqual(kinds("Committed abc1234, not pushed."), ["COMMITTED:abc1234", "!PUSHED"]);
  assert.deepEqual(kinds("Commit local `cea7c1c`, aucun push."), ["COMMITTED:cea7c1c", "!PUSHED"]);
  // The case that produced false alarms in the journal audit: a closure that was the goal.
  assert.deepEqual(kinds("PR #108 fermée sans fusion, comme prévu."), ["!PR_MERGED:108"]);
  assert.deepEqual(kinds("PR #12 is merged."), ["PR_MERGED:12"]);
  // A colon separates two statements: this one was read as "did NOT commit" during development.
  assert.deepEqual(kinds("Commit local `cea7c1c` : aucun push."), ["COMMITTED:cea7c1c", "!PUSHED"]);
});

test("claims: plans, questions and quotations are not claims", () => {
  assert.deepEqual(kinds("I will push tomorrow. Should I commit?"), []);
  assert.deepEqual(kinds("It will be committed and pushed tonight."), []);
  assert.deepEqual(kinds("Je vais créer `a.md`, puis il faut que les tests passent."), []);
  assert.deepEqual(kinds("Is PR #4 merged?"), []);
  assert.deepEqual(kinds("Je redessinerai la planche. On poussera ensuite sur origin."), []);
  assert.deepEqual(kinds('Il attrape « les tests passent parce que j\'ai modifié les tests ».'), []);
  assert.deepEqual(kinds('The meme says "All tests pass." and that is the joke.'), []);
  // Found on the real session: the full stop inside the quotation cut it in two, and the first half was read as a claim.
  assert.deepEqual(kinds("Une IA vous écrit, par exemple : « J'ai créé le fichier, les tests passent. » Et ensuite ?"), []);
  assert.deepEqual(kinds("Elle a dit “all tests pass.” Rien d'autre."), []);
  assert.deepEqual(kinds("```\ngit push\nall tests pass\n```"), []);
});

test("claims: regressions found on a real session (2026-11-12)", () => {
  // "poussé" as "elaborate" was read as a push and stamped CONTRADICTED.
  assert.deepEqual(kinds("La piste retenue est dessinée en plus poussé."), []);
  assert.deepEqual(kinds("La branche est poussée sur origin."), ["PUSHED"]);
  // Figures of speech about "a test".
  assert.deepEqual(kinds("Le carré rouge passe déjà ce test."), []);
  assert.deepEqual(kinds("Un test vert n'est pas une preuve."), []);
  // A ratio is about tests only when it says so.
  assert.deepEqual(kinds("7 erreurs sur 8 sont détectées par les tests."), []);
  // Not about tests, but a full count is still an announcement: SkeptOpus now answers for it.
  assert.deepEqual(kinds("11 protections sur 11 sont détectées."), ["MEASURED:11 protections sur 11"]);
  assert.deepEqual(kinds("82 tests sur 82, typage propre."), ["MEASURED:typage propre", "TESTS_PASS:82/82"]);
  assert.deepEqual(kinds("94 tests hors ligne sur 94."), ["TESTS_PASS:94/94"]);
  assert.deepEqual(kinds("Tests : 94/94."), ["TESTS_PASS:94/94"]);
  // An admission of failure is not a completion claim. Read as one, "16 sur 17" was stamped
  // CONTRADICTED because the tests pass today.
  assert.deepEqual(kinds("Tests: 91/94."), []);
  assert.deepEqual(kinds("16 contrôles sur 17 passent."), []);
  assert.deepEqual(kinds("Les tests ne passent pas."), []);
});

test("claims: what a whole day of real sessions taught (2026-11-12, evening)", () => {
  // Measured on 233 real end-of-turn messages: 11 real misses in 150 unread sentences drawn at random, and in
  // 60 answers drawn at random, 3 wrong readings and 4 "seen" given for tests that were not the ones spoken of.
  // "La suite" alone is what comes next, not a test suite.
  assert.deepEqual(kinds("C'est fait : la suite se passe dans la session neuve."), []);
  assert.deepEqual(kinds("La suite de tests passe."), ["TESTS_PASS"]);
  assert.deepEqual(kinds("The test suite passes."), ["TESTS_PASS"]);
  // The number of tests said is kept, to be found again; a part of them, said as such, is nothing to catch.
  assert.deepEqual(kinds("45 tests passent sur le poste, dont 32 échouent sur l'ancien code."), ["TESTS_PASS:45/45"]);
  assert.deepEqual(kinds("Ce que la session rapporte : 40 tests verts en local."), ["TESTS_PASS:40/40"]);
  assert.deepEqual(kinds("Only 2 of the 14 tests pass."), []);
  assert.deepEqual(kinds("Les tests passent."), ["TESTS_PASS"]);
  // A request named by its number alone counts when the number touches "merged"; by its link, near "merged" or "opened".
  assert.deepEqual(kinds("Fusion : #172 est fusionnée à 02:56:19Z."), ["PR_MERGED:172"]);
  assert.deepEqual(kinds("J'ai fusionné #165 à 01:12Z, mais le correctif n'est pas encore en service."), ["PR_MERGED:165"]);
  assert.deepEqual(kinds("#174 n'est pas encore fusionnée."), ["!PR_MERGED:174"]);
  assert.deepEqual(kinds("Note sur #120 : la PR #184 est fusionnée."), ["PR_MERGED:184"]);
  assert.deepEqual(kinds("Checkpoint publié sur #120."), []);
  const linked = extractClaims("Une troisième demande est fusionnée ([185](https://github.com/o/r/pull/185), 12:15Z).");
  assert.deepEqual(linked.map((c) => [c.kind, c.pr, c.repo, c.negated]), [["PR_MERGED", 185, "o/r", false]]);
  assert.deepEqual(kinds("Sa note de clôture est ouverte (#171, [lien](https://github.com/o/r/pull/171))."), ["PR_OPENED:171"]);
  assert.deepEqual(kinds("La [demande 170](https://github.com/o/r/pull/170) est relue, mais pas encore fusionnée."), ["!PR_MERGED:170"]);
  assert.deepEqual(kinds("Sans conflit, la [demande 170](https://github.com/o/r/pull/170) est fusionnée."), ["PR_MERGED:170"]);
  // A condition is not a report. Read as one, the first would have been stamped CONTRADICTED while #174 was open.
  assert.deepEqual(kinds("Le tableau ne le comptera qu'une fois #174 fusionnée et installée."), []);
  assert.deepEqual(kinds("On réinstalle une fois sa [demande 182](https://github.com/o/r/pull/182) fusionnée."), []);
  assert.deepEqual(kinds("Once #12 is merged, the alert goes away."), []);
  // A commit said in plain words, with its identifier written as one.
  assert.deepEqual(kinds("Enregistré dans le projet (version `58090f0`)."), ["COMMITTED:58090f0"]);
  assert.deepEqual(kinds("Sur sa version exacte `0f1e2d3c` : 500 erreurs volontaires, 497 détectées."), []);
  assert.deepEqual(kinds("J'ai enregistré le fichier `abc1234.png`."), ["FILE_WRITTEN:abc1234.png"]);
});

test("claims: Spanish, Chinese and Arabic are read like French and English", () => {
  // Written by a non-native author; readers whose language it is are welcome to correct them.
  // Spanish.
  assert.deepEqual(kinds("He creado `src/app.ts` y actualizado `README.md`."), ["FILE_WRITTEN:src/app.ts", "FILE_WRITTEN:README.md"]);
  assert.deepEqual(kinds("Hice commit `abc1234`, pero no hice push."), ["COMMITTED:abc1234", "!PUSHED"]);
  assert.deepEqual(kinds("Hice push a origin."), ["PUSHED"]);
  assert.deepEqual(kinds("La PR #12 está fusionada."), ["PR_MERGED:12"]);
  assert.deepEqual(kinds("La PR #12 todavía no está fusionada."), ["!PR_MERGED:12"]);
  assert.deepEqual(kinds("#172 está fusionada."), ["PR_MERGED:172"]);
  assert.deepEqual(kinds("Los 40 tests pasan."), ["TESTS_PASS:40/40"]);
  assert.deepEqual(kinds("Todas las pruebas pasan."), ["TESTS_PASS"]);
  assert.deepEqual(kinds("Los tests no pasan."), []);
  assert.deepEqual(kinds("Solo 2 de los 14 tests pasan."), []);
  assert.deepEqual(kinds("Mañana haré push a origin."), []);
  assert.deepEqual(kinds("¿Hago el commit?"), []);
  assert.deepEqual(kinds("¡Listo!"), ["VAGUE_DONE"]);
  // Chinese: no space between words, and sentences end with their own marks.
  assert.deepEqual(kinds("我创建了 `src/app.ts`，并更新了 `README.md`。"), ["FILE_WRITTEN:src/app.ts", "FILE_WRITTEN:README.md"]);
  assert.deepEqual(kinds("已提交 `abc1234`，还没推送。"), ["COMMITTED:abc1234", "!PUSHED"]);
  assert.deepEqual(kinds("已推送到 origin。"), ["PUSHED"]);
  assert.deepEqual(kinds("PR #12 已合并。"), ["PR_MERGED:12"]);
  assert.deepEqual(kinds("PR #12 还没合并。"), ["!PR_MERGED:12"]);
  assert.deepEqual(kinds("#172 已合并。"), ["PR_MERGED:172"]);
  assert.deepEqual(kinds("133 个测试全部通过。"), ["TESTS_PASS:133/133"]);
  assert.deepEqual(kinds("测试没有通过。"), []);
  assert.deepEqual(kinds("只有 2 个测试通过。"), []);
  assert.deepEqual(kinds("我创建了 `a.md`。明天再推送到 origin。"), ["FILE_WRITTEN:a.md"], "two sentences with no space between them");
  assert.deepEqual(kinds("要不要我提交？"), []);
  assert.deepEqual(kinds("搞定了。"), ["VAGUE_DONE"]);
  // Arabic: its own comma and question mark, "and" stuck to the next word, and the words developers keep in English.
  assert.deepEqual(kinds("أنشأت الملف `src/app.ts` وحدّثت `README.md`."), ["FILE_WRITTEN:src/app.ts", "FILE_WRITTEN:README.md"]);
  assert.deepEqual(kinds("تمّ الـ commit `abc1234`، ولم يتم الـ push."), ["COMMITTED:abc1234", "!PUSHED"]);
  assert.deepEqual(kinds("تم رفع الفرع إلى origin."), ["PUSHED"]);
  assert.deepEqual(kinds("رفعت يدي."), [], "\"I raised\" alone, with no git word, is not a push");
  assert.deepEqual(kinds("تم دمج الـ PR #12."), ["PR_MERGED:12"]);
  assert.deepEqual(kinds("لم يتم دمج الـ PR #12 بعد."), ["!PR_MERGED:12"]);
  assert.deepEqual(kinds("#172 تم دمجها."), ["PR_MERGED:172"]);
  assert.deepEqual(kinds("كل الاختبارات ناجحة."), ["TESTS_PASS"]);
  assert.deepEqual(kinds("نجح 133 اختبارًا."), ["TESTS_PASS:133/133"]);
  assert.deepEqual(kinds("الاختبارات لا تنجح."), []);
  assert.deepEqual(kinds("سأرفع التعديلات إلى origin غدًا."), []);
  assert.deepEqual(kinds("هل أعمل commit؟"), []);
  assert.deepEqual(kinds("تمّ."), ["VAGUE_DONE"]);
  // French keeps its own: its pronoun "y" is not cut like Spanish "y" (and). The first is a real sentence of 12/11,
  // whose claim was lost by the first version of this change, caught by comparing a day of real messages.
  assert.deepEqual(kinds("Avant de pousser, j'ai vérifié en local que le contrôle des tests y passe."), ["TESTS_PASS"]);
  assert.deepEqual(kinds("Il y a un commit `abc1234`, y compris les tests, et aucun push."), ["COMMITTED:abc1234", "!PUSHED"]);
});

test("claims: a link promises a file; 'written' is the stronger promise; a bare 'done' is named as vague", () => {
  assert.deepEqual(kinds("Les images sont dans [piste-A.png](piste-A.png)."), ["FILE_REFERENCED:piste-A.png"]);
  assert.deepEqual(kinds("J'ai écrit [la trame](notes/TRAME.md:12)."), ["FILE_WRITTEN:notes/TRAME.md"]);
  assert.deepEqual(kinds("Voir [la doc](https://example.com/a.md)."), []);
  assert.deepEqual(kinds("Done."), ["VAGUE_DONE"]);
  assert.deepEqual(kinds("C'est fait !"), ["VAGUE_DONE"]);
  assert.deepEqual(kinds("Nothing to report."), []);
});

test("claims: what happens outside the folder (blind spots closed on 2026-11-12)", () => {
  // Posted comments, by number or by link.
  assert.deepEqual(kinds("Le constat est consigné au journal (entrée 1000000081)."), ["COMMENT_POSTED:1000000081"]);
  assert.deepEqual(kinds("Posted as comment 1000000909."), ["COMMENT_POSTED:1000000909"]);
  assert.deepEqual(kinds("Voir [le checkpoint](https://github.com/acme/tools/issues/12#issuecomment-1000007342)."), ["COMMENT_POSTED:1000007342"]);
  assert.equal(extractClaims("Voir https://github.com/acme/tools/issues/12#issuecomment-1000007342 .")[0].repo, "acme/tools");
  // A run number is not a comment; a plan is not a claim.
  assert.deepEqual(kinds("Pendant la run 12345678901."), []);
  assert.deepEqual(kinds("Je posterai le commentaire 1000007342 demain."), []);
  // Created repositories, with the promise of privacy when it is made.
  assert.deepEqual(kinds("J'ai créé le dépôt privé `effect-lab` sur ton compte."), ["REPO_CREATED:effect-lab:private"]);
  assert.deepEqual(kinds("Created the repository acme/tools."), ["REPO_CREATED:acme/tools"]);
  assert.deepEqual(kinds("Le dépôt contient 9 fichiers."), []);
  // Announced measurements.
  assert.deepEqual(kinds("Aucun débordement sur les quatre pages."), ["MEASURED:aucun debordement"]);
  assert.deepEqual(kinds("No errors, typecheck clean."), ["MEASURED:no errors"]);
  assert.deepEqual(kinds("Typage propre."), ["MEASURED:typage propre"]);
  // "aucun push" stays what it was: a statement about pushing, not a measurement.
  assert.deepEqual(kinds("Commit local `cea7c1c`, aucun push."), ["COMMITTED:cea7c1c", "!PUSHED"]);
});

// ---------- going to look ----------
const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function repo() {
  const dir = scratch("skeptopus-core-");
  git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "a.txt"), "one\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "first");
  return dir;
}
const look = async (text, ctx) => (await check(text, ctx)).rows.map((r) => r.verdict + ":" + r.why);

test("look: a file is seen, missing, empty, or older than the session", async () => {
  const dir = scratch("skeptopus-core-");
  writeFileSync(join(dir, "new.md"), "hello");
  writeFileSync(join(dir, "empty.md"), "");
  writeFileSync(join(dir, "old.md"), "old");
  utimesSync(join(dir, "old.md"), new Date("2025-01-01"), new Date("2025-01-01"));
  const ctx = { roots: [dir], sessionStart: new Date(Date.now() - 60000).toISOString() };
  assert.deepEqual(await look("I created `new.md`, `gone.md`, `empty.md` and `old.md`.", ctx), [
    "PROVEN:FILE_PRESENT_AND_FRESH",
    "NOT_PROVEN:FILE_ABSENT",
    "CONTRADICTED:FILE_EMPTY",
    "NOT_PROVEN:FILE_OLDER_THAN_SESSION",
  ]);
  // Pointing at an old file is fine: a link claims existence, not novelty.
  assert.deepEqual(await look("See [old](old.md) and [gone](gone.md).", ctx), ["PROVEN:FILE_PRESENT", "NOT_PROVEN:FILE_ABSENT"]);
});

test("look: commits are checked in git, not in the agent's story", async () => {
  const dir = repo();
  const sha = git(dir, "rev-parse", "--short", "HEAD");
  const ctx = { roots: [dir] };
  assert.deepEqual(await look("Commit local `" + sha + "`.", ctx), ["PROVEN:COMMIT_EXISTS"]);
  assert.deepEqual(await look("Commit local `abcdef1`.", ctx), ["NOT_PROVEN:COMMIT_UNKNOWN_IN_THESE_REPOSITORIES"]);
  assert.deepEqual(await look("Everything is committed.", ctx), ["PROVEN:HEAD_COMMITTED_AND_TREE_CLEAN"]);
  writeFileSync(join(dir, "b.txt"), "two\n");
  assert.deepEqual(await look("Everything is committed.", ctx), ["NOT_PROVEN:CHANGES_STILL_UNCOMMITTED"]);
  assert.deepEqual(await look("Committed abc1234.", { roots: [scratch("skeptopus-nogit-")] }), ["COULD_NOT_CHECK:NO_GIT_REPOSITORY_HERE"]);
});

test("look: 'pushed' is asked to the remote itself", async () => {
  const dir = repo();
  // Nowhere to push to: not unproven, impossible.
  assert.deepEqual(await look("Pushed.", { roots: [dir] }), ["CONTRADICTED:NO_REMOTE_CONFIGURED"]);
  assert.deepEqual(await look("Committed, not pushed.", { roots: [dir] }), ["PROVEN:HEAD_COMMITTED_AND_TREE_CLEAN", "PROVEN:INDEED_NOT:NO_REMOTE_CONFIGURED"]);
  const far = scratch("skeptopus-remote-");
  git(far, "init", "-q", "--bare", "-b", "main");
  git(dir, "remote", "add", "origin", far);
  assert.deepEqual(await look("Pushed.", { roots: [dir] }), ["NOT_PROVEN:BRANCH_ABSENT_ON_REMOTE"]);
  git(dir, "push", "-q", "origin", "main");
  assert.deepEqual(await look("Pushed.", { roots: [dir] }), ["PROVEN:REMOTE_HAS_THIS_COMMIT"]);
  // Saying "not pushed" when it is on the remote is contradicted too.
  assert.deepEqual(await look("Aucun push.", { roots: [dir] }), ["CONTRADICTED:IT_HAPPENED_ANYWAY:REMOTE_HAS_THIS_COMMIT"]);
  // One more local commit: the stale local pointer still says "up to date", the remote does not.
  writeFileSync(join(dir, "c.txt"), "three\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "second");
  git(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
  assert.deepEqual(await look("Pushed.", { roots: [dir] }), ["NOT_PROVEN:REMOTE_DOES_NOT_HAVE_THIS_COMMIT"]);
  // A remote SkeptOpus cannot reach is not evidence either way.
  git(dir, "remote", "set-url", "origin", join(far, "does-not-exist"));
  assert.deepEqual(await look("Pushed.", { roots: [dir] }), ["COULD_NOT_CHECK:REMOTE_UNREACHABLE"]);
});

test("look: pull requests, with GitHub played by a stub", async () => {
  const dir = repo();
  const gh = (answer) => async (cmd, args) =>
    cmd === "git" ? { ok: true, stdout: dir, stderr: "", code: 0 } : { ok: false, stdout: "", stderr: "", code: 1, ...answer };
  const ask = async (text, answer) => (await check(text, { roots: [dir], run: gh(answer) })).rows.map((r) => r.verdict + ":" + r.why);
  assert.deepEqual(await ask("PR #7 is merged.", { ok: true, stdout: '{"state":"MERGED","mergedAt":"2026-11-12T00:00:00Z"}' }), ["PROVEN:PULL_REQUEST_MERGED"]);
  assert.deepEqual(await ask("PR #7 is merged.", { ok: true, stdout: '{"state":"OPEN"}' }), ["CONTRADICTED:PULL_REQUEST_STILL_OPEN"]);
  assert.deepEqual(await ask("PR #7 fermée sans fusion.", { ok: true, stdout: '{"state":"CLOSED"}' }), ["PROVEN:INDEED_NOT:PULL_REQUEST_CLOSED_UNMERGED"]);
  assert.deepEqual(await ask("PR #7 is merged.", { stderr: "GraphQL: Could not resolve to a PullRequest" }), ["NOT_PROVEN:PULL_REQUEST_UNKNOWN"]);
  assert.deepEqual(await ask("PR #7 is merged.", { missing: true }), ["COULD_NOT_CHECK:GITHUB_CLI_MISSING"]);
  assert.deepEqual(await ask("PR #7 is merged.", { stderr: "dial tcp: no such host" }), ["COULD_NOT_CHECK:GITHUB_UNREACHABLE"]);
});

test("look: a request named by its link is asked to the repository the link names", async () => {
  const dir = scratch("skeptopus-core-"); // no git repository here
  const asked = [];
  const run = async (cmd, args) => {
    asked.push(cmd + " " + args.join(" "));
    return cmd === "gh" ? { ok: true, stdout: '{"state":"MERGED","mergedAt":"2026-11-12T12:15:00Z"}', stderr: "", code: 0 } : { ok: false, stdout: "", stderr: "not a git repository", code: 128 };
  };
  const linked = await check("Une troisième demande est fusionnée ([185](https://github.com/o/r/pull/185)).", { roots: [dir], run });
  assert.deepEqual(linked.rows.map((r) => r.verdict + ":" + r.why), ["PROVEN:PULL_REQUEST_MERGED"]);
  assert.ok(asked.includes("gh pr view 185 --repo o/r --json state,mergedAt,url"), asked.join(" | "));
  // A number alone still needs a repository at hand to know where to ask.
  assert.deepEqual(await look("#185 est fusionnée.", { roots: [dir], run }), ["COULD_NOT_CHECK:NO_GIT_REPOSITORY_HERE"]);
});

test("look: comments and repositories are asked to GitHub, played by a stub", async () => {
  const dir = scratch("skeptopus-core-");
  // answers: map from a fragment of the gh arguments to the answer.
  const gh = (answers) => async (cmd, args) => {
    if (cmd === "git") return { ok: false, stdout: "", stderr: "not a git repository", code: 128 };
    const line = args.join(" ");
    const hit = Object.keys(answers).find((k) => line.includes(k));
    return hit ? { stdout: "", stderr: "", code: 0, ...answers[hit] } : { ok: false, stdout: "", stderr: "gh: Not Found (HTTP 404)", code: 1 };
  };
  const ask = async (text, answers, extra = {}) => (await check(text, { roots: [dir], run: gh(answers), ...extra })).rows.map((r) => r.verdict + ":" + r.why);
  const cfg = { config: { repos: ["acme/tools"] } };
  const ok = (stdout) => ({ ok: true, stdout });
  assert.deepEqual(await ask("Entrée 1000000081 publiée.", { "issues/comments/1000000081": ok('{"at":"2026-11-12T09:00:00Z","issue":"https://api.github.com/repos/acme/tools/issues/12"}') }, cfg), ["PROVEN:COMMENT_EXISTS"]);
  // Absent, and the repository is visible: really absent.
  assert.deepEqual(await ask("Entrée 1000000081 publiée.", { "repos/acme/tools --jq .full_name": ok("acme/tools") }, cfg), ["NOT_PROVEN:COMMENT_UNKNOWN"]);
  // Absent, but the repository itself cannot be seen: SkeptOpus saw nothing, so it concludes nothing.
  assert.deepEqual(await ask("Entrée 1000000081 publiée.", {}, cfg), ["COULD_NOT_CHECK:GITHUB_UNREACHABLE"]);
  assert.deepEqual(await ask("Entrée 1000000081 publiée.", {}), ["COULD_NOT_CHECK:NO_REPOSITORY_TO_ASK"]);
  // The repository is visible but the question itself failed (network): still nothing was seen.
  assert.deepEqual(
    await ask("Entrée 1000000081 publiée.", { "issues/comments/1000000081": { ok: false, stderr: "dial tcp: no such host", code: 1 }, "repos/acme/tools --jq .full_name": ok("acme/tools") }, cfg),
    ["COULD_NOT_CHECK:GITHUB_UNREACHABLE"],
  );
  // The link names issue 12; the comment lives on issue 99.
  assert.deepEqual(
    await ask("Voir https://github.com/acme/tools/issues/12#issuecomment-1000007342 .", { "issues/comments/1000007342": ok('{"at":"2026-11-12T09:00:00Z","issue":"https://api.github.com/repos/acme/tools/issues/99"}') }),
    ["CONTRADICTED:COMMENT_IS_ON_ANOTHER_ISSUE"],
  );
  const me = { "api user": ok("someone") };
  const repo = (body) => ({ ...me, "repos/someone/lab --jq": ok(body) });
  assert.deepEqual(await ask("J'ai créé le dépôt privé `lab`.", repo('{"private":true,"at":"2026-11-12T08:18:32Z"}')), ["PROVEN:REPOSITORY_EXISTS_AND_IS_PRIVATE"]);
  // Said private, found public.
  assert.deepEqual(await ask("J'ai créé le dépôt privé `lab`.", repo('{"private":false,"at":"2026-11-12T08:18:32Z"}')), ["CONTRADICTED:REPOSITORY_IS_PUBLIC"]);
  assert.deepEqual(await ask("J'ai créé le dépôt `lab`.", me), ["NOT_PROVEN:REPOSITORY_UNKNOWN"]);
  assert.deepEqual(await ask("J'ai créé le dépôt `lab`.", repo('{"private":true,"at":"2025-01-01T00:00:00Z"}'), { sessionStart: "2026-11-12T00:00:00Z" }), ["NOT_PROVEN:REPOSITORY_OLDER_THAN_SESSION"]);
  assert.deepEqual(await ask("J'ai créé le dépôt `lab`.", {}), ["COULD_NOT_CHECK:GITHUB_UNREACHABLE"]);
});

test("look: a measurement is redone only the way the user declared", async () => {
  const dir = scratch("skeptopus-core-");
  const counter = join(dir, "runs.txt");
  const script = join(dir, "m.mjs");
  writeFileSync(script, 'import { appendFileSync } from "node:fs"; appendFileSync(' + JSON.stringify(counter) + ', "x"); process.exit(Number(process.argv[2]));');
  const cfg = (code) => ({ roots: [dir], config: { checks: [{ name: "debordement", match: "debordement|overflow", run: [process.execPath, script, String(code)] }] } });
  // Nothing declared: SkeptOpus says it cannot redo the measurement, instead of nodding.
  assert.deepEqual(await look("Aucun débordement sur les quatre pages.", { roots: [dir] }), ["COULD_NOT_CHECK:NO_WAY_TO_MEASURE_DECLARED"]);
  assert.deepEqual(await look("Aucun débordement sur les quatre pages.", cfg(0)), ["PROVEN:MEASURED_AGAIN_OK"]);
  // The claim that started this project: announced clean, measured dirty.
  assert.deepEqual(await look("Aucun débordement sur les quatre pages.", cfg(1)), ["CONTRADICTED:MEASURED_AGAIN_FAILED"]);
  // A declared check only answers for what it was declared for, and a shell string is refused.
  assert.deepEqual(await look("Typage propre.", cfg(0)), ["COULD_NOT_CHECK:NO_WAY_TO_MEASURE_DECLARED"]);
  assert.deepEqual(await look("Aucun débordement.", { roots: [dir], config: { checks: [{ match: "debordement", run: "node m.mjs 0" }] } }), ["COULD_NOT_CHECK:NO_WAY_TO_MEASURE_DECLARED"]);
  assert.equal(readFileSync(counter, "utf8"), "xx");
  // Exit 3 means "I could not measure" (server stopped...): nothing was seen, so nothing is concluded.
  assert.deepEqual(await look("Aucun débordement.", cfg(3)), ["COULD_NOT_CHECK:MEASURE_COULD_NOT_RUN"]);
  // A long measurement does not hold the turn: it is deferred, and only runs when waiting is allowed.
  const slow = (extra) => ({ roots: [dir], config: { checks: [{ name: "long", match: "debordement", slow: true, run: [process.execPath, script, "0"] }] }, ...extra });
  const held = slow({});
  assert.deepEqual(await look("Aucun débordement.", held), ["COULD_NOT_CHECK:MEASURE_STARTED_IN_BACKGROUND"]);
  assert.deepEqual(held.deferred, ["Aucun débordement."]);
  assert.equal(readFileSync(counter, "utf8"), "xxx", "nothing ran while the turn was ending");
  assert.deepEqual(await look("Aucun débordement.", slow({ allowSlow: true })), ["PROVEN:MEASURED_AGAIN_OK"]);
});

test("look: tests are re-run only with the command the user declared, once", async () => {
  const dir = scratch("skeptopus-core-");
  const counter = join(dir, "runs.txt");
  const script = join(dir, "t.mjs");
  writeFileSync(script, 'import { appendFileSync } from "node:fs"; appendFileSync(' + JSON.stringify(counter) + ', "x"); process.exit(Number(process.argv[2]));');
  const cfg = (code) => ({ roots: [dir], config: { test: [process.execPath, script, String(code)] } });
  assert.deepEqual(await look("All tests pass.", { roots: [dir] }), ["COULD_NOT_CHECK:NO_TEST_COMMAND_DECLARED"]);
  assert.deepEqual(await look("All tests pass. Tests: 12/12.", cfg(0)), ["PROVEN:TESTS_PASS_NOW", "PROVEN:TESTS_PASS_NOW"]);
  assert.deepEqual(await look("All tests pass.", cfg(1)), ["CONTRADICTED:TESTS_FAIL_NOW"]);
  const { readFileSync } = await import("node:fs");
  assert.equal(readFileSync(counter, "utf8"), "xxx", "one run for the passing check although two sentences spoke of tests; two for the failing one, which is confirmed before anyone is contradicted");
  // A shell string is refused: SkeptOpus never hands text to a shell.
  assert.deepEqual(await look("All tests pass.", { roots: [dir], config: { test: "node t.mjs 0" } }), ["COULD_NOT_CHECK:NO_TEST_COMMAND_DECLARED"]);
});

test("look: declared tests that pass, but not as many as announced, may be other tests: SkeptOpus could not look", async () => {
  const dir = scratch("skeptopus-core-");
  const printer = join(dir, "p.mjs");
  writeFileSync(printer, 'console.log("ℹ tests 133\\nℹ pass 133\\nℹ fail 0");');
  const ctx = () => ({ roots: [dir], config: { test: [process.execPath, printer] } });
  // Found on 2026-11-12: an agent said "40 tests verts" about another project; SkeptOpus ran the 133 declared
  // ones and said "seen". Passing tests that are not the ones spoken of prove nothing about what was said.
  const other = await check("Ce que la session rapporte : 40 tests verts en local.", ctx());
  assert.deepEqual(other.rows.map((r) => r.verdict + ":" + r.why), ["COULD_NOT_CHECK:TESTS_PASS_NOW_BUT_COUNT_DIFFERS"]);
  assert.equal(other.rows[0].facts.check, "133 ≠ 40", "both numbers are told");
  assert.deepEqual(await look("133 tests passent.", ctx()), ["PROVEN:TESTS_PASS_NOW"]);
  assert.deepEqual(await look("Tests : 133/133.", ctx()), ["PROVEN:TESTS_PASS_NOW"]);
  assert.deepEqual(await look("Les tests passent.", ctx()), ["PROVEN:TESTS_PASS_NOW"]);
});

test("settings: lists add up, and the user's own file wins over the project's for single values", async () => {
  const { loadConfig, rootsOf } = await import("../core/observe.mjs");
  const dir = scratch("skeptopus-cfg-");
  const home = join(dir, "home");
  mkdirSync(home);
  writeFileSync(join(home, "config.json"), JSON.stringify({ repos: ["me/journal"], test: ["node", "--test"], roots: ["C:/elsewhere"] }));
  // What an agent could write inside the project it works in.
  writeFileSync(join(dir, ".skeptopus.json"), JSON.stringify({ repos: ["team/app"], test: ["true"], checks: [{ match: "lint", run: ["x"] }] }));
  // The environment is handed in, never changed: the project's own health check caught the first version of this test doing that.
  const env = { SKEPTOPUS_HOME: home };
  const config = loadConfig(undefined, dir, env);
  assert.deepEqual(config.repos, ["team/app", "me/journal"]);
  assert.deepEqual(config.test, ["node", "--test"], "the project cannot replace the user's test command");
  // A file that comes with the project may say where to look, never what to run:
  // otherwise opening a hostile repository would make SkeptOpus execute its commands.
  assert.equal(config.checks, undefined);
  const alone = loadConfig(undefined, dir, { SKEPTOPUS_HOME: join(dir, "nothing-here") });
  assert.deepEqual([alone.repos, alone.test, alone.checks], [["team/app"], undefined, undefined]);
  // Unless the user said, in their own file, that they trust this folder.
  writeFileSync(join(home, "config.json"), JSON.stringify({ repos: ["me/journal"], trusted: [dir] }));
  const trusting = loadConfig(undefined, dir, env);
  assert.deepEqual([trusting.test, trusting.checks.length], [["true"], 1]);
  writeFileSync(join(home, "config.json"), JSON.stringify({ repos: ["me/journal"], test: ["node", "--test"], roots: ["C:/elsewhere"] }));
  assert.deepEqual(rootsOf(dir, config), [dir, "C:/elsewhere"]);
  assert.equal(loadConfig(undefined, scratch("skeptopus-none-"), env).repos.length, 1);
  assert.equal(loadConfig(undefined, scratch("skeptopus-none-"), { SKEPTOPUS_HOME: join(dir, "nothing-here") }), null);
});

test("verdict: the message is as good as its weakest claim; silence and vagueness are named", async () => {
  assert.equal(overall(["PROVEN", "COULD_NOT_CHECK", "NOT_PROVEN"]), "NOT_PROVEN");
  assert.equal(overall(["PROVEN", "CONTRADICTED", "NOT_PROVEN"]), "CONTRADICTED");
  assert.equal(overall(["PROVEN", "PROVEN"]), "PROVEN");
  // One thing SkeptOpus could not look at keeps the whole message from being stamped as seen.
  assert.equal(overall(["PROVEN", "COULD_NOT_CHECK"]), "COULD_NOT_CHECK");
  assert.equal(overall([]), "NOTHING_CLAIMED");
  assert.equal((await check("Done.", { roots: ["."] })).verdict, "COULD_NOT_CHECK");
  assert.equal((await observe({ kind: "SOMETHING_NEW", negated: false }, { roots: ["."] })).outcome, "COULD_NOT_LOOK");
});

test("any tool: the final words and the folder are found whatever the payload calls them", () => {
  assert.deepEqual(normalize({ last_assistant_message: "Done.", cwd: "/a", session_id: "s", transcript_path: "/t" }), { message: "Done.", cwd: "/a", session: "s", transcript: "/t" });
  // Dash-separated names, as some tools send them.
  assert.deepEqual(normalize({ type: "agent-turn-complete", "last-assistant-message": "Pushed.", "thread-id": "t1", cwd: "/b" }), { message: "Pushed.", cwd: "/b", session: "t1", transcript: undefined });
  // A list of folders instead of one, and the text under another name.
  assert.deepEqual(normalize({ text: "Fait.", workspace_roots: ["/c", "/d"], conversation_id: "c9" }), { message: "Fait.", cwd: "/c", session: "c9", transcript: undefined });
  // Nothing usable is an empty message, not a crash.
  assert.equal(normalize({ status: "completed" }).message, "");
  // The environment is passed in: this test once read the real one, so it passed in a terminal and failed
  // inside a Claude Code trigger, where CLAUDE_PROJECT_DIR is set. SkeptOpus caught that twice on 2026-11-12.
  assert.equal(normalize({}, {}).cwd, undefined);
  assert.equal(normalize({}, { CLAUDE_PROJECT_DIR: "/p" }).cwd, "/p");
  assert.equal(normalize({ cwd: "/said" }, { CLAUDE_PROJECT_DIR: "/p" }).cwd, "/said", "what the tool says wins over the environment");
});

test("any tool: payloads as the vendors document them (read 2026-11-12)", () => {
  // Gemini CLI, AfterAgent.
  assert.equal(normalize({ hook_event_name: "AfterAgent", prompt: "do it", prompt_response: "Done, pushed.", cwd: "/g" }).message, "Done, pushed.");
  // Cursor, afterAgentResponse: the text, and folders as a list.
  const cursor = normalize({ hook_event_name: "afterAgentResponse", text: "Fichier créé.", workspace_roots: ["/w"], conversation_id: "c", transcript_path: "/t.jsonl" });
  assert.deepEqual([cursor.message, cursor.cwd, cursor.session, cursor.transcript], ["Fichier créé.", "/w", "c", "/t.jsonl"]);
  // Cursor's plain "stop", Kiro and Copilot give no final words: SkeptOpus has nothing to read, and says nothing.
  assert.equal(normalize({ hook_event_name: "stop", status: "completed", loop_count: 0, workspace_roots: ["/w"] }).message, "");
  assert.equal(normalize({ hook_event_name: "Stop", cwd: "/k", session_id: "s" }).message, "");
  assert.equal(normalize({ sessionId: "s", cwd: "/c", transcriptPath: "/t", stopReason: "end_turn" }).message, "");
});

test("install: one command hooks every tool found, loses nothing, and comes back out cleanly", () => {
  const home = scratch("skeptopus-install-");
  const read = (...p) => JSON.parse(readFileSync(join(home, ...p), "utf8"));
  // A machine with Claude Code (already carrying someone else's hook and a setting), Cursor (never configured), Codex, no Gemini CLI.
  mkdirSync(join(home, ".claude"));
  writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ model: "x", hooks: { Stop: [{ hooks: [{ type: "command", command: "python guard.py" }] }] } }));
  mkdirSync(join(home, ".cursor"));
  mkdirSync(join(home, ".codex"));
  writeFileSync(join(home, ".codex", "hooks.json"), JSON.stringify({ hooks: {} }));
  // A dry run writes nothing at all.
  const dry = install({ home, env: {}, dryRun: true });
  assert.deepEqual(dry.tools.map((t) => t.tool + ":" + t.state), ["claude:WOULD_ATTACH", "cursor:WOULD_ATTACH", "codex:WOULD_ATTACH", "gemini:ABSENT"]);
  assert.equal(existsSync(join(home, ".skeptopus")), false);
  assert.equal(existsSync(join(home, ".cursor", "hooks.json")), false);
  // The real one.
  const done = install({ home, env: {}, shortcuts: false });
  assert.equal(done.ok, true);
  assert.deepEqual(done.tools.map((t) => t.tool + ":" + t.state), ["claude:ATTACHED", "cursor:ATTACHED", "codex:ATTACHED", "gemini:ABSENT"]);
  const engine = join(home, ".skeptopus", "app", "cli.mjs").replace(/\\/g, "/");
  for (const f of ["cli.mjs", "claims.mjs", "observe.mjs", "package.json"]) assert.ok(existsSync(join(home, ".skeptopus", "app", f)), f + " is copied to the stable folder");
  for (const f of ["art/skeptopus.webp", "fonts/inter.woff2", "sounds/contradicted.wav"]) assert.ok(existsSync(join(home, ".skeptopus", "app", f)), f + " comes along: pictures, typefaces and sounds");
  assert.ok(existsSync(join(home, ".skeptopus", "journal.html")), "there is a page to open");
  assert.equal(read(".skeptopus", "config.json").notify, "problems");
  // The tools point at the stable copy, never at the folder the installer ran from.
  const claude = read(".claude", "settings.json");
  assert.equal(claude.model, "x", "an unrelated setting survives");
  assert.deepEqual(claude.hooks.Stop.map((g) => g.hooks[0].command.includes(engine) || g.hooks[0].command), ["python guard.py", true]);
  assert.ok(existsSync(join(home, ".claude", "settings.json.avant-skeptopus")), "the settings of before are kept beside");
  assert.ok(read(".cursor", "hooks.json").hooks.afterAgentResponse[0].command.includes(engine));
  assert.ok(read(".codex", "hooks.json").hooks.Stop[0].hooks[0].command.includes(engine));
  assert.equal(existsSync(join(home, ".gemini")), false, "a tool that is not there is not invented");
  // Installing again never doubles a hook, and never resets what the user changed.
  writeFileSync(join(home, ".skeptopus", "config.json"), JSON.stringify({ notify: "always" }));
  install({ home, env: {}, shortcuts: false });
  assert.equal(read(".claude", "settings.json").hooks.Stop.length, 2);
  assert.equal(read(".cursor", "hooks.json").hooks.afterAgentResponse.length, 1);
  assert.equal(read(".skeptopus", "config.json").notify, "always");
  // The state is read from the files.
  const now = status({ home, env: {}, cwd: home });
  assert.deepEqual(now.tools.map((t) => t.state), ["ATTACHED", "ATTACHED", "ATTACHED", "ABSENT"]);
  assert.equal(now.engine, true);
  assert.match(tell("install", done, "fr"), /Claude Code : accroché/);
  assert.match(tell("install", done, "en"), /Codex: hooked[\s\S]*open \/hooks/);
  // Out again: only SkeptOpus's lines leave, the user's data stays.
  const out = uninstall({ home, env: {} });
  assert.deepEqual(out.tools.map((t) => t.removed), [1, 1, 1, 0]);
  assert.deepEqual(read(".claude", "settings.json").hooks.Stop.map((g) => g.hooks[0].command), ["python guard.py"]);
  assert.deepEqual(read(".cursor", "hooks.json").hooks, {}, "no empty list is left behind");
  assert.deepEqual(read(".codex", "hooks.json").hooks, {});
  assert.deepEqual(status({ home, env: {}, cwd: home }).tools.map((t) => t.state), ["NOT_ATTACHED", "NOT_ATTACHED", "NOT_ATTACHED", "ABSENT"]);
  assert.ok(existsSync(join(home, ".skeptopus", "config.json")), "the user's settings are not deleted");
  // Claude Code hooked for one folder only is said as such.
  mkdirSync(join(home, "proj", ".claude"), { recursive: true });
  writeFileSync(join(home, "proj", ".claude", "settings.local.json"), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: 'node "' + engine + '" hook --from claude' }] }] } }));
  assert.equal(status({ home, env: {}, cwd: join(home, "proj") }).tools[0].state, "ATTACHED_HERE_ONLY");
});

test("install: the trigger names the running program by its full path, unless that path is fragile", () => {
  assert.equal(nodeForHooks("/usr/local/bin/node"), "/usr/local/bin/node");
  assert.equal(nodeForHooks("/opt/homebrew/bin/node"), "/opt/homebrew/bin/node");
  assert.equal(nodeForHooks("C:\\nodejs\\node.exe"), "C:/nodejs/node.exe");
  // A space would need a quote at the head of the line, which cmd, PowerShell and bash read differently.
  assert.equal(nodeForHooks("C:\\Program Files\\nodejs\\node.exe"), "node");
  // A version manager's path dies at the next upgrade: the plain name lasts.
  assert.equal(nodeForHooks("/Users/x/.nvm/versions/node/v22.3.0/bin/node"), "node");
  assert.equal(nodeForHooks("C:\\Users\\x\\AppData\\Roaming\\fnm\\node-versions\\v22\\installation\\node.exe"), "node");
  assert.equal(nodeForHooks("/home/x/.volta/tools/image/node/22.3.0/bin/node"), "node");
  // An editor running its own extension only plays node for the occasion. Named in a trigger, it would open
  // the editor at every answer: the plain name is written instead.
  assert.equal(nodeForHooks("C:\\Apps\\Code\\Code.exe"), "node");
  assert.equal(nodeForHooks("/usr/share/cursor/cursor"), "node");
  assert.equal(nodeForHooks("/Applications/Editor.app/Contents/Frameworks/Helper"), "node");
  // The line written in a tool's settings is still recognised as ours, so a second install never doubles it.
  const home = scratch("skeptopus-node-");
  mkdirSync(join(home, ".claude"));
  const first = attach("claude", { home });
  // Claude Code runs triggers through a POSIX shell: there the full path is kept, quoted, even with a space.
  assert.ok(first.command.startsWith('"' + process.execPath.replace(/\\/g, "/") + '" "') || first.command.startsWith('node "'), first.command);
  mkdirSync(join(home, ".cursor"));
  assert.ok(attach("cursor", { home }).command.startsWith(nodeForHooks() + ' "'), "the other tools get the form every shell reads the same way");
  const second = attach("claude", { home });
  assert.equal(second.replaced, true);
  assert.equal(JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8")).hooks.Stop.length, 1);
});

test("hook: the same turn brought twice gets one answer and one journal entry", () => {
  const dir = scratch("skeptopus-twice-");
  const turn = { session: "s1", message: "I created `a.md`." };
  assert.equal(firstForThisTurn(turn, dir, 1000), true);
  assert.equal(firstForThisTurn(turn, dir, 1500), false, "a second trigger for the same turn stays silent");
  assert.equal(firstForThisTurn({ session: "s1", message: "I created `b.md`." }, dir, 1600), true, "another message is another turn");
  assert.equal(firstForThisTurn({ session: "s2", message: "I created `a.md`." }, dir, 1700), true, "another session is another turn");
  assert.equal(firstForThisTurn({ session: "s1", message: "" }, dir, 1800), true, "nothing said, nothing to guard");
  // The same words said again later are a new turn: the guard only covers the few seconds two triggers take.
  assert.equal(firstForThisTurn(turn, dir, Date.now() + 60000), true);
  // End to end, through the command line.
  writeFileSync(join(dir, "a.md"), "x");
  const cli = resolve("core", "cli.mjs");
  const home = join(dir, "home");
  const fire = () => spawnSync(process.execPath, [cli, "hook"], { input: JSON.stringify({ last_assistant_message: "I created `a.md`.", cwd: dir, session_id: "e2e" }), encoding: "utf8", env: { ...process.env, SKEPTOPUS_HOME: home } });
  assert.match(fire().stdout, /systemMessage/);
  assert.equal(fire().stdout, "");
  assert.equal(readFileSync(join(home, "historique.jsonl"), "utf8").trim().split("\n").length, 1);
});

test("install: the folder SkeptOpus lives in, and a switch never swallows the next option", () => {
  const home = scratch("skeptopus-home-");
  assert.equal(homeOf({}, home), join(home, ".skeptopus"));
  mkdirSync(join(home, ".skeptopus"));
  assert.equal(homeOf({}, home), join(home, ".skeptopus"));
  assert.equal(homeOf({ SKEPTOPUS_HOME: "/new" }, home), "/new");
  assert.equal(homeOf({ SKEPTOPUS_HOME: "" }, home), join(home, ".skeptopus"), "an empty variable is no folder");
  // The command line: "--dry-run --home X" once lost the folder and would have acted on the real one.
  const cli = resolve("core/cli.mjs");
  const sandbox = scratch("skeptopus-cli-");
  mkdirSync(join(sandbox, ".cursor"));
  const ran = spawnSync(process.execPath, [cli, "install", "--dry-run", "--home", sandbox, "--json"], { encoding: "utf8", env: { ...process.env, SKEPTOPUS_HOME: "" } });
  const said = JSON.parse(ran.stdout);
  assert.equal(said.dryRun, true);
  assert.ok(said.home.startsWith(sandbox), "the folder given is the folder used");
  assert.equal(existsSync(join(sandbox, ".skeptopus")), false);
});

test("journal: a day with something to look at keeps its sentence while the octopus rests", () => {
  // Found on 13/11 while filming the morning scene: opened at 9:00 after a night of checks, the page replaced
  // "Today: 1 contradicted and 1 not found. Worth a look." with "Nothing new for 6 hours. The octopus is resting.",
  // which hid the one line one opens the page for. The octopus still sleeps; the sentence stays.
  const now = new Date("2026-11-13T08:00:00Z");
  const night = [{ at: "2026-11-13T02:07:00Z", verdict: "CONTRADICTED", rows: [{ verdict: "CONTRADICTED", kind: "TESTS_PASS", target: "115/115", why: "TESTS_FAIL_NOW" }] }];
  const page = journalHtml(night, now, { lang: "en" });
  assert.match(page, /<body class="nojs alert"/);
  assert.match(page, /if\(age>30\)\{b\.classList\.add\("asleep"\);if\(isFinite\(age\)&&!b\.classList\.contains\("alert"\)\)/, "the resting sentence never replaces an alert");
  assert.match(page, /Today: 1 contradicted\. Worth a look\./);
});

test("journal: the octopus on top takes the pose of the day's worst answer", () => {
  // Drawn to be read at a glance: arms crossed (not found), pointing in anger (contradicted), blindfolded (couldn't look).
  const now = new Date("2026-11-12T15:00:00Z");
  const day = (...verdicts) => [{ at: "2026-11-12T12:00:00Z", verdict: verdicts[0], rows: verdicts.map((v) => ({ verdict: v, kind: "FILE_WRITTEN", target: "a.md", why: "FILE_ABSENT" })) }];
  const heroOf = (entries) => /class="face hero-face (f-[\w-]+)"/.exec(journalHtml(entries, now))?.[1];
  assert.equal(heroOf(day("PROVEN")), "f-skeptopus");
  assert.equal(heroOf([]), "f-skeptopus");
  assert.equal(heroOf(day("NOT_PROVEN", "PROVEN")), "f-skeptopus-refuse");
  assert.equal(heroOf(day("COULD_NOT_CHECK", "PROVEN")), "f-skeptopus-paspu");
  // Contradicted outweighs everything, and not found outweighs couldn't look.
  assert.equal(heroOf(day("CONTRADICTED", "NOT_PROVEN", "COULD_NOT_CHECK")), "f-skeptopus-contredit");
  assert.equal(heroOf(day("NOT_PROVEN", "COULD_NOT_CHECK")), "f-skeptopus-refuse");
  // Yesterday does not set today's pose, and an answer found wrong does not count.
  assert.equal(heroOf([{ ...day("CONTRADICTED")[0], at: "2026-11-11T12:00:00Z" }]), "f-skeptopus");
  assert.equal(heroOf([{ ...day("CONTRADICTED")[0], erratum: "wrong alarm" }]), "f-skeptopus");
  // Only the pose of the day is written in the page, and every picture keeps a class of its own.
  const page = journalHtml(day("NOT_PROVEN"), now);
  assert.equal((page.match(/\.f-skeptopus-refuse\{background-image:url\(data:image\/webp;base64,/g) ?? []).length, 1);
  assert.doesNotMatch(page, /\.f-skeptopus-contredit\{|\.f-skeptopus-paspu\{/);
  assert.match(page, /\.f-skeptopus\{background-image/);
  assert.deepEqual(["CONTRADICTED", "NOT_PROVEN", "COULD_NOT_CHECK", "PROVEN", null].map(poseOf), ["skeptopus-contredit.webp", "skeptopus-refuse.webp", "skeptopus-paspu.webp", "skeptopus.webp", "skeptopus.webp"]);
  // The sentence says the same as the pose. Seen on 12/11: a blindfolded octopus above "0 chose vue, rien à signaler".
  const blind = journalHtml(day("COULD_NOT_CHECK", "PROVEN", "PROVEN"), now);
  assert.match(blind, /Today: 1 thing it couldn't look at, 2 seen\./);
  assert.match(blind, /Aujourd'hui : 1 chose qu'il n'a pas pu voir, 2 vues\./);
  assert.match(blind, /今天：1 项无法核实，2 项属实。/);
  assert.match(journalHtml(day("COULD_NOT_CHECK"), now), /Hoy: 1 cosa que no pudo mirar\./);
  assert.doesNotMatch(blind, /nothing to report|rien à signaler/);
});

test("words: every language says everything English says", () => {
  assert.deepEqual(LANGS, ["en", "fr", "es", "zh", "ar"]);
  const shape = (o) => Object.keys(o).sort().map((k) => (o[k] && typeof o[k] === "object" && !Array.isArray(o[k]) ? k + "{" + Object.keys(o[k]).sort().join(",") + "}" : k)).join(" ");
  for (const lang of LANGS) {
    assert.equal(shape(WORDS[lang]), shape(WORDS.en), lang + ": verdicts and kinds");
    assert.deepEqual(Object.keys(WHY[lang]).sort(), Object.keys(WHY.en).sort(), lang + ": reasons");
    assert.equal(shape(PAGE[lang]), shape(PAGE.en), lang + ": page");
    assert.equal(PAGE[lang].what.length, 3);
    assert.ok(PAGE[lang].asleep.length >= 3, lang + ": minutes, one hour, hours");
    for (const text of [...Object.values(WHY[lang]), PAGE[lang].slogan, ...PAGE[lang].what, ...Object.values(PAGE[lang].crew).map((c) => c.line)]) assert.ok(!String(text).includes("—"), lang + ": no em dash");
  }
  // Written the way each language speaks: none of these is the English sentence put into other words.
  // The French one is the whole sentence one really says, not its clipped form.
  assert.deepEqual(LANGS.map((l) => PAGE[l].slogan), ["Done? Show me.", "C'est fait ? Fais voir.", "¿Hecho? A ver.", "搞定了？给我看看。", "خلاص؟ ورّيني."]);
  assert.deepEqual(LANGS.map((l) => WORDS[l].NOT_PROVEN), ["NOT FOUND", "REFUSÉ", "NO CONSTA", "查无实据", "لا أثر له"]);
  // Arabic counts one, two, a few and many each in their own form; and it is the only one read right to left.
  assert.deepEqual([1, 2, 5, 12].map(WORDS.ar.checked), ["تمّ التحقق من ادّعاء واحد", "تمّ التحقق من ادّعاءين", "تمّ التحقق من 5 ادّعاءات", "تمّ التحقق من 12 ادّعاءً"]);
  assert.deepEqual(LANGS.map((l) => DIR[l]), ["ltr", "ltr", "ltr", "ltr", "rtl"]);
  assert.equal(PAGE.ar.asleep.length, 5, "Arabic has its own forms for two hours and for eleven and more");
  // Two reasons tied together keep each language's own brackets; an unknown code is still readable.
  assert.equal(say("fr", "INDEED_NOT:NO_REMOTE_CONFIGURED"), "en effet, ce n'est pas fait (aucun dépôt distant n'est configuré)");
  assert.equal(say("zh", "INDEED_NOT:NO_REMOTE_CONFIGURED"), "确实没做（没有配置远程仓库）");
  assert.equal(say("es", "SOME_NEW_CODE"), "some new code");
  assert.equal(say("xx", "FILE_ABSENT"), "the file doesn't exist", "an unknown language falls back to the original");
  // What the journal kept before 2026-11-12 carries French words: each reader still gets their own.
  assert.equal(sourceLabel("en", "presse-papiers"), "clipboard");
  assert.equal(sourceLabel("es", "clipboard"), "portapapeles");
  assert.equal(sourceLabel("en", "claude · mesure refaite"), "claude · measured again");
  assert.equal(sourceLabel("zh", "codex · remeasured"), "codex · 重新检测");
  assert.equal(sourceLabel("fr", "cursor"), "cursor");
  assert.equal(sourceLabel("ar", "presse-papiers"), "الحافظة");
});

test("words: the one-line answer and the detailed one, in each language", async () => {
  const dir = scratch("skeptopus-lang-");
  writeFileSync(join(dir, "a.md"), "x");
  const fine = await check("I created `a.md`.", { roots: [dir] });
  assert.deepEqual(LANGS.map((l) => summary(fine, l)), ["SkeptOpus · [ SEEN ] 1 claim checked", "SkeptOpus · [ VU ] 1 affirmation vérifiée", "SkeptOpus · [ VISTO ] 1 afirmación comprobada", "SkeptOpus · [ 属实 ] 核实了 1 条说法", "SkeptOpus · [ مؤكَّد ] تمّ التحقق من ادّعاء واحد"]);
  const bad = await check("I created `nope.md`.", { roots: [dir] });
  assert.match(render(bad, "en"), /\[NOT FOUND\]\s+file written nope\.md: the file doesn't exist/);
  assert.match(render(bad, "es"), /\[NO CONSTA\]\s+archivo escrito nope\.md: el archivo no existe/);
  assert.match(render(bad, "zh"), /\[查无实据\]\s+写入的文件 nope\.md：文件不存在/);
  assert.match(render(bad, "ar"), /\[لا أثر له\]\s+ملف مكتوب nope\.md: الملف غير موجود/);
  assert.match(render(bad), /NOT FOUND/, "English is the original");
});

test("journal: one character per answer, and the crew says its own sentences in every language", () => {
  const now = new Date("2026-11-12T15:00:00Z");
  const row = (verdict, kind) => ({ verdict, kind, target: "x", why: "FILE_ABSENT" });
  const entry = (verdict, kind, at) => ({ at, verdict, source: "claude", cwd: "x", rows: kind ? [row(verdict, kind)] : [] });
  // A character that matches none of the answers creates a dissonance: each one stands for an answer.
  assert.equal(castOf(entry("PROVEN", "FILE_WRITTEN")), "fourmi.webp");
  assert.equal(castOf(entry("NOT_PROVEN", "FILE_WRITTEN")), "albatros.webp", "missing, not there yet: the one who will do it tomorrow");
  assert.equal(castOf(entry("NOT_PROVEN", "PUSHED")), "pigeon.webp", "said to be sent, never arrived: the courier");
  assert.equal(castOf(entry("NOT_PROVEN", "PR_MERGED")), "pigeon.webp");
  assert.equal(castOf(entry("CONTRADICTED", "TESTS_PASS")), "grenouille.webp");
  assert.equal(castOf(entry("COULD_NOT_CHECK", "PUSHED")), "taupe.webp");
  assert.equal(castOf(entry("NOTHING_CLAIMED")), "skeptopus.webp", "nothing to check: the octopus himself");
  // A proven row beside a missing one does not make the courier appear: only what is missing counts.
  assert.equal(castOf({ verdict: "NOT_PROVEN", rows: [row("PROVEN", "PUSHED"), row("NOT_PROVEN", "FILE_WRITTEN")] }), "albatros.webp");
  const entries = [entry("PROVEN", "FILE_WRITTEN", "2026-11-12T12:05:00Z"), entry("NOT_PROVEN", "PUSHED", "2026-11-12T12:04:00Z"), entry("NOT_PROVEN", "FILE_WRITTEN", "2026-11-12T12:03:00Z"), entry("CONTRADICTED", "TESTS_PASS", "2026-11-12T12:02:00Z"), entry("COULD_NOT_CHECK", "PUSHED", "2026-11-12T12:01:00Z")];
  const page = journalHtml(entries, now);
  const english = page.slice(page.indexOf('data-lang="en"'), page.indexOf('data-lang="fr"'));
  assert.deepEqual([...english.matchAll(/<article [^>]*>(?:<p class="erratum">.*?<\/p>)?<span class="face mini (f-\w+)"/g)].map((m) => m[1]), ["f-fourmi", "f-pigeon", "f-albatros", "f-grenouille", "f-taupe"]);
  assert.match(english, /aria-label="The ant · SEEN"/);
  // The pictures come from the full-size originals and ship as WebP; the big octopus of the header is the same character.
  assert.match(page, /\.f-fourmi\{background-image:url\(data:image\/webp;base64,/);
  // A day with a contradiction: the octopus on top is the furious one.
  assert.match(english, /class="face hero-face f-skeptopus-contredit"/);
  assert.doesNotMatch(page, /data:image\/png/, "no small preview left in the page");
  // Each picture is still written once, as a style, however many cards show it.
  for (const f of ["fourmi", "albatros", "pigeon", "grenouille", "taupe"]) assert.equal((page.match(new RegExp("\\.f-" + f + "\\{background-image", "g")) ?? []).length, 1, f);
  // The crew: five characters in each of the five languages, each with its answer and its own spoken sentence.
  assert.equal((page.match(/<figure class="who /g) ?? []).length, 25);
  assert.match(english, /<figure class="who warn"><span class="face who-face f-pigeon"[^>]*><\/span><figcaption><b>The pigeon<\/b><span class="stamp">NOT FOUND<\/span><span class="line">“No, it went out this morning\. It says delivered on my end\.”<\/span>/);
  const french = page.slice(page.indexOf('data-lang="fr"'), page.indexOf('data-lang="es"'));
  assert.match(french, /Les cinq qui disent/);
  assert.match(french, /<b>La taupe<\/b><span class="stamp">PAS PU VOIR<\/span><span class="line">«[^<]*Ah moi j'ai rien vu, hein\. J'avais pas les accès\.[^<]*»/);
  for (const lang of LANGS) assert.deepEqual(Object.keys(PAGE[lang].crew), ["ant", "albatross", "pigeon", "frog", "mole"], lang);
});

test("journal: one page, every language, the reader's own shown first", () => {
  const now = new Date("2026-11-12T15:00:00Z");
  const entries = [{ at: "2026-11-12T12:00:00Z", verdict: "NOT_PROVEN", source: "presse-papiers", cwd: "x", rows: [{ verdict: "NOT_PROVEN", kind: "FILE_WRITTEN", target: "a.md", why: "FILE_ABSENT", said: "I created `a.md`." }] }];
  const page = journalHtml(entries, now);
  assert.equal((page.match(/<div class="L" /g) ?? []).length, 5);
  assert.match(page, /<html lang="en-US" dir="ltr">/);
  assert.match(page, /<div class="L" data-lang="en" lang="en-US" dir="ltr">/);
  for (const lang of ["fr", "es", "zh"]) assert.match(page, new RegExp('<div class="L" data-lang="' + lang + '" lang="[^"]+" dir="ltr" hidden>'));
  assert.equal((page.match(/<button type="button" data-set="/g) ?? []).length, 5, "a button for each language");
  // Arabic reads right to left: its part says so, its date keeps the page's digits, and the name stays as it is written.
  assert.match(page, /<div class="L" data-lang="ar" lang="ar-u-ca-gregory-nu-latn" dir="rtl" hidden>/);
  assert.match(page, /السجل · 12 نوفمبر[\s\S]*خلاص؟<\/span> <span class="nb">ورّيني\.[\s\S]*لا أثر له<\/span>[\s\S]*الملف غير موجود/);
  // Seen at 320 px on 12/11: "C'est fait ? Fais / voir.". The slogan is a question and its answer: a narrow screen
  // breaks the line between the two, never inside one. Chinese keeps its two halves touching, as it is written.
  assert.match(page, /<p class="slogan"><span class="nb">Done\?<\/span> <span class="nb">Show me\.<\/span><\/p>/);
  assert.match(page, /<p class="slogan"><span class="nb">¿Hecho\?<\/span> <span class="nb">A ver\.<\/span><\/p>/);
  assert.match(page, /<p class="slogan"><span class="nb">搞定了？<\/span><span class="nb">给我看看。<\/span><\/p>/);
  assert.match(page, /\.slogan \.nb\{white-space:nowrap\}/);
  // A slogan that is not this short dialogue keeps the ordinary wrapping: nothing is forced onto one line.
  assert.match(journalHtml(entries, now, { slogan: "A much longer line that is not a question and its short answer" }), /<p class="slogan">A much longer line that is not a question and its short answer<\/p>/);
  assert.match(page, /\.brand\{[^}]*direction:ltr/);
  assert.match(page, /<p class="said" dir="auto">/, "the AI's own words find their own direction");
  // Seen on the real page on 12/11: the hour was forced left to right, which put the Arabic evening mark on the wrong side.
  assert.match(page, /<time dir="auto">/, "the hour finds its own direction");
  assert.doesNotMatch(page, /time[^{}]*\{[^}]*direction:ltr/, "nothing forces the hour left to right");
  // Seen on the real page on 12/11, phone width: 23 to 34 file names out of 132 lost their last letters to the next line.
  // A name is one piece: it moves whole, and only one longer than a full line is cut, inside its own box.
  assert.match(page, /(?:^|[};\s])code\{display:inline-block;max-width:100%;[^}]*overflow-wrap:anywhere\}/m);
  assert.doesNotMatch(page, /(?:^|[};\s,])code\{[^}]*word-break:break-all/m);
  // On the Chinese page, Latin letters keep the page's own serif; only Chinese characters go to the Chinese typeface.
  assert.match(page, /:lang\(zh\) \.said\{font-family:"Fraunces",/);
  // Seen at the bottom of the real page: "re|loads", "El|le", and the count 57 written "5" then "7" in Arabic.
  assert.doesNotMatch(page, /word-break:break-all/, "no ordinary word or number is ever cut in the middle");
  // Side characters that match none of the four answers create a dissonance: none on the page.
  assert.doesNotMatch(page, /class="cast"|troupe/, "no character on the page that stands for no answer");
  const arabic = journalHtml(entries, now, { lang: "ar" });
  assert.match(arabic, /<html lang="ar-u-ca-gregory-nu-latn" dir="rtl">/);
  // Each part speaks its own language, down to the date and the punctuation.
  assert.match(page, /November 12[\s\S]*NOT FOUND<\/span>[\s\S]*the file doesn't exist/);
  assert.match(page, /REFUSÉ<\/span>[\s\S]*le fichier n'existe pas/);
  assert.match(page, /<p class="slogan"><span class="nb">C'est fait\u202f\?<\/span> <span class="nb">Fais voir\.<\/span><\/p>/, "French thin spaces");
  assert.match(page, /12 de noviembre[\s\S]*NO CONSTA<\/span>[\s\S]*el archivo no existe/);
  assert.match(page, /11月12日[\s\S]*查无实据<\/span>[\s\S]*文件不存在/);
  assert.match(page, /<small><b>clipboard<\/b>[\s\S]*<small><b>presse-papiers<\/b>[\s\S]*<small><b>portapapeles<\/b>[\s\S]*<small><b>剪贴板<\/b>/);
  // The user's setting chooses the part shown before any script runs.
  const french = journalHtml(entries, now, { lang: "fr" });
  assert.match(french, /<html lang="fr-FR" dir="ltr">/);
  assert.match(french, /<div class="L" data-lang="fr" lang="fr-FR" dir="ltr">/);
  assert.match(french, /<div class="L" data-lang="en" lang="en-US" dir="ltr" hidden>/);
  assert.match(french, /<body class="nojs alert"[^>]* data-lang="fr"/);
  // The typefaces sit beside the page: named only when a folder is given.
  assert.doesNotMatch(page, /@font-face/);
  const withFonts = journalHtml(entries, now, { fonts: "fonts/" });
  assert.match(withFonts, /@font-face\{font-family:"Fraunces";font-style:italic;[^}]*url\(fonts\/fraunces-italic\.woff2\)/);
  // The Arabic typefaces are only fetched when Arabic is on screen.
  assert.match(withFonts, /@font-face\{font-family:"Noto Sans Arabic";[^}]*url\(fonts\/noto-sans-arabic\.woff2\)[^}]*unicode-range:U\+0600-06FF/);
  assert.doesNotMatch(withFonts, /@font-face\{font-family:"Inter";[^}]*unicode-range/);
});

test("journal: an answer found wrong is kept, struck, explained, and no longer counted", () => {
  const now = new Date("2026-11-12T15:00:00Z");
  const entry = (at, extra) => ({ at, verdict: "CONTRADICTED", source: "claude", cwd: "x", rows: [{ verdict: "CONTRADICTED", kind: "TESTS_PASS", target: "3/3", why: "TESTS_FAIL_NOW", said: "3 tests sur 3." }], ...extra });
  const tileOf = (html) => /class="tile bad"><b data-n="(\d+)"/.exec(html)[1];
  assert.equal(tileOf(journalHtml([entry("2026-11-12T12:00:00Z")], now)), "1");
  const corrected = journalHtml([entry("2026-11-12T12:00:00Z", { erratum: "Fausse alerte." })], now);
  assert.equal(tileOf(corrected), "0");
  assert.match(corrected, /<b>Erratum\.<\/b> Fausse alerte\./);
  assert.match(corrected, /3 tests sur 3\./, "what was said at the time stays readable");
  assert.doesNotMatch(corrected, /<body class="nojs alert"/);
  // A pasted address or path with no space must wrap inside its card: found on 2026-11-12 on the real page,
  // which had become wider than a phone screen after a text was checked from the clipboard.
  const long = journalHtml([{ at: "2026-11-12T12:00:00Z", verdict: "NOTHING_CLAIMED", source: "presse-papiers", cwd: "x", rows: [], excerpt: "x".repeat(300) }], now);
  assert.match(long, /article\{[^}]*overflow-wrap:anywhere/);
  assert.doesNotMatch(long, /Did it\?/, "the earlier name leaves no trace in the header");
  // The moving octopus is shown on watch, never in place of the pose that says "contradicted".
  assert.match(journalHtml([entry("2026-11-12T12:00:00Z", { erratum: "x" })], now, { anim: "clip.webp" }), /class="face hero-face anim"[^>]*url\(clip\.webp\)/);
  assert.doesNotMatch(journalHtml([entry("2026-11-12T12:00:00Z")], now, { anim: "clip.webp" }), /hero-face anim/);
  assert.doesNotMatch(journalHtml([], now), /hero-face anim/);
});

test("read: a commit identifier made only of digits, or only of letters, is still an identifier", () => {
  // About one short identifier in twenty-seven has no letter at all. Before 2026-11-12 such a commit was not read:
  // SkeptOpus said nothing, and the test that used a real random identifier failed one run in twenty.
  assert.deepEqual(kinds("Commit local `4829173`."), ["COMMITTED:4829173"]);
  assert.deepEqual(kinds("Commit local `abcdefa`."), ["COMMITTED:abcdefa"]);
  assert.deepEqual(kinds("Committed 4829173."), ["COMMITTED:4829173"]);
  assert.deepEqual(kinds("Commité 4829173."), ["COMMITTED:4829173"]);
  assert.deepEqual(kinds("Committed 4829173, not pushed."), ["COMMITTED:4829173", "!PUSHED"]);
  // A number or a word is not an identifier just because the sentence speaks of a commit.
  assert.deepEqual(kinds("J'ai compté 4829173 lignes dans le commit."), []);
  assert.deepEqual(kinds("Le commit ajoute 1500000 lignes."), []);
});

test("field false alarms of 2026-11-12 stay fixed", async () => {
  // "a commit never sent" describes a state: it denies the sending, it does not claim "I did not commit".
  assert.deepEqual(kinds("Il reste un arbitrage : 18 vieilles copies de test portent chacune un commit jamais envoyé sur le serveur."), []);
  assert.deepEqual(kinds("Pas de commit pour l'instant."), ["!COMMITTED"]);
  // A failing run is run twice before anyone is contradicted, and the first failure is told, never hidden.
  const dir = scratch("skeptopus-flaky-");
  const flag = join(dir, "second");
  const flaky = "const fs=require('fs');if(fs.existsSync(process.argv[1])){console.log('pass 3');process.exit(0)}fs.writeFileSync(process.argv[1],'');console.log('\\u2716 the slow one (12ms)');process.exit(1)";
  assert.deepEqual(await look("All tests pass.", { roots: [dir], config: { test: [process.execPath, "-e", flaky, flag] } }), ["PROVEN:TESTS_PASS_ON_SECOND_RUN"]);
  const always = "console.log('\\u2716 the broken one (3ms)');process.exit(1)";
  const twice = await check("All tests pass.", { roots: [dir], config: { test: [process.execPath, "-e", always] } });
  assert.equal(twice.rows[0].why, "TESTS_FAIL_NOW");
  assert.match(twice.rows[0].facts.check, /the broken one/);
});

test("attach: adds SkeptOpus to a tool's settings without touching what is there", () => {
  const home = scratch("skeptopus-attach-");
  // Codex: nothing there yet.
  const codex = attach("codex", { home });
  assert.equal(codex.ok, true);
  const codexFile = JSON.parse(readFileSync(join(home, ".codex", "hooks.json"), "utf8"));
  assert.match(codexFile.hooks.Stop[0].hooks[0].command, /hook --from codex --out claude$/);
  assert.equal(codex.backup, null, "nothing existed, so there is nothing to back up");
  // Cursor: somebody else's hooks are already there and must stay.
  mkdirSync(join(home, ".cursor"));
  const cursorPath = join(home, ".cursor", "hooks.json");
  writeFileSync(cursorPath, JSON.stringify({ version: 1, hooks: { afterAgentResponse: [{ command: "./mine.sh" }], stop: [{ command: "./other.sh" }] } }));
  const cursor = attach("cursor", { home });
  let cfg = JSON.parse(readFileSync(cursorPath, "utf8"));
  // Known by the shape of its line, not by the name of the folder the engine sits in (found under Linux, 12/11).
  assert.deepEqual(cfg.hooks.afterAgentResponse.map((h) => /hook --from cursor --out none$/.test(h.command) || h.command), ["./mine.sh", true]);
  assert.deepEqual(cfg.hooks.stop, [{ command: "./other.sh" }]);
  assert.match(cfg.hooks.afterAgentResponse[1].command, /--out none$/, "Cursor shows nothing from a hook");
  assert.ok(readFileSync(cursor.backup, "utf8").includes("./mine.sh"), "the previous file is kept beside it");
  // Attaching twice does not stack two lines.
  attach("cursor", { home });
  cfg = JSON.parse(readFileSync(cursorPath, "utf8"));
  assert.equal(cfg.hooks.afterAgentResponse.length, 2);
  // Detaching removes SkeptOpus's line and only that.
  assert.equal(detach("cursor", { home }).removed, 1);
  cfg = JSON.parse(readFileSync(cursorPath, "utf8"));
  assert.deepEqual(cfg.hooks.afterAgentResponse, [{ command: "./mine.sh" }]);
  // A dry run writes nothing; a settings file SkeptOpus cannot read is left alone.
  assert.equal(attach("gemini", { home, dryRun: true }).written, false);
  assert.throws(() => readFileSync(join(home, ".gemini", "settings.json")));
  mkdirSync(join(home, ".gemini"));
  writeFileSync(join(home, ".gemini", "settings.json"), "{ not json");
  const refused = attach("gemini", { home });
  assert.deepEqual([refused.ok, refused.reason], [false, "SETTINGS_FILE_UNREADABLE"]);
  assert.equal(readFileSync(join(home, ".gemini", "settings.json"), "utf8"), "{ not json");
  // Tools that give a hook nothing to read are named with the reason, not faked.
  assert.deepEqual([attach("kiro", { home }).reason, attach("copilot", { home }).reason], ["NO_FINAL_MESSAGE_GIVEN_TO_HOOKS", "NO_FINAL_MESSAGE_GIVEN_TO_HOOKS"]);
  assert.equal(attach("notepad", { home }).reason, "UNKNOWN_TOOL");
});

test("attach: an engine in a folder named anyhow is still known as SkeptOpus, so it never doubles and always comes out", () => {
  // SKEPTOPUS_HOME can be any folder. Before 12/11, a line was recognised by "skeptopus" in its path:
  // from a folder named otherwise, installing twice doubled it and uninstalling left it behind.
  const home = scratch("plain-");
  const engine = "/opt/tools/watcher/app/cli.mjs";
  mkdirSync(join(home, ".claude"));
  writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "node /opt/other/cli.mjs hook" }] }] } }));
  attach("claude", { home, engine });
  assert.equal(attach("claude", { home, engine }).replaced, true);
  const stop = () => JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8")).hooks.Stop;
  assert.equal(stop().length, 2, "someone else's line, and one line of SkeptOpus");
  assert.equal(status({ home, env: {}, cwd: home }).tools[0].state, "ATTACHED");
  assert.equal(detach("claude", { home }).removed, 1);
  assert.deepEqual(stop().map((g) => g.hooks[0].command), ["node /opt/other/cli.mjs hook"], "another tool's cli.mjs is not taken for ours");
});

test("test folders: made where this machine says, never relative, and gone at the end", () => {
  // A machine short of space names another disk in tests/tmp-root.local.
  const dir = scratch("where-");
  assert.ok(dir.startsWith(TEST_ROOT), dir);
  const notes = scratch("root-");
  const say = (text) => (writeFileSync(join(notes, "root.local"), text), rootFrom(join(notes, "root.local"), "FALLBACK"));
  const wanted = join(notes, "tests here");
  assert.equal(say(wanted + "\n"), wanted);
  assert.ok(existsSync(wanted), "the folder is made");
  // A folder that is not absolute on this system (D:/… under Linux) would land wherever the tests run: ignored.
  assert.equal(say("relative/folder"), "FALLBACK");
  assert.equal(say(""), "FALLBACK");
  assert.equal(rootFrom(join(notes, "missing.local"), "FALLBACK"), "FALLBACK");
});

test("open and paste: the first program present does it, and a machine with none is said as such", async () => {
  const node = process.execPath;
  // Seen under Linux on 12/11: no xdg-open, and "journal --open" crashed. Now the next program is tried, then false.
  assert.equal(await openPage("x.html", [["no-such-program-skeptopus", []], [node, ["-e", ""]]]), true);
  assert.equal(await openPage("x.html", [["no-such-program-skeptopus", []]]), false);
  // The clipboard: the first reader present answers; one that runs but fails leaves the next its chance.
  assert.equal(await clipboard([["no-such-program-skeptopus", []], [node, ["-e", "process.stdout.write('I created `a.md`.')"]]]), "I created `a.md`.");
  assert.equal(await clipboard([[node, ["-e", "process.exit(1)"]], [node, ["-e", "process.stdout.write('second')"]]]), "second");
  // A reader that ran and found nothing: empty. No reader at all: null, never "the clipboard is empty".
  assert.equal(await clipboard([[node, ["-e", "process.exit(1)"]]]), "");
  assert.equal(await clipboard([["no-such-program-skeptopus", []]]), null);
  // What the human is told then, in each language, with the page's own path.
  for (const lang of LANGS) {
    assert.ok(WORDS[lang].noOpener("/home/u/.skeptopus/journal.html").endsWith("/home/u/.skeptopus/journal.html"), lang);
    assert.match(WORDS[lang].noClipboard, /xclip.*wl-clipboard.*--text-file/, lang);
    for (const text of [WORDS[lang].noOpener("p"), WORDS[lang].noClipboard]) assert.ok(!text.includes("—"), lang + ": no em dash");
  }
});

test("hook: tells the human, never blocks, never breaks the session", () => {
  const cli = resolve("core", "cli.mjs");
  const dir = scratch("skeptopus-hook-");
  mkdirSync(join(dir, "out"));
  // Tests never write into the real journal of whoever runs them. This user has set French.
  mkdirSync(join(dir, "test-home"));
  writeFileSync(join(dir, "test-home", "config.json"), JSON.stringify({ lang: "fr" }));
  const hook = (stdin) => spawnSync(process.execPath, [cli, "hook"], { input: stdin, encoding: "utf8", env: { ...process.env, SKEPTOPUS_HOME: join(dir, "test-home") } });
  const said = hook(JSON.stringify({ hook_event_name: "Stop", cwd: dir, last_assistant_message: "Fait. J'ai créé `out/report.md`." }));
  assert.equal(said.status, 0);
  const out = JSON.parse(said.stdout);
  assert.match(out.systemMessage, /REFUSÉ/);
  assert.match(out.systemMessage, /out\/report\.md/);
  assert.equal(out.decision, undefined, "observe only");
  // Everything seen: one quiet line, and the session log is only skimmed for its first timestamp.
  writeFileSync(join(dir, "out", "report.md"), "fait");
  const log = join(dir, "session.jsonl");
  writeFileSync(log, ['{"type":"x"}', '{"type":"user","timestamp":"2020-01-01T00:00:00.000Z"}'].concat(Array(5000).fill("garbage line")).join("\n"));
  const fine = hook(JSON.stringify({ cwd: dir, transcript_path: log, last_assistant_message: "J'ai créé `out/report.md`." }));
  assert.equal(JSON.parse(fine.stdout).systemMessage, "SkeptOpus · [ VU ] 1 affirmation vérifiée");
  const quiet = hook(JSON.stringify({ cwd: dir, last_assistant_message: "Voici ce que j'en pense." }));
  assert.deepEqual([quiet.status, quiet.stdout], [0, ""]);
  // Every check is kept where the human can open it, and the page is rebuilt each time.
  const home = join(dir, "skeptopus-home");
  mkdirSync(home);
  writeFileSync(join(home, "config.json"), JSON.stringify({ lang: "fr" }));
  const kept = spawnSync(process.execPath, [cli, "hook"], {
    input: JSON.stringify({ cwd: dir, session_id: "s1", last_assistant_message: "J'ai créé `out/report.md` et `out/absent.md`." }),
    encoding: "utf8",
    env: { ...process.env, SKEPTOPUS_HOME: home },
  });
  assert.equal(kept.status, 0);
  const lines = readFileSync(join(home, "historique.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0].rows.map((r) => r.verdict + ":" + r.target), ["PROVEN:out/report.md", "NOT_PROVEN:out/absent.md"]);
  const page = readFileSync(join(home, "journal.html"), "utf8");
  assert.match(page, /REFUSÉ/);
  assert.match(page, /out\/absent\.md/);
  assert.ok(!page.includes("—"), "no em dash in anything a reader sees");
  // One page, every language; the one shown first is the user's.
  assert.match(page, /<body class="nojs alert"[^>]* data-lang="fr"/);
  assert.match(page, /C'est fait\u202f\?<\/span> <span class="nb">Fais voir\./);
  assert.match(page, /Done\?<\/span> <span class="nb">Show me\./);
  // A journal that cannot be written (here: its folder is a file) never costs the session.
  writeFileSync(join(dir, "blocked"), "x");
  const noJournal = spawnSync(process.execPath, [cli, "hook"], {
    input: JSON.stringify({ cwd: dir, last_assistant_message: "J'ai créé `out/report.md`." }),
    encoding: "utf8",
    env: { ...process.env, SKEPTOPUS_HOME: join(dir, "blocked") },
  });
  assert.equal(noJournal.status, 0);
  // No setting can be read there: English, the original language.
  assert.equal(JSON.parse(noJournal.stdout).systemMessage, "SkeptOpus · [ SEEN ] 1 claim checked");
  // Another tool: the event comes as an argument, with other field names, and plain text is wanted back.
  const other = spawnSync(process.execPath, [cli, "hook", "--from", "codex", "--out", "text", JSON.stringify({ type: "agent-turn-complete", "last-assistant-message": "I created `out/absent.md`.", cwd: dir })], {
    encoding: "utf8",
    env: { ...process.env, SKEPTOPUS_HOME: home },
    timeout: 20000,
  });
  assert.equal(other.status, 0);
  assert.match(other.stdout, /^SkeptOpus · \[ REFUSÉ \]/);
  const last = readFileSync(join(home, "historique.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).at(-1);
  assert.equal(last.source, "codex");
  const silent = spawnSync(process.execPath, [cli, "hook", "--out", "none", JSON.stringify({ text: "I created `out/absent.md`.", cwd: dir })], { encoding: "utf8", env: { ...process.env, SKEPTOPUS_HOME: home }, timeout: 20000 });
  assert.deepEqual([silent.status, silent.stdout], [0, ""]);
  const broken = hook("not json");
  assert.deepEqual([broken.status, broken.stdout], [0, ""]);
});

test("sounds: one for each answer, written by arithmetic, played only as the settings say", async () => {
  const { RATE, SOUNDS, wav } = await import("../scripts/skeptopus-make-sounds.mjs");
  assert.deepEqual(Object.keys(SOUNDS), ["proven", "not_proven", "contradicted", "could_not_check"]);
  for (const name of Object.keys(SOUNDS)) {
    // What ships is exactly what the script writes: no recording, no sample, nothing borrowed.
    const shipped = readFileSync(resolve("core", "sounds", name + ".wav"));
    assert.ok(shipped.equals(wav(name)), name + ": the shipped file is the one the script writes");
    assert.equal(shipped.toString("latin1", 0, 4) + shipped.toString("latin1", 8, 12), "RIFFWAVE");
    assert.deepEqual([shipped.readUInt16LE(20), shipped.readUInt16LE(22), shipped.readUInt32LE(24), shipped.readUInt16LE(34)], [1, 1, RATE, 16], name + ": plain 16-bit mono");
    assert.ok((shipped.length - 44) / 2 / RATE <= 0.5, name + ": half a second at most, never in the way");
    // It starts and ends in silence: no click, and never louder than two thirds of full scale.
    assert.equal(shipped.readInt16LE(44), 0);
    assert.ok(Math.abs(shipped.readInt16LE(shipped.length - 2)) < 40);
    let top = 0;
    for (let i = 44; i < shipped.length; i += 2) top = Math.max(top, Math.abs(shipped.readInt16LE(i)));
    assert.ok(top > 0.3 * 32767 && top < 0.67 * 32767, name + ": heard, not shouted");
  }
  const sounds = resolve("core", "sounds");
  const plan = (verdict, config, options = {}) => signalPlan({ verdict, rows: [] }, config, { platform: "win32", sounds, ...options });
  // Until the user says otherwise, the sound follows the window: nothing for "seen" when only problems are wanted.
  assert.deepEqual(plan("PROVEN", { notify: "problems" }), { window: false, sound: null });
  assert.deepEqual(plan("NOT_PROVEN", { notify: "problems" }), { window: true, sound: join(sounds, "not_proven.wav") });
  assert.deepEqual(plan("CONTRADICTED", { notify: "always" }), { window: true, sound: join(sounds, "contradicted.wav") });
  assert.deepEqual(plan("COULD_NOT_CHECK", { notify: "problems" }), { window: true, sound: join(sounds, "could_not_check.wav") });
  assert.deepEqual(plan("CONTRADICTED", {}), { window: false, sound: null }, "nothing is played on a machine that asked for nothing");
  // Each has its own setting: a sound for every answer without a window for every answer, or the reverse.
  assert.deepEqual(plan("PROVEN", { notify: "problems", sound: "always" }), { window: false, sound: join(sounds, "proven.wav") });
  assert.deepEqual(plan("CONTRADICTED", { notify: "always", sound: "never" }), { window: true, sound: null });
  // An answer the human was left waiting for is told even when it is good; "never" stays never.
  assert.deepEqual(plan("PROVEN", { notify: "problems" }, { whatever: true }), { window: true, sound: join(sounds, "proven.wav") });
  assert.deepEqual(plan("PROVEN", { notify: "never" }, { whatever: true }), { window: false, sound: null });
  // Elsewhere than Windows there is no window yet, but the sound is the same file. A missing file is silence, not an error.
  assert.deepEqual(plan("NOT_PROVEN", { notify: "always" }, { platform: "linux" }), { window: false, sound: join(sounds, "not_proven.wav") });
  assert.deepEqual(plan("NOT_PROVEN", { notify: "always" }, { sounds: join(sounds, "nowhere") }), { window: true, sound: null });
  assert.deepEqual(plan("NOTHING_CLAIMED", { notify: "always" }), { window: true, sound: null });
});

test("journal: the page can live in a host's own window, down to a narrow side panel", () => {
  const now = new Date("2026-11-12T15:00:00Z");
  const entries = [{ at: "2026-11-12T12:00:00Z", verdict: "PROVEN", source: "claude", cwd: "x", rows: [{ verdict: "PROVEN", kind: "FILE_WRITTEN", target: "a.md", why: "FILE_PRESENT", said: "I created `a.md`." }] }];
  // On its own, the page says nothing about a host and carries no policy.
  const plain = journalHtml(entries, now);
  assert.doesNotMatch(plain, /<body[^>]* data-embedded/);
  assert.doesNotMatch(plain, /Content-Security-Policy/);
  assert.match(plain, /<script>\s/);
  // A host says it shows the page itself: the page carries the host's policy before anything it loads, the mark the
  // host requires on its one script, and the word that makes it leave reloading to the host.
  const hosted = journalHtml(entries, now, { embedded: true, nonce: "n-1", csp: "default-src 'none'; script-src 'nonce-n-1'" });
  assert.match(hosted, /<head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-n-1'"><meta name="viewport"/);
  assert.match(hosted, /<body class="nojs" data-last="2026-11-12T12:00:00Z" data-lang="" data-embedded>/);
  assert.match(hosted, /<script nonce="n-1">\s/);
  assert.equal((hosted.match(/<script/g) ?? []).length, 1, "one script, so one mark");
  assert.match(hosted, /hosted=b\.hasAttribute\("data-embedded"\)/);
  assert.match(hosted, /if\(!hosted&&!document\.hidden&&Date\.now\(\)-loaded>15000\)location\.reload\(\)/, "a hosted page never reloads itself");
  assert.match(hosted, /if\(store\.get\("sk-seen"\)\|\|hosted\)/, "in a side panel the explanation starts closed");
  // An editor puts its own style sheet under the page (a margin around the body, its own colour for file names).
  // Seen in the real editor on 12/11: the sea stopped 20 px short of each edge. The page states both itself.
  assert.match(plain, /(?:^|\n)body\{margin:0;padding:0;/);
  assert.match(plain, /(?:^|[};\s])code\{[^}]*color:inherit;/);
  // What a host hands over is text: it cannot break out of the attribute it is written in.
  const hostile = journalHtml(entries, now, { nonce: 'x"><script>alert(1)</script>', csp: '"><i>' });
  assert.doesNotMatch(hostile, /<script>alert|"><i>/);
  assert.match(hostile, /content="&quot;&gt;&lt;i&gt;"/);
  assert.match(hostile, /<script nonce="x&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;">/);
  // A side panel is narrower than any phone. Under 340 px the name takes the whole width and the octopus stands
  // beside the slogan and the mood, instead of squeezing the text into half a line.
  assert.match(plain, /@media\(max-width:340px\)\{\.sea-in\{display:grid;[^}]*\}\.id\{display:contents\}/);
  assert.match(plain, /@media\(max-width:340px\)\{[^@]*\.brand\{[^}]*font-size:min\(48px,calc\(\(100vw - 30px\)\/4\.6\)\)/, "the name shrinks before it overflows");
  // Seen at 320 px and under on 12/11: on three lines and more, a fully round pill cut its own text in the corners.
  assert.match(plain, /\.mood\{[^}]*border-radius:27px/);
  assert.doesNotMatch(plain, /\.mood\{[^}]*border-radius:999px/);
  // The command a host calls: the page comes on standard output, with the typefaces served from where the host says,
  // and the file on disk is left as it is.
  const home = scratch("skeptopus-host-");
  writeFileSync(join(home, "config.json"), JSON.stringify({ lang: "es" }));
  writeFileSync(join(home, "historique.jsonl"), JSON.stringify(entries[0]) + "\n");
  const printed = spawnSync(process.execPath, [resolve("core", "cli.mjs"), "journal", "--print", "--embedded", "--fonts", "https://host.example/fonts/", "--nonce", "n-2", "--csp", "default-src 'none'"], { encoding: "utf8", env: { ...process.env, SKEPTOPUS_HOME: home }, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(printed.status, 0);
  assert.match(printed.stdout, /^<!doctype html><html lang="es-ES" dir="ltr">/);
  assert.match(printed.stdout, /<\/body><\/html>\s*$/);
  assert.match(printed.stdout, / data-lang="es" data-embedded>/);
  assert.match(printed.stdout, /<script nonce="n-2">/);
  assert.match(printed.stdout, /src:url\(https:\/\/host\.example\/fonts\/inter\.woff2\)/);
  assert.match(printed.stdout, /a\.md/);
  assert.equal(existsSync(join(home, "journal.html")), false, "printing writes no page on disk");
  assert.equal(existsSync(join(home, "fonts", "inter.woff2")), true, "the typefaces are put where the host will serve them from");
  // The language its reader chose in the host's window comes first, before the user's setting.
  const chosen = spawnSync(process.execPath, [resolve("core", "cli.mjs"), "journal", "--print", "--embedded", "--lang", "ar"], { encoding: "utf8", env: { ...process.env, SKEPTOPUS_HOME: home }, maxBuffer: 64 * 1024 * 1024 });
  assert.match(chosen.stdout, /^<!doctype html><html lang="ar-u-ca-gregory-nu-latn" dir="rtl">/);
});

test("glance: the state of the day in one line, for a host that has one line", () => {
  const home = scratch("skeptopus-glance-");
  const now = new Date("2026-11-12T15:00:00Z");
  const row = (verdict) => ({ verdict, kind: "FILE_WRITTEN", target: "a.md", why: "FILE_ABSENT" });
  const entry = (at, verdict, rows) => JSON.stringify({ at, verdict, rows: rows.map(row) });
  // Nothing checked yet: no worst answer, and the sentence says so.
  const empty = glance(home, now);
  assert.deepEqual([empty.checks, empty.worst, empty.last, empty.lang], [0, null, null, null]);
  assert.equal(empty.texts.en.mood, "Nothing to check so far today.");
  assert.equal(empty.texts.fr.short, "");
  // A day with everything in it. Yesterday does not count, and an answer found wrong is no longer counted.
  writeFileSync(join(home, "config.json"), JSON.stringify({ lang: "fr" }));
  writeFileSync(
    join(home, "historique.jsonl"),
    [
      entry("2026-11-11T10:00:00Z", "CONTRADICTED", ["CONTRADICTED", "CONTRADICTED", "CONTRADICTED"]),
      entry("2026-11-12T09:00:00Z", "PROVEN", ["PROVEN", "PROVEN"]),
      entry("2026-11-12T10:00:00Z", "COULD_NOT_CHECK", ["PROVEN", "COULD_NOT_CHECK"]),
      entry("2026-11-12T11:00:00Z", "NOT_PROVEN", ["NOT_PROVEN", "NOT_PROVEN"]),
      entry("2026-11-12T12:00:00Z", "CONTRADICTED", ["CONTRADICTED"]),
    ].join("\n") + "\n",
  );
  const day = glance(home, now);
  assert.deepEqual([day.checks, day.seen, day.refused, day.against, day.blind, day.worst], [4, 3, 2, 1, 1, "CONTRADICTED"]);
  assert.deepEqual([day.lang, day.last, day.lastVerdict, day.home], ["fr", "2026-11-12T12:00:00Z", "CONTRADICTED", home]);
  // Every language is given, each in its own form; French keeps its thin spaces.
  assert.deepEqual(Object.keys(day.texts), LANGS);
  assert.equal(day.texts.en.short, "contradicted: 1");
  assert.equal(day.texts.fr.short, "contredits : 1");
  assert.equal(day.texts.zh.short, "不属实：1");
  assert.equal(day.texts.ar.short, "خلاف الواقع: 1");
  assert.equal(day.texts.es.word, "DESMENTIDO");
  assert.equal(day.texts.fr.mood, "Aujourd'hui : 1 contredit et 2 refusés. À regarder.");
  // The contradiction turns out to be SkeptOpus's own mistake: the worst answer of the day is the next one down.
  writeFileSync(join(home, "errata.json"), JSON.stringify({ "2026-11-12T12:00:00Z": "wrong alarm" }));
  const after = glance(home, now);
  assert.deepEqual([after.against, after.worst, after.texts.en.short], [0, "NOT_PROVEN", "not found: 2"]);
  // The page shows the same figures: one source for both.
  assert.deepEqual(dayOf([{ at: "2026-11-12T09:00:00Z", rows: [row("PROVEN")] }], now), { checks: 1, seen: 1, refused: 0, against: 0, blind: 0, worst: "PROVEN" });
  // And the same sentence, in each of its three forms. Seen on a capture on 12/11: the page said "nothing to check"
  // above tiles that counted 170 things seen, and no test had read that sentence in the page.
  const moodIn = (entries, lang) => />([^<]*)<\/p><\/div>\s*<div class="hero">/.exec(journalHtml(entries, now, { lang }).split('data-lang="' + lang + '"')[2])?.[1];
  const some = (verdicts) => [{ at: "2026-11-12T09:00:00Z", verdict: verdicts[0], rows: verdicts.map(row) }];
  assert.equal(moodIn(some(["CONTRADICTED", "NOT_PROVEN", "NOT_PROVEN"]), "en"), "Today: 1 contradicted and 2 not found. Worth a look.");
  assert.equal(moodIn(some(["PROVEN", "PROVEN", "PROVEN"]), "en"), "Today: 3 things seen, nothing to report.");
  assert.equal(moodIn([], "en"), "Nothing to check so far today.");
  assert.equal(moodIn(some(["CONTRADICTED"]), "fr"), "Aujourd'hui : 1 contredit. À regarder.");
  for (const lang of LANGS) assert.equal(moodIn(some(["NOT_PROVEN"]), lang), lang === "fr" ? glance(home, now).texts.fr.mood.replace(/\d+ refusés/, "1 refusé") : PAGE[lang].moodAlert(0, 1), lang);
  // The command: a sentence for a human, the whole thing for a host. It reads the clock, so it gets its own folder
  // and today's real date: on entries dated 12/11 this part failed after midnight (found on 13/11).
  const cli = resolve("core", "cli.mjs");
  const live = scratch("skeptopus-glance-cli-");
  writeFileSync(join(live, "config.json"), JSON.stringify({ lang: "fr" }));
  const env = { ...process.env, SKEPTOPUS_HOME: live };
  // A host that reads the clipboard itself hands the text in a file: checked and kept like any copied answer.
  const said = join(live, "said.txt");
  writeFileSync(said, "I created `nowhere/at-all.md`.");
  const clip = spawnSync(process.execPath, [cli, "clip", "--text-file", said, "--cwd", live], { encoding: "utf8", env });
  assert.equal(clip.status, 0);
  assert.match(clip.stdout, /REFUSÉ/);
  const last = readFileSync(join(live, "historique.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).at(-1);
  assert.deepEqual([last.source, last.verdict, last.rows[0].target], ["clipboard", "NOT_PROVEN", "nowhere/at-all.md"]);
  assert.equal(spawnSync(process.execPath, [cli, "glance"], { encoding: "utf8", env }).stdout, "Aujourd'hui : 1 refusé. À regarder.\n");
  assert.equal(JSON.parse(spawnSync(process.execPath, [cli, "glance", "--json"], { encoding: "utf8", env }).stdout).home, live);
});
