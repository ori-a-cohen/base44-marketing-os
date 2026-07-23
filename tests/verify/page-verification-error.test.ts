import { describe, it, expect, vi } from "vitest";

/**
 * Task 14's report: an unexpected Playwright rejection anywhere inside
 * verifyPageHtml's checks (a page crash, a navigation error, a future check
 * that reintroduces an auto-wait hazard) used to propagate as an uncaught
 * rejection instead of one of the three documented outcomes (pass / fail /
 * skipped). This test forces that mid-verification failure deterministically
 * -- no sleeps, no real browser, no network -- by mocking `playwright` so
 * `chromium.launch()` succeeds but the resulting page's `newPage()` throws,
 * simulating an error that happens after verification has genuinely started.
 * `node:fs`'s `existsSync` is also mocked so `isChromiumInstalled()` reports
 * true without depending on this machine's actual install state, keeping the
 * test on the code path under test (the try/catch inside verifyPageHtml)
 * rather than the earlier missing-browser skip branch.
 */
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn(() => true) };
});

const closeMock = vi.fn(async () => {});

vi.mock("playwright", async (importOriginal) => {
  const actual = await importOriginal<typeof import("playwright")>();
  return {
    ...actual,
    chromium: {
      ...actual.chromium,
      executablePath: () => "/fake/chromium-path",
      launch: vi.fn(async () => ({
        newPage: vi.fn(async () => {
          throw new Error("simulated mid-verification Playwright failure");
        }),
        close: closeMock,
      })),
    },
  };
});

describe("verifyPageHtml when Playwright throws mid-verification", () => {
  it("returns a controlled failure instead of an uncaught rejection, and still closes the browser", async () => {
    const { verifyPageHtml } = await import("../../src/verify/page.js");

    const result = await verifyPageHtml("<html><body>irrelevant</body></html>");

    // A controlled fail (exit code 2 in the CLI), not the missing-browser
    // skip outcome -- verification genuinely started (the browser launched)
    // before it broke, so this is "checked and found broken", not
    // "could not check at all".
    expect(result.pass).toBe(false);
    expect(result.skippedReason).toBeUndefined();
    expect(result.failures.join(" ")).toMatch(/verification error/i);
    expect(result.failures.join(" ")).toMatch(/simulated mid-verification playwright failure/i);

    // The browser must never leak, even on the error path.
    expect(closeMock).toHaveBeenCalledTimes(1);
  });
});
