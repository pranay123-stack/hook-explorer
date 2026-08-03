# Contributing

Thanks for taking a look. Bug reports and corrections are especially welcome — if this
tool decodes something wrong, that is the most important kind of issue it can have.

## Reporting a decoding error

If a hook's permissions are reported incorrectly, please open an issue with:

- the hook address and chain,
- what the tool showed,
- what you expected, and why.

Please include this even if you are not sure — a decode that disagrees with the
PoolManager is a correctness bug, and it is worth checking either way.

## Setup

Requires Node.js 20+.

```bash
npm install
cp .env.example .env.local   # optional; the app runs without it
npm run dev
```

## Before opening a pull request

```bash
npm run format
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:e2e      # needs a browser: npx playwright install chromium
```

CI runs all of these. None of them need secrets or network access — the unit and
integration suites use a scripted JSON-RPC transport rather than a live node.

## What the tests are for

The layout mirrors where things can go wrong, so please add tests in kind:

- **`src/lib/*.ts`** is pure logic and carries the correctness burden. `decode.ts` in
  particular is checked against all 2¹⁴ permission combinations and against real hook
  addresses taken from live `Initialize` events. Changes here need tests.
- **`src/lib/__tests__/*.integration.test.ts`** drives real viem clients against a mock
  transport, so ABI encoding and decoding are genuinely exercised without a network.
- **`src/components/__tests__/mount.test.tsx`** mounts with the real client reconciler
  under jsdom. It exists because server rendering cannot detect duplicate keys or
  hook-order violations, and a duplicate-key bug once shipped past the render tests.
- **`e2e/`** is Playwright, and owns everything jsdom cannot see: layout, overflow,
  wrapping, and the generated Open Graph card.

## Changing the flag constants

`src/lib/flags.ts` is transcribed from `@uniswap/v4-core` `src/libraries/Hooks.sol`. If
v4-core changes, update the constants **and** the expected values in
`src/lib/__tests__/decode.test.ts`, which deliberately re-declares them independently so
the two have to be changed in agreement. Please cite the v4-core version in the PR.

## Adding a chain

Add an entry to `CHAINS` in `src/lib/chains.ts` with the chain's PoolManager address
from the Uniswap deployments page, and confirm the address actually holds bytecode
before submitting. `src/lib/__tests__/chains.test.ts` will check the checksum and the
registry's internal consistency.

## Risk heuristics

New heuristics are welcome, with two rules:

1. Mark a finding `heuristic: false` **only** if it is mechanically verifiable (for
   example, empty bytecode, or a flag combination `Hooks.isValidHookAddress` rejects).
   Anything that is a judgement call stays `heuristic: true`.
2. Do not imply a verdict about a hook's safety. Many legitimate hooks hold powerful
   permissions by design. The tool's job is to make those powers visible, not to rate
   them.

## Style

Prettier and ESLint are configured; `npm run format` before committing. TypeScript runs
in strict mode with `noUncheckedIndexedAccess`. Comments should explain why something is
the way it is, not restate the code.

## License

By contributing you agree that your contributions are licensed under the MIT License,
as in [LICENSE](LICENSE).
