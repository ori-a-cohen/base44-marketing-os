import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseTokens } from "../lint/tokens.js";
import { renderPage, type PageSpec } from "./page.js";
import { renderCardPng } from "./card-image.js";
import { readCards, upsertCard } from "../cards/store.js";
import type { Card } from "../cards/schema.js";

export interface BuildOptions {
  readonly spec: PageSpec;
  readonly cardsPath: string;
  readonly outDir: string;
  readonly withImage?: boolean;
  /** Overridable so tests can point at a fixture directory instead of the
   * real assets/fonts/ -- see renderCardSvg/renderCardPng (Task 13). Defaults
   * to those functions' own default when omitted. */
  readonly fontsDir?: string;
}

/**
 * Reads an existing card by id and augments it with rendered artifacts.
 * Never fabricates a card: a missing id is a clear, named error, not a
 * silent new row (see this task's brief and CLAUDE.md's iron laws).
 *
 * Amendment A (task-13/task-20): when a social card image is rendered, the
 * font actually used for the display face is written onto the card as
 * `attributes.display_font` -- taken verbatim from renderCardPng's own
 * `fontUsed.display`, never re-derived or guessed here.
 */
export async function buildCard(opts: BuildOptions): Promise<void> {
  const cards = readCards(opts.cardsPath);
  const card = cards.find((c) => c.id === opts.spec.cardId);
  if (!card) {
    throw new Error(`No card found with id ${opts.spec.cardId} in ${opts.cardsPath}`);
  }

  const tokens = parseTokens(readFileSync("brand/DESIGN.md", "utf8"));
  const dir = join(opts.outDir, opts.spec.cardId);
  mkdirSync(dir, { recursive: true });

  const pagePath = join(dir, "index.html");
  writeFileSync(pagePath, renderPage(opts.spec, tokens), "utf8");

  const baseArtifacts: Record<string, string> = {
    ...card.artifacts,
    page: pagePath,
    page_slug: opts.spec.slug,
    page_url: `/c/${opts.spec.cardId}/${opts.spec.slug}`,
  };

  const image =
    opts.withImage === false
      ? null
      : await renderCardPng(
          { headline: opts.spec.headline, kicker: "Base44", cardId: opts.spec.cardId },
          tokens,
          opts.fontsDir,
        );

  if (image) {
    writeFileSync(join(dir, "card.png"), image.png);
  }

  const artifacts: Record<string, string> = image
    ? { ...baseArtifacts, card_image: join(dir, "card.png") }
    : baseArtifacts;

  const attributes = image ? { ...card.attributes, display_font: image.fontUsed.display } : card.attributes;

  upsertCard(opts.cardsPath, {
    ...card,
    status: "shipped",
    shipped_at: new Date().toISOString(),
    surface: "landing_page",
    audience_id: opts.spec.audienceId,
    campaign_id: opts.spec.campaignId,
    attributes,
    artifacts,
    history: [...card.history, `built artifacts and shipped ${opts.spec.cardId}`],
  });
}

/** Names a required, non-empty string attribute; throws (never fabricates a
 * placeholder) naming both the card id and the missing key when absent. */
function requireAttr(card: Card, key: string): string {
  const value = card.attributes[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      `card "${card.id}" is missing a non-empty string attribute "${key}" needed to build its page ` +
        `(set it via agents/designer.md's page spec before running cli-build).`,
    );
  }
  return value;
}

/**
 * Reconstructs a PageSpec from an existing card for the `--card <cardId>`
 * CLI entrypoint. There is no separate page-spec file in this repo's
 * conventions -- the designer agent's page spec (see agents/designer.md)
 * is the operator-facing content this reads back, written onto
 * `card.attributes` (slug, headline, subhead, body, ctaLabel, ctaHref).
 * audienceId/campaignId prefer the card's own schema fields
 * (audience_id/campaign_id) and fall back to the same-named attributes only
 * if those are absent -- never invented.
 */
export function pageSpecFromCard(card: Card): PageSpec {
  const audienceId =
    card.audience_id ?? (typeof card.attributes.audienceId === "string" ? card.attributes.audienceId : null);
  if (!audienceId) {
    throw new Error(`card "${card.id}" has no audience_id (top-level or attributes.audienceId) set.`);
  }
  const campaignId =
    card.campaign_id ?? (typeof card.attributes.campaignId === "string" ? card.attributes.campaignId : null);
  if (!campaignId) {
    throw new Error(`card "${card.id}" has no campaign_id (top-level or attributes.campaignId) set.`);
  }

  return {
    cardId: card.id,
    slug: requireAttr(card, "slug"),
    headline: requireAttr(card, "headline"),
    subhead: requireAttr(card, "subhead"),
    body: requireAttr(card, "body"),
    ctaLabel: requireAttr(card, "ctaLabel"),
    ctaHref: requireAttr(card, "ctaHref"),
    audienceId,
    campaignId,
  };
}

export interface CliArgs {
  readonly cardId: string;
}

const USAGE = "usage: npx tsx src/render/cli-build.ts --card <cardId>";

/** Parses the fixed `--card <cardId>` interface Task 19's skills already
 * instruct operators to run. Throws a usage error (never defaults or
 * guesses a card id) when the flag is absent or has no value. */
export function parseCliArgs(argv: readonly string[]): CliArgs {
  const idx = argv.indexOf("--card");
  const cardId = idx === -1 ? undefined : argv[idx + 1];
  if (!cardId) throw new Error(USAGE);
  return { cardId };
}

export interface RunBuildCliEnv {
  readonly cardsPath: string;
  readonly outDir: string;
  readonly fontsDir?: string;
}

/**
 * The `--card <cardId>` CLI's actual work, factored out from `main` so tests
 * can drive it directly (no subprocess) with an injected store/output
 * location instead of the real `data/cards.jsonl` / `build/pages`.
 */
export async function runBuildCli(argv: readonly string[], env: RunBuildCliEnv): Promise<void> {
  const { cardId } = parseCliArgs(argv);
  const cards = readCards(env.cardsPath);
  const card = cards.find((c) => c.id === cardId);
  if (!card) {
    throw new Error(`No card found with id ${cardId} in ${env.cardsPath}`);
  }
  const spec = pageSpecFromCard(card);
  await buildCard({ spec, cardsPath: env.cardsPath, outDir: env.outDir, fontsDir: env.fontsDir });
}

/** True only when this module is the process entrypoint (`npx tsx
 * src/render/cli-build.ts ...`), never when imported by a test -- resolving
 * both sides through the filesystem/URL machinery (not raw string
 * comparison) so it is correct regardless of the relative/absolute form the
 * invoking shell passed as argv[1]. */
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isMainModule()) {
  const cardsPath = process.env.CARDS_PATH ?? "data/cards.jsonl";
  const outDir = process.env.BUILD_DIR ?? "build/pages";
  runBuildCli(process.argv.slice(2), { cardsPath, outDir })
    .then(() => {
      process.stdout.write(`OK built card -> ${outDir}\n`);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`cli-build: ${message}\n`);
      process.exit(1);
    });
}
