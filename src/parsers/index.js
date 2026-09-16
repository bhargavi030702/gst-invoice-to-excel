/**
 * Picks the right parser for a document and runs it.
 *
 * Order matters: Air India Express invoices also contain the words
 * "AIR INDIA", so the more specific issuer has to be tried first.
 */

import * as airIndiaExpress from './airIndiaExpress.js';
import * as airIndia from './airIndia.js';
import * as indigo from './indigo.js';
import * as emirates from './emirates.js';
import { ReadError } from '../errors.js';

const PARSERS = [airIndiaExpress, airIndia, emirates, indigo];

/** Human-readable list of what this tool knows how to read. */
export const SUPPORTED_ISSUERS = [
  'Air India Ltd',
  'Air India Express Ltd',
  'InterGlobe Aviation Ltd (IndiGo)',
  'Emirates',
];

/**
 * @param {string} text text layer of the PDF
 * @returns {object} extracted invoice fields
 * @throws {Error} when no parser recognises the document, or the parser fails
 */
export function parseInvoice(text) {
  const parser = PARSERS.find((p) => p.matches(text));

  if (!parser) {
    throw new ReadError(
      'Unrecognised invoice layout - none of the supported airlines were found in this PDF. ' +
      `Supported: ${SUPPORTED_ISSUERS.join(', ')}.`,
      'E03'
    );
  }

  return parser.parse(text);
}
