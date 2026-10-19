# 按问题查合同与实现

这是导航，不是永久能力清单。以下路径相对于仓库根目录；接口、常量和能力以本次提交的代码为准。先读取相关文件，再引用实际行号/符号。找不到时报告缺失，不猜接口。

| 问题 | 合同与代码入口 | 要核对的边界 |
|---|---|---|
| 当前阶段、接受风险、目标设备 | [PROJECT_STATUS](../../../../docs/PROJECT_STATUS.md)、其链接的最新阶段报告 | 最新授权/风险接受优先于历史建议；保留源码、包及人工证据对应关系 |
| 版本、身份、轮次、容量和生命周期 | [PROTOCOL](../../../../docs/PROTOCOL.md)、`server/src/main.ts` 的 matchInit/matchJoinAttempt/matchLeave/matchLoop、`types.ts` | 加入阶段门禁、房主转移、清理和下一局；重连成功不代表恢复原局 |
| 模拟与快照节奏 | `server/src/types.ts`、`main.ts` 的 configuredSnapshotRate/snapshotAccumulator/broadcast | 配置作用域、房间何时捕获配置、整房发送还是对象调度；不要仅看配置名称 |
| 持续输入与命令 | `client/core/session.gd` 的 _process/submit_input、`server/src/main.ts` 接收与消费路径 | state 合并/失效清零、command 排队/过期、seq+round+session、拒绝/unknown 与业务成功不同 |
| 回执供玩法使用 | `session.gd` 的 submit_input/command_results、客户端调用方及 `tests/fixtures/module.ts` | 是否公开返回提交序号；测试读取私有字段不是稳定模块 API；接受/消费回执不替代业务结果 |
| 私有数据与结算 | `server/src/types.ts` 的 snapshot/projectResults、`main.ts` 的 snapshot/broadcast | 按接收者显式白名单投影，公共 options/metadata 不放秘密，失败不能回退发送原文 |
| 客户端视图与呈现 | `client/core/game_module.gd`、`snapshot_timeline.gd`、`ui/main.gd` | 视图创建/释放、单位与维度、插值/有限外推不是预测重演；是否适合三维姿态 |
| 模块接入、选项和选择 | [ADDING_GAME](../../../../docs/ADDING_GAME.md)、两端 registry、`server/tsconfig.json`、`types.ts` | 生产注册与测试注册分离、选择候选提交语义、配置 UI/结果格式接口是否存在 |
| 平台与资产依赖 | `client/project.godot`、`client/addons/`、[THIRD_PARTY](../../../../docs/THIRD_PARTY.md)、[微信入口](../../../../platform/wechat/README.md) | 引擎/SDK/插件版本、Autoload、原生扩展与目标平台；测试入口装配不等于生产自动装配 |
| 验收与资源隔离 | `scripts/test.mjs`、`scripts/source-audit.mjs`、`scripts/audit.mjs`、[VALIDATION](../../../../docs/VALIDATION.md) | 测试覆盖什么版本；实际 PCK 与源码检查分别证明什么；新增资产需有意识调整允许清单 |

用简短的能力记录即可：`建议 → 已有/模块适配/底座新增 → 本次代码依据 → 尚未验证 → 验收方式`。无需复制整份协议、锁定旧频率值或为每次咨询另写报告。

人数需求要区分“正常建房选择某容量”与“服务端强制该玩法恰好某人数”。查 roomCapacity 的默认值、上下界及模块合同；UI 选定人数和 minimumPlayers 都不能单独证明玩法最大人数约束。

不要默认把空的生产注册表当成“不会有兼容影响”：检查已知外部分支/使用方；查不到就标记未知，不能宣称全部下游安全。普通请求限流、去重和内存环均不等于持久事务。
