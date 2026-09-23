'use client';
import Script from 'next/script';
import {useEffect,useId,useRef,useState} from 'react';
type Card={attach:(element:HTMLElement)=>Promise<void>;destroy:()=>Promise<void>;tokenize:(verification:{amount:string;currencyCode:'JPY';intent:'CHARGE';customerInitiated:true;sellerKeyedIn:false;billingContact:{email:string}})=>Promise<{status:string;token?:string}>};
type Square={payments:(applicationId:string,locationId:string)=>{card:()=>Promise<Card>}};
/** Card details stay inside Square's iframe. The resulting token is used once in the
 * current request and is never written to browser storage, URLs or the booking DB. */
export function SquareCardPayment({applicationId,locationId,amountJpy,email,locale,disabled,onPay}:{applicationId:string;locationId:string;amountJpy:number;email:string;locale:'ja'|'en';disabled:boolean;onPay:(token:string)=>Promise<void>}){
 const container=useRef<HTMLDivElement>(null),card=useRef<Card|null>(null),sending=useRef(false),id=useId();
 const [loaded,setLoaded]=useState(false),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(false);
 useEffect(()=>{if(!loaded)return;let active=true,instance:Card|null=null;
  void (async()=>{try{const sdk=(window as Window&{Square?:Square}).Square;if(!sdk||!container.current)throw Error();instance=await sdk.payments(applicationId,locationId).card();if(!active){await instance.destroy();return;}await instance.attach(container.current);if(active){card.current=instance;setReady(true);}}catch{if(active)setError(true);}})();
  return ()=>{active=false;card.current=null;setReady(false);if(instance)void instance.destroy();};
 },[loaded,applicationId,locationId]);
 async function pay(){if(sending.current||!card.current||disabled)return;sending.current=true;setBusy(true);setError(false);try{const result=await card.current.tokenize({amount:String(amountJpy),currencyCode:'JPY',intent:'CHARGE',customerInitiated:true,sellerKeyedIn:false,billingContact:{email}});if(result.status!=='OK'||!result.token)throw Error();await onPay(result.token);}catch{setError(true);}finally{sending.current=false;setBusy(false);}}
 return <section aria-labelledby={id}><h3 id={id}>{locale==='ja'?'カードで支払う':'Pay by card'}</h3><Script src="https://web.squarecdn.com/v1/square.js" strategy="afterInteractive" onReady={()=>setLoaded(true)} onError={()=>setError(true)}/><div ref={container}/>{error&&<p role="alert">{locale==='ja'?'カード情報または決済状況を確認してください。':'Please check your card details or the saved payment status.'}</p>}<button disabled={disabled||busy||!ready||!Number.isSafeInteger(amountJpy)||amountJpy<1} aria-busy={busy} onClick={()=>void pay()}>{locale==='ja'?'支払って予約を確定':'Pay and confirm booking'} · {new Intl.NumberFormat(locale==='ja'?'ja-JP':'en-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}).format(amountJpy)}</button></section>;
}
