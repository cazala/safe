# Links

For agents, [skills/safe-wei/SKILL.md](../skills/safe-wei/SKILL.md) explains how to use these links.

Every screen in safe.wei has a URL, and some URLs prefill a form. Everything lives in the URL fragment (after `#`), so it is never sent to a server. Links never approve, sign or submit anything: they open a screen, and a prefilled form says it came from a link so the user checks it before reviewing.

This makes safe.wei easy to integrate with: a bot, a payroll script or another app can build a link with the fields filled in and send it to an owner, who opens it, checks it and signs.

`<safe>` is always a 0x address or a `.eth` / `.wei` name that resolves to one. The Safe is read on the chain the wallet is connected to, unless the link says the chain: `#tx=` and `#msg=` carry it in their payload, and any `#/<safe>[/<tab>]` route takes an optional `?chain=<chainId>` (decimal), e.g. `#/0x…/settings?chain=100`. When the wallet is on another chain, safe.wei offers the switch before opening the Safe.

## Screens

| Link | Opens |
| --- | --- |
| `#/` | Home: open a Safe, saved Safes and labels |
| `#/new` | Create a Safe (the owner list starts with the connected wallet; `?owners=&threshold=` prefill it, below) |
| `#/<safe>` or `#/<safe>/assets` | The Safe's balances |
| `#/<safe>/send` | Send to one recipient |
| `#/<safe>/batch` | Send to many recipients from CSV |
| `#/<safe>/transactions` | The review in progress, pending transactions found onchain, import a link or JSON |
| `#/<safe>/custom` | Transaction builder (contract calls from an ABI, raw calldata) |
| `#/<safe>/dapps` | Dapps connected to the Safe with WalletConnect |
| `#/<safe>/settings` (alias `setup`) | Owners, threshold, fallback handler, modules and guard |

## Prefilled sends

### One recipient

    #/<safe>/send?to=<address|name>&amount=<decimal>&token=<symbol|address>

- `to`: 0x address or `.eth` / `.wei` name
- `amount`: decimal amount in token units, e.g. `1.5` (not wei)
- `token`: a TokenList symbol (must be unambiguous), or a token address; leave it out for the native coin (ETH)

Every parameter is optional; the ones given are filled in.

Example: send 250 USDC to vitalik.eth from treasury.wei

    https://safe.caza.la/#/treasury.wei/send?to=vitalik.eth&amount=250&token=USDC

### Many recipients (CSV)

    #/<safe>/batch?csv=<url-encoded CSV>

One transfer per line, `recipient,amount[,token]`, with the same rules as above for each field: token empty for ETH. The rows are checked and previewed as soon as the page opens. They run as one Safe transaction (a MultiSendCallOnly batch), at most 200 rows.

Example: 0.1 ETH to vitalik.eth and 250 USDC to alice.wei

    https://safe.caza.la/#/treasury.wei/batch?csv=vitalik.eth%2C0.1%0Aalice.wei%2C250%2CUSDC

In JavaScript: `'#/' + safe + '/batch?csv=' + encodeURIComponent(rows.map((r) => r.join(',')).join('\n'))`.

## Prefilled calls

### Any call

    #/<safe>/custom?to=<address|name>&value=<wei>&data=<0x calldata>

Opens the transaction builder in Raw calldata with this call, under a "Prefilled from a link" warning. safe.wei uses the Safe's current nonce and checks the hash itself, so this is the simplest way for another app or an agent to propose any contract call: the owner reviews it, simulates it, and signs or adds it to a batch. Every parameter is optional.

- `to`: 0x address or `.eth` / `.wei` name
- `value`: the native coin to send, in **wei** (a decimal string; shown in ETH)
- `data`: 0x calldata

Only CALL; DELEGATECALL is never prefilled.

### Create a Safe

    #/new?owners=<address|name>,<address|name>&threshold=<n>

Opens Create a Safe with these owners (comma-separated) and threshold, under the same warning.

## Shared transactions

    #tx=<base64url payload>

