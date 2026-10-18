# 请求回调与选择事务隔离

基线：`b8321e2239d98b5ff106c10ca876406094fa6e34`。工作分支：`codex/foundation-request-isolation-20261018`。日期：2026-10-18。

## 范围与验收

隔离validateInput、validateSelection、select及旧选择重放。某个玩家触发校验或选择异常，只影响这次操作，不能污染房间状态，也不能把其他人踢出去。input、step、inputExpired等权威执行异常继续采用整房故障保护；不新增预测重演、恢复原局、增量同步或传输路线。生产注册为空、测试模块仅用于隔离验收。

原实现将请求回调异常交给matchLoop最外层处理，可能终止整房；select还可能先修改嵌套状态再失败。旧核心的实际matchLoop故障注入可复现返回null，证明新测试针对原缺口。

## 合同与取舍

- 协议升级v3：新增rejected_module_error终态，两端同时更新；v2及更旧版本明确拒绝，不兼容赛车云服。32条终态窗口与unknown边界保持。
- 核心门禁与预算在模块校验前完成。校验得到独立请求副本；false正常拒绝，异常或非boolean是固定可恢复Module request failure。错误自身不计strike，不改变输入接受/消费/排队状态。
- 选择先复制游戏状态，再执行、复核并复制结果，最后一次提交游戏状态、保存选择、ready。true清ready；false仍提交候选/选择、保留ready。失败整体丢弃候选。支持的普通数据树、大小/深度/节点限制及禁止项见[PROTOCOL](PROTOCOL.md)与[ADDING_GAME](ADDING_GAME.md)。特殊对象状态没有自动适配，也没有真实状态兜底。
- 下一轮先创建全部成员默认状态，再逐人隔离重放。失败者丢弃保存选择、保留新轮默认；其他人继续。候选副本不回滚外部副作用，模块必须遵守纯校验及无外部写入合同。
- 提示每成员30模拟tick限频；日志按成员和固定类别30tick限频，不输出原始错误、身份或请求。诊断新增固定饱和计数，客户端终态数值白名单同步。
- 客户端可恢复提示保留连接、会话、房间代际、provider、视图和时间轴。原两类fatal提示仍退房，未放宽权威执行失败保护。

## 实施与证据归属

Sol 6.1中等分别执行服务端、客户端、独立VM回归；执行文件互不重叠，各自在独立分支。负责人集成、补实际双端故障场景及文档，并独立重跑。客户端执行方完成后转为只读审查服务端。Claude/Dot未复核本次新实现。

VM使用导出的真实matchLoop消息路径、确定性dispatcher替身，证明权威状态与请求语义；Godot专项使用实际Session/Main及SDK替身，证明客户端资源/会话边界；两者都不能冒充真实后端证据。实际网络场景使用新建loopback数据库、真实Nakama与两个Godot客户端，但仍不是公网、手机或画面观感证据。

## 运行

按README准备锁定依赖、Godot4.7.2与Nakama3.41.0，设置GODOT、NAKAMA_BIN；SCARF_ANALYTICS=false、NAKAMA_TELEMETRY=0、TEST_GUI=0。固定端口54329、7348–7351必须空闲，测试串行执行：

```text
node scripts/build.mjs
node scripts/build.mjs --fixture
node tests/server-protocol.mjs
node tests/server-request-isolation.mjs
node scripts/test.mjs --prepare-only
node scripts/test-godot-unit.mjs module_request_isolation
node scripts/test.mjs
```

完整入口包含新VM/Godot专项及request双客户端场景。后者经原有自有后端启动器运行，不连接任何生产服务；测试专用故障输入不进入生产注册或导出。`.local`保存原始本地日志、数据库与数值摘要，不上传原始消息/配置。

## 当前验证记录

负责人在Windows、Node24.18.0、Godot4.7.2.stable.steam.ed1daf0bf、Nakama3.41.0+cab8af58、TypeScript5.9.3亲跑。最终冻结生产代码及测试提交为`5c92065b270299ad132e11dfebf5a876c105ae94`；随后只更新本报告和PROJECT_STATUS，没有改动已验证代码。

