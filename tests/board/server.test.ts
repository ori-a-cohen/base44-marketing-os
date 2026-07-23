import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { startServer } from "../../src/board/server.js";
import { readCards } from "../../src/cards/store.js";
import { readVisits } from "../../src/adapters/local-visits.js";
import { parseCard } from "../../src/cards/schema.js";
import { computeBoard } from "../../src/board/compute.js";

let dir: string;
let server: Server;
let base: string;
let cardsPath: string;
let visitsPath: string;
let pagesDir: string;

const PAGE_HTML = "<!doctype html><html><body>cc-1 page</body></html>";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "rt-s-"));
  cardsPath = join(dir, "cards.jsonl");
  visitsPath = join(dir, "visits.jsonl");
  pagesDir = join(dir, "pages");

  writeFileSync(
    cardsPath,
    JSON.stringify({
      id: "cc-1", channel: "landing_page", surface: "landing_page", topic: "Base1",
      status: "shipped", created: "2026-07-20", shipped_at: "2026-07-21T00:00:00Z",
      artifacts: { page_slug: "base1" },
    }) + "\n",
  );

  mkdirSync(join(pagesDir, "cc-1"), { recursive: true });
  writeFileSync(join(pagesDir, "cc-1", "index.html"), PAGE_HTML, "utf8");

  const started = await startServer({
    port: 0, cardsPath, visitsPath, pagesDir, ingestToken: "secret",
  });
  server = started.server;
  base = `http://127.0.0.1:${started.port}`;
});

afterAll(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("board server", () => {
  it("serves the board UI at the root", async () => {
    const res = await fetch(base);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("serves the board view as JSON", async () => {
    const body = await (await fetch(`${base}/api/board`)).json();
    expect(body).toHaveProperty("metricLabel");
    expect(body).toHaveProperty("ruleAccountability");
  });

  describe("POST /api/visit", () => {
    it("records a visit and returns 204", async () => {
      const res = await fetch(`${base}/api/visit`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ card_id: "cc-1", kind: "view" }),
      });
      expect(res.status).toBe(204);

      const { visits } = readVisits(visitsPath);
      const recorded = visits.find((v) => v.card_id === "cc-1" && v.kind === "view");
      expect(recorded).toBeDefined();
      expect(Number.isNaN(new Date(recorded?.at ?? "").getTime())).toBe(false);
    });

    it("rejects a visit with no card id", async () => {
      const res = await fetch(`${base}/api/visit`, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}",
      });
      expect(res.status).toBe(400);
    });

    it("rejects a visit for a card id that does not exist", async () => {
      const res = await fetch(`${base}/api/visit`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ card_id: "does-not-exist", kind: "view" }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects a visit whose kind is outside view|click", async () => {
      const res = await fetch(`${base}/api/visit`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ card_id: "cc-1", kind: "purchase" }),
      });
      expect(res.status).toBe(400);
    });

    it("4xxs a malformed (non-JSON) POST body instead of crashing", async () => {
      const res = await fetch(`${base}/api/visit`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: "not json at all {{{",
      });
      expect(res.status).toBe(400);

      // Prove the server is still alive and serving after the bad request.
      const followUp = await fetch(base);
      expect(followUp.status).toBe(200);
    });

    it("does not let the request body set provenance -- Visit has no such field to set", async () => {
      const res = await fetch(`${base}/api/visit`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ card_id: "cc-1", kind: "view", provenance: "seeded" }),
      });
      expect(res.status).toBe(204);
      const { visits } = readVisits(visitsPath);
      // Every recorded visit only ever has card_id/at/kind -- confirmed by
      // parseVisit's own shape (src/adapters/local-visits.ts) never carrying
      // a provenance field at all, so a smuggled field cannot get through.
      expect(Object.keys(visits[visits.length - 1] ?? {}).sort()).toEqual(["at", "card_id", "kind"]);
    });
  });

  describe("POST /api/cards (token-gated ingest)", () => {
    it("rejects card ingest without the token", async () => {
      const res = await fetch(`${base}/api/cards`, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}",
      });
      expect(res.status).toBe(401);
    });

    it("rejects card ingest with the wrong token", async () => {
      const res = await fetch(`${base}/api/cards`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer wrong-token" },
        body: JSON.stringify({ id: "cc-ingest-1", channel: "landing_page", topic: "x", status: "drafted", created: "2026-07-23" }),
      });
      expect(res.status).toBe(401);
    });

    it("accepts card ingest with the correct token", async () => {
      const res = await fetch(`${base}/api/cards`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer secret" },
        body: JSON.stringify({ id: "cc-ingest-2", channel: "landing_page", topic: "x", status: "drafted", created: "2026-07-23" }),
      });
      expect(res.status).toBe(201);
      expect(readCards(cardsPath).some((c) => c.id === "cc-ingest-2")).toBe(true);
    });

    it("4xxs a malformed ingest body instead of crashing", async () => {
      const res = await fetch(`${base}/api/cards`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer secret" },
        body: "not json at all {{{",
      });
      expect(res.status).toBe(400);

      const followUp = await fetch(base);
      expect(followUp.status).toBe(200);
    });

    it("4xxs an ingest body that parses as JSON but fails card validation", async () => {
      const res = await fetch(`${base}/api/cards`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer secret" },
        body: JSON.stringify({ channel: "landing_page" }), // no id, no status
      });
      expect(res.status).toBe(400);
    });

    it("rejects a card id containing path-traversal characters even with a valid token", async () => {
      const res = await fetch(`${base}/api/cards`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer secret" },
        body: JSON.stringify({
          id: "../../etc/evil", channel: "landing_page", topic: "x", status: "drafted", created: "2026-07-23",
        }),
      });
      expect(res.status).toBe(400);
      expect(readCards(cardsPath).some((c) => c.id.includes(".."))).toBe(false);
    });
  });

  describe("GET /c/:cardId/:slug", () => {
    it("serves a known card's generated page", async () => {
      const res = await fetch(`${base}/c/cc-1/base1`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(await res.text()).toBe(PAGE_HTML);
    });

    it("returns 404 for an unknown card page", async () => {
      expect((await fetch(`${base}/c/nope/slug`)).status).toBe(404);
    });

    it("returns 404 when the slug does not match the card's stored slug", async () => {
      expect((await fetch(`${base}/c/cc-1/wrong-slug`)).status).toBe(404);
    });

    it("resolves the card through the store, not the filesystem -- an encoded traversal id 404s rather than escaping pagesDir", async () => {
      const traversalId = encodeURIComponent("../../etc/passwd");
      const res = await fetch(`${base}/c/${traversalId}/slug`);
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain("root:");
    });

    it("a literal (unencoded) traversal path never even reaches the route -- URL normalization strips it, and the fallback 404s", async () => {
      const res = await fetch(`${base}/c/../../etc/passwd/slug`);
      expect(res.status).toBe(404);
    });
  });

  it("returns 404 for an unrecognised route", async () => {
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });
});

