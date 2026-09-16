/**
 * PDF invoice -> Excel.
 *
 * Reads every PDF in ./input (including sub-folders), pulls the GST figures
 * out of each one, and writes a workbook into ./output in the master layout.
 *
 * Some airline PDFs are scans -- a picture of a page with no text inside. The
 * figures on those cannot be read, so they are listed on their own sheet, ready
 * to be keyed in by hand, instead of being guessed at.
 *
 * Nothing stops the run: a PDF that cannot be read is reported, listed on the
 * Verification sheet and written to a log file, and the remaining files are
 * still processed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { INPUT_DIR, OUTPUT_DIR, SCANNED_PDF_DIR } from './config.js';
import { UserError, ReadError, labelled, explain } from './errors.js';
import { nowReading, writeCrashReport, crashReportPath } from './crash.js';
import { extractPdfText } from './pdfText.js';
import { parseInvoice, SUPPORTED_ISSUERS } from './parsers/index.js';
import { computedTotal, isBalanced, TOLERANCE } from './totals.js';
import { round2 } from './numbers.js';
import { writeWorkbook } from './excel.js';
import { collectScannedPdfs } from './collectScans.js';
import { writeReadme } from './readme.js';

// In source form this file lives in src/; once bundled it sits in the project
// root next to run.bat. Both layouts must find the same input/ and output/.
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.basename(SCRIPT_DIR).toLowerCase() === 'src'
  ? path.resolve(SCRIPT_DIR, '..')
  : SCRIPT_DIR;

// run.bat passes nothing and gets the standard input/ and output/ folders.
// Other folders can be given on the command line for a one-off spot-check:
//   node src\index.js "D:\some\pdfs" "D:\some\results"
const [argInput, argOutput] = process.argv.slice(2);
const inputDir = path.resolve(PROJECT_ROOT, argInput || INPUT_DIR);
const outputDir = path.resolve(PROJECT_ROOT, argOutput || OUTPUT_DIR);

/**
 * Colour is used only to make a problem jump out of a long run. It is switched
 * off unless the console really supports it, so nothing is ever littered with
 * escape codes.
 */
const ESC = String.fromCharCode(27);
const COLOUR = Boolean(process.stdout.isTTY && process.stdout.hasColors && process.stdout.hasColors());
const red = (s) => (COLOUR ? `${ESC}[31m${s}${ESC}[39m` : s);
const yellow = (s) => (COLOUR ? `${ESC}[33m${s}${ESC}[39m` : s);
const bold = (s) => (COLOUR ? `${ESC}[1m${s}${ESC}[22m` : s);

/** A PDF with less text than this is a scan, not a readable document. */
const MIN_TEXT_LENGTH = 20;

process.on('uncaughtException', (err) => stop(err));
process.on('unhandledRejection', (err) => stop(err));

main().catch(stop);

/** Last stop for anything that goes wrong. Never throws itself. */
function stop(err) {
  console.error('');
  if (err instanceof UserError) {
    console.error(red(`  ERROR [${err.code}]  ${err.message}`));
    const help = explain([err.code]);
    if (help.length > 0) {
      console.error('');
      for (const line of help) console.error(line);
    }
  } else {
    const report = writeCrashReport(err, outputDir);
    console.error(red('  ERROR [E99]  The tool hit an unexpected problem and stopped.'));
    console.error('');
    console.error(`               ${(err && err.message) || String(err)}`);
    console.error('');
    if (report) {
      console.error('               A full report has been saved to:');
      console.error(`                 ${report}`);
      console.error('               Send that file to whoever maintains the tool.');
    } else {
      console.error('  ' + ((err && err.stack) || String(err)));
    }
  }
  console.error('');
  process.exitCode = 1;
}

