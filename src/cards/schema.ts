export const CARD_STATES = ["drafted", "approved", "shipped", "measured"] as const;
export type CardState = (typeof CARD_STATES)[number];

/** Legacy states present in the starter's example data; accepted on read, never written. */
const LEGACY_STATES = ["review", "draft"] as const;

export const PROVENANCES = ["real", "manual", "seeded"] as const;
export type Provenance = (typeof PROVENANCES)[number];

/** Only real and manual outcomes may enter the metric numerator. */
export const COUNTING_PROVENANCES: readonly Provenance[] = ["real", "manual"];

export interface Verdict {
  readonly rule: number;
  readonly pass: boolean;
  readonly note: string;
  readonly gate: "brand" | "design";
}

export interface Outcome {
  readonly card_id: string;
  readonly surface: string;
  readonly metric: string;
  readonly value: number;
  readonly unit: string;
  readonly measured_at: string;
  readonly source: string;
  readonly provenance: Provenance;
}

export interface Card {
  readonly id: string;
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
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

export function parseCard(raw: unknown): Card {
  if (!isRecord(raw)) throw new Error("card must be an object");

  const id = str(raw.id);
  if (!id) throw new Error("card.id is required and must be a string");

  const status = str(raw.status);
  const known: readonly string[] = [...CARD_STATES, ...LEGACY_STATES];
  if (!status || !known.includes(status)) {
    throw new Error(`card.status must be one of ${known.join(", ")}, received: ${String(raw.status)}`);
  }

  const channel = str(raw.channel);
  if (!channel) throw new Error("card.channel is required");

  const topic = str(raw.topic);
  if (!topic) throw new Error("card.topic is required");

  const created = str(raw.created);
  if (!created) throw new Error("card.created is required");

  return {
    id,
    channel,
    topic,
    status,
    created,
    version: typeof raw.version === "number" ? raw.version : 1,
    operator: str(raw.operator),
    audience_id: str(raw.audience_id),
    campaign_id: str(raw.campaign_id),
    surface: str(raw.surface) ?? channel,
    guardian_score: typeof raw.guardian_score === "number" ? raw.guardian_score : null,
    evidence: str(raw.evidence),
    shipped_at: str(raw.shipped_at),
    verdicts: Array.isArray(raw.verdicts) ? (raw.verdicts as Verdict[]) : [],
    attributes: isRecord(raw.attributes) ? (raw.attributes as Card["attributes"]) : {},
    artifacts: isRecord(raw.artifacts) ? (raw.artifacts as Record<string, string>) : {},
    outcome: isRecord(raw.outcome) ? (raw.outcome as unknown as Outcome) : null,
    revision_requests: Array.isArray(raw.revision_requests) ? (raw.revision_requests as string[]) : [],
    history: Array.isArray(raw.history) ? (raw.history as string[]) : [],
  };
}
