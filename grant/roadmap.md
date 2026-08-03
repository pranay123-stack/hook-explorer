# Roadmap — Hook Explorer

Effort is given in **engineering-days**, not calendar dates, because calendar dates depend
on how much of my time is funded. Estimates are my own judgement from having built the
existing tool; they are defensible as _relative_ sizing rather than precise.

Each item states what exists today, so the delta is visible.

---

## Tier 1 — Quick wins

Small, well-understood, and shippable without changing the architecture. Roughly
**12–18 engineering-days** in total.

### 1.1 Reverse encoder: permissions → required address suffix — _2 days_

Pick a permission set, get the address bits a deployer must mine for. `encodePermissions()`
already exists and is tested across all 16,384 combinations; this is a UI surface over it
plus validation against the `isValidHookAddress` dependency rules, so a user cannot ask
for an impossible combination.

Useful to hook developers before deployment, which is a different audience from the
current one (people auditing a hook after the fact).

### 1.2 Compare two hooks side by side — _2 days_

Paste two addresses, diff the permission sets. Directly useful when a protocol ships v2 of
a hook and you want to know what changed, or when comparing a fork against its original.

### 1.3 Token symbols and decimals in the pool table — _2 days_

Today the pool table shows shortened addresses, with `address(0)` labelled `ETH (native)`.
Resolving ERC-20 `symbol()` and `name()` via multicall, with caching, would make the table
readable at a glance. Needs a fallback for tokens that do not implement the optional
metadata, and care not to trust names as identity.

### 1.4 More chains — _0.5 days per chain_

The chain registry is one object per chain. The work per chain is confirming the
PoolManager address from the deployments page, verifying it holds bytecode, and adding
the entry. Optimism, Polygon, Blast, Zora, Ink, Avalanche and BNB are the obvious
candidates, subject to which have v4 deployments at the time.

### 1.5 Richer proxy inspection — _3 days_

Today a proxy is detected and its implementation address reported. The next step is
following through: decode the implementation's permissions, check whether the
implementation is itself verified, and read the admin/beacon owner to distinguish an EOA
key from a multisig or timelock. That last distinction is the one that actually matters
for a user, and it is currently left as guidance text.

### 1.6 Accessibility and dark/light audit — _2 days_

Semantic markup and ARIA labelling are in place and the browser tests cover layout and
overflow. What has _not_ been done is a keyboard-only pass, a screen-reader pass, or a
contrast audit against WCAG AA. The app is currently dark-only.

### 1.7 Rate limiting and response caching — _2 days_

The API routes are unauthenticated and uncached. A public deployment that gets any real
traffic will burn its RPC quota. Bytecode is effectively immutable once deployed, so it
caches well; pool scans cache with a short TTL. Needed before promoting the tool widely,
rather than after.

---

## Tier 2 — The indexer _(the honest big-ticket item)_

**Effort: 20–30 engineering-days**, plus ongoing hosting.

### The problem, precisely

```solidity
event Initialize(
    PoolId indexed id, Currency indexed currency0, Currency indexed currency1,
    uint24 fee, int24 tickSpacing, IHooks hooks, uint160 sqrtPriceX96, int24 tick
);
```

`hooks` is in the data payload, **not a topic**. There is no way to ask a node for "pools
using hook X". The only options are to scan every `Initialize` log over a block range and
filter client-side — which is what the tool does today, covering ~108,000 blocks back from
head — or to index the events once and query them properly.

This is a protocol-level constraint, not a configuration I have set badly. No amount of
RPC tuning makes it go away. It is the single biggest gap between what the tool does and
what it should do, and it is the honest reason to fund the project.

### What would be built

1. **Backfill and follow.** Ingest `Initialize` from each PoolManager's deployment block
   to head, then follow the chain. Needs reorg handling, resumable checkpoints, and
   idempotent writes.
2. **A queryable store.** Pools keyed by hook, so a lookup is a single indexed query
   rather than a log walk. Postgres is sufficient; this is not a large dataset.
