// Approve and execute flows. Every step re-reads the Safe; nothing cached is trusted.
import { a, strip, u, word } from './abi.js';
import { review } from './review.js';
import { call, chainId, rpc, send, wait } from './rpc.js';
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

/** Re-validate everything (including offchain signatures), then execTransaction. Resolves to the receipt. */
export async function execute(t, from, sigs = []) {
  const s = await readSafe(t.safe);
  if (s.nonce !== t.nonce)
    throw Error(
      s.nonce > t.nonce
        ? 'The Safe nonce changed to ' + s.nonce + ': another Safe transaction executed first. Rebuild the transaction.'
        : 'Nonce ' + t.nonce + ' is queued; nonce ' + s.nonce + ' must execute first.',
    );
  const r = await review(t, s, await chainId());
  if (!r.ok) throw Error(r.errors[0]);
  const { sigs: all } = await collect(s, r.local, from, (await checkSigs(s, r.local, sigs)).valid);
  if (BigInt(all.length) < s.threshold) throw Error('Not enough approvals: ' + all.length + ' of ' + s.threshold + ' required.');
  // checkNSignatures reads exactly `threshold` signatures; keep the lowest signers so ordering holds.
  const chosen = all.sort((x, y) => (BigInt(x.signer) < BigInt(y.signer) ? -1 : 1)).slice(0, Number(s.threshold));
  const rc = await wait(await send(from, t.safe, execData(t, pack(chosen))));
  // txHash is non-indexed in v1.3.0 and indexed in later versions; accept either.
  const mine = (l) => l.address.toLowerCase() === t.safe && (l.topics[1] === r.local || strip(l.data).slice(0, 64) === strip(r.local));
  if (rc.logs.some((l) => l.topics[0] === T.ExecutionFailure && mine(l))) throw Error('The Safe reported ExecutionFailure for this transaction.');
  if (!rc.logs.some((l) => l.topics[0] === T.ExecutionSuccess && mine(l))) throw Error('No ExecutionSuccess event for this transaction in the receipt.');
  return rc;
}

// ---- offchain EIP-712 signatures (Mode B) ----

const ECRECOVER = '0x0000000000000000000000000000000000000001';

/** Normalize a 65-byte ECDSA signature to v ∈ {27, 28}. */
export function normSig(sig) {
  const h = strip(sig).toLowerCase();
  if (h.length !== 130) throw Error('A signature must be 65 bytes.');
  let v = parseInt(h.slice(128), 16);
  if (v < 2) v += 27;
  if (v !== 27 && v !== 28) throw Error('Unsupported signature type (v = ' + v + '). Only EIP-712 ECDSA signatures are accepted.');
  return '0x' + h.slice(0, 128) + v.toString(16);
}

/** Recover the signer of `hash` using the chain's ecrecover precompile (no secp256k1 code shipped). */
export async function recover(hash, sig) {
  const h = strip(normSig(sig));
  const r = await call(ECRECOVER, '0x' + strip(hash) + word(parseInt(h.slice(128), 16)) + h.slice(0, 128));
  if (strip(r).length !== 64 || !u(r)) throw Error('Invalid signature.');
  return a(r);
}

/** Validate signatures for `hash`: recover, require current owner, drop duplicates. */
export async function checkSigs(s, hash, sigs) {
  const valid = [], rejected = [], seen = new Set();
  for (const raw of sigs) {
    try {
      const sig = normSig(raw), signer = await recover(hash, sig);
      if (!s.owners.includes(signer)) throw Error('signer ' + signer + ' is not an owner');
      if (seen.has(signer)) throw Error('duplicate signature from ' + signer);
      seen.add(signer);
      valid.push({ signer, sig });
    } catch (e) {
      rejected.push({ sig: raw, reason: e.message });
    }
  }
  return { valid, rejected };
}

/** EIP-712 typed data for eth_signTypedData_v4. */
export const typedData = (t) => ({
  types: {
    EIP712Domain: [
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ],
    SafeTx: [
      ['to', 'address'], ['value', 'uint256'], ['data', 'bytes'], ['operation', 'uint8'], ['safeTxGas', 'uint256'],
      ['baseGas', 'uint256'], ['gasPrice', 'uint256'], ['gasToken', 'address'], ['refundReceiver', 'address'], ['nonce', 'uint256'],
    ].map(([name, type]) => ({ name, type })),
  },
  domain: { chainId: t.chainId, verifyingContract: t.safe },
  primaryType: 'SafeTx',
  message: {
    to: t.to, value: String(t.value), data: t.data, operation: t.operation, safeTxGas: String(t.safeTxGas), baseGas: String(t.baseGas),
    gasPrice: String(t.gasPrice), gasToken: t.gasToken, refundReceiver: t.refundReceiver, nonce: String(t.nonce),
  },
});

/** Sign offchain after the full review; verifies the wallet signed exactly this SafeTx hash. */
export async function sign(t, from) {
  const s = await readSafe(t.safe);
  const r = await review(t, s, await chainId());
  if (!r.ok) throw Error(r.errors[0]);
  from = from.toLowerCase();
  if (!s.owners.includes(from)) throw Error('The connected wallet is not an owner of this Safe.');
  const sig = normSig(await rpc('eth_signTypedData_v4', [from, JSON.stringify(typedData(t))]));
  if ((await recover(r.local, sig)) !== from) throw Error('The wallet returned a signature that does not match this SafeTx hash. Discarding it.');
  return sig;
}