async function main() {
  const startedAt = Date.now();
  banner();

  const files = collectPdfs(inputDir);
  if (files.length === 0) {
    console.log(`No PDF files found in "${inputDir}".`);
    console.log('Put your PDFs in the input folder and run this again.');
    return;
  }

  fs.mkdirSync(outputDir, { recursive: true });

  console.log(`Found ${files.length} PDF file(s) in "${inputDir}".`);
  console.log('');

  const records = [];
  const summary = {
    total: files.length,
    parsed: 0,
    scanned: 0,
    failed: 0,
    unbalanced: 0,
    duplicates: 0,
    runDate: new Date(),
  };

  for (let i = 0; i < files.length; i += 1) {
    const record = await processFile(files[i]);
    records.push(record);

    if (record.status === 'FAILED') summary.failed += 1;
    else if (record.status === 'SCANNED') summary.scanned += 1;
    else summary.parsed += 1;
    if (record.data && !record.balanced) summary.unbalanced += 1;

    reportProgress(i + 1, files.length, record);
  }

  summary.duplicates = flagDuplicates(records);
  summary.creditNotes = records.filter((r) => r.data && r.data.documentType === 'CREDIT NOTE').length;
  summary.invoices = summary.parsed - summary.creditNotes;

  // Copy the scans somewhere the workbook can link to before it is written.
  const scanFolder = collectScannedPdfs(records, inputDir, outputDir);
  summary.scanFolder = scanFolder.dir;

  const stamp = timestamp(summary.runDate);
  const outputPath = await saveWorkbook(records, summary, stamp);

  const logPath = writeErrorLog(records, stamp);
  const readmePath = writeReadme(summary, outputDir, path.basename(outputPath), logPath && path.basename(logPath));
  printSummary(summary, outputPath, logPath, readmePath, scanFolder, records, Date.now() - startedAt);
}

/**
 * Read one PDF and turn it into a result record. Never throws.
 * @param {string} filePath
 */
async function processFile(filePath) {
  const file = path.relative(inputDir, filePath);
  const stem = path.parse(filePath).name;

  const record = {
    file,
    pdfNo: stem,
    invoiceNo: '',
    scanCopy: '',
    code: '',
    status: 'OK',
    details: '',
    data: null,
    computed: 0,
    difference: 0,
    balanced: false,
  };

  nowReading(file);

  let text = '';
  try {
    const stat = fs.statSync(filePath);
    if (stat.size === 0) {
      return fail(record, 'The file is empty (0 bytes).', 'E01');
    }
    text = await extractPdfText(filePath);
  } catch (err) {
    return fail(record, err.message, noteIfBug(err));
  }

  // A scan carries no text at all. Its figures cannot be read, so the file is
  // set aside for manual entry rather than guessed at.
  if (text.trim().length < MIN_TEXT_LENGTH) {
    record.status = 'SCANNED';
    record.details = 'Scanned image - no text to read. Enter the amounts by hand.';
    return record;
  }

  let data;
  try {
    data = parseInvoice(text);
  } catch (err) {
    return fail(record, err.message, noteIfBug(err));
  }

  const notes = [];

  record.data = data;
  record.invoiceNo = data.documentNumber;
  record.computed = computedTotal(data);
  record.difference = round2(data.total - record.computed);
  record.balanced = isBalanced(data);

  if (!data.documentNumber) {
    record.status = 'NO INVOICE NO.';
    notes.push('No invoice number could be found on the page; only the file name is available.');
  } else if (data.documentNumber !== stem) {
    notes.push(
      `The invoice number on the page ("${data.documentNumber}") is not the same as the file name ("${stem}").`
    );
  }

  if (!record.balanced) {
    record.status = 'CHECK TOTALS';
    record.code = 'E06';
    notes.push(
      `[E06] The amounts do not add up: Taxable ${data.taxable} + Non Taxable ${data.nonTaxable} + IGST ${data.igst} ` +
      `+ CGST ${data.cgst} + SGST ${data.sgst} = ${record.computed}, but the PDF total is ${data.total} ` +
      `(off by ${record.difference}). Check this invoice by hand.`
    );
  }

  // Details is for things a person has to act on. Which sheet a credit note
  // landed on is already obvious from the Document Type column and the sheet
  // it is sitting on, so it is not repeated here.
  if (data.discount) {
    notes.push(`Carries a discount of ${data.discount}, deducted from the non-taxable amount.`);
  }

  record.details = notes.join(' ');
  return record;
}

/**
 * Write the workbook, working around a name that is already taken.
 *
 * If a workbook from an earlier run this minute is open in Excel, Windows will
 * not let it be overwritten. Rather than throw away a completed run over that,
 * the next free name is used.
 *
 * @returns {Promise<string>} the path actually written
 */
