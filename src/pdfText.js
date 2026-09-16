/**
 * PDF text extraction.
 *
 * Uses pdf.js to pull the text layer out of a PDF, then rebuilds the visual
 * lines from the glyph coordinates. Rebuilding from coordinates (rather than
 * trusting the order the text happens to be stored in) is what lets the
 * parsers read invoice tables reliably, because a table row comes back as one
 * line in the order a human sees it.
 */

import fs from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { ReadError } from './errors.js';
import * as pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';

// pdf.js normally loads its worker from a separate file at run time. Handing it
// the worker up front keeps everything in one process -- and, once bundled,
// in one file with nothing beside it to find.
globalThis.pdfjsWorker = pdfjsWorker;

/** Two glyphs are on the same visual line if their baselines are within this many points. */
const LINE_TOLERANCE = 2.2;

/** A horizontal gap wider than this many points becomes a space. */
const SPACE_GAP = 1.4;

/**
 * Read a PDF and return its text, lines in reading order.
 * @param {string} filePath
 * @returns {Promise<string>} empty when the PDF is a scan with no text layer
 */
export async function extractPdfText(filePath) {
  const data = new Uint8Array(fs.readFileSync(filePath));
  let doc;
  try {
    doc = await pdfjs.getDocument({
      data,
      useSystemFonts: true,
      isEvalSupported: false,
      verbosity: 0,
    }).promise;
  } catch (err) {
    throw new ReadError(
      `PDF could not be opened (${err.message}). The file may be corrupt or password protected.`,
      'E02'
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

/**
 * Turn positioned glyph runs into text lines.
 * @param {Array<object>} items pdf.js text items
 * @returns {string}
 */
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
        if (prevEnd !== null && part.x - prevEnd > SPACE_GAP && !line.endsWith(' ')) {
          line += ' ';
        }
        line += part.str;
        prevEnd = part.end;
      }
      return line.replace(/\s+/g, ' ').trim();
    })
    .filter((line) => line.length > 0)
    .join('\n');
}
