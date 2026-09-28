import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { INPUT_DIR, OUTPUT_DIR, SCANNED_PDF_DIR } from './config.js';
import { UserError, ReadError, labelled, explain } from './errors.js';
import { nowReading, writeCrashReport, crashReportPath } from './crash.js';
import { extractPdfText } from './pdfText.js';
import { extractHtmlText } from './htmlText.js';
import { parseInvoice, SUPPORTED_ISSUERS } from './parsers/index.js';
import { computedTotal, isBalanced, TOLERANCE } from './totals.js';
import { round2 } from './numbers.js';
import { writeWorkbook } from './excel.js';
import { collectScannedPdfs } from './collectScans.js';
import { writeReadme } from './readme.js';

// "input" and "output" sit beside the code, not inside it. Running from source
// the code is in src/, and in the folder that gets handed on it is in code/ -
// either way the folders to work on are one level up. Anywhere else, they are
// beside the file itself.
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const NESTED = ['src', 'code'];
const PROJECT_ROOT = NESTED.includes(path.basename(SCRIPT_DIR).toLowerCase())
  ? path.resolve(SCRIPT_DIR, '..')
  : SCRIPT_DIR;

const [argInput, argOutput] = process.argv.slice(2);
const inputDir = path.resolve(PROJECT_ROOT, argInput || INPUT_DIR);
const outputDir = path.resolve(PROJECT_ROOT, argOutput || OUTPUT_DIR);

const ESC = String.fromCharCode(27);
const COLOUR = Boolean(process.stdout.isTTY && process.stdout.hasColors && process.stdout.hasColors());
const red = (s) => (COLOUR ? `${ESC}[31m${s}${ESC}[39m` : s);
const yellow = (s) => (COLOUR ? `${ESC}[33m${s}${ESC}[39m` : s);
const bold = (s) => (COLOUR ? `${ESC}[1m${s}${ESC}[22m` : s);

// Below this much text a PDF is a picture of a page rather than a page.
const MIN_TEXT_LENGTH = 20;

const PDF = '.pdf';
const HTML = ['.html', '.htm'];
const READABLE = [PDF, ...HTML];

process.on('uncaughtException', (err) => stop(err));
process.on('unhandledRejection', (err) => stop(err));

main().catch(stop);

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

  const files = collectInputFiles(inputDir);
  if (files.length === 0) {
    console.log(`No PDF or HTML files found in "${inputDir}".`);
    console.log('Put your invoices in the input folder and run this again.');
    return;
  }

  fs.mkdirSync(outputDir, { recursive: true });
  console.log(`Found ${files.length} file(s) in "${inputDir}".`);
  console.log('');

  const records = [];
  const summary = {
    total: files.length,
    documents: 0,
    parsed: 0,
    scanned: 0,
    skipped: 0,
    failed: 0,
    unbalanced: 0,
    duplicates: 0,
    runDate: new Date(),
  };

  for (let i = 0; i < files.length; i += 1) {
    // One file can hold several documents - an invoice with a debit note and a
    // credit note against it - and each of those is a row of its own.
    const fromFile = await processFile(files[i]);
    records.push(...fromFile);

    for (const record of fromFile) {
      if (record.status === 'FAILED') summary.failed += 1;
      else if (record.status === 'SCANNED') summary.scanned += 1;
      else if (record.status === 'SKIPPED') summary.skipped += 1;
      else summary.parsed += 1;
      if (record.data && !record.balanced) summary.unbalanced += 1;
    }

    reportProgress(i + 1, files.length, fromFile);
  }

  summary.documents = records.filter((r) => r.data).length;
  summary.duplicates = flagDuplicates(records);
  summary.creditNotes = records.filter((r) => r.data && r.data.documentType === 'CREDIT NOTE').length;
  summary.invoices = summary.documents - summary.creditNotes;

  const scanFolder = collectScannedPdfs(records, inputDir, outputDir);
  summary.scanFolder = scanFolder.dir;

  const stamp = timestamp(summary.runDate);
  const outputPath = await saveWorkbook(records, summary, stamp);
  const logPath = writeErrorLog(records, stamp);
  const readmePath = writeReadme(summary, outputDir, path.basename(outputPath), logPath && path.basename(logPath));

  printSummary(summary, outputPath, logPath, readmePath, scanFolder, records, Date.now() - startedAt);
}

