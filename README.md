# Godot + Nakama 通用联机底座

当前协议v3新增请求回调隔离与选择事务：两端一起升级，旧v2不能混连。范围、运行方法和本轮证据见[REQUEST_ISOLATION](docs/REQUEST_ISOLATION.md)。

微信＋原生电脑阶段已获用户允许收尾；最新诊断包的横屏边界、分页滚动与中文概览获用户真机确认，此前缺测的对局诊断触控已使用同一原包补测，用户三项人工检查均报告正常，动作及证据边界见收尾报告。固定版本、证据边界与接入前四步检查见 [阶段收尾](docs/WECHAT_STAGE_CLOSEOUT.md)。

分阶段目标、当前状态、未测项与接续入口见 [PROJECT_STATUS](docs/PROJECT_STATUS.md)。本轮需求逐项验收与证据边界见 [ACCEPTANCE](docs/ACCEPTANCE.md)；时间轴两项审查与独立复验见 [TIMELINE_REVIEW](docs/TIMELINE_REVIEW.md)。

后续交叉复核发现的超时等待及冷缓存导入问题、修复与最终复验见 [INFRA_REVIEW](docs/INFRA_REVIEW.md)。历史“全部验收通过”已补充限定，以最新报告为准。

测试夹具外层在退出未确认时保留祖先目录的补充修复见 [PROFILE_CLEANUP_REVIEW](docs/PROFILE_CLEANUP_REVIEW.md)。可单独运行 `node tests/profile-cleanup-regression.mjs`；完整测试入口已包含该回归。

不安装任何具体游戏的 Godot 4.7.2 客户端和 Nakama 3.41.0 权威房间服务端。默认大厅显示“尚未安装玩法”；登录页、大厅、房间、结算页均是普通 2D 控件，没有背景 3D、预览、音乐或隐藏玩法实例。

保留设备/邮箱认证接口、会话、WebSocket、玩法目录、大厅、建房/加入、容量、成员列表、准备/开始、房主转移、退出/断线清理、服务端结算与留房再来一局。内存聊天控制器与服务端策略保留，当前 UI 不提供聊天面板。客户端不决定分数或赢家，安全校验仍在服务端。

## 安装与运行

需要 Node **24**、Godot **4.7.2**、Git；本地后端支持 Windows/Linux x64，PostgreSQL 在 Linux 必须用普通用户运行。其他平台可自行提供官方 Nakama 可执行文件。版本与许可见 [THIRD_PARTY](docs/THIRD_PARTY.md)。

```powershell
$env:SCARF_ANALYTICS = 'false'
$env:NAKAMA_TELEMETRY = '0'
npm.cmd ci --ignore-scripts
node scripts/restore-source-assets.mjs
node scripts/bootstrap.mjs
npm.cmd run build
$env:GODOT = 'C:/your/path/Godot_4.7.2.exe'
& $env:GODOT --headless --editor --path client --import
node scripts/run-with-server.mjs $env:GODOT --path client -- --profile=local-one
```

`bootstrap` **会下载**官方固定版本 Nakama，核对 SHA256 后解压到本仓库 `.tools/`，不安装系统服务。已有 Nakama 时可跳过 bootstrap，设置 `$env:NAKAMA_BIN='C:/your/path/nakama.exe'`。字体从仓库中的压缩源还原，不下载。Linux 使用 `npm` 和 `export GODOT=/your/path/godot` 等相同脚本。

启动器仅绑定 **127.0.0.1**；端口 `54329`、`7348–7351` 必须可用，否则拒绝启动，不接管旧进程、不删数据库锁。数据库默认 `.local/postgres/`，可用 `NAKAMA_DATA_DIR` 指定新的隔离目录。退出客户端后只清理本次子进程，数据库保留。若需要同时启动第二个客户端，保留第一个启动器，在另一个终端运行：

```powershell
& $env:GODOT --path client -- --profile=local-two
```

默认连接 loopback，`defaultkey` 与 `server/dev.yml` 中密码都是**公开的本地开发值**，不用于生产。远端须显式设置域名、端口、server key，并启用 TLS；TLS 证书验证保持开启。登录页面可输入连接参数，当前不保存 server key；密码、令牌不写本地配置、不写日志。设备 ID 和昵称保存在 Godot 的 `user://template-<profile>.cfg`，不要上传该目录。Web/微信不能直连电脑的 loopback，须另行提供已授权的 HTTPS/WSS 后端；本模板不包含云服配置或部署脚本。

## 目录与入口

| 目录 | 用途 |
|---|---|
| `client/Main.tscn`、`client/ui/main.gd` | 唯一玩家入口和普通 2D UI |
| `client/core/session.gd` | 唯一 Nakama 网络边界，含连接代际、房间代际、清理与安全错误提示 |
| `client/core/game_module.gd`、`module_registry.gd` | 客户端玩法接口和空注册表 |
| `client/addons/` | 官方 SDK 3.4.0、保留的补丁、固定版本与许可 |
| `server/src/main.ts`、`chat.ts`、`types.ts` | 权威房间生命周期、聊天策略、模块合同 |
| `server/src/registry.ts` | 默认空服务端玩法注册表 |
| `tests/fixtures/`、`client/tests/` | 隔离的文字测试模块和验证程序，生产注册/导出不包含它们 |
| `platform/wechat/` | 可选的 HTTP 兼容补丁及平台边界说明，不自动装入桌面/浏览器 |
| `scripts/` | 构建、自有本地服务、测试、导出依赖核查 |
| `docs/` | 接入步骤、协议、验证与来源 |

