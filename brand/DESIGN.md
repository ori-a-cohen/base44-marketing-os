---
# Design tokens — structured layer, per the DESIGN.md spec (github.com/google-labs-code/design.md)
# Agents read these values verbatim; the prose below explains how to apply them.
# Replace every CHANGE_ME. Lint when done: npx @google/design.md lint brand/DESIGN.md
# Values sourced from base44.com rendered CSS (2026-07-21) — traceable, not remembered.
colors:
  background: "#F9F7F4"   # warm off-white canvas — Base44's site background, never plain white
  ink: "#1E1E24"          # primary text — near-black with a faint cool cast
  primary: "#FF6A00"      # THE accent: Base44 orange. One vivid color, total, kept scarce.
  muted: "#6D6A67"        # secondary text / captions
typography:
  display: "Dazzed"        # display face — headlines only
  body: "Geist"            # body face — everything else
  fallback: "system-ui, sans-serif"
spacing:
  sm: "8px"
  md: "16px"
  lg: "32px"
components:
  cta-button:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.background}"
    rounded: "8px"
    padding: "{spacing.sm} {spacing.md}"
  social-card:
    backgroundColor: "{colors.background}"
    textColor: "{colors.ink}"
    typography: "{typography.display}"
  caption:
    textColor: "{colors.muted}"
    typography: "{typography.body}"
---

# DESIGN.md — the visual canon

> `voice-guide.md` is how the brand sounds; this file is how it looks. Format follows the
> [DESIGN.md spec](https://github.com/google-labs-code/design.md): tokens in the YAML front matter
> (exact values agents apply verbatim), prose below (the *why* and the rules of application).
> Same principle as the whole repo: **on-brand by construction, not by review.**

## Overview

Everything that renders — social cards, ad templates, slide decks, landing pages — is built FROM the tokens above, never from a hex value someone remembers. A creative that isn't token-derived doesn't ship. Agents producing visuals read this file first (see `CLAUDE.md` startup sequence); the guardian scores creatives against the Do's and Don'ts below exactly as it scores copy against `rules.md`.

## Colors

One background, one ink, ONE accent, one muted. The accent earns attention by being scarce — a second vivid color is a violation, not a variation. A near-miss hex (`#FF6B00` when the token says `#FF6A00`) is also a violation, not a rounding error: normalize and compare against the token, don't eyeball.

## Typography

Display face for headlines, body face for everything else — no exceptions, no "it looked better in italic." Verify fonts actually LOADED in rendered output: render the same text with and without the font and compare pixels; if they match, you silently fell back and the creative fails.

**Known glyph exceptions** — real fonts have real defects. Record them here the first time one bites you, so it becomes a rule instead of a repeated surprise:
- None recorded yet. Add the first one that bites you (Dazzed for display, Geist for body).

## Layout

Flat, branded backgrounds — solid color fields from the tokens; never default gradients, never dark panels floated on color. Single visual surface: no boxes-within-boxes, no UI screenshot floating on a decorated card. Spacing comes from the spacing scale; if you need a value between `md` and `lg`, you probably don't.

## Elevation & Depth

No elevation — hierarchy comes from scale, weight, and the scarce orange accent. No drop shadows, no floating panels. Starter policy; tighten it the first time a real creative needs depth.

## Shapes

8px everywhere (matches the `cta-button` token). One radius family; mixed radii read as unconsidered. Starter policy — promote to a hard rule the first time an off-radius creative gets rejected.

## Components

The front matter defines the reusable pieces (`cta-button`, `social-card`) by referencing base tokens — change a base token and every component follows. Add a component the second time you build the same element by hand. Rendering them is deterministic work → a script, not a conversation: tokens + HTML template + headless-browser screenshot = the same on-brand card every time.

## Do's and Don'ts

**Do**
- Resolve every color in a deliverable to a token — this is a color check, not a string grep
- Place the logo from the real asset file, with its clearspace
- Check legibility at feed/thumbnail size before calling a creative done
- Run the lint (`npx @google/design.md lint`) after every token change — it catches broken references and WCAG contrast failures

**Don't**
- Let a model redraw, "clean up," or regenerate a logo — instant reject
- Introduce a second accent, an off-token hex, or a default gradient
- Trust that a webfont loaded — verify it
- Ship a creative the guardian hasn't scored ≥ 9

## The test

Put your creative next to three real posts from your brand's feed. If a stranger can't tell which one the machine made, the tokens are doing their job.
