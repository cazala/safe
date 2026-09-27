// Bulk transfers: one row per transfer, "recipient,amount[,token]".
// recipient: 0x address or .eth/.wei name; token: empty or native symbol for ETH,
// otherwise a TokenList symbol or a token address. Parsing only; resolution is async.

// A MultiSendCallOnly batch of ERC-20 transfers costs ~30-60k gas per row; 200 rows
// stay well under the 16,777,216 per-transaction gas cap (EIP-7825).
export const MAX_ROWS = 200;
const HEADER = /^(recipient|address|to|receiver|destination|wallet)$/i;

/** Parse pasted text. Returns { rows: [{line, to, amount, token}], errors: [{line, error}] }. */
export function parseCSV(text) {
  const rows = [], errors = [];
  (text || '').split(/\r?\n/).forEach((l, i) => {
    const line = i + 1, raw = l.trim();
    if (!raw || raw.startsWith('#')) return;
    const cells = raw.split(/\s*[,;\t]\s*|\s+/).filter((c) => c !== '');
    if (!rows.length && !errors.length && HEADER.test(cells[0])) return; // optional header row
    if (cells.length < 2 || cells.length > 3) return errors.push({ line, error: 'expected recipient,amount[,token]' });
    rows.push({ line, to: cells[0], amount: cells[1], token: cells[2] || '' });
  });
  if (rows.length > MAX_ROWS) errors.push({ line: 0, error: rows.length + ' rows; at most ' + MAX_ROWS + ' fit in one transaction' });
  return { rows, errors };
}

/** Serialize rows back to CSV text (used for share links). */
export const toCSV = (rows) => rows.map((r) => [r.to, r.amount, r.token].filter(Boolean).join(',')).join('\n');
