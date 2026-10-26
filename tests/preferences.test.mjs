import {pageIdentity} from '../embed/src/preferences.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {preferences,themes,panelPlacement} from '../embed/src/preferences.ts';
test('preferences accept only supported themes, sizes, sides and boolean controls',()=>{
 const defaults={theme:'graphite',side:'left',size:'standard',pauseAnimations:false,hideDots:false};
 assert.deepEqual(preferences(null),defaults);assert.deepEqual(preferences({theme:'unknown',side:'bottom',size:'huge',pauseAnimations:'true',hideDots:1}),defaults);
 for(const theme of themes)assert.equal(preferences({theme}).theme,theme);
 assert.deepEqual(preferences({theme:'pink',side:'right',size:'large',pauseAnimations:true,hideDots:true}),{theme:'pink',side:'right',size:'large',pauseAnimations:true,hideDots:true});
});
test('panels reserve space beside both sidebar positions when it fits',()=>{
 const viewport={width:1280,height:900},panel={width:400,height:700};
 const left=panelPlacement({x:0,y:900},viewport,panel,{side:'left',width:380});
 assert.equal(left.left,392);assert.equal(left.top,188);
 const right=panelPlacement({x:1270,y:0},viewport,panel,{side:'right',width:380});
 assert.equal(right.left+panel.width,888);assert.equal(right.top,16);
});
test('small screens and oversized panels stay inside the viewport margins',()=>{
 const p=panelPlacement({x:900,y:900},{width:390,height:844},{width:400,height:820},{side:'right',width:380});
 assert.deepEqual(p,{left:12,top:12});
});

test('page identity keeps meaningful query parameters separate while ignoring tracking and fragments',()=>{assert.equal(pageIdentity('https://example.test/a?id=1&utm_source=email#part'),'https://example.test/a?id=1');assert.notEqual(pageIdentity('https://example.test/a?id=1'),pageIdentity('https://example.test/a?id=2'));});
