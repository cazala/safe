// Transaction review: everything that must hold before any approve / sign / execute.
// `ok === false` means every action is disabled (spec §6, §15).
import { B, cd, strip, u, ZERO } from './abi.js';
import { matchCall } from './abicoder.js';
import { SIGN_MESSAGE_LIBS } from './chains.js';
import { decode } from './decode.js';
import { unpack } from './multisend.js';
import { rpc } from './rpc.js';
import { chainTxHash, safeTxHash } from './safe.js';
import { S } from './sel.js';

const ERC20_BOOL = [S.transfer, S.approve, S.transferFrom];

/** A DELEGATECALL into Safe's canonical SignMessageLib, exactly `signMessage(bytes)`: returns the message, else null. */
export function signMessageOf(t) {
  if (t.operation !== 1 || !SIGN_MESSAGE_LIBS.includes(t.to) || t.value) return null;
  const m = matchCall(['signMessage(bytes message)'], t.data);
  return m ? m.values[0] : null;
}

/** The revert data of an eth_call error, wherever the wallet put it (e.data, e.data.data, e.error.data…). */
export function revertData(e, depth = 0) {
  if (!e || depth > 4) return null;
  if (typeof e === 'string') return /^0x([0-9a-f]{2})*$/i.test(e) ? e : null;
  if (typeof e !== 'object') return null;
  for (const k of ['data', 'error', 'cause', 'info', 'originalError']) {
    const d = revertData(e[k], depth + 1);
    if (d) return d;
  }
  return null;
}
/**
 * Run a DELEGATECALL inside the Safe, as execution would: the Safe's simulateAndRevert (StorageAccessible,
 * Safe ≥ 1.3.0) runs it, then reverts with (success, returndata). true / false, or null if the RPC hides it.
 */
async function simulateInside(t) {
  const e = await rpc('eth_call', [{ to: t.safe, data: cd(S.simulateAndRevert, t.to, B(t.data)) }, 'latest']).then(() => null, (x) => x);
  const d = revertData(e);
  return d && d.length >= 130 ? u(d) === 1n : null;
}

/** Simulate the transaction from the Safe. Returns a warning string or null. */
export async function simulate(t) {
  if (signMessageOf(t)) return null; // one effect: marks a message as signed (checked by its hash afterwards)
  const calls = unpack(t), whole = t.operation ? await simulateInside(t).catch(() => null) : null;
  if (calls) {
    // The batch as a whole, in order (earlier calls' effects applied), when the RPC returns the result;
    // each call on its own as well, to point at a failing call and catch tokens that return false.
    const w = (await Promise.all(calls.map((c) => simulate({ ...t, ...c, operation: 0 })))).map((x, i) => x && 'Call ' + (i + 1) + ' (simulated on its own): ' + x);
    if (whole === true) return w.filter((x) => x && x.includes('FALSE')).join('\n') || null;
    return [whole === false && 'Simulation: this batch REVERTS if executed now.', ...w].filter(Boolean).join('\n') || null; // one line per call
  }
  if (t.operation) return whole === true ? null : whole === false ? 'Simulation: this DELEGATECALL REVERTS if executed now.' : 'DELEGATECALL is not simulated.';
  const [code, ret] = await Promise.all([
    rpc('eth_getCode', [t.to, 'latest']),
    rpc('eth_call', [{ from: t.safe, to: t.to, data: t.data, value: '0x' + t.value.toString(16) }, 'latest']).catch((e) => ({ e })),
  ]);
  if (ret.e) return 'Simulation: this call REVERTS if executed now (' + (ret.e.message || ret.e) + ').';
  if (code === '0x' && t.data !== '0x') return 'The destination has no contract code, but the transaction carries calldata.';
  if (ERC20_BOOL.includes(strip(t.data).slice(0, 8)) && strip(ret).length === 64 && u(ret) === 0n)
    return 'Simulation: the token returned FALSE. The transfer would not happen, yet the Safe would report success.';
  return null;
}

