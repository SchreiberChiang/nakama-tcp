# 新玩法接入

1. 新建 `server/src/modules/your_game.ts`，实现 `server/src/types.ts` 的 `GameModule`。`create/join/leave/start/step` 维护服务端状态；`validateInput` 白名单检查输入，`input` 只接收操作，禁止信任客户端上传的分数、结果或权威位置；`snapshot` 返回至少含 `players` 数组的对象，每项含 `user_id`、`username`。`finished/results` 产生权威结算。`duration>0` 是服务端超时兜底；0 表示模块自己结束。
2. `server/tsconfig.json` 的 files 中在 registry 前增加新源文件，并在 `server/src/registry.ts` 注册 `{ your_game: YourGame }`。`id` 必须与注册 key 一致。保持普通构建中没有测试 fixture。
3. 新建 `client/modules/your_game/view.gd`，继承 `GameModule`。`configure` 接受本地用户 ID，`apply_snapshot` 更新展示，事件输入调用 `Session.submit_input`；持续输入时设置 `continuous_input=true` 并实现 `collect_input()`。`release()` 停止本模块拥有的任务，不能关闭共享 Session。禁止模块绕过 Session 创建另一套 Nakama socket。
4. 显式填写客户端注册表。例如把 `module_registry.gd` 的空字典替换为：

```gdscript
static var modules: Dictionary = {
    "your_game": {
        "factory": func(): return preload("res://modules/your_game/view.gd").new(),
        "metadata": {"join_metadata": {"your_capability": "1"}}
    }
}
```

目录由服务端返回；大厅仅显示服务端存在且本地已安装的模块。不匹配时显示空状态，不加载其他模块。可选 `joinRejection` 校验模块自有兼容参数，通用层不硬编码地图 hash 或版本。

5. 房间选项由服务端 `normalizeOptions` 解释，不识别的字段应拒绝；`minimumPlayers` 默认为2，容量最大8。当前通用 UI 发送空选项、容量2–8。玩法需要选项/单人/选择操作时，在普通 2D 控件里通过独立模块配置入口扩展，不在公共 Main 中按游戏 ID 分支。协议已保留 op5 和 `validateSelection/select` 扩展，但底座没有选车/选图 UI。
6. 共享 UI 收到 playing 才创建视图。countdown、results、退出、掉线不保留玩法实例。返回按钮应发 `exit_requested`；结果页“再来一局”沿用现有房间，只有房主能切下一轮，其他玩家只是表达留房。
7. 用两个真实客户端回归：登录、建房、加入、准备、开始、输入、结算、再来一局、房主离开、断线、注销、重复点击与旧异步返回。再运行实际 PCK 清单审计，给新模块制定明确的允许资源清单。当前 `audit.mjs` 默认禁止所有游戏/美术资源，接入新游戏后必须有意识地更新审计规则，不能直接关闭整个审计。

`tests/fixtures/module.ts` 和 `client/tests/fixture_view.gd` 是接口示例与生命周期测试用具，只有文字与计数。它们不是交付游戏；不得将 fixture 默认注册或改成生产编译输入。运行 `node scripts/build.mjs --fixture` 只生成 `.local/test-runtime/`，不会改生产注册表或 `server/build/`。

结果当前按 `username/score` 作通用文字展示；需要不同结算字段时，可增加模块自有 formatter 接口，共享层只负责进入结果页、留房和下一轮，不能在 UI 写玩法业务规则。
