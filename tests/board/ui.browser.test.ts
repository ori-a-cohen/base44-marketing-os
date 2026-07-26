import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { chromium, type Browser, type Page } from "playwright";
import { startServer } from "../../src/board/server.js";
import { readCards } from "../../src/cards/store.js";
import { computeBoard } from "../../src/board/compute.js";
import { renderPage } from "../../src/render/page.js";
import { parseTokens } from "../../src/lint/tokens.js";

/**
 * Behavioural coverage for src/board/ui.html, in a real browser.
 *
 * The static checks live in ui.test.ts and run in milliseconds; this file
 * exists for the things only a browser can answer -- does the fetch/render
 * cycle actually produce the rows, do the empty states render as words
 * instead of zeros, and (the one that matters most) does embedding a card's
 * own page in the preview leave the visits log untouched.
 *
 * Composed from the two harnesses already in this repo: startServer into a
 * mkdtemp dir (tests/board/server.test.ts) plus a single shared
 * chromium.launch (tests/render/page.browser.test.ts), so this is not the
 * test that makes the suite slow.
 */

let dir: string;
let server: Server;
let base: string;
let cardsPath: string;
let visitsPath: string;
let pagesDir: string;
let browser: Browser;
let page: Page;
let consoleErrors: string[] = [];

/** One row per case the display rules have to get right. */
const FIXTURE_CARDS: readonly Record<string, unknown>[] = [
  // The starter's example cards, verbatim from data/content-cards.example.jsonl:
  // unregistered channels, real guardian scores across all three rules.md
  // bands, a legacy status, and an off-platform evidence URL.
  {
    id: "cc-001", channel: "linkedin", topic: "feature launch post", status: "shipped",
    guardian_score: 9.5, created: "2026-07-01", evidence: "https://www.linkedin.com/posts/example-123",
    history: ["drafted", "approved 9.5"],
  },
  {
    id: "cc-002", channel: "email", topic: "monthly customer update", status: "approved",
    guardian_score: 9.0, created: "2026-07-10", evidence: null,
  },
  {
    id: "cc-003", channel: "x", topic: "build-in-public thread", status: "review",
    guardian_score: 7.0, created: "2026-07-14", evidence: null,
  },
  // A measured card with a real page artifact and a value of 0.
  {
    id: "cc-zero", channel: "landing_page", surface: "landing_page", topic: "Zero visits",
    status: "measured", created: "2026-07-20", shipped_at: "2026-07-21T00:00:00Z",
    artifacts: { page_slug: "base1" },
    attributes: {
      slug: "base1", headline: "Base1 builds your app", subhead: "First in-house model.",
      body: "Trained on real building patterns.", ctaLabel: "Start building", ctaHref: "https://base44.com",
    },
    outcome: {
      card_id: "cc-zero", surface: "landing_page", metric: "visits", value: 0, unit: "count",
      measured_at: "2026-07-21T01:00:00Z", source: "local-visits", provenance: "real",
    },
  },
  // Money: the only unit that gets a currency symbol.
  {
    id: "cc-usd", channel: "linkedin_ads", surface: "linkedin_ads", topic: "Paid test",
    status: "measured", created: "2026-07-20", shipped_at: "2026-07-21T00:00:00Z",
    outcome: {
      card_id: "cc-usd", surface: "linkedin_ads", metric: "cost_per_signup", value: 1234.5, unit: "usd",
      measured_at: "2026-07-21T01:00:00Z", source: "csv-import", provenance: "manual",
    },
  },
  // Shipped on a live surface, never measured.
  {
    id: "cc-await", channel: "landing_page", surface: "landing_page", topic: "Awaiting measurement",
    status: "shipped", created: "2026-07-20", shipped_at: "2026-07-21T00:00:00Z",
  },
  // A stub surface with no credentials configured.
  {
    id: "cc-stub", channel: "meta_ads", surface: "meta_ads", topic: "Meta campaign",
    status: "shipped", created: "2026-07-20", shipped_at: "2026-07-21T00:00:00Z",
  },
  // A regenerated card: only v2 may appear.
  {
    id: "cc-dup", channel: "landing_page", surface: "landing_page", topic: "Superseded draft",
    status: "drafted", created: "2026-07-20", version: 1,
  },
  {
    id: "cc-dup", channel: "landing_page", surface: "landing_page", topic: "Current draft",
    status: "drafted", created: "2026-07-20", version: 2,
  },
];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "rt-ui-"));
  cardsPath = join(dir, "cards.jsonl");
  visitsPath = join(dir, "visits.jsonl");
  pagesDir = join(dir, "pages");

  writeFileSync(cardsPath, FIXTURE_CARDS.map((c) => JSON.stringify(c)).join("\n") + "\n", "utf8");

  // A real rendered page, not a stub: the preview test needs the actual
  // artifact, including its /api/visit beacon, for the sandbox assertion to
  // mean anything.
  const tokens = parseTokens(readFileSync("brand/DESIGN.md", "utf8"));
  mkdirSync(join(pagesDir, "cc-zero"), { recursive: true });
  writeFileSync(
    join(pagesDir, "cc-zero", "index.html"),
    renderPage(
      {
        cardId: "cc-zero", slug: "base1", headline: "Base1 builds your app",
        subhead: "First in-house model.", body: "Trained on real building patterns.",
        ctaLabel: "Start building", ctaHref: "https://base44.com",
        audienceId: "solo-builder", campaignId: "base1-launch",
      },
      tokens,
    ),
    "utf8",
  );

  const started = await startServer({ port: 0, cardsPath, visitsPath, pagesDir });
  server = started.server;
  base = `http://127.0.0.1:${started.port}`;

  browser = await chromium.launch();
  page = await browser.newPage();
  page.on("console", (msg) => {
    // favicon.ico is not served by this server and never has been; it is
    // noise from the browser, not from the board's own code.
    if (msg.type() === "error" && !msg.text().includes("favicon")) consoleErrors.push(msg.text());
  });
  await page.goto(base, { waitUntil: "networkidle" });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  server?.close();
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Waits for a condition to become truthy, returning whatever it produced.
 *
 * Browser state settles asynchronously and a CI runner is slower than a
 * laptop, so reading it once is a race -- and a racy assertion that happens
 * to pass locally is worse than no assertion, because it looks like coverage.
 * Returns undefined on timeout rather than throwing, so the caller's own
 * expect() reports the real failure.
 */
