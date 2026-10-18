# 复用的房间协议

认证仍走官方 Nakama 设备/邮箱认证与会话 WebSocket；账号 session 与房间 presence session 不可混淆。首次显式协议版本 `protocol_version=1`，模块另有正整数 `module_version`。catalog 和快照声明两者；加入 metadata 必须同时匹配（字符串），缺字段的旧客户端被拒绝。本合同不兼容原赛车云服，不能混连。

| 接口                | 内容                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| RPC `game_catalog`  | 空载荷；protocol_version=1、games（module_version/input_kinds）、room_flow_version=1、room_phase_version=2、容量和聊天能力            |
| RPC `room_list`     | `{}` 或 `{game_id}`，返回 match_id/label/size                                                                                         |
| RPC `room_create`   | `{game_id,name,options?,capacity?}`；模块必须已注册；名字1–32字符，容量在模块最小人数到8之间                                          |
| join match metadata | `display_name`、`protocol_version:"1"`、`module_version:"1"`、`room_phase_version:"2"` 与模块的可选能力声明                           |
| op1                 | 输入 `{seq,round_id,kind,client_tick,...moduleInput}`；kind 为模块input_kinds声明支持的state或command；每用户最多60/s，playing 才接受 |
| op2                 | 准备 `{ready,round_id}`，lobby且本轮才生效                                                                                            |
| op3                 | 开始 `{round_id}`，房主、最小人数、全部准备且本轮后服务端倒计时3秒                                                                    |
| op4                 | 留房/下一局 `{round_id}`，仅本轮 results；房主切回 lobby 并递增 round_id，访客仅 staying=true                                         |
| op5                 | 可选模块选择 `{round_id,selection}`，模块校验和解释，无默认业务                                                                       |
| op6/12/13           | 房间聊天发送/消息/错误；只在 lobby/results，独立白名单与限流                                                                          |
| op10/11             | 服务端快照/固定类别操作错误                                                                                                           |

模拟30Hz、默认快照20Hz（可显式选10/30）。快照包含 tick、tick_rate、snapshot_rate、phase、game_id、options、host_id、capacity、min_players、host_change、countdown、round_id、results、players。核心为模块 players 补齐 connected、ready、staying、accepted_input_seq 并保持加入顺序。

每条输入必须属于当前用户、当前 presence session、当前 round_id，seq 单调递增；过期轮次/重复序号不应用。普通控制限6/s、载荷256字节，畸形/越权有 strike 与踢出阈值；聊天独立限额。创建房间按账号服务端时间限3秒，存储 CAS 防并发绕过。人数包含短期待加入席位；重复账号、满房和非 lobby 拒绝加入。房主离开或失联由服务端按加入顺序移交。全空房约10秒回收。

输入 `seq`、`client_tick` 必须为0到2147483647的整数；客户端重试使用原seq；服务端不信任客户端seq作为时间或分数。误发巨大合法seq会使本轮更小seq被拒绝，需要新轮次/新会话重新加入恢复；客户端不能替服务器提交分数。`client_tick` 是客户端最近收到的服务端快照tick，不能用客户端时钟；超过服务端当前tick未来2tick或过期30tick拒绝。固定一秒窗口限额不是平滑令牌桶，跨窗口可突发；仍受每tick消费和队列上限约束。非playing拒绝不会推进接受序号。

`state` 表示完整持续状态，单个用户只保留最新一份，tick内多次更新被合并。新状态首次消费时调用一次module.input，随后module.step按30Hz积分；最后接收15tick（0.5模拟秒）后调用inputExpired清零，清零不是新输入。声明支持state的模块必须实现该回调，否则建房失败。`command` 表示一次动作，用户FIFO最多8条，每tick最多消费2条；队满拒绝且不推进seq；消费时超过client_tick 30tick的命令丢弃。退出、换轮清除队列/持续状态。无自动重试、持久命令账本或跨会话恢复。

