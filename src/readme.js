import fs from 'node:fs';
import path from 'node:path';
import {
  INVOICE_SHEET,
  CREDIT_NOTE_SHEET,
  SCANNED_SHEET,
  VERIFICATION_SHEET,
  SCANNED_PDF_DIR,
} from './config.js';
import { ERROR_CODES } from './errors.js';
import { SUPPORTED_ISSUERS } from './parsers/index.js';

const README_NAME = 'READ ME.txt';

// Written into the output folder every run, so whoever opens the folder next has
// the answer to "what is all this?" without asking anyone.
export function writeReadme(summary, outputDir, workbookName, logName) {
  const line = '='.repeat(64);
  const out = [];
  const say = (s = '') => out.push(s);

  say(line);
  say('  WHAT IS IN THIS FOLDER');
  say(line);
  say();
  say(`  Last run: ${summary.runDate.toLocaleString()}`);
  say(`  ${summary.total} file(s) read from the input folder,`);
  say(`  holding ${summary.documents} document(s) between them.`);
  say();

  say(line);
  say('  THE FILES');
  say(line);
  say();
  say(`  ${workbookName}`);
  say('      The Excel file. This is the one you work from.');
  say('      A new one is made every run - the name is the date and time,');
  say('      so nothing you already have is ever overwritten.');
  say();

  if (logName) {
    say(`  ${logName}`);
    say('      A plain-text list of anything that needs a person to look at it.');
    say('      Same information as the Verification sheet, in a form you can');
    say('      email or print. If a run is completely clean, no log is made.');
    say();
  }

  if (summary.scanned > 0) {
    say(`  ${SCANNED_PDF_DIR}\\`);
    say(`      ${summary.scanned} PDF(s) that are pictures of a page rather than text.`);
    say('      Their amounts cannot be read by any tool, so a copy of each one');
    say(`      is put here for you to open and type in. In the "${SCANNED_SHEET}"`);
    say('      sheet, clicking a file name opens the PDF from this folder.');
    say();
  }

  say(line);
  say('  THE SHEETS INSIDE THE EXCEL FILE');
  say(line);
  say();
  say(`  1. ${INVOICE_SHEET}`);
  say(`      Your normal invoices, plus any debit notes. ${count(summary.invoices)}`);
  say();
  say('      "RIYA INVOICE NO" is left empty on purpose - it comes from');
  say('      your own booking system, not from the airline, so it is');
  say('      yours to fill in. The last column has no heading and is');
  say('      spare.');
  say();
  say('      "TOTAL" and "K3 AMOUNT" are live formulas:');
  say('          K3 AMOUNT = IGST + CGST + SGST');
  say('          TOTAL     = Taxable + Non Taxable + K3 AMOUNT');
  say('      so they follow along if you correct a figure by hand.');
  say();
  say('      A dash means the airline does not print that on its');
  say('      invoice - not that the tool failed to read it. Singapore');
  say('      Airlines print no PNR, IndiGo print no ticket number, and');
  say('      several print no sector.');
  say();
  say(`  2. ${CREDIT_NOTE_SHEET}`);
  say('      Refunds, kept separate so they are never added in by');
  say(`      mistake. ${count(summary.creditNotes)} Same columns as ${INVOICE_SHEET}.`);
  say();
  say(`  3. ${SCANNED_SHEET}`);
  say('      The scanned PDFs. Same columns, but the amounts are blank');
  say(`      because they could not be read. ${count(summary.scanned)}`);
  say('      Type the figures in and the checks work themselves out.');
  say();
  say(`  4. ${VERIFICATION_SHEET}`);
  say('      Proof that every document was read correctly. One row per');
  say('      document. Start here if a number looks wrong.');
  say();

  say(line);
  say('  WHEN ONE FILE HOLDS SEVERAL DOCUMENTS');
  say(line);
  say();
  say('  Some airlines put an invoice, a debit note against it and a credit');
  say('  note against it all in the same PDF, and some send a run of');
  say('  invoices one after another in one file.');
  say();
  say('  Each of those is a document in its own right with its own number,');
  say('  so each gets its own row and goes to the sheet it belongs on - the');
  say(`  credit note to "${CREDIT_NOTE_SHEET}", the rest to "${INVOICE_SHEET}".`);
  say();
  say('  The "PDF NO" column shows the same file name on each of those rows,');
  say(`  because they did all come out of the one file. In the ${VERIFICATION_SHEET}`);
  say('  sheet the "Doc" column says which one it is - "2 of 3" and so on.');
  say();

  say(line);
  say('  HOW TO CHECK A RUN IN 30 SECONDS');
  say(line);
  say();
  say(`  Open the ${VERIFICATION_SHEET} sheet and read the box at the top.`);
  say('  If these three lines all say 0, the run was clean:');
  say();
  say('      Rows that do NOT add up');
  say('      Duplicate invoice numbers');
  say('      Files that could not be read');
  say();
  say('  Anything above 0 is listed further down the same sheet. Use the');
  say('  filter on the "Status" column to find them:');
  say();
  say('      OK             read cleanly, and the amounts add up');
  say('      SCANNED        a picture - type the amounts in by hand');
  say('      SKIPPED        not an invoice - a covering e-mail. Nothing to do.');
  say('      CHECK TOTALS   the amounts do NOT add up - check this invoice');
  say('      DUPLICATE      this invoice number is on more than one document');
  say('      FAILED         the file could not be read at all');
  say();
  say('  The "Details" column says what is wrong, in plain words. It is');
  say('  blank when there is nothing to worry about.');
  say();

  say(line);
  say('  WHICH AIRLINES ARE READ');
  say(line);
  say();
  for (const name of SUPPORTED_ISSUERS) say(`      ${name}`);
  say();
  say('  Both PDF and HTML invoices are read. An HTML file that turns out to');
  say('  be the covering e-mail rather than the invoice is passed over and');
  say('  marked SKIPPED - it is not a failure and there is nothing to do.');
  say();
  say('  An invoice from any other airline is reported as [E03]. Adding one');
  say('  means a new parser in src/parsers/.');
  say();

  say(line);
  say('  ERROR CODES');
  say(line);
  say();
  say('  Anything that goes wrong is tagged with a code such as [E02].');
  say('  The code appears on screen, in the Details column and in the log,');
  say('  and it always means the same thing:');
  say();
  for (const [code, entry] of Object.entries(ERROR_CODES)) {
    say(`  ${code}  ${entry.meaning}`);
    say(`       ${entry.fix}`);
    say();
  }
  say('  A CRASH_....log file means the tool itself has a bug. Send that');
  say('  file on - it names the exact line of code that failed.');
  say();

  say(line);
  say('  WHAT "ADDS UP" MEANS');
  say(line);
  say();
  say('  Every invoice has to satisfy:');
  say();
  say('      Taxable + Non Taxable + IGST + CGST + SGST  =  Total');
  say();
  say('  The tool checks this on every row against the total printed on');
  say('  the document. "Adds Up? = YES" means the figures were read');
  say('  correctly. In the Excel sheets the last column does the same check');
  say('  live, so it keeps working if you edit an amount by hand.');
  say();

  say(line);
  say();
  say('  This file is rewritten every run. There is nothing to keep here -');
  say('  delete anything you are finished with.');
  say();

  const target = path.join(outputDir, README_NAME);
  try {
    fs.writeFileSync(target, out.join('\r\n'), 'utf8');
    return target;
  } catch {
    return null;
  }
}

function count(n) {
  if (n === undefined) return '';
  return n === 1 ? '(1 row.)' : `(${n} rows.)`;
}