async function until<T>(probe: () => T | Promise<T>, timeoutMs = 15_000): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) return undefined;
    await new Promise((r) => setTimeout(r, 50));
  }
}

/**
 * The collapsed summary line only. innerText (not textContent) on purpose:
 * it sees what a reader sees, so an assertion that a summary contains no
 * digit cannot be satisfied by text hidden inside the closed detail.
 */
async function summaryText(cardId: string): Promise<string> {
  return (await page.locator(`details[data-card-id="${cardId}"] > summary`).innerText()).trim();
}

/**
 * The expanded detail, read via textContent so it works while the row is
 * still closed -- opening every row just to read it would make each
 * assertion depend on the disclosure behaviour of the one before it.
 */
async function detailText(cardId: string): Promise<string> {
  return ((await page.locator(`details[data-card-id="${cardId}"] .c-detail`).textContent()) ?? "").trim();
}

describe("board UI: the headline", () => {
  it("shows computeBoard's own label, never a number recomputed in the client", async () => {
    const expected = computeBoard(readCards(cardsPath), new Date()).metricLabel;
    expect(await page.locator('[data-testid="metric"]').innerText()).toBe(expected);
  });

  it("states the malformed count in words rather than leaving it inside the string", async () => {
    const malformed = computeBoard(readCards(cardsPath), new Date()).metric.malformed;
    const text = await page.locator('[data-testid="malformed"]').innerText();
    if (malformed > 0) {
      expect(text).toContain("without a readable ship time");
    } else {
      expect(text).toBe("");
    }
  });
});

