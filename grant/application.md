# Grant application — Hook Explorer

**Applicant:** Pranay Gaurav
**GitHub:** https://github.com/pranay123-stack
**Project:** Hook Explorer — a permission decoder and safety-check tool for Uniswap v4 hooks
**Repository:** https://github.com/pranay123-stack/hook-explorer _(MIT)_
**Live demo:** [FILL IN: DEPLOYED URL]
**Contact:** [FILL IN: email / Telegram / Discord handle]
**Payout wallet:** [FILL IN: address + chain]
**Team:** [FILL IN: solo, or list collaborators]
**Amount requested:** [FILL IN: amount — see roadmap.md for costed scope]

---

## The problem

A v4 hook sits between a user and the PoolManager on every swap and every liquidity
change. Which callbacks it may intercept determines what it can do: a hook holding
`beforeSwapReturnDelta` can change how many tokens a swapper receives; one holding
`beforeRemoveLiquidity` can gate whether an LP can withdraw at all.

Those permissions are not stored anywhere. They are the low 14 bits of the hook's own
address, read off by the PoolManager on every call:

```solidity
// v4-core/src/libraries/Hooks.sol
uint160 internal constant BEFORE_SWAP_FLAG = 1 << 7;

function hasPermission(IHooks self, uint160 flag) internal pure returns (bool) {
    return uint160(address(self)) & flag != 0;
}
```

This is elegant, and it is why hooks are deployed to mined CREATE2 addresses. It also
means the information is fully public and almost entirely illegible. Checking a hook by
hand means taking the last four hex characters, masking against `0x3fff`, expanding to
binary, and mapping 14 bit positions to callback names in the correct order — then
separately confirming the address is valid at all, since `Hooks.isValidHookAddress`
rejects a return-delta flag whose parent action flag is absent.

Block explorers do not decode this. They show bytecode and, if verified, source; the flag
encoding is a v4 convention rather than anything expressed in the ABI.

The practical result: when a hook address appears in a Discord thread and someone asks
whether it is safe to route through, answering takes manual bit-twiddling that is easy to
get wrong and that almost nobody does.

## The solution

Paste an address and a chain. Get back:

- **All 14 permissions decoded**, grouped by lifecycle stage, with inactive ones shown
  rather than hidden — knowing what a hook _cannot_ do matters too.
- **The raw masked bits**, laid out next to the address suffix they came from, with every
  bit mapped to its `Hooks.sol` constant. This is the panel that makes the tool
  checkable rather than something you have to trust.
- **Address validity** against a port of `Hooks.isValidHookAddress`, including the
  return-delta dependency rules. An address violating those can never be used as a hook —
  the PoolManager reverts — which is a real defect worth surfacing, not a heuristic.
- **On-chain state**: deployed bytecode and size, and proxy detection across EIP-1967
  (implementation, admin, beacon), EIP-1822 UUPS, and EIP-1167 minimal proxies. This
  matters specifically because the permission bits are fixed forever by the address while
  the code implementing them can be replaced behind a proxy.
- **Source verification** via the Etherscan V2 API, where one key covers all four chains.
- **Risk heuristics**, explicitly labelled as such, with mechanically-verifiable findings
  marked separately from judgement calls.
- **Associated pools**, by scanning the PoolManager's `Initialize` events.
- **Shareable URLs** — all state lives in the query string, and links unfurl into a
  generated card showing the permission grid.

Decoding needs no network access, so it is instant and stays correct even when an RPC or
explorer is unavailable — a property the test suite pins explicitly.

## What is already built

This is not a proposal for something to start. It is deployed and working, with the
following verified:

**Correctness**

- The 14 flag constants are transcribed from `@uniswap/v4-core@1.0.2`
  `src/libraries/Hooks.sol`, and pinned by tests that re-declare the expected values
  independently, so the two must be changed in agreement.
- The decoder is checked against **all 2¹⁴ = 16,384 permission combinations** against an
  independent reference implementation.
- Verified against the worked example in the `Hooks.sol` natspec, and against **eight real
  hook addresses** collected from live `Initialize` events on Base and Unichain, with
  expectations derived by hand from each address suffix rather than from the decoder.
- `Hooks.isValidHookAddress` is ported in full, including the return-delta dependency
  rules and the dynamic-fee case.
- The EIP-1967 and EIP-1822 storage slots are re-derived in tests from their `keccak256`
  preimages rather than trusted as literals.

**Testing**

- **385 unit and integration tests**, plus **29 browser tests**.
- Integration tests drive real viem clients against a scripted JSON-RPC transport, so ABI
  encoding and decoding are genuinely exercised without a network.
- **Mutation-tested**: flipping `BEFORE_SWAP_FLAG` from `1 << 7` to `1 << 8` fails 21
  tests; the layout fixes were verified by reverting them and confirming the browser tests
  catch the exact pixel overflow.
- Explicit tests that a failing pool scan — a 429, a request that never resolves, an empty
  result — never blocks the decode, the on-chain panel, or the risk report.
- **Live-tested against Base and Ethereum mainnet**, not only mocks.

**Engineering**

- TypeScript strict mode with `noUncheckedIndexedAccess`, ESLint, Prettier.
- CI runs format, lint, typecheck, unit tests, build, and browser tests on every push.
- No backend beyond Next.js API routes; no database; no secrets required to run it.
- MIT licensed, with a contributing guide.

