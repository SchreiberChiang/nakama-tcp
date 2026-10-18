# 可选移动快照呈现

返回姿态的每个分支均与历史字典隔离，包括只出现在后一帧的新玩家。重缓冲若保持的来源时间已超过最新权威样本，仍以同一时间差重建受限外推姿态，不能仅因重锚退回该样本的位置。此保证限权威数据和配置未变化；新权威可纠正先前外推的误差，不保证坐标单调或任意网络条件下连续平滑。修复与复现见 [TIMELINE_REVIEW](TIMELINE_REVIEW.md)。

`core/snapshot_timeline.gd` 是纯展示工具，默认不创建；普通登录/大厅/房间/结算仍为 2D UI。UI在configure后用`set_presentation_scope`注入当前Session的scope；模块显式调用 `enable_timeline(delay_ms, extrapolation_ms)`，在 `apply_snapshot` 中提交，再在自己的 `_process(delta)` 调用 `sample_presentation(delta)`。模块输入只通过 Session，时间轴不预测输入、不重演、不做碰撞或规则结算。

快照沿用房间 tick/tick_rate/snapshot_rate/round_id/phase，最多消费8名玩家的 `user_id`、`position:{x,y}`、可选 `velocity:{x,y}`、可选弧度 `angle` 与 `stationary`。单位由模块定义，可先映射自己领域的快照到此合同。非有限位置被排除；非playing或stationary不外推。生成的字典不能用于上传权威位置。返回姿态与内部历史隔离，可由视图修改。

默认fixture延迟117ms、外推33ms；通用工具可配延迟0–500ms，外推上限始终为一个模拟tick（默认为关闭）。32条历史、64条到达偏移；时钟锚点只取本地到达与来源tick的观察偏移，不是同步服务器时间或单向网络延迟。插值按tick时间而非包序号。重复/旧tick、旧轮次、同轮倒退阶段被丢弃；房间scope、round、phase或频率切换重置。scope包含Session连接generation和房间epoch；调用者必须只把当前Session验证后的快照传给当前模块，不可重新标记旧包的scope。

缺包只有限外推后冻结；来源/到达间隔超过500ms清历史重缓冲并记录discontinuity。持续饥饿默认350ms后，如最新真实到达的观察偏移比旧锚点高超过一个模拟tick，则清除旧低偏移并用这条真实到达重锚；`configure_recovery(underrun_ms)`可设100–1000ms。重锚显式计入clock_reanchors与discontinuity，短暂停在已呈现源时间直到新delay缓冲积累，不回退已呈现时间。新包短暂产生一帧插值不清除饥饿计时；只有最新到达偏移回落至旧锚点附近才清除。没有新来源数据时不会锚定到未来；TCP批释放可能暂时高估到达偏移，之后仍通过有界恢复修正。代价是可见短冻结/重新缓冲，不承诺所有网络模式平滑。播放时钟普通漂移最多2%调整；已可用的欠账以最多1.2倍恢复，750ms仍未追上则显式修正并计数。长帧/历史淘汰也记录修正；不把断档伪装成平滑预测。`release()`清空模块时间轴、样本和快照副本，不清空共享Session快照。

