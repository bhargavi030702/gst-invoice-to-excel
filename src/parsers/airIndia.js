/**
 * Air India Ltd. tax invoices, credit notes and debit notes.
 *
 * The amounts sit on one table row, in printed column order:
 *   Sl | HSN/description | Value of service | Other Taxes Taxable* | Non Taxable*
 *      | Discount | Net taxable value | GST % | CGST | SGST/UTGST | IGST | Total Value
 *
 * The "GST %" cell is the anchor: five amounts belong to its left and four to
 * its right, which is what tells the columns apart without depending on how
 * the description happens to wrap.
 */

import { parseAmount, round2 } from '../numbers.js';
import { ReadError } from '../errors.js';

export function matches(text) {
  return /AIR\s+INDIA\s+LTD/i.test(text) && !/AIR\s+INDIA\s+EXPRESS/i.test(text);
}

export function parse(text) {
  const documentType = documentTypeOf(text);
  const row = findAmountRow(text);

  if (!row) {
    throw new ReadError(
      `Could not find the amounts row on this Air India ${documentType.toLowerCase()}. ` +
      'Expected a table line holding "<amounts> <rate> % <CGST> <SGST> <IGST> <total>".',
      'E04'
    );
  }

  const { left, right } = row;
  if (left.length < 5) {
    throw new ReadError(
      `Air India ${documentType.toLowerCase()} table row has only ${left.length} amount(s) before the GST rate; ` +
      '5 are needed (Value of service, Other Taxes Taxable, Non Taxable, Discount, Net taxable value).',
      'E05'
    );
  }
  if (right.length < 4) {
    throw new ReadError(
      `Air India ${documentType.toLowerCase()} table row has only ${right.length} amount(s) after the GST rate; ` +
      '4 are needed (CGST, SGST/UTGST, IGST, Total Value).',
      'E05'
    );
  }

  const [, , printedNonTaxable, discount, taxable] = left.slice(-5);
  const [cgst, sgst, igst, total] = right.slice(0, 4);

  // Air India applies the Discount column to the non-taxable side: the printed
  // "Net taxable value" is already gross of it. Discount is 0.00 on an ordinary
  // ticket, so this only bites on adjustment notes. Any case where the
  // assumption is wrong shows up as an unbalanced row on the Verification sheet.
  const nonTaxable = printedNonTaxable - discount;

  return {
    issuer: 'Air India Ltd',
    documentType,
    documentNumber: findDocumentNumber(text),
    documentDate: grab(text, /(?:Invoice|Credit\s*Note|Debit\s*Note)\s*Date\s*:?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i),
    // The "Reference Document Number" label wraps across lines on some
    // layouts, so the word "Number" is optional; only a long run of digits is
    // accepted, which keeps "Reference Document Type : TKTT" out of the way.
    discount: round2(discount),
    taxable: round2(taxable),
    nonTaxable: round2(nonTaxable),
    igst: round2(igst),
    cgst: round2(cgst),
    sgst: round2(sgst),
    total: round2(total),
  };
}

function documentTypeOf(text) {
  if (/\bCREDIT\s+NOTE\b/i.test(text)) return 'CREDIT NOTE';
  if (/\bDEBIT\s+NOTE\b/i.test(text)) return 'DEBIT NOTE';
  return 'TAX INVOICE';
}

/**
 * Read this document's own number.
 *
 * Credit and debit notes also print "Original Invoice Number", which must not
 * be mistaken for the number of the document in hand.
 */
function findDocumentNumber(text) {
  const re = /(Original|Reference)?\s*(?:Tax\s+)?(?:Invoice|Credit\s*Note|Debit\s*Note)\s*Number\s*:?\s*([A-Z0-9][A-Z0-9-]{5,})/gi;
  for (const m of text.matchAll(re)) {
    if (!m[1]) return m[2].trim();
  }
  return '';
}

/**
 * Locate the single table row carrying the amounts and split it at the GST rate.
 * @param {string} text
 * @returns {{left: number[], right: number[]}|null}
 */
function findAmountRow(text) {
  for (const line of text.split('\n')) {
    const tokens = line.trim().split(/\s+/);
    const pct = tokens.findIndex((t) => t === '%' || /^\d+(?:\.\d+)?%$/.test(t));
    if (pct === -1) continue;

    // Tokens before the rate, minus the rate figure itself when it is separate ("5 %").
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
