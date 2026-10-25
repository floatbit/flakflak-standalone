import test from 'node:test';
import assert from 'node:assert/strict';
import {anchorAt,resolveAnchor} from '../embed/src/anchors.ts';
const page={innerWidth:1200,scrollX:0,scrollY:100};
Object.assign(globalThis,page);
globalThis.CSS={escape:value=>value};
const paragraph={id:'intro',tagName:'P',textContent:' Intro text ',parentElement:null,getBoundingClientRect:()=>({left:100,top:200,width:400,height:100})};
globalThis.document={documentElement:{},querySelectorAll:selector=>selector==='#intro'?[paragraph]:[]};
test('anchors follow their target across responsive layout changes',()=>{
 const a=anchorAt(paragraph,200,250);assert.equal(a.selector,'#intro');assert.equal(a.x,0.25);assert.equal(a.y,0.5);assert.equal(a.documentY,350);
 paragraph.getBoundingClientRect=()=>({left:20,top:40,width:200,height:80});
 assert.deepEqual(resolveAnchor(a),{x:70,y:80,missing:false});
});
test('missing or changed targets use document fallback without selecting unrelated text',()=>{
 const a={selector:'#missing',text:'original',x:0.5,y:0.5,documentX:300,documentY:900,viewportWidth:1200};
 assert.deepEqual(resolveAnchor(a),{x:300,y:800,missing:true});
 a.selector='#intro';assert.equal(resolveAnchor(a).missing,true);
});
