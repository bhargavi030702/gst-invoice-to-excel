# PDF Invoice to Excel

Reads airline GST invoices out of the `input` folder and writes them to an Excel
workbook in `output`. PDF and HTML are both read.

**If you just want to run it:** put the invoices in `input`, double-click
`code\run.bat`, and read `output\READ ME.txt`. The rest of this file is for
whoever maintains the code.

## The folder

```
input\      the invoices to read - PDF or HTML
output\     the workbook, the error log and READ ME.txt
code\       this folder: run.bat, the built tool.mjs, and src\
```

`input` and `output` sit beside `code`, not inside it. `run.bat` works that out
for itself, so the three folders can be moved anywhere as long as they stay
together.

Two things in `code\` are reference rather than program:

- `training data\` - 139 invoices covering all thirteen airlines. Point
  `tests/parse-folder.mjs` at it after changing a parser; see **Testing**.
  It is not shipped in the handover zip.
- `Book3.xlsx` - the sheet layout this tool was built to produce, as it was
  handed over. **The sheets** section below says the same thing in words.

## Running it

Run these from inside `code`.

| | |
|---|---|
| `run.bat` | What everyone else uses. Runs the bundled `tool.mjs`. |
| `npm install` | Needed once before either of the two below. |
| `npm start` | Runs from `src/` instead. Use this while changing the code. |
| `npm run build` | Rebuilds `tool.mjs` from `src/`. **Do this before handing the folder on.** |
| `node src/index.js <input> <output>` | Runs against other folders, e.g. `node src/index.js ../input /tmp/out`. |

`node_modules` is not shipped, and is only needed to build or to run from
`src/`. A machine that only runs `run.bat` needs the `code` folder and Node.js,
nothing else - `tool.mjs` already has everything bundled into it.

## How a run works

```
input/*.pdf ─→ pdfText.js  ─┐
                            ├─→ parsers/index.js ─→ totals.js ─→ excel.js ─→ output/*.xlsx
input/*.html ─→ htmlText.js ┘                                  ├─→ readme.js  ─→ output/READ ME.txt
                                                               └─→ index.js   ─→ output/Errors_*.log
```

Both readers turn a file into plain text, one line per row of the page.
`parsers/index.js` picks the first parser that recognises the text, and that
parser returns one or more documents. Everything downstream works on documents,
not files.

| File | What it does |
|---|---|
| `src/index.js` | Walks the input folder, drives everything, prints the summary. |
| `src/config.js` | The workbook layout: column headings, sheet names, formats. |
| `src/pdfText.js` | PDF → text, by grouping the text pieces into lines by height. |
| `src/htmlText.js` | HTML → text, one line per cell. |
| `src/parsers/` | One module per airline. See below. |
| `src/numbers.js` | Reads `1,234.50`, `(1,234.50)`, `.00`, `-` as figures. |
| `src/pnr.js` | Finds the booking reference. |
| `src/totals.js` | The adds-up check. |
| `src/excel.js` | Writes the four sheets. |
| `src/collectScans.js` | Copies scanned PDFs out for manual entry. |
| `src/readme.js` | Writes `output\READ ME.txt`. |
| `src/errors.js` | The E-codes and what they mean. |
| `src/crash.js` | Writes a crash report when the tool itself has a bug. |

## One file, several documents

Some airlines put more than one document in a file: Akasa send an invoice with a
debit note and a credit note against it, and SriLankan send several invoices one
after another. Each is a document in its own right with its own number.

A parser's `parse()` may therefore return **either one document or an array of
them**. `parseInvoice()` normalises that to an array, and `index.js` makes one
row per document. A credit note goes to the `Credit Notes` sheet even when the
invoice it came in with goes to `Sheet1`.

Each of those rows carries its own invoice number, so they do not read as
duplicates of one another. The file they came out of is on the Verification
sheet, where the `Doc` column says which one of them it is - `2 of 3`.

On the `Scanned PDFs` sheet there is no invoice number to show, because nothing
could be read. The `INVOICE NO` cell holds the file name instead and opens the
copy of the PDF, so the figures can be read off and typed in.

## Adding an airline

1. Copy the parser that looks closest to the new layout. `malaysiaAirlines.js` is
   the simplest one to start from - a single totals row read by position.
2. Export three things:
   - `issuer` - the airline's name as it should read in the workbook.
   - `matches(text)` - true when this parser should handle the text. Match on
     something only that airline prints, usually the legal name of the company.
   - `parse(text)` - the document, or an array of documents.
3. Return these fields. `taxable + nonTaxable + igst + cgst + sgst` **must** come
   to `total`, or every row will be flagged `CHECK TOTALS`:

   ```js
   {
     issuer, documentType,        // 'TAX INVOICE' | 'CREDIT NOTE' | 'DEBIT NOTE'
     documentNumber, documentDate,
     taxable, nonTaxable, igst, cgst, sgst, total,

     // Return '' for any the airline does not print - the sheet shows a dash.
     pnr, clientName, airlineGstin, customerGstin,
     ticketNumber, placeOfSupply, sector,

     discount, cess,              // optional; both only to explain a figure in a note
   }
   ```

   `src/details.js` has the pieces these have in common: `after()` for a value
   beside or below its label, `allGstins()`, `sectorFrom()`, `tidyPlace()`,
   `stateFromCode()`, `panOf()` and `undouble()`.

4. Register it in `src/parsers/index.js`, in both `PARSERS` and
   `SUPPORTED_ISSUERS`. **Order matters** - the first parser whose `matches()`
   returns true wins, so anything that has to be ruled out first goes earlier.
   Air India Express is before Air India, and IndiGo is last because its test is
   the loosest.
5. Check it against a folder of that airline's invoices:

   ```
   node tests/parse-folder.mjs ../input
   ```

6. `npm run build`, so `tool.mjs` has the new parser in it too.

### Two columns on one line

Nearly all of these invoices put the airline down one side of the page and the
customer down the other. Flattening a page into lines runs the two together:

```
SAINT-GOBAIN INDIA - HOME AND HOSPITALITY    Kempegowda International Airport,
```

`pdfText.js` keeps that boundary as a **tab**, because the gap between two
columns is around 200 units where the gap between two words is around 1. Pass
`{ stopAt: /\t/ }` to `after()` and the second column is cut off. A tab is
whitespace to every regex, so nothing else has to care.

The same flattening splits labels in half - Air India's "Reference Document
Number" arrives as `Reference Document` / `: 0982792340637` / `Number` on three
lines. Where that happens the parsers fall back on the shape of the value: a bare
run of thirteen digits is a ticket number, the second GST number on the page is
the customer's.

### Things that have caught people out

- **Build regexes as literals, not from strings.** `new RegExp(`\s`)` inside a
  template literal is the string `s`, not whitespace, and fails silently.
- **A discount column is not always taken off the same figure.** Air India
  deducts it from the non-taxable amount; Akasa deducts it from the taxable one.
  The line items above the totals row say which.
- **A figure too wide for its column is split across lines** by the PDF. See
  `repairWrappedRow` in `indigo.js`.
- **Rate columns hold figures too.** Reading a totals row by position only works
  if the rates are counted as well - see `allianceAir.js`, where eleven figures
  are expected but only five of them are amounts.

## Testing

Run these from inside `code`.

```
node tests/parse-folder.mjs "training data"          # the check to run after touching a parser
node tests/parse-folder.mjs "training data" --quiet  # --quiet drops the "no PNR" notes
node tests/parse-folder.mjs ../input                 # or against whatever is waiting to be run
node tests/dump-sheet.mjs ../output/Invoice_*.xlsx   # first rows of each sheet, formulas and all
node tests/compare-workbooks.mjs a.xlsx b.xlsx       # prove a change moved no figure it should not have
```

`parse-folder.mjs` reads and checks without writing anything. Against
`training data` it should report **156 documents** and three things to look at,
all three of them expected:

- `3QMYP5-ABx_...pdf` is an e-ticket, not an invoice, so there is nothing on it
  to read.
- `3QMYP5_11_08_2025_C361FQ0825_AA008.pdf` does not add up, because the credit
  note itself does not: its total row prints IGST -230 where the line items come
  to -115, and the printed total agrees with -115.
- `MAA-2601-P000154.pdf` is one page of a browser print of the British Airways
  e-mail, and the whole "Amount (in INR)" column is missing from the file. The
  original `.html` beside it reads perfectly; this is kept as the sample that
  proves the tool says so rather than filling in zeroes.

Anything else appearing in that list is something the change broke.

## The sheets

`Sheet1`, `Credit Notes` and `Scanned PDFs` share the layout in `config.js`:

| Col | Heading | Where it comes from |
|---|---|---|
| A | CLIENT NAME | the invoice's bill-to name |
| B | RIYA INVOICE NO | **left empty** - filled in by hand from Riya's own system |
| C | AIRLINE NAME | the parser's `issuer` |
| D | PNR | `pnr` |
| E | REMARK | the document type, title-cased |
| F | AIRLINE GST ( GSTIN ) | the supplier's GST number |
| G | CUSTOMER GST NO  GSTIN | the recipient's GST number |
| H | INVOICE NO | `documentNumber` |
| I | INVOICE DATE | `documentDate`, as printed |
| J | TICKET NO | `ticketNumber` |
| K | PLACE OF SUPPLY | `placeOfSupply` |
| L | SECTOR | `sector` |
| M N O | IGST CGST SGST | |
| P | TOTAL | **formula** `= Q+R+S` |
| Q R | Taxable, Non Taxable | |
| S | K3 AMOUNT | **formula** `= M+N+O` |
| T | *(none)* | spare, always empty |

The two formulas keep working when a figure is typed in by hand. The column
letters come from `COL` in `excel.js` - change a column there and the formulas
follow it.

**A dash means the airline does not print that field**, not that the tool failed
to read it. Anything genuinely unreadable is flagged on the Verification sheet
instead. `field()` in `excel.js` is what puts the dash in; `RIYA INVOICE NO` and
column T go through a different path and stay truly empty.
