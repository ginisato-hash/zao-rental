/** Store display dictionary (Owner 2026-10-10). Display only: internal IDs, DB keys, API payloads, URLs, Square locations and
 * history keep MOUNTAIN_BASE / ONSEN_BASE. Every customer, staff, mail and document surface renders names through here. */
export const STORE_DISPLAY_NAMES:Readonly<Record<'MOUNTAIN_BASE'|'ONSEN_BASE',string>>=Object.freeze({MOUNTAIN_BASE:'Mountain Station',ONSEN_BASE:'Central Station'});
/** Display name for a store ID; non-store scopes (e.g. SYSTEM) are returned unchanged. */
export function storeDisplayName(id:string):string{return (STORE_DISPLAY_NAMES as Record<string,string>)[id]??id;}
