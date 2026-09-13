import {normalizePeriod,type HoldConditions} from './hold';
/** Physical handover only; never changes commercial dates or grants staff authority. */
export function physicalPickupWindow(period:HoldConditions['period'],now:Date):boolean {
 const normalized=normalizePeriod(period),jst=new Date(now.getTime()+9*3600000),date=jst.toISOString().slice(0,10),minutes=jst.getUTCHours()*60+jst.getUTCMinutes();
 return now>=new Date(normalized.startsAt)&&now<new Date(normalized.dueAt)&&minutes>=510&&minutes<1020&&
  (date===period.startDate||period.slot==='MULTIDAY'&&date>period.startDate&&date<=period.endDate);
}
export function pickupTiming(period:HoldConditions['period'],now:Date){
 if(now>=new Date(normalizePeriod(period).dueAt))return 'RETURN_DUE_PASSED' as const;
 if(!physicalPickupWindow(period,now))return 'OUTSIDE_HANDOVER_WINDOW' as const;
 return new Date(now.getTime()+9*3600000).toISOString().slice(0,10)>period.startDate?'LATE_PICKUP_ELIGIBLE' as const:'PICKUP_WINDOW' as const;
}
