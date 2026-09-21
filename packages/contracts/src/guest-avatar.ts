export type GuestAvatarScope={draftId:string;revision:number;memberKey:string};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
/** Strict local path identifiers, never a free URL, token or authorization claim. */
export function guestAvatarScope(draftId:string,revision:string,memberKey:string):GuestAvatarScope|null{
 if(!uuid.test(draftId)||!/^\d{1,10}$/.test(revision)||String(Number(revision))!==revision||Number(revision)<1||!Number.isSafeInteger(Number(revision))||!/^[A-Za-z0-9_-]{1,100}$/.test(memberKey))return null;
 return {draftId,revision:Number(revision),memberKey};
}
export function guestAvatarPath(scope:GuestAvatarScope){
 return guestAvatarScope(scope.draftId,String(scope.revision),scope.memberKey)?scope.draftId+'/'+scope.revision+'/'+scope.memberKey:null;
}
