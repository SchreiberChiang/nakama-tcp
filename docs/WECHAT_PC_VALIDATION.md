# 微信与原生电脑双客户端验收

更新日期：2026-10-19。底座基线：`395999f913a0d6102ea1a604181d1f45ecd8ef65`（PR #1 merge commit）。实施分支：`codex/foundation-wechat-pc-20261018`。

当前状态以[阶段收尾](WECHAT_STAGE_CLOSEOUT.md)为准：本阶段验收通过、已完成；用户已授权以保留历史的merge commit合并PR #2，合并状态与提交以[PR #2](https://github.com/SchreiberChiang/nakama-tcp/pull/2)为准。最新源码002bf6d、PCK7681d747，手机成功打开诊断面板；横屏双方向边界/页签/关闭/胶囊底栏、分页内滚和中文概览获用户确认。对局中打开清触控、关闭后恢复及松手/计数本轮真机未测；用户明确接受风险并豁免其作为本阶段及下一阶段硬门禁，后续接入建议复验。自动150项触控覆盖和风险接受均不构成该项真机实测证据。

生命周期四组人工通过仍绑定c06b6a47；源码云三轮71项和实际PCK登录/WSS是不同证据。后续各包结果按版本列在收尾报告，不继承旧包全部真机结论。下文保留各固定版本的历史过程；段内“当前”“待验收”“未部署”等仅描述该节当时状态，不是今天的待办。

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
- PC编辑器：Godot4.7.2 Steam版；底座声明Nakama3.41.0、SDK3.4.0（固定来源见THIRD_PARTY）、Node24。当前Node实测24.18.0。手机用户报告及隔离后端运行证据见文末，各自固定版本和来源分开记录。
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

以下早期记录截至649a427；当时尚未收到Claude实现。后续集成与排查结果见文末“本轮集成与显示排查”。iPhone＋PC三轮互通、后台/断线实机行为仍未验收。明确保留定制rc引擎与stable编辑器的组合风险，不能凭结构检查消除风险。无公网、长期负载或大状态选择性能结论。

负责人在8e40642代码上亲跑`node scripts/test.mjs`退出0：协议34、请求隔离107、客户端请求16、大厅44、时间轴109、SDK55；六组真实本地后端双客户端10/62/58/12/13/36。冷启动1、进程超时8、profile13、清理夹具1及启动器配置检查通过。生产PCK实际加载审计78文件、12,146,144字节、SHA256 `b96c06a2c77627de7e6cac64e1834d3ddaea9e1d1ae749d693491ceb76b9ad58`，空注册且无fixture/3D/音频/图片；HTTP模拟7、源码审计176通过。端口释放，6个数据库保留、postmaster.pid为0，未发现命令行属于本worktree的残留Nakama/Postgres/Godot进程。该完整套件不包含尚未交付的Claude客户端，也不是微信/云服证据。

新增薄封装`convert-cross-platform.mjs`复用工具的check→convert→verify；输入须为已审计的测试PCK。记录工具Git提交及dirty、PCK/引擎三件套/转换器/双bridge哈希，关闭工具的持久计时组件，AppID从本地JSON读取，不放在命令行。摘要不带AppID或本机路径；上游原始报告及输出只留.local。负责人已亲跑45项模拟外部工具测试，退出0；这些测试不能证明真实转换或微信启动。调用形式如下（所有占位路径由操作者替换，输出目录必须全新）：

```text
node scripts/convert-cross-platform.mjs --tool <tool-checkout> --engine <matched-engine-directory> --package <audited-fixture-export> --out .local/cross-platform/<new-run> --transformer <pinned-transformer> --appid-from <private-appid-json>
```

另用上述本轮生产PCK做**空底座引擎预检**，直接调用固定工具convert及verify，均退出0；verify为21通过、2提示、0失败（关闭计时、未做官方init）。该包没有fixture，不替代测试包。复用当前账户有权限的既有小游戏AppID，仅在新的本地工程打开；没有上传/发布或运行官方init。关闭工具计时不代表关闭微信SDK自身日志/平台行为，不能据此承诺整个宿主完全无遥测。

