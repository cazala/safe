import assert from 'node:assert/strict';
import { test } from 'node:test';
import { namehash as viemNamehash } from 'viem';
import { checkName, isName, namehash } from '../../src/names.js';

test('namehash matches viem; WNS tokenId == namehash', () => {
  for (const n of ['eth', 'vitalik.eth', 'a.b.c.eth', 'safe.wei', 'sub.dao.wei']) assert.equal(namehash(n), viemNamehash(n));
  assert.equal(namehash('wei'), '0xa82820059d5df798546bcc2985157a77c3eef25eba9ba01899927333efacbd6f');
  assert.equal(namehash('safe.wei'), '0x5ee9ac06dcbb65a76f1f67124f33a87fb2fcd41386337c01a2e166f5c938c62d');
});

test('only lowercase [a-z0-9-] labels under .eth / .wei are accepted', () => {
  for (const ok of ['vitalik.eth', 'safe.wei', 'a-1.b.eth', '0x.eth']) assert.ok(isName(ok), ok);
  for (const bad of ['Vitalik.eth', 'vitálik.eth', 'vitalik', 'a..eth', '.eth', 'x.com', 'рaypal.eth', 'a_b.eth', 'a b.eth', 'eth'])
    assert.ok(!isName(bad), bad);
  assert.throws(() => checkName('Vitalik.eth'), /only lowercase/);
  assert.throws(() => checkName('bob'), /0x address or a .eth/);
});
