// Compares the figures on Sheet1 and Credit Notes of two workbooks, keyed on the
// invoice number, and reports any that moved. Used to prove a change to the
// parsers did not quietly alter a number that was already right.
//
//   node tests/compare-workbooks.mjs before.xlsx after.xlsx

import ExcelJS from 'exceljs';

const [oldFile, newFile] = process.argv.slice(2).filter((a) => !a.startsWith('--'));

// Rows are matched on the airline and the invoice number, which is what stays
// the same across a change to the parsers.
const COLUMNS = {
  airline: 3, invoiceNo: 8,
  igst: 13, cgst: 14, sgst: 15, total: 16, taxable: 17, nonTaxable: 18,
};
const FIGURES = ['igst', 'cgst', 'sgst', 'total', 'taxable', 'nonTaxable'];

async function read(file, map) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const rows = new Map();
  for (const name of ['Sheet1', 'Credit Notes']) {
    const sheet = wb.getWorksheet(name);
    if (!sheet) continue;
    sheet.eachRow((row, n) => {
      if (n === 1) return;
      const key = `${name}|${plain(row.getCell(map.airline))}|${plain(row.getCell(map.invoiceNo))}`;
      const figures = {};
      for (const f of FIGURES) figures[f] = plain(row.getCell(map[f]));
      rows.set(key, figures);
    });
  }
  return rows;
}

function plain(cell) {
  const v = cell.value;
  if (v && typeof v === 'object') {
    if (v.result !== undefined) return v.result;
    if (v.text !== undefined) return v.text;
  }
  return v === null || v === undefined ? '' : v;
}

const before = await read(oldFile, COLUMNS);
const after = await read(newFile, COLUMNS);

const changed = [];
const missing = [];
for (const [key, figures] of before) {
  const now = after.get(key);
  if (!now) {
    missing.push(key);
    continue;
  }
  for (const f of FIGURES) {
    if (Math.abs((Number(figures[f]) || 0) - (Number(now[f]) || 0)) > 0.005) {
      changed.push(`${key}  ${f}: ${figures[f]} -> ${now[f]}`);
    }
  }
}
const added = [...after.keys()].filter((k) => !before.has(k));

console.log(`\nrows before : ${before.size}`);
console.log(`rows after  : ${after.size}`);
console.log(`figures moved: ${changed.length}`);
console.log(`rows gone    : ${missing.length}`);
console.log(`rows new     : ${added.length}\n`);

for (const c of changed.slice(0, 40)) console.log('  CHANGED  ' + c);
for (const m of missing.slice(0, 40)) console.log('  GONE     ' + m);
for (const a of added.slice(0, 40)) console.log('  NEW      ' + a);
console.log('');
