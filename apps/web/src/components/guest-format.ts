// CH-02: customer-facing store names, amounts and JST times shared by the booking flow and the saved
// booking view. A raw store enum or ISO timestamp is never rendered.
// Store display dictionary (Owner 2026-10-10): only the displayed names change; internal IDs, URLs, DB keys and Square locations
// stay MOUNTAIN_BASE / ONSEN_BASE.
export const STORE_LABEL:Record<string,string>={MOUNTAIN_BASE:'Mountain Station',ONSEN_BASE:'Central Station'};
export const storeName=(ja:boolean,v:string)=>STORE_LABEL[v]??(ja?'店舗':'Store');
export const yen=(ja:boolean,n:unknown)=>{const v=typeof n==='string'&&n.trim()!==''?Number(n):n;return typeof v==='number'&&Number.isFinite(v)?new Intl.NumberFormat(ja?'ja-JP':'en-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}).format(v):'—';};
export const jstDateTime=(ja:boolean,iso:string)=>{const d=new Date(iso);if(Number.isNaN(d.getTime()))return '—';return new Intl.DateTimeFormat(ja?'ja-JP':'en-JP',{timeZone:'Asia/Tokyo',dateStyle:'medium',timeStyle:'short'}).format(d)+' JST';};
