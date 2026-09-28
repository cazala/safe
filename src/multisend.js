// Batches through the canonical MultiSendCallOnly v1.4.1 (spec §26). The Safe
// DELEGATECALLs into it; it performs each packed inner CALL in order and reverts if
// any fails. Nested DELEGATECALLs are impossible by construction of CallOnly.
import { B, cd, strip, word } from './abi.js';
import { MULTISEND } from './chains.js';
import { S } from './sel.js';

/** Pack inner calls: operation(1) ‖ to(20) ‖ value(32) ‖ dataLength(32) ‖ data. */
export const pack = (calls) =>
  '0x' + calls.map((c) => '00' + strip(c.to).toLowerCase() + word(c.value || 0n) + word(strip(c.data || '0x').length / 2) + strip(c.data || '0x').toLowerCase()).join('');

/** The outer Safe transaction fields for a batch through the MultiSendCallOnly at `ms`. */
export function batch(ms, calls) {
  if (calls.length < 2) throw Error('A batch needs at least two calls.');
  if (!MULTISEND.includes(ms)) throw Error('Not a canonical MultiSendCallOnly: ' + ms);
  return { to: ms, value: 0n, data: cd(S.multiSend, B(pack(calls))), operation: 1 };
}

/** Inner calls of a transaction if it is a canonical MultiSendCallOnly batch, else null. */
export function unpack(t) {
  if (!MULTISEND.includes(t.to) || t.operation !== 1) return null;
  const d = strip(t.data).toLowerCase();
  if (!d.startsWith(S.multiSend) || BigInt('0x' + d.slice(8, 72)) !== 32n) return null;
  const n = Number(BigInt('0x' + d.slice(72, 136))), body = d.slice(136);
  if (body.length !== Math.ceil(n / 32) * 64 || /[^0]/.test(body.slice(n * 2))) return null; // exact length, zero padding
  const calls = [];
  for (let i = 0; i < n * 2; ) {
    if (i + 170 > n * 2) return null;
    const op = body.slice(i, i + 2), to = '0x' + body.slice(i + 2, i + 42), value = BigInt('0x' + body.slice(i + 42, i + 106)), len = Number(BigInt('0x' + body.slice(i + 106, i + 170)));
    if (op !== '00' || i + 170 + len * 2 > n * 2) return null;
    calls.push({ to, value, data: '0x' + body.slice(i + 170, i + 170 + len * 2) });
    i += 170 + len * 2;
  }
  return calls.length ? calls : null;
}
