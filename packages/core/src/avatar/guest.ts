import type {Pool} from 'pg';
import {GuestContexts,guestToken} from '../guest/context';
import {HoldError} from '../../../contracts/src/hold';
import type {GuestAvatarScope} from '../../../contracts/src/guest-avatar';
import type {VisualRef} from '../../../contracts/src/avatar-visualization';
import {loadAvatarPreview,type AvatarPreviewPayloads} from './preview';
import type {AvatarVisualReader} from './visualization';
/** Read only the current context's saved preview; never create/recompute a preview. */
export async function loadGuestAvatar(contexts:GuestContexts,pool:Pick<Pool,'query'>,reader:AvatarVisualReader,headers:Headers,scope:GuestAvatarScope){
 const actor=await contexts.resolve(guestToken(headers)),before=await contexts.read(actor);
 if(before.id!==scope.draftId||before.revision!==scope.revision||!before.preview_id)throw new HoldError('FORBIDDEN',403);
 const payloads=await loadAvatarPreview(pool,actor,before.preview_id,scope.memberKey,reader,new Date());
 const after=await contexts.read(actor);
 if(after.id!==before.id||after.revision!==before.revision||after.preview_id!==before.preview_id)throw new HoldError('FORBIDDEN',403);
 return {payloads,previewId:before.preview_id};
}
export function offeredAvatarVisual(payloads:AvatarPreviewPayloads,id:string,digest:string):VisualRef|null{
 const matches=Object.values(payloads).flatMap(v=>v?[v.avatar,v.boot,v.jacket,v.pants,...Object.values(v.candidates).map(c=>c?.visual??null)]:[]).filter((v):v is VisualRef=>!!v&&v.id===id&&v.derivativeSha256===digest);
 return matches[0]??null;
}
