// Retired: advertisement buttons use the read-only /api/encar-id flow.
// Keep old clients from invoking discovery, page navigation or price extraction.
import { hardenAPIResponse } from '../_shared/api-security.js';
export async function onRequest(){
 return hardenAPIResponse(Response.json({ok:false,code:'LOOKUP_REPLACED',error:'광고 ID 확인 기능으로 변경됐습니다. 페이지를 새로고침해 주세요.'},{status:410}));
}
