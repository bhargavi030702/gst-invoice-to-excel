import { ReadError } from '../errors.js';
import { amountsIn, round2 } from '../numbers.js';
import { findPnr } from '../pnr.js';
import { after, allGstins, sectorFrom, tidyPlace } from '../details.js';

export const issuer = 'InterGlobe Aviation Ltd (IndiGo)';

// The Grand Total row, left to right:
//   Taxable, Non Taxable, Total, IGST, CGST, SGST, [CESS], Total Incl Taxes
// The cess column is only printed on some invoices, which is why both a seven
// and an eight figure row are accepted.
const WITHOUT_CESS = 7;
const WITH_CESS = 8;

export function matches(text) {
  return /Inter\s*Globe\s+Aviation/i.test(text) || /IndiGo/i.test(text);
}

export function parse(text) {
  const isCreditNote = /\bCredit\s+Note\b/i.test(text);
  const lines = text.split('\n');

  const rows = [];
  lines.forEach((line, i) => {
    if (!/Grand\s*Total/i.test(line)) return;
    rows.push({ line, amounts: amountsIn(line) });
    const repaired = repairWrappedRow(lines, i);
    if (repaired) rows.push({ line: `${line} (repaired)`, amounts: repaired });
  });

  if (rows.length === 0) {
    throw new ReadError(
      'Could not find the "Grand Total" row on this IndiGo document. The amounts table may be missing or laid out differently than expected.',
      'E04',
    );
  }

  // Several lines can mention "Grand Total"; the one carrying the most figures
  // is the table row rather than a heading or a note.
  const row = rows.sort((a, b) => b.amounts.length - a.amounts.length)[0];

  if (row.amounts.length < WITHOUT_CESS) {
    throw new ReadError(
      `IndiGo "Grand Total" row holds ${row.amounts.length} amount(s); ${WITHOUT_CESS} are needed (Taxable, Non Taxable, Total, IGST, CGST, SGST, Total Incl Taxes). Row read as: "${row.line.trim()}"`,
      'E05',
    );
  }

  const hasCess = row.amounts.length >= WITH_CESS;
  const cells = row.amounts.slice(-(hasCess ? WITH_CESS : WITHOUT_CESS));
  const [taxable, printedNonTaxable, , igst, cgst, sgst] = cells;
  const cess = hasCess ? cells[6] : 0;
  const total = cells[hasCess ? 7 : 6];

  // The sheet has no cess column. It is nil on every invoice seen so far, so on
  // the rare one where it is not, fold it into the non-taxable figure and say
  // so, rather than quietly losing it and failing the adds-up check.
  const nonTaxable = printedNonTaxable + cess;

  return {
    issuer,
    documentType: isCreditNote ? 'CREDIT NOTE' : 'TAX INVOICE',
    documentNumber: grab(text, /\bNumber\s*:?\s*([A-Z0-9]{10,})/i),
    // Printed "17 Mar 2026" on some invoices and "17-Mar-2026" on others.
    documentDate: grab(text, /\bDate\s*:?\s*(\d{1,2}[\s-][A-Za-z]{3,}[\s-]\d{4})/),
    pnr: findPnr(text),
    clientName: after(text, /GSTIN\s+Customer\s+Name\s*:/i),
    // IndiGo's own number is printed first, the customer's below it.
    airlineGstin: allGstins(text)[0] ?? '',
    // The label "GSTIN of Customer" is split across lines on some layouts,
    // with the value landing between its two halves. The airline's own number
    // is always printed first, so the customer's is the one after it.
    customerGstin: after(text, /GSTIN\s+of\s+Customer\s*:/i) || (allGstins(text)[1] ?? ''),
    // IndiGo bill against the PNR and print no ticket number.
    ticketNumber: '',
    placeOfSupply: tidyPlace(after(text, /Place\s+of\s+Supply\s*:/i)),
    sector: sectorFrom([grab(text, /\bFrom\s*:\s*([A-Z]{3})\b/), grab(text, /\bTo\s*:\s*([A-Z]{3})\b/)]),
    cess: round2(cess),
    taxable: round2(taxable),
    nonTaxable: round2(nonTaxable),
    igst: round2(igst),
    cgst: round2(cgst),
    sgst: round2(sgst),
    total: round2(total),
  };
}

// On some invoices a figure is too wide for its column and PDF viewers break it
// across two lines - "19,956." sits on the line above the row and "00" on the
// line below, leaving the row itself short of two figures:
//
//     19,956. 20,842.
//     Grand Total  886.00  0.00  499.00  499.00  0.00  21,840.00
//     00      00
//
// The fragments above end in a decimal point and the ones below are bare
// digits, so they pair off in order. The whole figures then go back into the
// row at the first and third columns, which are the two the header puts them in.
function repairWrappedRow(lines, index) {
  const above = (lines[index - 1] || '').trim().split(/\s+/).filter((t) => /^[\d,]+\.$/.test(t));
  const below = (lines[index + 1] || '').trim().split(/\s+/).filter((t) => /^\d+$/.test(t));
  if (above.length !== 2 || below.length !== 2) return null;

  const rest = amountsIn(lines[index]);
  if (rest.length !== WITH_CESS - 2) return null;

  const joined = above.map((head, i) => Number(`${head}${below[i]}`.replace(/,/g, '')));
  if (joined.some((v) => !Number.isFinite(v))) return null;

  // Taxable, [Non Taxable], Total, [IGST, CGST, SGST, CESS, Total Incl Taxes]
  return [joined[0], rest[0], joined[1], ...rest.slice(1)];
}

function grab(text, re) {
  const m = text.match(re);
  return m ? m[1].trim() : '';
}