async function saveWorkbook(records, summary, stamp) {
  const MAX_ATTEMPTS = 20;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const suffix = attempt === 1 ? '' : ` (${attempt})`;
    const target = path.join(outputDir, `Invoice_Extract_${stamp}${suffix}.xlsx`);
    try {
      await writeWorkbook(records, summary, target);
      if (attempt > 1) {
        console.log(`  Note: an earlier workbook was open, so this run was saved as "${path.basename(target)}".`);
      }
      return target;
    } catch (err) {
      const locked = err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES';
      if (!locked) {
        throw new UserError(`Could not write the Excel file "${target}": ${err.message}`, 'E07');
      }
      if (attempt === MAX_ATTEMPTS) {
        throw new UserError(
          `Could not write the Excel file into "${outputDir}" - every name tried was locked.\n` +
          '  Fix: close any open workbooks in Excel and run this again.'
        );
      }
    }
  }

  throw new UserError(`Could not write the Excel file into "${outputDir}".`, 'E07');
}

/**
 * Classify a fault raised while reading one PDF.
 *
 * A ReadError is an understood problem with that file. Anything else is a bug
 * in the tool, and its stack trace is the only way to find it later -- so a
 * crash report is written the first time one appears.
 */
function noteIfBug(err) {
  if (err instanceof ReadError) return err.code;
  writeCrashReport(err, outputDir);
  return 'E99';
}

function fail(record, message, code) {
  record.status = 'FAILED';
  record.code = code;
  record.details = labelled(code, message);
  return record;
}

/**
 * Note any invoice number that turns up on more than one PDF.
 *
 * It normally means the same invoice was copied into the input folder twice,
 * which would otherwise be billed twice on the output sheet.
 * @returns {number} how many files are part of a duplicate set
 */
function flagDuplicates(records) {
  const seen = new Map();
  for (const r of records) {
    if (r.status === 'FAILED') continue;
    const key = (r.invoiceNo || r.pdfNo).toUpperCase();
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(r);
  }

  let count = 0;
  for (const [number, group] of seen) {
    if (group.length < 2) continue;
    count += group.length;
    const names = group.map((r) => r.file);
    for (const r of group) {
      const rest = names.filter((f) => f !== r.file);
      r.details = [
        r.details,
        `Invoice number ${number} also appears on: ${rest.join(', ')}. ` +
        'Check whether the same invoice was added more than once.',
      ].filter(Boolean).join(' ');
      if (r.status === 'OK') r.status = 'DUPLICATE';
    }
  }
  return count;
}

/** Every PDF under a folder, recursively, sorted by name. */
function collectPdfs(dir) {
  if (!fs.existsSync(dir)) {
    throw new UserError(
      `The input folder is missing. Expected "${dir}".`,
      'E08'
    );
  }

  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) out.push(full);
    }
  };
  walk(dir);
  return out.sort((a, b) => a.localeCompare(b));
}


/**
 * Say only what a person watching needs: a moving progress count, and the
 * handful of files that go wrong. Scans are counted, not listed one by one --
 * the summary and the workbook already carry the full list.
 */
function reportProgress(done, total, record) {
  const width = String(total).length;

  if (record.status === 'FAILED' || record.status === 'CHECK TOTALS') {
    const reason = record.status === 'FAILED'
      ? record.details
      : `amounts do not add up (off by ${record.difference})`;
    if (process.stdout.isTTY) process.stdout.write(`\r${' '.repeat(30)}\r`);
    const tag = record.status === 'FAILED' ? red(bold('FAILED')) : yellow(bold('CHECK '));
    console.log(`  ${tag}  ${record.file}`);
    console.log(`          ${reason}`);
    return;
  }

  // In a console window one line is rewritten in place. When the output is
  // piped to a file or another program there is no cursor to move, so a
  // carriage return would run everything together on one line -- there, print
  // far less often and end each line properly.
  if (process.stdout.isTTY) {
    if (done % 25 === 0 || done === total) {
      const suffix = done === total ? '\n' : '';
      process.stdout.write(`\r  Reading... ${String(done).padStart(width)} of ${total}${suffix}`);
    }
  } else if (done % 250 === 0 || done === total) {
    console.log(`  Reading... ${String(done).padStart(width)} of ${total}`);
  }
}

