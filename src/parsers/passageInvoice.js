import { ReadError } from '../errors.js';
import { amountsIn, round2 } from '../numbers.js';
import { findPnr } from '../pnr.js';
import { after, allGstins, sectorFromLegs, tidyPlace } from '../details.js';

// Air France, KLM and Lufthansa all send the same "passage invoice", printed
// from one template by the same agency. Only the name and address at the top
// change, so one parser reads all three and names whichever issued it.
//
// A new airline on this template needs a line in AIRLINES and nothing else.

export const issuer = 'Air France / KLM / Lufthansa';

const AIRLINES = [
  [/\bKLM\s+Royal\s+Dutch\b/i, 'KLM Royal Dutch Airlines'],
  [/\bLufthansa\b/i, 'Lufthansa German Airlines'],
  [/\bAir\s*France\b/i, 'Air France'],
];

export function matches(text) {
  return /TICKET\s+CALCULATION/i.test(text) && AIRLINES.some(([re]) => re.test(text));
}

export function parse(text) {
  const isCreditNote = /\bCredit\s+Note\b/i.test(text);
  const lines = text.split('\n');

  // The taxable row reads:  NET  CGST  SGST  IGST  TOTAL
  // The label wraps onto the next line ("Taxable charges (Fare +" / "YQ,YR,DU,")
  // but every figure stays on the first of the two.
  const taxIndex = lines.findIndex((l) => /^\s*Taxable\s+charges\b/i.test(l));
  if (taxIndex === -1) {
    throw new ReadError(
      'Could not find the "Taxable charges" row on this passage invoice. The ticket calculation table may be missing or laid out differently than expected.',
      'E04',
    );
  }

  const charges = amountsIn(lines[taxIndex]);
  if (charges.length < 5) {
    throw new ReadError(
      `Passage invoice "Taxable charges" row holds ${charges.length} amount(s); 5 are needed (Net, CGST, SGST, IGST, Total). Row read as: "${lines[taxIndex].trim()}"`,
      'E05',
    );
  }

  const [taxable, cgst, sgst, igst] = charges;

  // Airport and government charges carry no GST. The row is absent when there
  // are none, which is not an error.
  const nonTaxIndex = lines.findIndex((l) => /^\s*Non\s*taxable\s+charges\b/i.test(l));
  const nonTaxable = nonTaxIndex === -1 ? 0 : (amountsIn(lines[nonTaxIndex])[0] ?? 0);

  const total = findTotal(lines);
  if (total === null) {
    throw new ReadError(
      'Could not find the "TOTAL IN TICKET CURRENCY" figure on this passage invoice.',
      'E04',
    );
  }

  // The supplier's GST number is printed on a line of its own with no label,
  // and the client's name is on the line straight after it.
  const gstins = allGstins(text);
  const airlineGstin = gstins[0] ?? '';
  const customerGstin = after(text, /GSTIN\s*:/i) || (gstins[1] ?? '');

  return {
    issuer: nameOf(text),
    documentType: isCreditNote ? 'CREDIT NOTE' : 'TAX INVOICE',
    documentNumber: grab(text, /Invoice\s*No\.?\s*:?\s*([A-Z0-9][A-Z0-9/-]{5,})/i),
    // Air France and KLM head it "Invoice Date", Lufthansa "Date of issue".
    documentDate: grab(text, /(?:Invoice\s*Date|Date\s+of\s+issue)\s*:?\s*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/i),
    pnr: findPnr(text),
    clientName: clientNameOf(lines, airlineGstin),
    airlineGstin,
    customerGstin,
    ticketNumber: after(text, /Ticket\s*Number/i),
    placeOfSupply: tidyPlace(after(text, /Place\s+of\s+supply/i, { stopAt: /\s+Service\s+description/i })),
    sector: sectorFromLegs(text),
    taxable: round2(taxable),
    nonTaxable: round2(nonTaxable),
    igst: round2(igst),
    cgst: round2(cgst),
    sgst: round2(sgst),
    total: round2(total),
  };
}

function nameOf(text) {
  for (const [re, name] of AIRLINES) {
    if (re.test(text)) return name;
  }
  return issuer;
}

// The client's name sits on the line after the airline's GST number, with the
// right-hand "Contact details" column run onto the end of it.
function clientNameOf(lines, airlineGstin) {
  if (!airlineGstin) return '';
  const at = lines.findIndex((l) => l.includes(airlineGstin));
  if (at === -1) return '';
  const line = (lines[at + 1] ?? '').trim();
  return line.split(/\s+Contact\s+details/i)[0].trim();
}

// The grand total sits under a label of its own, and the currency it is in is
// printed on the line below it rather than beside it.
function findTotal(lines) {
  const index = lines.findIndex((l) => /TOTAL\s+IN\s+TICKET\s+CURRENCY/i.test(l));
  if (index === -1) return null;
  for (const line of lines.slice(index, index + 3)) {
    const amounts = amountsIn(line);
    if (amounts.length > 0) return amounts[amounts.length - 1];
  }
  return null;
}

function grab(text, re) {
  const m = text.match(re);
  return m ? m[1].trim() : '';
}