players 中 `accepted_input_seq/accepted_input_tick` 表示通过门禁并进入有界队列的最高序号及接收tick，不代表已执行。`applied_input_seq/applied_input_tick` 是已首次消费的最高seq及其tick；只有module.input与该tick的step正常返回后发布。该值不是连续累计ACK：状态合并、命令过期、两种输入先后消费均会产生空洞。仅本人player的 `input_receipts` 保留最近16条精确 `{seq,tick,kind}`，可验证较小命令在较大状态之后消费；窗口外无记录表示缺测，不能推断未执行。重复seq在当前房间轮次至多接受一次，但网络断开、进程失败、模块异常均不具备事务回滚，因此不承诺exactly-once或可靠完成。模块input返回void表示正常消费，不能借false表达拒绝；业务动作无效应先validate或在模块中明确呈现。模块异常会终止该次tick，不发布新的applied receipt；不提供状态回滚。

每个op10都只定向发给一个presence。模块必须实现 `snapshot(state, recipientId)` 和 `projectResults(state, rawResults, recipientId)`，返回新建的显式允许字段投影，私有字段只给对应接收者；权威原始状态/结算不自动广播。核心深复制投影后装饰；数组形状异常、投影抛错或UTF8快照超过65536字节时该接收者不发送快照，无公共原文fallback。启用诊断时只增加固定projection_error计数，不记录异常原文。底座无法猜测模块业务字段的私密性，模块作者负责正确投影并测试。options及成员/房间元数据属于公共字段，禁止放秘密。

服务端诊断默认关闭，仅 `GAME_DIAGNOSTICS=1` 时向本人快照增加固定大小数值diagnostics，含接收/接受/消费/发送次数、UTF8字节、合并/过期次数和tick/本机wall-clock间隔；计数饱和在2147483647，无payload、昵称、用户/session/token或凭据原文，无磁盘历史。发送计数含每接收者op10，接收计数含当前session房间消息；不是Nakama/TCP全链路带宽。发送数据内计数是本次发送前的值。Date.now可能校时，负间隔标为-1，不能当作同步时钟、RTT或单向网络延迟；tick间隔仅反映模拟进度。诊断未进行长期负载验证。

客户端异步请求校验连接 generation 与房间 epoch；注销后旧请求不得推进页面。退出先清本地成员和输入，再等待 leave。加入途中取消会注销并关闭该 socket，避免迟到 join 遗留在线成员。token/密码不持久化，不在 URL/错误正文日志中暴露。服务端所有规则以 `server/src/main.ts` 和 `types.ts` 为准；模块不得改共享的身份与房间门禁。

聊天保持内存有界、无磁盘历史、不写快照、不写聊天正文日志；本模板保留 API/服务端策略，当前 UI 没有聊天面板，尚未对提取后的聊天全流程重新验收。

## 快照字段单位与边界

| 字段                               | 类型、单位与含义                                                                                |
| ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| tick                               | Nakama服务端模拟tick，非负安全整数；30 tick约1模拟秒，不是Unix时间                              |
| round_id                           | 房间轮次，正安全整数，从1递增；输入必须精确等于当前轮次                                         |
| tick_rate / snapshot_rate          | Hz；固定30 / 默认20（启动配置仅10、20、30）                                                     |
| countdown                          | 剩余模拟tick；90表示3模拟秒，非毫秒或秒                                                         |
| host_change.seq                    | 非负安全整数，每次房主移交加1；reason为固定类别，host_id/previous_host_id是公共成员ID           |
| accepted*input*_ / applied*input*_ | seq范围-1至2147483647；-1表示本轮未接受/未消费；对应tick为-1或非负服务端tick                    |
| capacity / min_players             | 整数人数，模块最小人数至8；默认最少2                                                            |
| players                            | 模块snapshot声明的玩家数组，user_id/username为公共身份；核心补ready/connected/staying与回执字段 |
| results                            | 模块results生成并经projectResults过滤的数组；通用UI读取username/score，其余字段定义在各模块合同 |

上述tick、轮次和host变更序号在正常房间寿命下为安全整数；服务端进程不提供跨重启时钟/序号恢复。op1 client_tick/seq另有2147483647上界，不能借输入修改服务端tick或轮次。

测试fixture合同：state.direction={x,y}，每轴有限数值[-1,1]，不做向量归一化，斜向速度可达轴速度的sqrt(2)倍；position={x,y}单位为像素，velocity={x,y}为像素/秒，每轴最大60。step以1/30秒积分，未做碰撞、边界或位置纠正算法。command.pulse=true每次有效消费使score加1；score为非负整数、由服务端计算，false命令无计分。private_note是仅本人可见的测试哨兵；它不是客户端凭据。此fixture仅在测试构建注册。
