extends PanelContainer
## Test-only acceptance panel. Shows whitelisted numbers and fixed enum states built
## from existing Session/GameModule data. Never prints or stores whole snapshots,
## identity IDs, names, tokens, private fields, chat or raw errors; nothing is uploaded.
const PHASES := ["lobby", "countdown", "playing", "results"]
const PRESENTATION_STATES := ["empty", "buffering", "interpolating", "extrapolating", "underrun"]
const COMMAND_STATUSES := ["applied", "expired", "rejected_full", "rejected_stale", "rejected_future", "rejected_not_playing", "rejected_round", "rejected_old_seq", "cancelled_round", "rejected_rate", "rejected_module_error"]
const CLIENT_EVENTS := ["send_attempt", "send_completed", "snapshot_received", "snapshot_consumed"]
const SERVER_COUNTERS := ["received", "accepted", "consumed", "sent", "coalesced", "rate_dropped", "late", "future", "not_playing", "round", "dup", "queue_full", "state_timeout", "command_expired", "module_request_error"]
const MAX_COMMAND_ROWS := 8
const MISSING := "缺测"
var session: Node = null
var view_provider := Callable()
var label: Label
var _elapsed := 0.0

func _ready() -> void:
	name = "DiagnosticsPanel"
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	label = Label.new()
	label.name = "DiagnosticsText"
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	label.add_theme_font_size_override("font_size", 14)
	add_child(label)

func setup(session_node: Node, current_view: Callable) -> void:
	session = session_node
	view_provider = current_view

func _process(delta: float) -> void:
	_elapsed += delta
	if _elapsed < 0.25 or not visible or session == null:
		return
	_elapsed = 0.0
	var view: Variant = view_provider.call() if view_provider.is_valid() else null
	var presentation: Dictionary = view.presentation_diagnostics() if is_instance_valid(view) and view.has_method("presentation_diagnostics") else {}
	label.text = "\n".join(rows(session.snapshot, session.user_id(), session.diagnostic_summary(), presentation, session.command_results()))

## Pure formatter: every value is either a finite number, a fixed label or MISSING.
static func rows(snapshot: Variant, own_id: String, client_summary: Variant, presentation: Variant, commands: Variant) -> PackedStringArray:
	var out: PackedStringArray = []
	var state: Dictionary = snapshot if snapshot is Dictionary else {}
	var phase: Variant = state.get("phase")
	out.append("阶段 %s · 轮次 %s · tick %s" % [phase if phase in PHASES else MISSING, _int(state.get("round_id")), _int(state.get("tick"))])
	var own: Dictionary = {}
	if not own_id.is_empty() and state.get("players") is Array:
		for player in state.players:
			if player is Dictionary and player.get("user_id") == own_id:
				own = player
	out.append("本人位置 %s · 速度 %s · 分数 %s" % [_vector(own.get("position")), _vector(own.get("velocity")), _int(own.get("score"))])
	out.append("最高 accepted %s / applied %s（最高值，非累计确认）" % [_int(own.get("accepted_input_seq")), _int(own.get("applied_input_seq"))])
	var summary: Dictionary = client_summary if client_summary is Dictionary else {}
	if summary.get("enabled") == true:
		for event in CLIENT_EVENTS:
			var item: Dictionary = summary.get(event) if summary.get(event) is Dictionary else {}
			out.append("%s 计数 %s · 均隔 %s ms · 最大 %s ms · 距今 %s ms" % [event, _int(item.get("count")), _ms(item.get("window_interval_mean_ms")), _ms(item.get("window_interval_max_ms")), _ms(item.get("last_age_ms"))])
	else:
		out.append("客户端收发诊断未启用")
	var server: Variant = state.get("diagnostics")
	if server is Dictionary:
		var parts: PackedStringArray = []
		for key in SERVER_COUNTERS:
			if server.has(key):
				parts.append("%s %s" % [key, _int(server.get(key))])
		out.append("服务端本人计数 " + " · ".join(parts))
	var shown: Dictionary = presentation if presentation is Dictionary else {}
	if shown.get("enabled") == true:
		var timeline: Dictionary = shown.get("timeline") if shown.get("timeline") is Dictionary else {}
		var presentation_state: Variant = timeline.get("presentation_state")
		out.append("快照接收年龄 %s ms · 帧间隔 %s ms · 采样 %s us" % [_ms(shown.get("snapshot_receive_age_ms")), _ms(shown.get("frame_callback_interval_ms")), _int(shown.get("sample_cpu_usec"))])
		out.append("呈现 %s · 缓冲 %s 帧 / %s ms · 欠载 %s · 外推 %s · 旧包 %s · 重置 %s" % [presentation_state if presentation_state in PRESENTATION_STATES else MISSING, _int(timeline.get("buffer_samples")), _ms(timeline.get("buffer_depth_ms")), _int(timeline.get("underrun_frames")), _int(timeline.get("extrapolated_frames")), _int(timeline.get("late_snapshot_drops")), _int(timeline.get("timeline_resets"))])
	else:
		out.append("呈现诊断未启用或不在对局中")
	out.append("RTT %s · 服务端消费延迟 %s · GPU %s" % [MISSING, MISSING, MISSING])
	var exact: Array = commands if commands is Array else []
	var listed := 0
	for index in range(exact.size() - 1, -1, -1):
		var result: Variant = exact[index]
		if listed >= MAX_COMMAND_ROWS or not result is Dictionary or result.get("status") not in COMMAND_STATUSES:
			continue
		out.append("命令 seq %s · 第 %s 轮 · %s" % [_int(result.get("seq")), _int(result.get("round_id")), result.status])
		listed += 1
	if listed == 0:
		out.append("命令结果：无记录（未知不等于失败）")
	return out

static func _finite(value: Variant) -> bool:
	return (value is int or value is float) and is_finite(float(value))

static func _int(value: Variant) -> String:
	return str(int(value)) if _finite(value) and absf(float(value)) <= 9007199254740991.0 else MISSING

static func _ms(value: Variant) -> String:
	return "%.1f" % float(value) if _finite(value) else MISSING

static func _vector(value: Variant) -> String:
	if not value is Dictionary or not _finite(value.get("x")) or not _finite(value.get("y")):
		return MISSING
	return "(%.1f, %.1f)" % [float(value.x), float(value.y)]
