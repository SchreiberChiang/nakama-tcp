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
var scroll: ScrollContainer
var close_button: Button
var tabs: Array[Button] = []
const PAGES := ["概览", "收发", "服务端", "命令"]
const EVENT_NAMES := {"send_attempt": "发送尝试", "send_completed": "发送完成", "snapshot_received": "收到快照", "snapshot_consumed": "消费快照"}
const COUNTER_NAMES := {"received": "收到", "accepted": "接受", "consumed": "消费", "sent": "发送", "coalesced": "合并", "rate_dropped": "限流丢弃", "late": "过旧", "future": "超前", "not_playing": "非对局阶段", "round": "轮次不符", "dup": "重复", "queue_full": "队列已满", "state_timeout": "持续输入超时", "command_expired": "命令过期", "module_request_error": "模块请求错误"}
var selected_page := "概览"
var _page_texts: Dictionary = {}
var text_updates := 0
var _elapsed := 0.0

func _ready() -> void:
	name = "DiagnosticsPanel"
	mouse_filter = Control.MOUSE_FILTER_STOP
	var body := VBoxContainer.new()
	body.add_theme_constant_override("separation", 10)
	add_child(body)
	var header := HBoxContainer.new()
	body.add_child(header)
	var title := Label.new()
	title.text = "诊断"
	title.add_theme_font_size_override("font_size", 24)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	header.add_child(title)
	close_button = Button.new()
	close_button.name = "CloseDiagnostics"
	close_button.text = "关闭"
	close_button.custom_minimum_size = Vector2(96, 48)
	close_button.add_theme_font_size_override("font_size", 22)
	close_button.pressed.connect(hide)
	header.add_child(close_button)
	var note := Label.new()
	note.text = "只读，不暂停游戏 · 缺测≠0"
	note.add_theme_font_size_override("font_size", 22)
	note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	body.add_child(note)
	var navigation := HBoxContainer.new()
	navigation.add_theme_constant_override("separation", 8)
	body.add_child(navigation)
	for page in PAGES:
		var button := Button.new()
		button.text = page
		button.toggle_mode = true
		button.custom_minimum_size.y = 48
		button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		button.add_theme_font_size_override("font_size", 22)
		button.pressed.connect(func(): select_page(page))
		navigation.add_child(button)
		tabs.append(button)
	scroll = ScrollContainer.new()
	scroll.name = "DiagnosticScroll"
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.add_child(scroll)
	label = Label.new()
	label.name = "DiagnosticsText"
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	label.add_theme_font_size_override("font_size", 22)
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(label)
	set_observations({}, "", {}, {}, [])

func setup(session_node: Node, current_view: Callable) -> void:
	session = session_node
	view_provider = current_view

func _process(delta: float) -> void:
	if not is_visible_in_tree() or session == null:
		return
	_elapsed += delta
	if _elapsed < 0.25:
		return
	_elapsed = 0.0
	var view: Variant = view_provider.call() if view_provider.is_valid() else null
	var presentation: Dictionary = view.presentation_diagnostics() if is_instance_valid(view) and view.has_method("presentation_diagnostics") else {}
	set_observations(session.snapshot, session.user_id(), session.diagnostic_summary(), presentation, session.command_results())

## Keep only the existing whitelisted formatter's text. Never retain source state.
func set_observations(snapshot: Variant, own_id: String, client_summary: Variant, presentation: Variant, commands: Variant) -> void:
	_page_texts = page_rows(rows(snapshot, own_id, client_summary, presentation, commands))
	select_page(selected_page)

func select_page(page: String) -> void:
	if page not in PAGES:
		return
	selected_page = page
	for index in range(tabs.size()):
		tabs[index].set_pressed_no_signal(PAGES[index] == page)
	var next := str(_page_texts.get(page, "缺测"))
	if label.text != next:
		label.text = next
		text_updates += 1

## Fixed grouping and Chinese labels only after the privacy whitelist has run.
static func page_rows(safe_rows: PackedStringArray) -> Dictionary:
	var grouped := {"概览": PackedStringArray(), "收发": PackedStringArray(), "服务端": PackedStringArray(), "命令": PackedStringArray(["最多显示最近8条命令；未知不等于失败。"])}
	for line in safe_rows:
		var page := "概览"
		line = line.replace("本人位置 ", "本人位置（坐标单位） ").replace(" · 速度 ", " · 速度（坐标单位/秒） ")
		line = line.replace("最高 accepted ", "最高接受序号 accepted ").replace(" / applied ", "\n最高消费序号 applied ")
		for event in CLIENT_EVENTS:
			if line.begins_with(event + " "):
				page = "收发"
				line = line.replace(event, EVENT_NAMES[event])
		if line.begins_with("客户端收发诊断"):
			page = "收发"
		if line.begins_with("服务端本人计数 "):
			for item in line.trim_prefix("服务端本人计数 ").split(" · "):
				var pieces := item.split(" ", true, 1)
				if pieces.size() == 2 and COUNTER_NAMES.has(pieces[0]):
					grouped["服务端"].append("%s（%s）：%s" % [COUNTER_NAMES[pieces[0]], pieces[0], pieces[1]])
			continue
		if line.begins_with("命令 ") or line.begins_with("命令结果"):
			page = "命令"
		grouped[page].append(line.replace(" · ", "\n"))
	if grouped["服务端"].is_empty():
		grouped["服务端"].append("服务端诊断缺测或未启用；缺测不等于0。")
	var result := {}
	for page in PAGES:
		result[page] = "\n\n".join(grouped[page])
	return result

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
			out.append("%s 计数 %s · 窗口字节 %s · 均隔 %s ms · 最大 %s ms · 距今 %s ms" % [event, _int(item.get("count")), _int(item.get("window_bytes")), _ms(item.get("window_interval_mean_ms")), _ms(item.get("window_interval_max_ms")), _ms(item.get("last_age_ms"))])
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
