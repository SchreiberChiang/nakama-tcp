# 微信验收布局交接复核

日期：2026-10-18。基线`f2bd1a279acce149f089e3cc9a3dbe98e6b50bd6`。Claude提交`81c158e951fa53818027e8ec1bb21bcc2dd6dffc`，负责人集成为`f80d3db5b58b94bdb821b85675780ad07f6a54c1`。作者工作区保持不变；本轮没有开始下一阶段、部署或合并main。

## 改动及接入判断

本次不仅修改隔离测试客户端，也修改共享`client/ui/main.gd`：字体/字号通过Theme继承，二维颜色和圆角样式、内容列宽、页头退出操作、中文阶段、结算卡片。因此正式客户端的外观和生产PCK会改变，不能继续宣称生产包哈希不变。没有新增纹理、3D、音频或具体玩法资源。

测试入口改为顶栏，预置连接字段只在启用的测试Session登录页隐藏；诊断面板默认隐藏但诊断采集仍遵循配置。方向盘在左、场地居中、计数在右，场地缩放只作用于呈现。Session调用、输入收集/释放和服务器权威合同未修改。根据代码及回归证据接受上述共享UI改动，继续保持空生产注册与测试导出隔离。

两名Sol分别只读审查共享UI与测试端：没有发现新增输入权威、会话生命周期、草稿/焦点保持或解绑问题。原先提出的“640逻辑宽裁切”经过实际项目探针核对后撤回为当前路线阻塞：`canvas_items + expand`、基准1152×648下，物理640×360窗口对应逻辑1152×648，800×600对应1152×864，1409×648对应1409×648。未加入响应式修复。任意更改逻辑分辨率仍需要另测，不能把该探针称为微信安全区证明。

## 验证来源与结果

作者交接报告、桌面合成截图和本机日志保留在作者独立worktree的`.local/handoff`、`.local/layout`。负责人阅读了改动和对局截图；截图用合成Session驱动，没有真实认证，图中“我/对方”身份标记不作为身份绑定正确的证据。作者提交前导出的测试包source_dirty=true，仅作历史证据；交付包已从干净提交重导。

负责人在Windows、Node24.18.0、Godot4.7.2 stable Steam、Nakama3.41.0亲自执行：

| 入口 | 退出码 | 结果 |
|---|---|---|
| `node tests/cross-platform-client.mjs` | 0 | 102/102，包含原初始化后台提示回归 |
| `node scripts/test.mjs` | 0 | 协议34、请求隔离107、客户端请求16、大厅46、时间轴109、SDK55；六组真实本地双端10/62/58/12/13/36；配置13、外层清理1、超时8、冷启动1、启动器24；HTTP模拟7；生产PCK审计；当时源码审计199 |
| `node tests/cross-platform-packaging.mjs` | 0 | 64项，模拟打包检查，不替代实际PCK |
| `node platform/wechat/test-acceptance-lifecycle.mjs` | 0 | 8项，JS模拟，不替代手机后台事件 |
| `node scripts/audit-cross-platform.mjs --pack .local/cross-platform/cloud-layout-001/test.pck --out .local/layout-root-pck-audit` | 0 | 负责人独立从空目录加载实际新测试PCK并审计 |

负责人日志为`.local/layout-root-full-test.log`、`layout-root-client.log`、`layout-root-packaging.log`、`layout-root-lifecycle.log`、`layout-root-pck-audit.log`。实际生产PCK：78资源、12,150,128字节，SHA256 `73566fb40608f3f1fe01f8ee2c5624874277cbbb362c9a05b5c67f587b320e77`。作者生产包SHA为`f8b40d345f3ba37447a0ad0df21292574d1ac07b940b26fd10a19284fd9c8ef1`；分别保留，不宣称两次构建逐字节一致。本轮两个包各自的资源/入口审计通过，不以作者哈希替代负责人产物。

完整测试结束后，54329、7348–7351无监听。六个新增数据库（empty/fixture/diagnostics/input/projection/request）保留且无postmaster.pid。原有电脑试玩Godot窗口PID384在本轮前已存在，未结束它，也未把它误报为本轮测试残留；未发现本轮所属后端或测试Godot残留。

## 新测试产物

Sol执行实际导出及固定工具check→convert→verify，退出码均0；负责人检查manifest并独立重跑实际PCK审计：

- 源码：f80d3db，manifest.source_dirty=false。
- PC包：`.local/cross-platform/cloud-layout-001/test.pck`，99资源、12,194,296字节，SHA256 `4c1c29e2209c22c162a246763ecabfdc6d68148733d280afdc3577f311c3e9f4`。
- 微信工程：`.local/cross-platform/cloud-layout-wechat-001/wechat/minigame`。Sol解压核验内嵌PCK逐字节一致，工具4e5c2f4、原定制4.7.2rc引擎/转换器及bridge哈希匹配上一固定组合；负责人此次未独立重跑转换器。
- 连接配置预置已有隔离测试入口/TLS，未执行新包登录或连接云端。启动器`Start-PC.cmd`仅复制，依赖已有Godot4.7.2，不是独立安装器。
- 旧人工验收包c06b6a47及前一提示包15e371e4保留，没有覆盖旧预览、生成新二维码、上传体验版或发布。

导出命令为`node scripts/export-cross-platform.mjs --out .local/cross-platform/cloud-layout-001 --host <隔离测试主机> --port 20443 --tls true --diagnostics`；转换继续使用`convert-cross-platform.mjs`及上一包的固定私有工具链清单，AppID只从私有文件读取。

## 尚未验证与接续

新版布局没有iPhone或微信模拟器显示/触控验收，Web专有170px胶囊留白分支没有被桌面测试执行，微信胶囊/安全区实际位置、旋转、竖屏和更矮视口滚动手感未测。完整网络回归证明逻辑路径，不能替代新版真实网络下的视觉检查；合成截图亦不能替代手机。

原iPhone16 Pro/iOS18.3.1/微信8.0.75四组人工通过仍仅绑定c06b6a47包，不能自动转移到新包。纯断网、手机性能、长期负载、游客跨重启持久化仍未测，详见[阶段报告](WECHAT_PC_VALIDATION.md)。下一步如继续本阶段，应集中做一次新包登录/准备/对局/结算/后台提示、方向盘与计数按钮、胶囊遮挡的有限真机布局复验；未开始新玩法或高级网络功能。
