# assets/fonts/

This directory is gitignored except for this file (see `.gitignore`). It
holds font binaries the social-card renderer (`src/render/card-image.ts`)
loads at runtime; none of them ship inside the repo itself.

## Geist (body face)

Licensed under the SIL Open Font License, which explicitly permits
redistribution and bundling with software, provided the licence notice ships
alongside it. This repo still does not commit the `.ttf` file directly:
`scripts/fetch-fonts.sh` downloads `Geist-Regular.ttf`, `Geist-Bold.ttf`, and
the licence text (`OFL.txt`) from `vercel/geist-font` into this directory on
demand, so a clone stays small and the licence text always travels with the
exact binary it covers, fetched fresh rather than vendored and potentially
stale.

Run it yourself:

    ./scripts/fetch-fonts.sh

## Dazzed (display face)

`brand/DESIGN.md` names Dazzed as the display face. Its licence is freeware
for personal and commercial *use*, but it explicitly does not permit
redistributing the font file as a standalone item -- so this repo can never
commit it, and `scripts/fetch-fonts.sh` never fetches it either: there is no
redistributable source to fetch it from.

If you hold a licensed copy, drop it in here yourself as
`Dazzed-Regular.ttf` (or any other `Dazzed-*.ttf` name) and the renderer
picks it up automatically -- `src/render/card-image.ts` prefers a `Dazzed-*`
file over `Geist-*` for the display face whenever one exists in this
directory.

## What happens if neither is present

The renderer degrades in this order for the display face: Dazzed ->
Geist -> a system-installed font file -- and reports which one it actually
used via the `fontUsed` field returned from `renderCardSvg`/`renderCardPng`,
so a Geist (or system-font) fallback is a labelled, visible seam in the
rendered card's own metadata, never a silent substitution. The body face
follows the same chain minus Dazzed (Geist -> system), since Dazzed is
display-only.

See the "Known glyph exceptions" note in `brand/DESIGN.md` for why this
matters: a fallback that isn't visibly labelled is exactly the failure mode
DESIGN.md's font-verification rule exists to catch.
