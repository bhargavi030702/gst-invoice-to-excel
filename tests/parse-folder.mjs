// Reads every file in a folder, parses it, and says whether each document adds
// up. Nothing is written anywhere - this is for checking a parser after a change
// without waiting for a whole run.
//
//   node tests/parse-folder.mjs "training data"
//   node tests/parse-folder.mjs input --quiet

import fs from 'node:fs';
import path from 'node:path';
import { extractPdfText } from '../src/pdfText.js';
import { extractHtmlText } from '../src/htmlText.js';
import { parseInvoice, isRecognised } from '../src/parsers/index.js';
import { computedTotal, isBalanced } from '../src/totals.js';
import { round2 } from '../src/numbers.js';

const folder = process.argv[2] || 'input';
const quiet = process.argv.includes('--quiet');

const MIN_TEXT_LENGTH = 20;
const tally = new Map();
const problems = [];
let documents = 0;

for (const name of fs.readdirSync(folder).sort()) {
  const full = path.join(folder, name);
  if (!fs.statSync(full).isFile()) continue;

  const ext = path.extname(name).toLowerCase();
  if (!['.pdf', '.html', '.htm'].includes(ext)) continue;

  let text;
  try {
    text = ext === '.pdf' ? await extractPdfText(full) : extractHtmlText(full);
  } catch (err) {
    problems.push([name, `could not be read: ${err.message}`]);
    count('UNREADABLE');
    continue;
  }

  if (text.trim().length < MIN_TEXT_LENGTH) {
    count('SCANNED');
    continue;
  }

  const isHtml = ext !== '.pdf';
  if (isHtml && !isRecognised(text)) {
    count('SKIPPED (html, not an invoice)');
    continue;
  }

  try {
    for (const d of parseInvoice(text)) {
      documents += 1;
      count(`${d.issuer} - ${d.documentType}`);
      if (!isBalanced(d)) {
        problems.push([
          name,
          `${d.documentType} ${d.documentNumber || '(no number)'} does not add up: `
          + `${d.taxable} + ${d.nonTaxable} + ${d.igst} + ${d.cgst} + ${d.sgst} = ${computedTotal(d)}, `
          + `printed total ${d.total} (off by ${round2(d.total - computedTotal(d))})`,
        ]);
      }
      if (!d.documentNumber) problems.push([name, `${d.documentType} has no document number`]);
      if (!quiet && !d.pnr) problems.push([name, `${d.documentType} ${d.documentNumber} has no PNR`]);
    }
  } catch (err) {
    // Same rule the tool itself uses: an HTML file no parser can find a table
    // in is the covering e-mail, not the invoice.
    if (isHtml && (err.code === 'E03' || err.code === 'E04')) {
      count('SKIPPED (html, not an invoice)');
      continue;
    }
    problems.push([name, `[${err.code || 'E99'}] ${err.message}`]);
    count(`FAILED ${err.code || 'E99'}`);
  }
}

function count(key) {
  tally.set(key, (tally.get(key) || 0) + 1);
}

console.log(`\nFolder: ${folder}`);
console.log(`Documents parsed: ${documents}\n`);
for (const [key, n] of [...tally].sort()) {
  console.log(`  ${String(n).padStart(4)}  ${key}`);
}

if (problems.length > 0) {
  console.log(`\n${problems.length} thing(s) to look at:\n`);
  for (const [name, why] of problems) console.log(`  ${name}\n      ${why}`);
} else {
  console.log('\nEvery document read cleanly and added up.');
}
console.log('');
