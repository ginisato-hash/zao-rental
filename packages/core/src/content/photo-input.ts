import {ContentInputError} from './bulk-plan';
const maximumBytes=10*1024*1024;
// Buffer's decoder is permissive. Bound allocation first, then round-trip to require
// canonical base64 (no whitespace, URL alphabet, omitted padding or unused pad bits).
// A repeated capturing-group regex over a 10MiB payload can exhaust the JS stack.
export function decodePhotoBase64(value:unknown):Buffer {
 if(typeof value!=='string'||!value.length||value.length%4!==0)throw new ContentInputError('PHOTO_REQUEST');
 if(value.length>4*Math.ceil(maximumBytes/3))throw new ContentInputError('PHOTO_SIZE');
 const bytes=Buffer.from(value,'base64');
 if(bytes.length>maximumBytes)throw new ContentInputError('PHOTO_SIZE');
 if(bytes.toString('base64')!==value)throw new ContentInputError('PHOTO_REQUEST');
 return bytes;
}
