import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { cd } from '../../src/abi.js';
import { execute } from '../../src/flow.js';
import { review } from '../../src/review.js';
import { use } from '../../src/rpc.js';
import { newTx, readSafe } from '../../src/safe.js';
import { S } from '../../src/sel.js';
import { balances, listed, meta, multicall } from '../../src/tokens.js';
import { ACCOUNTS, deploySafe, startFork, tx } from './anvil.mjs';

const [A, B] = ACCOUNTS;
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
let f;
before(async () => {
  f = await startFork();
  use(f.provider);
});
after(() => f.stop());

test('TokenList: mainnet ERC-20s only, with registry decimals and symbols', async () => {
  const l = await listed(1);
  const by = Object.fromEntries(l.map((t) => [t.address, t]));
  assert.equal(by[USDC].symbol, 'USDC');
  assert.equal(by[USDC].decimals, 6);
  assert.equal(by[WETH].decimals, 18);
  assert.ok(l.length >= 10);
  assert.ok(l.every((t) => t.listed && /^0x[0-9a-f]{40}$/.test(t.address)));
  // no native ETH entry, no Base / Robinhood tokens, no ERC-721 listings
  assert.ok(!by['0x4200000000000000000000000000000000000006']);
  assert.ok(!by['0x0000000000696760e15f265e828db644a0c242eb']);
  assert.deepEqual(await listed(8453), []);
});

test('balances via Multicall3; token send goes through the normal Safe flow', async () => {
  const s0 = await readSafe(await deploySafe(f.rpc, '1.4.1', [A], 1));
  await tx(f.rpc, A, WETH, '0xd0e30db0', 5n * 10n ** 17n); // deposit()
  await tx(f.rpc, A, WETH, cd(S.transfer, s0.address, 3n * 10n ** 17n));
  const [w, u] = await balances(s0.address, [{ address: WETH }, { address: USDC }]);
  assert.equal(w, 3n * 10n ** 17n);
  assert.equal(u, 0n);
  const s = await readSafe(s0.address);
  const t = newTx(s, { to: WETH, data: cd(S.transfer, B, 10n ** 17n) });
  const r = await review(t, s, 1);
  assert.equal(r.decoded.label, 'ERC-20 transfer');
  assert.deepEqual(r.warnings, []);
  await execute(t, A);
  assert.equal((await balances(s.address, [{ address: WETH }]))[0], 2n * 10n ** 17n);
});

test('unlisted token metadata: string and bytes32 symbols; non-tokens rejected', async () => {
  assert.deepEqual(await meta(USDC), { address: USDC, decimals: 6, symbol: 'USDC', listed: false });
  const mkr = await meta('0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2'); // MKR returns bytes32
  assert.equal(mkr.symbol, 'MKR');
  await assert.rejects(meta('0x' + '42'.repeat(20)), /Not an ERC-20/);
});

test('multicall reports failures per call', async () => {
  const r = await multicall([
    { to: USDC, data: '0x' + S.decimals },
    { to: USDC, data: '0xdeadbeef' },
  ]);
  assert.equal(r[0].ok, true);
  assert.equal(BigInt(r[0].data), 6n);
  assert.equal(r[1].ok, false);
});
