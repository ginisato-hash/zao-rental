import {TLSSocket,checkServerIdentity} from 'node:tls';
import type {PoolConfig} from 'pg';
export const phase6NeonHostname='ep-winter-lake-b3fd2qtp.c-4.ap-southeast-1.aws.neon.tech';
/** Inspect the established client transport, not the proxy-to-compute pg_stat_ssl row.
 * pg8/Node24 internals are deliberately pinned; a changed shape fails closed. No raw
 * certificate, socket, connection options or driver errors leave this boundary. */
export function proveNeonClientTls(client:unknown,config:Pick<PoolConfig,'host'|'ssl'>,env:Readonly<Record<string,string|undefined>>=process.env){
 try{
  if(config.host!==phase6NeonHostname||!config.host.endsWith('.neon.tech')||typeof config.ssl!=='object'||!config.ssl||Object.keys(config.ssl).join()!=='rejectUnauthorized'||config.ssl.rejectUnauthorized!==true)throw 0;
  if(['NODE_TLS_REJECT_UNAUTHORIZED','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','SSL_CERT_DIR'].some(k=>env[k]!==undefined))throw 0;
  const connection=(client as {connection?:{stream?:unknown;ssl?:unknown}}).connection,stream=connection?.stream;
  if(!(stream instanceof TLSSocket)||stream.encrypted!==true||stream.authorized!==true)throw 0;
  const options=Reflect.get(stream,'_tlsOptions') as {rejectUnauthorized?:unknown}|undefined;
  if(options?.rejectUnauthorized!==true||Reflect.get(stream,'servername')!==config.host)throw 0;
  const protocol=stream.getProtocol(),cert=stream.getPeerCertificate();
  if(!['TLSv1.2','TLSv1.3'].includes(protocol??'')||!cert.raw?.length||checkServerIdentity(config.host,cert)!==undefined)throw 0;
  return {hostClass:'EXPECTED_NEON_ENDPOINT',serverNameClass:'EXACT_EXPECTED_SNI',encrypted:true,authorized:true,rejectUnauthorized:true,peerCertificatePresent:true,hostnameVerified:true,protocol};
 }catch{throw Error('PHASE6_CLIENT_TLS_PROOF_FAILED');}
}