微信开发者工具模拟器实跑该预检包：基础库3.17.4、WXGameKit1.3.15，日志显示`GODOT_RUNTIME_READY`、定制4.7.2rc引擎及原生启动main_success；**截图仍黑屏，登录页没有验收通过**。仅在忽略目录的生成interfaces追加一次性数值探针并刷新一次：实际小游戏上下文可见FoundationAcceptance、hidden=false、画布2532×1170，收到首个requestAnimationFrame，10秒定时器也执行。这不能证明Godot场景已渲染或GDScript回调订阅正常，也不能据此归因到未交付的Claude入口。CLI automation_evaluate所见全局缺bridge，而生成工程内的探针可见，故不能把该自动化上下文返回值当作引擎上下文缺桥的证据。原转换文件和追加探针版本分别保留；有探针的生成目录不是冻结验收包。预检窗口已正常关闭，未登录Nakama。后续先用正式测试入口的诊断区分场景加载和显示问题，不直接修改公共UI或重编引擎。

转换单测初次引入两个字面合成AppID，被源码隐私审计拒绝；已改为运行时构造纯测试值，未放宽审计。负责人重跑45项转换单测和178文件源码审计均退出0。当前组合的完整套件证明范围仍以上述8e40642代码为准，后续新增薄封装只跑受影响专项，未把模拟工具测试写成真实fixture包验收。

早期云部署接入预检（历史，后续已恢复）：已确认本机SSH agent有原授权身份，保持BatchMode、指定身份与严格known-host检查。原HTTP CONNECT代理路线和直连均在SSH版本交换阶段关闭；直连已建立TCP连接，但没有收到远端SSH banner，尚未进入密钥认证。当时未取得远端当前服务、端口、资源或证书清单，未执行部署或修改远端。历史赛车报告里的可达性、服务PID和空房状态不能替代当前检查；恢复后先完成只读盘点，才选择独立实例与TLS入口，没有复用生产发布器覆盖原服务。

接续顺序：审查并集成Claude客户端和Sol打包提交 → 导出/审计测试与生产包 → convert check/convert/verify → 微信模拟器及原生PC连接 → 集中iPhone步骤并完成三轮和异常生命周期 → 完整适用回归/清理 → 固定提交与证据交付。全过程不自动合并或发布。

后续AI skill的依据只记录真实接入步骤、失败条件和取舍：先确认平台/玩法/设备/后端需求，分析引擎兼容与访问边界，给替代方案和验收理由；不把文档建议当安全保障，生产隔离依赖导出脚本、权限和实际包检查。本阶段不编写庞大指南或声称skill已经完成。

## 本轮集成与显示排查（2026-10-18，代码bfb8535）

已收到并审查Claude客户端6cdbea0，集成为9adb91f。Sol在独立分支补充生命周期句柄校验（0为订阅失败）、固定“隔离测试”标识和诊断窗口字节数，集成为3e1078e；负责人独立重跑客户端77项、退出0。没有改动Claude原工作区。

实际PCK导出揭示两项模拟测试未覆盖的问题：空的Windows export options被Godot视为缺失；运行时清单使用编译后的fixture_view.gdc而审计只允许.gd。分别由ae4208e、017b05c修正，并排除跨平台单元测试脚本。仅精确放行相应.gd/.gdc及伴随文件，额外后缀仍拒绝。负责人重跑打包64项、转换封装45项均退出0。

中文异常实证为字体继承问题：Main根Control的局部font override不会传给子Label/Button/LineEdit。桌面系统回退字体掩盖了缺字；微信默认字体没有这些中文字形。独立微项目确认局部覆盖不继承、Theme.default_font继承；导入配置hinting=3/subpixel=4是导入器选项，会转换成运行时1/1，不是rc/stable枚举不兼容。没有重编引擎或替换字体资源。

代码bfb8535将公共UI字体改为Theme.default_font，并把同一Theme传给测试CanvasLayer内的按钮和诊断区。新增三个真实控件字体断言：旧代码大厅46项中2项失败、跨平台78项中1项失败；修正后负责人重跑大厅46/46、跨平台78/78，均退出0。另一Sol只读检查主题资源生命周期、页面重建及跨层引用，未发现阻塞；该审查本身不是运行证明。

