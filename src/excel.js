/**
 * Builds the output workbook.
 *
 * Sheet1        tax invoices and debit notes, in the master 14-column layout
 * Credit Notes  credit notes, same layout
 * Scanned PDFs  scans whose figures could not be read, same layout, amounts
 *               left blank for manual entry
 * Verification  one row per PDF: what was read, whether it adds up, and why not
 *
 * Columns C, M and N are live formulas, exactly as in the master sheet, so the
 * arithmetic keeps working if anyone edits an amount by hand -- which is what
 * makes the Scanned PDFs sheet usable: type the figures in and the checks run
 * themselves.
 *   C = D+E+F      the K3 tax total
 *   M = H+I+C      taxable + non-taxable + tax
 *   N = G=M        TRUE when the invoice total agrees with the parts
 */

import ExcelJS from 'exceljs';
import {
  HEADERS,
  INVOICE_SHEET,
  CREDIT_NOTE_SHEET,
  SCANNED_SHEET,
  VERIFICATION_SHEET,
  SCANNED_PDF_DIR,
  LOCATION,
  DATE_FORMAT,
  AMOUNT_FORMAT,
} from './config.js';
import { round2 } from './numbers.js';

const HEADER_FILL = 'FFD9E1F2';
const BAD_FILL = 'FFFFC7CE';
const WARN_FILL = 'FFFFEB9C';
const GOOD_FILL = 'FFC6EFCE';
const LINK_FONT = { color: { argb: 'FF0563C1' }, underline: true };

/**
 * A cell that opens the PDF when clicked.
 *
 * The path is relative to the workbook, so the whole output folder can be
 * moved, copied or emailed on and the links still find their files.
 *
 * @param {string} text what the cell shows
 * @param {string} target path to the PDF, relative to the workbook
 */
function pdfLink(text, target) {
  return { text, hyperlink: target.split('/').map(encodeURIComponent).join('/') };
}

/**
 * What the Verification sheet shows.
 *
 * Only what is needed to prove a row was read correctly: which file, which
 * invoice, the figures, and whether they add up. Traveller details and the
 * file name repeated a second time were dropped as noise.
 */
const VERIFICATION_COLUMNS = [
  { header: 'File Name', key: 'file', width: 26 },
  { header: 'Invoice No.', key: 'invoiceNo', width: 22 },
  { header: 'Airline', key: 'issuer', width: 30 },
  { header: 'Document Type', key: 'docType', width: 15 },
  { header: 'Document Date', key: 'docDate', width: 14 },
  { header: 'Taxable', key: 'taxable', width: 12, amount: true },
  { header: 'Non Taxable', key: 'nonTaxable', width: 12, amount: true },
  { header: 'IGST', key: 'igst', width: 10, amount: true },
  { header: 'CGST', key: 'cgst', width: 10, amount: true },
  { header: 'SGST', key: 'sgst', width: 10, amount: true },
  { header: 'Total on PDF', key: 'total', width: 13, amount: true },
  { header: 'Total Computed', key: 'computed', width: 14, amount: true },
  { header: 'Difference', key: 'difference', width: 11, amount: true },
  { header: 'Adds Up?', key: 'balanced', width: 10 },
  { header: 'Status', key: 'status', width: 15 },
  { header: 'Details', key: 'details', width: 80 },
];

const STATUS_COLUMN = VERIFICATION_COLUMNS.findIndex((c) => c.key === 'status') + 1;
const DIFFERENCE_COLUMN = VERIFICATION_COLUMNS.findIndex((c) => c.key === 'difference') + 1;

/**
 * @param {object[]} records one entry per PDF (see src/index.js)
 * @param {object} summary counts for the header block
 * @param {string} filePath where to write the .xlsx
 */
export async function writeWorkbook(records, summary, filePath) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'PDF Invoice to Excel';
  workbook.created = new Date();

  const readable = records.filter((r) => r.data);
  const creditNotes = readable.filter((r) => r.data.documentType === 'CREDIT NOTE');
  const invoices = readable.filter((r) => r.data.documentType !== 'CREDIT NOTE');
  const scans = records.filter((r) => r.status === 'SCANNED');

  // The UPDATED DATE column is a plain date, so drop the time of day.
  const runDay = asExcelDate(summary.runDate, false);

  buildDataSheet(workbook.addWorksheet(INVOICE_SHEET), invoices, runDay);
  buildDataSheet(workbook.addWorksheet(CREDIT_NOTE_SHEET), creditNotes, runDay);
  buildDataSheet(workbook.addWorksheet(SCANNED_SHEET), scans, runDay);
  buildVerificationSheet(workbook.addWorksheet(VERIFICATION_SHEET), records, summary);

  await workbook.xlsx.writeFile(filePath);
}

/**
 * One of the three 14-column data sheets.
 *
 * A record with no figures (a scan) gets the same row with the amount cells
 * left empty, so the figures can be typed straight in.
 */
