import { round2 } from './numbers.js';

// Half a paisa. Invoices are rounded to the rupee by most airlines, so anything
// inside this is rounding, and anything outside it is a figure read wrongly.
export const TOLERANCE = 0.05;

export function computedTotal(row) {
  return round2(row.taxable + row.nonTaxable + row.igst + row.cgst + row.sgst);
}

export function isBalanced(row) {
  return Math.abs(computedTotal(row) - row.total) <= TOLERANCE;
}
