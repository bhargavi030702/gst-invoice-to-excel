import { ReadError } from '../errors.js';

import * as airIndiaExpress from './airIndiaExpress.js';
import * as airIndia from './airIndia.js';
import * as indigo from './indigo.js';
import * as emirates from './emirates.js';
import * as passageInvoice from './passageInvoice.js';
import * as akasa from './akasa.js';
import * as singaporeAirlines from './singaporeAirlines.js';
import * as srilankan from './srilankan.js';
import * as allianceAir from './allianceAir.js';
import * as malaysiaAirlines from './malaysiaAirlines.js';
import * as britishAirways from './britishAirways.js';

// Order matters. The first parser that recognises the text is the one used, so
// anything that has to be ruled out before a broader test goes earlier:
// Air India Express before Air India, and the passage invoice before IndiGo,
// whose test for the word "IndiGo" is the loosest of the lot.
const PARSERS = [
  airIndiaExpress,
  airIndia,
  emirates,
  passageInvoice,
  akasa,
  singaporeAirlines,
  srilankan,
  allianceAir,
  malaysiaAirlines,
  britishAirways,
  indigo,
];

export const SUPPORTED_ISSUERS = [
  'Air India Ltd',
  'Air India Express Ltd',
  'InterGlobe Aviation Ltd (IndiGo)',
  'Emirates',
  'Air France',
  'KLM Royal Dutch Airlines',
  'Lufthansa German Airlines',
  'SNV Aviation Ltd (Akasa Air)',
  'Singapore Airlines Ltd',
  'SriLankan Airlines Ltd',
  'Alliance Air Aviation Ltd',
  'Malaysia Airlines Berhad',
  'British Airways PLC',
];

export function isRecognised(text) {
  return PARSERS.some((p) => p.matches(text));
}

// Always an array. Most airlines put one document in a file, but Akasa and
// SriLankan send several - an invoice with a debit note and a credit note
// against it, or a run of invoices one after another - and each of those is a
// document in its own right with its own number.
export function parseInvoice(text) {
  const parser = PARSERS.find((p) => p.matches(text));
  if (!parser) {
    throw new ReadError(
      `Unrecognised invoice layout - none of the supported airlines were found in this file. Supported: ${SUPPORTED_ISSUERS.join(', ')}.`,
      'E03',
    );
  }

  const parsed = parser.parse(text);
  const documents = Array.isArray(parsed) ? parsed : [parsed];
  if (documents.length === 0) {
    throw new ReadError(
      `The ${parser.issuer} parser found no documents in this file.`,
      'E04',
    );
  }
  return documents;
}
