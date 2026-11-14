// SkeptOpus core / reading what an agent actually claims. Pure: no file, no network, no clock.
//
// Lesson from auditing 186 real "done" entries (2026-11-12): checking a state without
// understanding the sentence gives false alarms. "PR closed without merge" is not a failed
// merge claim. So every claim carries its polarity, and a vague "done" is reported as vague
// instead of being waved through.
//
// Lessons from the first run on a real session (same day), each now a test:
// - French "poussé" also means "elaborate": it only counts next to a git word.
// - What the agent quotes is somebody else's sentence, not its own claim.
// - "ce test", "un test" are figures of speech; a claim is about THE tests.
// - A file the agent points you to must exist, whatever verb surrounds the link.

const strip = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// A sentence that announces, asks or supposes is not a claim about the present.
const NOT_NOW = new RegExp(
  "\\b(will|going to|gonna|should|would|could|need to|needs to|todo|to do|plan to|let me|if you|once you|" +
    "je vais|on va|il faut|faudra|reste a|a faire|a prevoir|pourrai[st]?|pourra|devra|des que|quand tu|si tu|" +
    "je peux|tu peux|on peut|je propose|je recommande|je garderais|voudrais)\\b|" +
    // French future and conditional: "je redessinerai", "on poussera", "il faudrait".
    "\\b(?:je|j'|tu|on|il|elle|nous|vous|ils|elles)\\s+(?:\\w+\\s+)?\\w{3,}(?:erai|erais|erait|era|eras|erons|eront|irai|irais|irait|ira|irons|iront|rai|rais|rait|rons|ront)\\b",
);
// Spanish, Chinese and Arabic are read too. Written by a non-native author: corrections from readers whose language
// it is are welcome. Arabic words have
// no \b edge in JavaScript: an Arabic word is bounded by "no Arabic letter around", and may carry "و" or "ف" (and, so).
const AR = "\\u0600-\\u06FF";
const arWord = (words) => "(?<![" + AR + "])[وف]?(?:" + words + ")(?![" + AR + "])";
// Arabic brought to one spelling, the way accents are dropped above: vowel marks and the stretching stroke go
// (NFD has already parted the hamza from its seat), and the forms of alif, ya and ta marbuta become one.
const plain = (s) => strip(s).replace(/[ً-ٰٟـ]/g, "").replace(/ٱ/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه");
const NEGATION = new RegExp(
  "\\b(no|not|never|without|nothing|none|aucun|aucune|pas|sans|jamais|ni|non|rien|sin|nunca|ningun|ninguna|ninguno|nada|tampoco)\\b|n't\\b|" +
    "没有|没|未|尚未|还没|并未|无法|不能|不是|不再|不通过|不存在|" +
    arWord("لم|لا|لن|ليس|ليست|لست|بدون|دون|غير"),
);
// The same as NOT_NOW below, in Spanish, Chinese and Arabic: what is planned, wished, conditional or for later.
const LATER_I18N = new RegExp(
  "\\b(voy a|vamos a|hay que|habra que|tengo que|tenemos que|pendiente|despues|manana|mas tarde|por hacer|podria|podriamos|deberia|deberiamos|propongo|te propongo|si quieres|quieres que)\\b|" +
    "将要|将会|打算|稍后|待会|之后再|下一步|还需要|需要再|明天|如果|要不要|是否需要|等.{0,12}之后|" +
    arWord("سوف|سنقوم|يجب|ينبغي|علينا|لاحقا|غدا|اذا|لو|هل"),
);
// "سأفعل", I will: a prefix of the verb, looked for before spelling is made plain ("سا" plain starts many words).
const WILL_AR = /(?<![؀-ۿ])سأ[؀-ۿ]{2,}/;
const QUOTED = /«[^»]*»|“[^”]*”|"[^"\n]{2,}"|「[^」]*」|『[^』]*』/g;

const PATH_EXT =
  "md|mdx|txt|json|jsonl|ya?ml|toml|ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|kt|rb|php|sh|ps1|css|scss|html|svg|png|jpe?g|gif|pdf|csv|sql|lock";
const BARE_PATH = new RegExp("(?:[A-Za-z]:[\\\\/])?[\\w.@~\\-\\\\/]*[\\w\\-]\\.(?:" + PATH_EXT + ")\\b", "g");
const SHA = /\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*[0-9])[0-9a-f]{7,40}\b/g;
// About one short identifier in twenty-seven is made of digits only (and a few of letters only). Alone, such a
// token could be a number or a word, so it counts only where the sentence itself marks it as an identifier:
// between backticks, or right after the word "commit". Found on 2026-11-12 by a test that failed one run in twenty.
const SHA_MARKED = /`([0-9a-f]{7,40})`|\bcommit(?:ted|te|tes|e|es|s)?\s+([0-9a-f]{7,40})\b/g;
const LINK = /\]\(([^)\s]+)\)/g;

const WRITE_VERB =
  /\b(created?|wrote|written|added|updated|modified|saved|generated|rendered|cree[es]?|ecrit[es]?|ajoute[es]?|modifie[es]?|enregistre[es]?|genere[es]?|redessine[es]?|rendu[es]?|range[es]?)\b/;
