import type {StaffLocale} from './staff-i18n';
// Booqable order states mapped onto rental facts. Payment-unsettled, partial and inspection states stay distinct;
// they are never shown as "Reserved" or "Returned" to hide an internal state.
export type OrderStatus='DRAFT'|'PAYMENT_PENDING'|'PAYMENT_REVIEW'|'RESERVED'|'PICKED_UP'|'PARTIALLY_RETURNED'|'RETURNED'|'INSPECTION_PENDING'|'NO_PICKUP'|'COMPLETED'|'CANCELED';
const S:Record<OrderStatus,[string,string,'neutral'|'blue'|'green'|'orange'|'grey']>={
 DRAFT:['下書き','Draft','grey'],PAYMENT_PENDING:['決済確認中','Payment pending','orange'],PAYMENT_REVIEW:['決済要確認','Payment review','orange'],
 RESERVED:['予約済み','Reserved','blue'],PICKED_UP:['貸出中','Picked up','green'],PARTIALLY_RETURNED:['一部返却','Partially returned','orange'],
 RETURNED:['返却済み','Returned','neutral'],INSPECTION_PENDING:['点検待ち','Awaiting inspection','orange'],NO_PICKUP:['未受取','Not collected','grey'],
 COMPLETED:['完了','Completed','neutral'],CANCELED:['キャンセル','Canceled','grey'],
};
export const ORDER_STATUSES=Object.keys(S) as OrderStatus[];
export const statusLabel=(l:StaffLocale,s:string)=>{const v=S[s as OrderStatus];return v?v[l==='en'?1:0]:(l==='en'?'Unknown':'不明');};
export const statusTone=(s:string)=>S[s as OrderStatus]?.[2]??'grey';
const SLOT:Record<string,[string,string]>={AM:['8:30','8:30'],PM:['13:00','13:00'],DAY:['8:30','8:30'],MULTIDAY:['8:30','8:30']};
const BACK:Record<string,[string,string]>={AM:['12:00','12:00'],PM:['17:00','17:00'],DAY:['17:00','17:00'],MULTIDAY:['17:00','17:00']};
export const pickupTime=(slot:string)=>SLOT[slot]?.[0]??'—';
export const returnTime=(slot:string)=>BACK[slot]?.[0]??'—';
export const fmtDate=(l:StaffLocale,d:string)=>new Intl.DateTimeFormat(l==='en'?'en-GB':'ja-JP',{timeZone:'UTC',month:'short',day:'numeric',weekday:'short'}).format(new Date(d+'T00:00:00Z'));
export const fmtYen=(l:StaffLocale,n:number|null)=>n===null?'—':new Intl.NumberFormat(l==='en'?'en-JP':'ja-JP',{style:'currency',currency:'JPY'}).format(n);
const PAY:Record<string,[string,string]>={COMPLETED:['支払済み','Paid'],SUCCEEDED:['支払済み','Paid'],PENDING:['処理中','Processing'],SUBMITTING:['処理中','Processing'],UNKNOWN:['照合中','Being verified'],REVIEW:['要確認','Needs review'],FAILED:['失敗','Failed'],CANCELED:['取消','Canceled'],REFUNDED:['返金済み','Refunded']};
export const paymentLabel=(l:StaffLocale,p:string|null)=>p===null?(l==='en'?'Unpaid':'未決済'):(PAY[p]?.[l==='en'?1:0]??p);
/** The inbox shows the past event (confirmed / payment review) and, only when it has since changed, the booking's current state. */
export const currentStateNote=(l:StaffLocale,kind:string,state:string)=>{
 const confirmed=state==='CONFIRMED'||state==='CONFIRMED_DEV';
 if(kind==='BOOKING_CONFIRMED'&&confirmed)return '';if(kind==='PAYMENT_REVIEW'&&state==='PAYMENT_REVIEW')return '';
 const m:Record<string,[string,string]>={CANCELLED:['キャンセル済み','Canceled'],COMPLETED:['完了','Completed'],COMPLETED_DEV:['完了','Completed'],CONFIRMED:['確定済み','Confirmed'],CONFIRMED_DEV:['確定済み','Confirmed'],PAYMENT_PENDING:['決済確認中','Payment pending'],PAYMENT_REVIEW:['決済要確認','Payment review'],DRAFT:['下書き','Draft']};
 return m[state]?.[l==='en'?1:0]??'';
};