A transaction with the signatures collected so far, copied from the review screen (Copy link). Readers ignore `&key=value` parameters after the payload (`#tx=<payload>&app=roles.wei`); that is where optional additions go, and today none are read. It opens the review screen for that Safe, where the next owner can check the SafeTx hash and add their signature. Other apps can build these links to hand a transaction to the owners (see "Building a `#tx=` link" below).

### Payload

`base64url` (no padding) of these bytes:

    uint(chainId) ‖ safe (20 bytes) ‖ compact

`compact` is also what an owner appends to `approveHash` calldata when publishing a transaction onchain (§ Stability):

| Field | Encoding |
| --- | --- |
| magic | `53 57 01` ("SW", version 1) |
| flags | 1 byte: bit 0 = DELEGATECALL, bit 1 = gas fields present, bit 2 = signatures present, bit 3 = call signatures present; every other bit must be 0 |
| to | 20 bytes |
| nonce | uint |
| value | uint (wei) |
| data | 3-byte big-endian length, then the bytes |
| gas fields (bit 1) | uint safeTxGas, uint baseGas, uint gasPrice, 20-byte gasToken, 20-byte refundReceiver; absent means all zero |
| signatures (bit 2) | 1-byte count, then count × 65-byte ECDSA signatures (r ‖ s ‖ v); signers are recovered, not stored |
| call signatures (bit 3) | 2-byte big-endian length, then UTF-8 text: one human-readable function signature per line (see below) |

`uint` = 1-byte length (0–32) followed by that many big-endian bytes (0 is a zero length). Readers reject unknown flag bits, trailing bytes and truncated input.

### Call signatures (readable reviews)

safe.wei decodes a few well-known calls itself (ERC-20 transfers and approvals, Safe settings). For anything else, a link can carry the **function signatures** its calls were encoded with, so signers see names and values instead of raw calldata:

    assignRoles(address module, bytes32[] roleKeys, bool[] memberOf)
    scopeFunction(bytes32 roleKey, address targetAddress, bytes4 selector, (uint8 parent, uint8 paramType, uint8 operator, bytes compValue)[] conditions, uint8 options)

