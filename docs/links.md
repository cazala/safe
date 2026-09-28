# Links

Every screen in safe.wei has a URL, and some URLs prefill a form. Everything lives in the URL fragment (after `#`), so it is never sent to a server. Links never approve, sign or submit anything: they open a screen, and a prefilled form says it came from a link so the user checks it before reviewing.

This makes safe.wei easy to integrate with: a bot, a payroll script or another app can build a link with the fields filled in and send it to an owner, who opens it, checks it and signs.

`<safe>` is always a 0x address or a `.eth` / `.wei` name that resolves to one. The Safe is read on the chain the wallet is connected to.

## Screens

| Link | Opens |
| --- | --- |
| `#/` | Home: open a Safe, saved Safes and labels |
| `#/new` | Create a Safe (the owner list starts with the connected wallet) |
| `#/<safe>` or `#/<safe>/assets` | The Safe's balances |
| `#/<safe>/send` | Send to one recipient |
| `#/<safe>/batch` | Send to many recipients from CSV |
| `#/<safe>/transactions` | Pending and past transactions |
| `#/<safe>/custom` | Transaction builder (contract calls from an ABI, raw calldata) |
| `#/<safe>/settings` | Owners, threshold, modules and guard |

## Prefilled sends

### One recipient

    #/<safe>/send?to=<address|name>&amount=<decimal>&token=<symbol|address>

- `to`: 0x address or `.eth` / `.wei` name
- `amount`: decimal amount in token units, e.g. `1.5` (not wei)
- `token`: a TokenList symbol (must be unambiguous), or a token address; leave it out for the native coin (ETH)

Every parameter is optional; the ones given are filled in.

Example: send 250 USDC to vitalik.eth from treasury.wei

    https://safe.wei/#/treasury.wei/send?to=vitalik.eth&amount=250&token=USDC

### Many recipients (CSV)

    #/<safe>/batch?csv=<url-encoded CSV>

One transfer per line, `recipient,amount[,token]`, with the same rules as above for each field: token empty for ETH. The rows are checked and previewed as soon as the page opens. They run as one Safe transaction (a MultiSendCallOnly batch), at most 200 rows.

Example: 0.1 ETH to vitalik.eth and 250 USDC to alice.wei

    https://safe.wei/#/treasury.wei/batch?csv=vitalik.eth%2C0.1%0Aalice.wei%2C250%2CUSDC

In JavaScript: `'#/' + safe + '/batch?csv=' + encodeURIComponent(rows.map((r) => r.join(',')).join('\n'))`.

## Shared transactions

    #tx=<base64url payload>

A transaction with the signatures collected so far, copied from the review screen (Copy link). It opens the review screen for that Safe, where the next owner can check the SafeTx hash and add their signature. The payload format is in [spec.md §7](spec.md#7-signature--approval-modes).

## Backup & sync

    #import=<z|j><base64url>

Saved Safes, folders, labels, ABIs and added tokens, made by Backup & sync on Home (`z` = deflate-raw compressed JSON, `j` = plain JSON). Opening it asks whether to merge the data into this browser (keeps everything already here) or replace it. Anyone holding the link sees the data, so share it only with yourself.
