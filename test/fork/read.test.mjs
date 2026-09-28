import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chainInfo, MAINNET, SAFE, SAFE141 } from '../../src/chains.js';
import { use } from '../../src/rpc.js';
import { readSafe } from '../../src/safe.js';
import { ACCOUNTS, deploySafe, startFork, tx, V } from './anvil.mjs';

let f;
before(async () => {
  f = await startFork();
  use(f.provider);
});
after(() => f.stop());

test('hardcoded mainnet addresses have code on chain', async () => {
  const c = { ...SAFE, ...MAINNET };
  for (const k of Object.keys(c).filter((k) => /^0x[0-9a-f]{40}$/.test(c[k]))) assert.notEqual(await f.rpc('eth_getCode', [c[k], 'latest']), '0x', k);
  for (const k of ['singleton', 'singletonL2', 'factory', 'fallback', 'multiSendCallOnly']) assert.notEqual(await f.rpc('eth_getCode', [SAFE141[k], 'latest']), '0x', '1.4.1 ' + k);
  const i = await chainInfo(1);
  assert.deepEqual([i.name, i.sym, i.singleton, i.canCreate, i.canBatch, i.canMulticall], ['Ethereum', 'ETH', SAFE.singleton, true, true, true]);
  for (const v of Object.values(V)) for (const addr of Object.values(v)) assert.notEqual(await f.rpc('eth_getCode', [addr, 'latest']), '0x', addr);
});

for (const version of ['1.3.0', '1.4.1', '1.5.0']) {
  test('readSafe on a fresh ' + version + ' Safe', async () => {
    const owners = ACCOUNTS.slice(0, 3);
    const safe = await deploySafe(f.rpc, version, owners, 2);
    await tx(f.rpc, ACCOUNTS[0], safe, '0x', 12345n);
    const s = await readSafe(safe);
    assert.equal(s.chainId, 1);
    assert.equal(s.version, version);
    assert.equal(s.supported, true);
    assert.deepEqual(s.owners, owners);
    assert.equal(s.threshold, 2n);
    assert.equal(s.nonce, 0n);
    assert.equal(s.balance, 12345n);
    assert.equal(s.singleton, V[version].singleton);
    assert.equal(s.fallback, V[version].fallback);
    assert.equal(s.guard, null);
  });
}

test('readSafe rejects an EOA and a non-Safe contract', async () => {
  await assert.rejects(readSafe('0x' + '42'.repeat(20)), /No contract/);
  await assert.rejects(readSafe(SAFE.multicall3), /Not a Safe/);
});