冻结测试包来自干净bfb85357d92f7b7c87907dd863ee7d742ca7b59e：12,177,692字节，SHA256 `6984ddf05cdc4f88859a6feddf0cc9336c0fe3d79b8e3d1ace96dc57a0b68533`。`export-cross-platform --diagnostics`实际导出和运行时资源清单审计通过。随后固定工具4e5c2f4执行check→convert→verify均退出0；合并interfaces SHA256 `c7bc76a3c8435b3e1c34dcbe001c191165edbfae44997d3bc317d2c5163ad21d`。产物分别保留在本机`.local/cross-platform/fixture-font-01`、`fixture-wechat-font-01`，没有追加生成文件探针。

负责人实际打开新微信工程：初始截图仍处于平台资源加载阶段；后续截图显示原登录页、隔离测试标识、中文说明和底部测试按钮，字体可读。更早的空包在fullMode和liteMode重试也曾显示登录页，因此不能把模式切换当成黑屏修复原因。当前证明“该包能在开发者工具模拟器完成加载并呈现登录页”，不证明所有黑屏条件消失、冷启动性能达标或手机通过。CLI画布tap返回`canvas not found`，尽管截图可用；本轮没有把自动化调用成功或引擎main_success当作触摸/场景交互证明。没有执行登录，尚无此测试包的网络联机结果。

SSH已恢复：负责人及独立Sol均通过指定身份、BatchMode和严格known-host检查完成只读登录，退出0；现有Nakama/Postgres/Caddy版本为3.41.0/16.14/2.11.7，原服务保持active且PID未变。此前直连也经过本机TUN，不能与HTTP代理当作两条独立外网路线；未修改代理、路由、安全组或SSH配置，不能确定此前握手前关闭的根因。当前资源足够考虑一个独立小实例，候选目录与端口在只读快照中未占用；尚未创建实例或修改远端。既有IP证书到2026-10-24到期并有续期任务；如复用它，须记录续期依赖且不修改原证书/服务。新端口公网可达性仍未测。

负责人在bfb8535代码上重新运行`node scripts/test.mjs`，Windows/Node24.18.0/Godot4.7.2 stable/Nakama3.41.0，最终退出0：协议34、请求隔离107、客户端请求16、大厅46、时间轴109、SDK55；六组真实本地后端双端10/62/58/12/13/36；profile13、外层清理1、进程超时8、冷启动1、启动器配置24均通过；HTTP模拟7、源码审计196通过。生产PCK运行审计78文件、12,145,888字节，SHA256 `893150205b119a103eccd0c2645e5294d522067fc3373e46abe225ece253431e`，空注册、无fixture/3D/音频/图片。新跨平台客户端78项单独执行通过，未冒充完整入口已包含该专项。日志为本机`.local/after-font-full-test.log`；六个新数据库保留、postmaster.pid为0；54329和7348–7351无监听，未发现属于本工作区的Nakama/Postgres/Godot残留进程。

上述字体阶段截图、控制台和云盘点仅保留本机`.local`；不提交AppID、主机身份、配置或凭据。当时的接续为建立独立云实例与匹配测试包；下述记录更新这部分进展。手机实际hide/show、JSBridge订阅回调、双端触摸移动计数及跨设备观感仍未验收，不以字体包界面或本地回归代替。

## 独立云部署与网络复验（2026-10-18，源码测试6cd96d4）

用户追加授权后，负责人在原服务器新增独立实例、OS用户、PG cluster、配置、runtime和三个专属unit；未复制原数据库或修改/重启赛车服务。PG56449、Nakama20448–20451、Caddy admin20490均loopback，仅新HTTPS/WSS TCP20443公开。新unit为static，未enable开机启动。会话/refresh、console、DB及runtime HTTP key分别随机生成，仅defaultkey作为clientdev测试key。部署fixture runtime SHA256为`b101f7a44a4c84c4bc87f617fc7986e2617a3fa64ebc175d483e0c2559b07630`；服务端启用`GAME_DIAGNOSTICS=1`。冻结生产client与server没有为这轮测试改动；6cd96d4只扩展测试驱动与证据。

