import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { approve, execute } from '../../src/flow.js';
import { payloadGas, scan } from '../../src/pending.js';
import { use } from '../../src/rpc.js';
import { approvedBy, newTx, readSafe, safeTxHash } from '../../src/safe.js';
import { compact } from '../../src/share.js';
import { ACCOUNTS, deploySafe, FORK_BLOCK, startFork, tx } from './anvil.mjs';

const [A, B, C] = ACCOUNTS;
let f;
before(async () => {
  f = await startFork();
  use(f.provider);
});
after(() => f.stop());

// Only scan blocks mined on the fork (older ranges would hit the upstream RPC).
const recent = async (s) => scan(s, { blocks: Number(await f.rpc('eth_blockNumber')) - FORK_BLOCK, step: 3 });
async function funded(version) {
  const safe = await deploySafe(f.rpc, version, [A, B, C], 2);
  await tx(f.rpc, A, safe, '0x', 10n ** 18n);
  return readSafe(safe);
}

for (const v of ['1.3.0', '1.4.1', '1.5.0']) {
  test(v + ': approveHash with an appended payload is recorded, discovered, and executable', async () => {
    const s = await funded(v);
    const t = newTx(s, { to: C, value: 3n, data: '0xa9059cbb' + '00'.repeat(64) });
    const rc = await approve(t, A, compact(t));
    assert.deepEqual(await approvedBy(s, safeTxHash(t)), [A]); // the Safe ignored the trailing bytes
    console.log('# ' + v + ' approveHash+payload gas ' + BigInt(rc.gasUsed) + ' (payload ' + (compact(t).length - 2) / 2 + ' B, ~' + payloadGas(compact(t)) + ' calldata gas)');
    const { found } = await recent(s);
    assert.equal(found.length, 1);
    assert.equal(found[0].hash, safeTxHash(t));
    assert.equal(found[0].proposer, A);
    assert.deepEqual(found[0].tx, t);
    await execute(found[0].tx, B);
  });
}

test('plain approvals, stale nonces and mismatched payloads are not listed', async () => {
  const s = await funded('1.4.1');
  const t1 = newTx(s, { to: C, value: 1n });
  await approve(t1, A); // no payload
  const other = newTx(s, { to: B, value: 99n });
  // payload for a different transaction than the approved hash
  const h = await f.rpc('eth_sendTransaction', [{ from: B, to: s.address, data: '0xd4d9bdcd' + safeTxHash(t1).slice(2) + compact(other).slice(2) }]);
  while (!(await f.rpc('eth_getTransactionReceipt', [h]))) await new Promise((x) => setTimeout(x, 20));
  // garbage payload
  const g = await f.rpc('eth_sendTransaction', [{ from: C, to: s.address, data: '0xd4d9bdcd' + safeTxHash(other).slice(2) + 'deadbeef' }]);
  while (!(await f.rpc('eth_getTransactionReceipt', [g]))) await new Promise((x) => setTimeout(x, 20));
  assert.equal((await recent(s)).found.length, 0);

  const t2 = newTx(s, { to: C, value: 2n });
  await approve(t2, A, compact(t2));
  assert.equal((await recent(s)).found.length, 1);
  await execute(t2, B); // nonce moves past t2
  assert.equal((await recent(await readSafe(s.address))).found.length, 0);
});

test('queued nonces are listed; the window shrinks when the RPC refuses a range', async () => {
  const s = await funded('1.4.1');
  const q = newTx(s, { to: C, value: 5n, nonce: s.nonce + 1n });
  await approve(q, A, compact(q));
  let calls = 0;
  const refusing = { request: async ({ method, params }) => {
    if (method === 'eth_getLogs' && BigInt(params[0].toBlock) - BigInt(params[0].fromBlock) > 30n) throw Error('range too large');
    calls++;
    return f.rpc(method, params);
  } };
  use(refusing);
  try {
    const { found } = await scan(s, { blocks: Number(await f.rpc('eth_blockNumber')) - FORK_BLOCK, step: 400 });
    assert.equal(found.length, 1);
    assert.equal(found[0].tx.nonce, s.nonce + 1n);
  } finally {
    use(f.provider);
  }
  assert.ok(calls > 0);
});
