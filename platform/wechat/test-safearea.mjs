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
test('missing/malformed/exceptional geometry is unknown and recovers fresh',()=>{for(const mutate of [f=>delete f.state.info.safeArea,f=>f.state.info.safeArea.width++,f=>f.state.info.screenTop=NaN,f=>f.state.info.screenWidth=0,f=>f.state.capsule=null,f=>f.state.canvas.width=0,f=>f.state.canvas.getBoundingClientRect=()=>({left:10,top:0,width:844,height:390}),f=>f.state.canvas.getBoundingClientRect=()=>{throw Error('PRIVATE');}]){const f=fixture();assert.equal(f.read().status,'conservative');mutate(f);assert.deepEqual(f.read(),{status:'unknown'});}});
test('absent window/capsule APIs do not imply full-screen safety',()=>{const f=fixture();delete f.context.wx.getMenuButtonBoundingClientRect;assert.deepEqual(f.read(),{status:'unknown'});});
test('subsequent resize/foreground observation never retains an old safe rectangle',()=>{const f=fixture();const original=f.read();f.state.info.safeArea=null;assert.deepEqual(f.read(),{status:'unknown'});f.state.info.safeArea=rect(0,47,390,810);assert.deepEqual(f.read(),original);});
