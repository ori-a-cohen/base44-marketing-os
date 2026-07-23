import { createClient } from "@base44/sdk";
import type { Card, Verdict, Outcome } from "./schema.js";
import { parseCard } from "./schema.js";
import type { AsyncCardStore } from "./async-card-store.js";

/**
 * The shape of a Card row as stored in the hosted Base44 "Card" entity
 * (mirrored in the sibling Base44 project's base44/entities/card.jsonc,
 * which is the canonical hosted schema this driver targets). Base44 owns
 * `id` (the row's own identifier) and `created_date` (server-assigned
 * insert time); our logical card identity -- `Card.id` -- is mirrored into
 * `card_id`, never into `id`, so the two identities never collide.
 */
export interface Base44CardRow {
  readonly id: string;
  readonly card_id: string;
  readonly channel: string;
  readonly topic: string;
  readonly status: string;
  readonly created: string;
  readonly version: number;
  readonly operator: string | null;
  readonly audience_id: string | null;
  readonly campaign_id: string | null;
  readonly surface: string | null;
  readonly guardian_score: number | null;
  readonly evidence: string | null;
  readonly shipped_at: string | null;
  readonly verdicts: readonly Verdict[];
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
  readonly artifacts: Readonly<Record<string, string>>;
  readonly outcome: Outcome | null;
  readonly revision_requests: readonly string[];
  readonly history: readonly string[];
  readonly created_date: string;
}

/** Every `Base44CardRow` field the driver may write, i.e. everything except the server-assigned `id` and `created_date`. */
export type Base44CardRowInput = Omit<Base44CardRow, "id" | "created_date">;

/**
 * The maximum page size the hosted `list`/`filter` operations accept
 * (per the SDK's own documented ceiling: "The maximum limit is 5,000 items
 * per request"). `read()` passes this explicitly rather than relying on
 * `EntityHandler.list`'s default page size of 50 -- an unset limit would
 * silently truncate `read()` on any hosted app with more than 50 Card rows,
 * which the small fixtures in this driver's own tests would never surface.
 */
const MAX_PAGE_SIZE = 5000;

/**
 * The narrow slice of the Base44 SDK's `EntityHandler<T>` this driver
 * actually calls. Narrowed rather than importing the SDK's own
 * `EntityHandler` type directly, for two reasons: it lets a unit test
 * supply a plain in-memory fake with zero dependency on `@base44/sdk`
 * (see tests/cards/base44-card-store.test.ts), and it keeps this driver's
 * dependency surface to exactly the four operations it uses.
 */
export interface Base44CardEntityAccessor {
  list(sort?: string, limit?: number): Promise<Base44CardRow[]>;
  filter(query: Record<string, unknown>): Promise<Base44CardRow[]>;
  create(data: Base44CardRowInput): Promise<Base44CardRow>;
  update(id: string, data: Partial<Base44CardRowInput>): Promise<Base44CardRow>;
}

/**
 * Async `CardStore` driver over a hosted Base44 "Card" entity.
 *
 * Ordering: `read()` sorts rows by `created_date` ascending. Base44 stamps
 * `created_date` on insert and this driver never overwrites it, so insert
 * order and `created_date` order coincide -- the same "log order" the
 * JSONL driver gets for free from appending lines to a file. A dedicated
 * sequence field was considered and rejected: it would duplicate
 * information the host already provides for free.
 *
 * Identity: our logical id lives in `card_id`; Base44's own `id` is never
 * read as our id and never written by us. `upsert` finds the hosted row
 * whose `(card_id, version)` matches the incoming card -- the same
 * replace-by-(id,version)-or-append semantics `upsertCard` (store.ts)
 * implements for JSONL -- and calls `update` on it if found, `create`
 * otherwise.
 */
export class Base44CardStore implements AsyncCardStore {
  constructor(private readonly entity: Base44CardEntityAccessor) {}

  async read(): Promise<Card[]> {
    const rows = await this.entity.list("created_date", MAX_PAGE_SIZE);
    return [...rows].sort((a, b) => a.created_date.localeCompare(b.created_date)).map(rowToCard);
  }

  async append(card: Card): Promise<void> {
    await this.entity.create(cardToRowInput(card));
  }

  async upsert(card: Card): Promise<void> {
    const matches = await this.entity.filter({ card_id: card.id, version: card.version });
    const existing = matches[0];
    if (existing) {
      await this.entity.update(existing.id, cardToRowInput(card));
    } else {
      await this.entity.create(cardToRowInput(card));
    }
  }
}

function cardToRowInput(card: Card): Base44CardRowInput {
  return {
    card_id: card.id,
    channel: card.channel,
    topic: card.topic,
    status: card.status,
    created: card.created,
    version: card.version,
    operator: card.operator,
    audience_id: card.audience_id,
    campaign_id: card.campaign_id,
    surface: card.surface,
    guardian_score: card.guardian_score,
    evidence: card.evidence,
    shipped_at: card.shipped_at,
    verdicts: card.verdicts,
    attributes: card.attributes,
    artifacts: card.artifacts,
    outcome: card.outcome,
    revision_requests: card.revision_requests,
    history: card.history,
  };
}

function rowToCard(row: Base44CardRow): Card {
  return parseCard({
    id: row.card_id,
    channel: row.channel,
    topic: row.topic,
    status: row.status,
    created: row.created,
    version: row.version,
    operator: row.operator,
    audience_id: row.audience_id,
    campaign_id: row.campaign_id,
    surface: row.surface,
    guardian_score: row.guardian_score,
    evidence: row.evidence,
    shipped_at: row.shipped_at,
    verdicts: row.verdicts,
    attributes: row.attributes,
    artifacts: row.artifacts,
    outcome: row.outcome,
    revision_requests: row.revision_requests,
    history: row.history,
  });
}

/**
 * Builds a `Base44CardStore` backed by a live Base44 app. `createClient` is
 * called here, inside the function body -- never at module load -- so
 * importing this module has zero side effects and requires zero
 * credentials; only calling `createBase44CardStore` constructs a client or
 * touches the network, and only when a caller (select-store.ts, gated on
 * `ROUNDTRIP_STORE=base44`) actually asks for the hosted driver. The static
 * `import { createClient } from "@base44/sdk"` above only binds a
 * function reference at import time; it does not invoke it.
 *
 * `client.entities.Card` types as `EntityHandler<any>`: the SDK only
 * narrows `entities.*` beyond `any` when a project has run
 * `base44 types generate` against its own schema, which this repo (a
 * consumer of a separately-managed Base44 app) does not do. The cast below
 * is the one untyped boundary in this driver, isolated to this single call
 * site rather than leaking `any` into `Base44CardStore`'s own methods --
 * the four methods it names (`list`/`filter`/`create`/`update`) match the
 * hosted entity's real signatures per base44/entities/card.jsonc.
 */
export function createBase44CardStore(appId: string): Base44CardStore {
  const client = createClient({ appId });
  // Justified cast: see the doc comment above.
  const entity = client.entities.Card as unknown as Base44CardEntityAccessor;
  return new Base44CardStore(entity);
}
