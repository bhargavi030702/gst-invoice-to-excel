/** Helpers for reading the numbers printed on a GST invoice. */

/** Matches a printed amount: 1,234.56 / 1234 / -12.00 / (12.00) */
const AMOUNT = /^\(?-?[\d,]+(?:\.\d+)?\)?$/;

/**
 * Parse one printed amount. A dash means "nil" on these invoices.
 * @param {string} token
 * @returns {number|null} null when the token is not an amount at all
 */
export function parseAmount(token) {
  if (token === undefined || token === null) return null;
  const t = String(token).trim();
  if (t === '' || t === '-' || t === '--') return 0;
  if (!AMOUNT.test(t)) return null;
  const negative = t.startsWith('(') && t.endsWith(')');
  const value = Number(t.replace(/[(),]/g, ''));
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/**
 * Every amount on a line, in printed order.
 * @param {string} line
 * @returns {number[]}
 */
export function amountsIn(line) {
  const out = [];
  for (const token of String(line).split(/\s+/)) {
    const value = parseAmount(token);
    if (value !== null) out.push(value);
  }
  return out;
}

/** Round to 2dp, killing floating point dust such as 5498.990000000001. */
export function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
