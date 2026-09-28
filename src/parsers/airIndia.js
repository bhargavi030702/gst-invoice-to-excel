import { ReadError } from '../errors.js';
import { parseAmount, round2 } from '../numbers.js';
import { findPnr } from '../pnr.js';
import { after, allGstins, sectorFrom, tidyPlace } from '../details.js';

export const issuer = 'Air India Ltd';

export function matches(text) {
  return /AIR\s+INDIA\s+LTD/i.test(text) && !/AIR\s+INDIA\s+EXPRESS/i.test(text);
}

export function parse(text) {
  const documentType = documentTypeOf(text);
  const row = findAmountRow(text);
  if (!row) {
    throw new ReadError(
      `Could not find the amounts row on this Air India ${documentType.toLowerCase()}. Expected a table line holding "<amounts> <rate> % <CGST> <SGST> <IGST> <total>".`,
      'E04',
    );
  }

  const { left, right } = row;
  if (left.length < 5) {
    throw new ReadError(
      `Air India ${documentType.toLowerCase()} table row has only ${left.length} amount(s) before the GST rate; 5 are needed (Value of service, Other Taxes Taxable, Non Taxable, Discount, Net taxable value).`,
      'E05',
    );
  }
  if (right.length < 4) {
    throw new ReadError(
      `Air India ${documentType.toLowerCase()} table row has only ${right.length} amount(s) after the GST rate; 4 are needed (CGST, SGST/UTGST, IGST, Total Value).`,
      'E05',
    );
  }

  const [, , printedNonTaxable, discount, taxable] = left.slice(-5);
  const [cgst, sgst, igst, total] = right.slice(0, 4);

  // Air India prints the discount as its own column and does not take it off
  // the non-taxable figure beside it, so the row only adds up once it is.
  const nonTaxable = printedNonTaxable - discount;

  return {
    issuer,
    documentType,
    documentNumber: findDocumentNumber(text),
    documentDate: grab(text, /(?:Invoice|Credit\s*Note|Debit\s*Note)\s*Date\s*:?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i),
    pnr: findPnr(text),
    // The right-hand column runs onto the end of the customer's line.
    clientName: after(text, /\bCustomer\s*:/i, { stopAt: /\s*(?:\t|Reference\s+Document)/i }),
    // Air India's own number is printed at the top, the customer's below it.
    airlineGstin: allGstins(text)[0] ?? '',
    customerGstin: after(text, /Customer\s+GSTIN\s*:/i),
    // "Reference Document Number" is split across lines on some layouts, with
    // the value landing between the two halves of its own label. A bare run of
    // thirteen digits is the ticket number wherever it has ended up.
    ticketNumber: after(text, /Reference\s+Document\s+Number\s*:/i, { stopAt: /\s*\t/ })
      || grab(text, /\b(\d{13})\b/),
    placeOfSupply: tidyPlace(after(text, /Place\s+of\s+Supply\s*:/i, { stopAt: /\s*\t/ })),
    sector: routingOf(after(text, /\bRouting\s*:/i, { stopAt: /\s*\t/ })),
    discount: round2(discount),
    taxable: round2(taxable),
    nonTaxable: round2(nonTaxable),
    igst: round2(igst),
    cgst: round2(cgst),
    sgst: round2(sgst),
    total: round2(total),
  };
}

// Air India print the routing as one run of letters - "DELMAAAI" - being the
// airport flown from, the airport flown to, and the carrier code on the end.
function routingOf(value) {
  const v = String(value).toUpperCase().replace(/[^A-Z]/g, '');
  if (v.length < 6) return '';
  return sectorFrom([v.slice(0, 3), v.slice(3, 6)]);
}

function documentTypeOf(text) {
  if (/\bCREDIT\s+NOTE\b/i.test(text)) return 'CREDIT NOTE';
  if (/\bDEBIT\s+NOTE\b/i.test(text)) return 'DEBIT NOTE';
  return 'TAX INVOICE';
}

// A cancelled ticket carries both its own number and the number of the invoice
// it replaces. The one without "Original" or "Reference" in front of it is this
// document's own.
function findDocumentNumber(text) {
  const re = /(Original|Reference)?\s*(?:Tax\s+)?(?:Invoice|Credit\s*Note|Debit\s*Note)\s*Number\s*:?\s*([A-Z0-9][A-Z0-9-]{5,})/gi;
  for (const m of text.matchAll(re)) {
    if (!m[1]) return m[2].trim();
  }
  return '';
}

// The GST rate is printed as a percentage in the middle of the row, which makes
// it the one landmark that says where the tax columns start.
function findAmountRow(text) {
  for (const line of text.split('\n')) {
    const tokens = line.trim().split(/\s+/);
    const pct = tokens.findIndex((t) => t === '%' || /^\d+(?:\.\d+)?%$/.test(t));
    if (pct === -1) continue;

    const head = tokens.slice(0, tokens[pct] === '%' ? pct - 1 : pct);
    const left = head.map(parseAmount).filter((v) => v !== null);
    const right = tokens.slice(pct + 1).map(parseAmount).filter((v) => v !== null);

    if (left.length >= 5 && right.length >= 4) return { left, right };
  }
  return null;
}

function grab(text, re) {
  const m = text.match(re);
  return m ? m[1].trim() : '';
}
