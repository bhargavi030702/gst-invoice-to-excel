import { ReadError } from '../errors.js';
import { amountsIn, round2 } from '../numbers.js';
import { findPnr } from '../pnr.js';
import { after, allGstins, sectorFrom, tidyPlace } from '../details.js';

export const issuer = 'Singapore Airlines Ltd';

// One line per ticket. The serial number and the thirteen digit ticket number
// are figures too, so they are dropped before the amounts are read by position.
//
// An invoice carries a "Total value" column and a credit note does not, which
// shifts every column after it:
//
//   invoice      Total value, Taxable value, CGST % Amt, SGST % Amt, IGST % Amt
//   credit note               Taxable value, CGST % Amt, SGST % Amt, IGST % Amt
const TICKET_ROW = /^\s*\d{1,3}\s+\d{10,}\b/;
const WITH_TOTAL_VALUE = 8;
const WITHOUT_TOTAL_VALUE = 7;

// A credit note prints the number of the invoice it is raised against as well as
// its own, so "Corresponding Invoice No" has to be kept out of the way.
const DOCUMENT_NUMBER = /(Corresponding\s+)?(Credit\s*Note|Invoice)\s*No\.?\s*:?\s*([A-Z0-9][A-Z0-9/-]{5,})/gi;
const DOCUMENT_DATE = /(Corresponding\s+)?(Credit\s*Note|Invoice)\s*Dt\.?\s*:?\s*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/gi;

export function matches(text) {
  return /Singapore\s+Airlines\s+Limited/i.test(text);
}

export function parse(text) {
  const lines = text.split('\n');

  // The header is what says which of the two layouts this is.
  const hasTotalValue = /Total\s+value/i.test(text);
  const cellCount = hasTotalValue ? WITH_TOTAL_VALUE : WITHOUT_TOTAL_VALUE;

  const rows = lines
    .filter((l) => TICKET_ROW.test(l))
    .map((line) => ({ line, cells: amountsIn(line).slice(2) }))
    .filter((r) => r.cells.length >= cellCount);

  if (rows.length === 0) {
    throw new ReadError(
      'Could not find a ticket row on this Singapore Airlines document. Expected a line holding a serial number, a ticket number and the amounts beside them.',
      'E04',
    );
  }

  // An invoice can cover several tickets, and the figures for the document as a
  // whole are the columns added down.
  let totalValue = 0;
  let taxable = 0;
  let cgst = 0;
  let sgst = 0;
  let igst = 0;

  for (const { cells } of rows) {
    const c = cells.slice(0, cellCount);
    const at = hasTotalValue ? 1 : 0;
    totalValue += hasTotalValue ? c[0] : 0;
    taxable += c[at];
    cgst += c[at + 2];
    sgst += c[at + 4];
    igst += c[at + 6];
  }

  // Singapore Airlines print no non-taxable column. On an invoice, what the
  // total value is over and above the taxable value and the tax on it is the
  // airport and government charges, which carry no GST. A credit note prints no
  // total at all, so there is nothing over and above to account for.
  const tax = cgst + sgst + igst;
  const nonTaxable = hasTotalValue ? totalValue - taxable - tax : 0;
  const total = hasTotalValue ? totalValue : taxable + tax;

  if (nonTaxable < -0.05) {
    throw new ReadError(
      `Singapore Airlines ticket rows give a taxable value and tax of ${round2(taxable + tax)}, which is more than the total value of ${round2(totalValue)}. The columns have probably moved. Row read as: "${rows[0].line.trim()}"`,
      'E05',
    );
  }

  return {
    issuer,
    documentType: /\bCREDIT\s+NOTE\b/i.test(text) ? 'CREDIT NOTE' : 'TAX INVOICE',
    documentNumber: ownValue(text, DOCUMENT_NUMBER),
    documentDate: ownValue(text, DOCUMENT_DATE),
    // Singapore Airlines documents carry a ticket number but no booking reference.
    pnr: findPnr(text),
    clientName: after(text, /Recipient\s+details\s*:/i, { stopAt: /\t/ }),
    // The airline's own number heads the page, the customer's is further down.
    airlineGstin: allGstins(text)[0] ?? '',
    customerGstin: allGstins(text)[1] ?? '',
    ticketNumber: grab(rows[0].line, /\b(\d{10,})\b/),
    placeOfSupply: tidyPlace(after(text, /Place\s+of\s+supply\s*:/i, { stopAt: /\t/ })),
    // Singapore Airlines print no route on the document.
    sector: '',
    taxable: round2(taxable),
    nonTaxable: round2(nonTaxable),
    igst: round2(igst),
    cgst: round2(cgst),
    sgst: round2(sgst),
    total: round2(total),
  };
}

function ownValue(text, re) {
  for (const m of text.matchAll(re)) {
    if (!m[1]) return m[3].trim();
  }
  return '';
}

function grab(text, re) {
  const m = String(text).match(re);
  return m ? m[1].trim() : '';
}
