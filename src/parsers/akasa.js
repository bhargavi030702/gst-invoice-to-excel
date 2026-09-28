import { ReadError } from '../errors.js';
import { amountsIn, round2 } from '../numbers.js';
import { findPnr } from '../pnr.js';
import { after, allGstins, sectorFrom, tidyPlace } from '../details.js';

export const issuer = 'SNV Aviation Ltd (Akasa Air)';

// Akasa often sends one PDF holding several documents - the tax invoice, then a
// debit note and a credit note against it. Each is a separate document with its
// own number, so each becomes its own row.
const DOCUMENT_HEADING = /^\s*(Tax\s+Invoice|Debit\s+Note|Credit\s+Note)\s*$/i;

// Grand Total, left to right:
//   Taxable, Non Taxable, Discount, Total Amount, CGST, SGST, IGST, Total incl tax
const CELLS = 8;

export function matches(text) {
  return /SNV\s+AVIATION/i.test(text) || /akasaair\.com/i.test(text);
}

export function parse(text) {
  const blocks = splitDocuments(text);
  if (blocks.length === 0) {
    throw new ReadError(
      'Could not find a Tax Invoice, Debit Note or Credit Note heading on this Akasa Air document.',
      'E04',
    );
  }
  return blocks.map(parseDocument);
}

function splitDocuments(text) {
  const lines = text.split('\n');
  const starts = [];
  lines.forEach((line, i) => {
    if (DOCUMENT_HEADING.test(line)) starts.push(i);
  });

  return starts.map((start, n) => ({
    type: lines[start].trim().toUpperCase(),
    lines: lines.slice(start, starts[n + 1] ?? lines.length),
  }));
}

function parseDocument({ type, lines }) {
  const block = lines.join('\n');

  const rowIndex = lines.findIndex((l) => /^\s*Grand\s*Total\b/i.test(l));
  if (rowIndex === -1) {
    throw new ReadError(
      `Could not find the "Grand Total" row of the ${type.toLowerCase()} on this Akasa Air document. The amounts table may be missing or laid out differently than expected.`,
      'E04',
    );
  }

  const amounts = amountsIn(lines[rowIndex]);
  if (amounts.length < CELLS) {
    throw new ReadError(
      `Akasa Air "Grand Total" row holds ${amounts.length} amount(s); ${CELLS} are needed (Taxable, Non Taxable, Discount, Total, CGST, SGST, IGST, Total incl tax). Row read as: "${lines[rowIndex].trim()}"`,
      'E05',
    );
  }

  const [printedTaxable, nonTaxable, discount, , cgst, sgst, igst, total] = amounts.slice(-CELLS);

  // The line items show the discount coming off the air fare rather than off the
  // airport charges beside it, so it is the taxable figure that it reduces.
  const taxable = printedTaxable - discount;

  return {
    issuer,
    documentType: type === 'TAX INVOICE' ? 'TAX INVOICE' : type,
    documentNumber: findDocumentNumber(block, type),
    documentDate: grab(block, /(?:Invoice|Debit\s*Note|Credit\s*Note)\s*Date\s*:?\s*(\d{1,2}-[A-Za-z]{3}-\d{4})/i),
    pnr: findPnr(block),
    // The airline's address runs down the column beside the customer's name, so
    // the name stops where the column does.
    clientName: after(block, /Name\s+of\s+Customer\s*:/i, { stopAt: /\t/ }),
    // "GSTIN/ Unique ID of Customer" has no colon straight after "GSTIN", so
    // this picks up only the airline's own.
    airlineGstin: after(block, /GSTIN\s*:/i),
    customerGstin: after(block, /GSTIN\/\s*Unique\s*ID\s*of\s*Customer\s*:/i),
    // Akasa bill against the PNR and print no ticket number.
    ticketNumber: '',
    placeOfSupply: tidyPlace(after(block, /Place\s+of\s+Supply\s*:/i, { stopAt: /\t/ })),
    // Only the airport flown from is printed, never the one flown to.
    sector: sectorFrom([grab(block, /Flight\s+From\s*:\s*([A-Z]{3})\b/i)]),
    discount: round2(discount),
    taxable: round2(taxable),
    nonTaxable: round2(nonTaxable),
    igst: round2(igst),
    cgst: round2(cgst),
    sgst: round2(sgst),
    total: round2(total),
  };
}

const DOCUMENT_NUMBER = /(Ref\s*)?(Invoice|Debit\s*Note|Credit\s*Note)\s*Number\s*:?\s*([A-Z0-9]{6,})/gi;

// A debit or credit note prints the number of the invoice it is raised against
// as well as its own, so "Ref Invoice Number" has to be kept out of the way and
// only the label matching this document counted.
function findDocumentNumber(block, type) {
  const want = type === 'TAX INVOICE' ? 'INVOICE' : type;
  for (const m of block.matchAll(DOCUMENT_NUMBER)) {
    if (m[1]) continue;
    if (m[2].replace(/\s+/g, ' ').toUpperCase() === want) return m[3].trim();
  }
  return '';
}

function grab(text, re) {
  const m = text.match(re);
  return m ? m[1].trim() : '';
}
