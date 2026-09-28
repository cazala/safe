# safe.wei user guide

Everything this interface can do, screen by screen. For the links that open a screen or prefill a form, see [links.md](links.md). For the design and security rationale, see [spec.md](spec.md).

- [1. How it works](#1-how-it-works)
- [2. Wallets and chains](#2-wallets-and-chains)
- [3. Home](#3-home)
- [4. A Safe's page](#4-a-safes-page)
- [5. Assets](#5-assets)
- [6. Send](#6-send)
- [7. Transactions](#7-transactions)
- [8. Custom (contract calls)](#8-custom-contract-calls)
- [9. Settings](#9-settings)
- [10. Batches](#10-batches)
- [11. Review, approve and execute](#11-review-approve-and-execute)
- [12. Sharing with other owners](#12-sharing-with-other-owners)
- [13. Creating a Safe](#13-creating-a-safe)
- [14. Names, labels and addresses](#14-names-labels-and-addresses)
- [15. Backup and sync](#15-backup-and-sync)
- [16. What safe.wei checks for you](#16-what-safewei-checks-for-you)
- [17. What is stored in your browser](#17-what-is-stored-in-your-browser)
- [18. Troubleshooting](#18-troubleshooting)

---

## 1. How it works

safe.wei is a single HTML page with no backend. It is served from an onchain contract (ERC-8244 `html()`) at `safe.wei`, or from any copy of the same file.

- **Reads** go to the Safe contract itself, through your wallet's RPC: owners, threshold, nonce, modules, guard, balances. There is no Safe Transaction Service, indexer or API key.
- **Writes** are signed and sent by your wallet. safe.wei never holds a key.
- **Coordination between owners** happens by link (the transaction and its signatures travel in the URL fragment, which is never sent to a server) or onchain (an approval can carry the transaction's details, so other owners find it without a link).
- **Your own data** (saved Safes, folders, labels, ABIs, added tokens) lives in your browser's `localStorage` and can be moved to another device with Backup and sync.

## 2. Wallets and chains

### Connecting

- Wallets are discovered with EIP-6963, so several extensions can coexist; a browser that only injects `window.ethereum` shows it as "Browser wallet".
- **Connect** in the header opens the wallet picker (or connects directly when there is only one wallet). The chosen wallet is remembered.
- Once connected, the header button shows the chain and your short address. Its menu has **Switch wallet** and **Disconnect** (disconnect also asks the wallet to revoke the site's permission where supported).

### When something is missing

safe.wei says what it needs instead of failing after a click:

| State | What you see |
| --- | --- |
| No wallet in this browser | Home explains that safe.wei needs a wallet (install an extension on a computer, or open the page in a wallet app's browser on a phone). Links to a Safe show the same explanation with a copy-link button. The header shows a muted "No wallet". |
| Wallet available, not connected | Home says you will connect when opening a Safe. Opening a Safe (typed, from your list, or **Create**) connects first and then continues to it. A link opened on its own shows "Connect a wallet to open …" with one button per wallet. |
| Wallet on another chain | A Safe saved on a different chain shows "… is on Polygon" with **Switch to Polygon** (requested right away after a click). For a typed address you can also **Open it on … anyway**. |

### Chains

- safe.wei works on **any EVM chain** your wallet is on. An existing Safe is read entirely from its own contract.
- Features that need other contracts are enabled only where those contracts have code on the connected chain, checked on connect:
  - **creating Safes** needs Safe's canonical factory and singletons (v1.5.0, else v1.4.1);
  - **batches** need the canonical MultiSendCallOnly;
  - **token balances** use Multicall3.
- Known chains get a display name (Ethereum, OP Mainnet, BNB Chain, Gnosis, Polygon, Base, Arbitrum One, Avalanche, Linea, Scroll, Sepolia); any other chain shows as "Chain &lt;id&gt;".
- ENS, `.wei` names and the zOrg TokenList live on Ethereum mainnet, so on other chains names do not resolve (see [§14](#14-names-labels-and-addresses)) and tokens are added by address.

### Safe versions

- Any Safe from **v1.3.0** up can be operated. Versions 1.3.0, 1.4.1 and 1.5.0 are tested end to end.
- Newer versions work with a warning: nothing is ever signed unless the SafeTx hash computed locally equals the Safe's own `getTransactionHash`, so an incompatible future format would be refused rather than mis-signed.
- Versions before 1.3.0 are read-only (signing is disabled).

### Mobile

The layout adapts to phones. Use the built-in browser of a mobile wallet app: safe.wei talks to the injected wallet (WalletConnect would need a relay server).

## 3. Home

### First visit

With nothing saved yet, Home introduces safe.wei and offers the two ways in:

- **Open a Safe**: paste a Safe address, or a `.eth` / `.wei` name.
- **New to Safe? Create one**: see [§13](#13-creating-a-safe).
- **Moving from another device? Import a backup**: see [§15](#15-backup-and-sync).

### Returning (you have saved Safes)

Home becomes your list of Safes, under one bar:

- **Search, or open**: typing filters your Safes by nickname, the name they were opened by, their label or their address. If what you type is a new address or name, an **Open …** row appears. **Enter** opens the only match (or the Open row). **Escape** clears.
- **+ New ▾**: **New** creates a Safe; the caret opens a menu with **Labels** and **Backup & sync**. On chains without Safe's contracts only the menu shows.

Every Safe you open is saved automatically.

### Your Safes list

Each row shows the Safe's name (your nickname, else the name it was opened by, else its label, else "Safe 0xabcd…ffff") and its short address. The chain shows only when it differs from your wallet's; hover a row to see when it was last opened.

Row actions (on hover; always visible on touch screens):

- **Pin**: pinned Safes stay at the top of their level.
- **Rename**: an inline nickname, shared with the Safe's page title.
- **Remove**: removes it from the list (not from the chain), with **Undo** for a few seconds.

### Folders

- **Make a folder** by dragging one Safe onto another. Folders nest.
- **Open or close** a folder by clicking it; each folder remembers whether it is open.
- **Move things** by dragging a row before or after any other row, at any depth, or onto a folder to put it inside. Dragging a folder carries its contents; nothing can be dropped into itself.
- **Rename** a folder (hover → pencil). Unnamed folders are titled by their size ("3 safes"); named ones show their count.
- **Ungroup** (hover → folder-with-arrow icon) moves a folder's contents to its parent and removes the folder. Emptied folders disappear on their own.
- On touch screens, long-press a row to pick it up.

## 4. A Safe's page

The header shows a breadcrumb: **safe.wei / &lt;Safe&gt; ▾**. The logo goes Home; the Safe's name opens a switcher with your saved Safes (the current one marked, other chains labeled) and **All Safes**.

Below it:

- **Title**: the Safe's nickname or name, with a pencil to rename it in place.
- **One line** with the short address (click to copy), the policy ("3 of 5 owners") and "You're an owner" when that applies.
- **Warnings** only when relevant: an untested or unsupported version, or a transaction guard.

Tabs: **Assets**, **Send**, **Transactions**, **Custom**, **Settings**. A badge on Transactions counts pending transactions found onchain.

## 5. Assets

- The native balance, then every token with a non-zero balance: the zOrg TokenList's tokens (on Ethereum) plus tokens you added.
- Balances use aligned figures and two decimals when fractional; hover for the exact amount.
- Hover a row for **Send** (prefilled with that token) and, for tokens you added, **×** to remove them from your list. Send is disabled when the balance is zero.
- **+ Add token** (under the table) adds any ERC-20 by address. Added tokens are saved in your browser for every Safe on that chain.
- A callout appears when pending transactions were found onchain.

## 6. Send

### One recipient

- **Asset**: the native coin or any token the Safe holds (unlisted ones are marked).
- **Recipient**: a 0x address, or a `.eth` / `.wei` name (on Ethereum).
- **Amount**: in token units, with **Max** and the available balance shown.
- **Review** opens the review screen; **Add to batch** queues it (see [§10](#10-batches)).

### Many recipients (CSV)

Paste one transfer per line: `recipient,amount[,token]`.

- Separators: comma, semicolon, tab or spaces. A header row and `#` comments are ignored.
- Recipient: 0x address or `.eth` / `.wei` name.
- Token: empty (or the native symbol) for the native coin, a TokenList symbol (must be unambiguous), or a token address.
- **Preview** checks every row, with its line number, resolves names, and shows per-token totals against the Safe's balance.
- All rows run as one Safe transaction (a MultiSendCallOnly batch, or a plain transfer for a single row), at most **200 rows**.
- **Review** or **Add to batch**.

Both forms can be prefilled by a link (for bots and integrations): see [links.md](links.md). A prefilled form says so.

## 7. Transactions

- **In progress**: the transaction you were last reviewing, to continue it.
- **Pending**: transactions a proposer published onchain together with their approval (see [§11](#11-review-approve-and-execute)). safe.wei scans recent `ApproveHash` events (the last 50,000 blocks, in steps) and decodes the transaction carried in the approval. **Scan older blocks** goes further back. Each shows its nonce (next or queued), what it does, who proposed it and **Review**.
- **Import**: paste a safe.wei link, a `tx=` fragment or transaction JSON from another owner. If it is the transaction you are reviewing, its signatures are merged in.

Wallet RPCs limit how far back logs can be read; the status line says how far the search went.

## 8. Custom (contract calls)

An Etherscan-style "Write contract" for any contract.

- **Custom ABI**: paste a JSON ABI (an array, or a Hardhat / Foundry artifact with an `abi` field), upload a `.json` file, or write human-readable signatures, one per line (`function transfer(address to, uint256 amount)`).
  - Write methods are listed first, each with a form for its parameters. Payable methods get a value field.
  - ABIs are remembered per contract and chain, so the next time you pick that contract the ABI is already there.
- **Raw calldata**: a `to`, a value and hex calldata.

Parameter helpers:

- **Numbers**: type a decimal and pick the unit (× 1 raw, × 10^6, × 10^8, × 10^9 gwei, × 10^18 ether, or custom decimals), Etherscan-style. When the contract is a known token, amount-like parameters preselect its decimals. **max** fills 2²⁵⁶−1.
- **Booleans**: true / false.
- **Addresses**: 0x or names.
- **bytes / bytesN**: **text → hex** (UTF-8) and, for `bytes32`, **keccak256(text)**.
- **Arrays and tuples**: JSON, e.g. `["0x…", "1"]`, with an example for the exact shape.

Every call can be reviewed on its own or added to a batch. Nothing is fetched: the ABI is only used locally to encode the call, and the review says so ("Encoded here from the ABI you provided").

## 9. Settings

- **Owners**: the list, marking you. **Add owner** (with the new threshold), and per owner **Replace** or **Remove** (with the resulting threshold).
- **Threshold**: change how many owners must approve.
- **Modules**: every enabled module, identified when it is a known Zodiac module (Roles, Delay, Reality, Bridge, Exit, Scope / Meta Guard, Optimistic Governor, Tellor, Connext) by its implementation, with its version, its owner, and a warning for versions the Zodiac team lists as faulty. **Disable** a module.
- **Guard**: the transaction guard, if any, identified the same way, with **Remove guard**.
- **Contract**: version, nonce, singleton, fallback handler and chain.

Every change is a normal Safe transaction: it goes through review and needs the owners' approvals.

## 10. Batches

Where MultiSendCallOnly is deployed, any send, contract call or settings change can be **added to a batch** instead of reviewed alone.

- On desktop, **Batch N** in the header opens the batch: each call in one line ("ERC-20 transfer 1 MANA → pepe"), with **remove**, **Review batch** and **Clear**.
- On phones, the batch is a bar fixed to the bottom of the screen.
- The whole batch executes atomically in one Safe transaction (a DELEGATECALL into the canonical MultiSendCallOnly, the only batch target safe.wei accepts). If one call fails, none happen.
- A batch belongs to one Safe; switching Safes starts a new one.

## 11. Review, approve and execute

Every transaction, however it was built or opened, ends on the review screen.

### What you see

1. **What it does**, in plain words ("0.001 ETH → Vitalik B.", or the numbered calls of a batch), with any risk right under it and a line confirming the hash matches the Safe's own.
2. **The next step**, depending on who is looking:

| You are | Next step |
| --- | --- |
| An owner who has not approved | **Sign** (free) or **Approve onchain** (costs gas). The hash your wallet will show is printed below, to compare. |
| An owner who approved | "You approved · N more needed", with the link to send to the other owners. |
| Not an owner | "Send this to the owners", with the link as the main action. Useful when one person prepares a transaction and the signers only approve it. |
| An owner whose approval completes it | **Approve and execute**, or **Sign only** to let someone else pay the gas. |
| Anyone, once enough owners approved | **Execute**. |
| Queued behind an earlier nonce | Waits; it can execute once the earlier nonce has. |

3. **Approvals**: each owner with ✓ signed, ✓ approved onchain, or waiting, and **Refresh**.
4. **Transaction details** (collapsed): Safe, chain, nonce, to, value, operation, decoded action (per call for batches), calldata, gas fields, SafeTx hash and the Safe's own hash.

### Sign or approve onchain?

- **Sign** creates an EIP-712 signature in your wallet. It costs nothing and goes nowhere by itself: it travels in the link you share.
- **Approve onchain** calls the Safe's `approveHash`. It costs gas and is recorded in the Safe. With **Publish the details too** (on by default), the transaction's details are appended to the approval, so other owners find it under Transactions without any link (a few hundred gas more, shown next to the option).
- Both count the same toward the threshold, and they can be mixed.

### Executing

- Executing submits the transaction with the collected signatures (`execTransaction`). Any wallet can do it once the threshold is met; an owner who executes counts as an approval.
- Before approving, signing or executing, names used in the transaction are resolved again; if one changed, the action is refused.
- After executing you return to Assets with a confirmation.

## 12. Sharing with other owners

The share link carries the transaction and the signatures collected so far, in the URL fragment. Anyone with it can read it; only owners can approve.

- **Copy link** is the main action whenever the next step is someone else's.
- **Copy as JSON**: the same content as JSON.
- **Merge signatures from another link**: when owners sign separately and send their links back, paste them here to combine the signatures.
- Opening the link shows the same review screen, with the signatures already counted; invalid or foreign signatures are listed as ignored.

Alternatively, **Approve onchain** with published details: then no link is needed at all (see [§7](#7-transactions)).

## 13. Creating a Safe

**New** on Home (or the Create link on the first visit):

- **Owners**: one per line, addresses or names; your wallet is filled in.
- **Threshold**: "N of M owners must approve each transaction", updated as you add owners.
- **Advanced**: the salt nonce (the new address depends on it; a random one is prefilled).
- **Review** shows the deployment summary: the predicted address, chain, owners in full, threshold, singleton and version (SafeL2 outside Ethereum mainnet), factory, fallback handler and salt, with a warning if your wallet is not an owner. **Deploy Safe** sends it and opens the new Safe.

New Safes use v1.5.0 where deployed, else v1.4.1.

## 14. Names, labels and addresses

### Names

- Wherever an address is accepted, a `.eth` (ENS) or `.wei` (WNS) name works too, resolved onchain on Ethereum.
- Offchain (CCIP-read) records are refused, since safe.wei reads only onchain state. Names must be normalized lowercase.
- Owners and other addresses show their reverse name when they have one.
- On other chains, names do not resolve. A Safe saved on that chain under a name still opens by its saved address; otherwise you are offered to switch to Ethereum or use the 0x address. Inputs say the same in one line.

### Labels

Your own names for addresses (owners, recipients, contracts), in this browser.

- **Tag icon** next to any address adds or edits its label; **Labels** (Home → New ▾) lists them all, one per line, sorted by newest or by name, with add, edit and remove (with undo).
- A label wins over any name: the address then shows just the label, everywhere.

### How addresses are shown

- One name at most: your label, else its ENS / `.wei` name, else the address.
- Addresses show short (`0xabcd…ffff`) with the full address on hover. Clicking an address copies it, like the copy icon.
- **Where you sign** (the review screen and the deployment summary), addresses show in full: look-alike addresses share their first and last characters.

## 15. Backup and sync

Home → New ▾ → **Backup & sync** moves your Safes, folders, labels, ABIs and added tokens to another device.

- **Export**: **Copy link** (a compressed `#import=` link) or **Copy JSON**.
- **Import**: paste a link or JSON. A preview shows what it contains, then choose:
  - **Merge**: adds what is missing and never changes anything already here (an imported label cannot rename an address you labeled).
  - **Replace**: swaps everything in this browser for the backup (asks to confirm).
- Opening an `#import=` link starts the import directly.
- Anyone with a backup link can read your list, so keep it to yourself.

## 16. What safe.wei checks for you

Before any approval, signature or execution:

- **Hash**: the SafeTx hash computed locally must equal the Safe's own `getTransactionHash`. A mismatch disables every action.
- **Context**: the transaction must be for this Safe and the wallet's chain, with an unused nonce. Later nonces are marked as queued.
- **Simulation**: the call is run from the Safe with `eth_call` (each call of a batch on its own). Reverts, a token returning `false`, and calldata sent to an address without code are reported.
- **Decoding**: only exact, canonical encodings of known calls are decoded (ERC-20 transfer / approve / transferFrom, owner and threshold changes, modules, guard, fallback handler). Anything else is shown raw, never guessed.
- **Warnings** for: DELEGATECALL outside the canonical batch contract, enabling a module, setting a guard or fallback handler, unlimited approvals, owner and threshold changes, a Safe-management call aimed at another contract, non-zero gas refund fields, DELEGATECALL into an address without code, and untested Safe versions.
- **Names** are re-resolved right before acting.
- **Nothing remote**: the page loads no scripts, fonts or images from anywhere; there are no analytics.

## 17. What is stored in your browser

All in `localStorage`, under `safe.wei:`:

| Key | Contents |
| --- | --- |
| `safes` | Saved Safes: chain, address, the name it was opened by, nickname, pinned, last opened |
| `tree` | The order and folders of your Safes list |
| `open` | Which folders are open |
| `labels`, `labelsAt` | Your address labels, and when each was added |
| `labelsort` | Labels sort order |
| `abis` | ABIs you used, per chain and contract |
| `tokens:<chainId>` | Tokens you added, per chain |
| `wallet` | The wallet you chose (or that you disconnected) |

Clearing site data removes them; export a backup first.

## 18. Troubleshooting

- **"Not a Safe, or unreadable"**: the address has no Safe on the connected chain. Check the chain, or the address.
- **A name does not resolve**: names resolve on Ethereum only, onchain only (no CCIP-read). Use the 0x address on other chains.
- **Pending transactions are missing**: only transactions published onchain with an approval are listed, and only as far back as your wallet's RPC serves logs. Use **Scan older blocks**, or import the link.
- **Your wallet shows a different hash than the review**: do not sign. safe.wei prints the hash your wallet should show.
- **Switching chains fails**: some wallets do not know every chain; add it in the wallet first, or switch from the wallet.
- **Copy does nothing on a LAN address**: browsers limit the clipboard on plain `http` pages; safe.wei falls back to an older copy method, which some browsers also block.
