# What changed

The engine, its command line, its MCP server and the GitHub action. The editor extension carries the same engine and keeps its own list in `extension/CHANGELOG.md`.

## 0.2.2

- A push is checked on the repository the sentence names. Each GitHub repository named with its branch or its commit (`owner/name`) is a push of its own, read on GitHub's public side, with no login. A private one stays "couldn't look".
- A push that names no repository is judged on the folder the AI worked in, and on no other. Before, it could be called contradicted on a folder nobody pushed from.
- A branch, a flag or code that holds a "no" (`fix-not-found`, `--no-verify`) no longer reads as "not pushed". A real "not pushed" still does.
- A comment said to be posted on `owner/name` issue #N, without its own link, is looked for on GitHub's public side.
- Under Cursor, the MCP server looks in the open project, not in your home folder. When it cannot tell which project, the answer says so and asks for `cwd`.
- On Windows with Node.js 24, the command line no longer crashes on its way out after it opened a page on the network. It ends with the verdict's own code.

## 0.2.1

- The engine has its npm package: `npx skeptopus install`.
- In a remote window (SSH, WSL, a container), the editor extension runs where the work happens.

## 0.2.0

- An AI can ask SkeptOpus itself before it says "done": an MCP server with three tools, `check`, `today` and `what_can_you_check`.
- Settings per project, and three profiles: calm, normal, strict.
- "Deployed, live at …" is checked by opening the page once.
- A file seen and changed or deleted since is marked so in the journal.
- In continuous integration: a GitHub action, and `--format md` or `--format junit`.

## 0.1.0

First public version.

- It reads what an AI coding agent claims, and goes to look: commits, pushes, merges, tests, files, comments.
- One command hooks Claude Code, Codex, Cursor and Gemini CLI. Any other AI works through the clipboard.
- The journal page reads in English, French, Spanish, Chinese and Arabic.
- An extension for VS Code and Cursor.
