extends SceneTree
## Pure formatting only: no UI scene, backend, clock or network collection.
const PANEL := preload("res://tests/cross_platform/diagnostics_panel.gd")
var passed := 0
var failed := 0

func check(condition: bool, message: String) -> void:
	if condition:
		passed += 1
	else:
		failed += 1
		printerr("FAIL: " + message)

func pages(state: Variant = {}, summary: Variant = {}, shown: Variant = {}, commands: Variant = []) -> Dictionary:
	return PANEL.page_rows(PANEL.rows(state, "OWN_PRIVATE", summary, shown, commands))

func _initialize() -> void:
	var phase_expectations := {"lobby": "在房间中，等待准备", "countdown": "即将开始对局", "playing": "正在对局", "results": "已进入结算"}
	for phase in phase_expectations:
		var overview: String = pages({"phase": phase})["概览"]
		check(overview.contains(phase_expectations[phase]), "phase explained: " + phase)
		check(not overview.contains("当前：" + phase), "raw phase stays outside overview")
	var missing := pages()
	check(missing["概览"].contains("当前：缺测") and missing["概览"].contains("距今 缺测"), "unobserved phase and age stay missing")
	for age in [null, INF, NAN, -1, "PRIVATE_AGE"]:
		var text: String = pages({}, {"enabled": true, "snapshot_received": {"last_age_ms": age}})["概览"]
		check(text.contains("距今 缺测") and not text.contains("PRIVATE"), "invalid local age stays missing")
	var enabled := {"enabled": true, "snapshot_received": {"last_age_ms": 234.5}}
	check(pages({}, enabled)["概览"].contains("距今 234.5 毫秒（ms）（本机观测"), "existing local receive age is explained with units")
	check(pages({}, {"enabled": false, "snapshot_received": {"last_age_ms": 0}})["概览"].contains("距今 缺测"), "disabled observations cannot imply a recent message")
	var mode_expectations := {"empty": "还没有可用于显示", "buffering": "积攒后续数据", "interpolating": "前后两份数据平滑显示", "extrapolating": "不是服务器确认的位置", "underrun": "后续数据不足，画面暂时保持"}
	for mode in mode_expectations:
		var shown := {"enabled": true, "timeline": {"presentation_state": mode}}
		check(pages({}, {}, shown)["概览"].contains(mode_expectations[mode]), "buffer state explained: " + mode)
	check(pages({}, {}, {"enabled": true, "timeline": {"presentation_state": "PRIVATE_MODE"}})["概览"].contains("画面缓冲：缺测"), "unknown presentation is missing")
	var state := {"phase": "playing", "round_id": 2, "tick": 345, "token": "PRIVATE_TOKEN", "diagnostics": {}, "players": [{"user_id": "OWN_PRIVATE", "username": "PRIVATE_NAME", "position": {"x": 12.5, "y": -4.0}, "velocity": {"x": 60, "y": 0}, "score": 3, "accepted_input_seq": 41, "applied_input_seq": 40}]}
	for key in PANEL.SERVER_COUNTERS:
		state.diagnostics[key] = 123
	var shown := {"enabled": true, "snapshot_receive_age_ms": 22, "frame_callback_interval_ms": 16.6, "sample_cpu_usec": 23, "timeline": {"presentation_state": "interpolating", "buffer_samples": 4, "buffer_depth_ms": 66, "underrun_frames": 5, "extrapolated_frames": 6, "late_snapshot_drops": 7, "timeline_resets": 8}}
	var commands := [{"seq": 7, "round_id": 2, "status": "applied"}, {"seq": 8, "status": "PRIVATE_STATUS"}]
	var detailed := pages(state, enabled, shown, commands)
	var overview: String = detailed["概览"]
	check(not overview.contains("tick") and not overview.contains("accepted") and not overview.contains("12.5") and not overview.contains("16.6"), "raw position, sequence and frame metrics live on detail pages")
	var traffic: String = detailed["收发"]
	check(traffic.contains("轮次 2") and traffic.contains("tick 345") and traffic.contains("(12.5, -4.0)") and traffic.contains("(60.0, 0.0)") and traffic.contains("分数 3"), "own state retained in detail")
	check(traffic.contains("22.0 ms") and traffic.contains("16.6 ms") and traffic.contains("23 us") and traffic.contains("4 帧 / 66.0 ms") and traffic.contains("帧数 5") and traffic.contains("帧数 6") and traffic.contains("旧快照数 7") and traffic.contains("重置次数 8"), "all former overview presentation metrics retained with units")
	check(traffic.contains("RTT 缺测（ms）") and traffic.contains("服务端消费延迟 缺测（ms）") and traffic.contains("GPU 缺测（ms）") and traffic.contains("不是往返延迟"), "no inferred RTT or clock subtraction")
	for key in PANEL.SERVER_COUNTERS:
		check(detailed["服务端"].contains("（%s）：123" % key), "server counter retained: " + key)
	check(detailed["命令"].contains("accepted 41") and detailed["命令"].contains("applied 40") and detailed["命令"].contains("非累计确认") and detailed["命令"].contains("命令 seq 7") and detailed["命令"].contains("已执行：服务器已消费这条命令"), "highest sequences and exact command outcomes remain distinct")
	check(detailed["命令"].contains("仍可能等待") and detailed["命令"].contains("未知不等于失败"), "acceptance and unknown boundaries are visible")
	var joined := "\n".join(detailed.values())
	check(not joined.contains("PRIVATE") and not joined.contains("seq 8"), "plain and detailed pages preserve privacy whitelist")
	var outcome_expectations := {"expired": "未在期限内执行", "cancelled_round": "本轮结束时尚未执行", "rejected_full": "命令队列已满", "rejected_stale": "输入过旧", "rejected_future": "输入超前", "rejected_not_playing": "当前不在对局中", "rejected_round": "轮次不符", "rejected_old_seq": "序号已旧或重复", "rejected_rate": "发送过于频繁", "rejected_module_error": "玩法处理请求时发生错误"}
	for status in outcome_expectations:
		check(pages({}, {}, {}, [{"status": status, "seq": 1, "round_id": 1}])["命令"].contains(outcome_expectations[status]), "exact status explained: " + status)
	var many: Array = []
	for index in range(20):
		many.append({"seq": index, "round_id": 1, "status": "applied"})
	check(pages({}, {}, {}, many)["命令"].count("命令 seq ") == 8, "command output remains bounded to eight")
	check(PANEL.PAGES == ["概览", "收发", "服务端", "命令"], "fixed four pages remain")
	print("DIAGNOSTIC_PLAIN_LANGUAGE: %d passed, %d failed" % [passed, failed])
	quit(1 if failed else 0)
