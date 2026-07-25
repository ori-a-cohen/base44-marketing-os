# Adapter: LinkedIn Ads

## Access reality
The Marketing Developer Platform requires manual approval with an undisclosed timeline —
realistically about four weeks at best and four months on average, and rejection is common
with reasons rarely communicated. This is not viable inside a short project, and pretending
otherwise would be dishonest.

## The path that works today
Export the campaign report as CSV from Campaign Manager and import it:

```bash
npm run measure -- --csv path/to/linkedin-report.csv
```

The importer joins rows to cards on the `utm_content` column, which carries the card id.
Imported outcomes are labelled `provenance: "manual"` — they are real, and they count toward
the metric, but they are never presented as automated.

## Contract
Returns one `Outcome` per matched card with `surface: "linkedin_ads"`,
`metric: "cost_per_signup"`, `provenance: "manual"`.
