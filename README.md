# SkeptOpus

**Your AI says it's done. SkeptOpus goes and looks.**

When an AI coding tool ends its turn with "done", SkeptOpus reads what it claims and checks it by itself: the files, the commits, what was pushed or merged, the tests. It does not take the AI's word for it. Every claim gets one of four answers:

| Answer | What it means |
| --- | --- |
| SEEN | It looked, it's true. |
| NOT FOUND | It looked and found nothing. |
| CONTRADICTED | It found the opposite. |
| COULDN'T LOOK | It had no way to look, so it concludes nothing. |

"Seen" means done, not done well: SkeptOpus checks that a thing exists, not that it is any good. It never blocks the AI. It tells you, in one line at the end of the turn, in a journal page you can open at any time, and with a sound of its own when something is wrong.

It has no server, no account and no telemetry. Everything it keeps stays in a folder in your home.

## Install

SkeptOpus needs Node.js 18 or later. One command copies the engine to `~/.skeptopus/app` and hooks every AI coding tool it finds:

    node core/cli.mjs install --dry-run     (says what it would do, writes nothing)
    node core/cli.mjs install
    node core/cli.mjs status
    node core/cli.mjs uninstall             (takes the hooks back out; your journal and settings stay)

Tools it hooks, and how each hands over the AI's last words:

| Tool | How SkeptOpus answers |
| --- | --- |
| Claude Code | A line at the end of the turn, in the conversation. |
| Codex | A warning in Codex. Codex ignores a new hook until you approve it: open `/hooks` in Codex. |
| Cursor | Cursor shows nothing coming from a hook: the answer goes to the journal, the notification and the sound. |
| Gemini CLI | A message at the end of the turn, written as its documentation describes. Not tried yet. |

Some tools do not hand the AI's last words to a hook, so they cannot be hooked. With them, and with any AI in a browser, copy the answer and run `node ~/.skeptopus/app/cli.mjs clip`. On Windows the installer also puts two shortcuts on the Desktop: the journal, and "check what I copied".

Each tool's settings file is kept as it was, beside it, under the name `<file>.avant-skeptopus`. Installing twice never adds a second line; uninstalling removes only SkeptOpus's own line.

## Use

| Command | What it does |
| --- | --- |
| `journal [--open]` | Rewrites the journal page and says where it is (`~/.skeptopus/journal.html`). With `--open`, shows it. |
| `clip [--open] [--text-file path]` | Checks the text you just copied, from any AI, and keeps the answer in the journal. |
| `glance [--json]` | The state of the day in one line. |
| `check --message "…"` | Checks one message. Exit code: 0 seen or nothing claimed, 1 not found, 2 contradicted, 3 couldn't look. |
| `transcript <session.jsonl>`, `replay <session.jsonl>` | Reads a past Claude Code session; `replay` fills the journal with it. |
| `attach <tool>`, `detach <tool>` | Hooks or unhooks one tool only. |

The journal page reads in English, French, Spanish, Chinese and Arabic, with a button for each. It shows one character per answer, and the octopus on top, in the pose of the day's worst answer.

## Settings

Your settings are `~/.skeptopus/config.json`. Created once by the installer, never overwritten.

| Key | What it does |
| --- | --- |
| `lang` | The language shown first: `en`, `fr`, `es`, `zh` or `ar`. Without it, English, the original. |
| `notify` | When the small window appears (Windows): `always`, `problems` (the default: anything but "seen") or `never`. |
| `sound` | The same choice for the sound. Until you set it, it follows `notify`. |
| `repos` | GitHub repositories to ask about comments, merges and repositories, as `owner/name`. |
| `roots` | More folders to look in, beside the one the AI worked in. |
| `test`, `testCwd` | The command that runs your tests, as a list (`["node", "--test"]`), and where. SkeptOpus never runs a test it was not told about, and never hands text to a shell. |
| `checks` | Measurements SkeptOpus may redo when an AI announces one: `name`, `match` (a pattern), `run` (a list), `cwd`, `slow`, `timeoutMs`. |
| `trusted` | Folders whose own `.skeptopus.json` may declare commands too. |

