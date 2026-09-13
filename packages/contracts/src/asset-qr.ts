// A QR identifies one immutable whole Asset, never a reservation or a left/right child.
export function assetIdFromQr(raw:unknown):string|null {
 if(typeof raw!=='string')return null;
 const value=raw.trim();
 return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)?value:null;
}
