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
var geometry_note: Label
var tabs: Array[Button] = []
const PAGES := ["概览", "收发", "服务端", "命令"]
const EVENT_NAMES := {"send_attempt": "发送尝试", "send_completed": "发送完成", "snapshot_received": "收到快照", "snapshot_consumed": "消费快照"}
const COUNTER_NAMES := {"received": "收到", "accepted": "接受", "consumed": "消费", "sent": "发送", "coalesced": "合并", "rate_dropped": "限流丢弃", "late": "过旧", "future": "超前", "not_playing": "非对局阶段", "round": "轮次不符", "dup": "重复", "queue_full": "队列已满", "state_timeout": "持续输入超时", "command_expired": "命令过期", "module_request_error": "模块请求错误"}
const PHASE_NAMES := {"lobby": "在房间中，等待准备和开始", "countdown": "在房间中，即将开始对局", "playing": "正在对局", "results": "已进入结算"}
const BUFFER_NAMES := {
	"empty": "还没有可用于显示的服务器画面数据。",
	"buffering": "正在积攒后续数据，暂显示已有的最早画面。",
	"interpolating": "用已收到的前后两份数据平滑显示画面。",
	"extrapolating": "后续数据尚未到达，暂按已有运动趋势显示；这不是服务器确认的位置。",
	"underrun": "可用的后续数据不足，画面暂时保持；等待新数据。"
}
const COMMAND_NAMES := {
	"applied": "已执行：服务器已消费这条命令", "expired": "已过期：排队后未在期限内执行",
	"rejected_full": "被拒绝：命令队列已满", "rejected_stale": "被拒绝：输入过旧",
	"rejected_future": "被拒绝：输入超前", "rejected_not_playing": "被拒绝：当前不在对局中",
	"rejected_round": "被拒绝：轮次不符", "rejected_old_seq": "被拒绝：序号已旧或重复",
	"cancelled_round": "已取消：本轮结束时尚未执行", "rejected_rate": "被拒绝：发送过于频繁",
	"rejected_module_error": "被拒绝：玩法处理请求时发生错误"
}
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
	geometry_note = note
	note.text = "只读，不暂停游戏 · 缺测≠0"
	note.add_theme_font_size_override("font_size", 22)

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
	scroll.custom_minimum_size.y = 44
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

func set_geometry_status(status: String) -> void:
	geometry_note.text = "只读，不暂停游戏 · 缺测≠0" + ("\n安全区：保守交集" if status == "conservative" else "")

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
	var grouped := {
		"概览": PackedStringArray(["这里只说明观察到的情况，不据此判断网络好坏。详细数字见其他页。"]),
		"收发": PackedStringArray(["本页是本机观察。发送完成不代表服务器已接受；收到快照是收到服务器的一份房间状态，消费快照是交给画面使用。", "计数为诊断启用或重置后的事件次数；窗口字节为最近最多120次事件的字节合计。均隔/最大为窗口内事件间隔；距今为本机距离上次事件的时间。ms=毫秒，us=微秒。"]),
		"服务端": PackedStringArray(["服务器报告的本人计数，单位为次。接受表示进入处理流程，消费表示交给玩法执行；合并表示持续输入被较新的输入替换。缺测不等于0。"]),
		"命令": PackedStringArray(["最多显示最近8条命令；未知不等于失败。", "接受：服务器已收下输入，仍可能等待或被后续处理取消。已执行：服务器已消费命令，具体结果由玩法决定。", "最高接受/消费序号同时包含持续输入和命令，仅是观察到的最高值，非累计确认；不能据此认定每条命令都已执行。"])
	}
	var server_seen := false
	for line in safe_rows:
		var page := "概览"
		if line.begins_with("阶段 ") or line.begins_with("本人位置 ") or line.begins_with("快照接收年龄 ") or line.begins_with("呈现 ") or line.begins_with("呈现诊断") or line.begins_with("RTT "):
			page = "收发"
		if line.begins_with("最高 accepted "):
			page = "命令"
		line = line.replace("本人位置 ", "本人位置（坐标单位） ").replace(" · 速度 ", " · 速度（坐标单位/秒） ")
		line = line.replace("最高 accepted ", "最高接受序号 accepted ").replace(" / applied ", "\n最高消费序号 applied ")
		line = line.replace("阶段 ", "服务器阶段 ").replace(" · tick ", " · 服务器模拟步 tick ")
		line = line.replace("快照接收年龄 ", "画面最近收到快照距今 ").replace(" · 帧间隔 ", " · 本机画面回调间隔 ").replace(" · 采样 ", " · 本机采样耗时 ")
		line = line.replace("呈现 ", "画面显示方式 ").replace(" · 欠载 ", " · 数据不足的画面帧数 ").replace(" · 外推 ", " · 按趋势显示的画面帧数 ").replace(" · 旧包 ", " · 丢弃的旧快照数 ").replace(" · 重置 ", " · 显示时间轴重置次数 ")
		if line.begins_with("RTT "):
			line = line.replace("RTT 缺测", "RTT 缺测（ms）").replace("服务端消费延迟 缺测", "服务端消费延迟 缺测（ms）").replace("GPU 缺测", "GPU 缺测（ms）")
		for event in CLIENT_EVENTS:
			if line.begins_with(event + " "):
				page = "收发"
				line = line.replace(event, EVENT_NAMES[event])
		if line.begins_with("客户端收发诊断"):
			page = "收发"
		if line.begins_with("服务端本人计数 "):
			server_seen = true
			for item in line.trim_prefix("服务端本人计数 ").split(" · "):
				var pieces := item.split(" ", true, 1)
				if pieces.size() == 2 and COUNTER_NAMES.has(pieces[0]):
					grouped["服务端"].append("%s（%s）：%s" % [COUNTER_NAMES[pieces[0]], pieces[0], pieces[1]])
			continue
		if line.begins_with("命令 ") or line.begins_with("命令结果"):
			page = "命令"
			for status in COMMAND_STATUSES:
				if line.ends_with(" · " + status):
					line += "（%s）" % COMMAND_NAMES[status]
		grouped[page].append(line.replace(" · ", "\n"))
	if not server_seen or grouped["服务端"].size() == 1:
		grouped["服务端"].append("服务端诊断缺测或未启用；缺测不等于0。")
	grouped["收发"].append("缓冲是留待显示的快照份数（帧）及时间跨度（ms）；显示方式的中文含义见概览。RTT、服务端消费延迟和GPU耗时均未测量；本页距今时间不是往返延迟。")
	var result := {}
	for page in PAGES:
		result[page] = "\n\n".join(grouped[page])
	return result

