import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { parseCard, type Card } from "../../src/cards/schema.js";

/**
 * A store whose methods may be sync or async. `CardStore` (sync) and
 * `AsyncCardStore` (async) both satisfy this structurally: a sync `Card[]`
 * is a valid `Card[] | Promise<Card[]>`, and a sync `void` is a valid
 * `void | Promise<void>`. This lets one contract suite exercise both kinds
 * of driver -- every call site below `await`s the result, and awaiting a
 * plain (non-promise) value is a no-op, so a synchronous driver's behavior
 * is unchanged by the suite being written generically.
 */
export interface AnyCardStore {
  read(): Card[] | Promise<Card[]>;
  append(card: Card): void | Promise<void>;
  upsert(card: Card): void | Promise<void>;
}

/**
 * A ready-to-use store plus the plumbing the suite needs to reset and
 * inspect it. `cleanup` releases whatever external resource the factory
 * allocated (a temp dir, a remote fixture, ...). `listDebris` is optional:
 * only file-backed drivers can meaningfully report leftover temp files, so
 * a driver without a filesystem (a hosted API) simply omits it and the
 * debris assertion is skipped rather than faked.
 */
export interface CardStoreFixture {
  readonly store: AnyCardStore;
  readonly cleanup?: () => void;
  readonly listDebris?: () => readonly string[];
}

/**
 * Returns a fresh fixture, or `null` when this driver's prerequisites are
 * absent (e.g. `BASE44_APP_ID` unset for a hosted driver). Called once as a
 * probe to decide skip-vs-run, then once per test for isolation.
 */
export type CardStoreFactory = () => CardStoreFixture | null;

/**
 * A minimal, valid card for contract tests. Exported so every driver's test
 * file (JSONL, Base44's fake-backed and live-gated runs) builds fixtures
 * from the same shape rather than each redefining a slightly different one.
 */
export const sampleCard = (id: string): Card =>
  parseCard({ id, channel: "landing_page", topic: "Base1", status: "drafted", created: "2026-07-23" });

/**
 * Runs the driver-agnostic CardStore contract against any factory. Skips
 * cleanly (via `describe.skipIf`, never a failing test) when the factory's
 * initial probe returns null, so a driver whose prerequisites are absent
 * (Task 16b's Base44CardStore without BASE44_APP_ID) is reported as skipped
 * rather than red.
 *
 * Lives in its own (non-`.test.`) module, separate from any file that
 * calls it, so importing it never re-runs another driver's suite as an
 * import side effect -- each `*.test.ts` file that calls this function
 * owns exactly the describe blocks it registers.
 */
export function runCardStoreContractSuite(label: string, factory: CardStoreFactory): void {
  const probe = factory();
  const available = probe !== null;
  const hasDebrisCheck = probe?.listDebris !== undefined;
  probe?.cleanup?.();

  describe.skipIf(!available)(`CardStore contract: ${label}`, () => {
    let fixture: CardStoreFixture;

    beforeEach(() => {
      const created = factory();
      if (created === null) {
        throw new Error(`${label}: factory returned null after its initial probe succeeded`);
      }
      fixture = created;
    });

    afterEach(() => {
      fixture.cleanup?.();
    });

    it("read returns an empty array for a fresh store", async () => {
      expect(await fixture.store.read()).toEqual([]);
    });

    it("append then read returns the appended row", async () => {
      await fixture.store.append(sampleCard("cc-1"));
      const rows = await fixture.store.read();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe("cc-1");
    });

    it("read returns rows in log order", async () => {
      await fixture.store.append(sampleCard("cc-1"));
      await fixture.store.append(sampleCard("cc-2"));
      await fixture.store.append(sampleCard("cc-3"));
      expect((await fixture.store.read()).map((c) => c.id)).toEqual(["cc-1", "cc-2", "cc-3"]);
    });

    it("upsert replaces the row matching identity in place", async () => {
      await fixture.store.append(sampleCard("cc-1"));
      await fixture.store.upsert({ ...sampleCard("cc-1"), status: "approved" });
      const rows = await fixture.store.read();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe("approved");
    });

    it("upsert appends when no row matches the identity", async () => {
      await fixture.store.append(sampleCard("cc-1"));
      await fixture.store.upsert(sampleCard("cc-2"));
      const rows = await fixture.store.read();
      expect(rows).toHaveLength(2);
      expect(rows.some((c) => c.id === "cc-2")).toBe(true);
    });

    (hasDebrisCheck ? it : it.skip)("leaves no debris behind after an upsert", async () => {
      await fixture.store.append(sampleCard("cc-1"));
      await fixture.store.upsert({ ...sampleCard("cc-1"), status: "approved" });
      expect(fixture.listDebris?.()).toEqual([]);
    });
  });
}
