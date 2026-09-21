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
