/**
 * IndiGo / InterGlobe Aviation tax invoices and GST credit notes.
 *
 * The "Grand Total" row always prints seven amounts in this order:
 *   Taxable | Non Taxable/Exempted | Total | IGST | CGST | SGST/UTGST | Total (Incl Taxes)
 *
 * The row is found by content rather than by where it starts on the line,
 * because IndiGo's own layout sometimes puts cell separators in front of it.
 */

import { amountsIn, round2 } from '../numbers.js';
import { ReadError } from '../errors.js';

const AMOUNTS_EXPECTED = 7;

export function matches(text) {
  return /Inter\s*Globe\s+Aviation/i.test(text) || /IndiGo/i.test(text);
}

export function parse(text) {
  const isCreditNote = /\bCredit\s+Note\b/i.test(text);
  const candidates = text.split('\n').filter((l) => /Grand\s*Total/i.test(l));

  if (candidates.length === 0) {
    throw new ReadError(
      'Could not find the "Grand Total" row on this IndiGo document. ' +
      'The amounts table may be missing or laid out differently than expected.',
      'E04'
    );
  }

  // The richest row is the totals row; any other mention of the phrase is prose.
  const row = candidates
    .map((line) => ({ line, amounts: amountsIn(line) }))
    .sort((a, b) => b.amounts.length - a.amounts.length)[0];

  if (row.amounts.length < AMOUNTS_EXPECTED) {
    throw new ReadError(
      `IndiGo "Grand Total" row holds ${row.amounts.length} amount(s); ${AMOUNTS_EXPECTED} are needed ` +
      `(Taxable, Non Taxable, Total, IGST, CGST, SGST, Total Incl Taxes). Row read as: "${row.line.trim()}"`,
      'E05'
    );
  }

  const [taxable, nonTaxable, , igst, cgst, sgst, total] = row.amounts.slice(-AMOUNTS_EXPECTED);

  return {
    issuer: 'InterGlobe Aviation Ltd (IndiGo)',
    documentType: isCreditNote ? 'CREDIT NOTE' : 'TAX INVOICE',
    documentNumber: grab(text, /\bNumber\s*:?\s*([A-Z0-9]{10,})/i),
    documentDate: grab(text, /\bDate\s*:?\s*(\d{1,2}\s+[A-Za-z]{3,}\s+\d{4})/),
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