| 命令/证据 | 退出码 | 结果与范围 |
|---|---:|---|
| `node scripts/test.mjs`（最终冻结版） | 0 | 生产及fixture构建；服务端协议34、请求隔离79；客户端请求隔离16、大厅44、时间轴109、SDK55；profile13、外层配置回归1、进程8、冷副本1、启动器24全部通过 |
| 同一完整入口的六组真实后端双客户端 | 0（完整入口） | 空注册10、fixture62、诊断58、input故障12、projection故障13、request故障36全部通过 |
| 实际PCK导出/运行审计 | 0（完整入口） | 78文件、12,146,144字节；包内登录页实际运行、空注册、无fixture/禁止节点或游戏资源 |
| 微信HTTP替身和源码审计 | 0（完整入口） | HTTP模拟7；源码169文件，SDK固定哈希、空生产注册、链接及私有/生成文件排除通过；不是微信平台测试 |
| 新回归用于旧b8321e2运行时，过滤validateInput throw | 1（预期失败） | 实际matchLoop返回null，击中原整房终止缺口；同一用例新核心通过 |
| 本地清理核验脚本 | 0 | 五端口实际可绑定；无新增owned profile或IPC，默认配置哈希不变；另查监听及匹配测试进程均为0 |

完整日志：`.local/request-full-final.log`；旧核心预期失败：`.local/request-baseline-negative.log`；清理：`.local/request-cleanup.json`。默认配置真实路径和哈希仅留本机，未提交。实际包SHA256由负责人另行读取文件重算：`db01080c7d6fb4cbed033ab5fa9f37947ecdf5a787d920e5ecb5e47102f2d6ad`。这不是跨平台或跨路径可复现构建承诺。

第一轮完整入口也退出0（`.local/request-full-first.log`），当时VM专项为56项；随后补了候选输出/引用/复制边界测试，发现fixture缺方向可能返回undefined，改为严格false并补回归，才冻结并完整重跑上述最终版。只读复核发现的网络测试连续op5会触发客户端220ms节流，已将测试发送间隔设为250ms；错误提示窗口使用服务端tick推进等待。这些是受控测试条件，不是网络时延测量。

两轮共12套独立数据库及其PG_VERSION全部保留，postmaster.pid已正常清除，无手工删锁。固定端口先通过绑定检查才启动，没有停止/接管其他实例。原赛车检出只作为已有Nakama二进制来源，没有修改项目或其数据库；不连接云端。真实request服务日志出现4条固定类别警告，未发现PRIVATE_REQUEST异常哨兵；客户端输出门禁同样检查该哨兵。

冻结代码经Sol只读复核，无阻断发现。该审查不代替负责人的完整重跑，也不代表Claude/Dot已复核。本阶段只在独立本地分支提交，未推送、未修改Draft PR #1、未合并或部署。

## 逐项验收依据

| 要求 | 对应证据 |
|---|---|
| 核心门禁先于模块调用 | VM实际matchLoop分别测试phase、round、session、envelope、旧seq、future、stale、rate及queue；统计回调调用次数为0 |
| 三个回调抛错/非法值只影响请求 | VM逐个注入throw/undefined/object/number/string，校验两成员、两份定向快照、无kick、状态与回执；实际双端request场景覆盖三个抛错路径 |
| 候选失败不污染真实数据 | 嵌套候选和另一成员状态先修改后抛错；后置clone拒绝cycle/Date/超大输出；真实双端核对位置、分数、选择、ready |
| 成功提交与引用隔离 | select true/false分别核对状态和ready，校验修改不影响被消费请求；保存的candidate/请求/校验引用在返回后再次修改不能影响已提交状态 |
| 后续操作与旧选择恢复 | 同tick后续成员消息、下一条合法请求；旧选择校验throw/false/非法值及select抛错，分别让房主或访客失败，核对错误接收者和其他成员重放 |
| 回执和窗口 | error终态不推进accepted/applied、不入队或替换持续输入；已排队/已知结果重复不重校验、不覆盖；32条窗口和后续合法命令仍生效 |
| 限频、脱敏、正常拒绝 | 模拟tick推进前后分别核对提示/日志数量、固定类别、异常哨兵缺失；false不计模块错误/strike；fixture缺方向也严格返回false |
| 客户端恢复及fatal边界 | 真实Session/Main专项16项：socket/account/generation/epoch/provider/view/timeline保持，下一快照和输入正常；原两类fatal提示仍释放；VM input/step和真实后端input异常仍整房失败 |
| 数据合同 | null原型与稠密JSON数组、深度32和65,536字节成功；超限、共享别名、特殊类型、symbol、稀疏/不可枚举属性、污染键拒绝；getter计数为0；真实Goja跨tick选择及重放通过 |

持久回归未逐个列举所有合法值组合；自有toJSON及自定义原型另由只读Node VM探针验证拒绝，不将此扩展为任意代码沙箱或CPU执行时限保证。

## 未测与边界

未测公网/WAN、真实链路丢包/重排、Web/WASM、微信模拟器与实机、手机、Linux/macOS完整后端/Godot/PCK、长期负载及跨设备主观平滑。复制限额证明拒绝边界，不是处理耗时上限或任意第三方代码安全沙箱。外部create/join/leave等回调继续遵守现有合同。所有网络故障均为明确测试注入，无生产服务、账号或凭据使用。
