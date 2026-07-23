# LinkedIn launch post (text only, not published)

> Most AI marketing systems can prove they published something. Almost none can tell you what
> happened next.
>
> I forked Base44's marketing-engineering starter this week. It's a genuinely good four-layer
> system: a writer that has to read the brand canon before it can write a word, an adversarial
> guardian that gates every draft, rules that compound as you correct them.
>
> Then I went looking for what it was missing most, and found the same hole from two directions.
>
> **It stops at words.** Approved copy comes out, and a human still leaves the system to build the
> page, make the image, and publish by hand.
>
> **And it never learns.** The card schema has a field proving a post shipped. It has no field at
> all for how that post performed. Which means the brand rules that approved it are unfalsifiable —
> a post can score 10/10 and flop, and nothing ever questions the rules that passed it.
>
> So I built Roundtrip, which closes both ends.
>
> → Approved copy becomes a real landing page — token-derived, verified in a real headless browser
> before a human sees it — plus a social card rendered from the same design tokens via Satori. Not a
> paragraph someone still has to turn into a page.
>
> → Brand rules are enforced in code. A hook blocks off-brand copy at the filesystem: exit code 2,
> the model has to fix it before the write succeeds. Not "please follow the guidelines."
>
> → Every shipped piece comes back with a real measured result, attached to the specific rules that
> approved it. Rules with nothing behind them get labelled taste-only instead of quietly passing as
> wisdom.
>
> One number, and it's deliberately unflattering:
>
> **Loop-closure rate — of everything we published, how much do we actually know the result of?**
>
> It starts at zero. Not low. Zero, because the field didn't exist. Sample data never counts toward
> it — that's arithmetic, not a promise. And producing more content pushes it *down*, not up — every
> piece you ship without measuring grows the bottom of the fraction. The only way to raise it is to
> go and find out what happened.
>
> The part I'd tell any builder: the hard bit was never the agents. It was getting outcome data into
> the same place as the rules that produced it. One adapter contract, one join key (card id) written
> into the artifact at generation time — into the URL path, the UTM parameters, a meta tag — and every
> channel becomes pluggable, including the two ad platforms that ship today as real registered stubs
> rather than TODOs: Meta and LinkedIn are wired to the same contract, fail loudly naming the exact
> credentials they're missing, and count toward neither side of the ratio until someone configures
> them.
>
> What I didn't build: the queue that proposes rule changes automatically. At five cards you'd be
> reporting noise as insight. The mechanism is there — a rule-accountability view, cohorts by canon
> version — but the findings stay gated until there's enough data to mean something. I also didn't
> finish hosting the board on Base44 itself, which was the more ambitious version of this — the
> storage layer is built to take that driver (one interface, a local implementation shipping today),
> but the hosted half of that plan didn't land in this build, and I'd rather say that plainly than
> claim a URL that doesn't exist.