安装先因现有精简PG没有createdb失败，仅停止本次新unit并保留数据。负责人随后仅在新cluster用postgres standalone创建库，处理新节点名超过16字符及新Caddy的IP无SNI匹配问题，完成新实例迁移与启动。服务器本机CA验证TLS及health200通过。原服务PID、进程起始tick、exe/unit/配置hash在安装前后及网络测试后保持一致，留存于`.local/cloud-deploy/after-network-status.txt`；新三个unit均active。失败和修复日志保留，不把初次安装记成一次成功。

公开端口最初外部连接失败，实际PCK smoke也失败，退出后profile清理通过。主机iptables/nft未发现20443拒绝规则，短时抓包0 captured不能单独定位阻断层。负责人在腾讯控制台核实当时8条规则缺少20443，用户确认后**仅新增TCP20443一条**，规则变为9条，应用截图为本机`.local/cloud-deploy/firewall-20443-applied.png`。随后外部curl使用正常CA校验得到health200、退出0；没有关闭TLS验证、修改全局sysctl或改旧服务端口，443仅做候选核查而未启用。

新Caddy只读引用既有有效IP证书，未改原证书/权限/续期。证书元数据到期为2026-10-24 07:21:12 UTC；原续期为standalone HTTP-01（80端口），不占443。原renewal切换证书目录后，新Caddy未必自动加载；延续测试前应重新核验新端点证书，必要时只重启新proxy。停止测试用私有stage内的`manage.py stop`，顺序仅为新proxy→server→PG，保留数据；若unit已改须先核对所有权SHA，不删锁或停止原实例。

### 源码双客户端与实际PCK分别验证

负责人在Godot4.7.2 stable Steam下执行源码驱动`node tests/network.mjs`：

| 路径 | 参数与结果 | 本机证据 |
|---|---|---|
| 本地隔离后端三轮 | `TEST_FIXTURE=1 TEST_ACCEPTANCE_ROUNDS=3`，未启diagnostics；75项、退出0 | `.local/network-fixture-1792327643813/result.json`、`three-round-local.log` |
| 云端首次三轮尝试 | 未设`TEST_DIAGNOSTICS`，服务端已开诊断，因“未开诊断应无服务端diagnostics”的预期不符而失败 | `.local/three-round-cloud.log`；保留失败，不计通过 |
| 云端修正参数三轮 | `TEST_HOST=<隔离测试IP> TEST_PORT=20443 TEST_TLS=true TEST_REMOTE_OWNED=1 TEST_FIXTURE=1 TEST_ACCEPTANCE_ROUNDS=3 TEST_DIAGNOSTICS=1 GODOT=<Steam 4.7.2>`；71项、退出0 | `.local/network-fixture-1792328008740/result.json`、`three-round-cloud-diagnostics.log` |

三轮覆盖服务器移动/释放、精确seq和round的按钮计数、权威结算、重开清理，以及退出/断线后的成员清理与房主移交。该驱动运行源码client并直接驱动已有Session/UI，是两个原生Godot客户端的真实云链路证据；**不是冻结PCK的cross_platform UI点击、微信触摸或iPhone三局验收**。75与71项来自不同配置分支，不作为性能或覆盖率高低比较。

网络目标/轮次数参数专项`node tests/network-target.mjs`共28项、退出0，不发网络请求。最终`node scripts/source-audit.mjs`退出0，197个文件，空生产注册、SDK pin、文档链接、隐私与生成文件排除检查通过。生产代码未在这次网络测试扩展中修改，完整本地套件及生产PCK仍引用上文固定bfb8535证据，不冒称本轮又重跑全套。真实远端三轮未额外注入迟到认证/join/leave/send回调；受控延迟旧回调的已有专项与真实手机后台行为不能相互替代。

云端`result.json`的`remote_tls_movement` host单次观察示例：服务端累计received26、accepted24、consumed24、sent101，最近receive/consume间隔34ms、send间隔66ms；客户端send_attempt/completed各28、snapshot_received102、consumed101。呈现采样的snapshot_receive_age为51ms、frame callback interval约6.94ms、sample CPU为51µs。客户端此时接收/消费有界窗口各102/101样本，窗口平均间隔约49.28/49.78ms；这是该阶段单次记录，含启动/阶段切换的累计观察，不是整段稳定性统计。客户端、服务端计数作用域不同，不能据差值推断丢包；age、间隔与CPU分别在各自时钟/测点记录，没有跨端时钟相减，均不是RTT、GPU耗时或物理显示帧率。

