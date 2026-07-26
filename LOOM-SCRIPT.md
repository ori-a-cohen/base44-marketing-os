# Loom transcript — 5 min, teaching

> The brief: *walk us through how you worked so another builder could reproduce it tomorrow — what you
> automated, what you'd reuse, what you learned mid-task.* So this is forty seconds of proof and four
> minutes of method.

`SCREEN` is what to have visible. The blockquote is what to say. The beat marked **(cut for time)** is
the slack — drop it first if the dry read overruns.

---

**[0:00 — 0:40 · what it is, and the number]**

`SCREEN` The board at `http://127.0.0.1:4174`, Campaigns section, headline number in frame.

> This is Roundtrip. It forks Base44's marketing engineering starter and closes the loop it leaves
> open: approved copy becomes a real landing page, the page reports back, and the result attaches to the
> brand rules that approved it.
>
> The headline reads *one of one measured — one with an unreadable ship time.* That's deliberately
> unflattering. One of the starter's own example cards claims it shipped without recording *when*, so
> it's excluded and named rather than quietly counted.
>
> That's the proof. The rest is method — the part you can reuse.

---

**[0:40 — 1:25 · step one: I read the repo before I wrote a line]**

`SCREEN` `scorecard.md`, Layer 4 row → then `data/content-cards.example.jsonl`, highlight `evidence`.

> Day one I wrote no code. I read the starter and the author's other repos, and hit something confusing
> that became the whole thesis.
>
> The starter's own scorecard defines a top-score Memory layer as, quote, *"the system knows where you
> are versus goal, and gets smarter every cycle."* The pulse skill says *"read the sources — whatever is
> wired."* Nothing was wired. And here's the card schema: the only outcome field is `evidence`, and it
> holds a link to the post. **That proves publication. There is no field for performance.**
>
> I lost real time assuming I'd missed the implementation. So: the repo is the system, the docs are the
> intent — when they disagree, the gap is your assignment.

---

**[1:25 — 1:55 · step two: I scored the choice instead of picking the exciting one]**

`SCREEN` `.notes/DECISION.md`, section 13.1 — the scoring table.

> Then I scored the options instead of picking the exciting one — four candidates, seven criteria taken
> from your brief, equal weight, out of thirty-five.
>
> Intake scored lowest — it collides with Ofer's own weekly-pulse, so building it means rebuilding his
> ground. Two won, and they were the front and back of one loop.
>
> The point isn't my scores. It's that you can disagree with a cell instead of with a vibe.

---

**[1:55 — 2:50 · step three: plan into tasks, then execute against tests]**

`SCREEN` `ls .superpowers/sdd/` → open `task-1-brief.md` → terminal with `npm test` output.

> Planning ran through a Claude Code skill set called superpowers — brainstorm, written plan, then
> twenty-three numbered task briefs. Each one names the files to create, the interfaces it produces, and
> **the test file before the implementation file.**
>
> Then one task, one commit, with a review diff per task. Sixty-five commits over four days, four hundred
> and forty-nine tests.
>
> The reusable part isn't the tool. It's the granularity: a plan where each task fits one commit and one
> test file is a plan an agent executes without drifting.
>
> And the first block of `CLAUDE.md` is a mode check — two audiences, two contracts. Without it a
> developer follows the operator's rules: reads the brand canon before writing a unit test, then refuses
> to create the source directory.

---

**[2:50 — 3:40 · what I automated, and what I'd reuse anywhere]**

`SCREEN` Trigger the `brand-lint` hook rejection (exit 2) → then a generated page URL showing
`utm_content=cc-demo`.

> Four things I'd take to any project.
>
> **One — anything deterministic becomes a hook, not a paragraph of instructions.** Off-brand copy exits
> two and never reaches disk; the model doesn't get to decide whether to comply.
>
> **Two, the one I'd reuse first — the join key.** The card id goes into the artifact at generation time:
> URL path, UTM parameters, meta tag. Attribution is a property of the artifact from the moment
> it exists, not something you reconstruct later.
>
> **Three — one adapter contract**, which is why Meta and LinkedIn ship as registered stubs that fail
> loudly instead of as TODOs.
>
> **And four — seeded data is excluded from that number by arithmetic, not by policy.** That's the
> difference between promising honesty and making dishonesty impossible.

---

**[3:40 — 4:35 · what a real deploy taught me that local never would]**

`SCREEN` The live board at `https://roundtrip-board-ecceb49b.base44.app`, then `npm run deploy:board`.

> And I built the board on Base44 itself — the backend in your builder, the site shipped with your CLI.
> The honest test of a product is to build the thing you're marketing with it.
>
> It taught me three things nothing local would have. Your hosting doesn't resolve directory indexes, so
> every page link four-oh-four'd. It sends `X-Frame-Options: DENY` on every response, so the preview
> iframe is impossible there — the board now declares framing as a capability and says so in words,
> rather than rendering a refused frame as a broken box. And the board I'd built as a second React client
> drifted inside a day: **two views of one contract is a promise to keep them in step by hand.** The
> deployed site is now the same file I serve locally.

---

**(cut for time) [· two more things I got wrong]**

`SCREEN` `data/source-base1.md`.

> I wired Bluesky and GitHub as outcome sources because their APIs are easy. Backwards — a real signal
> on a channel your client doesn't run is a demo prop.
>
> And I planned this whole demo around a feature I invented, until I opened your changelog. I trusted a
> summary instead of the source, which is exactly what brand rule four forbids. I broke my own system
> inside my own planning.

---

**[4:35 — 5:00 · what I didn't build, and the close]**

`SCREEN` Back to the board, rule-accountability section.

> What I didn't build is an eval set for the guardian. That's the honest next thing, and the one place
> this still runs on taste rather than measurement.
>
> Which is what this view is for. It names the rules the outcome data doesn't support yet and calls them
> taste-only. It isn't telling me my rules are wrong. It's telling me which ones I've never tested.

---

## Before you record

```bash
npm run demo      # seed, build, verify, measure — about 90 seconds
npm run board     # then leave http://127.0.0.1:4174 open
```

Tabs to have ready, in the order the script needs them:

1. The board — `http://127.0.0.1:4174`
2. `scorecard.md` and `data/content-cards.example.jsonl`
3. `.notes/DECISION.md` at section 13.1
4. A file listing of `.superpowers/sdd/`, plus `task-1-brief.md`
5. A terminal with `npm test` already run, passing count on screen
6. The live board — `https://roundtrip-board-ecceb49b.base44.app`

The core beats are ~730 spoken words. That is five minutes at 145 words per minute — a normal
walkthrough pace, but with no slack for improvising, so do one dry read against a timer. If it comes in
under, add the **(cut for time)** beat (another 70 words, ~30 seconds) after the Base44 one. If it
overruns, that beat is the first thing to go, then the `CLAUDE.md` mode check at the end of beat three.