3. **Graceful degradation.** Keep the current RPC scan as a fallback so the tool never
   hard-depends on the indexer being up. The existing code path already handles partial
   results honestly, so this is mostly wiring.
4. **Enrichment made possible by indexing.** Pool creation dates, hook deployment
   ordering, and "how many pools use this hook" as a real number rather than a capped
   sample — none of which are reachable with a range scan.

### Why it is worth the cost

It changes the answer to the most-asked question from _"here are some pools, in this
window"_ to _"here are all of them"_. It also makes the tool viable as a data source for
other people's tooling, which Tier 3 depends on.

### What it costs beyond build time

A small always-on service and a database. Modest, but it is the first piece of ongoing
infrastructure the project would own, and it should be funded as such rather than assumed
free.

---

## Tier 3 — Stretch

Larger, higher-risk, and each worth doing only after Tier 2.

### 3.1 Hook simulation — _25–40 engineering-days_

The sharpest limitation of the current tool is that it reports what a hook is _permitted_
to do, never what it _does_. Simulation would close that: fork the chain at head, execute a
representative swap through a pool using the hook, and report the actual balance deltas —
what the hook took, what the user received, and how that compares to the same swap without
the hook.

This turns "this hook can alter swap amounts" into "this hook took N basis points on a
1 ETH swap", which is a categorically more useful statement.

Hard parts, honestly: choosing a representative swap that is not misleading; hooks whose
behaviour depends on state, caller, or time; sandboxing and the cost of fork execution;
and resisting the temptation to present a single simulated number as a general guarantee.
I would want this behind clear framing about what one simulation does and does not prove.

### 3.2 Public read API — _8–12 engineering-days_

A documented, versioned, rate-limited HTTP API returning the decoded permission set and
risk findings as JSON, so wallets, routers, dashboards and bots can call it rather than
reimplementing the bit decoding. Realistically depends on the indexer for the pool
endpoints.

The decoding logic is already a pure, exhaustively-tested module with no I/O, so a second
consumer is a small change. **Publishing the decoder as a standalone npm package is worth
doing regardless** and is a fraction of the cost — arguably it belongs in Tier 1.

### 3.3 Hook registry and reputation — _unscoped_

Community annotations: known-good hooks, known-bad hooks, links to audits, protocol
attribution. Deliberately unscoped, because the engineering is the easy part and the
governance is not. Who may annotate, how disputes resolve, and how to avoid a reputation
system becoming a de-facto whitelist are all unresolved. Listed for completeness, not
proposed.

### 3.4 Historical permission analytics — _10–15 engineering-days_

Once indexed: which permissions are actually used across deployed hooks, how that
distribution shifts over time, which combinations are common. Interesting to the Foundation
and to hook developers deciding what to build. Cheap once the indexer exists, impossible
without it.

---

## Suggested funding shape

If the grant is smaller than the full scope, this is the order I would defend:

1. **Tier 2 (the indexer)** — the one item that removes a real, protocol-imposed
   limitation, and the prerequisite for most of Tier 3.
2. **Tier 1.7 (rate limiting and caching)** and **1.4 (more chains)** — required before
   the tool can carry public traffic.
3. **Tier 3.2, npm package only** — cheap, and it lets other tools reuse the decoder
   immediately.
4. Remaining Tier 1 items by user demand, informed by Discord feedback.
5. **Tier 3.1 (simulation)** last — the highest value, but also where I am least confident
   in the estimate, and it should not block the rest.

---

## A note on these estimates

They come from having built the existing tool, which is a reasonable basis for Tier 1 —
those items are close in kind to work already done. Tier 2 I have moderate confidence in;
indexers are well-understood, and reorg handling is the usual place estimates slip.

**Tier 3.1 (simulation) is the least reliable number here.** The engineering is tractable;
what I cannot size confidently is how much work it takes to present simulated results
without overstating what a single simulation proves. If precision matters for a funding
decision, treat that item as a research spike first.
