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

/**
 * Task 14's follow-up finding: the `finally` block's `await browser.close()`
 * was itself unguarded. If close() rejects -- a real Playwright failure mode
 * when the browser process has already crashed -- that rejection propagated
 * uncaught, discarding whatever result the try/catch above had already
 * computed. These tests mock `close()` to throw and assert the function still
 * resolves to a controlled result rather than rejecting, in both the
 * checks-succeeded and checks-also-failed cases.
 */
describe("verifyPageHtml when browser.close() rejects", () => {
  it("resolves to the computed result (does not reject) and logs the close error to stderr", async () => {
    vi.resetModules();
    vi.doMock("node:fs", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs")>();
      return { ...actual, existsSync: vi.fn(() => true) };
    });

    const closeRejectMock = vi.fn(async () => {
      throw new Error("simulated browser.close() failure");
    });

    vi.doMock("playwright", async (importOriginal) => {
      const actual = await importOriginal<typeof import("playwright")>();
      return {
        ...actual,
        chromium: {
          ...actual.chromium,
          executablePath: () => "/fake/chromium-path",
          launch: vi.fn(async () => {
            // verifyPageHtml calls page.evaluate() twice: once for the
            // x-card-id meta tag (expects a truthy string or null) and once
            // for document.documentElement.scrollWidth (expects a number).
            // A call counter lets one mock satisfy both in order without
            // needing to parse the function bodies passed in.
            let evaluateCallCount = 0;
            return {
              newPage: vi.fn(async () => ({
                setContent: vi.fn(async () => {}),
                locator: vi.fn(() => ({
                  count: vi.fn(async () => 1),
                  getAttribute: vi.fn(async (attr: string) =>
                    attr === "href" ? "https://example.com/?utm_content=a&utm_campaign=b" : null,
                  ),
                  innerText: vi.fn(
                    async () =>
                      "Demo — built by Ori Cohen for the Base44 take-home. Not official Base44 content.",
                  ),
                })),
                evaluate: vi.fn(async () => {
                  evaluateCallCount += 1;
                  return evaluateCallCount === 1 ? "card-id-value" : 0;
                }),
              })),
              close: closeRejectMock,
            };
          }),
        },
      };
    });

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { verifyPageHtml } = await import("../../src/verify/page.js");
    const { MARKER_TEXT } = await import("../../src/render/page.js");

    await expect(
      verifyPageHtml(
        `<html><body><h1>Title</h1><a class="cta" href="https://example.com/?utm_content=a&utm_campaign=b">Go</a><meta name="x-card-id" content="abc"><p>${MARKER_TEXT}</p></body></html>`,
      ),
    ).resolves.toEqual({ pass: true, failures: [] });

    expect(closeRejectMock).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls[0]?.[0]).toMatch(/browser\.close\(\) failed/i);
    expect(consoleErrorSpy.mock.calls[0]?.[0]).toMatch(/simulated browser\.close\(\) failure/i);

    consoleErrorSpy.mockRestore();
    vi.doUnmock("node:fs");
    vi.doUnmock("playwright");
  });

  it("still resolves to a controlled fail when both a mid-check error and a close() rejection occur", async () => {
    vi.resetModules();
    vi.doMock("node:fs", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs")>();
      return { ...actual, existsSync: vi.fn(() => true) };
    });

    const closeRejectMock = vi.fn(async () => {
      throw new Error("simulated browser.close() failure during error path");
    });

    vi.doMock("playwright", async (importOriginal) => {
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
            close: closeRejectMock,
          })),
        },
      };
    });

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { verifyPageHtml } = await import("../../src/verify/page.js");

    const result = await verifyPageHtml("<html><body>irrelevant</body></html>");

    expect(result.pass).toBe(false);
    expect(result.skippedReason).toBeUndefined();
    expect(result.failures.join(" ")).toMatch(/verification error/i);
    expect(result.failures.join(" ")).toMatch(/simulated mid-verification playwright failure/i);

    expect(closeRejectMock).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls[0]?.[0]).toMatch(/browser\.close\(\) failed/i);

    consoleErrorSpy.mockRestore();
    vi.doUnmock("node:fs");
    vi.doUnmock("playwright");
  });
});
