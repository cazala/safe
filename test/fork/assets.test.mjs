import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { cd } from '../../src/abi.js';
import { assetChanges, PROBE } from '../../src/assets.js';
import { SAFE } from '../../src/chains.js';
import { batch } from '../../src/multisend.js';
import { use } from '../../src/rpc.js';
import { newTx, readSafe } from '../../src/safe.js';
import { S } from '../../src/sel.js';
import { ACCOUNTS, deploySafe, startFork, tx } from './anvil.mjs';
const [A, B] = ACCOUNTS, WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
let f;
before(async () => { f = await startFork(); use(f.provider); });
after(() => f?.stop());
for (const version of ['1.3.0', '1.4.1', '1.5.0']) test(version + ': real balances, atomic WETH deposit/transfer, Safe self-call, no lasting changes', async () => {
  const safe = await deploySafe(f.rpc, version, [A], 1);
  await tx(f.rpc, A, safe, '0x', 1000n);
  const s = await readSafe(safe);
  const t = newTx(s, batch(SAFE.multiSendCallOnly, [
    { to: WETH, value: 100n, data: '0xd0e30db0' },
    { to: WETH, data: cd(S.transfer, B, 25n) },
    { to: safe, data: cd(S.addOwnerWithThreshold, B, 1) },
  ]));
  const r = await assetChanges(t);
  assert.equal(r.status, 'success', JSON.stringify(r.notes));
  assert.equal(r.changes.find((x) => x.address === WETH)?.delta, 75n);
  assert.equal(r.changes.find((x) => x.address !== WETH)?.delta, -100n);
  assert.equal(await f.rpc('eth_getBalance', [safe, 'latest']), '0x3e8');
  assert.deepEqual((await readSafe(safe)).owners, [A]);
  assert.equal(await f.rpc('eth_getCode', [PROBE, 'latest']), '0x');
  const failed = await assetChanges(newTx(s, { to: B, value: 1001n }));
  assert.equal(failed.status, 'failed');
  assert.deepEqual(failed.changes, []);
});
test('unsupported discovery falls back; unsupported overrides and hidden revert data are explicit', async () => {
  const s = await readSafe(await deploySafe(f.rpc, '1.4.1', [A], 1));
  await tx(f.rpc, A, s.address, '0x', 100n);
  const t = newTx(s, { to: WETH, value: 10n, data: '0xd0e30db0' });
  use({ request: ({ method, params }) => {
    if (method === 'eth_createAccessList') throw Error('unsupported');
    return f.rpc(method, params);
  } });
  const fallback = await assetChanges(t);
  assert.equal(fallback.status, 'success');
  assert.match(fallback.notes.join(), /discovery unavailable/);
  assert.equal(fallback.changes.find((x) => x.address === WETH).delta, 10n);
  use({ request: ({ method, params }) => {
    if (method === 'eth_call' && params.length === 3) throw Error('unsupported');
    return f.rpc(method, params);
  } });
  assert.equal((await assetChanges(t)).status, 'unavailable');
  use(f.provider);
});

test('newly discovered tokens persist per Safe, but predicted receipts never become actual holdings', async () => {
  const { MAINNET } = await import('../../src/chains.js');
  const { balances, catalog, discovered } = await import('../../src/tokens.js');
  const { execute } = await import('../../src/flow.js');
  const storage = new Map();
  globalThis.localStorage = { getItem: (k) => storage.get(k), setItem: (k, v) => storage.set(k, v) };
  use({ request: ({ method, params }) => {
    if (method === 'eth_call' && params[0].to === MAINNET.tokenList) throw Error('registry unavailable');
    return f.rpc(method, params);
  } });
  try {
    const s = await readSafe(await deploySafe(f.rpc, '1.4.1', [A], 1));
    await tx(f.rpc, A, s.address, '0x', 100n);
    const t = newTx(s, { to: WETH, value: 10n, data: '0xd0e30db0' });
    const r = await assetChanges(t);
    assert.equal(r.status, 'success');
    assert.equal(r.changes.find((x) => x.address === WETH).delta, 10n);
    assert.equal(discovered(1, s.address)[0].address, WETH);
    assert.equal(discovered(1, B).length, 0);
    const tokens = await catalog(1, s.address);
    assert.deepEqual(await balances(s.address, tokens), [0n]);
    await execute(t, A);
    assert.deepEqual(await balances(s.address, tokens), [10n]);
  } finally { delete globalThis.localStorage; use(f.provider); }
});

test('gas-exhausting balance probes stay unknown without preventing the ETH preview', async () => {
  const bad = '0x111111111111111111111111111111111111abcd';
  const storage = new Map([['safe.wei:tokens:1', JSON.stringify([{ address: bad, symbol: 'BAD', decimals: 18 }])]]);
  globalThis.localStorage = { getItem: (k) => storage.get(k), setItem: (k, v) => storage.set(k, v) };
  try {
    await f.rpc('anvil_setCode', [bad, '0x5b600056']); // JUMPDEST; PUSH1 0; JUMP
    const s = await readSafe(await deploySafe(f.rpc, '1.4.1', [A], 1));
    await tx(f.rpc, A, s.address, '0x', 100n);
    const r = await assetChanges(newTx(s, { to: B, value: 1n }));
    assert.equal(r.status, 'success');
    assert.equal(r.changes[0].delta, -1n);
    assert.match(r.notes.join(), new RegExp('Balance unreadable: ' + bad));
    assert.ok(!r.changes.some((x) => x.address === bad));
  } finally { delete globalThis.localStorage; }
});