const WRITE_VERB_I18N = new RegExp(
  "\\b(he creado|creado|creada|creados|escribi|escrito|anadi|anadido|actualice|actualizado|modifique|modificado|guarde|guardado|genere|generado|edite|editado)\\b|" +
    "创建了|新建了|写入了|写好了|写了|添加了|加了|更新了|修改了|改了|保存了|生成了|编辑了|已创建|已写入|已添加|已更新|已修改|已保存|已生成|" +
    arWord("انشات|كتبت|اضفت|حدثت|عدلت|حفظت|ولدت") + "|تم (?:انشاء|حفظ|تحديث|تعديل)|تمت (?:كتابه|اضافه)",
);
const NEG_BEFORE_COMMIT = new RegExp(
  "(?:\\b(?:no|not|never|without|nothing|none|aucun|aucune|pas|sans|jamais|ni|non|rien|sin|nunca|ningun)\\b|n't\\b)[^.]{0,30}\\bcommit|" +
    "(?:没有|没|未|尚未|还没|并未)(?:做)?提交|" +
    arWord("لم|لا|لن|بدون|دون") + "[^.]{0,30}commit",
);
// "提交" is how Chinese says commit: with an identifier beside it, as "commit" is read in every language.
const COMMIT_VERB = /\b(committed|commite[es]?|commit(?:te)?[es]?\s+(?:local|fait|effectue)|commit\b)|提交/;
// A commit said without its identifier.
const COMMITTED_WORD = /\b(committed|commite[es]?|commitead[oa]s?|commit hecho|hice (?:el |un )?commit)\b|已提交代码|提交了代码|代码已提交|تم ال ?commit/;
const PUSH_VERB = /\b(pushed|push\s+(?:fait|effectue|done)|envoye[es]?\s+sur\s+(?:origin|github|le\s+depot))\b/;
const PUSH_I18N = /\b(push hecho|hice (?:el )?push|pushead[oa]s?|pushee|subid[oa]s? (?:a|al) (?:origin|github|gitlab|remoto|la rama))\b|已推送|推送了|已经推送|推到了|推上去了|已 ?push|push ?了|تم ال ?push/;
// "رفعت" also means "I raised": like French "poussé", it counts only next to a git word.
const PUSH_LOOSE_AR = new RegExp("تم (?:رفع|دفع)|" + arWord("رفعت|دفعت"));
const PUSH_FR = /\bpousse[es]?\b/;
const GIT_WORD = /\b(git|origin|github|gitlab|remote|distant|branche|branch|depot|repo|commit|main|master|rama|repositorio|remoto)\b|远程|分支|仓库|الفرع|المستودع/;
const PUSH_NOUN = /\bpush\b|推送/;
const PR = /(?:\b(?:pr|pull request|demande de fusion|solicitud de fusion)|合并请求|طلب الدمج)\s*#?\s*(\d{1,6})\b/;
const MERGED = new RegExp("\\b(merged|fusionne[es]?|fusionad[ao]s?|mergead[ao]s?)\\b|已合并|合并了|已合入|合入了|" + arWord("دمج|دمجت|دمجه|دمجها|مدموج|مدموجه"));
const MERGE_NOUN = /\b(merge|fusion)\b|合并|دمج/;
const OPENED = new RegExp("\\b(opened|ouverte?s?|abiert[ao]s?|abri)\\b|已创建|创建了|开了|提了|发起了|已打开|" + arWord("فتحت|فتح|مفتوح|مفتوحه"));
// A request is often named without the word: by its number alone ("#172 est fusionnée", "j'ai fusionné #165")
// or by its link ("fusionnée ([184](https://github.com/o/r/pull/184))"). On 2026-11-12 these were 7 of the 11
// real misses found by reading 150 unread sentences of a day of real sessions.
const PULL_URL = /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d{1,6})\b/g;
const BARE_NUMBER = /(?<![\w/&])#(\d{2,6})\b/g;
const NEAR = 48;
// A number alone must touch its verb: "#172 est fusionnée", "j'ai fusionné #165", "#174 n'est pas encore
// fusionnée". In "note sur #120 : la PR est fusionnée", #120 is an issue that merely stands in the same sentence.
const MERGED_RIGHT_AFTER = new RegExp(
  "^\\s*(?:(?:est|sont|a ete|ont ete|vient d['’]etre|n['’]est|ne sont|n['’]a|pas|encore|toujours|deja|bien|maintenant|jamais|is|are|was|were|has been|have been|got|just|now|not|yet|never|isn['’]t|wasn['’]t|hasn['’]t|esta|estan|fue|fueron|ya|ha sido|han sido|quedo|todavia|aun|no)\\s+){0,4}(?:merged|fusionne[es]?|fusionad[ao]s?|mergead[ao]s?)\\b|" +
    "^\\s*(?:已经|已|也已|还没有?|尚未|没有|没|未)?(?:被)?(?:合并|合入)|" +
    "^\\s*(?:تم|تمت|لم يتم)?\\s*(?:دمجه|دمجها|دمج)(?![" + AR + "])|^\\s*(?:مدموج|مدموجه)(?![" + AR + "])",
);
const MERGED_RIGHT_BEFORE = new RegExp(
  "\\b(?:merged|fusionne[es]?|fusione|fusionamos|fusionad[ao]s?|mergee|mergead[ao]s?)\\s+(?:(?:la|le|les|el|los|the|pr|demande|request|solicitud)\\s+)?[([]?\\s*$|" +
    "(?:合并了|合入了|已合并|已合入)\\s*[([]?\\s*$|" +
    "(?<![" + AR + "])(?:دمجت|تم دمج)\\s+[([]?\\s*$",
);
// "Une fois #174 fusionnée", "once #12 is merged", "si la demande est fusionnée": a condition, not a report.
// Seen on 2026-11-12: "le tableau ne le comptera qu'une fois #174 fusionnée" would have been read as a merge.
const CONDITION = new RegExp(
  "\\b(une fois|once|quand|lorsque|des que|as soon as|until|jusqu['’]a ce que|avant que|before|si|if|una vez|cuando|en cuanto|hasta que|antes de que)\\b|" +
    "一旦|等到|如果|只要|之前|" +
    arWord("عندما|حين|بمجرد|اذا|لو|حالما|قبل ان"),
);
// Clauses end at a comma, a semicolon, a colon (not the one of "https://"), or at "mais", "but", "et", "and";
// Chinese and Arabic commas and semicolons too.
const CUT = /[,;，；、،؛]|[:：](?!\/\/)|\s(?:mais|but|et|and|pero|لكن)\s|但是|不过/g;
/**
 * The requests a sentence says were merged or opened, when it names them by link or by number alone.
 * A link says which repository and that it is a request, so it can carry "opened" as well as "merged",
 * and its verb may stand a few words away. A number alone could be an issue: it only counts when it touches
 * "merged", which only a request can be. What denies the verb, or makes it a condition, stands in its own clause
 * ("sans conflit, la demande est fusionnée" denies nothing about the merge).
 */
