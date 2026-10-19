import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const source=fs.readFileSync(new URL('./acceptance-lifecycle.js',import.meta.url),'utf8');
const rect=(left,top,right,bottom)=>({left,top,right,bottom,width:right-left,height:bottom-top});
function fixture(){
 const state={info:{screenWidth:844,screenHeight:390,windowWidth:844,windowHeight:390,screenTop:0,pixelRatio:3,safeArea:rect(0,47,390,810)},capsule:rect(730,8,830,40),canvas:{width:2532,height:1170,getBoundingClientRect:()=>({left:0,top:0,width:844,height:390})}};
 const context=vm.createContext({GameGlobal:{},wx:{onHide(){},onShow(){},getWindowInfo:()=>state.info,getMenuButtonBoundingClientRect:()=>state.capsule}});
 context.GameGlobal.WXGameKit={gameInstance:{Module:{canvas:state.canvas}}};
 vm.runInContext(source,context);return {state,api:context.FoundationAcceptance,read:()=>JSON.parse(context.FoundationAcceptance.geometryJSON()),context};
}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('portrait-safe coordinates use both landscape rotations and retain bottom bar',()=>{const f=fixture(),g=f.read();assert.equal(g.status,'conservative');near(g.x,47/844);assert.ok(g.x+g.width<=797/844);assert.ok(g.y+g.height<=356/390);assert.ok(g.x+g.width<=730/844 || g.y>=40/390);});
test('opposite landscape/current-coordinate notches avoid either side',()=>{for(const safe of [rect(47,0,844,369),rect(0,0,797,369)]){const f=fixture();f.state.info.safeArea=safe;const g=f.read();assert.equal(g.status,'known');near(g.x,safe.left/844);assert.ok(g.x+g.width<=safe.right/844);assert.ok(g.x+g.width<=730/844 || g.y>=40/390);near(g.y+g.height,369/390);}});
test('window origin is removed from screen safety and capsule coordinates',()=>{const f=fixture();Object.assign(f.state.info,{screenTop:20,windowHeight:350,safeArea:rect(47,25,844,360)});f.state.canvas.getBoundingClientRect=()=>({left:0,top:0,width:844,height:350});f.state.capsule=rect(730,20,830,50);const g=f.read();near(g.y,30/350);near(g.y+g.height,340/350);});
test('actual canvas rectangle size, backing pixels and DPR are independent',()=>{const f=fixture();f.state.canvas.getBoundingClientRect=()=>({left:0,top:0,width:900,height:400});const before=f.read();f.state.canvas.width=900;f.state.canvas.height=400;f.state.info.pixelRatio=1;assert.deepEqual(f.read(),before);near(before.x,47/900);});
test('real Module canvas takes priority over unrelated root canvas',()=>{const f=fixture();f.context.GameGlobal.canvas={width:1,height:1,getBoundingClientRect(){throw Error('PRIVATE');}};assert.equal(f.read().status,'conservative');});
test('the pinned converter fallback is GameGlobal.canvas',()=>{const f=fixture();delete f.context.GameGlobal.WXGameKit;f.context.GameGlobal.canvas=f.state.canvas;assert.equal(f.read().status,'conservative');});
test('capsule subtraction keeps the whole card in one disjoint rectangle',()=>{const f=fixture();f.state.info.safeArea=rect(0,0,844,390);f.state.capsule=rect(300,80,400,160);const g=f.read();assert.equal(g.status,'known');const box=rect(g.x*844,g.y*390,(g.x+g.width)*844,(g.y+g.height)*390);assert.ok(box.left>=400 || box.right<=300 || box.top>=160 || box.bottom<=80);});
test('portrait window is mapped without landscape rotation',()=>{const f=fixture();f.state.info={screenWidth:390,screenHeight:844,windowWidth:390,windowHeight:844,screenTop:0,safeArea:rect(0,47,390,810)};f.state.capsule=rect(280,50,380,82);f.state.canvas.getBoundingClientRect=()=>({left:0,top:0,width:390,height:844});const g=f.read();assert.equal(g.status,'known');near(g.y,82/844);near(g.y+g.height,810/844);});
const DETAIL_KEYS=new Set(['screenWidth','screenHeight','windowWidth','windowHeight','screenTop','originInferred',...['left','top','right','bottom','width','height'].map(k=>'safe_'+k),...['left','top','right','bottom','width','height'].map(k=>'capsule_'+k),...['width','height'].map(k=>'canvas_'+k),...['left','top','x','y','width','height'].map(k=>'client_'+k)]);
function unknown(f,reason){const g=f.read();assert.equal(g.status,'unknown');assert.equal(g.reason,reason);assert.deepEqual(Object.keys(g).sort(),['details','reason','status']);for(const [k,v]of Object.entries(g.details)){assert.ok(DETAIL_KEYS.has(k));assert.equal(typeof v,'number');assert.ok(Number.isFinite(v)&&Math.abs(v)<=10000000);}assert.ok(Object.keys(g.details).length<=29);return g;}
test('missing/malformed/exceptional geometry exposes fixed reasons without stale safe rectangle',()=>{
 const cases=[
  [f=>delete f.state.info.safeArea,'safearea_fields'],
  [f=>f.state.info.safeArea.width++,'safearea_fields'],
  [f=>f.state.info.screenTop=NaN,'window_fields'],
  [f=>f.state.info.screenWidth=0,'window_bounds'],
  [f=>f.state.capsule=null,'capsule_fields'],
  [f=>f.state.canvas.width=0,'canvas_fields'],
  [f=>f.state.canvas.getBoundingClientRect=()=>({left:10,top:0,width:844,height:390}),'canvas_origin'],
  [f=>f.state.canvas.getBoundingClientRect=()=>{throw Error('PRIVATE');},'canvas_exception']
 ];
 for(const [mutate,reason]of cases){const f=fixture();assert.equal(f.read().status,'conservative');mutate(f);unknown(f,reason);}
});
test('absent window/capsule APIs do not imply full-screen safety',()=>{const f=fixture();delete f.context.wx.getMenuButtonBoundingClientRect;unknown(f,'capsule_api');delete f.context.wx.getWindowInfo;unknown(f,'window_api');});
test('subsequent resize/foreground observation never retains an old safe rectangle',()=>{const f=fixture();const original=f.read();f.state.info.safeArea=null;unknown(f,'safearea_fields');f.state.info.safeArea=rect(0,47,390,810);assert.deepEqual(f.read(),original);});
test('the actual IDE API sample and pinned kit client rectangle pass unchanged',()=>{const f=fixture();f.state.info.safeArea=rect(47,0,797,369);f.state.capsule=rect(746,12,834,44);const g=f.read();assert.equal(g.status,'known');near(g.x,47/844);assert.ok(g.y+g.height<=369/390);assert.ok(g.x+g.width<=746/844||g.y>=44/390);});
test('standard x/y DOMRect aliases are accepted without guessing a missing origin',()=>{const f=fixture(),expected=f.read();f.state.canvas.getBoundingClientRect=()=>({x:0,y:0,width:844,height:390});assert.deepEqual(f.read(),expected);f.state.canvas.getBoundingClientRect=()=>({width:844,height:390});unknown(f,'canvas_fields');});
test('contradictory DOMRect aliases and nonzero touch origins remain unknown',()=>{for(const rect of [{left:0,top:0,x:1,y:0,width:844,height:390},{x:0,y:1,width:844,height:390},{left:0,top:0,x:NaN,width:844,height:390}]){const f=fixture();f.state.canvas.getBoundingClientRect=()=>rect;unknown(f,'canvas_origin');}});
test('absent screenTop is inferred only for a full-height window',()=>{const f=fixture(),expected=f.read();delete f.state.info.screenTop;assert.deepEqual(f.read(),expected);f.state.info.windowHeight=380;unknown(f,'window_fields');f.state.info.screenTop=0;assert.equal(f.read().status,'conservative');});
test('inferred origin is reported conservatively even with current-orientation safe area',()=>{const f=fixture();delete f.state.info.screenTop;f.state.info.safeArea=rect(47,0,797,369);assert.equal(f.read().status,'conservative');});
test('one failure still includes independent finite canvas/capsule evidence',()=>{const f=fixture();delete f.state.info.screenTop;f.state.info.windowHeight=380;const g=unknown(f,'window_fields');assert.equal(g.details.windowHeight,380);assert.equal(g.details.client_width,844);assert.equal(g.details.capsule_left,730);assert.ok(!('screenTop'in g.details));});
test('unknown evidence has a bounded numeric whitelist and never copies private values',()=>{const f=fixture();f.state.info.token='PRIVATE_TOKEN';f.state.info.user_id='PRIVATE_ID';f.state.info.screenTop=Infinity;f.state.capsule.secret='PRIVATE_CAPSULE';f.state.canvas.getBoundingClientRect=()=>({left:0,top:0,width:1e100,height:390,secret:'PRIVATE_RECT'});const g=unknown(f,'window_fields');assert.ok(!JSON.stringify(g).includes('PRIVATE'));assert.ok(!('client_width'in g.details));});
test('platform exceptions expose fixed stage reasons and no exception message',()=>{const f=fixture();f.context.wx.getWindowInfo=()=>{throw Error('PRIVATE_WINDOW');};unknown(f,'window_exception');f.context.wx.getWindowInfo=()=>f.state.info;f.context.wx.getMenuButtonBoundingClientRect=()=>{throw Error('PRIVATE_CAPSULE');};const g=unknown(f,'capsule_exception');assert.ok(!JSON.stringify(g).includes('PRIVATE'));});
test('remaining geometry gates use fixed local reasons',()=>{const cases=[
 [f=>f.state.info.safeArea=rect(-1,0,390,810),'safearea_bounds'],
 [f=>{f.state.info.screenTop=100;f.state.info.windowHeight=100;f.state.info.safeArea=rect(400,0,800,50);},'safearea_empty'],
 [f=>f.state.capsule=rect(800,0,900,40),'capsule_bounds'],
 [f=>delete f.context.GameGlobal.WXGameKit,'canvas_missing'],
 [f=>f.state.canvas.getBoundingClientRect=()=>({left:0,top:0,width:1,height:1}),'canvas_empty']
 ];for(const [mutate,reason]of cases){const f=fixture();mutate(f);unknown(f,reason);}
});