describe("board UI: campaigns", () => {
  it("renders one row per current card, and none for a superseded version", async () => {
    // Nine fixture rows, but cc-dup is two versions of one logical card.
    expect(await page.locator('[data-testid="campaign-row"]').count()).toBe(FIXTURE_CARDS.length - 1);
    expect(await summaryText("cc-dup")).toContain("Current draft");
    expect(await summaryText("cc-dup")).not.toContain("Superseded draft");
  });

  it("sorts the card awaiting approval to the top", async () => {
    const first = page.locator('[data-testid="campaign-row"]').first();
    expect(await first.getAttribute("data-card-id")).toBe("cc-002");
  });

  it("counts what is awaiting approval", async () => {
    expect(await page.locator("#campaign-summary").innerText()).toBe("1 card awaiting your approval.");
  });

  it("shows the guardian score with its rules.md band, without opening the card", async () => {
    expect(await summaryText("cc-001")).toContain("9.5 release");
    expect(await summaryText("cc-003")).toContain("7 fixes inline, then release");
  });

  it("labels a legacy status rather than silently normalising it", async () => {
    const text = await summaryText("cc-003");
    expect(text).toContain("REVIEW");
    expect(text).toContain("legacy status");
  });

  it("labels an unregistered channel instead of printing its raw id", async () => {
    expect(await summaryText("cc-001")).toContain("LinkedIn");
    expect(await summaryText("cc-001")).not.toMatch(/\blinkedin\b/);
    expect(await summaryText("cc-002")).toContain("Email");
  });
});

describe("board UI: a value of 0 is a measurement, null is not", () => {
  it("renders a measured zero as 0, never as an em-dash", async () => {
    const text = await summaryText("cc-zero");
    expect(text).toContain("0 count");
    expect(text).toContain("visits");
  });

  it("renders an unmeasured shipped card as an em-dash with no zero anywhere", async () => {
    const text = await summaryText("cc-await");
    expect(text).toContain("shipped, awaiting measurement");
    expect(text).not.toContain("0");
  });

  it("renders a stub surface as not configured, with no digits invented", async () => {
    const text = await summaryText("cc-stub");
    expect(text).toContain("available, not configured");
    expect(text).not.toMatch(/\d/);
  });

  it("renders an unregistered channel as not a measured surface", async () => {
    expect(await summaryText("cc-002")).toContain("not a measured surface");
  });
});

describe("board UI: money", () => {
  it("gives a usd value a currency symbol and thousands separators", async () => {
    expect(await summaryText("cc-usd")).toContain("$1,234.50");
  });

  it("never gives a count a currency symbol", async () => {
    expect(await summaryText("cc-zero")).not.toContain("$");
  });

  it("shows the provenance that let the value count", async () => {
    const text = await detailText("cc-usd");
    expect(text).toContain("manual");
    expect(text).toContain("csv-import");
  });
});

describe("board UI: copy, links and preview", () => {
  it("shows the persisted copy for a card that has it", async () => {
    const text = await detailText("cc-zero");
    expect(text).toContain("Base1 builds your app");
    expect(text).toContain("Start building");
    expect(text).toContain("https://base44.com");
  });

  it("says so plainly for a card with no persisted copy, never falling back to the topic", async () => {
    const text = await detailText("cc-001");
    expect(text).toContain("not recorded on this card");
    expect(text).not.toContain("feature launch post");
  });

  it("makes evidence the live link for a channel that ships off-platform", async () => {
    const link = page.locator('details[data-card-id="cc-001"] a[href^="https://www.linkedin.com"]');
    expect(await link.count()).toBe(1);
    expect(await link.textContent()).toBe("View on LinkedIn");
  });

  it("offers no preview for a card with no page artifact", async () => {
    expect(await page.locator('details[data-card-id="cc-001"] iframe').count()).toBe(0);
    expect(await detailText("cc-001")).toContain("ships off-platform");
  });

  it("escapes card-controlled text rather than letting it become markup", async () => {
    // esc() covers the five characters that break out of markup or an
    // attribute; the board interpolates card copy, ids and history into
    // innerHTML, so this is a live concern, not a theoretical one.
    const injected = await page.evaluate(() => document.querySelectorAll("#campaigns script").length);
    expect(injected).toBe(0);
  });
});

