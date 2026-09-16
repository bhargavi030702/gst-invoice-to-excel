/**
 * Emirates tax invoices.
 *
 * One item row:
 *   Tickets | HSN | Total Value | Taxable Value | Tax % | Total Invoice Amount
 *
 * The tax labels ("IGST: 2449.00", or "CGST: 1265.00" and "SGST: 1265.00") are
 * printed inside that row's band but Emirates staggers them, so they can land
 * on the line above or below. They are read from the band, not from the row.
 *
 * Emirates prints no separate non-taxable column, so it is the part of
 * "Total Value" that "Taxable Value" does not cover (airport taxes etc.).
 */

import { amountsIn, round2 } from '../numbers.js';
import { ReadError } from '../errors.js';

/** How many lines either side of the item row can hold a stray tax label. */
const TAX_BAND = 3;

export function matches(text) {
  return /\bEmirates\b/.test(text) && /Ticket\/Document\s*number/i.test(text);
}

export function parse(text) {
  const isCreditNote = /\bCredit\s+Note\b/i.test(text);
  const lines = text.split('\n');
  const rowIndex = lines.findIndex((l) => /^\s*Tickets\b/i.test(l) && /\b996425\b/.test(l));

  if (rowIndex === -1) {
    throw new ReadError(
      'Could not find the "Tickets" amounts row on this Emirates invoice. ' +
      'Expected a line starting with "Tickets" and holding HSN 996425.',
      'E04'
    );
  }

  const row = lines[rowIndex];
  const amounts = amountsIn(row);
  if (amounts.length < 5) {
    throw new ReadError(
      `Emirates "Tickets" row holds ${amounts.length} amount(s); at least 5 are needed ` +
      `(HSN, Total Value, Taxable Value, Tax %, Total Invoice Amount). Row read as: "${row.trim()}"`,
      'E05'
    );
  }

  // amounts[0] is the HSN code; the last one is the total invoice amount.
  const totalValue = amounts[1];
  const taxable = amounts[2];
  const total = amounts[amounts.length - 1];

  const band = lines
    .slice(Math.max(0, rowIndex - TAX_BAND), rowIndex + TAX_BAND + 1)
    .join(' ');

  return {
    issuer: 'Emirates',
    documentType: isCreditNote ? 'CREDIT NOTE' : 'TAX INVOICE',
    documentNumber: grab(text, /Invoice\s*Number\s*:?\s*([A-Z0-9]{10,})/i),
    documentDate: grab(text, /Invoice\s*Date\s*:?\s*([\d]{1,2}[-/][\d]{1,2}[-/][\d]{2,4})/i),
    taxable: round2(taxable),
    nonTaxable: round2(totalValue - taxable),
    igst: round2(taxOf(band, 'IGST')),
    cgst: round2(taxOf(band, 'CGST')),
    sgst: round2(taxOf(band, 'SGST')),
    total: round2(total),
  };
}

/** Read the amount printed immediately after a "CGST:" style label. */
function taxOf(band, label) {
  const m = band.match(new RegExp(label + '\\s*:\\s*([\\d,]+(?:\\.\\d+)?)', 'i'));
  return m ? Number(m[1].replace(/,/g, '')) : 0;
}

function grab(text, re) {
  const m = text.match(re);
  return m ? m[1].trim() : '';
}
