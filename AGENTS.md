# Template maintenance

- 先读 README、docs/ADDING_GAME.md、docs/PROTOCOL.md、docs/VALIDATION.md；验证记录不替代当前检查。
- 默认不安装玩法。测试模块只在独立测试注册表/构建中启用；不得默认注册、预加载或进入玩家导出。
- 客户端仅通过 Session 调用 SDK；保留请求清理、日志脱敏、连接/房间代际检查。密码、token、聊天正文不进入日志或磁盘历史。
- 服务端决定身份、成员、轮次、输入接受、分数和赢家。保留 seq/round_id/sessionId、schema、容量和限流校验。
- 共享登录/大厅/房间/结果页保持普通 2D UI，不创建后台玩法、Node3D 或 SubViewport。
- 本地只启动自有 loopback 服务，端口冲突立即停止；不停止别人的进程、不删锁、不部署云服。
- 修改后运行适用构建、SDK 测试、双客户端测试和实际 PCK 审计。桌面、Web、微信、手机证据分开记录，未测写明。
- 不提交 .local、数据库、profiles、logs、密钥、私有配置或构建产物。保留第三方许可。
