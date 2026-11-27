import {FlowError} from '../../../contracts/src/rental-flow';
import {storeDisplayName} from '../../../contracts/src/store-display';
import {MAX_ADMIN_MESSAGE} from '../../../contracts/src/group-order';
import {escapeHtml} from '../notification/contracts';

/** Customer e-mail for the group-order flow (GROUP_NOTIFICATION_V1). Pure: input is materialized from canonical rows by the worker,
 * never from browser text. Only five events exist; there is no expiry / extension notice because a group hold has neither.
 * The body never carries internal notes, release reasons, body measurements or a member CSV. */
export const GROUP_NOTIFICATION_EVENTS=['GROUP_REVIEW_HELD','GROUP_CONFIRMED','GROUP_CHANGES_REQUESTED','GROUP_RELEASED','GROUP_CANCELLED'] as const;
export type GroupNotificationEvent=typeof GROUP_NOTIFICATION_EVENTS[number];
export type GroupNotificationMaterial={
 event:GroupNotificationEvent;locale:'ja'|'en';groupId:string;groupNumber:string;memberCount:number;
 period:{startDate:string;endDate:string;slot?:string};pickupStore:string;returnStore:string;
 /** REVIEW_HELD: advisory tax-included estimate (not a confirmed price). */
 estimateJpy?:number|null;
 /** CONFIRMED: immutable amounts of the confirming event. */
 confirmed?:{subtotalJpy:number;discountJpy:number;totalJpy:number};
 /** CANCELLED: on-site receipts that staff must handle by hand (never an automatic refund). */
 receivedJpyNeedsManual?:number;
 adminMessage?:string|null;
};
/** Where the representative opens their own group. It carries the group id only (not a secret): access is granted by the owner
 * cookie of that group (or the saved resume link, pasted on the page). The page lives at /{locale}/group/g/{groupId}, which needs no entrance token,
 * so it keeps working after the entrance is stopped or re-issued. No secret ever appears in a mail link. */
export type GroupLinkBuilder=(m:{origin:string;locale:'ja'|'en';groupId:string;groupNumber:string})=>string;
export const defaultGroupLink:GroupLinkBuilder=({origin,locale,groupId})=>`${origin}/${locale}/group/g/${encodeURIComponent(groupId)}`;

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const brand='SALOMON RENTAL STATION ZAO';
const yen=(n:number)=>'¥'+n.toLocaleString('en-US');
/** Header-injection / control-character guard for a value placed in a subject line or a label (never the admin message body). */
const single=(v:string)=>{if(/[\r\n\u0000-\u001f]/.test(v))throw new FlowError('NOTIFICATION_SNAPSHOT_INVALID',503);return v;};