/** Write a plain-text log of everything that needs a human, if anything does. */
function writeErrorLog(records, stamp) {
  const problems = records.filter(
    (r) => r.status === 'FAILED' || r.status === 'SCANNED' || (r.data && !r.balanced)
  );
  if (problems.length === 0) return null;

  const logPath = path.join(outputDir, `Errors_${stamp}.log`);
  const lines = [
    `PDF to Excel - items needing attention, ${new Date().toLocaleString()}`,
    `${problems.length} of ${records.length} file(s) need attention.`,
  ];

  // Group by what is wrong, so a hundred identical scans read as one heading
  // and a list of names rather than a hundred repeated paragraphs.
  const byStatus = new Map();
  for (const r of problems) {
    if (!byStatus.has(r.status)) byStatus.set(r.status, []);
    byStatus.get(r.status).push(r);
  }

  for (const [status, group] of byStatus) {
    lines.push('', `${status} (${group.length})`, '-'.repeat(status.length + 6));
    const shared = group.every((r) => r.details === group[0].details);
    if (shared && group.length > 1) {
      lines.push(group[0].details, '');
      for (const r of group) lines.push(`   ${r.file}`);
    } else {
      for (const r of group) {
        lines.push(`   ${r.file}`);
        lines.push(`      ${r.details}`);
      }
    }
  }
  const help = explain(problems.map((r) => r.code));
  if (help.length > 0) {
    lines.push('', 'WHAT THE CODES MEAN', '-'.repeat(19), '');
    lines.push(...help);
  }
  lines.push('');

  try {
    fs.writeFileSync(logPath, lines.join('\r\n'), 'utf8');
    return logPath;
  } catch (err) {
    console.warn(`Warning: could not write the error log (${err.message}).`);
    return null;
  }
}

function printSummary(summary, outputPath, logPath, readmePath, scanFolder, records, elapsedMs) {
  const line = '-'.repeat(64);
  console.log('');
  console.log(line);
  console.log('  DONE');
  console.log(line);
  console.log(`  PDF files found              : ${summary.total}`);
  console.log(`  Read successfully            : ${summary.parsed}`);
  console.log(`  Scanned - need manual entry  : ${summary.scanned}`);
  console.log(`  Rows that do NOT add up      : ${summary.unbalanced}`);
  console.log(`  Duplicate invoice numbers    : ${summary.duplicates}`);
  console.log(`  Files that could not be read : ${summary.failed}`);
  console.log(`  Time taken                   : ${(elapsedMs / 1000).toFixed(1)}s`);
  console.log(line);
  console.log(`  Excel file : ${path.basename(outputPath)}`);
  if (scanFolder.dir) console.log(`  Scans      : ${SCANNED_PDF_DIR}\\`);
  if (logPath) console.log(`  Error log  : ${path.basename(logPath)}`);
  if (readmePath) console.log(`  Guide      : ${path.basename(readmePath)}  (explains these files)`);
  console.log(`  Folder     : ${outputDir}`);
  console.log(line);

  // Only mention what actually happened; a wall of zeroes tells you nothing.
  const notes = [];
  if (summary.scanned > 0) {
    notes.push(`${summary.scanned} scanned PDF(s) had no text. Enter their amounts on the "Scanned PDFs" sheet;`);
    notes.push(`a copy of each is in "${SCANNED_PDF_DIR}", and the file names in the workbook open them.`);
  }
  if (scanFolder.failed > 0) {
    notes.push(`${scanFolder.failed} scan(s) could not be copied - see the Verification sheet.`);
  }
  if (summary.unbalanced > 0) {
    notes.push(`${summary.unbalanced} row(s) do not add up by more than ${TOLERANCE} - marked "CHECK TOTALS".`);
  }
  if (summary.duplicates > 0) {
    notes.push(`${summary.duplicates} file(s) share an invoice number - marked "DUPLICATE".`);
  }
  if (summary.failed > 0) {
    notes.push(`${summary.failed} file(s) could not be read at all:`);
    for (const r of records.filter((x) => x.status === 'FAILED')) {
      notes.push(`  - ${r.file}: ${r.details}`);
    }
    notes.push(`This tool reads invoices from: ${SUPPORTED_ISSUERS.join(', ')}.`);
    const report = crashReportPath();
    if (report) {
      notes.push(`A crash report with the technical detail is in: ${path.basename(report)}`);
    }
  }

  if (notes.length > 0) {
    console.log('');
    for (const note of notes) console.log('  ' + note);
  }

  const help = explain(records.map((r) => r.code));
  if (help.length > 0) {
    console.log('');
    console.log('  What the codes mean:');
    for (const hl of help) console.log('  ' + hl);
  }

  console.log('');
}

function timestamp(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}`;
}

function banner() {
  console.log('');
  console.log('='.repeat(64));
  console.log('  PDF INVOICE -> EXCEL');
  console.log('='.repeat(64));
  console.log('');
}
