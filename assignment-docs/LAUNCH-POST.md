# LinkedIn launch post (text only, not published)

> Most AI marketing systems can prove they published something. Almost none can tell you what
> happened after.
>
> I forked Base44's marketing-engineering starter this week. Good bones: the writer has to read the
> brand canon before it writes a word, and a guardian gates every draft.
>
> Two holes, both ends of the same loop.
>
> It stops at words. Approved copy comes out and a human still goes off to build the page and
> publish by hand.
>
> And it never finds out. The card schema has a field proving a post shipped. Nothing for how it
> did. Which means the brand rules that approved it can't be wrong. A post can score 10/10, flop,
> and no one questions the rules that passed it.
>
> So I built Roundtrip. Approved copy now becomes a real landing page, checked in a headless browser
> before anyone sees it, plus a social card rendered from the same design tokens. Brand rules run as
> a hook that blocks off-brand copy on write: exit code 2, fix it or it doesn't save. And every
> shipped piece comes back with a measured result attached to the rules that approved it. Rules with
> nothing behind them get labelled taste-only.
>
> The number I put on the front page is deliberately unflattering. Loop-closure rate: of everything
> we published, how much do we actually know the result of?
>
> It starts at zero, because the field didn't exist, and sample data doesn't count toward it.
> Writing more content actually pushes it down, since every unmeasured piece grows the bottom of the
> fraction. The only way up is to go find out what happened.
>
> The hard part was never the agents. It was getting outcome data into the same place as the rules
> that produced it: one join key, the card id, stamped into the URL and the UTMs at generation time.
> After that every channel plugs into the same contract.
>
> If you're wiring agents together, put that key in before you think you need it. Retrofit it later
> and everything you already shipped stays unattributable.
