// Phase 0 spike: connect a wallet and read a Safe's owners / threshold / nonce.
import { fmt } from './abi.js';
import { connect, use } from './rpc.js';
import { readSafe } from './safe.js';

const $ = (id) => document.getElementById(id);
use(window.ethereum);

$('connect').onclick = async () => ($('connect').textContent = (await connect())[0]);
const input = Object.assign(document.createElement('input'), { placeholder: 'Safe address 0x…' });
const out = document.createElement('pre');
$('main').append(input, out);
input.onchange = async () => {
  try {
    const s = await readSafe(input.value.trim());
    out.textContent = [
      'chain     ' + s.chainId,
      'version   ' + s.version,
      'threshold ' + s.threshold + ' of ' + s.owners.length,
      'nonce     ' + s.nonce,
      'balance   ' + fmt(s.balance) + ' ETH',
      'owners',
      ...s.owners.map((o) => '  ' + o),
    ].join('\n');
  } catch (e) {
    out.textContent = e.message;
  }
};
