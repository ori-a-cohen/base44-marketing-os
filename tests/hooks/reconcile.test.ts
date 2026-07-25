import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Claude Code invokes hooks via an absolute path ($CLAUDE_PROJECT_DIR/hooks/...),
// never a path relative to whatever the current working directory happens to
// be, so the script under test is always addressed absolutely here too.
const HOOK = resolve(__dirname, "../../hooks/reconcile.sh");
const REPO_ROOT = resolve(__dirname, "../..");

/**
 * Starts the real board server (src/board/server.ts) as a genuinely
 * separate OS process. This is deliberate, not incidental: the hook under
 * test runs via spawnSync, which blocks this test file's own event loop
 * for the hook's entire duration. An in-process mock HTTP server (created
 * with node:http in this same process) would be unable to run its request
 * callback until spawnSync returns -- the connection would sit unhandled
 * until curl's own timeout fired, producing a false negative that looks
 * like "the board was unreachable" when it was actually just this test's
 * own event loop being frozen. A child process has its own event loop, so
 * it keeps serving requests while the parent blocks.
 */
async function startBoardServer(cardsPath: string, token?: string): Promise<{ port: number; stop: () => void }> {
  const child: ChildProcessWithoutNullStreams = spawn("npx", ["tsx", "src/board/server.ts"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: "0",
      CARDS_PATH: cardsPath,
      VISITS_PATH: join(dirNameOf(cardsPath), "visits.jsonl"),
      ...(token !== undefined ? { BOARD_INGEST_TOKEN: token } : {}),
    },
  });

  const port = await new Promise<number>((res, rej) => {
    let out = "";
    const onData = (chunk: Buffer): void => {
      out += chunk.toString("utf8");
      const m = /Roundtrip board on http:\/\/127\.0\.0\.1:(\d+)/.exec(out);
      if (m?.[1]) {
        child.stdout.off("data", onData);
        res(Number(m[1]));
      }
    };
    child.stdout.on("data", onData);
    child.on("error", rej);
    setTimeout(() => rej(new Error("board server did not start in time")), 10000);
  });

  return { port, stop: () => child.kill() };
}

function dirNameOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "." : path.slice(0, idx);
}

interface RunOpts {
  readonly cardsPath?: string;
  readonly boardUrl?: string;
  readonly boardToken?: string;
  readonly cwd?: string;
}

function runHook(input: string, opts: RunOpts = {}): { code: number; stderr: string } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (opts.cardsPath !== undefined) env.CARDS_PATH = opts.cardsPath;
  else delete env.CARDS_PATH;
  if (opts.boardUrl !== undefined) env.BOARD_URL = opts.boardUrl;
  else delete env.BOARD_URL;
  if (opts.boardToken !== undefined) env.BOARD_INGEST_TOKEN = opts.boardToken;
  else delete env.BOARD_INGEST_TOKEN;

  // spawnSync (not execFileSync) so stderr is always captured, including on
  // the exit-0 path -- this hook is designed to always exit 0, so a
  // throws-on-nonzero API like execFileSync would never surface stderr at all.
  const result = spawnSync("bash", [HOOK], {
    input,
    encoding: "utf8",
    cwd: opts.cwd,
    env,
  });
  return { code: result.status ?? -1, stderr: result.stderr ?? "" };
}

function transcriptLine(text: string): string {
  return JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } }) + "\n";
}

