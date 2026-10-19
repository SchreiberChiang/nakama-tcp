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
  function geometry() {
    var unknown={status:"unknown"};
    try {
      var info = typeof wx.getWindowInfo === "function" ? wx.getWindowInfo() : wx.getSystemInfoSync();
      if (!info || ![info.screenWidth,info.screenHeight,info.windowWidth,info.windowHeight,info.screenTop].every(finite)) return unknown;
      if (Math.min(info.screenWidth,info.screenHeight,info.windowWidth,info.windowHeight)<=0 || info.screenTop<0 || info.windowWidth>info.screenWidth || info.screenTop+info.windowHeight>info.screenHeight) return unknown;
      // Official Mini Game typings describe safeArea as portrait-positive:
      // https://github.com/wechat-miniprogram/minigame-api-typings/blob/master/types/wx/lib.wx.api.d.ts
      // Runtime rectangles clearly outside the portrait domain but inside the
      // current screen domain are accepted as current-orientation coordinates.
      // When both interpretations fit, intersect them rather than guessing.
      var supplied=rectangle(info.safeArea);
      if (!supplied || supplied.left<0 || supplied.top<0) return unknown;
      var pw=Math.min(info.screenWidth,info.screenHeight),ph=Math.max(info.screenWidth,info.screenHeight);
      var currentValid=supplied.right<=info.screenWidth && supplied.bottom<=info.screenHeight;
      var portraitValid=supplied.right<=pw && supplied.bottom<=ph;
      var safe=null,status="known";
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
      if(!safe || safe.right<=safe.left || safe.bottom<=safe.top) return unknown;
      var win={left:0,top:info.screenTop,right:info.windowWidth,bottom:info.screenTop+info.windowHeight};
      safe=intersect(safe,win);
      if (!safe) return unknown;
      // Capsule is screen-relative too. Its absence is not evidence of no capsule.
      if (typeof wx.getMenuButtonBoundingClientRect!=="function") return unknown;
      var capsule=rectangle(wx.getMenuButtonBoundingClientRect());
      if (!capsule || capsule.left<0 || capsule.top<0 || capsule.right>info.screenWidth || capsule.bottom>info.screenHeight) return unknown;
      var overlap=intersect(safe,capsule);
      if (overlap) {
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
      safe={left:safe.left,top:safe.top-info.screenTop,right:safe.right,bottom:safe.bottom-info.screenTop};
      // Match pinned converter initConfig: factory preserves Module identity.
      var kit=typeof WXGameKit!=="undefined" ? WXGameKit : root.WXGameKit;
      var module=kit && kit.gameInstance && kit.gameInstance.Module;
      var canvas=module && module.canvas || root.canvas;
      if (!canvas || typeof canvas.getBoundingClientRect!=="function") return unknown;
      var rect=canvas.getBoundingClientRect();
      if (!rect || ![rect.left,rect.top,rect.width,rect.height,canvas.width,canvas.height].every(finite) || Math.min(rect.width,rect.height,canvas.width,canvas.height)<=0 || rect.left!==0 || rect.top!==0) return unknown;
      var client={left:rect.left,top:rect.top,right:rect.left+rect.width,bottom:rect.top+rect.height};
      safe=intersect(safe,client);
      if (!safe) return unknown;
      return {status:status,x:(safe.left-rect.left)/rect.width,y:(safe.top-rect.top)/rect.height,width:safe.width/rect.width,height:safe.height/rect.height};
    } catch (_) { return unknown; }
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
