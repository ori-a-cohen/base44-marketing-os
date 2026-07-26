# Loom transcript — 5 min, teaching

> The brief: *walk us through how you worked so another builder could reproduce it tomorrow — what you
> automated, what you'd reuse, what you learned mid-task.*
>
> Audience: **other builders.** So this is 25 seconds of proof and four and a half minutes of method —
> weighted toward the harness I put around Claude, because that is the part that transfers.

`SCENE nn` is the numbered screen in the **visual track**; the blockquote is what to say. **The numbers
match across all three surfaces** — scene 07 in the track is cue 07 in the console is scene 07 here — so
you advance both windows together by hand. The beat marked **(cut for time)** is the slack.

---

**[0:00 — 0:25 · the number, fast]**

`SCENE 01` The board — headline number and Campaigns.

> This is Roundtrip. It forks Base44's marketing engineering starter and closes the loop it leaves open:
> approved copy becomes a real landing page, the page reports back, and the result attaches to the rules
> that approved it.
>
> The headline reads *one of one measured — one with an unreadable ship time.* Deliberately unflattering.
> That's the proof. **The rest is how I built it.**

---

**[0:25 — 1:15 · how I found the gap: research before code]**

`SCENE 02` `.notes/RESEARCH-SYNTHESIS.md` · `SCENE 03` `scorecard.md` Layer 4 · `SCENE 04`
`data/content-cards.example.jsonl`, the `evidence` field.

> Day one I wrote no code. I ran a landscape pass — two dozen sources on the author, the product, and
> where AI marketing tooling sits right now — and read the starter itself. That's where I hit something
> confusing that became the whole thesis.
>
> The starter's own scorecard defines a top-score Memory layer as, quote, *"the system knows where you
> are versus goal, and gets smarter every cycle."* The pulse skill says *"read the sources — whatever is
> wired."* Nothing was wired. And the card schema's only outcome field is `evidence`, a link to the post.
> **That proves publication. There is no field for performance.**
>
> So: the repo is the system, the docs are the intent — **when they disagree, the gap is your assignment.**

---

**[1:15 — 1:50 · how I chose: a scored table, published]**

`SCENE 05` `.notes/DECISION.md` §13.1 scoring table · `SCENE 06` the published decision artifact.

> Then I scored the options instead of picking the exciting one — four candidates, seven criteria taken
> from your brief, equal weight, out of thirty-five. I published that table as an artifact, so the
> decision is a document rather than a memory.
>
> Lowest was idea intake — letting a run start without a human brief. It collides with Ofer's own
> weekly-pulse. Two won, and they were the front and back of one loop.
>
> The point isn't my scores. It's that **you can disagree with a cell instead of with a vibe.**

---

**[1:50 — 3:25 · the harness: how I stopped the agent drifting]**

`SCENE 07` `.superpowers/sdd/` · `SCENE 08` `task-1-brief.md` · `SCENE 09` a `review-*.diff` ·
`SCENE 10` `.claude/settings.json` · `SCENE 11` the brand-lint exit-2 output · `SCENE 12`
`hooks/reconcile.sh` · `SCENE 13` the `CLAUDE.md` mode check.

> Here's the part I'd actually teach. **I didn't prompt Claude — I built a harness around it**, and it's
> six pieces you can copy today.
>
> **One, brainstorm and plan mode before any code.** That produced a written plan, then twenty-three
> numbered task briefs. Each names the files to create, the interfaces it produces, and **the test file
> before the implementation file.**
>
> **Two, one task, one commit** — small enough that the agent can't wander off.
>
> **Three, a subagent reviews each task's diff.** Forty review diffs on disk. Builder and reviewer are
> deliberately different contexts.
>
> **Four, two kinds of hook, both in `settings.json`.** A PreToolUse hook on Write, Edit and MultiEdit
> runs the brand and design linters — watch: off-brand copy exits two and never reaches disk.
> **Enforcement lives in the filesystem, not in the prompt.**
>
> **Five, a Stop hook.** When a session ends, the guardian's verdict becomes a card automatically.
> Logging isn't something the model can forget, because it was never the model's job.
>
> **Six, a mode check at the top of `CLAUDE.md`** — two audiences, two contracts. Without it a developer
> reads the brand canon before writing a unit test, then refuses to create the source directory.
>
> What came out is five agents and five skills behind a router. Sixty-five commits, four days, four
> hundred and forty-nine tests. **None of that came from better prompting. It came from the harness.**