冻结cloud测试PCK来自干净`e20277f3a9f3a2d9272ab22f589df3f28e200703`：12,177,708字节，SHA256 `c06b6a474a4391d0c4a73ad6c0babf14d1d8cbc32832ab58abef7f27a2b4f250`。固定工具4e5c2f4、上述rc引擎及转换器执行转换；只读解压微信data-package后，内嵌PCK与manifest/CONVERT_REPORT/package-info哈希一致。产物为`.local/cross-platform/cloud-fixture-001`及`cloud-wechat-001`，不混用先前字体包。

负责人运行`.local/pck-cloud-smoke/run.mjs --connect`退出0：实际冻结PCK同一进程内三次游客设备登录、v3 catalog、fixture_v1、WSS与logout均通过，身份只作同进程布尔一致性比较；退出确认和独立profile清理均通过。证据为`.local/pck-cloud-smoke/connect-after-firewall.log`及`connect-AQOGlG/wrapper-result.json`，先前connect-attempt失败仍保留。该脚本从实际PCK加载测试Session，但由外部GDScript专项驱动，不是点击三局、cross_platform UI全流程或跨进程重启身份持久化。现有访客本来就是设备身份免密码登录；微信身份/文件持久化尚未测，当前引擎桥`initFS([])`没有持久mount，不能承诺微信重开仍为同一游客。

### 当前显示阻碍与手机入口

最新cloud诊断包在6cd96d4测试基础上增加一次性阶段标记：12,178,124字节，SHA256 `3f6bf91efedcca52cfea6f2cf7d412bb0e2d6bc63022a850dcd69019df2b703c`；原始诊断修改和被拒绝的初版包另记manifest，**此包不是验收包**。微信模拟器一次刷新后六个标记全部出现：Session ready开始/结束、entry ready开始/结束、first_process、first_frame_post_draw；截图仍纯黑。帧提交回调出现只证明执行抵达该点，不能证明画布图像可见或黑屏已修复。当前排查画布显示，旧字体包的可读登录页截图不作为新cloud包通过证据。

随后负责人仅在诊断副本framework中添加固定启动参数、挂载路径/长度和一次画布读回：`--main-pack /test.pck`正确，canvas/drawingBuffer均2532×1170，context未丢失、当前framebuffer为默认目标、中心RGBA为[20,25,36,255]、GL error为0；同次截图仍纯黑。这说明该采样的缓冲并非纯黑，仍不足以确认完整UI可见或定位截图/合成的具体原因。额外探针未进入冻结验收包、仓库源码或手机预览。

负责人对**未加探针的cloud-wechat-001**调用`create_preview_qrcode`，退出0并生成二维码；平台返回包总计20,460,307字节（main 1,669,008、data-package 12,103,345、wasmcode 6,687,954）。只执行开发预览，没有上传体验版或发布。对应微信内嵌PCK仍为上述c06b6a47；本机二维码不提交仓库。电脑启动同一PCK的原生交互窗口，使用独立`pc-acceptance` profile；`Start-PC.cmd`依赖本机已有Steam Godot，不是自包含发行安装包。

用户随后明确反馈：**iPhone已显示登录页，并进入大厅**。这是用户提供的真机显示/登录证据，未取得真机日志或录屏，不冒充负责人自动化亲跑；具体iPhone型号、iOS和微信版本仍待补充。模拟器黑截图尚未修复，不应将其直接归因于真机黑屏。现已提供iPhone＋PC三局操作步骤，正在等待同房移动/松手停止、分别点击1/2次计数、结算及再开归零的结果；真实后台/断开/退出、房主移交、旧回调及三轮完整链路仍未验收。

游客入口是已有设备身份认证，预置地址/端口/TLS/clientdev key后无需账号密码；它不是微信账号授权登录。微信跨重启/清缓存/换包身份保留未测。当前不公开提交本机日志、AppID、私有配置、二维码或身份材料。公网源码驱动、实际PCK专项与上述用户真机反馈分别记录，不混写为整个阶段通过。

