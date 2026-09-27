import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_ROWS, parseCSV, toCSV } from '../../src/csv.js';

const A = '0x' + '11'.repeat(20), B = '0x' + '22'.repeat(20);

test('parses comma, semicolon, tab and space separated rows; token optional', () => {
  const { rows, errors } = parseCSV(`recipient,amount,token\n${A},1.5,USDC\n${B};2\n\nvitalik.eth\t0.1\tETH\n# comment\n${A} 3 0x${'33'.repeat(20)}\n`);
  assert.deepEqual(errors, []);
  assert.deepEqual(rows, [
    { line: 2, to: A, amount: '1.5', token: 'USDC' },
    { line: 3, to: B, amount: '2', token: '' },
    { line: 5, to: 'vitalik.eth', amount: '0.1', token: 'ETH' },
    { line: 7, to: A, amount: '3', token: '0x' + '33'.repeat(20) },
  ]);
});

test('reports malformed rows with line numbers and caps the row count', () => {
  const { rows, errors } = parseCSV(`${A}\n${A},1,USDC,extra\n${B},2`);
  assert.equal(rows.length, 1);
  assert.deepEqual(errors.map((e) => e.line), [1, 2]);
  const many = Array.from({ length: MAX_ROWS + 1 }, () => A + ',1').join('\n');
  assert.match(parseCSV(many).errors.at(-1).error, /at most 200/);
});

test('toCSV round trip', () => {
  const text = `${A},1.5,USDC\n${B},2`;
  assert.equal(toCSV(parseCSV(text).rows), text);
});
