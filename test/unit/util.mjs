import { randomBytes } from 'node:crypto';

const rnd = (n) => '0x' + randomBytes(n).toString('hex');
export const randomTx = () => ({
  chainId: 1 + Math.floor(Math.random() * 1e6),
  safe: rnd(20),
  to: rnd(20),
  value: BigInt(rnd(12)),
  data: rnd(Math.floor(Math.random() * 300)),
  operation: Math.round(Math.random()),
  safeTxGas: BigInt(rnd(3)),
  baseGas: BigInt(rnd(3)),
  gasPrice: BigInt(rnd(4)),
  gasToken: rnd(20),
  refundReceiver: rnd(20),
  nonce: BigInt(rnd(2)),
});
