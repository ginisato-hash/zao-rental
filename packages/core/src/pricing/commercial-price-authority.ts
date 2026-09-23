import equipment from '../../../../config/pricing/zao-2026-27-v1.draft.json';
import wear from '../../../../config/pricing/wear-v1.2.proposed.json';
import {exactProductionIdentityConfiguration,type ExactProductionIdentity} from '../../../auth/src/production-identity';
import {flowHash,flowId} from '../../../contracts/src/rental-flow';
import {PricingError,WEAR_TABLE,type PriceTable} from '../../../contracts/src/pricing';

/** Owner-approved existing arithmetic and tables, adopted by the 2026-09-23 takeover.
 * Literal digests deliberately do not follow edits to either source automatically. */
export const APPROVED_COMMERCIAL_PRICE = Object.freeze({
  version: 'ZAO_COMMERCIAL_PRICE_V1',
  priceBookKey: 'ZAO_2026_27_V1',
  documentRevision: '0.3',
  bookRevision: 2,
  wearRevision: 'ZAO-WEAR-CATALOG-UX-20260913-V1_2',
  equipmentSha256: 'ffd9fb8b8022952a397dd15693fd23b28e2f063b84f83c6a053e208863c948f8',
  wearSha256: '5a2d91b74d5357e4b833880f8db59040d8a041fe0da9deb398399a929920f619',
  tablesSha256: '12a7a493f33dc4ea46a12c7f0dc2f770938b81598721d78672985469fccd64d5',
});
export type CommercialPriceBook = Readonly<{id:string;revision:number;source_sha256:string;table_jpy:PriceTable;state:string}>;
export type CommercialPriceAuthority = Readonly<{kind:'COMMERCIAL_PRICE_AUTHORITY'}>;
export type ApprovedCommercialPricePermit = Readonly<{kind:'APPROVED_COMMERCIAL_PRICE_PERMIT'}>;
const authorities = new WeakSet<CommercialPriceAuthority>();
const permits = new WeakMap<ApprovedCommercialPricePermit,Readonly<{authority:CommercialPriceAuthority;facts:CommercialPriceFacts}>>();
type CommercialPriceFacts = ReturnType<typeof deriveApprovedCommercialPriceFacts>;

/** Pure validation/derivation: no capability or I/O. A record ID is bound into each permit;
 * the approved logical PriceBook, source revisions, table digest and DB revision are pinned. */
export function deriveApprovedCommercialPriceFacts(book:CommercialPriceBook) {
  flowId(book.id);
  const approved=APPROVED_COMMERCIAL_PRICE;
  if(equipment.price_book_key!==approved.priceBookKey||equipment.document_version!==approved.documentRevision||wear.proposal_id!==approved.wearRevision||
    flowHash(equipment)!==approved.equipmentSha256||flowHash(wear)!==approved.wearSha256||
    book.state!=='PRIVATE_AVAILABLE'||book.revision!==approved.bookRevision||book.source_sha256!==approved.equipmentSha256||
    flowHash({equipment:book.table_jpy,wear:WEAR_TABLE})!==approved.tablesSha256)throw new PricingError('COMMERCIAL_PRICE_NOT_APPROVED',503);
  return Object.freeze({approvalVersion:approved.version,priceBookKey:approved.priceBookKey,priceBookId:book.id,revision:book.revision,sourceSha256:book.source_sha256,tablesSha256:approved.tablesSha256,wearRevision:approved.wearRevision});
}
export function issueCommercialPriceAuthority(identity:ExactProductionIdentity):CommercialPriceAuthority {
  if(!exactProductionIdentityConfiguration(identity))throw new PricingError('PRODUCTION_IDENTITY_REQUIRED',503);
  const authority=Object.freeze({kind:'COMMERCIAL_PRICE_AUTHORITY' as const});authorities.add(authority);return authority;
}
export function issueApprovedCommercialPricePermit(authority:CommercialPriceAuthority,book:CommercialPriceBook):ApprovedCommercialPricePermit {
  if(!authorities.has(authority))throw new PricingError('COMMERCIAL_PRICE_AUTHORITY_REQUIRED',503);
  const facts=deriveApprovedCommercialPriceFacts(book),permit=Object.freeze({kind:'APPROVED_COMMERCIAL_PRICE_PERMIT' as const});
  permits.set(permit,Object.freeze({authority,facts}));return permit;
}
export function approvedCommercialPricePermitAuthority(permit?:ApprovedCommercialPricePermit):CommercialPriceAuthority|null {
  return permit?permits.get(permit)?.authority??null:null;
}
export function approvedCommercialPricePermitFacts(permit:ApprovedCommercialPricePermit,book:CommercialPriceBook):CommercialPriceFacts|null {
  const issued=permits.get(permit);if(!issued)return null;
  try{const current=deriveApprovedCommercialPriceFacts(book);return flowHash(current)===flowHash(issued.facts)?issued.facts:null;}catch{return null;}
}
/** The calculation stays unchanged; only an issued permit can attach commercial authority.
 * Both the record and its revision/digests are checked again at use, so mutation invalidates it. */
export function commercialPriceApproval(authority:CommercialPriceAuthority,book:CommercialPriceBook):CommercialPriceFacts {
  const permit=issueApprovedCommercialPricePermit(authority,book),facts=approvedCommercialPricePermitFacts(permit,book);
  if(!facts)throw new PricingError('COMMERCIAL_PRICE_NOT_APPROVED',503);return facts;
}
