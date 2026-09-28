import { ReadError } from '../errors.js';
import { amountsIn, round2 } from '../numbers.js';
import { findPnr } from '../pnr.js';
import { allGstins, panOf, tidyPlace } from '../details.js';

export const issuer = 'Malaysia Airlines Berhad';

// The TOTAL row, left to right:
//   Taxable Value, Non Taxable-Exempted, CGST, SGST, IGST, Cess, Total Ticket Value
const CELLS = 7;

export function matches(text) {
  return /MALAYSIA\s+AIRLINES/i.test(text);
}

export function parse(text) {
  const lines = text.split('\n');

  // "Total Ticket Value in Words and Figures" starts with the same word, so the
  // row is the one carrying a full set of figures.
  const row = lines
    .filter((l) => /^\s*TOTAL\b/i.test(l))
    .map((line) => ({ line, amounts: amountsIn(line) }))
    .filter((r) => r.amounts.length >= CELLS)[0];

  if (!row) {
    throw new ReadError(
      'Could not find the "TOTAL" row on this Malaysia Airlines invoice. The amounts table may be missing or laid out differently than expected.',
      'E04',
    );
  }

  const [taxable, printedNonTaxable, cgst, sgst, igst, cess, total] = row.amounts.slice(-CELLS);

  // The sheet has no cess column, so on the rare invoice that carries one it is
  // folded into the non-taxable figure and said so, rather than being dropped.
  const nonTaxable = printedNonTaxable + cess;

  return {
    issuer,
    documentType: /\bCREDIT\s+NOTE\b/i.test(text) ? 'CREDIT NOTE' : 'TAX INVOICE',
    documentNumber: grab(text, /Invoice\s*No\.?\s*:?\s*([A-Z0-9][A-Z0-9/-]{5,})/i),
    documentDate: grab(text, /Invoice\s*Date\s*:?\s*(\d{1,2}-[A-Za-z]{3}-\d{2,4})/i),
    // Malaysia Airlines invoices carry a ticket number but no booking reference.
    pnr: findPnr(text),
    ...partiesOf(text),
    // On the line item rather than the totals row. Nothing else on the page is
    // a bare run of twelve or more digits.
    ticketNumber: grab(text, /\b(\d{12,})\b/),
    // Malaysia Airlines print no route on the invoice.
    sector: '',
    cess: round2(cess),
    taxable: round2(taxable),
    nonTaxable: round2(nonTaxable),
    igst: round2(igst),
    cgst: round2(cgst),
    sgst: round2(sgst),
    total: round2(total),
  };
}

// The supplier runs down one side of the page and the recipient down the other,
// and both are headed "Name :" and "GSTN :" with nothing to say which is which.
// What does say is the recipient's PAN, printed on its own: the GST number
// built around that PAN is the customer's, and the other one is the airline's.
function partiesOf(text) {
  const gstins = allGstins(text);
  const pan = grab(text, /\bPAN\s*:\s*([A-Z]{5}\d{4}[A-Z])\b/i);

  const customerGstin = gstins.find((g) => panOf(g) === pan) ?? gstins[1] ?? '';
  const airlineGstin = gstins.find((g) => g !== customerGstin) ?? '';

  return {
    // Both names sit on one line; the recipient's is the second of the two.
    clientName: grab(text, /Name\s*:.*?Name\s*:\s*(.+?)\s*(?:\t|$)/im),
    airlineGstin,
    customerGstin,
    // The recipient's state is printed beside their GST number.
    placeOfSupply: tidyPlace(grab(text, new RegExp(`State\\s*:\\s*([A-Za-z ]+?)\\s*GSTN\\s*:\\s*${customerGstin}`, 'i'))),
  };
}

function grab(text, re) {
  const m = String(text).match(re);
  return m ? m[1].trim() : '';
}