A project may carry a `.skeptopus.json` saying where to look (`repos`, `roots`). It can never say what to run, unless you listed its folder in `trusted`: the AI being checked works in that project and could write the file.

An answer found wrong can be struck from the journal without rewriting it: add its exact time to `~/.skeptopus/errata.json` with a sentence that says why.

## What SkeptOpus reads, and what it checks

It reads claims in five languages: English, French, Spanish, Chinese and Arabic. A plan, a question, a condition ("once #12 is merged") or a quotation is not a claim. Each part of a sentence is read for its own polarity: "committed, not pushed" holds two opposite claims.

| Claim | How it is checked |
| --- | --- |
| A file written or pointed to | The file is there, not empty, and not older than the session. |
| A commit | In the repositories at hand, or on GitHub. |
| A push | The remote itself is asked. |
| A request merged or opened | GitHub is asked, through the `gh` command you already use. A link names the repository to ask. |
| A comment posted, a repository created | GitHub is asked; "private" is checked when it was said. |
| The tests pass | The declared test command is run again; a failure is run twice before anything is called contradicted. When the AI gives a number and the declared tests are not that many, they may be other tests: SkeptOpus says it could not look. |
| A measurement announced | Redone only the way you declared it in `checks`. |
| A bare "done" | Named as vague: there is nothing to check. |

The Spanish, Chinese and Arabic words were written by a non-native author. Corrections from readers whose language it is are welcome.

## Where things are

| What | Where |
| --- | --- |
| The engine as installed | `~/.skeptopus/app` |
| Every check, kept | `~/.skeptopus/historique.jsonl` |
| The journal page | `~/.skeptopus/journal.html` |
| Settings and corrections | `~/.skeptopus/config.json`, `~/.skeptopus/errata.json` |
| Another folder | Set `SKEPTOPUS_HOME`. |

SkeptOpus uses the network for one thing only: asking your own git remote, or GitHub through `gh`, about what an answer says was pushed, merged or posted.

## The extension for VS Code and Cursor

    node scripts/skeptopus-pack-extension.mjs        writes dist/skeptopus-0.1.0.vsix
    code --install-extension dist/skeptopus-0.1.0.vsix
    cursor --install-extension dist/skeptopus-0.1.0.vsix

It shows the journal in a side panel and in a tab, the worst answer of the day in the status bar, and checks what you copied. It runs the engine with the editor's own runtime, so these need no Node.js. "Hook the AI tools on this machine" does: the hooks are run later by the tools themselves. See `extension/README.md`.

To try it inside a real editor, on folders made for the occasion (your own editor settings and journal are not touched):

    node scripts/skeptopus-try-in-editor.mjs ["path to Code.exe or Cursor.exe"]

## Develop

    node --test

A test must not depend on the machine it runs on, nor leave anything behind: every temporary folder goes through `tests/tmp.mjs`. A machine short of disk space can name another folder for them in `tests/tmp-root.local` (one line, ignored by git). The sounds are written by `scripts/skeptopus-make-sounds.mjs`, and a test checks that what ships is what it writes; the same goes for the extension's icons with `scripts/skeptopus-make-icons.py`.

Tried on: Windows 11 with Node.js 24; Linux (Ubuntu 24.04 under WSL) with Node.js 18.19.1; VS Code 1.142.0 and Cursor 3.29.15. Not tried yet: macOS, an editor's remote window.

## License

The code is under the MIT license (see `LICENSE`). The SkeptOpus name, the octopus, the other characters, the artwork and the sounds are not: see `TRADEMARKS.md`. The typefaces in `core/fonts` keep their own license (SIL Open Font License), beside them.

Made by Hichem Benali. SkeptOpus, by SYSTASYS.
