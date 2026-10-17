# 来源与许可

- 通用房间、会话、聊天基础来自原工程 `origin/main` 的 `2395b6be9a15b27f664e8190518775759b7306ef`，整理时删除全部具体玩法、专用规则、资源和旧发布/云配置。MIT 及原署名保留于根 `LICENSE`。独立仓库不携带原历史提交。
- Godot **4.7.2**，本机验证 `4.7.2.stable.steam.ed1daf0bf`；Godot 官方 MIT 与引擎第三方许可须在分发对应引擎可执行文件时一并保留。本仓库不分发引擎二进制。来源 https://github.com/godotengine/godot 。
- Nakama **3.41.0**，Apache-2.0；bootstrap 固定官方下载地址和压缩包 SHA256，不提交服务端二进制。来源 https://github.com/heroiclabs/nakama 。
- Nakama Godot SDK **v3.4.0**（官方提交 `14b7f7078a9822c15b0424624e4c883c87730cee`），MIT；见 `client/addons/NAKAMA_SDK_LICENSE`、`SDK_PIN.json`、`SDK_PATCHES.md` 和原始差异。生命周期与实时日志脱敏两项补丁保留，未替换 SDK。
- Nakama runtime TypeScript 定义，Apache-2.0；见 `server/vendor/LICENSE.nakama-common` 及文件头。
- Node **24**；TypeScript **5.9.3**、Nakama JS SDK **2.8.0**、embedded-postgres **16.14.0-beta.17**、ws **8.18.3** 等依赖按 `package-lock.json` 安装并遵守各包自带许可。未将 node_modules 打包入源码仓库。
- 中文 UI 字体是原工程已有 Noto CJK 字体字节，SHA256 `d11b07d484692eeebb29ebfdef39253c72db8a7c7ab1641a69167f9266515f32`；压缩源 `assets/source-fonts/TemplateCJK.otf.gz`，还原13,205,332字节。许可/来源见 `client/assets/fonts/LICENSE-CJK.txt`（含 OFL 和 copyright）。只有文件名改为通用名称，不改变字节。未分发原工程音乐、模型或材质。

可选微信 HTTP 补丁由本项目既有本地兼容修复整理，适用本仓库 MIT；不包含官方微信 SDK、社区定制 WASM、wxgame.zip 或任何 AppID/私有云参数。这些外部工具和平台服务须由使用者自行准备并确认许可与权限。
