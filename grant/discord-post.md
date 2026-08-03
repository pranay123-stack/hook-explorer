# Uniswap Discord post

**Suggested channel:** `#hooks` or `#developers` — wherever hook builders actually are.
Post once, don't cross-post.

**Before posting:** replace `[FILL IN: DEPLOYED URL]` with the live Vercel URL. The sample
link must be a real working URL or the unfurl won't render, which defeats the point.

---

## Message

> Built a small tool for checking v4 hooks and would like feedback from people who
> actually write them.
>
> A hook's permissions live in the low 14 bits of its address, so verifying one by hand
> means masking the last four hex characters against `0x3fff`, expanding to binary, and
> mapping 14 bit positions to callback names in the right order — then separately
> checking the address is even valid, since `isValidHookAddress` rejects a return-delta
> flag whose parent action flag is missing. Explorers don't decode any of this, because
> it's a v4 convention rather than anything in the ABI.
>
> **Hook Explorer** takes an address and a chain and gives you the decoded permission set,
> the raw masked bits so you can check its working, proxy detection, source verification,
> a set of clearly-labelled risk heuristics, and the pools using that hook.
>
> Live: [FILL IN: DEPLOYED URL]
> Source: https://github.com/pranay123-stack/hook-explorer (MIT)
>
> Example — a Base hook holding 10 of the 14 permissions:
> [FILL IN: DEPLOYED URL]/?address=0x23321f11a6d44Fd1ab790044FdFDE5758c902FDc&chain=base
>
> Two things I want to be upfront about:
>
> - The risk flags are **heuristics, not an audit**. Several fire on completely
>   legitimate hooks by design — holding a return-delta permission is how custom curves
>   work. The goal is to make a hook's powers visible, not to grade it.
> - **Pool discovery is range-limited.** `Initialize` indexes `id`, `currency0` and
>   `currency1` but not `hooks`, so it can't be filtered at the RPC layer. The scan walks
>   a window of recent blocks and filters client-side, and the UI always states the range
>   it covered. Complete coverage needs an indexer.
>
> What I'd find most useful:
>
> - If it decodes any hook of yours incorrectly, please tell me — that's a correctness
>   bug and the most important kind of issue it can have.
> - Are the risk heuristics useful or just noise? I'd rather cut a check than have people
>   learn to ignore them.
> - Anything you look up about a hook that this doesn't show.

---

## Notes

**The sample link unfurls into a generated card** (1200×630) showing the chain, the
address with its permission-carrying suffix highlighted, and all 14 permissions as
lit/unlit chips. Both links above are the same deployment; the second is the one worth
watching unfurl.

**Tone check:** no adjectives about how good it is, no roadmap promises, no grant
mention. It leads with the problem, states the limitations before anyone has to ask, and
asks three specific questions rather than "thoughts?". Hook devs will find the edge cases
faster than any test suite, so the ask is the point of the post.

**If asked "why not just read the source?"** — reasonable answer: you still should, and
the tool says so. It tells you what the PoolManager will _let_ a hook do, which is
checkable in a second and is a different question from what the hook actually does.

**Do not claim** the tool is unique or the first of its kind. I could not find an
equivalent public tool while building this, but I have not exhaustively surveyed what
exists, and that claim is not worth making.
