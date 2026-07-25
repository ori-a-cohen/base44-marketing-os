# Loom transcript — 5 min, teaching

**[0:00 — the gap, board already on screen]**

> This is Roundtrip. It's a fork of Base44's marketing-engineering starter, and before I show you
> what I added, I want to be precise about what was already good — because that's what made the gap
> obvious.
>
> The starter has a writer that structurally cannot write until it has read the brand canon. It has
> an adversarial guardian that scores every draft. Those are both better than most production
> systems I've seen. But it stops at words, and it never finds out whether the words worked.

**[0:30 — live run]**

> So: one line of brief. I'm running a campaign for Base1 — Base44's own in-house model, shipped at
> the end of June. That's a real feature, and the writer's only source is a fact sheet where every
> line carries the URL it came from. It can't reach past that file. Anything it can't cite, it cuts.
>
> Watch this. The writer produces an angle, and — there. Exit code 2. That's a hook intercepting the
> write because the copy used a banned phrase. The model didn't decide to comply; it physically
> could not save the file. That's the difference between a rule in a prompt and a rule in code.
>
> Now the guardian returns pass or fail per numbered rule, not one blurry score out of ten.
>
> And here's the part the starter never did — the approved message becomes a real landing page, plus
> a social card rendered straight from the design tokens. Before a human sees it, Playwright checks
> the real rendered page: it loads, there's exactly one h1, the CTA carries the tracking, nothing
> overflows on mobile. That's the deterministic, free layer — no model call yet. Contrast and
> whether the intended font actually loaded are judgement calls I left to the design guardian scoring
> a screenshot; I didn't wire an automated check for those two, and I'd rather say that than claim a
> check that isn't there.
>
> The design guardian scores the screenshot on those judgement calls next.
>
> Card on the board. Nobody chose to log that.

**[1:30 — the loop]**

> Now the half nothing open-source does. The page is live locally, so results start coming back —
> and they attach to the specific card, and to the specific rules that approved it.
>
> This view is the point. It names the rules that outcome data does not support yet, and calls them
> taste-only. It's not telling me my rules are wrong. It's telling me which ones I've never tested,
> which is a thing I could not previously know.

**[2:30 — how I worked]**

> Three things I'd hand to another builder.
>
> **First, I scored the options against the brief's own criteria instead of picking the exciting
> one.** Four gaps, seven criteria, equal weight. Intake scored lowest — not because it's a bad idea,
> but because it collides with tools the author already published. That table is in the repo. The
> point isn't the scores, it's that the choice is inspectable.
>
> **Second, hooks are the enforcement layer.** Anything you can check deterministically should be a
> hook, not a paragraph of instructions. The model can't ignore exit code 2.
>
> **Third, one adapter contract.** Every outcome source returns the same shape: card id, surface,
> metric, value, when, source, provenance. That one decision is what makes channels pluggable — and
> it's why Meta and LinkedIn ship as real registered stubs rather than TODOs.

**[3:30 — what I'd reuse]**

> The join key is the thing I'd take to any project. The card id gets written into the artifact at
> generation time — into the URL path, into the UTM parameters, into a meta tag. So attribution
> isn't something you reconstruct later; it's a property of the artifact from the moment it exists.
>
> And one rule I'd keep forever: **sample data is excluded from the headline number by definition.**
> Not by policy, not by promise — by arithmetic. The board is full of demo data and none of it can
> touch the metric. That's the difference between claiming you're honest and making dishonesty
> impossible.

**[4:30 — learned, and didn't build]**

> Two things I learned mid-task, both the same lesson.
>
> I originally wired Bluesky and GitHub as outcome sources, because their APIs are easy. That was
> backwards. Base44 doesn't use Bluesky, and the marketing team never publishes this repo. A real
> signal on a channel your client doesn't run is a demo prop. So I cut both, and the replacement is
> better — a clone logs its own visits, which means when *you* run this and click through the page it
> just generated, you close the loop with your own real behaviour. No keys.
>
> And I planned this whole demo around a feature I invented, until I actually opened your changelog
> and found you'd already shipped most of it in March. Which is the same mistake in a different
> costume — I trusted a summary instead of the source. The system has a rule against exactly that,
> and I'd broken it in my own planning. So the campaign runs on a real feature now, and the writer's
> source file carries a URL on every line.
>
> What I didn't build: the queue that proposes rule changes automatically. At demo scale that would
> be reporting noise as insight. The mechanism is there and gated. I didn't build an eval set for the
> guardian — that's the honest next thing, and it's the one place this system still runs on taste
> rather than measurement. And I didn't finish the more ambitious hosting plan — putting the board
> itself on Base44, with a public URL. The storage layer is built to take that driver: one interface,
> a local JSONL implementation shipping today, and a contract test suite any hosted driver would have
> to pass. But no hosted driver exists yet, so there's no live URL to show you — only the seam it
> would plug into.
