import fs from 'node:fs';
import { ReadError } from './errors.js';

// Some airlines send the invoice as an HTML e-mail rather than a PDF. The
// parsers all work on plain text, so an HTML file is turned into the same shape
// of text a PDF gives: one line per cell, in reading order.
//
// Table cells become their own line rather than being joined, because the
// invoices lay a label and its value out as two cells side by side and the
// parsers look for the value on the line after the label.

const BLOCK_TAG = /<\/?(?:address|article|aside|blockquote|br|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)\b[^>]*>/gi;

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '-',
  mdash: '-',
  lsquo: "'",
  rsquo: "'",
  ldquo: '"',
  rdquo: '"',
  hellip: '...',
  rupee: 'Rs',
};

export function extractHtmlText(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new ReadError(`The file could not be read (${err.message}).`, 'E10');
  }
  return htmlToText(raw);
}

export function htmlToText(raw) {
  let text = raw;

  // Anything that is not page content at all.
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');
  text = text.replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');

  // Every block-level tag ends a line; inline tags are just removed.
  text = text.replace(BLOCK_TAG, '\n');
  text = text.replace(/<[^>]*>/g, '');

  text = decodeEntities(text);

  // A non-breaking space reads as a space but is not one, and Word writes a lot
  // of them. Fold every kind of blank into an ordinary space.
  text = text.replace(/[\u00a0\u2007\u202f\t\r]/g, ' ');

  return text
    .split('\n')
    .map((line) => line.replace(/ +/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    const named = ENTITIES[body.toLowerCase()];
    return named === undefined ? whole : named;
  });
}
