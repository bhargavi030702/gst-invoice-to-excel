// Amounts on an invoice are written in a handful of ways: 1,234.50, (1,234.50)
// for a negative, a bare dash for nothing at all. Everything that reads a figure
// goes through here so they are all understood the same way.

// A leading dot with no zero in front of it (".00") is how some airlines
// print nothing at all, so it has to count as an amount too.
const AMOUNT = /^\(?-?(?:[\d,]+(?:\.\d+)?|\.\d+)\)?$/;

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

// Every figure on a line, in the order it is printed.
export function amountsIn(line) {
  const out = [];
  for (const token of String(line).split(/\s+/)) {
    const value = parseAmount(token);
    if (value !== null) out.push(value);
  }
  return out;
}

export function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
