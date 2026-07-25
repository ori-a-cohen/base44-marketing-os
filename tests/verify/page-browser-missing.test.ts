import { describe, it, expect, vi } from "vitest";

/**
 * Tests the "browser binary is missing" posture without depending on this
 * machine's actual Chromium install state. The project's cold-run
 * constraint means a fresh clone may genuinely have no browser installed,
 * so this guard logic must be exercised deterministically on every machine
 * -- including this one, where Chromium happens to be present -- rather
 * than only by accident on a stranger's uninstalled clone. See the
 * cold-run note in this task's brief.
 *
 * `isChromiumInstalled` is tested directly with a path guaranteed not to
 * exist (fast, synchronous, no mocking needed). The full skip path through
 * `verifyPageHtml` is then tested by mocking `node:fs`'s `existsSync` so the
 * production code's own "no browser" branch runs for real, end to end,
 * without ever attempting to launch a real browser -- vi.mock is
 * file-scoped, so this does not affect any other test file's use of `fs`.
 */
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn(() => false) };
});

describe("verifyPageHtml when Chromium is not installed", () => {
  it("isChromiumInstalled reports false for a path that does not exist", async () => {
    // Deliberately imported after the mock is registered above (vi.mock is
    // hoisted by vitest), but this predicate call is a plain synchronous
    // filesystem check unrelated to the mock -- kept in this file rather
    // than page.test.ts because vi.mock applies per test file, and grouping
    // both missing-browser assertions here keeps the guard's tests in one
    // place with the reasoning that motivates them.
    const { isChromiumInstalled } = await import("../../src/verify/page.js");
    expect(isChromiumInstalled("/definitely/does/not/exist/chromium-binary")).toBe(false);
  });

  it("verifyPageHtml returns a skipped (not pass, not fail) result when no browser is installed", async () => {
    const { verifyPageHtml } = await import("../../src/verify/page.js");
    const result = await verifyPageHtml("<html><body>irrelevant</body></html>");

    // pass:false because a page nobody could check is not shippable, but
    // failures stays empty -- "could not verify" must never be presented
    // as if it were a defect found in the page's own content.
    expect(result.pass).toBe(false);
    expect(result.failures).toEqual([]);
    expect(result.skippedReason).toBeDefined();
    expect(result.skippedReason).toMatch(/chromium|browser/i);
    expect(result.skippedReason).toMatch(/playwright install/i);
  });
});
