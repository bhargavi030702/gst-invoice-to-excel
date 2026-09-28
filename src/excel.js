import ExcelJS from 'exceljs';
import {
  HEADERS,
  NOT_PRINTED,
  INVOICE_SHEET,
  CREDIT_NOTE_SHEET,
  SCANNED_SHEET,
  VERIFICATION_SHEET,
  AMOUNT_FORMAT,
  SCANNED_PDF_DIR,
} from './config.js';
import { round2 } from './numbers.js';

const HEADER_FILL = 'FFD9E1F2';
const BAD_FILL = 'FFFFC7CE';
const WARN_FILL = 'FFFFEB9C';
const GOOD_FILL = 'FFC6EFCE';
const LINK_FONT = { color: { argb: 'FF0563C1' }, underline: true };

// Which column each field lands in on the data sheets. The live formulas are
// written from these, so moving a column here moves it in the formulas too.
const COL = {
  clientName: 'A',
  riyaInvoiceNo: 'B',
  airlineName: 'C',
  pnr: 'D',
  remark: 'E',
  airlineGstin: 'F',
  customerGstin: 'G',
  invoiceNo: 'H',
  invoiceDate: 'I',
  ticketNo: 'J',
  placeOfSupply: 'K',
  sector: 'L',
  igst: 'M',
  cgst: 'N',
  sgst: 'O',
  total: 'P',
  taxable: 'Q',
  nonTaxable: 'R',
  k3: 'S',
  spare: 'T',
};

const AMOUNT_COLUMNS = [COL.igst, COL.cgst, COL.sgst, COL.total, COL.taxable, COL.nonTaxable, COL.k3];
const COLUMN_WIDTHS = [34, 18, 26, 10, 13, 22, 24, 20, 14, 18, 18, 18, 11, 11, 11, 13, 13, 13, 13, 8];

function pdfLink(text, target) {
  return { text, hyperlink: target.split('/').map(encodeURIComponent).join('/') };
}

// A field the invoice simply does not print reads as a dash, so it is plain that
// the tool looked and there was nothing there. A scanned PDF has no fields at
// all yet, so its cells stay empty for the figures to be typed into.
function field(value) {
  if (value === undefined || value === null || value === false) return '';
  const s = String(value).trim();
  return s === '' ? NOT_PRINTED : s;
}

// "TAX INVOICE" reads as "Tax Invoice" in the REMARK column.
function titleCase(value) {
  return String(value).toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

const VERIFICATION_COLUMNS = [
  { header: 'File Name', key: 'file', width: 26 },
  { header: 'Doc', key: 'part', width: 8 },
  { header: 'Invoice No.', key: 'invoiceNo', width: 22 },
  { header: 'PNR', key: 'pnr', width: 10 },
  { header: 'Airline', key: 'issuer', width: 30 },
  { header: 'Document Type', key: 'docType', width: 15 },
  { header: 'Document Date', key: 'docDate', width: 14 },
  { header: 'Taxable', key: 'taxable', width: 12, amount: true },
  { header: 'Non Taxable', key: 'nonTaxable', width: 12, amount: true },
  { header: 'IGST', key: 'igst', width: 10, amount: true },
  { header: 'CGST', key: 'cgst', width: 10, amount: true },
  { header: 'SGST', key: 'sgst', width: 10, amount: true },
  { header: 'Total on Document', key: 'total', width: 17, amount: true },
  { header: 'Total Computed', key: 'computed', width: 14, amount: true },
  { header: 'Difference', key: 'difference', width: 11, amount: true },
  { header: 'Adds Up?', key: 'balanced', width: 10 },
  { header: 'Status', key: 'status', width: 15 },
  { header: 'Details', key: 'details', width: 80 },
];

const STATUS_COLUMN = VERIFICATION_COLUMNS.findIndex((c) => c.key === 'status') + 1;
const DIFFERENCE_COLUMN = VERIFICATION_COLUMNS.findIndex((c) => c.key === 'difference') + 1;

export async function writeWorkbook(records, summary, filePath) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'PDF Invoice to Excel';
  workbook.created = new Date();

  const readable = records.filter((r) => r.data);
  const creditNotes = readable.filter((r) => r.data.documentType === 'CREDIT NOTE');
  const invoices = readable.filter((r) => r.data.documentType !== 'CREDIT NOTE');
  const scans = records.filter((r) => r.status === 'SCANNED');

  buildDataSheet(workbook.addWorksheet(INVOICE_SHEET), invoices);
  buildDataSheet(workbook.addWorksheet(CREDIT_NOTE_SHEET), creditNotes);
  buildDataSheet(workbook.addWorksheet(SCANNED_SHEET), scans);
  buildVerificationSheet(workbook.addWorksheet(VERIFICATION_SHEET), records, summary);

  await workbook.xlsx.writeFile(filePath);
}

