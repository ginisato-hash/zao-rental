import type {PoolClient} from 'pg';
import {HoldError,type HoldConditions} from '../../../contracts/src/hold';
type Conn=Pick<PoolClient,'query'>;
export type StoppedDay={store:string;day:string};
/** Owner request 2026-11-22 (temporary closure): a booking whose rental period touches a stopped day at its pickup or return
 * station is not accepted from the public. Reads only station + day through store_sales_stopped_days() (0062), which every
 * runtime role may execute; it reveals no reason or actor. Before 0062 is installed it reports nothing, so an older
 * database keeps today's behaviour. */
export async function stoppedDays(c:Conn,stores:readonly string[],from:string,to:string):Promise<StoppedDay[]>{
 const present=(await c.query("SELECT to_regprocedure('store_sales_stopped_days(text[],date,date)') IS NOT NULL AS present")).rows[0]?.present===true;
 if(!present)return [];
 const rows=(await c.query<{store_id:string;day:string}>("SELECT store_id,to_char(day,'YYYY-MM-DD') AS day FROM store_sales_stopped_days($1::text[],$2::date,$3::date)",[[...new Set(stores)],from,to])).rows;
 return rows.map(r=>({store:r.store_id,day:r.day}));
}
/** Throws SALES_STOPPED (409) when the period [startDate, endDate] touches a stopped day at the pickup or return station. */
export async function assertNotSalesStopped(c:Conn,conditions:Pick<HoldConditions,'pickupStore'|'returnStore'|'period'>){
 const days=await stoppedDays(c,[conditions.pickupStore,conditions.returnStore],conditions.period.startDate,conditions.period.endDate);
 if(days.length)throw new HoldError('SALES_STOPPED',409);
}