## Pure formatter: every value is either a finite number, a fixed label or MISSING.
static func rows(snapshot: Variant, own_id: String, client_summary: Variant, presentation: Variant, commands: Variant) -> PackedStringArray:
	var out: PackedStringArray = []
	var state: Dictionary = snapshot if snapshot is Dictionary else {}
	var phase: Variant = state.get("phase")
	out.append("当前：%s（以最近收到的房间状态为准）" % PHASE_NAMES.get(phase, MISSING))
	out.append("阶段 %s · 轮次 %s · tick %s" % [phase if phase in PHASES else MISSING, _int(state.get("round_id")), _int(state.get("tick"))])
	var own: Dictionary = {}
	if not own_id.is_empty() and state.get("players") is Array:
		for player in state.players:
			if player is Dictionary and player.get("user_id") == own_id:
				own = player
	out.append("本人位置 %s · 速度 %s · 分数 %s" % [_vector(own.get("position")), _vector(own.get("velocity")), _int(own.get("score"))])
	out.append("最高 accepted %s / applied %s（最高值，非累计确认）" % [_int(own.get("accepted_input_seq")), _int(own.get("applied_input_seq"))])
	var summary: Dictionary = client_summary if client_summary is Dictionary else {}
	var received: Dictionary = summary.get("snapshot_received") if summary.get("snapshot_received") is Dictionary else {}
	var age: Variant = received.get("last_age_ms") if summary.get("enabled") == true else null
	out.append("最近收到服务器房间消息：距今 %s 毫秒（ms）（本机观测；缺测表示尚无可用记录）" % [_ms(age) if _finite(age) and float(age) >= 0.0 else MISSING])
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
		out.append("画面缓冲：%s" % BUFFER_NAMES.get(presentation_state, MISSING + "，暂时无法说明画面缓冲状态。"))
		out.append("快照接收年龄 %s ms · 帧间隔 %s ms · 采样 %s us" % [_ms(shown.get("snapshot_receive_age_ms")), _ms(shown.get("frame_callback_interval_ms")), _int(shown.get("sample_cpu_usec"))])
		out.append("呈现 %s · 缓冲 %s 帧 / %s ms · 欠载 %s · 外推 %s · 旧包 %s · 重置 %s" % [presentation_state if presentation_state in PRESENTATION_STATES else MISSING, _int(timeline.get("buffer_samples")), _ms(timeline.get("buffer_depth_ms")), _int(timeline.get("underrun_frames")), _int(timeline.get("extrapolated_frames")), _int(timeline.get("late_snapshot_drops")), _int(timeline.get("timeline_resets"))])
	else:
		out.append("画面缓冲：缺测，未启用呈现诊断或当前不在对局中。")
		out.append("呈现诊断未启用或不在对局中")
	out.append("操作反馈：服务器接受输入表示已经收下；已执行表示已经交给玩法执行。每条命令的具体反馈见命令页；没有记录时结果未知。")
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