export async function review(tx, s, walletChain) {
  const batch = unpack(tx);
  const r = { tx, local: safeTxHash(tx), chain: null, errors: [], warnings: [], danger: [], decoded: batch ? null : decode(tx), batch, signMessage: signMessageOf(tx) };
  const err = (m) => r.errors.push(m), warn = (m) => r.warnings.push(m);
  try {
    r.chain = await chainTxHash(tx);
  } catch (e) {
    err('Could not read getTransactionHash from the Safe: ' + e.message);
  }
  if (r.chain && r.chain !== r.local) err('FATAL: SafeTx hash mismatch. The locally computed hash differs from the Safe’s getTransactionHash. Do not sign.');
  if (tx.chainId !== walletChain) err('Transaction is for chain ' + tx.chainId + ' but the wallet is on chain ' + walletChain + '.');
  if (tx.safe !== s.address) err('Transaction is for a different Safe (' + tx.safe + ').');
  if (!s.supported) err('Unsupported Safe version "' + s.version + '". Versions before 1.3.0 use a different signing format.');
  if (s.supported && !s.tested) warn('This Safe runs version ' + s.version + ', which safe.wei was not tested with. The transaction hash still had to match the Safe’s own getTransactionHash.');
  if (tx.nonce < s.nonce) err('Nonce ' + tx.nonce + ' was already used (Safe nonce is ' + s.nonce + '). Rebuild the transaction.');
  if (tx.nonce > s.nonce) warn('Queued: nonce ' + tx.nonce + ' can only execute after nonce ' + s.nonce + ' has executed.');
  // A DELEGATECALL into an address without code does nothing, yet succeeds and burns the nonce.
  if (tx.operation === 1 && (await rpc('eth_getCode', [tx.to, 'latest']).catch(() => '0x')) === '0x')
    err('DELEGATECALL target ' + tx.to + ' has no code on this chain: the Safe would do nothing and still consume the nonce.' + (batch ? ' MultiSendCallOnly is not deployed here.' : ''));
  if (tx.operation === 1 && !batch && !r.signMessage) r.danger.push('DANGEROUS: DELEGATECALL. The target code runs with full control of the Safe (owners, modules, funds).');
  if (r.decoded) r.danger.push(...r.decoded.danger), r.warnings.push(...r.decoded.warnings);
  if (batch)
    r.inner = batch.map((c, i) => {
      const d = decode({ ...c, safe: tx.safe });
      if (d) r.danger.push(...d.danger.map((m) => 'Call ' + (i + 1) + ': ' + m)), r.warnings.push(...d.warnings.map((m) => 'Call ' + (i + 1) + ': ' + m));
      return { ...c, decoded: d };
    });
  // A module deployed in this batch and enabled in it: the enabled address must be the deployed one.
  const made = new Map((r.inner || []).flatMap((c, i) => (c.decoded && c.decoded.proxy ? [[c.decoded.proxy, i]] : [])));
  if (made.size)
    r.inner.forEach((c, i) => {
      const d = c.decoded;
      if (!d || d.label !== 'Enable module') return;
      const j = made.get(d.args[0].value);
      if (j === undefined) warn('Call ' + (i + 1) + ' enables ' + d.args[0].value + ', which is not the module this batch deploys (' + [...made.keys()].join(', ') + ').');
      else d.deployedBy = { call: j + 1, name: r.inner[j].decoded.module };
    });
  if (tx.safeTxGas || tx.baseGas || tx.gasPrice || tx.gasToken !== ZERO || tx.refundReceiver !== ZERO) warn('Gas refund fields are non-zero: the executor may be paid from the Safe.');
  if (r.ok = !r.errors.length) {
    const w = await simulate(tx).catch((e) => 'Simulation failed: ' + e.message);
    if (w) warn(w);
  }
  return r;
}
