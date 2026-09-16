/**
 * Settings for the PDF -> Excel tool.
 *
 * Everything here is safe to edit; nothing else in src/ needs changing to
 * adjust how the output sheet looks.
 */

/** Goes into the LOCATION column of every row. */
export const LOCATION = 'MUMBAI';

/** Column headers of the data sheets, in order (A..N). Must match the master sheet. */
export const HEADERS = [
  'Invoice No.',
  'PDF NO',
  'TOTAL K3 AMOUNT',
  'IGST',
  'CGST',
  'SGST',
  'TOTAL',
  'Taxable',
  'Non Taxable',
  'UPDATED DATE',
  'LOCATION',
  'a',
  'Remarks',
  '',
];

/** Sheet holding tax invoices and debit notes. */
export const INVOICE_SHEET = 'Sheet1';

/** Sheet holding credit notes, in the same 14-column layout. */
export const CREDIT_NOTE_SHEET = 'Credit Notes';

/**
 * Sheet holding scanned PDFs, in the same 14-column layout with the amounts
 * left blank. Their figures are pictures, not text, so they have to be typed in.
 */
export const SCANNED_SHEET = 'Scanned PDFs';

/** Sheet holding the per-file audit trail. */
export const VERIFICATION_SHEET = 'Verification';

/** How the UPDATED DATE column is displayed. */
export const DATE_FORMAT = 'dd-mm-yyyy';

/** How amount columns are displayed. */
export const AMOUNT_FORMAT = '#,##0.00';

/** Folder names, relative to the project root. */
export const INPUT_DIR = 'input';
export const OUTPUT_DIR = 'output';

/**
 * Folder created inside output/ holding a copy of every non-selectable
 * (scanned) PDF, so they are all in one place to work through by hand.
 */
export const SCANNED_PDF_DIR = 'Non-Selectable PDFs';

