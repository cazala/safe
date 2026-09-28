# Safe Apps compatibility

**Status: removed.** A Safe Apps host (sandboxed iframe + SDK `postMessage` protocol) was built in Phase 13 (PR #15) and removed because no major app works with it. This page records why. The implementation is in git history (`src/apps.js` at commit 6c89860). Tested 2026-09-27.

## Protocol check with the real SDK

A test app built with `@safe-global/safe-apps-sdk` 9.1.0 (`test/fixtures/safe-app.js`), served from a separate origin and run against a mainnet fork:

| Call | Result |
| --- | --- |
| `safe.getInfo`, `getChainInfo`, `getEnvironmentInfo` | ✓ |
| `eth.getBalance` (rpcCall) | ✓ forwarded to the wallet RPC |
| `safe.experimental_getBalances` | ✓ ETH + TokenList balances |
| `eth.setSafeSettings` | ✓ acknowledged |
| `txs.signMessage` | refused ("not supported by safe.wei") |
| `txs.send` with 2 calls | ✓ MultiSendCallOnly batch → reviewed in safe.wei → executed → `safeTxHash` returned |
| `txs.getBySafeTxHash` polling | ✓ `SUCCESS` with the execution tx hash |

## Production apps

| App | Embeddable? | Result in safe.wei |
| --- | --- | --- |
| CowSwap (`swap.cow.fi`) | yes (`frame-ancestors *`) | loads, sends `getSafeInfo` once, ignores the reply, shows "Connect wallet" |
| Aave (`app.aave.com`) | yes (no frame headers) | loads, sends `getSafeInfo` once, then nothing |
| Lido (`stake.lido.fi`) | yes (`frame-ancestors *`) | loads, sends `getSafeInfo` once, then nothing |
| Uniswap (`app.uniswap.org`) | no: `frame-ancestors 'self' https://app.safe.global …`, `X-Frame-Options: SAMEORIGIN` | does not load |
| Morpho (`app.morpho.org`) | no: `frame-ancestors 'self' https://app.safe.global …` | does not load |

For CowSwap, Aave and Lido, the single `getSafeInfo` followed by silence is consistent with the SDK's `allowedDomains` check: the app ignores replies whose origin is not `app.safe.global`. This was inferred from behavior, not confirmed from their source.

Gateways: neither `*.wei.limo` nor `*.w4eth.io` sends a CSP or `X-Frame-Options`, so the frame itself is not blocked when safe.wei is served onchain.

## Conclusion

None of the five major apps work today. They are pinned to Safe's own origin, either by frame headers or by SDK origin checks, and nothing on the safe.wei side can change that. The host works for any app that uses the SDK with default settings (or wagmi's `safe()` connector without `allowedDomains`), including self-hosted and internal tools.

Decision: removed. It worked only for apps nobody uses in practice, and it added about 7 KB plus an iframe/message attack surface.

## Security properties of the removed host

- Messages are accepted only from the iframe's `contentWindow` and exact origin; replies go only to that origin.
- `sandbox="allow-scripts allow-same-origin allow-forms allow-popups"`, `referrerpolicy="no-referrer"`.
- `rpcCall` is limited to read methods (`READ` in `src/apps.js`); anything that signs or sends is refused.
- While a request is reviewed, the iframe is hidden and the review is rendered by safe.wei itself, so the app cannot overlay or imitate it. The review names the requesting origin.
- The top bar sits above the iframe in the layout, never under it, and always shows the app URL.
