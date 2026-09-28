import assert from 'node:assert/strict';
import { test } from 'node:test';
import { operable, TESTED } from '../../src/chains.js';

test('versions: 1.3.0 and later are operable (future ones included); earlier are refused', () => {
  for (const v of ['1.3.0', '1.4.1', '1.5.0', '1.6.0', '1.10.2', '2.0.0']) assert.equal(operable(v), true, v);
  for (const v of ['1.0.0', '1.1.1', '1.2.0', '', null, 'x', '0.9.9']) assert.equal(operable(v), false, String(v));
  assert.deepEqual(TESTED, ['1.3.0', '1.4.1', '1.5.0']);
});

test('gatewayOf reads where a gateway says the page comes from', async () => {
  const { gatewayOf } = await import('../../src/chains.js');
  const A = '0x8cc0ef8c320efde38ebca80a2008de29c46c8e14';
  assert.deepEqual(gatewayOf(A + '.w3link.io'), { app: A });
  assert.deepEqual(gatewayOf(A.toUpperCase().replace('0X', '0x') + '.1.w3link.io'), { app: A });
  assert.deepEqual(gatewayOf(A + '.w4eth.io'), { app: A });
  assert.deepEqual(gatewayOf('safe.wei.limo'), { name: 'safe.wei' });
  assert.deepEqual(gatewayOf('safe.wei.domains'), { name: 'safe.wei' });
  assert.deepEqual(gatewayOf('safe.wei.is'), { name: 'safe.wei' });
  assert.deepEqual(gatewayOf('safe.eth.limo'), { name: 'safe.eth' });
  assert.deepEqual(gatewayOf('app.safe.wei.limo'), { name: 'app.safe.wei' });
  assert.deepEqual(gatewayOf('localhost'), { local: true });
  assert.deepEqual(gatewayOf('192.168.68.52'), { local: true });
  assert.deepEqual(gatewayOf('example.com'), {});
});