// Returns one record per document found in the file, or a single record saying
// why nothing could be read from it.
async function processFile(filePath) {
  const file = path.relative(inputDir, filePath);
  const stem = path.parse(filePath).name;
  const isHtml = HTML.includes(path.extname(filePath).toLowerCase());

  nowReading(file);

  let text = '';
  try {
    const stat = fs.statSync(filePath);
    if (stat.size === 0) {
      return [fail(blank(file, stem), 'The file is empty (0 bytes).', 'E01')];
    }
    text = isHtml ? extractHtmlText(filePath) : await extractPdfText(filePath);
  } catch (err) {
    return [fail(blank(file, stem), err.message, noteIfBug(err))];
  }

  if (text.trim().length < MIN_TEXT_LENGTH) {
    const record = blank(file, stem);
    if (isHtml) return [skip(record, 'The file holds no text to read.')];
    record.status = 'SCANNED';
    record.details = 'Scanned image - no text to read. Enter the amounts by hand.';
    return [record];
  }

  let documents;
  try {
    documents = parseInvoice(text);
  } catch (err) {
    // Airlines send the invoice as an attachment to an ordinary e-mail, and the
    // e-mail itself often gets saved into the input folder beside it. It names
    // the airline but holds no amounts, so there is nothing to read and nothing
    // wrong - it is passed over rather than reported as a failure.
    if (isHtml && (err.code === 'E03' || err.code === 'E04')) {
      return [skip(blank(file, stem), 'Not an invoice - no amounts table on the page.')];
    }
    return [fail(blank(file, stem), err.message, noteIfBug(err))];
  }

  return documents.map((data, index) => {
    const record = blank(file, stem);
    record.part = index + 1;
    record.partsInFile = documents.length;
    record.data = data;
    record.invoiceNo = data.documentNumber;
    record.pnr = data.pnr || '';
    record.computed = computedTotal(data);
    record.difference = round2(data.total - record.computed);
    record.balanced = isBalanced(data);

    const notes = [];

    if (!data.documentNumber) {
      record.status = 'NO INVOICE NO.';
      notes.push('No invoice number could be found on the page; only the file name is available.');
    } else if (documents.length === 1 && namesAnInvoice(stem) && data.documentNumber !== invoiceNumberIn(stem)) {
      notes.push(
        `The invoice number on the page ("${data.documentNumber}") is not the same as the file name ("${stem}").`,
      );
    }

    if (!record.balanced) {
      record.status = 'CHECK TOTALS';
      record.code = 'E06';
      notes.push(
        `[E06] The amounts do not add up: Taxable ${data.taxable} + Non Taxable ${data.nonTaxable} + IGST ${data.igst} + CGST ${data.cgst} + SGST ${data.sgst} = ${record.computed}, but the document total is ${data.total} (off by ${record.difference}). Check this invoice by hand.`,
      );
    }

    if (data.discount) {
      notes.push(`Carries a discount of ${data.discount}, already taken off the taxable amount.`);
    }
    if (data.cess) {
      notes.push(`Carries a cess of ${data.cess}, included in the non-taxable amount because the sheet has no cess column.`);
    }
    if (documents.length > 1) {
      notes.push(`This file holds ${documents.length} documents; this is number ${index + 1} of them.`);
    }

    record.details = notes.join(' ');
    return record;
  });
}

function blank(file, stem) {
  return {
    file,
    pdfNo: stem,
    part: 1,
    partsInFile: 1,
    invoiceNo: '',
    pnr: '',
    scanCopy: '',
    code: '',
    status: 'OK',
    details: '',
    data: null,
    computed: 0,
    difference: 0,
    balanced: false,
  };
}

// Most airlines are sent with the invoice number as the file name, and a
// mismatch is worth knowing about. Others name the file after the passenger or
// the booking, where a mismatch means nothing - so the check is only made when
// the name looks like it was meant to be an invoice number in the first place.
function namesAnInvoice(stem) {
  return /^[A-Z0-9]{8,}$/i.test(invoiceNumberIn(stem));
}

