/**
 * Air India Express tax invoices and credit notes.
 *
 * Two layouts exist and the header says which one you have:
 *   IGST      -> Grand Total prints  Taxable | Non Taxable | Total | IGST | Total Invoice Value
 *   CGST+SGST -> Grand Total prints  Taxable | Non Taxable | Total | CGST | SGST | Total Invoice Value
 */

import { amountsIn, round2 } from '../numbers.js';
import { ReadError } from '../errors.js';

export function matches(text) {
  return /AIR\s+INDIA\s+EXPRESS/i.test(text);
}

export function parse(text) {
  const isCreditNote = /\bCredit\s+Note\b/i.test(text);
  const lines = text.split('\n');

  const rowIndex = lines.findIndex((l) => /^\s*Grand\s*Total\b/i.test(l));
  if (rowIndex === -1) {
    throw new ReadError(
      'Could not find the "Grand Total" row on this Air India Express document. ' +
      'The amounts table may be missing or laid out differently than expected.',
      'E04'
    );
  }

  const header = lines.slice(Math.max(0, rowIndex - 12), rowIndex).join('\n');
  const interState = /\bIGST\b/.test(header) && !/\bCGST\b/.test(header);

  const amounts = amountsIn(lines[rowIndex]);
  const needed = interState ? 5 : 6;
  if (amounts.length < needed) {
    throw new ReadError(
      `Air India Express "Grand Total" row holds ${amounts.length} amount(s); ${needed} are needed for the ` +
      `${interState ? 'IGST' : 'CGST + SGST'} layout. Row read as: "${lines[rowIndex].trim()}"`,
      'E05'
    );
  }

  const [taxable, nonTaxable] = amounts;
  const igst = interState ? amounts[3] : 0;
  const cgst = interState ? 0 : amounts[3];
  const sgst = interState ? 0 : amounts[4];
  const total = interState ? amounts[4] : amounts[5];

  return {
    issuer: 'Air India Express Ltd',
    documentType: isCreditNote ? 'CREDIT NOTE' : 'TAX INVOICE',
    documentNumber: grab(text, /(?:Invoice|Credit\s*Note)\s*Number\s*:?\s*([A-Z0-9]{10,})/i),
    documentDate: grab(text, /(?:Invoice|Credit\s*Note)\s*Date\s*:?\s*([\d]{1,2}[-/][\d]{1,2}[-/][\d]{2,4})/i),
    taxable: round2(taxable),
    nonTaxable: round2(nonTaxable),
    igst: round2(igst),
    cgst: round2(cgst),
    sgst: round2(sgst),
    total: round2(total),
  };
}

function grab(text, re) {
  const m = text.match(re);
  return m ? m[1].trim() : '';
}
