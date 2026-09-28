import { ReadError } from '../errors.js';
import { amountsIn, round2 } from '../numbers.js';
import { findPnr } from '../pnr.js';
import { after, allGstins, sectorFrom, tidyPlace } from '../details.js';

export const issuer = 'Alliance Air Aviation Ltd';

// The Total row, left to right. The rate columns hold figures too, so every one
// of the eleven has to be there for the amounts to line up.
//   Total Amount, Taxable Value, Discount, Net Taxable Value,
//   CGST rate, CGST amount, SGST rate, SGST amount, IGST rate, IGST amount,
//   Total Invoice Value
const CELLS = 11;

export function matches(text) {
  // The e-ticket Alliance Air send alongside the invoice names the airline too,
  // but only the invoice carries the name of the company that issued it.
  return /Alliance\s+Air\s+Aviation/i.test(text);
}

export function parse(text) {
  const lines = text.split('\n');

  const row = lines
    .filter((l) => /^\s*Total\b/i.test(l))
    .map((line) => ({ line, amounts: amountsIn(line) }))
    .filter((r) => r.amounts.length >= CELLS)[0];

  if (!row) {
    throw new ReadError(
      'Could not find the "Total" row on this Alliance Air document. The amounts table may be missing or laid out differently than expected.',
      'E04',
    );
  }

  const cells = row.amounts.slice(-CELLS);
  const [, , discount, taxable, , cgst, , sgst, , igst, total] = cells;

  return {
    issuer,
    documentType: /\bCREDIT\s+NOTE\b/i.test(text) ? 'CREDIT NOTE'
      : /\bDEBIT\s+NOTE\b/i.test(text) ? 'DEBIT NOTE'
        : 'TAX INVOICE',
    documentNumber: grab(text, /Invoice\s*No\.?\s*:?\s*([A-Z0-9][A-Z0-9/-]{5,})/i),
    documentDate: allianceDate(text),
    pnr: findPnr(text),
    clientName: after(text, /^\s*Name\s*:/im, { stopAt: /\t/ }),
    // Alliance Air print their own number bare, under the company name, and the
    // customer's under "Bill To".
    airlineGstin: allGstins(text)[0] ?? '',
    customerGstin: after(text, /GSTIN\s*:/i),
    // Alliance Air bill against the PNR and print no ticket number or route.
    ticketNumber: '',
    placeOfSupply: tidyPlace(after(text, /State\s*\/\s*Union\s+Territory\s*:/i, { stopAt: /\t/ })),
    sector: '',
    discount: round2(discount),
    // The net taxable value already has the discount taken off it, and airport
    // tax is inside the taxable figure rather than in a column of its own.
    taxable: round2(taxable),
    nonTaxable: 0,
    igst: round2(igst),
    cgst: round2(cgst),
    sgst: round2(sgst),
    total: round2(total),
  };
}

// Printed as a run of digits - "Invoice Date: 20250808" - rather than as a date.
function allianceDate(text) {
  const m = text.match(/Invoice\s*Date\s*:?\s*(\d{8})\b/i);
  if (!m) return grab(text, /Invoice\s*Date\s*:?\s*(\d{1,2}[-/][A-Za-z0-9]{2,3}[-/]\d{2,4})/i);
  const [, stamp] = m;
  return `${stamp.slice(6, 8)}-${stamp.slice(4, 6)}-${stamp.slice(0, 4)}`;
}

function grab(text, re) {
  const m = text.match(re);
  return m ? m[1].trim() : '';
}
