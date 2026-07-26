import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, timingSafeEqual } from "node:crypto";
import { readCards, appendCard } from "../cards/store.js";
import { parseCard, type Card } from "../cards/schema.js";
import { recordVisit } from "../adapters/local-visits.js";
import { computeBoard } from "./compute.js";

export interface ServerOptions {
  readonly port: number;
  readonly cardsPath: string;
  readonly visitsPath: string;
  readonly pagesDir?: string;
  readonly ingestToken?: string;
}

/**
 * Resolved relative to this module file with `fileURLToPath`, never
 * `.pathname` -- the repo root contains a space ("Base44 MarketingOS"),
 * which `.pathname` would leave percent-encoded (`%20`), making every
 * `existsSync`/`readFileSync` against it silently fail. See CLAUDE.md's
 * "hard-won lessons" and src/render/card-image.ts for the same fix.
 */
const UI_PATH = fileURLToPath(new URL("./ui.html", import.meta.url));

function send(res: ServerResponse, status: number, body: string, type: string): void {
  res.writeHead(status, { "content-type": type });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  send(res, status, JSON.stringify(body), "application/json");
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Constant-time token comparison. Both sides are hashed to a fixed-length
 * (32-byte) SHA-256 digest before `timingSafeEqual` runs, rather than
 * comparing the raw strings directly -- `timingSafeEqual` requires
 * equal-length buffers and throws otherwise, which would itself leak
 * "your token's length was wrong" through an exception/early branch if the
 * raw (variable-length) strings were compared. Hashing first makes both
 * inputs to the timing-safe comparison always the same length, so neither
 * the length nor the content of a wrong guess is observable through timing.
 * This is a deliberate choice over a plain `===`, which is not
 * constant-time and can leak a prefix match through response timing on a
 * hosted deployment.
 */
function timingSafeStringsEqual(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a, "utf8").digest();
  const digestB = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(digestA, digestB);
}

const BEARER_PREFIX = /^Bearer\s+/i;

/**
 * The ingest route's posture: closed unless BOARD_INGEST_TOKEN (or an
 * explicit ingestToken) is configured. An unset token must never mean
 * "open" -- a write-anything endpoint with no gate on a hosted URL is
 * exactly the hole this check exists to close. When a token IS configured,
 * comparison runs through timingSafeStringsEqual above.
 */
function isIngestAuthorized(req: IncomingMessage, ingestToken: string | undefined): boolean {
  if (!ingestToken) return false;
  const header = req.headers.authorization;
  if (typeof header !== "string") return false;
  const provided = header.replace(BEARER_PREFIX, "");
  return timingSafeStringsEqual(provided, ingestToken);
}

/** Rejects a card id that could ever be used to escape pagesDir when joined
 * into a filesystem path -- belt-and-suspenders alongside the page route's
 * own containment check below, so a path-traversal-shaped id can never even
 * enter the store via ingest in the first place. */
function hasPathTraversalRisk(id: string): boolean {
  return id.includes("/") || id.includes("\\") || id.includes("..");
}

interface VisitInput {
  readonly card_id: string;
  readonly kind: "view" | "click";
}

/**
 * Validates the untrusted /api/visit body directly (rather than reusing
 * adapters/local-visits.ts's parseVisit, which additionally requires an
 * `at` field the client never sends -- `at` is always set server-side from
 * the wall clock, never taken from the request). Provenance is never read
 * from the body at all: recordVisit's Visit shape has no provenance field,
 * so there is no field here for a hostile body to set even if it tried.
 */
function parseVisitInput(raw: unknown): VisitInput | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const cardId = obj.card_id;
  if (typeof cardId !== "string" || cardId.length === 0) return null;
  const kindRaw = obj.kind;
  if (kindRaw !== undefined && kindRaw !== "view" && kindRaw !== "click") return null;
  return { card_id: cardId, kind: kindRaw === "click" ? "click" : "view" };
}

async function handleRoot(res: ServerResponse): Promise<void> {
  send(res, 200, readFileSync(UI_PATH, "utf8"), "text/html; charset=utf-8");
}

function handleApiBoard(res: ServerResponse, opts: ServerOptions): void {
  // Serve computeBoard's output verbatim -- never recompute or adjust a
  // number here. computeBoard was hardened across four review rounds
  // specifically so every displayed figure is trustworthy as-is.
  const view = computeBoard(readCards(opts.cardsPath), new Date());
  sendJson(res, 200, view);
}

async function handlePostVisit(req: IncomingMessage, res: ServerResponse, opts: ServerOptions): Promise<void> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readBody(req));
  } catch {
    return sendJson(res, 400, { error: "invalid JSON body" });
  }

  const input = parseVisitInput(raw);
  if (!input) return sendJson(res, 400, { error: "card_id required" });

  const cardExists = readCards(opts.cardsPath).some((c) => c.id === input.card_id);
  if (!cardExists) return sendJson(res, 400, { error: "unknown card_id" });

  recordVisit(opts.visitsPath, { card_id: input.card_id, kind: input.kind, at: new Date().toISOString() });
  res.writeHead(204);
  res.end();
}

