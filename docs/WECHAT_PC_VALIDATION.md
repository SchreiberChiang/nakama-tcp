# 微信与原生电脑双客户端验收（进行中）

日期：2026-10-18。底座固定基线：`395999f913a0d6102ea1a604181d1f45ecd8ef65`（PR #1 merge commit）。实施分支：`codex/foundation-wechat-pc-20261018`。本文件记录当前阶段，不替换历史版本报告；尚未完成跨平台验收。

## 范围和执行所有权

目标为现有协议v3、fixture模块v1的微信小游戏与原生电脑客户端联机。浏览器只在必要时辅助排查，不作为发行阶段。复用原登录、大厅、房间、服务器移动与计数、结果、下一轮和代际隔离；不移植赛车，不新增预测重演、恢复原局、增量同步或传输协议。

| 执行方 | 独占修改范围 | 基线与分支 |
|---|---|---|
| Claude（用户手动转发） | 新增`client/tests/cross_platform/`及`tests/cross-platform-client.mjs`；入口、触摸视图、测试Session子类、诊断及专项 | 同一395999f；`claude/foundation-wechat-client-20261018` |
| Sol 6.1中等 | 新增跨平台测试打包/实际PCK审计脚本及对应单测；不修改旧导出规则 | 同一395999f；`codex/foundation-cross-platform-packaging-20261018` |
| 总负责人 | 本文件、项目状态、微信测试生命周期桥、现有工具接入、隔离后端安排、独立复验与集成 | 主实施分支 |

Claude实现由负责人/只读执行方审查，Sol实现由负责人检查；所有实现未经集成测试前不算验收。可直接转发的完整任务保存在本机`.local/CLAUDE_WECHAT_CLIENT_TASK.md`，含实际路径，不提交仓库。两端生产注册保持为空，原Main继续纯二维；新测试资源只进入独立测试包，不进入生产PCK。所有导出、配置、AppID、账号、日志、数据库和二维码保留本机，不提交。原赛车、已有微信工程、现有生产服务和数据库不修改。

## 固定组合与已核对内容

- 微信工具：`SchreiberChiang/wechat-wasm-slim`，提交`4e5c2f437108c23f5e430f49636844ca8af791d3`；其实际默认分支是`feature/wechat-wasm-slim`，不是main。只复用convert，不进行trim/split或云端采集。
- PC编辑器：Godot4.7.2 Steam版；底座声明Nakama3.41.0、SDK3.4.0（固定来源见THIRD_PARTY）、Node24。当前Node实测24.18.0。手机/后端的本轮运行证据仍待采集。
- 微信开发者工具：已从实际安装目录确认2.02.2609231；wechatide skill0.3.11与工具equal，登录有效。初次PATH调用失败、默认目录检查not_installed；指定实际安装目录后成功。这是路径定位问题，不是安装失败或登录过期。
- 微信定制引擎源：`citizenll/godot` `df3cdd9bc9941a20cb5575d781cde6f937637bcb`，version.py为**4.7.2 rc**，不能称为官方stable。复用既有circuit-balanced构建，保留GUI、文字、mbedtls、WebSocket、regex；禁用2D物理等。当前fixture用普通坐标积分，不依赖2D物理引擎。没有新编译或进一步裁剪。
- 该引擎WASM：51,779,106字节，SHA256 `4872e5dda052f1ace3776eaa8ae2ffe4fbde025a4d1706dd5555e83295e9fc79`；JS `abd947013635a9f2f1c81049c7931a57f80647185757e3f39d77d103f8f0e582`；symbols `ecffe15b2956231683f165d6776fd80b8b512d4a837973bd685799ab4ac4f4cc`。构建记录为thin-LTO、单线程、javascript_eval=yes；WASM及profile哈希与BUILD记录一致。
- 官方wx-transformer1.0.35现成二进制SHA256：`f5b2d4ebbe2d077821309a455f60e397bb559ef342e51dd1b8f9a040a85e586e`，与工具pin一致；工具配置使用WXGameKit1.3.15，所选AppID的插件权限仍待项目实际检查。
- 负责人用上述工具/引擎对原366f49d交付PCK执行`convert check`退出0。此为输入结构、版本头和转换器检查，**没有启动微信引擎，也不是新fixture包或真机证明**。先前桌面PCK哈希和合并内容有对应关系，后续仍须导出本阶段实际包。

## 最小接口和平台选择

