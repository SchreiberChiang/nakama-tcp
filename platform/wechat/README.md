# 可选微信平台边界

底座不依赖 wx 对象，不在默认入口加载微信 SDK，不保存 AppID、云环境、server key 或部署地址。消息仍是 Nakama HTTP 认证/RPC 和会话 WebSocket，不引入另一套联机协议。Godot Web 不能直接使用原生 ENet/UDP。

已有适配可以复用在**导出层**：

1. 以匹配版本的社区 Godot 微信 Web 引擎、godot.js、SDK/适配层和加载器承载本模板 PCK，不能混用不同版本的 WASM/JS。官方标准 Web 导出不能直接当微信目录运行。
2. 适配层先提供全局 TextEncoder/TextDecoder、Blob、WebSocket 常量，以及基于 `wx.connectSocket` 的 WebSocket。已有工具 `wechat-wasm-slim` 的 convert/wx-compat 路径可作为外部转换工具；本仓库没有捆绑该外部工具、引擎和微信 SDK，也没有验证它们的最新兼容性。
3. `wx.request` 必须完整返回缓冲区、正确处理 typed-array 子视图和 header，不得把鉴权/内容打印到日志。已有的“JSON 已解压但保留 Content-Encoding:gzip”修复保留为 `decoded-json.js`；在基础适配与 TextDecoder 准备好后、加载 godot.js 前显式 require。它仅修正完整 arraybuffer 的 JSON 回应，真正 gzip/非 JSON 仍原样通过。不自动安装补丁到其他平台。
4. 自行填写受权 AppID 和 HTTPS/WSS 后端，配置平台合法域名，保留 TLS 验证。手机不能连电脑的 localhost。平台凭据、云配置和二维码不进入此仓库。
5. 缓存、3D 预热、WASM 裁剪/分包是导出引擎和加载器的独立实验。本模板不包含具体游戏，UI 也不会提前创建 3D；不能据此声称引擎默认预热已关闭或手机已提速。

## 证据边界

原项目的独立手机版本曾在 iPhone、Wi-Fi、省电关闭时两次连接既有云服、进入大厅并参与玩法；使用社区 4.7.2 定制引擎、wx-compat 与 HTTP 修复。它证明该**原项目组合**可行，不代表本模板已通过微信/手机。原私有云配置、PCK、日志和旧玩法不随模板移交。

本模板当前验证：桌面窗口/无头 Godot + 真实隔离 Nakama；`node platform/wechat/test-decoded-json.mjs` 的7项模拟回应回归。未测：本模板微信开发者工具、iPhone/Android、微信键盘/横屏、手机内存、启动缓存、发布版以及公网多人。外部引擎和转换工具到位后应另做手机预览授权及验收；本次未上传微信或改腾讯云。
