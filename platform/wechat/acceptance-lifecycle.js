// Test-package only: wx visibility -> Godot acceptance entry. No transport,
// identity, payload logging, persistent history, or automatic reconnection.
(function () {
  var root = typeof GameGlobal !== "undefined" ? GameGlobal : globalThis;
  if (typeof wx === "undefined" || typeof wx.onHide !== "function" || typeof wx.onShow !== "function") return;
  if (root.FoundationAcceptance) return;
  var hidden = false;
  var nextHandle = 1;
  var listeners = new Map();
  function dispatch(event) {
    hidden = event === "hide";
    // Snapshot handles, but respect unsubscription during an earlier callback.
    Array.from(listeners.keys()).forEach(function (handle) {
      var callback = listeners.get(handle);
      if (!callback) return;
      try { callback(event); } catch (_) { /* Never print callback error contents. */ }
    });
  }
  var api = Object.freeze({
    subscribeLifecycle: function (callback) {
      // A single test entry normally owns one callback. Bound accidental reloads.
      if (typeof callback !== "function" || listeners.size >= 4) return 0;
      var handle = nextHandle++;
      listeners.set(handle, callback);
      return handle;
    },
    unsubscribeLifecycle: function (handle) { listeners.delete(Number(handle)); },
    isHidden: function () { return hidden; }
  });
  [root, typeof globalThis !== "undefined" ? globalThis : null, root.window].forEach(function (target) {
    if (target) target.FoundationAcceptance = api;
  });
  wx.onHide(function () { dispatch("hide"); });
  wx.onShow(function () { dispatch("show"); });
})();
