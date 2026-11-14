<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="media/banner-animated.webp">
    <source media="(prefers-color-scheme: light)" srcset="media/banner-light.png">
    <img alt="SkeptOpus by SYSTASYS. Your AI says it's done. SkeptOpus goes and looks." src="media/banner-dark.png" width="100%">
  </picture>
</p>

<p align="center">
  <b>Your AI says it's done. SkeptOpus goes and looks.</b><br>
  A small checker that runs on your machine and verifies what AI coding agents claim:<br>
  commits, pushes, merges, tests, files, comments, deploys.<br>
  Made for everyone who builds with AI, whether you read the code or not.
</p>

<p align="center">
  <a href="LICENSE"><img alt="Code under MIT" src="https://img.shields.io/badge/code-MIT-171717?style=flat-square"></a>
  <img alt="Node.js 18 or later" src="https://img.shields.io/badge/node-%E2%89%A518-0E3B43?style=flat-square">
  <img alt="Works with Claude Code, Codex, Cursor, Gemini CLI and any MCP client" src="https://img.shields.io/badge/works%20with-Claude%20Code%20%C2%B7%20Codex%20%C2%B7%20Cursor%20%C2%B7%20Gemini%20%C2%B7%20MCP-E44940?style=flat-square">
  <img alt="No account, no server, no telemetry" src="https://img.shields.io/badge/telemetry-none-137A4B?style=flat-square">
</p>

---

## In thirty seconds

An agent ends its turn with a confident summary. SkeptOpus reads it, finds each claim, and goes to look for itself:

```text
$ node core/cli.mjs check --message "Done. Committed ee89a26, pushed to origin, all tests pass, and the shop is live at http://localhost:4173/shop."
SkeptOpus · [ CONTRADICTED ]
  [CONTRADICTED] deployed http://localhost:4173/shop: the page doesn't exist (not found) (HTTP 404)
  [SEEN]         committed ee89a26: the commit exists
  [NOT FOUND]    pushed: the branch isn't on the remote
  [CONTRADICTED] tests pass: run again just now, twice: they fail (the total counts each quantity)
```

That is a real run, on a small repository made for the demonstration. The page said to be live does not exist. The commit exists, so it is seen. The push never happened. The tests fail when they are run again, twice, and the failing one is named.

The command above is the one that produced that output, from a clone of this repository. You do not need a clone: after `npx skeptopus install`, the same check reads `npx skeptopus check --message "..."`.

## Why it exists

On 12 November 2026, the AI building SkeptOpus told its author "all tests pass". Twice. SkeptOpus ran them: they failed. A test depended on the folder it was started from. SkeptOpus was right, and the AI was not.

AI agents are good at work and generous with the word "done". Nobody can reread everything. SkeptOpus does the rereading: it never takes the agent's word for it, and it never blocks the agent either. It tells you.

## Four answers

<table>
  <tr>
    <td align="center" width="25%"><img src="core/art/fourmi.webp" width="96" alt=""><br><b>SEEN</b><br><sub>It looked. It's true.</sub></td>
    <td align="center" width="25%"><img src="core/art/albatros.webp" width="96" alt=""><br><b>NOT FOUND</b><br><sub>It looked and found nothing.</sub></td>
    <td align="center" width="25%"><img src="core/art/grenouille.webp" width="96" alt=""><br><b>CONTRADICTED</b><br><sub>It found the opposite.</sub></td>
    <td align="center" width="25%"><img src="core/art/taupe.webp" width="96" alt=""><br><b>COULDN'T LOOK</b><br><sub>No way to look, so no verdict.</sub></td>
  </tr>
</table>

"Seen" means done, not done well: SkeptOpus checks that a thing exists and holds, not that it is any good. A message is only as good as its weakest claim.

## Install

You need Node.js 18 or later.

```sh
npx skeptopus install --dry-run   # says what it would do, writes nothing
npx skeptopus install             # hooks every AI coding tool it finds
npx skeptopus status
npx skeptopus uninstall           # takes everything back out; your journal stays
```

From a clone of this repository, `node core/cli.mjs` does the same as `npx skeptopus`.

One command copies the engine to `~/.skeptopus/app`, hooks every tool it finds, and lets each tool's AI call SkeptOpus itself:

| Tool | After each turn | Before it says "done" |
| --- | --- | --- |
| Claude Code | A line at the end of the turn. | MCP server, user-wide. |
| Codex | A warning in Codex. Approve the new hook once in `/hooks`. | MCP server in `~/.codex/config.toml`. |
| Cursor | The journal, a notification and a sound (Cursor shows nothing from hooks). | MCP server in `~/.cursor/mcp.json`. |
| Gemini CLI | A message at the end of the turn. Not tried yet. | MCP server in `~/.gemini/settings.json`. |
| Any AI, even in a browser | Copy its answer, run `node ~/.skeptopus/app/cli.mjs clip`. | |

Every settings file it touches is kept as it was, beside it, as `<file>.avant-skeptopus`. Installing twice never adds a second line. `--skip mcp` leaves the servers out.

## Let your AI ask first

The hook checks what the AI said, after it said it. The MCP server lets the AI check before it speaks. `npx skeptopus mcp` speaks the Model Context Protocol on stdin and stdout, in both of its current forms (the 2026-07-28 revision and the earlier handshake ones), with three tools:

| Tool | What it answers |
| --- | --- |
| `check` | Every claim in the message the AI is about to send, one verdict each, and what to do about it. |
| `today` | The state of the day: what was checked, what was not seen to be true. |
| `what_can_you_check` | What can be verified in a folder before relying on it. |