1. 测试项目生成到独立`.local/cross-platform/`目录。入口`res://tests/cross_platform/entry.tscn`在实例化原Main前注册唯一fixture；独立user目录在Session初始化前生效，避免读写默认玩家配置。PC与微信各有自己的设备身份，不复制玩家配置。
2. 仅临时测试项目替换Session autoload为`res://tests/cross_platform/test_session.gd`。ProjectSettings的`cross_platform/enabled/host/port/tls/allow_insecure_lan/diagnostics`是负责人和Claude的接口；本地开发key沿用defaultkey。生产Session仍只允许TLS或loopback明文；测试子类只有显式授权标记时允许合法RFC1918 IPv4的HTTP/WS，禁止公网明文。
3. 复用工具wx-compat后，再加载本仓库`decoded-json.js`与`acceptance-lifecycle.js`作为convert的local-interfaces，之后才启动引擎。前者处理已解压JSON的旧gzip标头，后者只转发固定hide/show，不包含网络连接或自动恢复。
4. JS全局`FoundationAcceptance`提供`subscribeLifecycle(callback)`（数字句柄，回调hide/show）、`unsubscribeLifecycle(handle)`及`isHidden()`；最多4个监听，重复加载不重复注册wx回调，释放后不再通知旧入口。异常不输出正文。Godot端负责保留/解绑回调。
5. 本阶段后台策略为：立即禁用并清空触摸/键盘输入，调用已有Session.logout，返回前台停留登录页，手动重登；不承诺恢复原局。原生PC普通窗口失焦不视为微信后台，避免切换测试窗口即退出。服务器成员消失和输入停止必须由另一端观察，不能只凭本地页面判断。
6. 用户设备为iPhone＋Wi-Fi，具体型号、iOS、微信版本待实际记录。用户于2026-10-18追加授权在既有腾讯云服务器部署本阶段测试后端：仅新增隔离实例、数据库、配置和HTTPS/WSS入口，不替换赛车生产运行时，不读写生产玩家数据，不重启既有服务。管理和数据库端口仍保持loopback；证书校验不关闭。该追加授权覆盖本阶段云测试部署，仓库默认“不部署云服”规则不扩大为通用部署许可。局域网显式测试访问仍为备选，不改系统代理或全局防火墙。

## 验收标准

- 两端固定版本和包哈希可核对；真实微信运行与PC原生运行连接同一个隔离测试后端，两个独立身份。旧赛车/Star Tap历史成功不能证明当前组合。
- 同房完整执行至少三轮：登录、建房/加入、准备、倒计时、持续移动、松手归零、按钮计数、结算、再开。每轮核对服务器位置/速度/计数以及轮次重置；按钮结果按精确seq+round查command_results，不以最高applied序号代替。
- iPhone实际按住方向切后台/返回、断开、退出房间/注销，再登录重入；本地输入停止，另一端成员清理与房主移交，旧回调不能导航或提交动作。空房回收另留后端证据。重新连接不等于恢复原局。
- 记录触摸释放、滑出/取消、同时方向和按钮、键盘与横屏/文字输入；可自动化部分先自动化，真机步骤集中提供。不能用模拟hide/show替代真实微信后台。
- 有界诊断仅含固定状态与白名单数值：发送/接收/消费数量和间隔、字节、快照接收年龄、缓冲状态、帧回调间隔和呈现采样CPU时间。记录采样窗口/条件；不能把未同步的两端时钟相减或把单向时间叫RTT。无数据的RTT/GPU/网络内部边界写缺测。
- 桌面适用回归、协议回归、实际测试PCK和生产PCK审计分别通过。生产包空注册、无fixture/测试脚本；测试包明确标识并含唯一fixture，不默认启用故障注入。
- 测试结束核对自有进程、端口、profile、IPC清理，保留数据库；不停止他人的实例或手工删锁。生产部署/发布/自动合并不属于授权范围。

## 当前证据和未完成

负责人：`node --test platform/wechat/test-acceptance-lifecycle.mjs` 8/8、退出0；`node platform/wechat/test-decoded-json.mjs` 7/7、退出0。前者只证明JS监听所有权与事件转发，后者只证明HTTP模拟回应修复。

已集成Sol打包代码99e128d、daa386d，负责人检查后亲跑`node tests/cross-platform-packaging.mjs`：51项、退出0。缺少Claude入口时实际stage-only按预期退出1且没有创建输出目录，未以假入口代替。两个服务端构建及`node tests/server-protocol.mjs`（34项）均退出0；未修改服务器。初次源码审计因全新worktree缺server/build/index.js退出1，正常构建后重跑通过，不能将初次失败记作通过。桥接另获Sol窄范围静态复核，无当前阻塞；定制引擎JSBridge可见性仍未实测。

源码隐私审计还拦下了含本机绝对路径的Claude任务文档；该文档移至忽略的.local，仅向用户提供本地文件链接，保留原审计规则。正式阶段记录不包含机器路径或真实AppID。

当前尚未收到Claude实现；新fixture测试包、iPhone＋PC三轮互通、后台/断线实机行为均未验收。明确保留定制rc引擎与stable编辑器的组合风险，实际运行失败须按引擎/工具/底座/测试入口分层定位，不能凭结构检查消除风险。无公网、长期负载或大状态选择性能结论。

