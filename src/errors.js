/**
 * Error handling.
 *
 * Every failure the tool can produce carries a short code. The code is printed
 * on screen, written into the Verification sheet and repeated in the log, so a
 * problem reported months from now can be traced straight back to the line of
 * code that raised it -- search the source for the code and you are there.
 *
 * Codes are stable. Add new ones at the end; never reuse a retired one.
 */

/**
 * Every error code, with what it means and what to do about it.
 * Keep this table in step with the throw sites; it is what the log prints.
 */
export const ERROR_CODES = {
  'E01': {
    meaning: 'The PDF file is empty (0 bytes).',
    fix: 'The file did not download properly. Fetch it again.',
  },
  'E02': {
    meaning: 'The PDF could not be opened.',
    fix: 'The file is corrupt or password protected. Open it yourself to check, then fetch a fresh copy.',
  },
  'E03': {
    meaning: 'The airline that issued this invoice is not recognised.',
    fix: 'The tool needs a new parser for this airline. See "Adding an airline" in README.md.',
  },
  'E04': {
    meaning: 'The amounts table was not found on the page.',
    fix: 'The airline has probably changed its invoice layout. That airline\'s parser in src/parsers/ needs updating.',
  },
  'E05': {
    meaning: 'The amounts table was found but held the wrong number of figures.',
    fix: 'The airline has probably added or removed a column. That airline\'s parser in src/parsers/ needs updating.',
  },
  'E06': {
    meaning: 'The figures do not add up to the total printed on the invoice.',
    fix: 'Open the PDF and check it by hand. If many rows report this, a parser is reading the wrong column.',
  },
  'E07': {
    meaning: 'The Excel file could not be written.',
    fix: 'Close any open workbook in Excel and run again.',
  },
  'E08': {
    meaning: 'The input folder is missing.',
    fix: 'Create a folder named "input" next to run.bat and put the PDFs in it.',
  },
  'E09': {
    meaning: 'A scanned PDF could not be copied into the output folder.',
    fix: 'Check there is free disk space and that the output folder is not read-only.',
  },
  'E99': {
    meaning: 'An unexpected fault inside the tool itself.',
    fix: 'This is a bug. Send the CRASH log from the output folder to whoever maintains the tool.',
  },
};

/**
 * A problem with how the tool was set up or invoked, rather than a bug.
 * Shown as a plain message with a suggested fix and no stack trace, because a
 * stack trace tells the person running run.bat nothing useful.
 */
export class UserError extends Error {
  constructor(message, code = 'E99') {
    super(message);
    this.name = 'UserError';
    this.code = code;
  }
}

/**
 * A problem reading one particular PDF. The run carries on; the file is
 * reported against its own row.
 */
export class ReadError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ReadError';
    this.code = code;
  }
}

/**
 * Prefix a message with its code, so it can be searched for later.
 * @param {string|undefined} code
 * @param {string} message
 */
export function labelled(code, message) {
  return code ? `[${code}] ${message}` : message;
}

/** The "what it means / what to do" lines for the codes actually seen in a run. */
export function explain(codes) {
  const lines = [];
  for (const code of [...new Set(codes)].filter(Boolean).sort()) {
    const entry = ERROR_CODES[code];
    if (!entry) continue;
    lines.push(`  ${code}  ${entry.meaning}`);
    lines.push(`       What to do: ${entry.fix}`);
  }
  return lines;
}
