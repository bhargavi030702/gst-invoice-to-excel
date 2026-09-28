import { ReadError } from '../errors.js';
import { amountsIn, round2 } from '../numbers.js';
import { findPnr } from '../pnr.js';
import { after, allGstins, sectorFrom, tidyPlace } from '../details.js';

export const issuer = 'Air India Express Ltd';

export function matches(text) {
  return /AIR\s+INDIA\s+EXPRESS/i.test(text);
}

export function parse(text) {
  const isCreditNote = /\bCredit\s+Note\b/i.test(text);
  const lines = text.split('\n');

  const rowIndex = lines.findIndex((l) => /^\s*Grand\s*Total\b/i.test(l));
  if (rowIndex === -1) {
    throw new ReadError(
      'Could not find the "Grand Total" row on this Air India Express document. The amounts table may be missing or laid out differently than expected.',
      'E04',
    );
  }

  // Whether the sale was inside the state or across it decides which tax
  // columns are printed, and so how many figures the row holds. The header
  // above the row is what says which layout this is.
  const header = lines.slice(Math.max(0, rowIndex - 12), rowIndex).join('\n');
  const interState = /\bIGST\b/.test(header) && !/\bCGST\b/.test(header);

  const amounts = amountsIn(lines[rowIndex]);
  const needed = interState ? 5 : 6;
  if (amounts.length < needed) {
    throw new ReadError(
      `Air India Express "Grand Total" row holds ${amounts.length} amount(s); ${needed} are needed for the ${interState ? 'IGST' : 'CGST + SGST'} layout. Row read as: "${lines[rowIndex].trim()}"`,
      'E05',
    );
  }

  const [taxable, nonTaxable] = amounts;
  const igst = interState ? amounts[3] : 0;
  const cgst = interState ? 0 : amounts[3];
  const sgst = interState ? 0 : amounts[4];
  const total = interState ? amounts[4] : amounts[5];

  return {
    issuer,
    documentType: isCreditNote ? 'CREDIT NOTE' : 'TAX INVOICE',
    documentNumber: grab(text, /(?:Invoice|Credit\s*Note)\s*Number\s*:?\s*([A-Z0-9]{10,})/i),
    documentDate: grab(text, /(?:Invoice|Credit\s*Note)\s*Date\s*:?\s*([\d]{1,2}[-/][\d]{1,2}[-/][\d]{2,4})/i),
    pnr: findPnr(text),
    // The label is "GSTIN Customer Name", but it wraps on some layouts and
    // arrives as "GSTIN Customer :" with "Name" left on the line below.
    clientName: after(text, /GSTIN\s+Customer\s*(?:Name)?\s*:/i, { stopAt: /	|\s*Place\s+of\s+Supply/i }),
    // The airline's own number is printed at the top, the customer's below it.
    airlineGstin: allGstins(text)[0] ?? '',
    // The label "GSTIN of Customer" is split across lines on some layouts,
    // with the value landing between its two halves. The airline's own number
    // is always printed first, so the customer's is the one after it.
    customerGstin: after(text, /GSTIN\s+of\s+Customer\s*:/i) || (allGstins(text)[1] ?? ''),
    // Air India Express bill against the PNR and print no ticket number.
    ticketNumber: '',
    placeOfSupply: tidyPlace(after(text, /Place\s+of\s+Supply\s*:/i)),
    sector: sectorFrom([
      grab(text, /Flight\s+From\s*:\s*([A-Z]{3})\b/i),
      grab(text, /Flight\s+To\s*:\s*([A-Z]{3})\b/i),
    ]),
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
