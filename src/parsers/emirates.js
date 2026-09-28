import { ReadError } from '../errors.js';
import { amountsIn, round2 } from '../numbers.js';
import { findPnr } from '../pnr.js';
import { GSTIN, after, allGstins, tidyPlace, undouble } from '../details.js';

export const issuer = 'Emirates';

// The tax figures are not in the row itself but stacked in a cell beside it, so
// a few lines either side of the row are searched for them.
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
      'Could not find the "Tickets" amounts row on this Emirates invoice. Expected a line starting with "Tickets" and holding HSN 996425.',
      'E04',
    );
  }

  const row = lines[rowIndex];
  const amounts = amountsIn(row);
  if (amounts.length < 5) {
    throw new ReadError(
      `Emirates "Tickets" row holds ${amounts.length} amount(s); at least 5 are needed (HSN, Total Value, Taxable Value, Tax %, Total Invoice Amount). Row read as: "${row.trim()}"`,
      'E05',
    );
  }

  const totalValue = amounts[1];
  const taxable = amounts[2];
  const total = amounts[amounts.length - 1];
  const band = lines.slice(Math.max(0, rowIndex - TAX_BAND), rowIndex + TAX_BAND + 1).join(' ');

  return {
    issuer,
    documentType: isCreditNote ? 'CREDIT NOTE' : 'TAX INVOICE',
    documentNumber: grab(text, /Invoice\s*Number\s*:?\s*([A-Z0-9]{10,})/i),
    documentDate: grab(text, /Invoice\s*Date\s*:?\s*([\d]{1,2}[-/][\d]{1,2}[-/][\d]{2,4})/i),
    // Emirates invoices carry a ticket number but no booking reference.
    pnr: findPnr(text),
    clientName: clientNameOf(lines),
    // Emirates' own number is on the line with the client's name, in the column
    // beside it; the client's own is at the start of the line below.
    airlineGstin: allGstins(text)[0] ?? '',
    customerGstin: allGstins(text)[1] ?? '',
    ticketNumber: undouble(after(text, /Ticket\/Document\s*number\s*:/i)),
    placeOfSupply: tidyPlace(undouble(after(text, /Place\s+of\s+supply\s*:/i))),
    // Emirates print no route on the invoice.
    sector: '',
    taxable: round2(taxable),
    nonTaxable: round2(totalValue - taxable),
    igst: round2(taxOf(band, 'IGST')),
    cgst: round2(taxOf(band, 'CGST')),
    sgst: round2(taxOf(band, 'SGST')),
    total: round2(total),
  };
}

// The client's name is the first thing under "Billed to:", with Emirates' own
// GST number in the column beside it. Everything on an Emirates invoice is drawn
// twice, so the name arrives as itself repeated.
function clientNameOf(lines) {
  const at = lines.findIndex((l) => /^\s*Billed\s+to\s*:/i.test(l));
  if (at === -1) return '';
  for (const line of lines.slice(at + 1, at + 3)) {
    const left = line.split('\t')[0].replace(GSTIN_ANYWHERE, '').replace(/GSTIN\s*:/i, '').trim();
    if (left.length > 3) return undouble(left);
  }
  return '';
}

const GSTIN_ANYWHERE = new RegExp(GSTIN.source, 'g');

// "CGST: 1265.00", stacked one per line in a cell of its own.
const TAX_LINE = /\b(IGST|CGST|SGST)\s*:\s*([\d,]+(?:\.\d+)?)/gi;

function taxOf(band, label) {
  for (const m of band.matchAll(TAX_LINE)) {
    if (m[1].toUpperCase() === label) return Number(m[2].replace(/,/g, ''));
  }
  return 0;
}

function grab(text, re) {
  const m = text.match(re);
  return m ? m[1].trim() : '';
}
