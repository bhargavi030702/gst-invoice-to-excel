// The who-and-where of an invoice, as opposed to the amounts: the two GST
// numbers, the client, the place of supply, the ticket number and the sector.
//
// Every airline labels these differently and several print the supplier and the
// customer in two columns that the PDF flattens into one line, so the parsers do
// the picking themselves. What is here is the part they have in common.

// 15 characters: state code, PAN, entity number, Z, check digit.
export const GSTIN = /\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b/;
const GSTIN_ALL = new RegExp(GSTIN.source, 'g');

export function allGstins(text) {
  return [...new Set(String(text).match(GSTIN_ALL) ?? [])];
}

// The PAN sitting inside a GSTIN, characters 3 to 12. Some invoices print the
// customer's PAN on its own, which is the surest way of telling which of two
// unlabelled GST numbers belongs to whom.
export function panOf(gstin) {
  return String(gstin).slice(2, 12);
}

// The value belonging to a label, whether it is printed beside the label or on
// the line below it. `stopAt` trims a second column that the PDF has run onto
// the end of the same line.
export function after(text, label, { stopAt } = {}) {
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(label);
    if (!m) continue;

    let value = lines[i].slice(m.index + m[0].length).trim();
    if (value === '') value = (lines[i + 1] ?? '').trim();
    if (stopAt) value = value.split(stopAt)[0].trim();

    value = value.replace(/[:\-–]\s*$/, '').trim();
    if (value !== '') return value;
  }
  return '';
}

// Emirates draw their text twice, so every string arrives doubled:
// "SAINT-GOBAIN INDIA PRIVATE LIMITEDSAINT-GOBAIN INDIA PRIVATE LIMITED".
export function undouble(value) {
  const s = String(value).trim();
  if (s.length % 2 !== 0) return s;
  const half = s.length / 2;
  return s.slice(0, half) === s.slice(half) ? s.slice(0, half) : s;
}

// A sector is written every which way - "MAA\CMB\MAA", "From : BOM To : BLR",
// "(MAA-BLR / Y ) (BLR-CDG / Y )". They all come out as "MAA-CMB-MAA".
export function sectorFrom(airports) {
  const out = [];
  for (const code of airports) {
    const c = String(code).toUpperCase().trim();
    if (!/^[A-Z]{3}$/.test(c)) continue;
    // A leg ends where the next begins, so the shared airport is not repeated.
    if (out[out.length - 1] !== c) out.push(c);
  }
  return out.join('-');
}

// Pulls the legs out of a run of "(MAA-BLR / Y )" pairs, in the order flown.
export function sectorFromLegs(text) {
  const codes = [];
  for (const m of String(text).matchAll(/\(\s*([A-Z]{3})\s*-\s*([A-Z]{3})\s*\//g)) {
    codes.push(m[1], m[2]);
  }
  return sectorFrom(codes);
}

// GST state codes, so a document that prints only "State Code 33" can still say
// where the supply was made.
const STATES = {
  '01': 'JAMMU AND KASHMIR', '02': 'HIMACHAL PRADESH', '03': 'PUNJAB',
  '04': 'CHANDIGARH', '05': 'UTTARAKHAND', '06': 'HARYANA', '07': 'DELHI',
  '08': 'RAJASTHAN', '09': 'UTTAR PRADESH', 10: 'BIHAR', 11: 'SIKKIM',
  12: 'ARUNACHAL PRADESH', 13: 'NAGALAND', 14: 'MANIPUR', 15: 'MIZORAM',
  16: 'TRIPURA', 17: 'MEGHALAYA', 18: 'ASSAM', 19: 'WEST BENGAL',
  20: 'JHARKHAND', 21: 'ODISHA', 22: 'CHHATTISGARH', 23: 'MADHYA PRADESH',
  24: 'GUJARAT', 25: 'DAMAN AND DIU', 26: 'DADRA AND NAGAR HAVELI AND DAMAN AND DIU',
  27: 'MAHARASHTRA', 28: 'ANDHRA PRADESH', 29: 'KARNATAKA', 30: 'GOA',
  31: 'LAKSHADWEEP', 32: 'KERALA', 33: 'TAMIL NADU', 34: 'PUDUCHERRY',
  35: 'ANDAMAN AND NICOBAR ISLANDS', 36: 'TELANGANA', 37: 'ANDHRA PRADESH',
  38: 'LADAKH', 97: 'OTHER TERRITORY',
};

export function stateFromCode(code) {
  const key = String(code).trim().padStart(2, '0');
  return STATES[key] ?? '';
}

// "TELANGANA [36]", "Tamil Nadu(33)", "33-Tamil Nadu" all mean the same place.
export function tidyPlace(value) {
  const v = String(value).trim();
  if (v === '') return '';
  const named = v.replace(/[[(]\s*\d{1,2}\s*[\])]/g, '').replace(/^\d{1,2}\s*[-–]\s*/, '').trim();
  if (named !== '' && !/^\d+$/.test(named)) return named.replace(/\s+/g, ' ');
  return stateFromCode(v.replace(/\D/g, ''));
}