function requestsNamed(flat) {
  const refs = new Map();
  const clauseStart = (pos) => {
    let start = 0;
    for (const m of flat.slice(0, pos).matchAll(CUT)) start = m.index + m[0].length;
    return start;
  };
  // The verb nearest to a reference, before or after it: its kind, and what its own clause says of it.
  const nearest = (at, end) => {
    const found = [];
    for (const [kind, re] of [["PR_MERGED", MERGED], ["PR_OPENED", OPENED]]) {
      const from = Math.max(0, at - NEAR);
      for (const m of flat.slice(from, at).matchAll(new RegExp(re.source, "g"))) found.push({ kind, pos: from + m.index, len: m[0].length, distance: at - (from + m.index + m[0].length) });
      const a = re.exec(flat.slice(end, end + NEAR));
      if (a) found.push({ kind, pos: end + a.index, len: a[0].length, distance: a.index });
    }
    if (!found.length) return null;
    found.sort((x, y) => x.distance - y.distance || (x.kind === "PR_MERGED" ? -1 : 1));
    const verb = found[0];
    const clause = flat.slice(clauseStart(verb.pos), verb.pos + verb.len);
    return { kind: verb.kind, negated: NEGATION.test(clause), conditional: CONDITION.test(clause) };
  };
  for (const m of flat.matchAll(PULL_URL)) {
    const verb = nearest(m.index, m.index + m[0].length);
    if (!verb || verb.conditional || CONDITION.test(flat.slice(clauseStart(m.index), m.index))) continue;
    refs.set(m[2], { pr: Number(m[2]), repo: m[1], kind: verb.kind, negated: verb.negated });
  }
  for (const m of flat.matchAll(BARE_NUMBER)) {
    if (refs.has(m[1])) continue;
    const end = m.index + m[0].length;
    const follows = MERGED_RIGHT_AFTER.exec(flat.slice(end, end + NEAR));
    const precedes = follows ? null : MERGED_RIGHT_BEFORE.exec(flat.slice(Math.max(0, m.index - NEAR), m.index));
    if (!follows && !precedes) continue;
    const clause = flat.slice(clauseStart(m.index), follows ? end + follows[0].length : m.index);
    if (CONDITION.test(clause)) continue;
    refs.set(m[1], { pr: Number(m[1]), kind: "PR_MERGED", negated: NEGATION.test(clause) });
  }
  return [...refs.values()];
}
// A commit said in plain words, the way one speaks to someone who does not code: "Enregistré dans le projet
// (version `58090f0`)". The sentence must say "enregistré", and the identifier must be written as one,
// between backticks: "version" alone names too many other things.
const SAVED = /\b(enregistre[es]?|enregistrement)\b/;
const PLAIN_COMMIT = /\b(enregistre[es]?|enregistrement|version)\b/;
const MARKED_ID = /`([0-9a-f]{7,40})`/g;
// "La suite" is French for "what comes next". Alone it is not a test suite: on 2026-11-12, "la suite se passe
// dans la session neuve" was read as passing tests, and the whole suite was run again for nothing. It counts
// with the word "tests", or the way English says it ("the suite", "the test suite").
const SUITE = "(?:the|full|whole|entire|unit|integration|e2e|test)\\s+suites?|suites?\\s+de\\s+tests?";
const TEST_WORD = new RegExp("\\b(?:tests|specs|" + SUITE + ")\\b");
const TESTS_OK = new RegExp("\\b(?:tests|specs|" + SUITE + ")\\b[^.]{0,48}\\b(pass|passes|passed|passing|green|passent|passe|verts?|vertes?|reussis?|reussies?)\\b");
// The same in Spanish, Chinese and Arabic.
const TEST_WORD_I18N = /\b(?:pruebas|tests)\b|测试|单测|用例|اختبار/;
const TESTS_OK_I18N = new RegExp(
  "\\b(?:tests|pruebas)\\b[^.]{0,48}\\b(pasan|pasa|pasaron|en verde|verdes|correct[ao]s|exitos[ao]s)\\b|\\b(?:pasan|pasaron)\\s+(?:todos\\s+|todas\\s+)?(?:los\\s+|las\\s+)?(?:\\d+\\s+)?(?:tests|pruebas)\\b|" +
    "(?:测试|单测|用例)[^。；]{0,24}(?:通过|都过了|全过|全绿|变绿)|(?:通过|跑通)了?(?:全部|所有)?的?(?:测试|单测|用例)|" +
    "(?:الاختبارات|اختبارات|اختبارا|الاختبار)[^.]{0,40}(?:ناجحه|ناجح|نجحت|تنجح|تمر|مرت|خضراء|سليمه)|" +
    arWord("نجحت|نجح|مرت|تمر") + "[^.]{0,24}(?:الاختبارات|اختبارات|اختبارا)",
);
// "45 tests passent": the number said is the number to find again. "The tests" are the ones the user declared:
// when they are not that many, they may not be the tests the agent spoke of (another project's, a browser suite).
const TEST_COUNT = new RegExp("\\b(\\d{1,5})\\s+(?:tests|specs|pruebas)\\b|(\\d{1,5})\\s*(?:个|项)?\\s*(?:测试|单测|用例)|(\\d{1,5})\\s*(?:اختبارا|اختبارات|اختبار)(?![" + AR + "])");
// "Only 2 of the 14 tests pass", "seuls 3 tests passent": a part of them, said as such. Nothing to catch.
const PART_OF = new RegExp(
  "\\b(of the|out of|sur les|parmi|only|seulement|seuls?|dont|solo|solamente|unicamente|de los|de las)\\b|\\d+\\s+de\\s+(?:los\\s+|las\\s+)?\\d+|" +
    "部分|只有|仅|其中|" +
    arWord("فقط|بعض") + "|من اصل|من بين|\\d+\\s+من\\s+\\d+",
);
// "94/94", "94 sur 94", and the spoken form "94 tests hors ligne sur 94".
const RATIO = /\b(\d{1,5})\s*((?:[a-z]+\s+){0,3})(?:\/|sur|of|out of)\s*(\d{1,5})\b/g;
const TEST_NOUN = /\b(tests?|checks?|controles?|specs?|suites?|pruebas?)\b|测试|اختبار/;
/** A ratio is about tests when it names them ("82 tests sur 82") or follows them closely ("tests : 94/94"). */
/** A full count that is not about tests ("11 protections sur 11"): announced, so it must be answered for. */
function otherFullCounts(flat) {
  const out = [];
  for (const m of flat.matchAll(RATIO)) {
    const a = Number(m[1]), b = Number(m[3]);
    if (b < 2 || a !== b || !m[2].trim() || TEST_NOUN.test(m[2])) continue;
    out.push(m[0]);
  }
  return out;
}
function testRatios(flat) {
  const out = [];
  for (const m of flat.matchAll(RATIO)) {
    if (Number(m[3]) === 0) continue;
    const about = m[2].trim() ? TEST_NOUN.test(m[2]) : TEST_NOUN.test(flat.slice(Math.max(0, m.index - 32), m.index));
    if (about) out.push({ passed: Number(m[1]), total: Number(m[3]) });
  }
  return out;
}
// Blind spots closed on 2026-11-12: things an agent announces that live outside the working folder.
const COMMENT_URL = /https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(?:issues|pull)\/(\d+)#issuecomment-(\d+)/g;
const COMMENT_ID = /(?:\b(?:commentaires?|entrees?|checkpoints?|comments?|entry|entries|comentarios?|entradas?)\b|评论|留言|تعليق)[^.;。]{0,40}?\b(\d{9,11})\b/g;
const REPO_MADE = new RegExp(
  "\\b(?:cree[es]?|created?)\\b[^.;]{0,60}\\b(?:depot|repo|repository)\\b|\\b(?:depot|repo|repository)\\b[^.;]{0,60}\\b(?:cree[es]?|created)\\b|" +
    "\\b(?:cree|creado|he creado)\\b[^.;]{0,60}\\brepositorio\\b|\\brepositorio\\b[^.;]{0,60}\\bcreado\\b|" +
    "(?:创建了|新建了|建了)[^。；]{0,20}仓库|仓库[^。；]{0,10}(?:已创建|创建好了)|(?:انشات|تم انشاء)[^.]{0,40}المستودع",
);
const REPO_NAME = /`([\w.-]+(?:\/[\w.-]+)?)`|\b([\w-]+\/[\w.-]+)\b/;
const PRIVATE = new RegExp("\\b(prive[es]?|private|privad[oa]s?)\\b|私有|" + arWord("خاص"));

