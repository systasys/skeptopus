// SkeptOpus as a tool an AI calls itself, before it tells a human "done": the Model Context Protocol, over stdio.
//
// Both eras of the protocol are spoken (read on 2026-11-13 at modelcontextprotocol.io):
//  - modern, 2026-07-28: no handshake; every request carries its version in _meta; server/discover says who we are;
//  - legacy, 2025-11-25 and before: an initialize handshake, then tools/list and tools/call.
// The editors and agents of the day speak one or the other, so a server that wants to be everywhere speaks both.
//
// Nothing is changed by a call. A check may re-run what the user declared (tests, measurements), as the command line
// does, and it asks GitHub; it never runs a command a project file or an agent wrote.
import { resolve } from "node:path";
import { createInterface } from "node:readline";

export const MODERN = ["2026-07-28"];
export const LEGACY = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const VERSION_KEY = "io.modelcontextprotocol/protocolVersion";
const SERVER_INFO_KEY = "io.modelcontextprotocol/serverInfo";
const UNSUPPORTED_VERSION = -32022;

const VERDICTS = ["PROVEN", "NOT_PROVEN", "CONTRADICTED", "COULD_NOT_CHECK", "NOTHING_CLAIMED"];

export const INSTRUCTIONS =
  "SkeptOpus looks before anyone believes. Before you tell the user that something is done (committed, pushed, merged, " +
  "tests passing, file written, comment posted, repository created, measured), call `check` with the message you are " +
  "about to send. Each claim comes back PROVEN, NOT_PROVEN, CONTRADICTED or COULD_NOT_CHECK, with what was seen. " +
  "Fix what is CONTRADICTED or NOT_PROVEN, or say plainly that it is not verified. Never present COULD_NOT_CHECK as done.";