async function handlePostCards(req: IncomingMessage, res: ServerResponse, opts: ServerOptions): Promise<void> {
  if (!isIngestAuthorized(req, opts.ingestToken)) {
    return sendJson(res, 401, { error: "unauthorized" });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await readBody(req));
  } catch {
    return sendJson(res, 400, { error: "invalid JSON body" });
  }

  let card: Card;
  try {
    card = parseCard(raw);
  } catch (err) {
    return sendJson(res, 400, { error: (err as Error).message });
  }

  if (hasPathTraversalRisk(card.id)) {
    return sendJson(res, 400, { error: "card.id must not contain path separators" });
  }

  appendCard(opts.cardsPath, card);
  sendJson(res, 201, { ok: true });
}

/**
 * Resolves a card's generated page. The cardId and slug come straight off
 * the URL, but neither is ever used to touch the filesystem directly:
 * cardId is first resolved through the card store (`readCards`), and only
 * a card that both exists AND carries a matching `artifacts.page_slug`
 * proceeds to a file read. A cardId with no matching card -- including any
 * path-traversal payload, encoded or not -- 404s right here, before any
 * `join`/`existsSync`/`readFileSync` call ever sees it.
 *
 * The resolved file path is additionally checked for containment inside
 * pagesDir before it is read, as defense in depth: even a card.id that
 * somehow reached the store containing a path separator (the ingest route
 * above rejects this, but this check does not rely on that being the only
 * way a card ever enters the store) can never cause a read outside
 * pagesDir.
 */
function handleGetPage(res: ServerResponse, opts: ServerOptions, pagesDir: string, rawCardId: string, rawSlug: string): void {
  let cardId: string;
  let slug: string;
  try {
    cardId = decodeURIComponent(rawCardId);
    slug = decodeURIComponent(rawSlug);
  } catch {
    return send(res, 404, "Not found", "text/plain");
  }

  const card = readCards(opts.cardsPath).find((c) => c.id === cardId);
  if (!card || card.artifacts.page_slug !== slug) {
    return send(res, 404, "Not found", "text/plain");
  }

  const baseDir = resolve(pagesDir) + sep;
  const filePath = resolve(pagesDir, card.id, "index.html");
  if (!filePath.startsWith(baseDir) || !existsSync(filePath)) {
    return send(res, 404, "Not found", "text/plain");
  }

  send(res, 200, readFileSync(filePath, "utf8"), "text/html; charset=utf-8");
}

/**
 * Both link forms for a card's generated page.
 *
 * The trailing `index.html` is what the board actually links to, because it
 * is the only form that resolves in BOTH deployments: Base44 hosting serves
 * the deployed file at /c/<id>/<slug>/index.html but does not resolve
 * directory indexes, so a bare /c/<id>/<slug> there falls through to the SPA
 * catch-all and returns the board itself -- which the sandboxed preview would
 * render as a blank frame. Accepting it here costs one optional group and
 * saves a second deployment seam.
 *
 * The bare form stays supported because it is what `artifacts.page_url`
 * already stores on every card, and because it is the nicer URL to type.
 * Only that exact filename is accepted -- this is not a static file server.
 */
const PAGE_ROUTE = /^\/c\/([^/]+)\/([^/]+)(?:\/|\/index\.html)?$/;

async function dispatch(req: IncomingMessage, res: ServerResponse, opts: ServerOptions, pagesDir: string): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;

  if (req.method === "GET" && path === "/") return handleRoot(res);
  if (req.method === "GET" && path === "/api/board") return handleApiBoard(res, opts);
  if (req.method === "POST" && path === "/api/visit") return handlePostVisit(req, res, opts);
  if (req.method === "POST" && path === "/api/cards") return handlePostCards(req, res, opts);

  const page = PAGE_ROUTE.exec(path);
  if (req.method === "GET" && page) {
    return handleGetPage(res, opts, pagesDir, page[1] as string, page[2] as string);
  }

  send(res, 404, "Not found", "text/plain");
}

export async function startServer(opts: ServerOptions): Promise<{ server: Server; port: number }> {
  const pagesDir = opts.pagesDir ?? "build/pages";

  const server = createServer((req, res) => {
    void (async () => {
      try {
        await dispatch(req, res, opts, pagesDir);
      } catch (err) {
        // A crash here would fail the cold-run guarantee (a bad request, a
        // corrupt cards.jsonl line, anything unexpected must degrade to a
        // response, never take the process down). Logged for the operator,
        // never leaked into the response body.
        console.error("[board/server] unhandled error handling request:", err);
        if (!res.headersSent) {
          sendJson(res, 500, { error: "internal server error" });
        } else {
          res.end();
        }
      }
    })();
  });

  return new Promise((resolve_) => {
    server.listen(opts.port, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : opts.port;
      resolve_({ server, port });
    });
  });
}

/**
 * `import.meta.url` percent-encodes a space in the path ("Base44
 * MarketingOS") as `%20`; `process.argv[1]` never does. Comparing them as
 * raw strings (as a naive `file://${process.argv[1]}` check would) fails
 * silently on exactly this repo, so this entrypoint guard would never fire
 * when run via `npm run board`. Converting import.meta.url back to a real
 * filesystem path with fileURLToPath -- and resolving argv[1] the same way
 * -- compares like with like.
 */
const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMainModule) {
  const { port } = await startServer({
    port: Number(process.env.PORT ?? 4174),
    cardsPath: process.env.CARDS_PATH ?? "data/cards.jsonl",
    visitsPath: process.env.VISITS_PATH ?? "data/visits.jsonl",
    ingestToken: process.env.BOARD_INGEST_TOKEN,
  });
  process.stdout.write(`Roundtrip board on http://127.0.0.1:${port}\n`);
}
