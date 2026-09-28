// Everything about the shape of the output lives here, so a change to the
// workbook layout is a change to one file.

export const LOCATION = 'MUMBAI';

// Sheet1, Credit Notes and Scanned PDFs all share this layout.
//
// Two columns are deliberately left alone. "RIYA INVOICE NO" is filled in by
// hand from Riya's own booking system - the airline's invoice says nothing about
// it - and the last column has no heading and no contents; it is a spare.
export const HEADERS = [
  'CLIENT NAME',
  'RIYA INVOICE NO',
  'AIRLINE NAME',
  'PNR',
  'REMARK',
  'AIRLINE GST ( GSTIN )',
  'CUSTOMER GST NO  GSTIN',
  'INVOICE NO',
  'INVOICE DATE',
  'TICKET NO',
  'PLACE OF SUPPLY',
  'SECTOR',
  'IGST',
  'CGST',
  'SGST',
  'TOTAL',
  'Taxable',
  'Non Taxable',
  'K3 AMOUNT',
  '',
];

// What goes in a cell when the invoice simply does not print that field.
export const NOT_PRINTED = '-';

export const INVOICE_SHEET = 'Sheet1';
export const CREDIT_NOTE_SHEET = 'Credit Notes';
export const SCANNED_SHEET = 'Scanned PDFs';
export const VERIFICATION_SHEET = 'Verification';

export const DATE_FORMAT = 'dd-mm-yyyy';
export const AMOUNT_FORMAT = '#,##0.00';

export const INPUT_DIR = 'input';
export const OUTPUT_DIR = 'output';
export const SCANNED_PDF_DIR = 'Non-Selectable PDFs';
