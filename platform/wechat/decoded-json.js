// Local compatibility experiment. wx.request may return decoded JSON while
// retaining Content-Encoding:gzip. Godot HTTPRequest otherwise inflates twice.
// No request bodies, credentials, URLs or response bodies are logged.
(function () {
  if (typeof wx === "undefined" || typeof wx.request !== "function") return;
  var previous = wx.request;
  if (previous.__localDecodedJsonFix) return;
  function header(headers, name) {
    var keys = Object.keys(headers || {});
    for (var i = 0; i < keys.length; i++)
      if (keys[i].toLowerCase() === name) return headers[keys[i]];
    return "";
  }
  function normalize(response) {
    if (
      !response ||
      String(header(response.header, "content-encoding")).toLowerCase() !==
        "gzip"
    )
      return response;
    if (
      !/application\/(?:[\w.+-]*\+)?json\b/i.test(
        String(header(response.header, "content-type")),
      )
    )
      return response;
    var data = response.data,
      bytes =
        data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : ArrayBuffer.isView(data)
            ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
            : null;
    if (bytes && bytes.length >= 2 && bytes[0] === 31 && bytes[1] === 139)
      return response;
    var text;
    try {
      text =
        typeof data === "string"
          ? data
          : bytes
            ? new TextDecoder().decode(bytes)
            : null;
      if (text === null) return response;
      JSON.parse(text);
    } catch (_) {
      return response;
    }
    var headers = {},
      copy = Object.assign({}, response);
    Object.keys(response.header).forEach(function (key) {
      if (!/^(content-encoding|content-length)$/i.test(key))
        headers[key] = response.header[key];
    });
    copy.header = headers;
    console.log(
      "[本机登录诊断] 微信已解压JSON，移除过期压缩标头；状态码=" +
        response.statusCode +
        "，正文长度=" +
        (bytes ? bytes.byteLength : text.length),
    );
    return copy;
  }
  function patched(options) {
    // Only Godot's complete-buffer HTTP path. Other requests retain their behavior.
    if (!options || options.responseType !== "arraybuffer")
      return previous.apply(this, arguments);
    var copy = Object.assign({}, options),
      headersCallback = null,
      completed = null;
    copy.enableChunked = false; // Existing wx-compat already requires this for Godot.
    copy.success = function (response) {
      completed = normalize(response);
      // Deliver matching headers before Godot processes the successful body.
      if (headersCallback) headersCallback(completed);
      if (typeof options.success === "function")
        return options.success.call(this, completed);
    };
    var task = previous.call(this, copy);
    if (task && typeof task.onHeadersReceived === "function") {
      var originalHeaders = task.onHeadersReceived.bind(task);
      task.onHeadersReceived = function (callback) {
        headersCallback = callback;
        return originalHeaders(function (response) {
          if (!response || !response.statusCode) return;
          // Defer gzip headers until the complete body establishes whether native
          // decoding occurred; retain genuine gzip bytes and malformed data.
          if (
            String(
              header(response.header, "content-encoding"),
            ).toLowerCase() !== "gzip"
          )
            callback(response);
          else if (completed) callback(completed);
        });
      };
    }
    return task;
  }
  patched.__localDecodedJsonFix = true;
  wx.request = patched;
  console.log("[本机登录诊断] HTTP已解压JSON兼容修正已安装");
})();
