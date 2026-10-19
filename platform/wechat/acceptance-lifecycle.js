// Test-package only geometry. Units: wx screen CSS pixels -> window CSS pixels
// -> actual canvas client rectangle -> normalized Godot viewport. Never use DPR.
(function () {
  var root = typeof GameGlobal !== "undefined" ? GameGlobal : globalThis;
  if (typeof wx === "undefined" || typeof wx.onHide !== "function" || typeof wx.onShow !== "function") return;
  if (root.FoundationAcceptance) return;
  var hidden = false, nextHandle = 1, listeners = new Map();
  function dispatch(event) {
    hidden = event === "hide";
    Array.from(listeners.keys()).forEach(function (handle) {
      var callback = listeners.get(handle);
      if (callback) try { callback(event); } catch (_) {}
    });
  }
  function finite(n) { return typeof n === "number" && Number.isFinite(n); }
  function rectangle(r) {
    if (!r || ![r.left,r.top,r.right,r.bottom,r.width,r.height].every(finite)) return null;
    if (r.width <= 0 || r.height <= 0 || Math.abs(r.right-r.left-r.width)>0.01 || Math.abs(r.bottom-r.top-r.height)>0.01) return null;
    return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};
  }
  function intersect(a,b) {
    var left=Math.max(a.left,b.left),top=Math.max(a.top,b.top),right=Math.min(a.right,b.right),bottom=Math.min(a.bottom,b.bottom);
    return right>left && bottom>top ? {left:left,top:top,right:right,bottom:bottom,width:right-left,height:bottom-top} : null;
  }
  // Fixed keys, bounded finite numbers only. Never copy whole platform results,
  // identifiers, exception text or arbitrary object fields into the test UI.
  function record(details,prefix,value,keys) {
    if (!value) return;
    keys.forEach(function(key) {
      var n=value[key];
      if(finite(n) && Math.abs(n)<=10000000) details[prefix+key]=Math.round(n*1000)/1000;
    });
  }
  function geometry() {
    var details={},info=null,capsuleValue=null,canvas=null,rect=null;
    var windowError="",capsuleError="",canvasError="";
    function unknown(reason) { return {status:"unknown",reason:reason,details:details}; }
    // Collect independent, strictly whitelisted measurements even if an earlier
    // gate fails: one phone screenshot can identify which coordinate domain failed.
    try {
      if(typeof wx.getWindowInfo === "function") info=wx.getWindowInfo();
      else if(typeof wx.getSystemInfoSync === "function") info=wx.getSystemInfoSync();
      else windowError="window_api";
      record(details,"",info,["screenWidth","screenHeight","windowWidth","windowHeight","screenTop"]);
      record(details,"safe_",info && info.safeArea,["left","top","right","bottom","width","height"]);
    } catch (_) { windowError="window_exception"; }
    try {
      if(typeof wx.getMenuButtonBoundingClientRect!=="function") capsuleError="capsule_api";
      else capsuleValue=wx.getMenuButtonBoundingClientRect();
      record(details,"capsule_",capsuleValue,["left","top","right","bottom","width","height"]);
    } catch (_) { capsuleError="capsule_exception"; }
    try {
      // Match pinned converter initConfig: factory preserves Module identity.
      // convert/assets/godot-bridge.js uses m.canvas || GameGlobal.canvas.
      var kit=typeof WXGameKit!=="undefined" ? WXGameKit : root.WXGameKit;
      var module=kit && kit.gameInstance && kit.gameInstance.Module;
      canvas=module && module.canvas || root.canvas;
      if(!canvas || typeof canvas.getBoundingClientRect!=="function") canvasError="canvas_missing";
      else rect=canvas.getBoundingClientRect();
      record(details,"canvas_",canvas,["width","height"]);
      record(details,"client_",rect,["left","top","x","y","width","height"]);
    } catch (_) { canvasError="canvas_exception"; }
    try {
      if(windowError) return unknown(windowError);
      if(!info || ![info.screenWidth,info.screenHeight,info.windowWidth,info.windowHeight].every(finite)) return unknown("window_fields");
      var screenTop=info.screenTop, inferredOrigin=false;
      // Equal complete heights uniquely imply a zero vertical origin; this is
      // not a blanket default for a missing platform field in a shorter window.
      if(screenTop===undefined && info.screenHeight===info.windowHeight && info.screenHeight>0) {
        screenTop=0;inferredOrigin=true;details.originInferred=1;
      }
      if(!finite(screenTop)) return unknown("window_fields");
      if(Math.min(info.screenWidth,info.screenHeight,info.windowWidth,info.windowHeight)<=0 || screenTop<0 || info.windowWidth>info.screenWidth || screenTop+info.windowHeight>info.screenHeight) return unknown("window_bounds");
      // Official Mini Game typings describe safeArea as portrait-positive:
      // https://github.com/wechat-miniprogram/minigame-api-typings/blob/master/types/wx/lib.wx.api.d.ts
      // Runtime rectangles clearly outside the portrait domain but inside the
      // current screen domain are accepted as current-orientation coordinates.
      // When both interpretations fit, intersect them rather than guessing.
      var supplied=rectangle(info.safeArea);
      if(!supplied) return unknown("safearea_fields");
      if(supplied.left<0 || supplied.top<0) return unknown("safearea_bounds");
      var pw=Math.min(info.screenWidth,info.screenHeight),ph=Math.max(info.screenWidth,info.screenHeight);
      var currentValid=supplied.right<=info.screenWidth && supplied.bottom<=info.screenHeight;
      var portraitValid=supplied.right<=pw && supplied.bottom<=ph;
      var safe=null,status=inferredOrigin?"conservative":"known";
      if(info.screenWidth>info.screenHeight && portraitValid){
        // Both portrait-positive rotations. Extra bottom clearance reuses the
        // reported portrait bottom inset conservatively; it is NOT a measured
        // landscape home-indicator height or a device-model padding table.
        var side=Math.max(supplied.top,ph-supplied.bottom);
        var vertical=Math.max(supplied.left,pw-supplied.right);
        safe={left:side,top:vertical,right:info.screenWidth-side,bottom:info.screenHeight-Math.max(vertical,ph-supplied.bottom)};
        if(currentValid) safe=intersect(safe,supplied);
        status="conservative";
      }else if(currentValid) safe=supplied;
      if(!safe || safe.right<=safe.left || safe.bottom<=safe.top) return unknown("safearea_bounds");
      var win={left:0,top:screenTop,right:info.windowWidth,bottom:screenTop+info.windowHeight};
      safe=intersect(safe,win);
      if(!safe) return unknown("safearea_empty");
      // Capsule is screen-relative too. Its absence is not evidence of no capsule.
      if(capsuleError) return unknown(capsuleError);
      var capsule=rectangle(capsuleValue);
      if(!capsule) return unknown("capsule_fields");
      if(capsule.left<0 || capsule.top<0 || capsule.right>info.screenWidth || capsule.bottom>info.screenHeight) return unknown("capsule_bounds");
      var overlap=intersect(safe,capsule);
      if(overlap){
        // Keep one rectangle containing the whole card, including tabs and Close.
        var choices=[
          {left:safe.left,top:overlap.bottom,right:safe.right,bottom:safe.bottom},
          {left:safe.left,top:safe.top,right:overlap.left,bottom:safe.bottom},
          {left:overlap.right,top:safe.top,right:safe.right,bottom:safe.bottom},
          {left:safe.left,top:safe.top,right:safe.right,bottom:overlap.top}
        ];
        choices.sort(function(a,b){return (b.right-b.left)*(b.bottom-b.top)-(a.right-a.left)*(a.bottom-a.top);});
        safe=choices[0];
      }
      safe={left:safe.left,top:safe.top-screenTop,right:safe.right,bottom:safe.bottom-screenTop};
      if(canvasError) return unknown(canvasError);
      if(!rect || ![rect.width,rect.height,canvas.width,canvas.height].every(finite) || Math.min(rect.width,rect.height,canvas.width,canvas.height)<=0) return unknown("canvas_fields");
      // DOMRect's x/y are aliases of left/top. Accept either spelling per axis, but
      // conflicting aliases are invalid. Keep zero-origin touch-adapter gate.
      var left=rect.left===undefined?rect.x:rect.left;
      var top=rect.top===undefined?rect.y:rect.top;
      if(!finite(left) || !finite(top)) return unknown("canvas_fields");
      if((rect.x!==undefined && (!finite(rect.x) || rect.x!==left)) || (rect.y!==undefined && (!finite(rect.y) || rect.y!==top)) || left!==0 || top!==0) return unknown("canvas_origin");
      var client={left:left,top:top,right:left+rect.width,bottom:top+rect.height};
      safe=intersect(safe,client);
      if(!safe) return unknown("canvas_empty");
      return {status:status,x:(safe.left-left)/rect.width,y:(safe.top-top)/rect.height,width:safe.width/rect.width,height:safe.height/rect.height};
    } catch (_) { return unknown("geometry_exception"); }
  }
  var api=Object.freeze({
    subscribeLifecycle:function(callback){if(typeof callback!=="function" || listeners.size>=4)return 0;var handle=nextHandle++;listeners.set(handle,callback);return handle;},
    unsubscribeLifecycle:function(handle){listeners.delete(Number(handle));},
    isHidden:function(){return hidden;},
    geometryJSON:function(){return JSON.stringify(geometry());}
  });
  [root,typeof globalThis!=="undefined"?globalThis:null,root.window].forEach(function(target){if(target)target.FoundationAcceptance=api;});
  wx.onHide(function(){dispatch("hide");});
  wx.onShow(function(){dispatch("show");});
})();