---

**[3:25 — 3:55 · what I'd reuse anywhere]**

`SCENE 14` the generated page URL with `utm_content=cc-demo` · `SCENE 15` `src/cards/schema.ts` line 11.

> Two things I'd take to any project.
>
> **The join key.** The card id goes into the artifact at generation time: URL path, UTM parameters, meta
> tag. Attribution is a property of the artifact from the moment it exists, not something you reconstruct
> later.
>
> **And seeded data is excluded from the number by arithmetic, not by policy.** That's the difference
> between promising honesty and making dishonesty impossible.

---

**[3:55 — 4:40 · what a real deploy taught me]**

`SCENE 16` the live board on Base44 · `SCENE 17` `npm run deploy:board` and the three findings.

> And I built the board on Base44 itself — the backend in your builder, the site shipped with your CLI.
> **The honest test of a product is to build the thing you're marketing with it.**
>
> It taught me three things nothing local would have. Your hosting doesn't resolve directory indexes, so
> every page link four-oh-four'd. It sends `X-Frame-Options: DENY` on every response, so the preview
> iframe is impossible there. And the board I'd built as a second React client drifted inside a day:
> **two views of one contract is a promise to keep them in step by hand.** The deployed site is now the
> same file I serve locally.

---

**(cut for time) [· two more things I got wrong]**

`SCENE 17A` `data/source-base1.md`. On the track, press **O** to reach it; Next skips past it.

> I wired Bluesky and GitHub as outcome sources because their APIs are easy. Backwards — **a real signal
> on a channel your client doesn't run is a demo prop.**
>
> And I planned this demo around a feature I invented, until I opened your changelog. I trusted a summary
> instead of the source — exactly what brand rule four forbids. I broke my own system inside my own
> planning.

---

**[4:40 — 5:00 · what I didn't build, and the close]**

`SCENE 18` The board's rule-accountability section — all eight rules reading taste-only.

> What I didn't build is an eval set for the guardian — the one place this still runs on taste, not
> measurement.
>
> Which is what this view is for. It names the rules the outcome data doesn't support yet and calls them
> taste-only. **Not that my rules are wrong — that I've never tested them.**

---

## Before you record

**One window, 18 numbered scenes.** Every screen above is baked into the **visual track** — you share that
one window and advance it by hand, in step with the console.

**Nothing to prepare.** Every screen is already inside the track: real screenshots of the local board and
the live Base44 board, the real `brand-lint` exit-2 output, and the real file excerpts from this repo.

To record:

1. **Screen one** — the visual track, fullscreen. This is the only window Loom sees.
2. **Screen two** — the recording console, with the words. Never in frame.
3. In Loom, **share one window** and pick the track.
4. Start Loom, press **Start timer** on the console, and begin.
5. Advance **both windows together** with the right-arrow key, one scene at a time. The number in the
   track's corner always matches the number on the console card — if they drift, jump the console to the
   track's number.
6. Prefer it to run itself? Press **Auto-play** on the track instead and it advances on the timeline.
7. Afterwards, run Loom's AI cleanup — filler words, silences, auto-chapters. That is the part of "AI
   handles it" that actually exists; nothing navigates your screen for you.

The core beats are ~730 spoken words: five minutes at 145 words per minute, a normal walkthrough pace with
no slack for improvising. Do one dry read against a timer. If it comes in under, add the
**(cut for time)** beat (~70 words, 30 seconds). If it overruns, drop that beat, then piece six of the
harness.
