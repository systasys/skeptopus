# What changed

## 0.2.4

The engine inside says "couldn't look" where it used to answer on something it had not seen.

- "If the tests pass, I merge" is a condition, not a claim. It used to be read as one, and could end in "contradicted" against an agent that had promised nothing.
- A test run in a folder that has nothing to do with the claim no longer proves it. Both folders are named, so the setting can be repaired.
- The number of tests is read from pytest, unittest, jest, vitest, cargo and go as well, not only from Node.

## 0.2.3

Nothing changes for you: the extension and its engine ship as one version, and this one went out so the engine's npm package could be listed in the official MCP registry.

## 0.2.2

The engine inside reads pushes better.

- A push is checked on the repository the sentence names, on GitHub's public side, with no login. A push that names no repository is judged only on the folder the AI worked in.
- A branch or a flag that holds a "no" (`fix-not-found`, `--no-verify`) no longer reads as "not pushed".
- A comment said to be posted on `owner/name` issue #N is looked for on GitHub.
- Under Cursor, the checks an AI asks for look in the open project, not in your home folder.
- On Windows with Node.js 24, the command line no longer crashes on its way out after it opened a page on the network.

## 0.2.1

- In a remote window (SSH, WSL, a container), the extension runs on the machine where the work happens, so the panel shows that machine's journal. Before, it could show the journal of the computer in front of you. The editor offers to install it there.
- The publisher is now `systasys`: in the stores, the extension is `systasys.skeptopus`.
- The engine can be installed with npm: `npx skeptopus install`.

## 0.2.0

The engine inside grows up.

- The AI can ask SkeptOpus itself, before it says "done": an MCP server, declared to every tool the engine hooks.
- Settings per project, and three profiles: calm, normal, strict.
- "Deployed, live at …" is checked by opening the page once.
- A file seen and changed or deleted since is marked so in the journal.

## 0.1.0

First version for editors.

- The journal in a side panel, with the octopus on top.
- The worst answer of the day in the status bar.
- "Check what I just copied", for any AI.
- "Hook the AI tools on this machine": Claude Code, Cursor, Codex, Gemini CLI.
- The journal reads in English, French, Spanish, Chinese and Arabic.
