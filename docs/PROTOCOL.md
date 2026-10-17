# 复用的房间协议

没有另起一套联机消息格式。认证仍走官方 Nakama 设备/邮箱认证与会话 WebSocket；账号 session 与房间 presence session 不可混淆。

| 接口 | 内容 |
|---|---|
| RPC `game_catalog` | 空载荷；games、room_flow_version=1、room_phase_version=2、容量和聊天能力 |
| RPC `room_list` | `{}` 或 `{game_id}`，返回 match_id/label/size |
| RPC `room_create` | `{game_id,name,options?,capacity?}`；模块必须已注册；名字1–32字符，容量在模块最小人数到8之间 |
| join match metadata | `display_name`、`room_phase_version:"2"` 与模块的可选能力声明 |
| op1 | 输入 `{seq,round_id,...moduleInput}`，模块白名单校验；每用户最多60/s，playing 才应用 |
| op2 | 准备 `{ready,round_id?}`，lobby且本轮才生效 |
| op3 | 开始 `{}`，房主、最小人数、全部准备后服务端倒计时3秒 |
| op4 | 留房/下一局 `{round_id?}`，仅 results；房主切回 lobby 并递增 round_id，访客仅 staying=true |
| op5 | 可选模块选择 `{round_id,selection}`，模块校验和解释，无默认业务 |
| op6/12/13 | 房间聊天发送/消息/错误；只在 lobby/results，独立白名单与限流 |
| op10/11 | 服务端快照/固定类别操作错误 |

模拟30Hz、默认快照20Hz（可显式选10/30）。快照包含 tick、tick_rate、snapshot_rate、phase、game_id、options、host_id、capacity、min_players、host_change、countdown、round_id、results、players。核心为模块 players 补齐 connected、ready、staying、accepted_input_seq 并保持加入顺序。

每条输入必须属于当前用户、当前 presence session、当前 round_id，seq 单调递增；过期轮次/重复序号不应用。普通控制限6/s、载荷256字节，畸形/越权有 strike 与踢出阈值；聊天独立限额。创建房间按账号服务端时间限3秒，存储 CAS 防并发绕过。人数包含短期待加入席位；重复账号、满房和非 lobby 拒绝加入。房主离开或失联由服务端按加入顺序移交。全空房约10秒回收。

客户端异步请求校验连接 generation 与房间 epoch；注销后旧请求不得推进页面。退出先清本地成员和输入，再等待 leave。加入途中取消会注销并关闭该 socket，避免迟到 join 遗留在线成员。token/密码不持久化，不在 URL/错误正文日志中暴露。服务端所有规则以 `server/src/main.ts` 和 `types.ts` 为准；模块不得改共享的身份与房间门禁。

聊天保持内存有界、无磁盘历史、不写快照、不写聊天正文日志；本模板保留 API/服务端策略，当前 UI 没有聊天面板，尚未对提取后的聊天全流程重新验收。
