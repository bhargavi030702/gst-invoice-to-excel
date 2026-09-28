import { ReadError } from '../errors.js';
import { parseAmount, round2 } from '../numbers.js';
import { findPnr } from '../pnr.js';
import { after, allGstins, sectorFrom, tidyPlace } from '../details.js';

export const issuer = 'British Airways PLC';

// British Airways send the invoice as an HTML e-mail rather than a PDF. Once the
// markup is stripped every cell of the table is its own line, so a label and the
// figure belonging to it sit one under the other rather than side by side.
//
// A tax line is three cells - the name, the rate, then the amount - so the
// figure can be a line or two below its label.
const LOOK_AHEAD = 3;

// Charges collected on behalf of airports and governments. No GST is due on any
// of them, so together they are the non-taxable part of the invoice.
const NON_TAXABLE_LABELS = [
  /^User\s+Development\s+Fee$/i,
  /^Development\s+Fee$/i,
  /^Passenger\s+Service\s+Fee$/i,
  /^Aviation\s+Security\s+Fee$/i,
  /^Other\s+Taxes$/i,
];

export function matches(text) {
  return /British\s+Airways/i.test(text) && /Invoice\s+Subtotal/i.test(text);
}

export function parse(text) {
  const lines = text.split('\n').map((l) => l.trim());

  const taxable = valueFor(lines, /^Invoice\s+Subtotal$/i);
  const total = valueFor(lines, /^TOTAL$/i);

  if (taxable === null || total === null) {
    // Printing the e-mail to PDF cuts the "Amount (in INR)" column off the right
    // of the page, leaving every label and rate but not one figure. Saying so is
    // more use than saying the layout has changed, because the original e-mail
    // reads perfectly well.
    if (looksTruncated(lines)) {
      throw new ReadError(
        'This British Airways invoice has the labels but none of the amounts - the "Amount (in INR)" column is not in the file. It looks like a part of the e-mail printed to PDF. Put the original .html e-mail in the input folder instead.',
        'E04',
      );
    }
    throw new ReadError(
      `Could not find the "${taxable === null ? 'Invoice Subtotal' : 'TOTAL'}" figure on this British Airways invoice. The layout of the e-mail may have changed.`,
      'E04',
    );
  }

  let nonTaxable = 0;
  for (const label of NON_TAXABLE_LABELS) {
    nonTaxable += valueFor(lines, label) ?? 0;
  }

  return {
    issuer,
    documentType: /\bCredit\s+Note\b/i.test(text) ? 'CREDIT NOTE' : 'TAX INVOICE',
    documentNumber: labelledValue(lines, /^(?:Tax\s+Invoice|Credit\s+Note)\s*:?$/i)
      ?? grab(text, /(?:Tax\s+Invoice|Credit\s+Note)\s*:\s*([A-Z0-9][A-Z0-9/-]{5,})/i),
    documentDate: labelledValue(lines, /^Invoice\s+Date\s*:?$/i)
      ?? grab(text, /Invoice\s*Date\s*:?\s*(\d{1,2}[-/][A-Za-z0-9]{2,3}[-/]\d{2,4})/i),
    pnr: findPnr(text),
    clientName: after(text, /Bill\s*To\s*:/i, { stopAt: /\s*(?:\t|Email\s*:)/i }),
    // The airline's own number heads the page, the customer's is further down.
    airlineGstin: allGstins(text)[0] ?? '',
    customerGstin: allGstins(text)[1] ?? '',
    ticketNumber: after(text, /Ticket\s*No\.?\s*:?/i, { stopAt: /\s*(?:\t|GSTIN)/i }),
    placeOfSupply: tidyPlace(after(text, /\bPOS\b\s*:?/i, { stopAt: /\s*(?:\t|Ticket\s*No)/i })),
    // British Airways print no route on the invoice.
    sector: '',
    taxable: round2(taxable),
    nonTaxable: round2(nonTaxable),
    igst: round2(valueFor(lines, /^IGST$/i) ?? 0),
    cgst: round2(valueFor(lines, /^CGST$/i) ?? 0),
    sgst: round2(valueFor(lines, /^SGST$/i) ?? 0),
    total: round2(total),
  };
}

// The tell-tale of a cut-off print: the charge labels are all there and almost
// none of them has a figure against it. The labels are matched loosely here,
// because printing runs the rate onto the end of the label ("CGST 2.50%") where
// the e-mail keeps them in separate cells.
function looksTruncated(lines) {
  const labels = [/^Invoice\s+Subtotal\b/i, /^CGST\b/i, /^SGST\b/i, /^IGST\b/i, /^TOTAL\b/i];
  const present = labels.filter((l) => lines.some((line) => l.test(line)));
  if (present.length < 4) return false;

  // A stray page number can leave one label looking as though it has a figure,
  // so the test is that nearly all of them are bare, not every last one.
  const withFigures = present.filter((l) => valueFor(lines, l) !== null).length;
  return withFigures <= 1;
}

// The figure belonging to a label: on the same line if it is there, otherwise on
// the next line or two. The rate ("2.50%") sits between a tax label and its
// amount and is skipped, because a percentage is not an amount.
function valueFor(lines, label) {
  const index = lines.findIndex((l) => label.test(l));
  if (index === -1) return null;
  for (let i = index; i <= index + LOOK_AHEAD && i < lines.length; i += 1) {
    const tokens = lines[i].split(/\s+/);
    for (const token of i === index ? tokens.slice(1) : tokens) {
      const value = parseAmount(token);
      if (value !== null) return value;
    }
  }
  return null;
}

// The same shape, but for a value that is text rather than a figure.
function labelledValue(lines, label) {
  const index = lines.findIndex((l) => label.test(l));
  if (index === -1) return null;
  const next = lines[index + 1];
  return next && next.length > 0 ? next : null;
}

function grab(text, re) {
  const m = text.match(re);
  return m ? m[1].trim() : '';
}
