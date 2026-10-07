// Which upgrade a Safe is offered, and which calls count as one (the onchain checks are in test/fork/upgrade.test.mjs).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { migrationOf, MIGRATIONS, upgradeOf } from '../../src/upgrade.js';

const safe = (version, singleton, fallback = null) => ({ address: '0x' + '11'.repeat(20), version, singleton, fallback });
const L1_130 = '0xd9db270c1b5e3bd161e8c8503c55ceabee709552', L2_130_EIP155 = '0xfb1bffc9d739b8d520daf37df666da4c687191ea';
const HANDLER_130 = '0xf48f2b2d2a534e402487b3ee7c18c33aec0fe5e4', CUSTOM = '0x2f55e8b20d0b9fefa187aa7d00b6cbe563605bf5';

test('1.3.0 with the standard handler: to 1.4.1, handler replaced', () => {
  const u = upgradeOf(safe('1.3.0', L1_130, HANDLER_130));
  assert.equal(u.to, '1.4.1');
  assert.equal(u.migration, MIGRATIONS['1.4.1']);
  assert.deepEqual(migrationOf({ operation: 1, value: 0n, to: u.migration, data: u.data }), { to: '1.4.1', fn: 'migrateWithFallbackHandler()' });
  assert.equal(u.fallback, '0xfd0732dc9e303f09fcef3a7388ad10a83459ec99');
});

test('an L2 Safe (eip155 deployment) takes the L2 path; a custom handler is kept', () => {
  const u = upgradeOf(safe('1.3.0', L2_130_EIP155, CUSTOM));
  assert.equal(u.l2, true);
  assert.equal(u.handler, false);
  assert.equal(u.fallback, CUSTOM);
  assert.deepEqual(migrationOf({ operation: 1, value: 0n, to: u.migration, data: u.data }), { to: '1.4.1', fn: 'migrateL2Singleton()' });
  assert.equal(u.singleton, '0x29fcb43b46531bca003ddc8fcb67ffe91900c762');
});

test('no offer: an unknown singleton, the newest version, or a version mismatch', () => {
  assert.equal(upgradeOf(safe('1.3.0', '0x' + '22'.repeat(20))), null);
  assert.equal(upgradeOf(safe('1.5.0', '0xff51a5898e281db6dfc7855790607438df2ca44b')), null);
  assert.equal(upgradeOf(safe('1.4.1', L1_130)), null); // says 1.4.1, runs a 1.3.0 singleton
});

test('only an exact migration call counts: a DELEGATECALL, no value, no extra bytes', () => {
  const u = upgradeOf(safe('1.3.0', L1_130, HANDLER_130)), t = { operation: 1, value: 0n, to: u.migration, data: u.data };
  assert.equal(migrationOf({ ...t, operation: 0 }), null);
  assert.equal(migrationOf({ ...t, value: 1n }), null);
  assert.equal(migrationOf({ ...t, data: u.data + '00' }), null);
  assert.equal(migrationOf({ ...t, to: '0x' + '33'.repeat(20) }), null);
});
