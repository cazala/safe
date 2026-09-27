// Approve and execute flows. Every step re-reads the Safe; nothing cached is trusted.
import { strip } from './abi.js';
import { review } from './review.js';
import { chainId, send, wait } from './rpc.js';
import { approveData, approvedBy, execData, pack, prevalidated, readSafe } from './safe.js';
import { T } from './sel.js';

/**
 * Signatures available for `hash`: onchain approvals, plus the executor's own
 * pre-validated signature when the executor is an owner (msg.sender == owner is
 * accepted by checkNSignatures without approveHash), plus offchain signatures.
 * `offchain` is [{signer, sig}] already validated by the caller.
 */
export async function collect(s, hash, executor, offchain = []) {
  const approved = await approvedBy(s, hash);
  const by = new Map(approved.map((o) => [o, { signer: o, sig: prevalidated(o), kind: 'onchain' }]));
  const me = executor && executor.toLowerCase();
  if (me && s.owners.includes(me) && !by.has(me)) by.set(me, { signer: me, sig: prevalidated(me), kind: 'executor' });
  for (const x of offchain) if (s.owners.includes(x.signer) && !by.has(x.signer)) by.set(x.signer, { ...x, kind: 'offchain' });
  return { approved, sigs: [...by.values()] };
}

/** approveHash from an owner, optionally with a compact payload appended (spec §7.3 Layer 2). */
export async function approve(t, from, payload) {
  const s = await readSafe(t.safe);
  const r = await review(t, s, await chainId());
  if (!r.ok) throw Error(r.errors[0]);
  if (!s.owners.includes(from.toLowerCase())) throw Error('The connected wallet is not an owner of this Safe.');
  return wait(await send(from, t.safe, approveData(r.local, payload)));
}

/** Re-validate everything, then execTransaction. Resolves to the receipt. */
export async function execute(t, from, offchain = []) {
  const s = await readSafe(t.safe);
  if (s.nonce !== t.nonce)
    throw Error(
      s.nonce > t.nonce
        ? 'The Safe nonce changed to ' + s.nonce + ': another Safe transaction executed first. Rebuild the transaction.'
        : 'Nonce ' + t.nonce + ' is queued; nonce ' + s.nonce + ' must execute first.',
    );
  const r = await review(t, s, await chainId());
  if (!r.ok) throw Error(r.errors[0]);
  const { sigs } = await collect(s, r.local, from, offchain);
  if (BigInt(sigs.length) < s.threshold) throw Error('Not enough approvals: ' + sigs.length + ' of ' + s.threshold + ' required.');
  // checkNSignatures reads exactly `threshold` signatures; keep the lowest signers so ordering holds.
  const chosen = sigs.sort((x, y) => (BigInt(x.signer) < BigInt(y.signer) ? -1 : 1)).slice(0, Number(s.threshold));
  const rc = await wait(await send(from, t.safe, execData(t, pack(chosen))));
  // txHash is non-indexed in v1.3.0 and indexed in later versions; accept either.
  const mine = (l) => l.address.toLowerCase() === t.safe && (l.topics[1] === r.local || strip(l.data).slice(0, 64) === strip(r.local));
  if (rc.logs.some((l) => l.topics[0] === T.ExecutionFailure && mine(l))) throw Error('The Safe reported ExecutionFailure for this transaction.');
  if (!rc.logs.some((l) => l.topics[0] === T.ExecutionSuccess && mine(l))) throw Error('No ExecutionSuccess event for this transaction in the receipt.');
  return rc;
}
