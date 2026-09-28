import assert from 'node:assert/strict';
import { test } from 'node:test';
import { operable, TESTED } from '../../src/chains.js';

test('versions: 1.3.0 and later are operable (future ones included); earlier are refused', () => {
  for (const v of ['1.3.0', '1.4.1', '1.5.0', '1.6.0', '1.10.2', '2.0.0']) assert.equal(operable(v), true, v);
  for (const v of ['1.0.0', '1.1.1', '1.2.0', '', null, 'x', '0.9.9']) assert.equal(operable(v), false, String(v));
  assert.deepEqual(TESTED, ['1.3.0', '1.4.1', '1.5.0']);
});
