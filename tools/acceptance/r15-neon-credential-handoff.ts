import type {PoolConfig} from 'pg';

const database='zr_852b20c4d4b0';
const ready={status:'READY',hostClassification:'NEON_HOSTED',database,ssl:true} as const;
type Failure='RAW_FIELD_UNAVAILABLE'|'CONNECTION_REJECTED'|'CONSUMER_FAILED'|'SOURCE_CLOSE_FAILED';
export type HandoffResult=typeof ready|{status:'BLOCKED_CREDENTIAL_HANDOFF_V2';classification:Failure};
export interface RawConnectionSource {
  // Read one raw input/textarea value, never rendered code, body text or a clipboard.
  // The source owns browser references and clears them in close(). No retry here.
  readRawConnectionString():Promise<string>;
  close():Promise<void>;
}

function parse(raw:string):PoolConfig {
  // Reject pasted shell snippets and URL-parser whitespace normalization.
  if(raw!==raw.trim()||/\s/.test(raw))throw Error('REJECTED');
  const url=new URL(raw);
  const host=url.hostname.toLowerCase();
  const user=decodeURIComponent(url.username),password=decodeURIComponent(url.password);
  const sourceDatabase=decodeURIComponent(url.pathname.slice(1));
  const port=url.port?Number(url.port):5432;
  if(!['postgres:','postgresql:'].includes(url.protocol)||!user||!password||
    !host.endsWith('.neon.tech')||host==='.neon.tech'||
    !Number.isInteger(port)||port<1||port>65535||url.hash||
    user.includes('\0')||password.includes('\0')||sourceDatabase.includes('\0')||
    /^[*•]+$/.test(password)||password==='YOUR_PASSWORD'||password==='[YOUR_PASSWORD]')throw Error('REJECTED');
  const mode=url.searchParams.get('sslmode');
  if(mode&&!['require','verify-ca','verify-full'].includes(mode))throw Error('REJECTED');
  // Provider query parameters never override credentials, target or TLS. Other safe
  // provider options may be present; only channel_binding affects this pg config.
  return {host,port,user,password,database,ssl:{rejectUnauthorized:true},
    enableChannelBinding:url.searchParams.get('channel_binding')==='require',
    connectionTimeoutMillis:20000,idleTimeoutMillis:5000,max:2,
    application_name:'zao_rental_r15_f3_handoff_v2'};
}

/** Same-process scope: construct/use/close all pg clients inside consume().
 * Never return the config, client, raw input, consumer return value or original errors.
 * This function neither logs nor performs a credential retry. One-shot dispatch
 * authority is enforced separately by the local browser operator's durable guard.
 */
export async function withNeonCredential(
  source:RawConnectionSource,consume:(config:PoolConfig)=>Promise<void>,
):Promise<HandoffResult> {
  let raw='',config:PoolConfig|undefined;
  let phase:Failure='RAW_FIELD_UNAVAILABLE';
  let result:HandoffResult;
  try {
    raw=await source.readRawConnectionString();
    phase='CONNECTION_REJECTED';
    config=parse(raw);
    raw='';
    phase='CONSUMER_FAILED';
    await consume(config);
    result={...ready};
  } catch {
    result={status:'BLOCKED_CREDENTIAL_HANDOFF_V2',classification:phase};
  } finally {
    raw='';
    if(config){config.password=undefined;config.user=undefined;config.host=undefined;}
    config=undefined;
    try {await source.close();} catch {
      result={status:'BLOCKED_CREDENTIAL_HANDOFF_V2',classification:'SOURCE_CLOSE_FAILED'};
    }
  }
  return result;
}
