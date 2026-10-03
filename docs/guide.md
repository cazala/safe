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
- [11b. Signing messages](#11b-signing-messages)
- [12. Sharing with other owners](#12-sharing-with-other-owners)
- [12b. Using the Safe in other dapps (WalletConnect)](#12b-using-the-safe-in-other-dapps-walletconnect)
- [13. Creating a Safe](#13-creating-a-safe)
- [14. Names, labels and addresses](#14-names-labels-and-addresses)
- [15. Backup and sync](#15-backup-and-sync)
- [16. What safe.wei checks for you](#16-what-safewei-checks-for-you)
- [17. What is stored in your browser](#17-what-is-stored-in-your-browser)
- [18. Troubleshooting](#18-troubleshooting)

---

## 1. How it works

safe.wei is a single HTML page with no backend. It is served from an onchain contract (ERC-8244 `html()`) at `safe.wei`, or from any copy of the same file.

- **Reads** go to the Safe contract itself, through your wallet's RPC (WalletConnect's RPC for a wallet connected with WalletConnect, see [§2](#a-wallet-on-your-phone-walletconnect)): owners, threshold, nonce, modules, guard, balances. There is no Safe Transaction Service, indexer or API key.
- **Writes** are signed and sent by your wallet. safe.wei never holds a key.
- **Coordination between owners** happens by link (the transaction and its signatures travel in the URL fragment, which is never sent to a server) or onchain (an approval can carry the transaction's details, so other owners find it without a link).
- **Your own data** (saved Safes, folders, labels, ABIs, added tokens, saved calls) lives in your browser's `localStorage` and can be moved to another device with Backup and sync.
- **The footer** shows the build ID (the code version) and the app contract serving the page, so you can check it against the deployment record.

## 2. Wallets and chains

### Connecting

- Wallets are discovered with EIP-6963, so several extensions can coexist; a browser that only injects `window.ethereum` shows it as "Browser wallet".
- **Connect** in the header opens the wallet picker: the browser's wallets, then **WalletConnect**. The chosen wallet is remembered.
- Once connected, the header button shows the chain and your account: its .wei or ENS name when it has one (reverse-resolved on Ethereum and checked forward), else the short address. Its menu has **Switch wallet** and **Disconnect** (disconnect also asks the wallet to revoke the site's permission where supported).

### A wallet on your phone (WalletConnect)

**WalletConnect** is always in the wallet picker, after the browser's wallets. It lets an owner sign with a wallet elsewhere, e.g. Uniswap Wallet, MetaMask or Rainbow on a phone:

1. **Connect → WalletConnect** shows a QR code. Scan it with the wallet app and approve the connection there. On the same device, **Open wallet app** hands the link to an installed wallet; **Copy link** copies it.
2. The header shows the wallet's account. Transactions and signatures are sent to the phone; a dialog says where to confirm and closes when the wallet answers.
3. The chain: the menu offers **Switch to …** for every chain the wallet approved when connecting. For another chain, disconnect and connect again.
4. The connection survives reloads until you disconnect (from safe.wei or from the wallet) or it expires.

Reads cannot go through a phone, so with WalletConnect they go to WalletConnect's RPC (`rpc.walletconnect.org`, with safe.wei's project ID or your own, see [§12b](#12b-using-the-safe-in-other-dapps-walletconnect)). Before connecting, it reads Ethereum. The checks in [§16](#16-what-safewei-checks-for-you) are unchanged: nothing is signed unless the locally computed hash equals the Safe's own.

### When something is missing

safe.wei says what it needs instead of failing after a click:

| State | What you see |
| --- | --- |
| Wallet available, not connected | Home says you will connect when opening a Safe. Opening a Safe (typed, from your list, or **Create**) connects first and then continues to it. A link opened on its own shows "Connect a wallet to open …" with one button per wallet. |
| Wallet on another chain | A Safe saved on a different chain shows "… is on Polygon" with **Switch to Polygon**. When you picked it from your list, or a link says its chain, the switch is requested right away. A typed or pasted address may be a Safe on this chain too (the same address can exist on several), so nothing switches by itself: choose **Switch to Polygon** or **Open it on … anyway**. |

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

The layout adapts to phones. Use the built-in browser of a mobile wallet app, or connect a wallet app with WalletConnect (**Open wallet app**).

## 3. Home

### First visit

With nothing saved yet, Home introduces safe.wei and offers the two ways in:

- **Open a Safe**: paste a Safe address, or a `.eth` / `.wei` name.
- **New to Safe? Create one**: see [§13](#13-creating-a-safe).
- **Moving from another device? Import a backup**: see [§15](#15-backup-and-sync).

### Returning (you have saved Safes)

Home becomes your list of Safes, under one bar:

- **Search, or open**: typing filters your Safes by nickname, the name they were opened by, their label or their address. If what you type is a new address or name, an **Open …** row appears. **Enter** opens the only match (or the Open row). **Escape** clears.
- **+ New ▾**: **New** creates a Safe; the caret opens a menu with **Labels**, **Backup & sync** and **Settings**. On chains without Safe's contracts only the menu shows.
- **Settings** holds the **roles.wei gateway** (where Open in roles.wei and the footer link go: by default the one on the same gateway as this page, safe.caza.la → roles.caza.la, safe.wei.limo → roles.wei.limo, safe.wei.is → roles.wei.is, else roles.caza.la; or a built-in one or Custom…) and your own **RPC endpoints**: add an endpoint URL (Alchemy, Infura, your node) and every read on its chain goes there instead of your wallet's RPC, faster or where the wallet's RPC is unreliable. Its chain is detected from the endpoint; Remove takes it out. Signing, accounts and chain switching always stay in your wallet, and every hash you sign is still checked against the Safe. Endpoints are kept in this browser and are not included in backups. An optional **Etherscan API key** (free at etherscan.io) makes history searches (pending and executed transactions) one quick request through Etherscan's index instead of a scan block by block; each block a result comes from is checked against the chain, and the key is sent only to Etherscan. The first-visit page links to it too.

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

Tabs: **Assets**, **Send**, **Transactions**, **Custom**, **Dapps**, **Settings**. On phones the first three stay in the row and the rest are under **More ▾**, which shows the tab's name when one of them is open. A badge on Transactions counts pending transactions found onchain.

## 5. Assets

- The native balance, then the tokens: on Ethereum, every token of the zOrg TokenList with a non-zero balance ("Zero balances hidden" under the table); on every chain, the tokens you added, even at zero.
- Balances use aligned figures and two decimals when fractional; hover for the exact amount.
- Hover a row for **Send** (prefilled with that token), the eye to **hide** the token (dust, say) and, for tokens you added, **×** to remove them from your list. Send is disabled when the balance is zero.
- Hidden tokens are left out of this Safe's list (other Safes are not affected) and counted under the table ("1 token hidden"); **Show** lists them dimmed, with the eye to unhide. Send still offers them.
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
- **History**: executed transactions, newest first. Those executed in safe.wei are kept in this browser right away; the rest are found onchain from the Safe's `ExecutionSuccess` events (the last 50,000 blocks, or the whole history with an Etherscan key; **Search older blocks** goes further): safe.wei reads the transaction that executed it, decodes the `execTransaction` call (also inside a relayer's or multicall's call) and lists it only if it hashes to the SafeTx hash in the event. Each row shows its nonce, what it did and the execution transaction. **Redo** opens the same transaction at the current nonce; **Add to batch** adds its call, or each call of a batch, to the batch; **Save…** keeps it under Saved calls in Custom (a batch as a whole), to redo later. Transactions executed by a module are not listed (they have no SafeTx).
- **Import**: paste a safe.wei link, a `tx=` fragment or transaction JSON from another owner. If it is the transaction you are reviewing, its signatures are merged in.

Wallet RPCs limit how far back logs can be read; the status line says how far the search went. While it scans block by block it shows its progress, and **Add an Etherscan key** opens Settings: with a key the whole history is searched at once.

## 8. Custom (contract calls)

An Etherscan-style "Write contract" for any contract.

- **Custom ABI**: paste a JSON ABI (an array, or a Hardhat / Foundry artifact with an `abi` field), upload a `.json` file, or write human-readable signatures, one per line (`function transfer(address to, uint256 amount)`).
  - Write methods are listed first, each with a form for its parameters. Payable methods get a value field.
  - ABIs are remembered per contract and chain, so the next time you pick that contract the ABI is already there.
  - **Save…** on a method card keeps the filled-in call under a name you choose (default: the function and contract). **Saved calls** are listed at the top of Custom, per chain (also transactions saved from History): **Review** and **Add to batch** use it as saved (a saved batch is added call by call); **Edit**, for calls saved here, reopens its method card filled as you typed it, to change something and review or save it again; **×** deletes it.
- **Raw calldata**: a `to`, a value and hex calldata (and, under Advanced, the operation and the nonce).
- **Message (signed by the Safe)**: text, EIP-712 typed data (JSON) or a raw 32-byte hash, for the Safe to sign (see [§11b](#11b-signing-messages)).

Parameter helpers:

- **Numbers**: type a decimal and pick the unit (× 1 raw, × 10^6, × 10^8, × 10^9 gwei, × 10^18 ether, or custom decimals), Etherscan-style. When the contract is a known token, amount-like parameters preselect its decimals. **max** fills 2²⁵⁶−1.
- **Booleans**: true / false.
- **Addresses**: 0x or names.
- **bytes / bytesN**: **text → hex** (UTF-8) and, for `bytes32`, **keccak256(text)**.
- **Arrays and tuples**: JSON, e.g. `["0x…", "1"]`, with an example for the exact shape.

Every call can be reviewed on its own or added to a batch. Nothing is fetched: the ABI is only used locally to encode the call. The function's signature travels with the transaction (in share links, JSON and onchain publications), so other owners see the call decoded too (see [§11](#11-review-approve-and-execute)).

## 9. Settings

- **Owners**: the list, marking you. **Add owner** (with the new threshold), and per owner **Replace** or **Remove** (with the resulting threshold).
- **Threshold**: change how many owners must approve.
- **Modules**: every enabled module, identified when it is a known Zodiac module (Roles, Delay, Reality, Bridge, Exit, Scope / Meta Guard, Optimistic Governor, Tellor, Connext) by its implementation, with its version, its owner, and a warning for versions the Zodiac team lists as faulty. **Disable** a module. Without a Roles modifier, a quiet **Set up Zodiac Roles in roles.wei ↗** opens roles.wei on this Safe and chain with its create wizard (`#/<safe>?chain=<id>&create`). A Roles 2.1.1 modifier has **Open in roles.wei ↗**, which opens it there (on the same gateway as this page: safe.wei.is → roles.wei.is, safe.wei.limo → roles.wei.limo). The footer links to roles.wei and to the source code; these links are in the config chunk (`config/links.json`). Settings → **roles.wei gateway** picks another one (the built-in gateways, or Custom… for your own https URL), kept in this browser.
- **Enable a module (dangerous)**: enable a module by address, behind a warning that a module can move every asset without the owners.
- **Guard**: the transaction guard, if any, identified the same way, with **Remove guard**.
- **Contract**: version, nonce, singleton, fallback handler and chain. The fallback handler is named when it is one of Safe's (CompatibilityFallbackHandler, or ExtensibleFallbackHandler, which CoW Protocol's TWAP orders use). When it is missing, **Set default handler** proposes Safe's CompatibilityFallbackHandler for the Safe's release line; when it is unknown, **Reset to default handler** does (anything that relied on the old handler stops working). Without a handler, a Safe cannot sign messages (EIP-1271).

Every change is a normal Safe transaction: it goes through review and needs the owners' approvals.

## 10. Batches

Where MultiSendCallOnly is deployed, any send, contract call or settings change can be **added to a batch** instead of reviewed alone.

- On desktop, **Batch N** in the header opens the batch: each call in one line ("ERC-20 transfer 1 MANA → pepe"), with **remove**, **Review batch** (from two calls up) and **Clear**.
- On phones, the batch is a bar fixed to the bottom of the screen.
- The whole batch executes atomically in one Safe transaction (a DELEGATECALL into the canonical MultiSendCallOnly, the only batch target safe.wei accepts; the 1.3.0 one is recognized in existing transactions). If one call fails, none happen.
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
| An owner whose approval completes it | **Approve and execute**, or **Sign only** to let someone else pay the gas. **Copy link** shares it with the signatures so far. |
| Anyone, once enough owners approved | **Execute**, and **Copy link**: anyone with the link can open it and execute. |
| Queued behind an earlier nonce | Waits; it can execute once the earlier nonce has. |

3. **Approvals**: each owner with ✓ signed, ✓ approved onchain, or waiting, and **Refresh**.
- **Simulation**: a transaction is simulated before any action. A call runs as an `eth_call` from the Safe. A batch, or any DELEGATECALL, runs inside the Safe with its `simulateAndRevert` (Safe 1.3.0 and later), so the calls of a batch see each other's effects, as when executed. A batch that reverts is flagged, with each call also simulated on its own to point at the failing one. A token that returns `false` is flagged too. Simulation warns; it never blocks.
- **Modules and guards**: enabling a module or setting a guard shows what the contract is (e.g. "Zodiac Roles 2.1.1"), whether Zodiac lists that version as faulty, and who owns it: this Safe, an owner, or someone else, which is flagged. An address with no code yet shows "No contract here yet".
- **Deploying a Zodiac module** (the ModuleProxyFactory's `deployModule`, as roles.wei's setup batch does) is decoded: which module and version (faulty versions flagged), the address it will be deployed at, and, for Roles and Delay, its owner, avatar and target. An owner other than this Safe is flagged as dangerous (it could change what the module allows); an avatar or target other than this Safe is warned about. When the same batch enables the module, the enabled address must be the one deployed: it shows "Deployed by call N", and any other address is flagged.
- **Values**: a `bytes32` that is short text padded with zeros (a role key, for example) also shows as that text.

4. **Transaction details** (collapsed): Safe, chain, nonce, to, value, operation, decoded action (per call for batches), calldata, gas fields, SafeTx hash and the Safe's own hash.

### Calls safe.wei cannot decode by itself

safe.wei decodes ERC-20 transfers and approvals and Safe settings on its own. Other calls are shown decoded when the transaction came with their function signatures (from the Custom tab, or from the app that built the link, such as roles.wei): the function name and each parameter with its value, labeled "Decoded with a function signature that came with this transaction". A signature is used only if the decoded values re-encode to exactly the same calldata, so the values are what will execute, while the names are only a claim by whoever built it. Without a matching signature the call is shown as raw calldata.

### Sign or approve onchain?

- **Sign** creates an EIP-712 signature in your wallet. It costs nothing and goes nowhere by itself: it travels in the link you share.
- **Approve onchain** calls the Safe's `approveHash`. It costs gas and is recorded in the Safe. With **Publish the details too** (on by default), the transaction's details are appended to the approval, so other owners find it under Transactions without any link (a few hundred gas more, shown next to the option).
- Both count the same toward the threshold, and they can be mixed.

### Nonce: queueing and cancelling

- A new transaction takes the Safe's next nonce. Before anyone signs it, **change** next to the nonce sets another one, e.g. to queue it after a transaction that is still collecting signatures. Later nonces show as queued.
- To cancel a transaction that owners already signed, owners use **Cancel it with a replacement** (under Approvals): an empty transaction from the Safe to itself with the same nonce. Once it executes, the nonce is used up and the original can never execute.

### Executing

- Executing submits the transaction with the collected signatures (`execTransaction`). Any wallet can do it once the threshold is met; an owner who executes counts as an approval.
- Before approving, signing or executing, names used in the transaction are resolved again; if one changed, the action is refused.
- After executing you return to Assets with a confirmation.

## 11b. Signing messages

A Safe can sign messages (EIP-1271): apps that ask a Safe to "sign in", or to sign an order or a permit, verify the signature by calling the Safe's `isValidSignature`. The Safe says yes when enough owners have signed the message.

- Start from **Custom → Message**, or open a `#msg=` link an app or another owner sent you.
- The screen shows the message: text as text, typed data by its type (e.g. `Permit`), app, contract and fields, or a raw hash. Permissions to move assets (EIP-2612 permits, Permit2, Seaport orders) get a red warning; a raw hash gets a warning that its meaning cannot be shown; a typed-data chain that differs from the Safe's is flagged.
- The next step works like transactions. An owner chooses how to sign:
  - **Sign** (free): the wallet signs a `SafeMessage` whose message is the hash printed below; the signature travels in the link, and once enough owners sign, the combined signature is ready.
  - **Sign onchain** (costs gas): creates a Safe transaction that DELEGATECALLs Safe's canonical SignMessageLib. Owners approve and execute it like any transaction; afterwards the Safe accepts the message with an empty signature (`0x`), so nothing has to be passed to the app. The review names it "Sign a message onchain" rather than flagging a generic DELEGATECALL, and links back to the message.
  - An owner who signed, or a non-owner, sends the link to the other owners (a non-owner can also create the onchain transaction for the owners).
- Once enough owners have signed, **Signature ready** shows the Safe's signature with **Copy signature**, and confirms that the Safe accepts it. After an onchain signature, the screen shows **Signed onchain** instead.
- Before anyone signs, safe.wei checks its hash against the Safe's own `getMessageHash`. A Safe without a compatible fallback handler cannot validate messages, and says so.

## 12. Sharing with other owners

The share link carries the transaction and the signatures collected so far, in the URL fragment. Anyone with it can read it; only owners can approve.

- **Copy link** is the main action whenever the next step is someone else's.
- **Copy as JSON**: the same content as JSON.
- **Merge signatures from another link**: when owners sign separately and send their links back, paste them here to combine the signatures.
- Opening the link shows the same review screen, with the signatures already counted; invalid or foreign signatures are listed as ignored.

Alternatively, **Approve onchain** with published details: then no link is needed at all (see [§7](#7-transactions)).

## 12b. Using the Safe in other dapps (WalletConnect)

The **Dapps** tab connects the Safe to any dapp that supports WalletConnect.

- In the dapp, choose WalletConnect and copy its connection link (usually under the QR code, `wc:…`). Paste it in the Dapps tab and **Connect**. The dapp's name and site are shown as the dapp describes itself.
- **Requests** show in a bar at the top of every page: "Uniswap asks Council to send a transaction". **Review** opens the normal review screen (marked "Requested by … through WalletConnect"); **Reject** tells the dapp no.
  - A transaction goes through the usual approvals; when it executes, the dapp receives the transaction hash.
  - A signature request opens the message screen; once the Safe's signature is ready (or signed onchain), **Send to <dapp>** returns it.
  - Chain and account questions, and read-only calls, are answered automatically (reads through your wallet's RPC).
- Connections survive reloads; **Disconnect** ends one. Multi-owner approvals take time: a dapp may stop waiting after a few minutes, but the transaction still executes.
- **WalletConnect project**: safe.wei uses its own project ID. If connecting ever stops working, paste your own (a free WalletConnect project ID) in the Dapps tab.
- The connection is end-to-end encrypted between safe.wei and the dapp; WalletConnect's relay only carries ciphertext. Nothing is signed or sent without the normal review.

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

Home → New ▾ → **Backup & sync** moves your Safes, folders, labels, ABIs, added tokens and saved calls to another device.

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
- **No framing**: safe.wei refuses to run inside another page, so a site cannot overlay a crafted transaction on top of it.

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
| `calls` | Saved custom calls, per chain: name, contract, value, calldata, the function and what you typed |
| `tokens:<chainId>` | Tokens you added, per chain |
| `hidden` | Tokens you hid, per Safe (`<chainId>:<safe>`) |
| `wallet` | The wallet you chose (or that you disconnected) |
| `wc` | Dapps connected to your Safes (WalletConnect sessions and keys) |
| `wcowner` | A wallet connected with WalletConnect (session and keys) |
| `wcproject` | Your own WalletConnect project ID, if you set one |
| `explorerkey` | Your Etherscan API key, if you added one |
| `history` | Executed transactions, per Safe (`<chainId>:<safe>`): their fields, SafeTx hash and execution transaction |

Clearing site data removes them; export a backup first.

## 18. Troubleshooting

- **"Not a Safe, or unreadable"**: the address has no Safe on the connected chain. Check the chain, or the address.
- **A name does not resolve**: names resolve on Ethereum only, onchain only (no CCIP-read). Use the 0x address on other chains.
- **History stops early, or says executions could not be read**: your wallet's RPC no longer keeps old transactions (many keep about a year). safe.wei asks WalletConnect's RPC for those; if it cannot serve them either, add your own RPC endpoint (an archive node) in Settings.
- **Pending transactions are missing**: only transactions published onchain with an approval are listed, and only as far back as your wallet's RPC serves logs. Use **Scan older blocks**, add an Etherscan key in Settings (the whole history at once), or import the link.
- **Your wallet shows a different hash than the review**: do not sign. safe.wei prints the hash your wallet should show.
- **Switching chains fails**: some wallets do not know every chain; add it in the wallet first, or switch from the wallet.
- **Copy does nothing on a LAN address**: browsers limit the clipboard on plain `http` pages; safe.wei falls back to an older copy method, which some browsers also block.

Links can prefill the transaction builder with a call (`#/<safe>/custom?to=&value=&data=`, value in wei) and Create a Safe with owners and a threshold (`#/new?owners=&threshold=`); both show "Prefilled from a link" so you check them before reviewing. See [links.md](links.md).