function buildDataSheet(sheet, records, runDate) {
  sheet.addRow(HEADERS);
  styleHeaderRow(sheet.getRow(1));

  records.forEach((record, index) => {
    const rowNumber = index + 2;
    const d = record.data;

    const taxTotal = d ? round2(d.igst + d.cgst + d.sgst) : null;
    const remarks = d ? round2(d.taxable + d.nonTaxable + taxTotal) : null;

    sheet.addRow([
      record.invoiceNo,
      record.scanCopy ? pdfLink(record.pdfNo, record.scanCopy) : record.pdfNo,
      { formula: `D${rowNumber}+E${rowNumber}+F${rowNumber}`, result: taxTotal ?? 0 },
      d ? d.igst : null,
      d ? d.cgst : null,
      d ? d.sgst : null,
      d ? d.total : null,
      d ? d.taxable : null,
      d ? d.nonTaxable : null,
      runDate,
      LOCATION,
      null,
      { formula: `H${rowNumber}+I${rowNumber}+C${rowNumber}`, result: remarks ?? 0 },
      { formula: `G${rowNumber}=M${rowNumber}`, result: d ? Math.abs(d.total - remarks) < 0.005 : false },
    ]);

    if (record.scanCopy) sheet.getRow(rowNumber).getCell(2).font = LINK_FONT;
  });

  for (const col of ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'M']) {
    sheet.getColumn(col).numFmt = AMOUNT_FORMAT;
  }
  sheet.getColumn('J').numFmt = DATE_FORMAT;

  const widths = [22, 22, 17, 11, 11, 11, 13, 13, 13, 14, 12, 6, 13, 9];
  widths.forEach((w, i) => { sheet.getColumn(i + 1).width = w; });

  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  if (records.length > 0) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: HEADERS.length } };
  }
}

/** The audit trail: every PDF, what came out of it, and whether it adds up. */
function buildVerificationSheet(sheet, records, summary) {
  const title = sheet.addRow(['PDF to Excel - verification report']);
  title.font = { bold: true, size: 14 };

  sheet.addRow(['Run at', asExcelDate(summary.runDate, true)]);
  sheet.getCell('B2').numFmt = 'dd-mm-yyyy hh:mm';
  sheet.addRow(['PDF files found', summary.total]);
  sheet.addRow(['Read successfully', summary.parsed]);
  sheet.addRow([
    'Scanned - need manual entry',
    summary.scanned,
    summary.scanned > 0 && summary.scanFolder
      ? 'A copy of each one is in the "' + SCANNED_PDF_DIR + '" folder beside this workbook. Click a file name below to open it.'
      : '',
  ]);
  sheet.addRow(['Rows that do NOT add up - check these', summary.unbalanced]);
  sheet.addRow(['Duplicate invoice numbers - check these', summary.duplicates || 0]);
  sheet.addRow(['Files that could not be read - check these', summary.failed]);

  for (let r = 2; r <= 8; r += 1) {
    sheet.getRow(r).getCell(1).font = { bold: true };
  }
  if (summary.scanned > 0) fill(sheet.getRow(5).getCell(2), WARN_FILL);
  if (summary.unbalanced > 0) fill(sheet.getRow(6).getCell(2), BAD_FILL);
  if (summary.duplicates > 0) fill(sheet.getRow(7).getCell(2), WARN_FILL);
  if (summary.failed > 0) fill(sheet.getRow(8).getCell(2), BAD_FILL);

  sheet.addRow([]);

  const headerRowNumber = 10;
  sheet.addRow(VERIFICATION_COLUMNS.map((c) => c.header));
  styleHeaderRow(sheet.getRow(headerRowNumber));

  VERIFICATION_COLUMNS.forEach((col, i) => {
    sheet.getColumn(i + 1).width = col.width;
  });

  for (const record of records) {
    const d = record.data;

    const row = sheet.addRow([
      record.scanCopy ? pdfLink(record.file, record.scanCopy) : record.file,
      record.invoiceNo || '',
      d ? d.issuer : '',
      d ? d.documentType : '',
      d ? d.documentDate : '',
      d ? d.taxable : null,
      d ? d.nonTaxable : null,
      d ? d.igst : null,
      d ? d.cgst : null,
      d ? d.sgst : null,
      d ? d.total : null,
      d ? record.computed : null,
      d ? record.difference : null,
      d ? (record.balanced ? 'YES' : 'NO') : '',
      record.status,
      record.details,
    ]);

    VERIFICATION_COLUMNS.forEach((col, i) => {
      if (col.amount) row.getCell(i + 1).numFmt = AMOUNT_FORMAT;
    });

    if (record.scanCopy) row.getCell(1).font = LINK_FONT;

    const statusCell = row.getCell(STATUS_COLUMN);
    if (record.status === 'FAILED' || record.status === 'CHECK TOTALS') fill(statusCell, BAD_FILL);
    else if (record.status !== 'OK') fill(statusCell, WARN_FILL);
    else fill(statusCell, GOOD_FILL);

    if (d && !record.balanced) fill(row.getCell(DIFFERENCE_COLUMN), BAD_FILL);
  }

  sheet.views = [{ state: 'frozen', xSplit: 3, ySplit: headerRowNumber }];
  if (records.length > 0) {
    sheet.autoFilter = {
      from: { row: headerRowNumber, column: 1 },
      to: { row: headerRowNumber, column: VERIFICATION_COLUMNS.length },
    };
  }
}

/**
 * Excel stores a date as a plain serial number with no timezone, and ExcelJS
 * reads the UTC side of a Date to produce it. Re-stating the local wall clock
 * as UTC keeps the sheet showing the date the run actually happened, rather
 * than shifting it a day either way.
 * @param {Date} date
 * @param {boolean} withTime
 */
function asExcelDate(date, withTime) {
  return new Date(Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    withTime ? date.getHours() : 0,
    withTime ? date.getMinutes() : 0
  ));
}

function styleHeaderRow(row) {
  row.font = { bold: true };
  row.eachCell((cell) => {
    fill(cell, HEADER_FILL);
    cell.border = { bottom: { style: 'thin' } };
  });
}

function fill(cell, argb) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}
