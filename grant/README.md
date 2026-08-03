# Grant submission materials

Drafts for the Uniswap Foundation grant submission. Each file stands alone and can be
edited independently.

| File                               | What it is                                                      |
| ---------------------------------- | --------------------------------------------------------------- |
| [demo-script.md](demo-script.md)   | 2–3 minute screen-share script, click by click, with fallbacks  |
| [discord-post.md](discord-post.md) | Message for the Uniswap Discord, plus notes on tone             |
| [application.md](application.md)   | The application draft: problem, solution, built, limits, why me |
| [roadmap.md](roadmap.md)           | Post-grant roadmap in three tiers, with effort estimates        |

## Before submitting

Search for `[FILL IN:` across this directory — those are the only placeholders, and they
are all things only you can supply:

- payout wallet address and chain
- contact details (email / Telegram / Discord)
- team composition
- the deployed URL
- the amount requested

```bash
grep -rn "\[FILL IN:" grant/
```

## Grounding

Every technical claim in these documents was verified against the repository or against
live chain data — test counts, the exhaustive 16,384-combination coverage, the mutation
test result, the eight real hook addresses, the four PoolManager deployments, and the
demo hook's decoded values.

Two things are stated on your authority rather than independently verified: your role at
PS VENTURE, and the five named GitHub projects in the "why me" section. Confirm those
repository names are spelled as they appear publicly.

One claim is deliberately **absent** everywhere: that this is the first or only tool of
its kind. No equivalent turned up while building it, but the space was not exhaustively
surveyed, and it is not a claim worth defending under scrutiny.
