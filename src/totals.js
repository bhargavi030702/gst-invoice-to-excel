/**
 * The arithmetic check applied to every invoice.
 *
 * Every GST invoice satisfies:
 *     Taxable + Non Taxable + IGST + CGST + SGST = Total
 *
 * A row that fails this was mis-read, so it is reported for a human to check
 * rather than written out as if it were sound.
 */

import { round2 } from './numbers.js';

/** Amounts within this many rupees of each other are treated as equal. */
export const TOLERANCE = 0.05;

/** Sum of the parts that must add up to the invoice total. */
export function computedTotal(row) {
  return round2(row.taxable + row.nonTaxable + row.igst + row.cgst + row.sgst);
}

/** Does the invoice add up? */
export function isBalanced(row) {
  return Math.abs(computedTotal(row) - row.total) <= TOLERANCE;
}