负责人在8e40642代码上亲跑`node scripts/test.mjs`退出0：协议34、请求隔离107、客户端请求16、大厅44、时间轴109、SDK55；六组真实本地后端双客户端10/62/58/12/13/36。冷启动1、进程超时8、profile13、清理夹具1及启动器配置检查通过。生产PCK实际加载审计78文件、12,146,144字节、SHA256 `b96c06a2c77627de7e6cac64e1834d3ddaea9e1d1ae749d693491ceb76b9ad58`，空注册且无fixture/3D/音频/图片；HTTP模拟7、源码审计176通过。端口释放，6个数据库保留、postmaster.pid为0，未发现命令行属于本worktree的残留Nakama/Postgres/Godot进程。该完整套件不包含尚未交付的Claude客户端，也不是微信/云服证据。

新增薄封装`convert-cross-platform.mjs`复用工具的check→convert→verify；输入须为已审计的测试PCK。记录工具Git提交及dirty、PCK/引擎三件套/转换器/双bridge哈希，关闭工具的持久计时组件，AppID从本地JSON读取，不放在命令行。摘要不带AppID或本机路径；上游原始报告及输出只留.local。负责人已亲跑45项模拟外部工具测试，退出0；这些测试不能证明真实转换或微信启动。调用形式如下（所有占位路径由操作者替换，输出目录必须全新）：

```text
node scripts/convert-cross-platform.mjs --tool <tool-checkout> --engine <matched-engine-directory> --package <audited-fixture-export> --out .local/cross-platform/<new-run> --transformer <pinned-transformer> --appid-from <private-appid-json>
```

另用上述本轮生产PCK做**空底座引擎预检**，直接调用固定工具convert及verify，均退出0；verify为21通过、2提示、0失败（关闭计时、未做官方init）。该包没有fixture，不替代测试包。复用当前账户有权限的既有小游戏AppID，仅在新的本地工程打开；没有上传/发布或运行官方init。关闭工具计时不代表关闭微信SDK自身日志/平台行为，不能据此承诺整个宿主完全无遥测。

微信开发者工具模拟器实跑该预检包：基础库3.17.4、WXGameKit1.3.15，日志显示`GODOT_RUNTIME_READY`、定制4.7.2rc引擎及原生启动main_success；**截图仍黑屏，登录页没有验收通过**。仅在忽略目录的生成interfaces追加一次性数值探针并刷新一次：实际小游戏上下文可见FoundationAcceptance、hidden=false、画布2532×1170，收到首个requestAnimationFrame，10秒定时器也执行。这不能证明Godot场景已渲染或GDScript回调订阅正常，也不能据此归因到未交付的Claude入口。CLI automation_evaluate所见全局缺bridge，而生成工程内的探针可见，故不能把该自动化上下文返回值当作引擎上下文缺桥的证据。原转换文件和追加探针版本分别保留；有探针的生成目录不是冻结验收包。预检窗口已正常关闭，未登录Nakama。后续先用正式测试入口的诊断区分场景加载和显示问题，不直接修改公共UI或重编引擎。

转换单测初次引入两个字面合成AppID，被源码隐私审计拒绝；已改为运行时构造纯测试值，未放宽审计。负责人重跑45项转换单测和178文件源码审计均退出0。当前组合的完整套件证明范围仍以上述8e40642代码为准，后续新增薄封装只跑受影响专项，未把模拟工具测试写成真实fixture包验收。

云部署接入预检：已确认本机SSH agent有原授权身份，保持BatchMode、指定身份与严格known-host检查。原HTTP CONNECT代理路线和直连均在SSH版本交换阶段关闭；直连已建立TCP连接，但没有收到远端SSH banner，尚未进入密钥认证。故本轮未取得远端当前服务、端口、资源或证书清单，未执行部署或修改远端。历史赛车报告里的可达性、服务PID和空房状态不能替代当前检查；访问恢复后先只读盘点，再选择独立实例路径、端口与TLS入口。不能仅因已获部署授权就复用历史生产发布器覆盖原服务。

接续顺序：审查并集成Claude客户端和Sol打包提交 → 导出/审计测试与生产包 → convert check/convert/verify → 微信模拟器及原生PC连接 → 集中iPhone步骤并完成三轮和异常生命周期 → 完整适用回归/清理 → 固定提交与证据交付。全过程不自动合并或发布。

后续AI skill的依据只记录真实接入步骤、失败条件和取舍：先确认平台/玩法/设备/后端需求，分析引擎兼容与访问边界，给替代方案和验收理由；不把文档建议当安全保障，生产隔离依赖导出脚本、权限和实际包检查。本阶段不编写庞大指南或声称skill已经完成。
