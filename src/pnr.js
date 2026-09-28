// The booking reference. Most airlines print it as "PNR : ABC123" somewhere near
// the top, so one regex covers them; the few that lay it out differently do
// their own thing in their own parser.
//
// The value is matched case-sensitively on purpose. IndiGo invoices carry the
// sentence "The itinerary issued against this PNR forms a part of this invoice",
// and a case-insensitive match would read "forms" as a booking reference.

const LABELLED = /\bPNR\b\s*(?:No\.?|Number)?\s*[:#]?\s*([A-Z0-9]{5,8})\b/g;

export function findPnr(text) {
  for (const m of String(text).matchAll(LABELLED)) {
    const value = m[1].trim();
    if (looksLikePnr(value)) return value;
  }
  return '';
}

// A booking reference is five to eight characters of mixed letters and digits.
// A run of digits on its own is a ticket number or an amount, not a PNR.
export function looksLikePnr(value) {
  if (!/^[A-Z0-9]{5,8}$/.test(value)) return false;
  return /[A-Z]/.test(value);
}
