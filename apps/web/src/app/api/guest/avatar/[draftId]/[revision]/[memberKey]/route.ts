import {guestAvatarHandler} from '../../../../../../../lib/guest-avatar-http';
import {guestAvatarBoundary} from '../../../../../../../lib/guest-avatar-runtime';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export const GET=guestAvatarHandler(guestAvatarBoundary,false);
