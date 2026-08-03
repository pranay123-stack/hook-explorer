# Demo script — Hook Explorer

**Length:** 2–3 minutes.
**Audience:** Uniswap Foundation reviewers who know v4. Do not explain what hooks are or
how the flag encoding works — they know. Spend the time on what is tedious or
error-prone to do by hand.

**Demo hook:** `0x23321f11a6d44Fd1ab790044FdFDE5758c902FDc` on **Base**.

Chosen because it is the richest of the real hooks verified against: **10 of 14
permissions**, it triggers **two** distinct risk findings rather than one, and it returns
**100 pools** — enough to hit the result cap, which lets you show the truncation
messaging honestly instead of hand-waving it.

> **Before you start:** set `RPC_URL_BASE` to a dedicated endpoint. On the public Base
> RPC the pool scan took between 2 and 12 seconds across test runs, and that is the only
> part of the demo that visibly stalls. Also set `ETHERSCAN_API_KEY` — without it the
> verification row reads "not checked", which is honest but weaker on camera.

---

## 0:00 — Open on the landing page

**Screen:** the deployed URL, no query string.

> "In v4, a hook's permissions aren't in the contract — they're the low 14 bits of its
> address. Which means the information is public, but it isn't legible. Checking a hook
> by hand means masking the last four hex characters against 0x3fff and mapping fourteen
> bit positions to callback names in the right order."

**Action:** paste `0x23321f11a6d44Fd1ab790044FdFDE5758c902FDc` into the address field,
chain already on **Base**, click **Decode**.

_(Alternatively click the **Full lifecycle** example card, which is this same hook — but
pasting reads better, because it shows the actual workflow.)_

---

## 0:20 — Permission grid

**Expect on screen:** "10 of 14 active", five group cards:
Initialize 1/2 · Liquidity 4/4 · Swap 2/2 · Donate 1/2 · Return Delta 2/4.

> "Ten of fourteen. It gates every liquidity operation, both sides of every swap, and it
> holds both swap return-delta flags — so it can change what a swapper actually receives."

**Pause here for about two seconds.** This is the "oh, that's a lot" beat. Let them read
the grid.

> "Inactive permissions are shown greyed rather than hidden. Knowing what a hook _can't_
> do is as useful as knowing what it can."

---

## 0:45 — Raw masked bits _(the credibility beat — don't skip)_

**Action:** point at the **Raw masked bits** panel, left column.

**Expect on screen:** address with `2FDc` highlighted · Hex `0x2fdc` · Decimal `12252` ·
binary `10111111011100` · a 14-row table of bit / value / mask / permission.

> "This is the panel that makes the tool checkable rather than something you have to
> trust. Address suffix, the mask, the binary, and every bit mapped to its constant. If
> you disagree with a result, you can see exactly where it came from."

> "The constants are transcribed from v4-core's Hooks.sol, and the test suite checks the
> decoder against all 16,384 possible permission combinations — plus eight real hook
> addresses pulled from live Initialize events."

---

## 1:10 — Risk heuristics

**Action:** scroll slightly; point at the right column.

**Expect on screen:** amber "These are heuristics, not an audit" banner, then
**HIGH — Hook can alter swap amounts**, then **LOW — Hook intercepts every pool action**.

> "Two findings. The disclaimer is deliberate and it isn't dismissable — holding a
> return-delta permission is exactly how custom-curve hooks work, so plenty of legitimate
> hooks trip this. The tool's job is to make the powers visible, not to grade them."

**Action:** point at the `VERIFIED FACT` chip if one is on screen.

> "Findings that are mechanically checkable — no bytecode, or a flag combination
> `isValidHookAddress` rejects — are marked separately from the ones that are judgement
> calls."

---

## 1:35 — On-chain state

**Expect on screen:** Deployed bytecode `yes (24559 bytes)` · Source verified · Proxy
pattern `none detected` · Valid hook address `yes`.

> "Bytecode, EIP-1967, 1822 and 1167 proxy detection, and source verification through
> Etherscan's V2 API — one key covers all four chains. Proxy detection matters here: the
> permission bits are fixed forever by the address, but the code implementing them can be
> swapped if it's behind a proxy."

Keep this beat short — it is supporting evidence, not the headline.

---

## 1:55 — Associated pools

**Expect on screen:** "100 found · blocks …", a table with `ETH (native)` in Token 0, and
the footer line: _"Best-effort scan of N block ranges. This is a partial view…"_

> "Pools using this hook. And this is where I want to be straight with you about a limit:
> the Initialize event indexes id, currency0 and currency1 — not the hook. So you can't
> filter by hook at the RPC layer. This fetches every Initialize log over a block range
> and filters client-side."

> "It always states the range it covered. 'No pools found' means 'none in this window',
> never 'this hook has no pools'. Complete coverage needs an indexer, and that's the main
> thing I'd use the grant for."

**This is the most important 20 seconds of the demo.** Reviewers will spot the limitation
themselves; naming it first is stronger than being asked.

---

## 2:20 — Shareable URL and unfurl

**Action:** highlight the address bar, then click **Copy link**.

> "The whole state is in the query string, so every result is a link — and the tab title
> names the hook rather than the site."

**Action:** paste the link into a Discord channel and let it unfurl.

**Expect:** a 1200×630 card — chain, the address with its suffix highlighted, and all 14
permissions as lit/unlit chips.

> "Which is the point. When a hook address gets dropped in a channel and someone asks
> whether it's safe to route through, the answer is one paste — and the unfurl already
> shows the permission set before anyone clicks."

---

## Close

> "It's MIT, fully tested — 385 unit and integration tests plus 29 browser tests — and
> deployed. The roadmap is in the application; the headline item is a proper indexer so
> pool coverage stops being range-limited."

---

## If something goes wrong

| Problem                         | What to say / do                                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pool scan is slow or spinning   | _"That's the range scan I mentioned — it's the part an indexer fixes."_ Move on to the unfurl; don't wait on it.                                                                      |
| Pool scan errors / RPC 429s     | Genuinely fine — the analysis stays on screen. _"And note the decode and risk flags are unaffected, because those don't need an RPC at all."_ This is a **feature**, so lean into it. |
| Verification says "not checked" | `ETHERSCAN_API_KEY` isn't set on the deployment. _"That check degrades on its own; everything else is unaffected."_                                                                   |
| Whole page fails                | Fall back to a local `npm run dev`, or the screenshots in `screenshots/`.                                                                                                             |

## Backup hooks

If the primary hook misbehaves:

- `0x335c39D5AB526092E9e8619987b4f6B5B77ac0cC` (Base) — 4/14, one HIGH finding, 1 pool.
- `0xBc6e5aBDa425309c2534Bc2bC92562F5419ce8Cc` (Unichain) — 6/14, shows a second chain.
- `0x0000000000000000000000000000000000000004` (any chain) — an invalid flag combination,
  if you want to show the CRITICAL path. Nothing is deployed there, so it also shows the
  "no contract" finding.

## Verified figures

Every number above was observed against the live app on Base, not estimated. The two
figures that will drift are the pool count (100 is the result cap, so it will stay 100
while this hook stays active) and the block range shown, which moves with the chain head.