/** The tools, in a fixed order: clients cache the list. */
export function toolList(langs) {
  return [
    {
      name: "check",
      title: "Check the claims in a message",
      description:
        "Pass the message you are about to send to the user. SkeptOpus finds every claim of work done in it and looks, on " +
        "this machine and on GitHub: commits in git, pushes on the remote, pull requests and merges, the test command the " +
        "user declared re-run, files on disk, comments and repositories on GitHub, declared measurements redone. Returns " +
        "one verdict per claim and the verdict of the whole message (as good as its weakest claim). It changes nothing.",
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string", description: "The words you are about to say, exactly as the user would read them." },
          cwd: { type: "string", description: "The folder the work happened in. Defaults to the folder this server was started in." },
          lang: { type: "string", enum: langs, description: "Language of the explanations. Defaults to the user's setting." },
        },
        required: ["message"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        properties: {
          verdict: { type: "string", enum: VERDICTS },
          claims: {
            type: "array",
            items: {
              type: "object",
              properties: {
                kind: { type: "string" },
                target: { type: "string" },
                negated: { type: "boolean" },
                verdict: { type: "string", enum: VERDICTS },
                why: { type: "string" },
                explanation: { type: "string" },
                facts: { type: "object" },
              },
              required: ["kind", "verdict", "why", "explanation"],
            },
          },
          advice: { type: "string" },
        },
        required: ["verdict", "claims", "advice"],
      },
      annotations: { title: "Check the claims in a message", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    {
      name: "today",
      title: "The state of the day",
      description: "How many claims SkeptOpus checked today on this machine, and how many were contradicted, not proven or could not be checked. Changes nothing.",
      inputSchema: { type: "object", additionalProperties: false },
      annotations: { title: "The state of the day", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "what_can_you_check",
      title: "What SkeptOpus can check here",
      description:
        "Says which claims SkeptOpus can verify in a folder before you rely on it: whether a test command and measurements " +
        "are declared, which repositories it will ask. A claim it cannot verify comes back COULD_NOT_CHECK. Changes nothing.",
      inputSchema: {
        type: "object",
        properties: { cwd: { type: "string", description: "The folder to look at. Defaults to the folder this server was started in." } },
        additionalProperties: false,
      },
      annotations: { title: "What SkeptOpus can check here", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];
}

const text = (t) => [{ type: "text", text: t }];

/**
 * One request in, one answer out (or nothing for a notification). Pure apart from the engine it is handed,
 * so it can be tested without a process.
 * @param {object} msg a parsed JSON-RPC message
 * @param {object} engine { version, langs, cwd, check(message, cwd, lang), today(), capabilities(cwd) }
 * @param {object} state per-process memory: the era a legacy client chose with initialize
 */
export async function answer(msg, engine, state = {}) {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return msg && "id" in msg ? { jsonrpc: "2.0", id: msg.id ?? null, error: { code: -32600, message: "Invalid request" } } : null;
  }
  const notification = !("id" in msg);
  if (notification) return null; // initialized, cancelled, progress: nothing to say back
  const reply = (result) => ({ jsonrpc: "2.0", id: msg.id, result });
  const fail = (code, message, data) => ({ jsonrpc: "2.0", id: msg.id, error: data ? { code, message, data } : { code, message } });
  const params = msg.params && typeof msg.params === "object" ? msg.params : {};
  const asked = params._meta?.[VERSION_KEY];
  const modern = typeof asked === "string";
  if (modern && !MODERN.includes(asked)) return fail(UNSUPPORTED_VERSION, "Unsupported protocol version", { supported: [...MODERN, ...LEGACY], requested: asked });
  // Modern answers say they are whole; legacy clients get exactly the shape their revision defines.
  const done = (result) => reply(modern ? { resultType: "complete", ...result } : result);
  const serverInfo = { name: "skeptopus", title: "SkeptOpus", version: engine.version };

  switch (msg.method) {
    case "initialize": {
      const wanted = params.protocolVersion;
      state.era = LEGACY.includes(wanted) ? wanted : LEGACY[0];
      return reply({ protocolVersion: state.era, capabilities: { tools: { listChanged: false } }, serverInfo, instructions: INSTRUCTIONS });
    }
    case "server/discover":
      return done({ supportedVersions: [...MODERN, ...LEGACY], capabilities: { tools: { listChanged: false } }, _meta: { [SERVER_INFO_KEY]: serverInfo }, instructions: INSTRUCTIONS, ttlMs: 3600000, cacheScope: "public" });
    case "ping":
      return done({});
    case "tools/list":
      return done(modern ? { tools: toolList(engine.langs), ttlMs: 3600000, cacheScope: "public" } : { tools: toolList(engine.langs) });
    case "tools/call": {
      const name = params.name;
      const args = params.arguments && typeof params.arguments === "object" ? params.arguments : {};
      try {
        if (name === "check") {
          if (typeof args.message !== "string" || !args.message.trim()) return done({ content: text("`message` is empty: pass the words you are about to send to the user."), isError: true });
          if (args.message.length > 200000) return done({ content: text("`message` is longer than 200,000 characters: pass the final answer only."), isError: true });
          const cwd = typeof args.cwd === "string" && args.cwd.trim() ? resolve(args.cwd) : engine.cwd;
          const out = await engine.check(args.message, cwd, typeof args.lang === "string" ? args.lang : undefined);
          return done({ content: text(out.text), structuredContent: out.structured, isError: false });
        }
        if (name === "today") {
          const out = engine.today();
          return done({ content: text(out.text), structuredContent: out.structured, isError: false });
        }
        if (name === "what_can_you_check") {
          const cwd = typeof args.cwd === "string" && args.cwd.trim() ? resolve(args.cwd) : engine.cwd;
          const out = engine.capabilities(cwd);
          return done({ content: text(out.text), structuredContent: out.structured, isError: false });
        }
      } catch (error) {
        // A broken look is said as such to the model, which can go on without it.
        return done({ content: text("SkeptOpus could not look: " + String(error?.message ?? error).slice(0, 200)), isError: true });
      }
      return fail(-32602, "Unknown tool: " + String(name));
    }
    default:
      return fail(-32601, "Method not found: " + msg.method);
  }
}

/** The stdio loop: one JSON-RPC message per line in, one per line out. Logs, if any, go to stderr. */
export function serve(engine, { input = process.stdin, output = process.stdout } = {}) {
  const state = {};
  const rl = createInterface({ input, crlfDelay: Infinity });
  const pending = new Set();
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      output.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }) + "\n");
      return;
    }
    // Batches belong to an older revision: each message is answered on its own.
    const batch = Array.isArray(msg) ? msg : [msg];
    for (const one of batch) {
      const job = answer(one, engine, state).then((out) => {
        if (out) output.write(JSON.stringify(out) + "\n");
      });
      pending.add(job);
      job.finally(() => pending.delete(job));
    }
  });
  return new Promise((done) => rl.on("close", () => Promise.allSettled([...pending]).then(() => done())));
}