function invoiceNumberIn(stem) {
  return stem.replace(/^(?:Tax\s*)?Invoice[-_ ]?/i, '');
}

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
          `Could not write the Excel file into "${outputDir}" - every name tried was locked.\n  Fix: close any open workbooks in Excel and run this again.`,
          'E07',
        );
      }
    }
  }
  throw new UserError(`Could not write the Excel file into "${outputDir}".`, 'E07');
}

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

function skip(record, why) {
  record.status = 'SKIPPED';
  record.details = why;
  return record;
}

function flagDuplicates(records) {
  const seen = new Map();
  for (const r of records) {
    if (r.status === 'FAILED' || r.status === 'SKIPPED') continue;
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
        `Invoice number ${number} also appears on: ${rest.join(', ')}. Check whether the same invoice was added more than once.`,
      ].filter(Boolean).join(' ');
      if (r.status === 'OK') r.status = 'DUPLICATE';
    }
  }
  return count;
}

function collectInputFiles(dir) {
  if (!fs.existsSync(dir)) {
    throw new UserError(`The input folder is missing. Expected "${dir}".`, 'E08');
  }

  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && READABLE.includes(path.extname(entry.name).toLowerCase())) out.push(full);
    }
  };
  walk(dir);
  return out.sort((a, b) => a.localeCompare(b));
}

function reportProgress(done, total, fromFile) {
  const width = String(total).length;

  const notable = fromFile.filter((r) => r.status === 'FAILED' || r.status === 'CHECK TOTALS');
  if (notable.length > 0) {
    if (process.stdout.isTTY) process.stdout.write(`\r${' '.repeat(30)}\r`);
    for (const record of notable) {
      const reason = record.status === 'FAILED'
        ? record.details
        : `amounts do not add up (off by ${record.difference})`;
      const tag = record.status === 'FAILED' ? red(bold('FAILED')) : yellow(bold('CHECK '));
      console.log(`  ${tag}  ${record.file}`);
      console.log(`          ${reason}`);
    }
    return;
  }

  if (process.stdout.isTTY) {
    if (done % 25 === 0 || done === total) {
      const suffix = done === total ? '\n' : '';
      process.stdout.write(`\r  Reading... ${String(done).padStart(width)} of ${total}${suffix}`);
    }
  } else if (done % 250 === 0 || done === total) {
    console.log(`  Reading... ${String(done).padStart(width)} of ${total}`);
  }
}

function writeErrorLog(records, stamp) {
  const problems = records.filter(
    (r) => r.status === 'FAILED' || r.status === 'SCANNED' || (r.data && !r.balanced),
  );
  if (problems.length === 0) return null;

  const logPath = path.join(outputDir, `Errors_${stamp}.log`);
  const lines = [
    `PDF to Excel - items needing attention, ${new Date().toLocaleString()}`,
    `${problems.length} of ${records.length} document(s) need attention.`,
  ];

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
  console.log(`  Files found                  : ${summary.total}`);
  console.log(`  Documents read               : ${summary.documents}`);
  console.log(`  Scanned - need manual entry  : ${summary.scanned}`);
  console.log(`  Passed over - not invoices   : ${summary.skipped}`);
  console.log(`  Rows that do NOT add up      : ${summary.unbalanced}`);
  console.log(`  Duplicate invoice numbers    : ${summary.duplicates}`);
  console.log(`  Files that could not be read : ${summary.failed}`);
  console.log(`  Time taken                   : ${(elapsedMs / 1e3).toFixed(1)}s`);
  console.log(line);
  console.log(`  Excel file : ${path.basename(outputPath)}`);
  if (scanFolder.dir) console.log(`  Scans      : ${SCANNED_PDF_DIR}\\`);
  if (logPath) console.log(`  Error log  : ${path.basename(logPath)}`);
  if (readmePath) console.log(`  Guide      : ${path.basename(readmePath)}  (explains these files)`);
  console.log(`  Folder     : ${outputDir}`);
  console.log(line);

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
    notes.push(`${summary.duplicates} document(s) share an invoice number - marked "DUPLICATE".`);
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
