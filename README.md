# Hook Explorer

**Paste a Uniswap v4 hook address. See exactly what it is allowed to do.**

A hook's permissions in Uniswap v4 are not stored in the contract — they are encoded in
the lowest 14 bits of the hook's own address. Hook Explorer decodes those bits, reads the
contract's on-chain state, runs a set of risk heuristics, and finds the pools that use it.

---

## Why this matters

### The problem

A Uniswap v4 hook sits between a user and the PoolManager on every swap and every
liquidity change. The specific callbacks it is allowed to intercept determine what it can
do: a hook holding `beforeSwapReturnDelta` can change how many tokens a swapper receives;
one holding `beforeRemoveLiquidity` can gate whether a liquidity provider can withdraw.

Those permissions are not stored in the contract. They are encoded in the lowest 14 bits
of the hook's own address, and the PoolManager reads them off the address on every call:

```solidity
// v4-core/src/libraries/Hooks.sol
uint160 internal constant BEFORE_SWAP_FLAG = 1 << 7;

function hasPermission(IHooks self, uint160 flag) internal pure returns (bool) {
    return uint160(address(self)) & flag != 0;
}
```

This is why hooks are deployed to mined CREATE2 addresses: the address _is_ the permission
manifest. It also means the information is there but not legible. Verifying what a hook
can do by hand requires taking the last four hex characters, masking against `0x3fff`,
expanding to binary, and mapping 14 bit positions to callback names in the correct order —
then separately checking that the address is even valid, since `Hooks.isValidHookAddress`
rejects a returns-delta flag whose parent action flag is absent.

Block explorers show the bytecode and, if verified, the source. They do not decode the
permission bits, because those are a v4-specific convention rather than anything in the
ABI. At the time of writing there is no widely-used tool that takes a hook address and
returns a readable permission set.

### What this does

Given an address and a chain, it decodes all 14 permissions and shows the masked bits
alongside the address they came from; checks the address against `isValidHookAddress`;
reads the deployed bytecode and the standard proxy storage slots; checks source
verification via the block explorer; runs a set of labelled risk heuristics; and scans the
PoolManager's `Initialize` events for pools using that hook. Results are addressable by
URL, so a specific hook can be linked directly.

The decoding step needs no network access — the address is sufficient — so it stays
correct and instant even when an RPC or explorer is unavailable.

### Honest limitations

- **The risk flags are heuristics, not an audit.** They are pattern checks over address
  bits, bytecode, and explorer metadata. Several fire on entirely legitimate hooks by
  design: holding a returns-delta permission is how custom-curve hooks work, and sitting
  behind a proxy is how most upgradeable protocols ship. A hook can pass every check here
  and still be malicious. Findings that are mechanically verifiable (no bytecode, an
  invalid flag combination) are marked separately from those that are judgement calls.
- **Pool discovery is range-limited, and this is not a tuning problem.** The v4
  `Initialize` event indexes only `id`, `currency0` and `currency1`; the `hooks` address
  is in the data payload. It therefore cannot be filtered at the RPC layer, so finding
  pools means fetching every `Initialize` log over a block range and filtering
  client-side. The default scan covers roughly 108,000 blocks back from head. "No pools
  found" means "none in the scanned window", and the UI always states the exact range
  covered. Complete coverage would need an indexer, which is outside the scope of a
  no-backend tool.
- **Source verification requires an explorer API key.** Without one, that single check
  reports "not checked" and everything else works unchanged.
- **Four chains are supported** — Ethereum, Base, Unichain, Arbitrum One — because those
  are the PoolManager deployments wired in. Adding another is a single entry in the chain
  registry.
- **It describes permissions, not intent.** Knowing a hook _can_ alter swap amounts does
  not tell you whether it does so fairly. Reading the source remains necessary.

## Feature detail

- **Decodes all 14 permissions** from the address, grouped by lifecycle stage
  (initialize / liquidity / swap / donate / return-delta), with the raw masked bits shown
  alongside the address suffix they came from.
- **Validates the address** against `Hooks.isValidHookAddress`, including the rule that a
  returns-delta flag requires its parent action flag. An address violating this can never
  be used as a hook — the PoolManager reverts.
