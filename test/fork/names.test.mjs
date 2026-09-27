import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { use } from '../../src/rpc.js';
import { nameOf, resolveName } from '../../src/names.js';
import { startFork } from './anvil.mjs';

const VITALIK = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
let f;
before(async () => {
  f = await startFork();
  use(f.provider);
});
after(() => f.stop());

test('ENS forward and reverse (with forward check)', async () => {
  assert.equal(await resolveName('vitalik.eth', 1), VITALIK);
  assert.equal(await nameOf(VITALIK, 1), 'vitalik.eth');
});

test('.wei forward resolution through WNS', async () => {
  assert.equal(await resolveName('dao.wei', 1), '0x00000007988a79d16cf76b5dc4cf54dc3af24936');
  assert.equal(await resolveName('safe.wei', 1), '0x3107af70f278d3824f9bab4222b3361a545356c2');
});

test('unregistered names and other chains are rejected', async () => {
  await assert.rejects(resolveName('this-name-should-not-exist-9f8a7b6c.wei', 1), /does not resolve/);
  await assert.rejects(resolveName('this-name-should-not-exist-9f8a7b6c.eth', 1), /does not resolve/);
  await assert.rejects(resolveName('vitalik.eth', 10), /mainnet only/);
  await assert.rejects(resolveName('Vitalik.eth', 1), /only lowercase/);
});

test('CCIP-read (offchain) names are refused, never fetched', async () => {
  await assert.rejects(resolveName('jesse.base.eth', 1), /off chain/);
});