输入协议version2：Session.submit_input(payload)默认command，一次性按钮操作；continuous_input/collect_input每30Hz以state发送完整持续状态（释放方向必须发零）。Session复制输入再加seq、round_id、kind、client_tick。持续state默认在最近合法快照本地年龄超过350ms时暂停，`configure_state_freshness`可设100–1000ms；恢复合法快照后自动按当前完整输入发送。单帧至多发送一次，保留不足一周期的余数，长帧丢弃漏掉的发送周期，不补发积压。这只能减少应用新写入，不能清除所有TCP/SDK已有排队；低FPS、后台标签页或暂停会触发服务端15tick持续输入neutral，恢复前允许方向暂时归零。SDK发送完成只代表本地发送调用成功。accepted_input_seq/tick代表服务端门禁接受；applied_input_seq/tick是最高首次消费seq及对应服务器tick，存在合并、过期、跨队列空洞，绝不是累计ACK。仅本人最近16条input_receipts提供精确消费{seq,tick,kind}；不在窗口内是缺测，不代表未执行；本人独立32条command_results环另给出applied/expired/cancelled_round/rejected_full/rejected_stale/rejected_future/rejected_not_playing/rejected_round/rejected_old_seq/rejected_rate，每项含seq/round_id/tick/status；Session.command_results()读取副本，command_results_updated(Array)在快照消费末尾通知，诊断关闭仍可用。窗口外/断线后缺失仍是未知；无command_id、自动重发或exactly-once承诺。固定op11 Module failure/Projection failure会清理房间、输入、结果环，立即退出playing；room_failed只发固定module_failure/projection_failure类别。leave_room立即完成本地清理：先向捕获的旧socket启动离房请求再发left，服务端应答由独立异步流程处理；await leave_room不代表服务端离房确认。旧应答不会刷新新连接、房间或进行中的加入流程。

`--diagnostics=true`显式启用Session内存诊断；默认关闭。每类最多120条样本，记录发送尝试/SDK完成、收到快照/验证后交给模块的计数、JSON UTF-8载荷字节（不含TLS/WebSocket封装；send_completed和snapshot_consumed分别复用同一载荷的可测字节，表示完成或逻辑消费，不能与attempt/received相加作为额外传输量）、最后/窗口平均/最大间隔、收到后本地年龄，以及本人的数值ACK/精确receipt。snapshot_consumed仅指客户端校验并消费快照，不冒充服务器处理输入。模块单独设置diagnostics_enabled，观测_process传入delta的帧回调间隔及时间轴采样函数自身CPU微秒，二者不同，也不是完整帧CPU/GPU耗时。时间轴summary提供缓冲深度/帧数、外推、冻结、旧包和修正计数。RTT、服务端消费延迟、GPU耗时缺少可用测量，返回null并说明原因；不跨时钟相减，不把receive_age称ping。

诊断只保留有限数字、固定事件/状态，不含用户名、身份、token、凭据、聊天、输入或完整原始快照，不写磁盘、不上传；禁用与离房/注销/断线清空。精确receipt仅含seq/tick/kind。命令结果诊断仅含seq/round_id/tick与status_code数值，status_code固定映射为：0=applied、1=expired、2=rejected_full、3=rejected_stale、4=rejected_future、5=rejected_not_playing、6=rejected_round、7=rejected_old_seq、8=cancelled_round、9=rejected_rate，与Session.COMMAND_STATUSES一致。fixture_view只属于测试注册和导出排除目录：两个小方块、方向输入和服务器计数，无车辆、镜头或地图。

提取评估依据：只读检查[外部仓库固定commit 2395b6b的时间轴](https://github.com/SchreiberChiang/nakama-tcp-racing/blob/2395b6b/client/games/racing/motion_timeline.gd) 及相关单测。保留其MIT通用历史/到达时钟/有界恢复算法，剥离车辆结束、路面高度、法线、悬挂及所有3D呈现依赖。未修改外部项目。许可沿仓库LICENSE/THIRD_PARTY保留。

独立验证：导入后运行 `Godot --headless --path client --script res://tests/snapshot_timeline.gd`。集成、GUI、PCK和平台证据另由VALIDATION记录，单测不代表公网、Web、微信或手机。

本轮确定性到达注入单测包含10/20Hz持续+250ms偏移10秒，以及先中断700ms再保持该偏移；underrun总时长门禁小于1.5秒，变更后2.2秒起的实际latest-source减render-source余量不低于delay减最大源快照间隔再减18ms采样误差。buffer_depth_ms是历史总跨度，不用作可播放余量。Session实际leave epoch和logout generation重置、信号回调leave/logout隔离、默认诊断关闭均另有单测；不代表网络/设备验证。