- One signature per line, in the human-readable form (`function` keyword optional; tuples as `(type name, …)`, arrays as `type[]` / `type[N]`). Parameter names are shown to signers: make them descriptive.
- For each call (the transaction's own call, or each call of a MultiSendCallOnly batch), safe.wei picks the signature whose selector matches, decodes the calldata with it, and **encodes the decoded values again**. Only if that reproduces the calldata byte for byte is the call shown decoded, labeled as decoded with a signature that came with the transaction. Otherwise the call is shown raw.
- So the values shown are exactly what will execute; only the names (function and parameters) are the proposer's claim. safe.wei's own decoder always takes precedence over a link's signature.
- safe.wei keeps the signatures when it re-shares the transaction (links, JSON as `"abi": [...]`, onchain publication with an approval), trimmed to the ones the transaction uses. The Custom tab adds the signature of every call it encodes.

### Building a `#tx=` link

- Read the Safe's current `nonce()` (or pick a later one to queue).
- Encode the fields above; for batches, `to` is the canonical MultiSendCallOnly with bit 0 set (safe.wei accepts no other DELEGATECALL batch target).
- Add the call signatures of every call you encoded (bit 3), so the owners can read what they approve.
- Open `<any safe.wei gateway>/#tx=<payload>`. The fragment is the payload; any gateway serving safe.wei accepts it.
- safe.wei recomputes the SafeTx hash and checks it against the Safe's own `getTransactionHash`; the link is never trusted.

`node scripts/tx-link.mjs plan.json --rpc <url>` does all of this for one call or a batch: it reads the nonce over the RPC, builds the link with the call signatures, and refuses to print it unless the local SafeTx hash equals the Safe's own (`plan.json`: `{ "safe": "0x…", "calls": [{ "to", "value" (wei), "data", "signature" }], "nonce" }`).

The reference implementation is `src/share.js` (`fragment`, `fromFragment`, `compact`, `uncompact`, `importPayload`), dependency-free apart from `abi.js` and `safe.js`; other apps can copy it.

### JSON

**Copy as JSON** produces the same transaction as JSON (decimal strings for numbers, `safeTxHash` for cross-checking, `signatures` as hex, `abi` as a list of call signatures). Import accepts it and refuses it if `safeTxHash` does not match the fields.

## Messages

    #msg=<base64url payload>

A message for the Safe to sign (EIP-1271), with the owners' signatures so far. It opens the message review screen: owners sign it, and once enough have, the combined signature is shown for the app that asked. Apps can build these links to ask a Safe for a signature.

### Payload

`base64url` (no padding) of:

    uint(chainId) ‖ safe (20 bytes) ‖ 53 4d 01 ("SM", version 1) ‖ flags ‖ kind ‖ content ‖ [signatures]

| Field | Encoding |
| --- | --- |
| flags | 1 byte: bit 0 = signatures present; every other bit must be 0 |
| kind | 1 byte: 1 = EIP-191 message (personal_sign; content = the message bytes, text as UTF-8), 2 = EIP-712 typed data (content = its JSON as UTF-8), 3 = a raw 32-byte hash (as passed to `isValidSignature(bytes32, bytes)`) |
| content | 3-byte big-endian length, then the bytes |
| signatures (bit 0) | 1-byte count, then count × 65-byte ECDSA signatures of the SafeMessage |

What the owners sign: `SafeMessage(bytes message)` under the Safe's EIP-712 domain (`chainId`, `verifyingContract` = the Safe), where `message` is the 32-byte hash the app verifies: the EIP-191 hash of the text, the EIP-712 hash of the typed data, or the raw hash. safe.wei checks that hash against the Safe's own `getMessageHash` before anyone signs, and the combined signature (owners' signatures sorted by owner address, threshold of them) against the Safe's `isValidSignature` before showing it. The reference implementation is `src/share.js` (`messageFragment`, `fromMessageFragment`, `importMessage`) and `src/message.js`.

## Backup & sync

    #import=<z|j><base64url>

Saved Safes, folders, labels, ABIs and added tokens, made by Backup & sync on Home (`z` = deflate-raw compressed JSON, `j` = plain JSON). Opening it asks whether to merge the data into this browser (keeps everything already here) or replace it. Anyone holding the link sees the data, so share it only with yourself.

The JSON is `{ app: "safe.wei", v: 1, at, safes, tree, labels, labelsAt, abis, tokens }`, plus `calls` (saved custom calls per chain: `{ name, to, value, data, sig, human, line, vals }`, and for a transaction saved from History an optional `operation` (1 only into the canonical MultiSendCallOnly) and `hints`) when there are any, an optional addition; unknown or malformed entries are dropped on import (`src/backup.js` → `parse`).

## Stability

Links are how other apps (bots, roles.wei, scripts) talk to safe.wei, and links already sent to people must keep working. **These formats are frozen:**

- the routes in this document (`#/`, `#/new`, `#/<safe>[/<tab>]`, the `send`, `batch`, `custom` and `new` query parameters, `?chain=`);
- readers ignoring `&key=value` parameters after a `#tx=` / `#msg=` payload (pinned by a test): future optional parameters (e.g. `app=` naming the app that built a link) go there, so old readers keep opening new links;
- `#tx=` (payload above), including `compact`, which is also stored **onchain forever** in `approveHash` calldata of published transactions, and its call-signature section;
- `#msg=` (payload above);
- `#import=` (`z` and `j`, and the JSON shape);
- the transaction JSON of Copy as JSON.

Rules for changing safe.wei:

1. Never change the meaning, order or encoding of an existing field, flag bit or parameter.
2. Add capabilities only as **optional** additions: a new flag bit with a section appended after the existing ones, a new query parameter, a new JSON key. Readers keep rejecting unknown flag bits, so an old reader fails loudly on a new link instead of misreading it.
3. A change that cannot be backward compatible needs a new magic/version byte **and** the old version must keep decoding.
4. Golden vectors in `test/unit/links.test.mjs` pin the current encodings. If one fails, you broke a stable format: fix the code, not the vector. Add vectors for every new optional section.