后续逐步人工反馈（2026-10-18）：用户确认可以移动、计数；约一局后出现“服务端结算”和“留在房间 / 房主开启下一局”，与fixture固定12秒自动结算路径一致，不将该现象记为掉线。用户随后确认“新一局计数归零了，也能继续移动”。据此记录真机移动/计数/结算及至少一次再开行为的用户报告；尚未确认三局完整重复、两端各自精确点击数、松手停止、真实后台返回、断开清理或房主移交。下一步逐项验证真实微信后台，而非要求用户一次判断全部结果。

紧接着的真实后台操作，用户反馈“切后台再回来，手机回到登录页了，电脑那边人数也少了一个”。这支持至少一次真实微信hide/show后的本地会话退出及另一端可见的成员清理，符合本阶段不恢复原局的策略；未采集精确耗时，未确认发生在持续按住方向的playing阶段，不能据此宣称输入停止时限或三次后台循环已通过。下一步是电脑将房间留在待准备状态，手机重新登录并主动加入，随后检查房主移交与其余未测项。

用户又确认手机重新登录后可以加入房间，人数恢复2人且可以准备，记录为后台退出后的主动重登/重入用户反馈，不称恢复原局。用户要求后续一次给全剩余步骤，统一回报，不再逐句往返。剩余集中检查：连续三局两端移动/松手/准确点击数/结算及归零；playing早期切后台后的另一端观察；待准备状态房主退出移交、原房主重新加入后由新房主开局；两端最终退出并等待空房回收（服务端超过300个30Hz tick，约10秒）。纯网络中断、旧异步回调故意延迟注入和时间上界仍需独立证据，不能把打开控制中心触发后台当作纯断网。

## 四组真机人工验收收尾（2026-10-18）

用户集中回复“四组全部符合预期”，并补充设备为 **iPhone 16 Pro、iOS 18.3.1、微信8.0.75，Wi-Fi**。结果绑定此前未加探针的cloud-wechat-001及电脑同源cloud-fixture-001，PCK SHA256仍为`c06b6a474a4391d0c4a73ad6c0babf14d1d8cbc32832ab58abef7f27a2b4f250`，源提交e20277f；引擎/微信工具/后端runtime版本见上文。

| 集中操作 | 用户报告结果 |
|---|---|
| 连续三局：双端移动、松手停止、电脑1次/手机2次计数、正常结算、再开归零 | 全部符合预期 |
| 累计三次后台退出/返回/手动重登重入，含playing早期后台步骤 | 全部符合预期 |
| 待准备时房主退出，另一人接任；旧房主重新加入，新房主开局，重复三次 | 全部符合预期 |
| 两端退出，等待约15秒后检查原空房消失 | 符合预期 |

这是**用户执行的微信＋原生电脑人工验收**，负责人没有取得手机录屏、原始日志或逐轮计时。支持本次固定组合的功能链路通过，不代表输入停止时限、稳定帧率、延迟分布或所有设备均通过。此前“等待型号/四组结果”的段落保留为过程历史，以本节收尾结果为准。

仍未测：纯网络中断（不同于切后台）、真机故意延迟旧回调注入、微信重启/清缓存/换包后的游客身份持久化、手机数值诊断、长时负载、其他设备/网络。后台返回要求手动登录和加入，是新会话，不是恢复原局。模拟器黑截图原因未定位，不能否定实际手机反馈，也不能据手机成功宣布模拟器问题修复。

## Claude阶段提示集成与复验（代码b30c87b）

用户交付Claude本机交接报告后，负责人核对独立分支固定提交`7b07436cfd4f4bd067277bb70c64817163db395e`，集成为7b74dea。范围仅为隔离测试客户端：只读提示游客免密码、当前准备/开局/结算阶段、约12秒自动结算以及后台退出策略；提示依据Session/lifecycle状态，不发请求、不改变权威数据，不进入生产导出。

证据区分：Claude报告专项93项、构建/准备/源码审计和桌面登录/合成长提示截图通过；负责人亲跑其专项93/93。Sol只读审查发现entry先初始化后台策略、后创建guide时可能遗漏注销原因；负责人按真实顺序补回归，95项中1项失败，随后仅补初始hidden原因，95/95通过。固定修复为`b30c87bbef008824a4415a94fbca2ac40ef0f3bb`，Sol再次只读审查通过。实际注销/输入清理逻辑未修改。