## 新玩法接入

需要先讨论玩法同步、资产适配或接手计划时，在本仓库内的新 Codex 会话输入 `$nakama-project-advisor`，也可直接描述需求触发[项目顾问 skill](.agents/skills/nakama-project-advisor/SKILL.md)。仓库级 `.agents/skills` 随项目维护；加载证据、调用方法与限制见 [skill 验证记录](docs/skill-validation/REPORT.md)。

按 [ADDING_GAME](docs/ADDING_GAME.md) 同时添加服务端模块和客户端视图，并在两端显式注册。共享 UI 不根据玩法 ID 判断车辆、地图、镜头或特殊参数。没有注册玩法时，登录/连接照常工作；建房必须有真实模块，底座不会用假玩法或空规则创建房间。

房间核心复用原有 RPC、op code、`seq`、`round_id`、会话身份和容量校验，见 [PROTOCOL](docs/PROTOCOL.md)。模块负责解释自己的选项、输入和结果。客户端视图仅在 `playing` 阶段实例化，离开/结算时调用 `release()` 后释放。

## 验证与导出

当前阶段与接手入口见 [PROJECT_STATUS](docs/PROJECT_STATUS.md)；大厅草稿保留、请求乱序隔离、验证结果与边界见 [PHASE2_LOBBY](docs/PHASE2_LOBBY.md)。

自动测试、导出和PCK审计的本地配置隔离，以及时间轴保持后接受新权威的回归见 [PHASE3_TEST_ISOLATION](docs/PHASE3_TEST_ISOLATION.md)。单测使用 `node scripts/test-godot-unit.mjs lobby_state snapshot_timeline sdk_socket_lifecycle`；直接裸跑Godot脚本仍可能读写默认本地配置。

阶段一协议与消费语义见 [PROTOCOL](docs/PROTOCOL.md)，呈现缓冲见 [SNAPSHOT_TIMELINE](docs/SNAPSHOT_TIMELINE.md)，本轮一键验证、窗口 fixture 演示、失败记录与未测边界见 [PHASE1_VALIDATION](docs/PHASE1_VALIDATION.md)。协议v2的审查修复、双端故障与完整第二轮证据见 [REVIEW_FOLLOWUP](docs/REVIEW_FOLLOWUP.md)。测试玩法仅在隔离测试构建启用，玩家导出仍为空注册。

```powershell
node scripts/test.mjs
node scripts/export.mjs
```

`test.mjs` 构建空注册生产后端和独立测试后端，先跑 SDK 回归，再为两组后端分别启动两台真实 Godot 客户端。测试数据库、日志和 IPC 只写 `.local/`，不提交。测试运行有超时和错误日志门禁。设置 `$env:TEST_GUI='1'` 可改为窗口模式并在本地保存登录/大厅/房间/结算截图。

完整测试会自动恢复固定字体并生成Godot全局类缓存，再运行配置检查；无需先手工打开编辑器。只验证准备流程可运行 `node scripts/test.mjs --prepare-only`；额外冷副本回归是 `node scripts/test-cold-start.mjs`，进程边界回归是 `node tests/process-timeout.mjs`。完整后端测试需要安装锁文件中的可选数据库平台包，不能将省略这些依赖后的启动失败计为通过。超时或输出管道排空超限均失败；若无法确认直接进程退出，会保留其配置/探针目录，不宣称后代已全部清理。

`export.mjs` 生成 `artifacts/template.pck`，在空目录加载该 **实际 PCK** 并运行登录页，再检查文件清单和场景树。导出排除 `client/tests/`；服务端普通构建也不编译测试模块。PCK 和日志均不入仓库。PCK 是游戏数据包，**不含可独立运行的 Godot 平台可执行文件/WASM**；Web/桌面完整应用导出还需要对应官方 export templates。

初始提取阶段的已验证与未测范围见 [VALIDATION](docs/VALIDATION.md)；其中“未上传微信、未部署腾讯云、未测手机或公网多人”仅描述当时版本。后续本阶段已使用授权的隔离云后端和微信开发预览，并取得绑定指定包的用户真机反馈；现状以 [阶段收尾](docs/WECHAT_STAGE_CLOSEOUT.md) 为准。已有微信适配入口见 [platform/wechat/README.md](platform/wechat/README.md)。

## 许可与来源

项目通用代码采用 MIT，保留 [LICENSE](LICENSE) 和第三方各自许可。本模板从原项目通用网络代码整理，独立仓库只带新的初始提交，不附原游戏历史、资源、配置、构建或运行日志。来源版本及官方 SDK 补丁见 [THIRD_PARTY](docs/THIRD_PARTY.md)。
