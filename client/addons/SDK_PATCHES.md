# Nakama Godot SDK 本地补丁

本项目以官方 Nakama Godot SDK v3.4.0 为基线，**不是完全未修改的 SDK**。

- 官方仓库：https://github.com/heroiclabs/nakama-godot
- 固定提交：`14b7f7078a9822c15b0424624e4c883c87730cee`
- 官方发布：https://github.com/heroiclabs/nakama-godot/releases/tag/v3.4.0
- 原始 ZIP SHA256：`540c7ff3556ef114188b93750626fe93cd5e5d151c5850061eb7a163ba7c6f3e`
- 保留官方 MIT 许可，见 `NAKAMA_SDK_LICENSE`
- 文件修改前后 SHA256：见 `SDK_PIN.json`

## no-response-match-send-lifecycle

仅修改 `com.heroiclabs.nakama/socket/NakamaSocket.gd`。

原实现的 `_send_async` 把每个请求放入 `_requests`。`send_match_state_async` 和 `send_match_state_raw_async` 不等待服务器响应，却直接延迟调用请求对象的 `resume`，因此没有移除表中请求，直到断线时才集中取消/释放。持续的模块输入会不断增加这个表。

补丁：

1. 两个 no-response 方法延迟调用 socket 的受保护完成函数，走统一请求清理路径。
2. 请求先从 `_requests` 移除，再发送完成信号，防止完成回调中关闭 socket 造成重入重复完成。
3. 若发送失败或关闭已清理该请求，后来的成功回调或取消操作静默跳过。

没有修改消息结构、CID、Base64 编码、认证或网络协议。成功仍只代表本地发送完成，**不代表服务器确认接收**。普通需要服务器响应的请求仍等待原有响应。没有声称修复了 SDK 的其他内存行为或进行过通用性能验证。

完整统一差异：`patches/nakama-godot-v3.4.0-no-response-lifecycle.patch`，路径以 Nakama 仓库根目录为基准（`client/addons/...`）。在目标文件为官方未修改 v3.4.0 版本的副本上，可于仓库根目录运行：

```
git apply --check client/addons/patches/nakama-godot-v3.4.0-no-response-lifecycle.patch
git apply client/addons/patches/nakama-godot-v3.4.0-no-response-lifecycle.patch
```

交付源码已包含该补丁，不要重复应用。

## realtime-log-payload-redaction

所有 `upstream_file_sha256` / `patched_file_sha256` 均针对 **canonical LF** 文件字节；官方发布压缩包的 `asset_sha256` 仍针对原始压缩包，不做转换。应用补丁前将两个目标 `.gd` 的 CRLF 统一为 LF，补丁文件本身也须保持 LF；`.gitattributes` 固定这两份脚本与补丁的检出行尾。`NakamaSocketAdapter.gd` 官方原 CRLF 字节 hash 为 `8067aa59...`，规范 LF 输入 hash 为 PIN 中的 `893d9f43...`。不要对已经应用的代码重复应用补丁。

2026-10-08 独立干净检出发现早期 PIN 的最终 hash 登记了 Windows CRLF 工作区字节，而 Git 检出为 LF。修复只统一两份脚本/补丁工作区行尾并更新文件 hash，不改变 SDK 行为；独立补丁验证目录也须设置 LF，避免继承 Windows `core.autocrlf=true`。最终 Socket LF hash 为 `b183919719d497aa97054ec73f2d44aa971900c138348e28b482211b004759af`，Adapter 为 `01523b62d484bf55d529684906cc1f6f7933e6153513ba3d5a2759f81c1d8fa7`；干净检出和逐阶段正反补丁验证须重新满足这些精确字节。

在上述生命周期补丁后应用 `patches/nakama-godot-v3.4.0-realtime-log-redaction.patch`，修改 `NakamaSocket.gd` 以及 `NakamaSocketAdapter.gd` 的连接失败日志。`SDK_PIN.json` 按应用顺序记录每一步输入和输出 hash；同一补丁的 `additional_files` 列出额外文件，补丁只应用一次。最后一步是交付文件的 hash，第一步输出是中间版本。

聊天正文不得进入 SDK 日志，包括 debug 级别。此补丁移除发送请求、完成请求、未匹配请求、未知响应、非法 JSON 与过期 CID 日志中的 payload 插值。服务端错误保留经过有限整数校验的错误码和原类别，不打印任意错误文本。取消请求仍保留固定 debug 类别；连接 debug 仅保留类别，不输出含登录 token 的 URL。请求对象解析、异常返回给调用者、CID、完成顺序和消息结构不变；Session 将聊天错误单独映射成固定中文提示，不进入全局 notice 或诊断。

```
git apply --check client/addons/patches/nakama-godot-v3.4.0-realtime-log-redaction.patch
git apply client/addons/patches/nakama-godot-v3.4.0-realtime-log-redaction.patch
```

同样不要向已包含补丁的交付源码重复应用。补丁范围是实时 SDK payload 日志，不声称其他第三方日志已经全面审计。

## 验证

保留 `client/tests/sdk_socket_lifecycle.gd`，使用 `node scripts/test.mjs` 执行。当前模板验证范围以 `docs/VALIDATION.md` 为准，原工程历史测试不代表模板已通过。