- **Reads on-chain state** via viem: deployed bytecode, size, and proxy indicators
  (EIP-1967 implementation/admin/beacon slots, EIP-1822 UUPS, EIP-1167 minimal proxy).
- **Checks source verification** through the Etherscan V2 API.
- **Runs risk heuristics** over all of the above — clearly labelled as heuristics, not an
  audit.
- **Finds associated pools** by scanning the PoolManager's `Initialize` events.
- **Shareable URLs** — the address and chain live in the query string, so every result is
  a link, and it unfurls into a generated card showing the permission grid.

## Correctness

The 14 flag constants are transcribed from `@uniswap/v4-core@1.0.2`
`src/libraries/Hooks.sol` and pinned by tests that re-declare the expected values
independently. The test suite covers:

- every flag individually, and **all 2¹⁴ = 16,384 permission combinations** checked
  against an independent reference implementation;
- the worked example from the `Hooks.sol` natspec
  (`0x...2400` → `beforeInitialize` + `afterAddLiquidity`);
- **eight real hook addresses** collected from live `Initialize` events on Base and
  Unichain, with expectations derived by hand from each address suffix;
- the EIP-1967/1822 storage slots, re-derived in tests from their `keccak256` preimages
  rather than trusted as literals;
- risk heuristics, address validation, and the pool-scan planner;
- integration tests that drive real viem clients against a scripted JSON-RPC transport,
  so request encoding and ABI decoding are genuinely exercised without a network.

**385 unit and integration tests, plus 29 browser tests.**

Layout and appearance are verified separately, because jsdom has no layout engine and
cannot see overflow, wrapping, or anything visual. Playwright covers horizontal overflow
at 390 / 768 / 1280 px, table sizing in both directions, the empty / invalid / loading
states, the Open Graph card, and the guarantee that a failing pool scan never blocks the
rest of the analysis. Screenshots are written to `screenshots/`.

### One thing worth knowing about pool discovery

The v4 `Initialize` event indexes only `id`, `currency0`, and `currency1`:

```solidity
event Initialize(
    PoolId indexed id, Currency indexed currency0, Currency indexed currency1,
    uint24 fee, int24 tickSpacing, IHooks hooks, uint160 sqrtPriceX96, int24 tick
);
```

`hooks` is in the data payload, **not a topic** — so pools cannot be filtered by hook at
the RPC layer. The scan fetches every `Initialize` log over a chunked block range and
filters client-side, walking backwards from head so the newest pools surface first. It is
best-effort by construction, and the UI always reports the exact block range covered.
"No pools found" means "none in the scanned window", never "this hook has no pools".

## Local setup

Requires Node.js 20+.

```bash
git clone <your-repo-url>
cd hook-explorer
npm install

cp .env.example .env.local   # optional — see below
npm run dev
```

Open <http://localhost:3000>. The app works with no configuration at all, using public
RPC endpoints.

### Scripts

| Command                 | What it does                           |
| ----------------------- | -------------------------------------- |
| `npm run dev`           | Development server                     |
| `npm run build`         | Production build                       |
| `npm run start`         | Serve the production build             |
| `npm run test`          | Run the test suite once                |
| `npm run test:watch`    | Watch mode                             |
| `npm run test:coverage` | Coverage over the pure domain logic    |
| `npm run test:e2e`      | Playwright browser tests + screenshots |
| `npm run test:e2e:ui`   | Playwright in interactive UI mode      |
| `npm run lint`          | ESLint                                 |
| `npm run typecheck`     | `tsc --noEmit`                         |
| `npm run format`        | Prettier write                         |
| `npm run format:check`  | Prettier check (this is what CI runs)  |

## Environment variables

Every variable is **optional**. See [`.env.example`](.env.example) for the full
annotated list.