export function normalizeAdminMessage(value:string|null|undefined):string|null{
 if(value===undefined||value===null||value==='')return null;
 if(typeof value!=='string'||value.length>MAX_ADMIN_MESSAGE||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw new FlowError('NOTIFICATION_SNAPSHOT_INVALID',503);
 return value.replace(/\r\n?/g,'\n').trim()||null;
}

export function renderGroupNotification(m:GroupNotificationMaterial,origin:string,link:GroupLinkBuilder=defaultGroupLink){
 const u=new URL(origin);
 if(u.origin!==origin||!['http:','https:'].includes(u.protocol)||u.username||u.password||(u.protocol==='http:'&&u.hostname!=='127.0.0.1'))throw new FlowError('NOTIFICATION_CONFIGURATION_INVALID',503);
 const ja=m.locale==='ja',t=(j:string,e:string)=>ja?j:e;
 if(!(GROUP_NOTIFICATION_EVENTS as readonly string[]).includes(m.event)||!['ja','en'].includes(m.locale)||!UUID.test(m.groupId)||!/^G-\d{6,}$/.test(m.groupNumber)
  ||!Number.isInteger(m.memberCount)||m.memberCount<1||m.memberCount>100||![m.period.startDate,m.period.endDate].every(d=>/^\d{4}-\d{2}-\d{2}$/.test(d))
  ||![m.pickupStore,m.returnStore].every(s=>/^[-A-Z_]{1,64}$/.test(s)))throw new FlowError('NOTIFICATION_SNAPSHOT_INVALID',503);
 const num=(v:unknown)=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)throw new FlowError('NOTIFICATION_SNAPSHOT_INVALID',503);return v;};
 const message=normalizeAdminMessage(m.adminMessage);
 const number=single(m.groupNumber);
 const period=m.period.startDate===m.period.endDate?m.period.startDate:`${m.period.startDate} - ${m.period.endDate}`;
 const store=m.pickupStore===m.returnStore?storeDisplayName(m.pickupStore):t(`受取 ${storeDisplayName(m.pickupStore)} / 返却 ${storeDisplayName(m.returnStore)}`,`Pickup ${storeDisplayName(m.pickupStore)} / return ${storeDisplayName(m.returnStore)}`);
 const base:[string,string][]=[[t('団体番号','Group number'),number],[t('ご利用期間','Rental period'),period],[t('受取・返却店舗','Station'),store],[t('人数','People'),t(`${m.memberCount}名`,String(m.memberCount))]];
 const href=link({origin,locale:m.locale,groupId:m.groupId,groupNumber:number});
 const hu=new URL(href);if(hu.origin!==origin||hu.search||hu.hash)throw new FlowError('NOTIFICATION_CONFIGURATION_INVALID',503);
 let subject:string,title:string,rows=base,notes:string[]=[],status:string|null=null;
 if(m.event==='GROUP_REVIEW_HELD'){
  subject=t(`【確認待ち・まだ予約確定ではありません】団体予約 ${number} の確認依頼を受け付けました`,`[Pending review - not yet confirmed] Group request ${number} received`);
  title=t('団体予約の確認依頼を受け付けました','We received your group reservation request');
  status=t('現在仮押さえ中・管理者確認待ち・まだ予約確定ではありません','Currently on hold, waiting for staff review, not yet a confirmed reservation');
  rows=[...base,...(m.estimateJpy===null||m.estimateJpy===undefined?[]:[[t('暫定税込額','Provisional total (tax included)'),yen(num(m.estimateJpy))] as [string,string]]),[t('状態','Status'),status]];
  notes=[t('現在、ご希望の用品を仮押さえしています。これは予約の確定ではありません。管理者が内容を確認し、確定または変更のご相談をご連絡します。','Your requested items are currently on hold. This is not a confirmed reservation. Our staff will review the request and contact you to confirm it or to discuss changes.'),
   t('金額は暫定です。確定金額は確約のご連絡でお知らせします。お支払いは現地精算です。','The amount is provisional. The confirmed amount is sent with the confirmation. Payment is made on site.')];
 }else if(m.event==='GROUP_CONFIRMED'){
  const c=m.confirmed;if(!c)throw new FlowError('NOTIFICATION_SNAPSHOT_INVALID',503);
  const sub=num(c.subtotalJpy),dis=num(c.discountJpy),tot=num(c.totalJpy);if(sub-dis!==tot)throw new FlowError('NOTIFICATION_SNAPSHOT_INVALID',503);
  subject=t(`【ご予約確定】団体予約 ${number} が確定しました`,`[Confirmed] Group reservation ${number} is confirmed`);
  title=t('団体予約が確定しました','Your group reservation is confirmed');
  status=tot===0?t('確定済み・お支払いは不要です','Confirmed, no payment is due'):t('確定済み・現地精算（まだお支払いは完了していません）','Confirmed, payment on site (nothing has been paid yet)');
  rows=[...base,[t('割引前の金額（税込）','Amount before discount (tax included)'),yen(sub)],[t('割引額','Discount'),'-'+yen(dis)],[t('確定総額（税込）','Confirmed total (tax included)'),yen(tot)],[t('お支払い','Payment'),status]];
  notes=[t('ご用意した用品を確定しました。お支払いはご利用時に店舗でお願いします。','Your items are confirmed. Please pay at the station when you pick up.')];
 }else if(m.event==='GROUP_CHANGES_REQUESTED'){
  subject=t(`【ご確認のお願い】団体予約 ${number} の内容についてご相談があります`,`[Action needed] About your group request ${number}`);
  title=t('団体予約の内容について管理者からご相談です','Our staff has a request about your group reservation');
  status=t('仮押さえは継続中・まだ予約確定ではありません','Items remain on hold, not yet a confirmed reservation');
  rows=[...base,[t('状態','Status'),status]];
  notes=[t('下記のメッセージをご確認のうえ、団体の確認ページから内容をご連絡ください。','Please read the message below and reply from your group page.')];
 }else if(m.event==='GROUP_RELEASED'){
  subject=t(`【仮押さえ解除】団体予約 ${number} の用品の仮押さえを解除しました`,`[Hold released] The hold for group request ${number} has been released`);
  title=t('仮押さえを解除しました','Your hold has been released');
  status=t('仮押さえは解除されました。予約は確定していません','The hold was released. No reservation was made');
  rows=[...base,[t('状態','Status'),status]];
  notes=[t('用品の仮押さえは解除されました。ご利用をご希望の場合は、あらためてお申込みください。','The items are no longer held. If you still want to rent, please submit a new request.')];
 }else{
  subject=t(`【ご予約取消】団体予約 ${number} を取り消しました`,`[Cancelled] Group reservation ${number} has been cancelled`);
  title=t('団体予約を取り消しました','Your group reservation was cancelled');
  status=t('取消済み','Cancelled');rows=[...base,[t('状態','Status'),status]];
  notes=[t('確定していた団体予約を取り消し、用品の確保を解除しました。','The confirmed group reservation was cancelled and the items were released.')];
  if(typeof m.receivedJpyNeedsManual==='number'&&num(m.receivedJpyNeedsManual)>0)notes.push(t('現地でお支払い済みの金額の取り扱いは、店舗よりあらためてご案内します。','Our station will contact you separately about any amount you already paid on site.'));
 }
 const linkLabel=m.event==='GROUP_RELEASED'||m.event==='GROUP_CANCELLED'?t('団体予約の内容を見る','View your group reservation'):t('団体予約の状況を確認する','Check your group reservation');
 const msgHead=t('管理者からのメッセージ','Message from our staff');
 const text=[title,'',...rows.map(([k,v])=>`${k}: ${v}`),...(notes.length?['',...notes]:[]),
  ...(message?['','---- '+msgHead+' ----',message,'---- '+t('メッセージここまで','end of message')+' ----']:[]),
  '',`${linkLabel}: ${href}`,'','- '+brand].join('\n');
 const html=`<!doctype html><html lang="${m.locale}"><body style="margin:0;padding:24px;background:#f4f4f2;color:#111;font-family:-apple-system,'Helvetica Neue',Arial,sans-serif"><div style="max-width:560px;margin:0 auto;background:#fff;border-top:6px solid #111"><div style="padding:24px 24px 8px"><p style="margin:0;font-size:12px;letter-spacing:.12em;font-weight:700">${escapeHtml(brand)}</p><h1 style="margin:12px 0 0;font-size:22px">${escapeHtml(title)}</h1></div><table role="presentation" style="width:100%;border-collapse:collapse;margin:16px 0">${rows.map(([k,v])=>`<tr><th align="left" style="padding:8px 24px;font-size:13px;color:#555;font-weight:400;width:40%;border-top:1px solid #eee">${escapeHtml(k)}</th><td style="padding:8px 24px;font-size:15px;font-weight:700;border-top:1px solid #eee">${escapeHtml(v)}</td></tr>`).join('')}</table>${notes.map(n=>`<p style="margin:0 24px 12px;font-size:14px;line-height:1.6">${escapeHtml(n)}</p>`).join('')}${message?`<div style="margin:16px 24px;padding:12px 16px;border-left:4px solid #111;background:#f4f4f2"><p style="margin:0 0 6px;font-size:12px;color:#555">${escapeHtml(msgHead)}</p><div style="font-size:14px;line-height:1.6;white-space:pre-wrap">${escapeHtml(message)}</div></div>`:''}<div style="padding:8px 24px 24px"><p style="margin:8px 0"><a href="${escapeHtml(href)}" style="color:#111;font-weight:700">${escapeHtml(linkLabel)}</a></p></div></div></body></html>`;
 return {subject,text,html};
}
