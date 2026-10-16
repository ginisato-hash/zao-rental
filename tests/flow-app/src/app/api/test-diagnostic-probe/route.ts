// Test fixture only: throws a synthetic, uncaught TypeError so the onRequestError -> launcher -> test log path can be
// proven end to end. The message is a private marker that must never appear in any forwarded output.
export const dynamic='force-dynamic';
// Route warming uses HEAD; keep it from falling back to the synthetic throwing GET.
export function HEAD():Response{return new Response(null,{status:204});}
export function GET():Response{throw new TypeError('SYNTHETIC_PRIVATE request-error probe');}
