import fs from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import { ReadError } from './errors.js';

globalThis.pdfjsWorker = pdfjsWorker;

// Two numbers tuned against the invoices this tool reads. LINE_TOLERANCE is how
// far apart two pieces of text can sit vertically and still count as the same
// line; SPACE_GAP is the horizontal gap that means a space rather than two
// characters that happen to be adjacent.
const LINE_TOLERANCE = 2.2;
const SPACE_GAP = 1.4;

// Most of these invoices are laid out in two columns - the airline down one side
// and the customer down the other - and flattening a page into lines runs the
// two together: "SAINT-GOBAIN INDIA LTD Kempegowda International Airport,".
//
// The gap between two columns is a different order of thing from the gap between
// two words: around 200 units against around 1. Anything above this is treated
// as a column boundary and kept as a tab, so a parser that needs to can split
// the halves apart. Everything else sees a tab as the whitespace it is.
const COLUMN_GAP = 20;

export async function extractPdfText(filePath) {
  const data = new Uint8Array(fs.readFileSync(filePath));

  let doc;
  try {
    doc = await getDocument({
      data,
      useSystemFonts: true,
      isEvalSupported: false,
      verbosity: 0,
    }).promise;
  } catch (err) {
    throw new ReadError(
      `PDF could not be opened (${err.message}). The file may be corrupt or password protected.`,
      'E02',
    );
  }

  const pages = [];
  try {
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push(buildLines(content.items));
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }

  return pages.join('\n');
}

// A PDF holds pieces of text at coordinates, not lines. Group them by height,
// sort each group left to right, and a table row reads as one line of text.
function buildLines(items) {
  const rows = [];

  for (const item of items) {
    if (!item.str) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    const width = item.width ?? 0;

    let row = rows.find((r) => Math.abs(r.y - y) <= LINE_TOLERANCE);
    if (!row) {
      row = { y, parts: [] };
      rows.push(row);
    }
    row.parts.push({ x, end: x + width, str: item.str });
  }

  rows.sort((a, b) => b.y - a.y);

  return rows
    .map((row) => {
      row.parts.sort((a, b) => a.x - b.x);
      let line = '';
      let prevEnd = null;
      for (const part of row.parts) {
        if (prevEnd !== null && !line.endsWith(' ') && !line.endsWith('\t')) {
          const gap = part.x - prevEnd;
          if (gap > COLUMN_GAP) line += '\t';
          else if (gap > SPACE_GAP) line += ' ';
        }
        line += part.str;
        prevEnd = part.end;
      }
      // Runs of blanks collapse, but a column boundary is kept as one tab.
      return line.replace(/[^\S\t\n]+/g, ' ').replace(/ ?\t[\t ]*/g, '\t').trim();
    })
    .filter((line) => line.length > 0)
    .join('\n');
}