describe("board JSON matches computeBoard for a known card set", () => {
  let dir2: string;
  let server2: Server;
  let base2: string;
  let cardsPath2: string;

  beforeAll(async () => {
    dir2 = mkdtempSync(join(tmpdir(), "rt-s2-"));
    cardsPath2 = join(dir2, "cards.jsonl");

    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
    const cards = [
      parseCard({
        id: "parity-a", channel: "landing_page", surface: "landing_page", topic: "Base1",
        status: "measured", created: "2026-07-20", shipped_at: dayAgo,
        outcome: {
          card_id: "parity-a", surface: "landing_page", metric: "visits", value: 25,
          unit: "count", measured_at: dayAgo, source: "local-visits", provenance: "real",
        },
      }),
      parseCard({
        id: "parity-b", channel: "landing_page", surface: "landing_page", topic: "Base1",
        status: "shipped", created: "2026-07-20", shipped_at: dayAgo,
      }),
      parseCard({
        id: "parity-c", channel: "meta_ads", surface: "meta_ads", topic: "Base1",
        status: "shipped", created: "2026-07-20", shipped_at: dayAgo,
      }),
    ];
    writeFileSync(cardsPath2, cards.map((c) => JSON.stringify(c)).join("\n") + "\n");

    const started = await startServer({ port: 0, cardsPath: cardsPath2, visitsPath: join(dir2, "visits.jsonl") });
    server2 = started.server;
    base2 = `http://127.0.0.1:${started.port}`;
  });

  afterAll(() => {
    server2.close();
    rmSync(dir2, { recursive: true, force: true });
  });

  it("serves computeBoard's output verbatim, never recomputed or adjusted", async () => {
    const body = await (await fetch(`${base2}/api/board`)).json();
    const expected = computeBoard(readCards(cardsPath2), new Date());
    expect(body).toEqual(JSON.parse(JSON.stringify(expected)));
  });
});

describe("cold start: no cards.jsonl, no visits.jsonl, no ingest token", () => {
  let dir3: string;
  let server3: Server;
  let base3: string;

  beforeAll(async () => {
    dir3 = mkdtempSync(join(tmpdir(), "rt-s3-"));
    const started = await startServer({
      port: 0,
      cardsPath: join(dir3, "cards.jsonl"),
      visitsPath: join(dir3, "visits.jsonl"),
      pagesDir: join(dir3, "pages"),
      // ingestToken intentionally omitted
    });
    server3 = started.server;
    base3 = `http://127.0.0.1:${started.port}`;
  });

  afterAll(() => {
    server3.close();
    rmSync(dir3, { recursive: true, force: true });
  });

  it("serves an empty board without throwing", async () => {
    const res = await fetch(`${base3}/api/board`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.metricLabel).toBe("—");
    expect(body.cards).toEqual([]);
  });

  it("closes ingest entirely when BOARD_INGEST_TOKEN is unset -- never open-by-default", async () => {
    const res = await fetch(`${base3}/api/cards`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer anything" },
      body: JSON.stringify({ id: "x", channel: "landing_page", topic: "x", status: "drafted", created: "2026-07-23" }),
    });
    expect(res.status).toBe(401);
  });

  it("still 404s cleanly for a page route with no cards and no pages dir", async () => {
    expect((await fetch(`${base3}/c/anything/slug`)).status).toBe(404);
  });

  it("reads the file verbatim, using fileURLToPath (not .pathname) so the space in this repo's directory does not break the root path", async () => {
    const html = await (await fetch(base3)).text();
    expect(html.length).toBeGreaterThan(0);
  });
});
