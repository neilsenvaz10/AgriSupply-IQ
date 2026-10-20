# Proposal (implemented in 2.3D): latest mandi observation per market

Status: **IMPLEMENTED in Milestone 2.3D** as `GET /api/v1/mandi-prices/latest` (see
`docs/api/historical-market-api.md` and `docs/api/express.openapi.json`). The text below is the original
proposal and is kept for the reasoning; where it differs from the shipped endpoint, the OpenAPI document wins.
(Originally: proposed for review, no API code was changed in Milestone 2.3C.)

## What the current API can and cannot do

`GET /api/v1/mandi-prices` returns rows ordered by `(observed_date ASC, id)`, requires a window of at most
366 days and has no descending order. With it:

- **Reliable:** the latest day for a commodity (`/commodities` coverage `last_date`) and every mandi that
  reported on that day (`from = to = last_date`, paged by cursor, complete); the latest day of one mandi
  (`/markets/{id}` coverage `last_date`) and that mandi's rows on it.
- **Not possible without many requests:** "the newest observation of each market" for a list of markets.
  Fetching the newest rows of a window and re-sorting them in the browser would only sort the loaded page
  and would be wrong; the frontend therefore does not do it. Answering it today needs one `/markets/{id}`
  request per market.

## Proposed contract

`GET /api/v1/mandi-prices/latest` (read-only, same envelope, `meta.is_live: false`).

| Parameter         | Rule                                   |
| ----------------- | -------------------------------------- |
| `commodity_id`    | required, UUID                         |
| `state_id`        | optional, UUID (markets of that state) |
| `limit`, `cursor` | as elsewhere (1-500, keyset)           |

Response `data[]`: one object per **market** that has at least one observation of the commodity, containing
that market's newest observation(s) for the commodity (same shape as a `/mandi-prices` row, including units,
`unit_basis`, source labels and `provenance`), plus `latest_observation_date`. Order: `(market name, market id)`
(alphabetical, **not** by price or date: the endpoint never implies a ranking). `meta` states
`"ordering": "market name; not a ranking"` and the `unit_note` of mandi data.

Query shape (one indexed pass per page, bounded by `limit`):
`SELECT DISTINCT ON (o.market_id) ... WHERE o.commodity_id = $1 ORDER BY o.market_id, o.observed_date DESC, o.id`
over `mandi_obs_history_idx (market_id, commodity_id, observed_date)`, joined to markets and paged by the
market id. No migration or new index is expected to be needed; this must be confirmed with `EXPLAIN
(ANALYZE, BUFFERS)` before implementation.

## Tests to write with it

- ordering and cursor stability (no market repeated or skipped across pages);
- a market with older-only observations still appears with its own (older) date;
- a market with no observation of the commodity does not appear;
- invalid `commodity_id` / `limit` / `cursor`, unknown commodity (empty list, not an error);
- read-only enforcement (`BEGIN READ ONLY`, no writes), database-error mapping;
- OpenAPI contract (schema in `express.openapi.json`) and a real captured example.

## Why it is not built yet

The frontend works with the existing API (latest available day per commodity and per market, single-day
windows). The new endpoint would make a per-market "last observed" list cheap. Implementing it needs your
approval of this contract.
