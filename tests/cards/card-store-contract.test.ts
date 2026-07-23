import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCard, type Card } from "../../src/cards/schema.js";
import { JsonlCardStore, type CardStore } from "../../src/cards/card-store.js";

/**
 * A ready-to-use store plus the plumbing the suite needs to reset and
 * inspect it. `cleanup` releases whatever external resource the factory
 * allocated (a temp dir, a remote fixture, ...). `listDebris` is optional:
 * only file-backed drivers can meaningfully report leftover temp files, so
 * a driver without a filesystem (a hosted API) simply omits it and the
 * debris assertion is skipped rather than faked.
 */
export interface CardStoreFixture {
  readonly store: CardStore;
  readonly cleanup?: () => void;
  readonly listDebris?: () => readonly string[];
}

/**
 * Returns a fresh fixture, or `null` when this driver's prerequisites are
 * absent (e.g. `BASE44_APP_ID` unset for a hosted driver). Called once as a
 * probe to decide skip-vs-run, then once per test for isolation.
 */
export type CardStoreFactory = () => CardStoreFixture | null;

const card = (id: string): Card =>
  parseCard({ id, channel: "landing_page", topic: "Base1", status: "drafted", created: "2026-07-23" });

/**
 * Runs the driver-agnostic CardStore contract against any factory. Skips
 * cleanly (via `describe.skipIf`, never a failing test) when the factory's
 * initial probe returns null, so a driver whose prerequisites are absent
 * (Task 16b's Base44CardStore without BASE44_APP_ID) is reported as skipped
 * rather than red.
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

    it("read returns an empty array for a fresh store", () => {
      expect(fixture.store.read()).toEqual([]);
    });

    it("append then read returns the appended row", () => {
      fixture.store.append(card("cc-1"));
      const rows = fixture.store.read();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe("cc-1");
    });

    it("read returns rows in log order", () => {
      fixture.store.append(card("cc-1"));
      fixture.store.append(card("cc-2"));
      fixture.store.append(card("cc-3"));
      expect(fixture.store.read().map((c) => c.id)).toEqual(["cc-1", "cc-2", "cc-3"]);
    });

    it("upsert replaces the row matching identity in place", () => {
      fixture.store.append(card("cc-1"));
      fixture.store.upsert({ ...card("cc-1"), status: "approved" });
      const rows = fixture.store.read();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe("approved");
    });

    it("upsert appends when no row matches the identity", () => {
      fixture.store.append(card("cc-1"));
      fixture.store.upsert(card("cc-2"));
      const rows = fixture.store.read();
      expect(rows).toHaveLength(2);
      expect(rows.some((c) => c.id === "cc-2")).toBe(true);
    });

    (hasDebrisCheck ? it : it.skip)("leaves no debris behind after an upsert", () => {
      fixture.store.append(card("cc-1"));
      fixture.store.upsert({ ...card("cc-1"), status: "approved" });
      expect(fixture.listDebris?.()).toEqual([]);
    });
  });
}

function jsonlFactory(): CardStoreFixture {
  const dir = mkdtempSync(join(tmpdir(), "card-store-contract-"));
  const path = join(dir, "cards.jsonl");
  return {
    store: new JsonlCardStore(path),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
    listDebris: () => readdirSync(dir).filter((name) => name !== "cards.jsonl"),
  };
}

runCardStoreContractSuite("JsonlCardStore", jsonlFactory);
