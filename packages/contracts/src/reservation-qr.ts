// Client-safe counterpart to rental-flow.ts's reservationQr/parseReservationQr (which pull in
// node:crypto and are server-only). Same prefix and ID shape, never a new QR format.
const PREFIX='zao-rental:reservation:';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function bookingIdFromInput(raw:unknown):string|null {
 if(typeof raw!=='string')return null;
 const trimmed=raw.trim();
 const value=trimmed.startsWith(PREFIX)?trimmed.slice(PREFIX.length):trimmed;
 return UUID.test(value)?value:null;
}

/** Short booking number as displayed on screen (`#` + first 8 hex of the booking id, upper case). Accepts `#`, any case and
 * whitespace/hyphen separators; 6 to 8 hex digits only. It is a SEARCH key (prefix), never an identity: callers must show every
 * candidate and let a person choose. A full UUID or a QR payload is not a short number (see bookingIdFromInput). */
export function normalizeBookingRef(raw:unknown):string|null {
 if(typeof raw!=='string')return null;
 const v=raw.normalize('NFKC').trim().replace(/^#/,'').replace(/[\s-]/g,'').toUpperCase();
 return /^[0-9A-F]{6,8}$/.test(v)?v:null;
}

export type ScanClassification=
 |{kind:'booking';id:string}|{kind:'asset';id:string}|{kind:'uuid';id:string}|{kind:'short';ref:string}|{kind:'unsupported'};
/** Classifies one scanned or typed value without ever opening it. Only exact formats are recognised: the reservation QR payload
 * (`zao-rental:reservation:<uuid>`), a bare UUID (the item label format, also a plain booking id), a short number. Any other
 * text, including any URL, is `unsupported`. A payload with another zao-rental prefix is rejected, never reinterpreted. */
export function classifyScan(raw:unknown):ScanClassification {
 if(typeof raw!=='string')return {kind:'unsupported'};
 const v=raw.trim();
 if(v.startsWith(PREFIX)){const id=bookingIdFromInput(v);return id?{kind:'booking',id}:{kind:'unsupported'};}
 if(UUID.test(v))return {kind:'uuid',id:v};
 const ref=normalizeBookingRef(v);return ref?{kind:'short',ref}:{kind:'unsupported'};
}