describe("board UI: a preview is not a visit", () => {
  /**
   * The highest-value assertion in this suite.
   *
   * Every generated page POSTs /api/visit on load, and that feeds
   * outcome.value and therefore the headline. The preview embeds a card's own
   * page, same-origin -- so without the sandbox the board would manufacture
   * the number it exists to report honestly.
   *
   * Two layers are under test at once: sandbox="" on the iframe, and the
   * page's own window.top === window.self guard. The control below proves the
   * beacon is genuinely live, so a green result here can never be a beacon
   * that simply never fires.
   */
  it("records nothing when the preview loads", async () => {
    expect(existsSync(visitsPath)).toBe(false);

    // Armed before the click: the response is what proves the frame's
    // document really was fetched and parsed, so the beacon had its chance
    // to fire and was stopped -- rather than never having run at all.
    const previewLoaded = page.waitForResponse(
      (res) => res.url().endsWith("/c/cc-zero/base1/index.html"),
      { timeout: 15_000 },
    );
    await page.locator('details[data-card-id="cc-zero"] > summary').click();

    const frame = page.locator('details[data-card-id="cc-zero"] iframe');
    expect(await frame.getAttribute("src")).toBe("/c/cc-zero/base1/index.html");
    expect((await previewLoaded).status()).toBe(200);

    // Read through Playwright's frame API, not contentDocument: sandbox=""
    // gives the frame an opaque origin, so the parent document cannot reach
    // into it at all. That inaccessibility IS the guarantee under test.
    //
    // Polled rather than read once: the HTTP response arriving does not mean
    // the frame has attached and committed its document yet, and on a slower
    // machine it has not (this read once, and CI caught it). Waiting for the
    // frame to actually render its content is what makes the visits check
    // below meaningful -- a beacon that never got the chance to fire would
    // leave the log empty for the wrong reason.
    const previewFrame = await until(
      () => page.frames().find((f) => f.url().endsWith("/c/cc-zero/base1/index.html")),
    );
    expect(previewFrame).toBeDefined();
    await until(async () =>
      ((await previewFrame?.locator("h1").textContent()) ?? "").includes("Base1 builds your app"),
    );

    // The beacon is fire-and-forget, so give a real POST time to land before
    // concluding that none was sent.
    await page.waitForTimeout(500);

    expect(existsSync(visitsPath)).toBe(false);
  }, 30_000);

  it("the browser itself reports refusing to run the framed page's script", async () => {
    // Positive proof rather than an absence: Chromium says it blocked the
    // script because the frame is sandboxed. If this message ever stops
    // appearing, the sandbox stopped applying and the assertion above would
    // be passing for the wrong reason.
    //
    // Polled for the same reason as the frame above: the console message
    // arrives asynchronously, after the frame's document commits.
    await until(() => consoleErrors.some((e) => /sandbox/i.test(e)));
    expect(consoleErrors.join(" | ")).toMatch(/sandbox/i);
  }, 20_000);

  it("control: the same page loaded directly does record a visit", async () => {
    const direct = await browser.newPage();
    await direct.goto(`${base}/c/cc-zero/base1`, { waitUntil: "networkidle" });
    await direct.close();

    expect(existsSync(visitsPath)).toBe(true);
    expect(readFileSync(visitsPath, "utf8")).toContain('"card_id":"cc-zero"');
  }, 20_000);
});

describe("board UI: diagnostics still render", () => {
  it("keeps the aggregate tables below the campaigns", async () => {
    expect(await page.locator('[data-testid="per-surface"] tbody tr').count()).toBeGreaterThan(0);
    expect(await page.locator('[data-testid="rule-accountability"] tbody tr').count()).toBe(8);
    expect(await page.locator('[data-testid="stub-surfaces"] li').count()).toBeGreaterThan(0);
  });

  it("marks an unregistered surface as unscoreable rather than scoring it off the fallback benchmark", async () => {
    const perSurface = await page.locator('[data-testid="per-surface"]').innerText();
    expect(perSurface).toContain("not a measured surface");
    expect(perSurface).toContain("LinkedIn");
  });

  it("logs no console errors of its own", () => {
    // The sandbox-block message is expected and asserted positively above --
    // it is the browser confirming the preview cannot run scripts. Anything
    // else is a real defect. Joined so a failure prints the message rather
    // than "Array(1)".
    const unexpected = consoleErrors.filter((e) => !/sandbox/i.test(e));
    expect(unexpected.join(" | ")).toBe("");
  });
});