function readCardIds(path: string): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => (JSON.parse(l) as { id: string }).id);
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rt-hook-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("reconcile hook (Stop hook)", () => {
  it("creates a card for a verdict block with no card, exits 0", () => {
    const transcript = join(dir, "t.jsonl");
    const cards = join(dir, "cards.jsonl");
    writeFileSync(transcript, transcriptLine("VERDICT: APPROVED score 9.5 card-id: cc-hook-1 channel: landing_page"));

    const r = runHook(JSON.stringify({ transcript_path: transcript }), { cardsPath: cards });

    expect(r.code).toBe(0);
    expect(readCardIds(cards)).toContain("cc-hook-1");
  });

  it("no verdict in transcript -> no card created, clean exit", () => {
    const transcript = join(dir, "t.jsonl");
    const cards = join(dir, "cards.jsonl");
    writeFileSync(transcript, transcriptLine("Just chatting about the weather."));

    const r = runHook(JSON.stringify({ transcript_path: transcript }), { cardsPath: cards });

    expect(r.code).toBe(0);
    expect(existsSync(cards)).toBe(false);
  });

  it("re-running on the same transcript is idempotent -- no duplicate card", () => {
    const transcript = join(dir, "t.jsonl");
    const cards = join(dir, "cards.jsonl");
    writeFileSync(transcript, transcriptLine("VERDICT: APPROVED score 9 card-id: cc-hook-2 channel: email"));

    expect(runHook(JSON.stringify({ transcript_path: transcript }), { cardsPath: cards }).code).toBe(0);
    expect(runHook(JSON.stringify({ transcript_path: transcript }), { cardsPath: cards }).code).toBe(0);

    const ids = readCardIds(cards);
    expect(ids.filter((id) => id === "cc-hook-2")).toHaveLength(1);
  });

  it("env vars absent -> local card is still created (no-op is scoped to the board POST only)", () => {
    const transcript = join(dir, "t.jsonl");
    const cards = join(dir, "cards.jsonl");
    writeFileSync(transcript, transcriptLine("VERDICT: APPROVED score 8 card-id: cc-hook-noenv channel: email"));

    const r = runHook(JSON.stringify({ transcript_path: transcript }), { cardsPath: cards });

    expect(r.code).toBe(0);
    expect(readCardIds(cards)).toContain("cc-hook-noenv");
  });

  it("malformed JSON on stdin does not crash, exits 0", () => {
    const r = runHook("{not json", { cardsPath: join(dir, "cards.jsonl") });
    expect(r.code).toBe(0);
  });

  it("empty stdin does not crash, exits 0", () => {
    const r = runHook("", { cardsPath: join(dir, "cards.jsonl") });
    expect(r.code).toBe(0);
  });

  it("missing transcript_path field does not crash, exits 0, no card written", () => {
    const cards = join(dir, "cards.jsonl");
    const r = runHook(JSON.stringify({ session_id: "abc" }), { cardsPath: cards });
    expect(r.code).toBe(0);
    expect(existsSync(cards)).toBe(false);
  });

  it("a transcript path that does not exist on disk does not crash, exits 0", () => {
    const cards = join(dir, "cards.jsonl");
    const r = runHook(JSON.stringify({ transcript_path: join(dir, "nope.jsonl") }), { cardsPath: cards });
    expect(r.code).toBe(0);
    expect(existsSync(cards)).toBe(false);
  });

  it("BOARD_URL/BOARD_INGEST_TOKEN set but board unreachable (dead port) -> stderr note, exit 0, local card intact", () => {
    const transcript = join(dir, "t.jsonl");
    const cards = join(dir, "cards.jsonl");
    writeFileSync(transcript, transcriptLine("VERDICT: APPROVED score 9 card-id: cc-hook-deadport channel: email"));

    const r = runHook(JSON.stringify({ transcript_path: transcript }), {
      cardsPath: cards,
      boardUrl: "http://127.0.0.1:1",
      boardToken: "whatever",
    });

    expect(r.code).toBe(0);
    expect(r.stderr.toLowerCase()).toContain("board");
    expect(readCardIds(cards)).toContain("cc-hook-deadport");
  });

  it("posts the newly created card to a live board when BOARD_URL/BOARD_INGEST_TOKEN are set", async () => {
    const boardCards = join(dir, "board-cards.jsonl");
    const board = await startBoardServer(boardCards, "secret-token");

    try {
      const transcript = join(dir, "t.jsonl");
      const cards = join(dir, "cards.jsonl");
      writeFileSync(transcript, transcriptLine("VERDICT: APPROVED score 9.2 card-id: cc-hook-live channel: landing_page"));

      const r = runHook(JSON.stringify({ transcript_path: transcript }), {
        cardsPath: cards,
        boardUrl: `http://127.0.0.1:${board.port}`,
        boardToken: "secret-token",
      });

      expect(r.code).toBe(0);
      expect(readCardIds(cards)).toContain("cc-hook-live");
      // The board is a separate store: proof of a successful POST is the
      // card now existing in the BOARD's own cards file, not just locally.
      expect(readCardIds(boardCards)).toContain("cc-hook-live");
    } finally {
      board.stop();
    }
  });

  it("does not deliver the card to the board when only BOARD_URL is set (token missing)", async () => {
    const boardCards = join(dir, "board-cards.jsonl");
    // Server configured with a token, but the hook is given no token --
    // ingest is closed on the server side too (task 16), so either the
    // hook never attempts the POST or the server rejects it with 401;
    // either way the board's own store must not gain the card.
    const board = await startBoardServer(boardCards, "server-side-token");

    try {
      const transcript = join(dir, "t.jsonl");
      const cards = join(dir, "cards.jsonl");
      writeFileSync(transcript, transcriptLine("VERDICT: APPROVED score 9 card-id: cc-hook-notoken channel: email"));

      const r = runHook(JSON.stringify({ transcript_path: transcript }), {
        cardsPath: cards,
        boardUrl: `http://127.0.0.1:${board.port}`,
      });

      expect(r.code).toBe(0);
      expect(readCardIds(cards)).toContain("cc-hook-notoken");
      expect(readCardIds(boardCards)).not.toContain("cc-hook-notoken");
    } finally {
      board.stop();
    }
  });

  it("works when invoked from a different working directory", () => {
    const transcript = join(dir, "t.jsonl");
    const cards = join(dir, "cards.jsonl");
    writeFileSync(transcript, transcriptLine("VERDICT: APPROVED score 9 card-id: cc-hook-cwd channel: email"));

    const r = runHook(JSON.stringify({ transcript_path: transcript }), { cardsPath: cards, cwd: tmpdir() });

    expect(r.code).toBe(0);
    expect(readCardIds(cards)).toContain("cc-hook-cwd");
  });
});