**Chains:** Ethereum, Base, Unichain, Arbitrum One. Each PoolManager address was
confirmed to hold bytecode before being added.

## Honest limitations

I would rather state these than have a reviewer find them.

- **The risk flags are heuristics, not audits.** They are pattern checks over address
  bits, bytecode, and explorer metadata. Several fire on entirely legitimate hooks by
  design — holding a return-delta permission is how custom curves work, and sitting behind
  a proxy is how most upgradeable protocols ship. A hook can pass every check and still be
  malicious. The UI says so prominently and non-dismissably.
- **Pool discovery is range-limited, and this is a protocol fact rather than a tuning
  problem.** `Initialize` indexes `id`, `currency0` and `currency1` — not `hooks`. Pools
  therefore cannot be filtered by hook at the RPC layer, so discovery means fetching every
  `Initialize` log over a block range and filtering client-side. The default scan covers
  roughly 108,000 blocks back from head. The UI always states the exact range covered, and
  "no pools found" is never presented as "this hook has no pools". **Fixing this properly
  requires an indexer, and it is the primary thing I would use a grant for.**
- **The visual layer is the newest and least battle-tested part.** Browser-based layout
  testing was added late, and it immediately found two real bugs — a spurious scrollbar
  and a missing `min-w-0` that broke the mobile layout. Both are fixed and now covered,
  but that part of the codebase has the least mileage.
- **Source verification needs an explorer API key.** Without one that single check reports
  "not checked" and everything else is unaffected.
- **Four chains are supported** because those are the PoolManager deployments wired in.
  Adding another is one entry in the chain registry.
- **It describes permissions, not intent.** Knowing a hook _can_ alter swap amounts says
  nothing about whether it does so fairly. Reading the source is still necessary, and the
  tool says so.
- **No formal audit**, and none is claimed. It is a read-only tool that holds no funds and
  signs no transactions, which bounds the risk, but it should not be treated as an
  authority on whether a hook is safe.

## Roadmap summary

Full detail with effort estimates in [roadmap.md](roadmap.md).

1. **Quick wins (weeks):** decode a permission set _into_ the address suffix a deployer
   must mine for; a "compare two hooks" view; ENS and token-symbol resolution in the pool
   table; more chains; richer proxy-implementation inspection.
2. **The big-ticket item: a real indexer.** Ingest `Initialize` events into a queryable
   store so pool coverage becomes complete rather than range-limited, and so lookups are
   instant instead of an RPC log walk. This is the single largest improvement available
   and the honest reason to fund the project.
3. **Stretch:** hook simulation (fork-execute a swap to see what a hook actually does to
   the delta, rather than only what it is permitted to do); a public read API other tools
   and bots can call; broader multi-chain coverage.

## Why me

I am the founder of PS VENTURE, where I build adaptive trading systems for crypto and
TradingView. My background is Web3 engineering across DeFi, payments, prediction markets,
and HFT/algorithmic trading infrastructure — so protocol-level detail, AMM mechanics, and
systems where a subtle correctness bug costs real money are the environment I work in
daily.

My public GitHub (https://github.com/pranay123-stack) shows a consistent pattern of
shipping complete, working Web3 systems rather than demos:

- **aura-card-asp** — x402 / MCP agent tooling for agent-to-agent payments.
- **noxstream** — confidential payroll streaming built on iExec.
- **guardian-keeperhub** — autonomous liquidation-protection keeper agents.
- **matchcall** — prediction markets on Solana.
- A substantial body of DeFi, AMM, and wallet implementations.

Two things about this project specifically are the strongest evidence:

**I verified the spec rather than trusting it.** Before writing code I pulled
`@uniswap/v4-core@1.0.2` and read `Hooks.sol` directly, and in doing so found three things
that materially shaped the design — that `Initialize` does not index `hooks` (which
determines the entire pool-discovery architecture), that `isValidHookAddress` enforces
return-delta dependency rules worth surfacing to users, and that a zero-flag address is
only legal on a dynamic-fee pool.

**The testing is the point, not decoration.** Exhaustive coverage of the permission space,
real production addresses as fixtures, mutation testing to prove the tests actually bite,
and explicit tests for degradation paths — a failed RPC read is specifically _not_
reported as "no contract deployed", because that would turn an outage into a false
critical finding. That instinct — that a tool making safety claims must be careful about
what it asserts when it doesn't know — is what I would bring to the rest of the roadmap.

---

## Notes for Pranay before submitting

Things to fill in: **payout wallet**, **contact details**, **team**, **deployed URL**, and
the **amount requested** (decide after reading `roadmap.md`).

Claims in this document that I verified directly against the repo or live chain: all test
counts, the exhaustive 16,384-combination coverage, the mutation-test result, the eight
real hook addresses, the four PoolManager addresses holding bytecode, live testing on Base
and Ethereum, and every limitation listed.

Claims taken from what you told me and **not independently verified**: your role at
PS VENTURE and the five named GitHub projects. Please confirm the repo names are spelled
as they appear publicly before submitting.

One claim I deliberately did **not** make anywhere: that this is the first or only tool of
its kind. I could not find an equivalent while building it, but I have not surveyed the
space exhaustively, and it is not a claim worth defending.
