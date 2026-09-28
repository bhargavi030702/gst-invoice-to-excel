import { ReadError } from '../errors.js';
import { amountsIn, parseAmount, round2 } from '../numbers.js';
import { looksLikePnr } from '../pnr.js';
import { after, sectorFrom, stateFromCode } from '../details.js';

export const issuer = 'SriLankan Airlines Ltd';

// SriLankan send several invoices in one PDF, one after another, each starting
// with its own "TAX INVOICE" heading.
const DOCUMENT_HEADING = /^\s*(TAX\s+INVOICE|CREDIT\s+NOTE)\s*$/i;

// The fare sits on the "Class of Travel" line: a single letter for the cabin,
// then sometimes the ticket reference, then the amount.
const CLASS_ROW = /^\s*([A-Z])\s+(.+)$/;

const TAX_LABELS = ['CGST', 'SGST', 'IGST'];

export function matches(text) {
  return /SriLankan\s+Airlines/i.test(text);
}

export function parse(text) {
  const blocks = splitDocuments(text);
  if (blocks.length === 0) {
    throw new ReadError(
      'Could not find a "TAX INVOICE" heading on this SriLankan Airlines document.',
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
    type: lines[start].trim().toUpperCase().replace(/\s+/g, ' '),
    lines: lines.slice(start, starts[n + 1] ?? lines.length),
  }));
}

function parseDocument({ type, lines }) {
  const block = lines.join('\n');

  const total = findTotal(lines);
  if (total === null) {
    throw new ReadError(
      'Could not find the "Total" figure on this SriLankan Airlines invoice.',
      'E04',
    );
  }

  const cgst = findTax(lines, 'CGST');
  const sgst = findTax(lines, 'SGST');
  const igst = findTax(lines, 'IGST');

  const taxable = findFare(lines);
  if (taxable === null) {
    throw new ReadError(
      'Could not find the fare on this SriLankan Airlines invoice. Expected a "Class of Travel" line holding the cabin letter and the amount.',
      'E05',
    );
  }

  return {
    issuer,
    documentType: type === 'CREDIT NOTE' ? 'CREDIT NOTE' : 'TAX INVOICE',
    documentNumber: grab(block, /Serial\s*No\.?\s*:?\s*([A-Z0-9-]{4,})/i),
    documentDate: grab(block, /\bDate\s*:?\s*(\d{1,2}-[A-Za-z]{3}-\d{2,4})/i),
    pnr: findTicketReference(lines),
    clientName: clientNameOf(block),
    airlineGstin: after(block, /GSTIN\s*[-–]/i),
    customerGstin: after(block, /GSTIN\/\s*Unique\s*ID/i),
    // SriLankan bill against the ticket reference and print no ticket number.
    ticketNumber: '',
    // Only the state code is printed, never the name of the state.
    placeOfSupply: stateFromCode(after(block, /State\s+Code/i).replace(/\D/g, '')),
    sector: sectorFrom((block.match(/\b[A-Z]{3}(?:[\\/][A-Z]{3})+\b/) ?? [''])[0].split(/[\\/]/)),
    taxable: round2(taxable),
    // Every SriLankan invoice seen prints the fare and the tax on it and nothing
    // else, so there is no non-taxable part to carry.
    nonTaxable: 0,
    igst: round2(igst),
    cgst: round2(cgst),
    sgst: round2(sgst),
    total: round2(total),
  };
}

function findTotal(lines) {
  for (const line of lines) {
    if (!/^\s*Total\b/i.test(line)) continue;
    const amounts = amountsIn(line);
    if (amounts.length > 0) return amounts[amounts.length - 1];
  }
  return null;
}

// The layout of this table is not stable. On some invoices the figure is beside
// its label ("CGST 651.5"); on others the labels run down one column and the
// figures down the one before, so the figure lands on the line above.
function findTax(lines, label) {
  for (let i = 0; i < lines.length; i += 1) {
    const tokens = lines[i].trim().split(/\s+/);
    const at = tokens.indexOf(label);
    if (at === -1) continue;

    const after = parseAmount(tokens[at + 1]);
    if (after !== null) return after;

    const before = parseAmount(tokens[at - 1]);
    if (before !== null) return before;

    const above = amountsIn(lines[i - 1] || '');
    if (above.length === 1) return above[0];
  }
  return 0;
}

function findFare(lines) {
  for (const line of lines) {
    const m = line.match(CLASS_ROW);
    if (!m) continue;
    // "Total 11487" also starts with a capital, so a line that is a label of its
    // own has to be kept out. Only a one letter cabin code counts.
    if (TAX_LABELS.includes(m[1])) continue;
    const amounts = amountsIn(m[2]);
    if (amounts.length > 0) return amounts[amounts.length - 1];
  }
  return null;
}

// Printed under "Ticket Reference" with no label of its own, so it is found by
// shape: a six character booking reference standing alone on its line, or
// beside the cabin code.
function findTicketReference(lines) {
  for (const line of lines) {
    for (const token of line.trim().split(/\s+/)) {
      if (looksLikePnr(token) && /\d/.test(token)) return token;
    }
  }
  return '';
}

// Printed after "Bill to Address", but only on some invoices - on the rest that
// line carries the address and nothing else. An address here is written as
// slash-separated parts, which is what tells the two apart.
function clientNameOf(block) {
  const value = after(block, /Bill\s+to\s+Address/i, { stopAt: /	/ });
  return value.includes('/') ? '' : value;
}

function grab(text, re) {
  const m = text.match(re);
  return m ? m[1].trim() : '';
}
