// Only the owned development launcher supplies these in-memory settings. No ambient DB URL.
export type Connection = {host:'127.0.0.1';port:number;database:string;user:string;password:string};
export type DevelopmentRuntime = {origin:string; namespace:string; authSecret:string; authDb:Connection; ledgerDb:Connection; holdDb:Connection;transferDb:Connection};
export function parseRuntime(raw:string|undefined):DevelopmentRuntime|null {
 if(!raw)return null;
 try {
  const c=JSON.parse(raw) as DevelopmentRuntime;const origin=new URL(c.origin);
  if(origin.protocol!=='http:'||origin.hostname!=='127.0.0.1'||origin.origin!==c.origin||!/^zr_[a-f0-9]{12}$/.test(c.namespace)||!/^\d+$/.test(origin.port)||Number(origin.port)<30000||Number(origin.port)>39000||!c.authSecret||c.authSecret.length<32)throw 0;
  for(const [db,suffix] of [[c.authDb,'auth'],[c.ledgerDb,'ledger'],[c.holdDb,'hold'],[c.transferDb,'transfer']] as const){if(db.host!=='127.0.0.1'||db.database!==c.namespace||db.user!==`${c.namespace}_${suffix}`||!db.password||!Number.isInteger(db.port)||db.port<20000||db.port>29000)throw 0;}
  if(c.authDb.port!==c.ledgerDb.port||c.authDb.port!==c.holdDb.port||c.authDb.port!==c.transferDb.port)throw 0;

  return c;
 }catch{throw new Error('INVALID_DEVELOPMENT_RUNTIME');}
}