A check the AI makes on itself is kept out of your journal: an agent that verifies before it speaks has misled no one.

## In continuous integration

SkeptOpus reads what a pull request claims, its description and its commits, and checks it against the code:

```yaml
on: pull_request
jobs:
  skeptopus:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: systasys/skeptopus@v0.2.2
        with:
          fail-on: contradicted       # or: problems, anything, never
          settings: .github/skeptopus.json
```

The answer lands in the run's summary as a table. From the command line, `check` also writes `--format md` or `--format junit` (one test case per claim, read by every CI dashboard), `--output` to a file, and `--fail-on` to decide what fails the run. Use it on `pull_request`, never on `pull_request_target`.

## Settings and profiles

Your settings are `~/.skeptopus/config.json`, created once and never overwritten. `npx skeptopus config` shows the settings in effect for a folder and where each one comes from.

| Profile | What changes |
| --- | --- |
| `calm` | It speaks up only when something is false. |
| `normal` | The default. |
| `strict` | A "done" that names nothing is refused; tests that pass only on a second run, and a file whose age cannot be compared, no longer count as seen. |

`npx skeptopus init` finds how a folder runs its tests, from its own files, and runs nothing. `--apply` keeps it for that folder only, in your file:

```json
{
  "lang": "en",
  "profile": "normal",
  "projects": {
    "/home/me/app": { "test": ["npm", "test"], "profile": "strict" }
  }
}
```

| Key | What it does |
| --- | --- |
| `lang` | The language shown first: `en`, `fr`, `es`, `zh` or `ar`. |
| `profile` | `calm`, `normal` or `strict`, here or per project. |
| `notify`, `sound` | When the small window and the sound come: `always`, `problems`, `contradicted` or `never`. What you set wins over the profile. |
| `test`, `testCwd` | The command that runs your tests, as a list. Never a shell string. |
| `checks` | Measurements it may redo when an AI announces one: `name`, `match`, `run`, `cwd`, `slow`, `timeoutMs`. |
| `repos`, `roots` | GitHub repositories to ask, and more folders to look in. |
| `projects` | Any of the above for one folder and what it holds. The most specific folder wins. |
| `web` | `false` to never open a page an AI says is live. |
| `mcp` | `{ "timeoutMs": 50000, "journal": false }` for checks the AI makes on itself. |
| `trusted` | Folders whose own `.skeptopus.json` may declare commands too. |

A project may carry a `.skeptopus.json` saying where to look. It can never say what to run, unless you listed its folder in `trusted`: the AI being checked works in that project and could write the file.

## What it reads, and how it checks

It reads claims in English, French, Spanish, Chinese and Arabic. A plan, a question, a condition ("once #12 is merged") or a quotation is not a claim. Each part of a sentence keeps its own polarity: "committed, not pushed" holds two opposite claims.

| Claim | How it is checked |
| --- | --- |
| A file written or pointed to | The file is there, not empty, and not older than the session. |
| A commit | In the repositories at hand, or on GitHub. |
| A push | The remote itself is asked. Each GitHub repository the sentence names (`owner/name` with its branch or its commit) is a push of its own, read on GitHub's public side, with no login. A push that names no repository is judged on the folder the AI worked in, and on no other. |
| A pull request merged or opened | GitHub is asked, through the `gh` command you already use. |
| A comment posted, a repository created | GitHub is asked; "private" is checked when it was said. A comment said to be posted on `owner/name` issue #N, without its own link, is looked for on GitHub's public side. |
| The tests pass | Your test command is run again; a failure is run twice before anything is called contradicted. |
| A measurement announced | Redone only the way you declared it. |
| Deployed, live at an address | The page is opened once, like anyone would: no cookie, no login. |
| A bare "done" | Named as vague: there is nothing to check. |

The journal page reads in the five languages, shows one character per answer, and puts the octopus on top in the pose of the day's worst answer. A file seen at night and changed or deleted since is marked so the morning after.

## Privacy

No server, no account, no telemetry. Everything it keeps stays in `~/.skeptopus`. It uses the network for four things only: your own git remote, GitHub through `gh`, GitHub's public side with no login (for a repository or an issue a sentence names), and a page an AI says is live (turn that off with `"web": false`).

## The extension for VS Code and Cursor

```sh
node scripts/skeptopus-pack-extension.mjs        # writes dist/skeptopus-0.2.2.vsix
code --install-extension dist/skeptopus-0.2.2.vsix
```

The journal in a side panel, the worst answer of the day in the status bar, and "check what I copied". It runs the engine with the editor's own runtime. See `extension/README.md`.

## Develop

```sh
node --test
```

A test must not depend on the machine it runs on, nor leave anything behind. Tried on Windows 11 with Node.js 24, Linux (Ubuntu 24.04) with Node.js 18, VS Code 1.142 and Cursor 3.29; the MCP server with the official MCP Inspector. Not tried yet: macOS.

The Spanish, Chinese and Arabic words were written by a non-native author. Corrections from readers whose language it is are welcome.

## License

The code is under the MIT license (see `LICENSE`). The SkeptOpus name, the octopus, the other characters, the artwork and the sounds are not: see `NOTICE` and `TRADEMARKS.md`. The typefaces in `core/fonts` keep their own license (SIL Open Font License).

<p align="center"><sub><b>SkeptOpus</b>, by <b>SYSTASYS</b> · made by Hichem Benali</sub></p>