// ---------- where a push went, and where a comment was posted ----------
// Found on 2026-11-13 on a real message, checked through the MCP tool. Shaped like "Pushed to origin: acme/a main is now
// 5f3c2a91b, acme/b main is now 7b1e4d06a, acme/c main is now c9a40e7d3. Comment posted on acme/d issue #128.", it was
// read as ONE push with no target, checked on a local folder the sentence never named (it had no remote), and stamped
// CONTRADICTED; the comment was not read at all. The three pushes were on GitHub, at those very commits. Now each
// repository named is a push of its own, checked on that repository, and a comment said to be posted on a named issue
// is a claim of its own.
const OWNER = "[A-Za-z0-9][A-Za-z0-9-]{0,38}";
const REPO_PART = "[A-Za-z0-9._-]{1,100}";
// "owner/repo", where neither half belongs to a path or a link ("C:/work/x", "github.com/o/r" is read just below).
const OWNER_REPO = new RegExp("(?<![\\w.\\/\\\\:@#~-])(" + OWNER + ")\\/(" + REPO_PART + ")(?![\\w\\/\\\\-])", "g");
// A link names its repository too, and what follows may give the commit or the branch.
const GITHUB_LINK = new RegExp("\\bgithub\\.com\\/(" + OWNER + ")\\/(" + REPO_PART + ")(\\/[^\\s<>\"'`)\\]]*)?", "gi");
// Words that open a branch name or a folder, not a GitHub account: "claude/fix-x", "feat/login", "origin/main", "src/app".
const NOT_AN_OWNER = new Set(
  (
    "origin upstream refs heads remotes remote tags head feat feature features fix fixes bugfix hotfix release releases chore docs doc " +
    "refactor test tests ci build perf style wip dev devel develop experiment exp spike topic revert deps dependabot renovate " +
    "claude codex cursor copilot devin gemini grok jules agent agents bot bots user users src lib libs app apps packages pkg " +
    "core scripts script public dist tmp temp data assets vendor node_modules config bin out tools and or et ou yes no on off true false"
  ).split(" "),
);
const FILE_LIKE = new RegExp("\\.(?:" + PATH_EXT + ")$", "i");
const isSha = (s) => /^[0-9a-f]{7,40}$/i.test(s) && /[a-f]/i.test(s) && /\d/.test(s);
const SHA_ANYCASE = /\b(?=[0-9a-fA-F]*[a-fA-F])(?=[0-9a-fA-F]*[0-9])[0-9a-fA-F]{7,40}\b/g;
// Where the words about one repository end: a comma, a semicolon, a colon (not the one of "https://"), a bracket, "and".
const TARGET_CUT = /[,;，；、،؛]|[:：](?!\/\/)|[()（）[\]]|\s(?:but|mais|et|and|pero|sino|then|puis)\s|但是|不过|而且|并且/g;
const BRANCH = "[A-Za-z0-9_][\\w./-]*";
const IS_NOW = "(?:is now at|is now|is at|now at|now|at|points to|->|→|=>|=|:|est maintenant à|est maintenant a|est maintenant|est à|est a|pointe sur|esta ahora en|está ahora en|esta en|está en|ahora en|ahora es)";
// "main is now 5f3c2a91b", "main → 5f3c2a9", "main est maintenant à 5f3c2a91b": the branch, then the commit it points to.
const BRANCH_THEN_SHA = new RegExp("^[\\s)\\]`'\":]*(" + BRANCH + ")[`'\"]?\\s*" + IS_NOW + "\\s*[`'\"]?([0-9a-fA-F]{7,40})\\b", "i");
// "owner/repo: 5f3c2a91b", "owner/repo (5f3c2a91b)", "owner/repo 5f3c2a91b": the commit right after the name.
const SHA_RIGHT_AFTER = new RegExp("^[\\s(\\[`'\"]*(?:" + IS_NOW + "\\s*[`'\"]?)?([0-9a-fA-F]{7,40})\\b", "i");
const BRANCH_WORD = new RegExp("\\b(?:branch|branche|rama)\\s+[`'\"]?(?:refs\\/heads\\/)?(" + BRANCH + ")", "i");
const REFS_HEADS = new RegExp("\\brefs\\/heads\\/(" + BRANCH + ")");
const LONE_BRANCH = /^\s*[`'"]?(main|master|develop|dev|trunk|gh-pages|staging|production)[`'"]?\s*$/i;
const NOT_A_BRANCH = new Set("is was are now at to on in the a an de du la le les est sur en es esta and et or ou branch branche rama ref head commit version".split(" "));
// "Pushed to acme/receipts", "poussé sur le dépôt acme/x": the push goes to the repository named right after.
const PUSHED_TO = /(?:\b(?:to|onto|into|on|sur|vers|dans|a|al|hacia)|à)\s+(?:(?:the|le|la|les|l['’]|el|my|our|mon|notre)\s*)?(?:(?:repo|repository|depot|dépôt|repositorio|remote)\s+)?[`'"[]?\s*$/i;
// French "poussé" and Arabic "رفعت" count next to a git word, or next to a repository named ("poussé sur acme/x").
const pushVerb = (c) => PUSH_VERB.test(c) || PUSH_I18N.test(c) || ((PUSH_FR.test(c) || PUSH_LOOSE_AR.test(c)) && (GIT_WORD.test(c) || repositoriesNamed(c).length > 0));
const trimRef = (s) => String(s).replace(/[.,;:!?]+$/, "");
// Polarity is judged without the names a sentence carries: "acme/no-regrets", a commit, a path, or a branch the
// sentence names ("fix-not-found") deny nothing. "non-fusionnée" still denies, and so does "not." at the end.
const namesOut = (s, names = []) =>
  names
    .filter(Boolean)
    .reduce((t, n) => t.split(n.toLowerCase()).join(" "), s)
    .replace(/[.!?,;:]+(?=\s|$)/g, " ")
    .replace(/[A-Za-z0-9_\/.'-]*[\/_.\d][A-Za-z0-9_\/.'-]*/g, " ");
// Whether a push is denied is read on its own words: a branch, a flag or code holding a "no" ("fix-not-found",
// "no-cache", "--no-verify", `not-ready`) denies nothing, while a compound that carries the push itself ("non-poussée")
// still does. Found on 2026-11-13: "Pushed fix-not-found to origin." was read as "did NOT push", and a push the remote
// really held came back CONTRADICTED.
const pushWords = (s, names = []) =>
  namesOut(s.replace(/`[^`]*`/g, " "), names).replace(/[A-Za-z0-9_'-]*-[A-Za-z0-9_'-]*/g, (t) => (/push|pousse|envoye/.test(t) ? t : " "));

/** Every GitHub repository a sentence names, by "owner/repo" or by link, with where it stands in the sentence. */
function repositoriesNamed(sentence) {
  const found = [];
  for (const m of sentence.matchAll(GITHUB_LINK)) {
    const name = trimRef(m[2]).replace(/\.git$/i, "");
    const end = m.index + m[0].length - (m[3] ?? "").length - (m[2].length - trimRef(m[2]).length);
    if (name) found.push({ at: m.index, end, repo: m[1] + "/" + name, rest: m[3] ?? "", link: true });
  }
  for (const m of sentence.matchAll(OWNER_REPO)) {
    if (found.some((f) => m.index < f.end + (f.rest?.length ?? 0) && m.index + m[0].length > f.at)) continue;
    const owner = m[1];
    const raw = trimRef(m[2]);
    const name = raw.replace(/\.git$/i, "");
    if (owner.length < 2 || !name || NOT_AN_OWNER.has(owner.toLowerCase()) || /^\d+$/.test(owner) || /^\d+$/.test(name) || FILE_LIKE.test(name)) continue;
    found.push({ at: m.index, end: m.index + owner.length + 1 + raw.length, repo: owner + "/" + name, rest: "", link: false });
  }
  return found.sort((a, b) => a.at - b.at);
}
/** The same sentence with the repositories named blanked out, so that their names are not read as commits or words. */
const blank = (sentence, found) => found.reduce((s, f) => s.slice(0, f.at) + " ".repeat(f.end - f.at) + s.slice(f.end), sentence);
function cutsOf(sentence) {
  const spans = [];
  let start = 0;
  for (const m of sentence.matchAll(TARGET_CUT)) {
    spans.push([start, m.index]);
    start = m.index + m[0].length;
  }
  spans.push([start, sentence.length]);
  return spans;
}

/**
 * The GitHub repositories a push sentence names, one push each, with the commit and the branch its own words give.
 * A repository counts as the place pushed to when its own clause gives a commit ("main is now 5f3c2a91b", "@5f3c2a9",
 * a link to the commit), or when the push goes to it ("pushed to acme/receipts"). Anything else ("see
 * acme/docs", "the bug reported in acme/other") is a repository spoken of, not where the push went.
 */
function pushTargets(sentence) {
  const found = repositoriesNamed(sentence).filter((f) => !f.link || !f.rest || /^\/?(?:\.git\b|tree\/|commits?\/)/i.test(f.rest) || f.rest === "/");
  if (!found.length) return [];
  const cuts = cutsOf(sentence);
  const masked = blank(sentence, found);
  const targets = new Map();
  for (const f of found) {
    const [from, to] = cuts.find(([a, b]) => f.at >= a && f.at < b) ?? [0, sentence.length];
    let sha;
    let branch;
    if (f.link) {
      const commit = /^\/commits?\/([0-9a-f]{7,40})/i.exec(f.rest);
      if (commit && isSha(commit[1])) sha = commit[1].toLowerCase();
      const tree = /^\/tree\/(\S+)/.exec(f.rest);
      if (tree) branch = trimRef(tree[1]);
    }
    const after = sentence.slice(f.end);
    const direct = /^[@:]([\w./-]+)/.exec(after);
    if (direct) {
      const token = trimRef(direct[1]);
      if (isSha(token)) sha ??= token.toLowerCase();
      else if (!NOT_A_BRANCH.has(token.toLowerCase())) branch ??= token;
    }
    const then = BRANCH_THEN_SHA.exec(after);
    if (then && isSha(then[2])) {
      sha ??= then[2].toLowerCase();
      const b = trimRef(then[1]);
      if (!NOT_A_BRANCH.has(b.toLowerCase()) && !isSha(b)) branch ??= b;
    }
    const right = SHA_RIGHT_AFTER.exec(after);
    if (right && isSha(right[1])) sha ??= right[1].toLowerCase();
    // The commit written in the same clause, nearest to the name: after it first ("acme/x is now at …"), else before.
    const clause = masked.slice(from, to);
    if (!sha) {
      const near = [...clause.matchAll(SHA_ANYCASE)].map((m) => ({ sha: m[0].toLowerCase(), at: from + m.index })).sort((a, b) => (a.at > f.at) === (b.at > f.at) ? Math.abs(a.at - f.at) - Math.abs(b.at - f.at) : a.at > f.at ? -1 : 1);
      if (near.length) sha = near[0].sha;
    }
    if (!branch) {
      const b = BRANCH_WORD.exec(clause) ?? REFS_HEADS.exec(clause);
      if (b && !NOT_A_BRANCH.has(trimRef(b[1]).toLowerCase())) branch = trimRef(b[1]);
    }
    const said = plain(sentence.slice(from, to));
    const goesTo = pushVerb(said) && PUSHED_TO.test(sentence.slice(from, f.at));
    if (!sha && !goesTo && !(f.link && pushVerb(said))) continue;
    const negated = NEGATION.test(pushWords(plain(masked.slice(from, to)), [branch]));
    const key = f.repo.toLowerCase();
    const had = targets.get(key);
    targets.set(key, { repo: had?.repo ?? f.repo, sha: had?.sha ?? sha, branch: had?.branch ?? branch, negated: had ? had.negated : negated });
  }
  const list = [...targets.values()];
  // One repository only: the commit and the branch may stand anywhere in the sentence ("pushed to acme/x (main, 5f3c2a9)").
  if (list.length === 1) {
    const [only] = list;
    if (!only.sha) {
      const all = [...new Set([...masked.matchAll(SHA_ANYCASE)].map((m) => m[0].toLowerCase()))];
      if (all.length === 1) only.sha = all[0];
    }
    if (!only.branch) {
      const b = BRANCH_WORD.exec(masked) ?? REFS_HEADS.exec(masked);
      const lone = cuts.map(([a, z]) => LONE_BRANCH.exec(masked.slice(a, z))).find(Boolean);
      if (b && !NOT_A_BRANCH.has(trimRef(b[1]).toLowerCase())) only.branch = trimRef(b[1]);
      else if (lone) only.branch = lone[1];
    }
  }
  return list.map((t) => ({ repo: t.repo, ...(t.branch ? { branch: t.branch } : {}), ...(t.sha ? { sha: t.sha } : {}), negated: t.negated }));
}

// "Comment posted on acme/tools issue #128": a comment said to be posted on a named issue, with no
// link to the comment itself (that one is read above, by its number). Read on the plain sentence.
const COMMENT_SAID = new RegExp(
  "\\b(?:comments?|commentaires?|comentarios?)\\b[^.;]{0,40}?\\b(?:posted|published|added|left|written|sent|publie[es]?|poste[es]?|ajoute[es]?|laisse[es]?|depose[es]?|ecrit[es]?|envoye[es]?|publicad[oa]s?|anadid[oa]s?|dejad[oa]s?|escrit[oa]s?)\\b|" +
    "\\b(?:posted|published|added|left|wrote|publie|poste|ajoute|laisse|depose|ecrit|publique|anadi|deje|escribi)\\b[^.;]{0,24}?\\b(?:comments?|commentaires?|comentarios?)\\b|" +
    "\\b(?:commented|commente|comente)\\s+(?:on|sur|en|dans)\\b|" +
    "(?:发布了|发表了|留下了|写了|添加了)[^。；]{0,8}评论|评论已(?:发布|发表)|" +
    "(?:نشرت|اضفت|تم نشر|تمت اضافه)[^.]{0,20}تعليق",
);
// The comment went somewhere named: "on acme/x", "sur l'issue #12", "on #12". "Added comments to the code" did not.
const COMMENT_WHERE = new RegExp(
  "\\b(?:on|to|in|onto|sur|dans|en|a|à)\\s+(?:(?:the|l['’]|la|le|el|GitHub)\\s*)?(?:(?:issue|ticket|pr|pull request|demande|discussion)\\s+)?(?:#\\d|n[°o]\\s*\\d|[`'\"]?" + OWNER + "\\/|https?:\\/\\/github\\.com\\/)",
  "i",
);
const ISSUE_LINK = new RegExp("\\bgithub\\.com\\/(" + OWNER + ")\\/(" + REPO_PART + ")\\/(issues|pull)\\/(\\d{1,7})(?!\\d|#issuecomment)", "gi");
const ISSUE_REF = /\b(issues?|tickets?|pr|pull request|demande(?: de fusion)?|solicitud)\s*(?:n[°o]\s*)?#?\s*(\d{1,7})\b|(?<![\w&\/])#(\d{1,7})\b/gi;

/** The issues a sentence says a comment was posted on, each with its repository. Nothing when either is missing. */
function commentsOnIssues(sentence, flat) {
  const said = COMMENT_SAID.exec(flat);
  // "No comment was posted on …", "aucun commentaire publié": nothing to look for.
  if (!said || NEGATION.test(namesOut(flat.slice(Math.max(0, said.index - 24), said.index + said[0].length)))) return [];
  if (!COMMENT_WHERE.test(sentence)) return [];
  const out = new Map();
  const put = (repo, issue, pull) => out.set(repo.toLowerCase() + "#" + issue, { repo, issue: Number(issue), ...(pull ? { pull: true } : {}) });
  for (const m of sentence.matchAll(ISSUE_LINK)) put(m[1] + "/" + trimRef(m[2]), m[4], m[3].toLowerCase() === "pull");
  if (out.size) return [...out.values()];
  const named = repositoriesNamed(sentence).filter((f) => !f.link || !f.rest || f.rest === "/");
  for (const f of named) {
    const n = /^#(\d{1,7})\b/.exec(sentence.slice(f.end));
    if (n) put(f.repo, n[1], false);
  }
  if (out.size || named.length !== 1) return [...out.values()];
  const numbers = [...blank(sentence, named).matchAll(ISSUE_REF)].map((m) => ({ n: m[2] ?? m[3], pull: /^(?:pr|pull|demande|solicitud)/i.test(m[1] ?? "") }));
  const distinct = [...new Set(numbers.map((x) => x.n))];
  if (distinct.length === 1) put(named[0].repo, distinct[0], numbers.some((x) => x.pull));
  return [...out.values()];
}
// "Deployed, live at https://…": a page someone can open. Read on the plain sentence (no accents), with its address.
const DEPLOYED = new RegExp(
  "\\b(deployed|redeployed|is live|now live|went live|live at|is up at|up and running at|running at|served at|published (?:to|at|on)|shipped to|available at|" +
    "deploye[es]?|redeploye[es]?|en ligne|mise? en production|en production sur|publie[es]? sur|accessible (?:sur|a)|tourne sur|" +
    "desplegad[oa]s?|redesplegad[oa]s?|publicad[oa]s? en|en produccion|en linea|disponible en)\\b|" +
    "已部署|部署了|部署到|已上线|上线了|已发布到|发布到了|" +
    "تم النشر|تم نشر|منشور على|متاح على|يعمل على",
);
// An address that ends where a sentence or a bracket ends; a GitHub request or comment is checked as what it is.
const PAGE_URL = /https?:\/\/[^\s<>"'`)\]}]+/g;
const NOT_A_PAGE = /^https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:pull|issues|commit)\//;
// Announced measurements: a zero ("aucune erreur"), a clean pass ("typage propre"), or a full count.
const ZERO =
  /\b(?:aucun|aucune|zero|0|sans|no)\s+(?:\w+\s+)?(erreurs?|debordements?|echecs?|bugs?|avertissements?|regressions?|errors?|overflows?|failures?|warnings?)\b/;
const CLEAN = /\b(typage|typecheck|type check|lint|build|compilation|doctor)\b[^.;,]{0,24}\b(propres?|clean|ok|passe|passes|reussi[es]?|green|vert[es]?|sans\s+constat)\b/;
const VAGUE =
  /^(?:\W*)(done|all done|finished|complete|completed|c'est fait|termine|tout est fait|fini|it works|ca marche|tout fonctionne|everything works)\b[\s.!✓✔]*$/;
// Where a sentence is cut into clauses, each judged for its own polarity: commas, semicolons, colons, brackets
// (Chinese and Arabic ones too), and the words for "but" and "and".
const CLAUSE = /\s*[,;:()，、；：（）،؛]\s*|\s+(?:but|mais|et|and|pero|sino|لكن|ولكن)\s+|但是|不过|而且|并且/;
const CLAUSE_ES = new RegExp(CLAUSE.source + "|\\s+y\\s+");
// Words only Spanish uses among the five languages read here.
const SPANISH = /\b(hice|hicimos|hemos|esta|estan|los|las|del|pero|todavia|tambien|muy|aun|tengo|hecho|ningun|ninguna|nada|ahora)\b/;
// The same in Spanish, Chinese and Arabic. Their letters are not \w, so the start is written out.
const ZERO_I18N = new RegExp(
  "\\b(?:sin|cero|0|ningun)\\s+(?:\\w+\\s+)?(?:errores|error|fallos?|desbordamientos?|avisos?|regresiones?)\\b|" +
    "(?:零|0\\s*个?|没有|无)\\s*(?:错误|报错|溢出|警告|失败)|" +
    "(?<![" + AR + "])(?:بدون|لا|صفر|0)\\s+(?:اخطاء|خطا|تحذيرات|تحذير)(?![" + AR + "])",
);
const VAGUE_I18N =
  /^[\s¡!¿"'«“]*(?:hecho|listo|terminado|ya esta|ya esta hecho|todo listo|todo hecho|ya funciona|funciona|搞定了?|完成了?|好了|做好了|都好了|都搞定了|已完成|全部完成|تم|خلاص|انتهيت|انتهي|جاهز|تم بنجاح|كله تمام|تمام)[\s.!¡。！✓✔]*$/;

/** Split a message into small units: lines, table cells, then sentences. Code fences are dropped. */
export function sentences(text) {
  const noFences = String(text).replace(/```[\s\S]*?```/g, " ");
  const out = [];
  for (const raw of noFences.split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:[-*>]|\d+\.|#{1,6})\s+/, "").replace(/\*\*/g, "").trim();
    if (!line || /^\|?\s*:?-{3,}/.test(line)) continue;
    // Dots inside `code`, [text](target) or a quotation do not end a sentence: a quoted
    // "les tests passent." must stay inside its quotation marks to be recognised as a quotation.
    const masked = line.replace(/`[^`]*`|\]\([^)]*\)|«[^»]*»|“[^”]*”|「[^」]*」/g, (m) => m.replace(/[.!?;。！？；؟؛]/g, "\u0001"));
    let cursor = 0;
    // Chinese ends a sentence with its own marks and no space after them; Arabic asks with "؟".
    for (const part of masked.split(/(?<=[.!?;؟؛])\s+|(?<=[。！？；])\s*|\s+\|\s+/)) {
      const at = masked.indexOf(part, cursor);
      cursor = at + part.length;
      const unit = line.slice(at, at + part.length).trim();
      if (unit.length > 1) out.push(unit);
    }
  }
  return out;
}

function paths(sentence) {
  const found = new Set();
  for (const m of sentence.matchAll(/`([^`]+)`/g)) for (const p of m[1].match(BARE_PATH) ?? []) found.add(p);
  const bare = sentence.replace(/\]\([^)]*\)|`[^`]*`|https?:\/\/\S+/g, " ");
  for (const p of bare.match(BARE_PATH) ?? []) found.add(p);
  return [...found];
}
const safeDecode = (s) => {
  try {
    return decodeURI(s);
  } catch {
    return s;
  }
};

/**
 * @returns {{kind:string, negated:boolean, sentence:string, path?:string, sha?:string, pr?:number, passed?:number, total?:number, repo?:string, branch?:string, issue?:number}[]}
 * kinds: FILE_REFERENCED, FILE_WRITTEN, COMMITTED, PUSHED, PR_MERGED, PR_OPENED, TESTS_PASS,
 *        COMMENT_POSTED, REPO_CREATED, MEASURED, VAGUE_DONE
 */
export function extractClaims(text) {
  const claims = [];
  const seen = new Set();
  // What makes two claims one. A push to a named repository is that repository (two repositories may hold the same
  // commit); a comment given without its own number is the issue it was posted on.
  const identity = (c) =>
    c.kind === "PUSHED" && c.repo
      ? c.repo.toLowerCase() + "@" + (c.branch ?? "") + "@" + (c.sha ?? "")
      : c.kind === "COMMENT_POSTED" && c.repo && c.issue && !c.id
        ? c.repo.toLowerCase() + "#" + c.issue
        : (c.path ?? c.url ?? c.sha ?? c.pr ?? c.id ?? c.name ?? c.text ?? c.total ?? "");
  const add = (claim) => {
    const isFile = claim.kind.startsWith("FILE_");
    const key = [isFile ? "FILE" : claim.kind, claim.negated, identity(claim)].join("|");
    if (!seen.has(key)) {
      seen.add(key);
      claims.push(claim);
      return;
    }
    // One claim per file. "Written" is the stronger one: it replaces a mere reference.
    const twin = claims.findIndex((c) => c.kind === "FILE_REFERENCED" && claim.kind === "FILE_WRITTEN" && c.path === claim.path);
    if (twin >= 0) claims[twin] = claim;
  };
  const pushTo = (t, full) => ({ kind: "PUSHED", repo: t.repo, ...(t.branch ? { branch: t.branch } : {}), ...(t.sha ? { sha: t.sha } : {}), negated: t.negated, sentence: full });
  // "Pushed to origin:" over a list of repositories and their commits: the list says where the push went, one line each,
  // and the push with no target that the first line made is dropped.
  let listHead = null;
  const dropped = new Set();
  for (const full of sentences(text)) {
    const sentence = full.replace(QUOTED, " ");
    const flat = plain(sentence);
    const later = /[?？؟]\s*$/.test(full) || NOT_NOW.test(flat) || LATER_I18N.test(flat) || WILL_AR.test(sentence);
    const linked = [...sentence.matchAll(LINK)].map((m) => m[1]).filter((t) => !/^(?:https?:|mailto:|#)/.test(t)).map((t) => safeDecode(t.replace(/:\d+$/, "")));
    if (!later && (WRITE_VERB.test(flat) || WRITE_VERB_I18N.test(flat))) for (const path of [...linked, ...paths(sentence)]) add({ kind: "FILE_WRITTEN", path, negated: false, sentence: full });
    // A link to a local file promises that the file is there, in any sentence that is not a plan.
    if (!later) for (const path of linked) add({ kind: "FILE_REFERENCED", path, negated: false, sentence: full });
    if (later) {
      listHead = null;
      continue;
    }
    if (VAGUE.test(flat) || VAGUE_I18N.test(flat)) {
      add({ kind: "VAGUE_DONE", negated: false, sentence: full });
      listHead = null;
      continue;
    }
    for (const m of full.matchAll(COMMENT_URL)) add({ kind: "COMMENT_POSTED", repo: m[1], issue: Number(m[2]), id: m[3], negated: false, sentence: full });
    for (const m of flat.replace(/https?:\/\/\S+/g, " ").matchAll(COMMENT_ID)) add({ kind: "COMMENT_POSTED", id: m[1], negated: false, sentence: full });
    for (const c of commentsOnIssues(sentence, flat)) {
      if (claims.some((x) => x.kind === "COMMENT_POSTED" && x.sentence === full && x.issue === c.issue && String(x.repo).toLowerCase() === c.repo.toLowerCase())) continue;
      add({ kind: "COMMENT_POSTED", ...c, negated: false, sentence: full });
    }
    if (REPO_MADE.test(flat)) {
      const name = REPO_NAME.exec(sentence);
      if (name) add({ kind: "REPO_CREATED", name: name[1] ?? name[2], private: PRIVATE.test(flat), negated: false, sentence: full });
    }
    // A page said to be live is opened. "Not deployed yet" claims nothing to catch.
    if (DEPLOYED.test(flat) && !NEGATION.test(flat))
      for (const m of sentence.matchAll(PAGE_URL)) {
        const url = m[0].replace(/[.,;:!?。，；！？]+$/, "");
        if (!NOT_A_PAGE.test(url)) add({ kind: "DEPLOYED", url, negated: false, sentence: full });
      }
    const zero = ZERO.exec(flat) ?? CLEAN.exec(flat) ?? ZERO_I18N.exec(flat);
    if (zero) add({ kind: "MEASURED", text: zero[0], negated: false, sentence: full });
    // Counts are read on the whole sentence ("Tests : 94/94").
    for (const text of otherFullCounts(flat)) add({ kind: "MEASURED", text, negated: false, sentence: full });
    const ratios = testRatios(flat);
    // "16 sur 17" is an admission, not a claim of completion: there is nothing to catch, so nothing is checked.
    for (const ratio of ratios) if (ratio.passed === ratio.total) add({ kind: "TESTS_PASS", ...ratio, negated: false, sentence: full });
    // Requests named by link or by number alone are read on the whole sentence: the number is often in brackets,
    // one clause away from its verb ("est ouverte (#171, [lien](…/pull/171))").
    const named = requestsNamed(flat);
    // Polarity is judged clause by clause: "committed, not pushed" holds two opposite claims.
    // Spanish "y" (and) separates too, but only in a sentence that is Spanish: in French "y" is also a pronoun
    // ("le contrôle des tests y passe" was cut in two on 12/11, and its claim lost).
    const spanish = /[¿¡ñÑ]/.test(full) || SPANISH.test(flat);
    const clauses = flat.split(spanish ? CLAUSE_ES : CLAUSE);
    // Where the push went, when the sentence names it: one push per repository named, not one push with no target.
    const found = listHead || clauses.some((c) => c && pushVerb(c)) ? pushTargets(sentence) : [];
    // A branch the sentence names denies nothing either: "acme/x fix-not-found is now 5f3c2a9" is a push.
    const branches = found.map((t) => t.branch).filter(Boolean);
    const pushSaid = clauses.some((c) => c && pushVerb(c) && !NEGATION.test(pushWords(c, branches)));
    const targets = pushSaid ? found : listHead ? found.filter((t) => t.sha) : [];
    if (listHead) {
      if (!targets.length) listHead = null;
      else if (listHead.claim) dropped.add(listHead.claim);
    }
    // A line of that list has no verb of its own: its pushes are added here.
    if (!pushSaid) for (const t of targets) add(pushTo(t, full));
    let targetsAdded = !pushSaid;
    for (const clause of clauses) {
      if (!clause) continue;
      const negated = NEGATION.test(clause);
      const base = { negated, sentence: full };
      // A push is denied by its words, not by a branch or a flag it names (see pushWords).
      const pushDenied = NEGATION.test(pushWords(clause, branches));
      if (pushVerb(clause) || (pushDenied && PUSH_NOUN.test(clause))) {
        if (!targets.length) add({ kind: "PUSHED", negated: pushDenied, sentence: full });
        else if (!targetsAdded) {
          for (const t of targets) add(pushTo(t, full));
          targetsAdded = true;
        }
      }
      const pr = PR.exec(clause);
      if (pr && (MERGED.test(clause) || (negated && MERGE_NOUN.test(clause)))) add({ kind: "PR_MERGED", pr: Number(pr[1]), ...base });
      else if (pr && OPENED.test(clause)) add({ kind: "PR_OPENED", pr: Number(pr[1]), ...base });
      if (COMMIT_VERB.test(clause)) {
        const shas = [...new Set([...(clause.match(SHA) ?? []), ...[...clause.matchAll(SHA_MARKED)].map((m) => m[1] ?? m[2])])];
        if (shas.length) for (const sha of shas) add({ kind: "COMMITTED", sha, ...base });
        // "no commit", "pas de commit": the negation must come before the word. In "un commit jamais envoyé"
        // it comes after, and denies the sending, not the commit.
        else if (COMMITTED_WORD.test(clause) || (negated && NEG_BEFORE_COMMIT.test(clause))) add({ kind: "COMMITTED", ...base });
      } else if (!negated && SAVED.test(flat) && PLAIN_COMMIT.test(clause)) {
        for (const m of clause.matchAll(MARKED_ID)) if (/[a-f]/.test(m[1]) && /\d/.test(m[1])) add({ kind: "COMMITTED", sha: m[1], ...base });
      }
      const testsOk = (TEST_WORD.test(clause) && TESTS_OK.test(clause)) || (TEST_WORD_I18N.test(clause) && TESTS_OK_I18N.test(clause));
      if (!ratios.length && !negated && testsOk) {
        if (PART_OF.test(clause) && /\d/.test(clause)) continue;
        const said = TEST_COUNT.exec(clause);
        const n = said ? Number(said[1] ?? said[2] ?? said[3]) : 0;
        add({ kind: "TESTS_PASS", ...(n ? { passed: n, total: n } : {}), ...base });
      }
    }
    // After the clauses: a request the clauses already read (with the word "PR") keeps that reading.
    for (const ref of named) {
      if (claims.some((c) => c.pr === ref.pr && c.sentence === full)) continue;
      add({ kind: ref.kind, pr: ref.pr, ...(ref.repo ? { repo: ref.repo } : {}), negated: ref.negated, sentence: full });
    }
    if (pushSaid && !targets.length && /[:：]\s*$/.test(full)) listHead = { claim: claims.find((c) => c.kind === "PUSHED" && !c.repo && !c.negated && c.sentence === full) ?? null };
  }
  const kept = claims.filter((c) => !dropped.has(c));
  // "Done." followed by what was done is an opening word, not a vague answer: it is vague only when it is all there is.
  // Found on 2026-11-13 on the run shown in the README: "Done. Committed …, pushed …" listed a vague "done" first.
  return kept.some((c) => c.kind !== "VAGUE_DONE") ? kept.filter((c) => c.kind !== "VAGUE_DONE") : kept;
}
