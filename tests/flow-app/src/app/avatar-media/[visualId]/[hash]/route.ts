import {GET as productGet} from '../../../../../../../apps/web/src/app/avatar-media/[visualId]/[hash]/route';
export const dynamic='force-dynamic';
export const runtime='nodejs';
// Fixture-only stage markers. This cannot observe failures before module evaluation.
console.error('TEST_AVATAR_ROUTE MODULE_READY');
export async function GET(request:Request){
 console.error('TEST_AVATAR_ROUTE GET_ENTER');
 const response=await productGet(request);
 console.error(response.status===200?'TEST_AVATAR_ROUTE RETURN_200':response.status===404?'TEST_AVATAR_ROUTE RETURN_404':'TEST_AVATAR_ROUTE RETURN_OTHER');
 return response;
}