| Variable                | Purpose                                       | Default when unset                    |
| ----------------------- | --------------------------------------------- | ------------------------------------- |
| `RPC_URL_ETHEREUM`      | Ethereum mainnet RPC                          | `https://ethereum-rpc.publicnode.com` |
| `RPC_URL_BASE`          | Base RPC                                      | `https://mainnet.base.org`            |
| `RPC_URL_UNICHAIN`      | Unichain RPC                                  | `https://mainnet.unichain.org`        |
| `RPC_URL_ARBITRUM`      | Arbitrum One RPC                              | `https://arb1.arbitrum.io/rpc`        |
| `ETHERSCAN_API_KEY`     | Etherscan **V2** key — covers all four chains | verification check is skipped         |
| `POOL_SCAN_CHUNK_SIZE`  | Blocks per `eth_getLogs` call                 | `9000`                                |
| `POOL_SCAN_MAX_CHUNKS`  | Maximum `eth_getLogs` calls per scan          | `12`                                  |
| `POOL_SCAN_MAX_RESULTS` | Stop after this many pools                    | `100`                                 |
| `NEXT_PUBLIC_SITE_URL`  | Absolute origin, for Open Graph image URLs    | auto-detected on Vercel               |

Two notes:

- **A dedicated RPC is the single highest-impact setting.** Public endpoints rate-limit
  log queries aggressively, and the pool scan is entirely log queries.
- **Etherscan V2 uses one key for every chain.** It selects the network with a `chainid`
  parameter instead of a per-chain host, so you do not need separate Basescan/Arbiscan
  keys. Without a key, verification degrades to "not checked" and nothing else changes.

No secrets are committed. `.env.local` is gitignored, and the API key never appears in a
response body (there is a test for that).

## Deploy to Vercel

The app is a standard Next.js App Router project with no external services, so it deploys
with zero configuration beyond the environment variables.

1. Push the repository to GitHub.
2. In Vercel, **Add New → Project**, and import the repository. The framework preset,
   build command, and output directory are all detected automatically.
3. Under **Settings → Environment Variables**, add the variables you want (all optional —
   `ETHERSCAN_API_KEY` and the `RPC_URL_*` overrides are the ones worth setting for a
   public deployment).
4. Deploy.

Or from the CLI:

```bash
npm i -g vercel
vercel            # preview deployment
vercel --prod     # production
```

Add secrets with `vercel env add ETHERSCAN_API_KEY production` rather than putting them
in the repository.

## Architecture

```
src/
├── app/
│   ├── page.tsx                  entry, renders the explorer
│   └── api/
│       ├── inspect/route.ts      bytecode + proxy slots + verification + risk
│       └── pools/route.ts        chunked Initialize scan
├── components/                   AddressForm, PermissionGrid, BitsView,
│                                 RiskPanel, OnchainPanel, PoolsTable, ShareBar
└── lib/
    ├── flags.ts       the 14 constants, transcribed from Hooks.sol
    ├── decode.ts      masking, grouping, isValidHookAddress port   [pure]
    ├── address.ts     format + EIP-55 validation                   [pure]
    ├── proxy.ts       EIP-1967 / 1822 / 1167 detection             [pure]
    ├── risk.ts        heuristic analyzer                           [pure]
    ├── pools.ts       event ABI, scan planner, log decoding        [pure + IO]
    ├── chains.ts      chain registry, RPC resolution
    ├── explorer.ts    Etherscan V2 client
    └── inspect.ts     on-chain reads
```

Two design decisions worth calling out:

**Every on-chain function takes an injected `PublicClient`** rather than constructing one.
That is what lets integration tests drive the real viem client against a mock transport
with no network and no mocking library.

**Decoding is separated from everything that can fail.** Permissions come from the address
alone, so they render on the first paint and stay correct even when the RPC and the
explorer are both down. A failed bytecode read is explicitly _not_ reported as "no
contract deployed" — that would turn an RPC outage into a bogus critical finding.

## About the risk heuristics

They are pattern checks, not an audit. Several fire on entirely legitimate hooks by
design: holding `beforeSwapReturnDelta` is exactly how a custom-curve hook works, and
being behind a proxy is how most upgradeable protocols ship. A hook can pass every check
here and still be malicious.

Findings are split into two kinds. **Mechanical facts** (no bytecode, invalid flag
combination) are verifiable and marked as such in the UI. **Heuristics** (swap-delta
control, proxy patterns, full lifecycle control) are judgement calls about what a hook
_could_ do. The tool's job is to make the powers visible, not to render a verdict.

## License

MIT
