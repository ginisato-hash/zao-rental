import {FlowError} from '../../../contracts/src/rental-flow';
import type {OperationsContext} from './context';
import {OrdersService,type OrderRow} from './orders-service';
import {CustomersService} from './customers-service';
import {InventoryRead} from './inventory-read';
import {EXPORT_MAX,exportBound,toCsv,type CsvColumn,type CsvLang} from './exports';

// The three list CSVs (Orders / Customers / Inventory). Each one calls the screen's own read with the same query keys the
// screen sends, minus paging, so the file has exactly the screen's row set (all pages) under the caller's current
// permission and stations; the read re-authorizes the scope before it returns. Columns are the screen's columns, with
// codes kept as codes (status, payment, station) so a spreadsheet can filter on them; nothing is added that the screen
// does not show. Over EXPORT_MAX rows the export is refused as a whole.
type Customer={key:string;name:string|null;email:string|null;bookings:number;lastStart:string|null;legacy:boolean};
type Product={id:string;code:string;name:string;brand:string;family:string;variants:number;counts:{availableNow:number;onHand:number;out:number;care:number;maintenance:number;incoming:number;registered:number}};

/** Booking time in JST as 'YYYY-MM-DD HH:mm', the same moment the Orders screen shows. */
export const bookedAtJst=(iso:string)=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso)).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;};
const ORDER_COLUMNS:CsvColumn<OrderRow&{shortage?:string}>[]=[
 {key:'ref',ja:'予約番号',en:'Order',value:r=>r.ref},{key:'customer',ja:'お客様',en:'Customer',value:r=>r.customer},
 {key:'status',ja:'状態',en:'Status',value:r=>r.status},{key:'late',ja:'遅れ',en:'Late',value:r=>r.lateOut?'PICKUP':r.lateBack?'RETURN':''},
 {key:'pickupDate',ja:'受取日',en:'Pickup date',value:r=>r.startDate},{key:'pickupStore',ja:'受取店舗',en:'Pickup station',value:r=>r.pickupStore},
 {key:'returnDate',ja:'返却日',en:'Return date',value:r=>r.endDate},{key:'returnStore',ja:'返却店舗',en:'Return station',value:r=>r.returnStore},
 {key:'totalJpy',ja:'金額（税込・円）',en:'Total (JPY, tax incl.)',value:r=>r.totalJpy},{key:'payment',ja:'支払状況',en:'Payment',value:r=>r.paymentStatus},
 // Appended (not inserted) so existing spreadsheets keep their column positions.
 {key:'bookedAt',ja:'受付日時（JST）',en:'Booked at (JST)',value:r=>bookedAtJst(r.createdAt)},
];
const SHORTAGE_COLUMN:CsvColumn<OrderRow&{shortage?:string}>={key:'shortage',ja:'不足判定',en:'Shortage',value:r=>r.shortage};
const CUSTOMER_COLUMNS:CsvColumn<Customer>[]=[
 {key:'name',ja:'お名前',en:'Name',value:r=>r.name},{key:'email',ja:'メールアドレス',en:'Email',value:r=>r.email},
 {key:'bookings',ja:'予約数',en:'Bookings',value:r=>r.bookings},{key:'lastStart',ja:'最終利用日',en:'Last rental',value:r=>r.lastStart},
 {key:'legacy',ja:'旧予約（顧客未登録）',en:'Legacy booking (no profile)',value:r=>r.legacy},
];
const PRODUCT_COLUMNS:CsvColumn<Product&{store:string}>[]=[
 {key:'station',ja:'店舗',en:'Station',value:r=>r.store},{key:'code',ja:'商品コード',en:'Code',value:r=>r.code},{key:'brand',ja:'ブランド',en:'Brand',value:r=>r.brand},
 {key:'name',ja:'商品名',en:'Product',value:r=>r.name},{key:'family',ja:'種類',en:'Type',value:r=>r.family},{key:'sizes',ja:'サイズ数',en:'Sizes',value:r=>r.variants},
 {key:'availableNow',ja:'今すぐ貸出可',en:'Available now',value:r=>r.counts.availableNow},{key:'onHand',ja:'店内',en:'On hand',value:r=>r.counts.onHand},
 {key:'out',ja:'貸出中',en:'Out',value:r=>r.counts.out},{key:'care',ja:'手入れ中',en:'In care',value:r=>r.counts.care},
 {key:'maintenance',ja:'修理・使用不可',en:'Maintenance',value:r=>r.counts.maintenance},{key:'incoming',ja:'移動中',en:'Incoming',value:r=>r.counts.incoming},
 {key:'registered',ja:'登録数',en:'Registered',value:r=>r.counts.registered},
];

export async function listCsv(ctx:OperationsContext,path:string,q:URLSearchParams,lang:CsvLang):Promise<{name:string;body:string}>{
 const g=(k:string)=>q.get(k)??undefined;
 if(path==='/orders'){
  const r=await new OrdersService(ctx).list({stores:(g('stores')??'').split(','),tab:g('tab'),status:g('status'),payment:g('payment'),from:g('from'),to:g('to'),direction:g('direction'),late:g('late'),search:g('search')},{all:true});
  return {name:`orders-${r.today}`,body:toCsv(r.tab==='shortage'?[...ORDER_COLUMNS,SHORTAGE_COLUMN]:ORDER_COLUMNS,r.rows,lang)};
 }
 if(path==='/customers'){const r=await new CustomersService(ctx).list({search:g('search')},{all:true});return {name:'customers',body:toCsv(CUSTOMER_COLUMNS,r.rows as Customer[],lang)};}
 if(path==='/products'){const r=await new InventoryRead(ctx).list({store:g('store')??'',family:g('family'),search:g('search')});exportBound(r.rows.length);
  return {name:`inventory-${r.store}`,body:toCsv(PRODUCT_COLUMNS,(r.rows as Product[]).map(p=>({...p,store:r.store})),lang)};}
 throw new FlowError('NOT_FOUND',404);
}
export {EXPORT_MAX};
