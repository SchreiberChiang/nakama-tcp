# 新玩法接入

1. 新建 `server/src/modules/your_game.ts`，实现 `server/src/types.ts` 的 `GameModule`。`version` 是正整数模块合同版本，`inputKinds` 显式声明 `["state", "command"]` 的支持子集；声明state必须实现 `inputExpired(state,id,tick)`，超时清除持续控制。`create/join/leave/start/step` 维护服务端状态；`validateInput` 白名单检查输入，`input` 只接收操作，禁止信任客户端上传的分数、结果或权威位置；`snapshot(state,recipientId)` 必须显式投影可见字段，返回至少含 `players` 数组的对象，每项含 `user_id`、`username`。`projectResults(state,rawResults,recipientId)` 必填，按接收者过滤结算，不能直接返回含隐藏手牌/秘密目标的原始对象。公共元数据/options不能放秘密。`finished/results` 产生权威结算。`duration>0` 是服务端超时兜底；0 表示模块自己结束。
2. `server/tsconfig.json` 的 files 中在 registry 前增加新源文件，并在 `server/src/registry.ts` 注册 `{ your_game: YourGame }`。`id` 必须与注册 key 一致。保持普通构建中没有测试 fixture。
3. 新建 `client/modules/your_game/view.gd`，继承 `GameModule`。`configure` 接受本地用户 ID，`apply_snapshot` 更新展示，事件输入调用 `Session.submit_input`；持续输入时设置 `continuous_input=true` 并实现 `collect_input()`。`release()` 停止本模块拥有的任务，不能关闭共享 Session。禁止模块绕过 Session 创建另一套 Nakama socket。
4. 显式填写客户端注册表。例如把 `module_registry.gd` 的空字典替换为：

```gdscript
static var modules: Dictionary = {
    "your_game": {
        "factory": func(): return preload("res://modules/your_game/view.gd").new(),
        "metadata": {"module_version": 1, "join_metadata": {"your_capability": "1"}}
    }
}
```

目录由服务端返回；大厅仅显示服务端存在且本地已安装的模块。不匹配时显示空状态，不加载其他模块。通用层首先核对protocol_version与模块version，旧版或缺版本的协议消息被拒绝。客户端注册项应提供正整数 `metadata.module_version`；当前客户端未填写时默认1，加入时仍会发送该版本。模块作者可读取目录的 `input_kinds` 声明决定使用哪些输入模式；当前 `Session.submit_input` 只检查kind是否为state/command，不按目录自动过滤，服务器会强制拒绝模块未声明支持的kind。可选 `joinRejection` 继续校验模块自有兼容参数。

5. 房间选项由服务端 `normalizeOptions` 解释，不识别的字段应拒绝；`minimumPlayers` 默认为2，容量最大8。当前通用 UI 发送空选项、容量2–8。玩法需要选项/单人/选择操作时，在普通 2D 控件里通过独立模块配置入口扩展，不在公共 Main 中按游戏 ID 分支。协议已保留 op5 和 `validateSelection/select` 扩展，但底座没有选车/选图 UI。
6. 共享 UI 收到 playing 才创建视图。countdown、results、退出、掉线不保留玩法实例。返回按钮应发 `exit_requested`；结果页“再来一局”沿用现有房间，只有房主能切下一轮，其他玩家只是表达留房。
7. 用两个真实客户端回归：登录、建房、加入、准备、开始、输入、结算、再来一局、房主离开、断线、注销、重复点击与旧异步返回。再运行实际 PCK 清单审计，给新模块制定明确的允许资源清单。当前 `audit.mjs` 默认禁止所有游戏/美术资源，接入新游戏后必须有意识地更新审计规则，不能直接关闭整个审计。

`tests/fixtures/module.ts` 和 `client/tests/fixture_view.gd` 是接口示例与生命周期测试用具，包含无美术的二维方块方向持续移动、点击服务端计数和接收者私有哨兵。它们不是交付游戏；不得将 fixture 默认注册或改成生产编译输入。运行 `node scripts/build.mjs --fixture` 只生成 `.local/test-runtime/`，不会改生产注册表或 `server/build/`。

结果当前按 `username/score` 作通用文字展示；需要不同结算字段时，可增加模块自有 formatter 接口，共享层只负责进入结果页、留房和下一轮，不能在 UI 写玩法业务规则。

输入沿用Session唯一边界：事件调用 `submit_input`（command），持续provider发送state；客户端补充seq/round_id/kind/client_tick，不上传权威位置。fixture state仅有direction{x,y}，command仅有pulse:boolean。模块validateInput必须白名单包含共同信封字段，不能接受客户端score/position注入。input只在第一次消费新输入时调用，step每模拟tick执行；持续方向由模块保存，不能依赖每tick重复input。具体合并、8条队列、每tick2命令、默认15tick neutral、默认30tick过期及有界配置见PROTOCOL。预算包含快照陈旧及上行排队，不能当作RTT测量。matchLoop内input/step/inputExpired/start/finished/results异常会固定op11 Module failure、踢全部并终止整房；无事务回滚，异常前状态可能已改动，不能承诺exactly-once。外部join/leave/create回调须自行保证不抛错。command/state共享seq，不提供原seq自动重试；精确命令终态使用本人独立32条command_results环（含round），正常结束未消费队列为cancelled_round，详情及有界unknown边界见PROTOCOL。

底座深复制模块投影后装饰核心字段，避免复用对象将本人receipt串入对方快照；每条op10定向一个presence，UTF8序列化上限65536字节，投影异常/非法players或results数组/超大小均停止该接收者发送，并发送固定限频op11 Projection failure；连续3次失败移出该成员，成功清零连续计数，诊断启用时增加固定错误计数。深复制和大小检查发生在模块投影之后，不能约束模块自身的内存分配/运算；复杂模块仍须自行限制结果大小和执行成本。投影测试至少使用两个不同私有哨兵，检查真实dispatcher载荷在快照及结算均不含对方哨兵。

纯服务端合同验证：先 `node scripts/build.mjs --fixture`，再 `node tests/server-protocol.mjs`；不启动服务。它不能替代双真实客户端、设备/WAN和导出验证。
