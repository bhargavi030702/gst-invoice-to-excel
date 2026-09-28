// Prints the first few rows of each sheet of a workbook, formulas and all, so a
// layout change can be eyeballed without opening Excel.
//
//   node tests/dump-sheet.mjs output/Invoice_Extract_....xlsx [rows]

import ExcelJS from 'exceljs';

const file = process.argv[2];
const wanted = Number(process.argv[3] || 4);

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file);

for (const sheet of wb.worksheets) {
  console.log(`\n=== ${sheet.name}  (${sheet.rowCount} rows) ===`);
  let shown = 0;
  sheet.eachRow((row, n) => {
    if (shown > wanted) return;
    shown += 1;
    const cells = [];
    row.eachCell({ includeEmpty: true }, (cell, c) => {
      const letter = sheet.getColumn(c).letter;
      let v = cell.value;
      if (v && typeof v === 'object') {
        if (v.formula !== undefined) v = `=${v.formula} -> ${JSON.stringify(v.result)}`;
        else if (v.hyperlink !== undefined) v = `${v.text} -> ${v.hyperlink}`;
        else if (v instanceof Date) v = v.toISOString().slice(0, 10);
        else v = JSON.stringify(v);
      }
      cells.push(`${letter}${n}=${v === null || v === undefined ? '' : v}`);
    });
    console.log('  ' + cells.join('  |  '));
  });
}
console.log('');
