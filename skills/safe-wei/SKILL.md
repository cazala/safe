---
name: safe-wei
description: Propose Safe (Gnosis Safe) multisig transactions for people to review and sign in safe.wei, by link. Use when someone wants to send funds from a Safe, pay many recipients, call a contract from a Safe, change owners or threshold, create a Safe, or collect owner signatures for a specific transaction. safe.wei is a single-page app served onchain; it has no API and no backend.
---

# safe.wei by link

safe.wei is a Safe wallet interface that runs entirely in the browser and reads the chain through the user's wallet. Everything it does starts from a link: you build the link, a person opens it, checks it, and signs with their own wallet. **You never sign, send or hold keys.** A link only proposes; safe.wei recomputes everything it shows (the SafeTx hash against the Safe's own `getTransactionHash`, simulations, decoded calls) and never trusts the link.

Gateway: use `https://safe.caza.la/` unless the user uses another one. `https://safe.wei.limo/` and `https://safe.wei.is/` serve the onchain app once `safe.wei` is deployed; until then they do not load. The full reference is `docs/links.md` in the safe.wei repository.

## Pick the right link

| The user wants to… | Link |
| --- | --- |
| Open a Safe | `#/<safe>` (`<safe>`: 0x address or `.eth` / `.wei` name); add `?chain=<id>` when it is not on Ethereum |
| Send one token or ETH | `#/<safe>/send?to=<address|name>&amount=<decimal>&token=<symbol|address>` (amount in token units, e.g. `250`; no `token` for ETH) |
| Pay many recipients | `#/<safe>/batch?csv=<url-encoded CSV>`, one `recipient,amount[,token]` per line, up to 200 |
| Call any contract | `#/<safe>/custom?to=<address>&value=<wei>&data=<0x calldata>` |
| Change owners, threshold, modules | `#/<safe>/settings` (the owner edits there), or a `custom` / `#tx=` link calling the Safe itself (`addOwnerWithThreshold`, `removeOwner`, `changeThreshold`, …) |
| Create a Safe | `#/new?owners=<a>,<b>,<c>&threshold=<n>` |
| Collect signatures on one exact transaction (fixed nonce, shareable, several owners) | `#tx=<payload>` built with the script below |

Prefer the prefill links (`send`, `batch`, `custom`, `new`): they need no encoding, safe.wei uses the current nonce, and the page warns "Prefilled from a link" so the person checks it. Use `#tx=` when owners must sign the same transaction one after another, or when you must pin the nonce.

## Building links

- Prefills: plain URL parameters; URL-encode values (`encodeURIComponent`). Example: send 250 USDC to vitalik.eth from treasury.wei: `https://safe.caza.la/#/treasury.wei/send?to=vitalik.eth&amount=250&token=USDC`.
- Calldata for `custom`: ABI-encode it yourself (any library), and double-check the function and arguments; the person sees the raw call and safe.wei's decoding of it.
- `#tx=`: run, in a checkout of the safe.wei repository,

  ```bash
  node scripts/tx-link.mjs plan.json --rpc <an RPC URL for the Safe's chain> [--gateway https://safe.caza.la/]
  ```

  with `plan.json` `{ "safe": "0x…", "calls": [{ "to": "0x…", "value": "0", "data": "0x…", "signature": "transfer(address to, uint256 amount)" }], "nonce": "12" }` (`value` in wei; `signature` optional but include it, so owners read the call; `nonce` optional, default the current one; two or more calls become one MultiSendCallOnly batch). The script reads the nonce over the RPC and prints a link only if its SafeTx hash equals the Safe's `getTransactionHash`. Never hand-encode `#tx=`.

## Before you hand over a link

1. Say in plain words what it does: from which Safe, on which chain, to whom, how much, which function.
2. Use full 0x addresses you have verified, or names the user gave you. Never guess an address.
3. Tell the person to check the destination, the amounts and the decoded call in safe.wei, and that their wallet shows the same SafeTx hash safe.wei shows when signing.
4. Do not shorten, wrap or redirect the link: the person should see the gateway they trust.

## Limits

- safe.wei only proposes what the owners then approve: it cannot bypass the threshold.
- DELEGATECALL is never prefilled; batches use the canonical MultiSendCallOnly only.
- Reads go through the user's wallet (or an RPC endpoint they added in Settings); safe.wei contacts no other service.
- For Zodiac Roles permissions on a Safe (letting an address do specific things without the full threshold), use roles.wei (its `roles-wei` skill).

The sibling skill `roles-wei` (`npx skills add cazala/roles`) covers Zodiac Roles permissions in roles.wei.