负责人在Windows、Node24.18.0、Godot4.7.2 stable Steam上运行以下适用检查；本次不声称又运行整个scripts/test.mjs：

| 命令/入口 | 退出码及结果 |
|---|---|
| `node tests/cross-platform-client.mjs` | 0，95项；修前故障记录退出1保留 |
| `checkedGodot`运行`res://tests/sdk_socket_lifecycle.gd`、`res://tests/lobby_state.gd` | 均0，55/55、46/46 |
| `node scripts/build.mjs --fixture` | 0 |
| `TEST_FIXTURE=1 TEST_ACCEPTANCE_ROUNDS=3`，独立数据库，`node scripts/run-with-server.mjs --test-cooperative-stop node tests/network.mjs` | 0，真实本地双客户端75项；非新提示包的UI点击 |
| `node scripts/export.mjs` | 0，实际生产PCK78文件、12,145,888字节；SHA256仍为893150205b119a103eccd0c2645e5294d522067fc3373e46abe225ece253431e |
| `node scripts/audit-cross-platform.mjs --pack .local/cross-platform/cloud-guide-001/test.pck --out .local/guide-root-pck-audit` | 0，负责人独立从空目录加载实际新测试包并审计 |
| `node scripts/source-audit.mjs` | 更正文档本机绝对路径后0，199文件；先前失败保留，未放宽审计 |

SDK首次误用不存在的`tests/sdk.mjs`退出1，后改用仓库正式Godot入口55项通过，未将错误命令计为成功。日志留本机`.local/guide-*`；网络结果在`.local/network-fixture-1792333102193/result.json`。测试退出后54329、7348–7351无监听；新数据库保留且无postmaster.pid。完整套件仍引用上文bfb8535的历史固定版本记录。此次生产源码和后端runtime未变，实际生产PCK哈希相同。

Sol从干净b30c87b导出新提示版`.local/cross-platform/cloud-guide-001/test.pck`：12,184,872字节，SHA256 `15e371e4c9eb24e311069ab46ffe490742cf3a00e7f3d2035f3be6e6313c3603`，manifest.source_dirty=false。实际资源99个，含acceptance_guide编译脚本、不含跨平台单元测试；entry前生产注册为空、实例化后仅fixture，未发现3D/业务资源。负责人独立重跑实际PCK审计通过。

Sol用同一固定工具4e5c2f4、引擎三件套和转换器执行`node scripts/convert-cross-platform.mjs`，check→convert→verify退出0，产物`.local/cross-platform/cloud-guide-wechat-001/wechat/minigame`。Sol另行解压data.bin逐字节核对内嵌PCK，确认与上述新包一致，旧包c06b6a47未改；负责人核对转换成功日志与导出manifest，此次未独立重跑转换器。原生电脑仍用Godot4.7.2的`--main-pack <test.pck> -- --profile=pc-acceptance`启动，属于测试包而非自包含安装器。新微信工程未生成新预览二维码，未上传体验版或发布。

**新提示版没有重新做iPhone验收**。原四组人工通过属于旧冻结包，不能自动转移；作者桌面合成文案截图/布局断言和实际PCK加载也不等于新包完整playing界面或手机视觉验收。保留旧包及其证据，新版不覆盖旧预览、不重新部署服务器。本阶段接入依据已记录：冻结版本与包、区分资源导出/引擎启动/实际显示/联网、设备游客与持久化边界、阶段文字避免误解结算、真实后台与纯断网分开验证；不扩建skill指南工程。

下一阶段建议先选一个二维小型真实玩法（例如双人协作搬运/踩点），限定一种移动、一个交互和一个服务端胜负条件，以检验模块接口是否足够；立项时明确设备、状态规模、资源预算和三轮验收条件。新提示如需用于下一次手机操作，先做一次有限的登录/playing/结算/后台文字与触控遮挡检查，无须把旧包已通过的四组矩阵全部重做。预测重演、恢复原局、增量同步按测出的具体需求另定；本轮未开始下一玩法实现、未合并或发布。
