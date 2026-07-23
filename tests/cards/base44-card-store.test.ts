import { describe, it, expect } from "vitest";
import {
  Base44CardStore,
  createBase44CardStore,
  type Base44CardEntityAccessor,
  type Base44CardRow,
  type Base44CardRowInput,
} from "../../src/cards/base44-card-store.js";
import { runCardStoreContractSuite, sampleCard as card, type CardStoreFixture } from "./card-store-contract-suite.js";

/**
 * An in-memory stand-in for `client.entities.Card`, implementing exactly
 * the four operations `Base44CardStore` calls. This is what makes the
 * driver's mapping logic (id<->card_id, upsert-by-(id,version), read
 * ordering) testable deterministically and without network: every other
 * test in this file exercises `Base44CardStore` purely against this fake.
 *
 * `created_date` is assigned from a monotonically increasing counter
 * (rather than `Date.now()` / `new Date().toISOString()`) so two rows
 * created in the same millisecond still sort deterministically -- the
 * same guarantee a real Base44 insert-time timestamp gives in practice,
 * made explicit here so the "log order" contract test can't flake.
 */
class FakeBase44CardEntity implements Base44CardEntityAccessor {
  private rows: readonly Base44CardRow[] = [];
  private nextRowId = 1;
  private nextSequence = 0;

  async list(_sort?: string, _limit?: number): Promise<Base44CardRow[]> {
    return [...this.rows];
  }

  async filter(query: Record<string, unknown>): Promise<Base44CardRow[]> {
    const entries = Object.entries(query);
    return this.rows.filter((row) =>
      entries.every(([key, value]) => (row as unknown as Record<string, unknown>)[key] === value),
    );
  }

  async create(data: Base44CardRowInput): Promise<Base44CardRow> {
    const row: Base44CardRow = {
      ...data,
      id: `row-${this.nextRowId++}`,
      created_date: new Date(this.nextSequence++).toISOString(),
    };
    this.rows = [...this.rows, row];
    return row;
  }

  async update(id: string, data: Partial<Base44CardRowInput>): Promise<Base44CardRow> {
    const idx = this.rows.findIndex((row) => row.id === id);
    if (idx === -1) throw new Error(`FakeBase44CardEntity: no row with id ${id}`);
    const existing = this.rows[idx];
    if (!existing) throw new Error(`FakeBase44CardEntity: no row with id ${id}`);
    const updated: Base44CardRow = { ...existing, ...data };
    this.rows = this.rows.map((row, i) => (i === idx ? updated : row));
    return updated;
  }
}

function fakeFactory(): CardStoreFixture {
  return { store: new Base44CardStore(new FakeBase44CardEntity()) };
}

// The important test: proves Base44CardStore satisfies the same contract
// JsonlCardStore does, entirely offline, via the fake entity accessor above.
runCardStoreContractSuite("Base44CardStore (fake)", fakeFactory);

// Wired to run only when BASE44_APP_ID is set. The controller exercises
// this separately against the real hosted app; a cold clone or CI run has
// no BASE44_APP_ID, so runCardStoreContractSuite's factory returns null and
// this describe block reports as skipped, never red.
function liveFactory(): CardStoreFixture | null {
  const appId = process.env.BASE44_APP_ID;
  if (!appId) return null;
  // No `cleanup`/`listDebris`: rows this run creates persist in the hosted
  // app for the controller to inspect. Deleting them is out of scope here
  // -- this driver's accessor contract deliberately has no `delete`, since
  // Base44CardStore itself never needs one.
  return { store: createBase44CardStore(appId) };
}

runCardStoreContractSuite("Base44CardStore (live)", liveFactory);

describe("Base44CardStore mapping", () => {
  it("writes the logical id into card_id, never into Base44's own row id", async () => {
    const entity = new FakeBase44CardEntity();
    const store = new Base44CardStore(entity);
    await store.append(card("cc-1"));
    const rows = await entity.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.card_id).toBe("cc-1");
    expect(rows[0]?.id).not.toBe("cc-1");
  });

  it("read reconstructs Card.id from card_id", async () => {
    const entity = new FakeBase44CardEntity();
    const store = new Base44CardStore(entity);
    await store.append(card("cc-1"));
    const [first] = await store.read();
    expect(first?.id).toBe("cc-1");
  });

  it("upsert matches by (card_id, version), leaving other versions of the same card untouched", async () => {
    const entity = new FakeBase44CardEntity();
    const store = new Base44CardStore(entity);
    await store.append(card("cc-1"));
    await store.append({ ...card("cc-1"), version: 2 });

    await store.upsert({ ...card("cc-1"), version: 2, status: "approved" });

    const rows = await entity.list();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.version === 1)?.status).toBe("drafted");
    expect(rows.find((r) => r.version === 2)?.status).toBe("approved");
  });

  it("upsert updates the matched hosted row in place rather than creating a new one", async () => {
    const entity = new FakeBase44CardEntity();
    const store = new Base44CardStore(entity);
    await store.append(card("cc-1"));
    const [beforeRow] = await entity.list();

    await store.upsert({ ...card("cc-1"), status: "approved" });

    const rows = await entity.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(beforeRow?.id);
  });

  it("read sorts by created_date ascending regardless of append order by id", async () => {
    const entity = new FakeBase44CardEntity();
    const store = new Base44CardStore(entity);
    await store.append(card("cc-3"));
    await store.append(card("cc-1"));
    await store.append(card("cc-2"));

    const cards = await store.read();
    expect(cards.map((c) => c.id)).toEqual(["cc-3", "cc-1", "cc-2"]);
  });
});
