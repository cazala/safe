// Zodiac modules deployed through the real ModuleProxyFactory: the review decodes deployModule, predicts
// the new module's address, checks who controls it, and ties it to the enableModule in the same batch.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { cd } from '../../src/abi.js';
import { encodeCall, parseAbi } from '../../src/abicoder.js';
import { SAFE } from '../../src/chains.js';
import { execute } from '../../src/flow.js';
import { batch } from '../../src/multisend.js';
import { review } from '../../src/review.js';
import { use } from '../../src/rpc.js';
import { modules, newTx, readSafe } from '../../src/safe.js';
import { S } from '../../src/sel.js';
import { FACTORIES } from '../../src/zodiac.js';
import { ACCOUNTS, deploySafe, startFork } from './anvil.mjs';

const [A, B] = ACCOUNTS;
const ROLES = '0xf2964ce6161ce0e75964fe7927ce114cb0b283d5'; // Roles 2.1.1 mastercopy
const [deploy] = parseAbi('deployModule(address masterCopy, bytes initializer, uint256 saltNonce)');
const [setUp] = parseAbi('setUp(bytes initParams)');
const initializer = (owner, avatar, target) => encodeCall(setUp, ['0x' + [owner, avatar, target].map((x) => x.slice(2).padStart(64, '0')).join('')]);
const deployCall = (factory, init, nonce) => ({ to: factory, value: 0n, data: encodeCall(deploy, [ROLES, init, nonce]) });

let f;
before(async () => {
  f = await startFork();
  use(f.provider);
});
after(() => f.stop());

for (const factory of FACTORIES)
  test('deployModule through factory ' + factory + ': decoded, address predicted, enabled in the same batch', async (t) => {
    if ((await f.rpc('eth_getCode', [factory, 'latest'])) === '0x') return t.skip('factory not deployed at the fork block');
    const safe = await deploySafe(f.rpc, '1.4.1', [A], 1), s = await readSafe(safe);
    const d0 = (await review(newTx(s, deployCall(factory, initializer(safe, safe, safe), 7n)), s, 1)).decoded;
    assert.equal(d0.label, 'Deploy module: Zodiac Roles 2.1.1');
    const proxy = d0.proxy;
    const t2 = newTx(s, batch(SAFE.multiSendCallOnly, [deployCall(factory, initializer(safe, safe, safe), 7n), { to: safe, value: 0n, data: cd(S.enableModule, proxy) }]));
    const r = await review(t2, s, 1);
    assert.equal(r.ok, true);
    assert.deepEqual(r.danger, ['Call 2: DANGEROUS: ENABLE MODULE. A module can execute any transaction from this Safe without owner signatures.']); // always, even for a known module
    assert.ok(!r.warnings.some((w) => /REVERTS|not the module|avatar|target/.test(w)), r.warnings.join('\n'));
    assert.deepEqual(r.inner[1].decoded.deployedBy, { call: 1, name: 'Roles 2.1.1' });
    await execute(t2, A);
    assert.notEqual(await f.rpc('eth_getCode', [proxy, 'latest']), '0x', 'the module is where the review said');
    assert.deepEqual(await modules(safe), [proxy]);
  });

test('a module owned by someone else is dangerous; enabling another address than the deployed one is flagged', async () => {
  const factory = FACTORIES[2], safe = await deploySafe(f.rpc, '1.4.1', [A], 1), s = await readSafe(safe);
  const r = await review(newTx(s, batch(SAFE.multiSendCallOnly, [deployCall(factory, initializer(B, safe, safe), 1n), { to: safe, value: 0n, data: cd(S.enableModule, B) }])), s, 1);
  assert.match(r.danger.join(), /Call 1: DANGEROUS: THE NEW MODULE’S OWNER IS 0x/);
  assert.match(r.warnings.join(), /Call 2 enables .* not the module this batch deploys/);
});

test('an unknown mastercopy or undecodable settings are said as such', async () => {
  const factory = FACTORIES[2], safe = await deploySafe(f.rpc, '1.4.1', [A], 1), s = await readSafe(safe);
  const unknown = { to: factory, value: 0n, data: encodeCall(deploy, [SAFE.fallback, '0x', 1n]) };
  const r = await review(newTx(s, unknown), s, 1);
  assert.match(r.warnings.join(), /not a Zodiac module safe.wei knows/);
  const odd = await review(newTx(s, { to: factory, value: 0n, data: encodeCall(deploy, [ROLES, '0x1234', 1n]) }), s, 1);
  assert.match(odd.warnings.join(), /settings \(initializer\) are not decoded/);
});