function buildDataSheet(sheet, records) {
  sheet.addRow(HEADERS);
  styleHeaderRow(sheet.getRow(1));

  records.forEach((record, index) => {
    const row = index + 2;
    const d = record.data;
    const k3 = d ? round2(d.igst + d.cgst + d.sgst) : null;
    const total = d ? round2(d.taxable + d.nonTaxable + k3) : null;

    sheet.addRow([
      field(d && d.clientName),
      // Filled in by hand from Riya's own system; the airline's invoice says
      // nothing about it, so the tool leaves it alone.
      '',
      field(d && d.issuer),
      field(d && d.pnr),
      field(d && titleCase(d.documentType)),
      field(d && d.airlineGstin),
      field(d && d.customerGstin),
      // On a scanned PDF the file name is all there is, and it opens the copy.
      record.scanCopy ? pdfLink(record.pdfNo, record.scanCopy) : field(record.invoiceNo),
      field(d && d.documentDate),
      field(d && d.ticketNumber),
      field(d && d.placeOfSupply),
      field(d && d.sector),
      d ? d.igst : null,
      d ? d.cgst : null,
      d ? d.sgst : null,
      {
        formula: `${COL.taxable}${row}+${COL.nonTaxable}${row}+${COL.k3}${row}`,
        result: total ?? 0,
      },
      d ? d.taxable : null,
      d ? d.nonTaxable : null,
      {
        formula: `${COL.igst}${row}+${COL.cgst}${row}+${COL.sgst}${row}`,
        result: k3 ?? 0,
      },
      null,
    ]);

    if (record.scanCopy) sheet.getRow(row).getCell(8).font = LINK_FONT;
  });

  for (const col of AMOUNT_COLUMNS) {
    sheet.getColumn(col).numFmt = AMOUNT_FORMAT;
  }

  COLUMN_WIDTHS.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });

  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  if (records.length > 0) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: HEADERS.length } };
  }
}

function buildVerificationSheet(sheet, records, summary) {
  const title = sheet.addRow(['PDF to Excel - verification report']);
  title.font = { bold: true, size: 14 };

  sheet.addRow(['Run at', asExcelDate(summary.runDate, true)]);
  sheet.getCell('B2').numFmt = 'dd-mm-yyyy hh:mm';
  sheet.addRow(['Files found', summary.total]);
  sheet.addRow(['Documents read', summary.documents]);
  sheet.addRow([
    'Scanned - need manual entry',
    summary.scanned,
    summary.scanned > 0 && summary.scanFolder
      ? `A copy of each one is in the "${SCANNED_PDF_DIR}" folder beside this workbook. Click a file name below to open it.`
      : '',
  ]);
  sheet.addRow([
    'Passed over - not invoices',
    summary.skipped || 0,
    summary.skipped > 0 ? 'Covering e-mails saved beside the invoices. Nothing to do.' : '',
  ]);
  sheet.addRow(['Rows that do NOT add up - check these', summary.unbalanced]);
  sheet.addRow(['Duplicate invoice numbers - check these', summary.duplicates || 0]);
  sheet.addRow(['Files that could not be read - check these', summary.failed]);

  const LAST_SUMMARY_ROW = 9;
  for (let r = 2; r <= LAST_SUMMARY_ROW; r += 1) {
    sheet.getRow(r).getCell(1).font = { bold: true };
  }
  if (summary.scanned > 0) fill(sheet.getRow(5).getCell(2), WARN_FILL);
  if (summary.unbalanced > 0) fill(sheet.getRow(7).getCell(2), BAD_FILL);
  if (summary.duplicates > 0) fill(sheet.getRow(8).getCell(2), WARN_FILL);
  if (summary.failed > 0) fill(sheet.getRow(9).getCell(2), BAD_FILL);

  sheet.addRow([]);
  const headerRowNumber = LAST_SUMMARY_ROW + 2;

  sheet.addRow(VERIFICATION_COLUMNS.map((c) => c.header));
  styleHeaderRow(sheet.getRow(headerRowNumber));
  VERIFICATION_COLUMNS.forEach((col, i) => {
    sheet.getColumn(i + 1).width = col.width;
  });

  for (const record of records) {
    const d = record.data;
    const row = sheet.addRow([
      record.scanCopy ? pdfLink(record.file, record.scanCopy) : record.file,
      // Only worth saying when a file held more than one document.
      record.partsInFile > 1 ? `${record.part} of ${record.partsInFile}` : '',
      record.invoiceNo || '',
      record.pnr || '',
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
    else if (record.status === 'OK' || record.status === 'SKIPPED') fill(statusCell, GOOD_FILL);
    else fill(statusCell, WARN_FILL);

    if (d && !record.balanced) fill(row.getCell(DIFFERENCE_COLUMN), BAD_FILL);
  }

  sheet.views = [{ state: 'frozen', xSplit: 4, ySplit: headerRowNumber }];
  if (records.length > 0) {
    sheet.autoFilter = {
      from: { row: headerRowNumber, column: 1 },
      to: { row: headerRowNumber, column: VERIFICATION_COLUMNS.length },
    };
  }
}

// Excel stores a date as a day count with no timezone. Building it in UTC keeps
// the day the same whatever the clock on the computer is set to.
function asExcelDate(date, withTime) {
  return new Date(Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    withTime ? date.getHours() : 0,
    withTime ? date.getMinutes() : 0,
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
