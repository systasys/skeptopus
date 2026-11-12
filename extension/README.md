# SkeptOpus

**Your AI says it's done. SkeptOpus goes and looks.**

When an AI coding tool tells you "it's done", SkeptOpus checks by itself: the files, the commits, what was pushed, the tests. It doesn't take the AI's word for it, and it tells you what it found in one of four answers.

| Answer | What it means |
| --- | --- |
| SEEN | It looked, it's true. |
| NOT FOUND | It looked and found nothing. |
| CONTRADICTED | It found the opposite. |
| COULDN'T LOOK | It had no way to look, so it concludes nothing. |

"Seen" means done, not done well. SkeptOpus never blocks anything: it tells you.

## What this extension adds to your editor

- **The journal, in a side panel.** Click the eye in the activity bar. Every check is there, newest first, with the octopus on top in the pose of the day's worst answer. Drag the panel to the other side bar to keep it open while you work.
- **One line in the status bar.** The worst answer of the day, and how many. Red when something was contradicted, amber when something was not found.
- **Check what you just copied.** It works with any AI, in or out of the editor: copy its answer, then run "SkeptOpus: Check what I just copied".
- **Five languages.** SkeptOpus reads what an AI says in English, French, Spanish, Chinese and Arabic, and its journal speaks all five. Menus follow your editor's language when it is one of the first four.

## Hooking your AI tools

For SkeptOpus to check every answer without being asked, it adds one line to the settings of the tools it finds on your machine (Claude Code, Cursor, Codex, Gemini CLI). Run "SkeptOpus: Hook the AI tools on this machine". It shows what it is about to do before doing it, keeps a copy of each settings file as it was, and needs Node.js 18 or later.

The journal and the clipboard check work without that step, and without Node.js.

## What it does and does not do

- It checks that the thing exists. It does not judge whether it is any good.
- It has no server and no account. The journal is a file in your home folder (`~/.skeptopus`), and nothing in it leaves your machine.
- It uses the network for one thing only: asking your own git remote, or GitHub through the `gh` command you already use, about what an answer says was pushed, merged or posted.
- A project can tell SkeptOpus where to look. It can never tell it what to run: only your own settings can.

## Where things are

| What | Where |
| --- | --- |
| Your journal and settings | `~/.skeptopus` |
| The four sounds, the pictures, the words | inside the extension, in `engine/` |
| Turning the status bar line off | Settings, "SkeptOpus" |
