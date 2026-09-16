# GST Invoice → Excel

Reads airline GST tax-invoice PDFs and writes the figures into a reconciliation
workbook, checking every row's arithmetic against the total printed on the
invoice.

Built for a travel-agency finance team who were keying invoices in by hand.
On the batch it was built against — 1,255 invoices across four airlines — it
reads 1,185 of them in about 16 seconds, and every one of those balances
exactly. The remaining 70 are scans with no text inside; they are set aside for
manual entry rather than guessed at.

Nobody using it sees a terminal: they drop PDFs in a folder and double-click
`run.bat`.

## What it reads

| Airline | Tax invoice | Credit note | Debit note |
|---------|-------------|-------------|------------|
| Air India Ltd | ✅ | ✅ | ✅ |
| Air India Express Ltd | ✅ | ✅ | — |
| InterGlobe Aviation (IndiGo) | ✅ | ✅ | — |
| Emirates | ✅ | — | — |

## What it produces

A workbook with four sheets — invoices, credit notes, scanned PDFs awaiting
manual entry, and a verification sheet carrying one row per PDF with the
arithmetic check and a plain-English reason for anything that needs attention.

---

## What ships

The delivered folder holds four things and nothing else:

```
input\        PDFs go here (sub-folders are fine)
output\       results appear here
run.bat       what the user double-clicks
tool.mjs      the whole program, bundled into one file
```

`tool.mjs` is a build artefact — `src/` compiled together with pdf.js and
ExcelJS. It needs Node.js and nothing else: no `npm install`, no
`node_modules`, no internet.

## Rebuilding after a change

```
npm install     # once
node build.mjs  # writes tool.mjs
```

Then copy `run.bat` and `tool.mjs` to wherever the tool lives.

`build.mjs` explains the three shims the bundle needs; read it before changing
how it is built.

## Running from source

```
node src/index.js                      # uses ./input and ./output
node src/index.js "D:\pdfs" "D:\out"   # any other pair of folders
```

---

## How it works

```
src/
  index.js        the run: find PDFs, read each, write the workbook
  pdfText.js      PDF -> text, rebuilt into visual lines from glyph positions
  parsers/        one file per airline, each turning that text into figures
  totals.js       the arithmetic check applied to every row
  collectScans.js copies scanned PDFs into output/ so the sheet can link them
  excel.js        builds the four-sheet workbook
  readme.js       writes the user-facing READ ME.txt into output/
  config.js       sheet names, folder names, formats
  numbers.js      parsing printed amounts
  errors.js       UserError: shown as a plain message, no stack trace
```

**Text extraction is positional.** `pdfText.js` does not trust the order text
is stored in; it groups glyphs by baseline and sorts by x. That is what makes a
table row arrive as one line, and it is why the parsers can be simple.

**Every row is checked.** `Taxable + Non Taxable + IGST + CGST + SGST = Total`,
against the total printed on the PDF. A row that fails is reported, never
quietly written out as if it were sound. On the current set of 1,255 PDFs,
1,185 are readable and all 1,185 balance exactly.

**A scan is set aside, not guessed at.** A PDF with no text layer is an image.
Its figures cannot be read, so it goes to its own sheet with the amounts blank
and a copy of the file linked from it.

**Nothing stops the run.** A corrupt, empty, locked or unrecognised PDF is
recorded against its own row and the batch carries on.

---

## Supported issuers

| Airline | Tax invoice | Credit note | Debit note |
|---------|-------------|-------------|------------|
| Air India Ltd | ✅ | ✅ | ✅ |
| Air India Express Ltd | ✅ | ✅ | — |
| InterGlobe Aviation (IndiGo) | ✅ | ✅ | — |
| Emirates | ✅ | — | — |

Anything else is reported as `FAILED — unrecognised invoice layout`, and the
rest of the batch still runs.

### Adding an airline

1. Copy `src/parsers/indigo.js` (the simplest) to a new file.
2. Change `matches()` so it recognises the new airline's text.
3. Change `parse()` to return the same fields.
4. Add it to the list at the top of `src/parsers/index.js` — order matters,
   more specific issuers first ("Air India Express" also contains "Air India").

Prove it by running a handful of that airline's invoices and checking the
`Adds Up?` column reads `YES`.

---

## The output workbook

| Sheet | Holds |
|-------|-------|
| `Sheet1` | Tax invoices and debit notes, in the master 14-column layout |
| `Credit Notes` | Refunds, same layout, kept out of the invoice totals |
| `Scanned PDFs` | Scans, same layout, amounts blank, file name links to the PDF |
| `Verification` | One row per PDF: what was read and whether it adds up |

Columns C, M and N of the data sheets are live formulas (`=D+E+F`, `=H+I+C`,
`=G=M`), so the checks keep working when someone types into the Scanned sheet.

Column A is the invoice number scraped from inside the PDF; column B is the
file name. On the current set the two match on all 1,185 readable PDFs, which
makes them a cross-check — the tool flags any row where they differ.

---

## When something goes wrong

Every failure carries a stable code (`E01`-`E09`, `E99`). The table in
`src/errors.js` is the single source of truth: it defines what each code means
and what to do about it, and that same text is printed on screen, written into
the error log, and listed in the `READ ME.txt` the tool drops in the output
folder. To trace a reported problem, search the source for the code.

- **`ReadError`** - a known problem with one PDF. The run carries on and the
  file is reported against its own row.
- **`UserError`** - a setup problem (missing folder, locked workbook). Shown as
  a plain message with a fix, no stack trace.
- **Anything else is a bug.** A `CRASH_<timestamp>.log` is written to the output
  folder with the stack trace, the PDF being read at the time, and the Node
  version. Only the first is written per run, so a broken parser cannot bury the
  folder in identical reports.

`tool.mjs` carries an inline source map and `run.bat` starts Node with
`--enable-source-maps`, so a crash report names the real file and line
(`src/parsers/airIndia.js:57`) instead of an offset into the bundle. That is the
whole reason the map is worth the file size - **do not drop either half.**

## Things that are deliberate

- **A new workbook every run**, named by date and time. Nothing is overwritten.
  If a name is somehow locked, the next free one is used rather than losing the
  run.
- **Scans are copied, never moved.** The input folder is left exactly as found.
- **`Non-Selectable PDFs\` is cleared each run**, so it always matches the
  workbook beside it. Only `.pdf` files are removed.
- **Hyperlinks are relative** to the workbook, so the whole output folder can be
  moved or emailed and the links still work.
- **`Details` is blank when a row is fine.** It is for things needing action,
  not commentary.
