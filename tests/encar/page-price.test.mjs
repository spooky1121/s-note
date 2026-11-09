import test from 'node:test';
import assert from 'node:assert/strict';
import './html-rewriter-setup.mjs';
import { parseEncarPagePrice } from '../../functions/_shared/encar-page-price.mjs';

test('seller-page visible won-unit text yields one review candidate with exact KRW conversion',async()=>{
 const value=await parseEncarPagePrice('<main><h1>합성 검증 차량</h1><section><div>판매가격 <strong>5,490</strong><span>만원</span></div></section></main>');
 assert.deepEqual(value,{candidate:{display:'5,490만원',priceWon:54900000},code:null});
});
test('page review strips scripts, style, noscript, template, comments and non-page visual sources',async()=>{
 const html='<head><title>9,999만원</title><meta content="9,999만원"></head><script>window.secret="9,999만원"</script><style>.a{content:"9,999만원"}</style><noscript>9,999만원</noscript><template>9,999만원</template><!-- 9,999만원 --><iframe>9,999만원</iframe><svg><text>9,999만원</text></svg><aside>9,999만원</aside><nav>9,999만원</nav><footer>9,999만원</footer><select><option>9,999만원</option></select><textarea>9,999만원</textarea><main><div>차량 가격 5,490만원</div></main>';
 assert.deepEqual((await parseEncarPagePrice(html)).candidate,{display:'5,490만원',priceWon:54900000});
});
test('known hidden markup and obfuscated inline visibility cannot contribute an amount',async t=>{
 for(const attrs of['hidden','hidden="false"','aria-hidden="true"','inert','style="display: none!important"','style="visibility:hidden"','style="opacity:0"','style="content-visibility:hidden"','class="desktop-hidden"','class="sr-only"','style="display/**/:none"'])await t.test(attrs,async()=>{
  const row=await parseEncarPagePrice('<div '+attrs+'><strong>9,999만원</strong></div><main><p>5,490만원</p></main>');assert.equal(row.candidate?.priceWon,54900000);
 });
});
test('entities and inline numeric chunks are supported without source JavaScript evaluation',async()=>{
 const value=await parseEncarPagePrice('<main><div>판매가&nbsp;<strong>5&#44;490</strong><span>&#47564;&#50896;</span></div></main>');assert.equal(value.candidate?.priceWon,54900000);
});
test('a visibly nonzero opacity does not hide the seller price',async()=>{
 assert.equal((await parseEncarPagePrice('<main style="opacity:0.5">5,490만원</main>')).candidate?.priceWon,54900000);
 assert.equal((await parseEncarPagePrice('<main style="opacity:.0 !important">5,490만원</main>')).candidate,null);
});
test('multiple amounts, monthly/finance costs and split or mixed-unit amounts do not create a unique review quote',async t=>{
 for(const text of['판매가 5,490만원\n다른 금액 4,990만원','월 납입금 29만원','보험료 10만원','할부 49만원','리스료 59만원','1억 5,490만원','5 490만원','5\n\n490만원','1억\n\n5,490만원','월\n\n49만원','5,490만원~6,000만원'])await t.test(text,async()=>{
  const value=await parseEncarPagePrice('<main>'+text.replaceAll('\n','<br>')+'</main>');assert.equal(value.candidate,null);
 });
});
test('a visible selling amount survives separate excluded monthly amounts',async()=>{
 const value=await parseEncarPagePrice('<main><div>월 납입금 29만원</div><section>차량 판매가 5,490만원</section></main>');assert.equal(value.candidate?.priceWon,54900000);
});
test('complete page parsing fails closed on text limits or unavailable native parser',async()=>{
 assert.equal((await parseEncarPagePrice('<main>'+('문'.repeat(200001))+'5,490만원</main>')).code,'PAGE_TEXT_LIMIT');
 assert.equal((await parseEncarPagePrice('<main>'+('5,490만원<br>'.repeat(1001))+'</main>')).code,'PAGE_TEXT_LIMIT');
 const original=globalThis.HTMLRewriter;try{delete globalThis.HTMLRewriter;assert.equal((await parseEncarPagePrice('<p>5,490만원</p>')).code,'PAGE_PARSER_UNAVAILABLE');}finally{globalThis.HTMLRewriter=original;}
});
test('normalized page limits reject decomposed-unit overflow before a later conflicting amount can be omitted',async()=>{
 const repeated='5,490만원\n'.repeat(999);
 assert.equal((await parseEncarPagePrice('<main>판매가 5,490만원\n'+repeated+'</main>')).candidate?.priceWon,54900000);
 assert.deepEqual(await parseEncarPagePrice('<main>판매가 5,490만원\n'+repeated+'다른금액 4,500만원</main>'),{candidate:null,code:'PAGE_TEXT_LIMIT'});
 assert.deepEqual(await parseEncarPagePrice('<main>판매가 5,490만원\n'+'ﬃ'.repeat(70000)+'</main>'),{candidate:null,code:'PAGE_TEXT_LIMIT'});
});
