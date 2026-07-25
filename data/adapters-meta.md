# Adapter: Meta Ads

## Access reality
The Meta Marketing API is free to call — you pay for ad spend, not API calls.
**Standard Access** is available as soon as you create a Meta app and add the Marketing API
product, and it covers any ad account you own or administer. That is all this adapter needs.
**Advanced Access** (managing ads for third-party advertisers) requires formal App Review,
typically six to eight weeks. This adapter does not need it.

## To enable
1. Create a Meta app and add the Marketing API product.
2. Generate a token with `ads_read` for your ad account.
3. Set `META_AD_ACCOUNT_ID` and `META_ACCESS_TOKEN` in `.env`.
4. Run `npm run measure`.

## Contract
Returns one `Outcome` per card id with `surface: "meta_ads"`, `metric: "cost_per_signup"`,
`provenance: "real"`. Join key is `utm_content=<card_id>` on the ad's destination URL.
