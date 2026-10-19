extends Control
## Plain 2D shell. No module instance exists on login, lobby, room or results pages.
var page := ""
var body: VBoxContainer
var status: Label
var members: Label
var module_view: GameModule
var _page_key := ""
var _closing := false
var _available: Array = []
var _name: LineEdit
var _host: LineEdit
var _port: SpinBox
var _tls: CheckBox
var _key: LineEdit
var _modules: OptionButton
var _room_name: LineEdit
var _capacity: SpinBox
var _ready_button: Button
var _start_button: Button
var _rematch_button: Button
var _join_buttons: Array[Button] = []
var _notice_text := ""
var _rooms_body: VBoxContainer
var _draft_name := "新房间"
var _draft_capacity := 4
var _draft_module := ""
var _margin: MarginContainer
var _header: HBoxContainer
## Readable single column on wide screens; the playing page may use more width.
const COLUMN_WIDTH := 760.0
const PLAYING_COLUMN_WIDTH := 1120.0
const PHASE_NAMES := {"lobby": "准备中", "countdown": "倒计时", "playing": "对局中", "results": "结算"}
const TEXT := Color(0.90, 0.92, 0.95)
const MUTED := Color(0.60, 0.65, 0.72)
const ACCENT := Color(0.30, 0.55, 1.0)

func _ready() -> void:
	get_tree().auto_accept_quit = false
	# Theme values reach every child; local Control overrides do not.
	theme = _build_theme(load("res://assets/fonts/TemplateCJK.otf") as Font)
	resized.connect(_apply_margins)
	Session.authenticated.connect(_show_lobby)
	Session.logged_out.connect(_show_login)
	Session.left.connect(_show_lobby)
	Session.joined.connect(_show_room)
	Session.rooms_updated.connect(func(_rooms):
		if page == "lobby": _render_rooms())
	Session.rooms_state_changed.connect(func():
		if page == "lobby": _render_rooms())
	Session.snapshot_received.connect(_on_snapshot)
	Session.notice.connect(func(message, _error):
		_notice_text = message
		if is_instance_valid(status):
			status.text = message
			status.visible = not message.is_empty())
	_show_login()

static func _box(color: Color, border_color: Color = Color(0, 0, 0, 0), border: int = 0) -> StyleBoxFlat:
	var box := StyleBoxFlat.new()
	box.bg_color = color
	box.border_color = border_color
	box.set_border_width_all(border)
	box.set_corner_radius_all(10)
	box.content_margin_left = 16
	box.content_margin_right = 16
	box.content_margin_top = 8
	box.content_margin_bottom = 8
	return box

## Plain 2D theme: no textures, only flat colours, so exports stay asset-free.
static func _build_theme(font: Font) -> Theme:
	var result := Theme.new()
	if font != null:
		result.default_font = font
	result.default_font_size = 20
	result.set_color("font_color", "Label", TEXT)
	for type in ["Button", "CheckBox"]:
		result.set_color("font_color", type, TEXT)
		result.set_color("font_hover_color", type, Color.WHITE)
		result.set_color("font_pressed_color", type, Color.WHITE)
		result.set_color("font_focus_color", type, Color.WHITE)
		result.set_color("font_disabled_color", type, MUTED * Color(1, 1, 1, 0.7))
	result.set_stylebox("normal", "Button", _box(Color(0.17, 0.21, 0.28), Color(0.25, 0.30, 0.39), 1))
	result.set_stylebox("hover", "Button", _box(Color(0.21, 0.26, 0.35), Color(0.33, 0.40, 0.52), 1))
	result.set_stylebox("pressed", "Button", _box(Color(0.14, 0.18, 0.24), ACCENT, 1))
	result.set_stylebox("disabled", "Button", _box(Color(0.12, 0.14, 0.18), Color(0.17, 0.20, 0.25), 1))
	var focus := _box(Color(0, 0, 0, 0), ACCENT, 2)
	focus.draw_center = false
	result.set_stylebox("focus", "Button", focus)
	result.set_type_variation("PrimaryButton", "Button")
	result.set_stylebox("normal", "PrimaryButton", _box(ACCENT * Color(0.85, 0.85, 0.85)))
	result.set_stylebox("hover", "PrimaryButton", _box(ACCENT))
	result.set_stylebox("pressed", "PrimaryButton", _box(ACCENT * Color(0.7, 0.7, 0.7)))
	result.set_stylebox("disabled", "PrimaryButton", _box(Color(0.15, 0.20, 0.30)))
	result.set_stylebox("normal", "LineEdit", _box(Color(0.07, 0.09, 0.13), Color(0.22, 0.27, 0.35), 1))
	result.set_stylebox("focus", "LineEdit", focus)
	result.set_stylebox("read_only", "LineEdit", _box(Color(0.10, 0.12, 0.16)))
	result.set_color("font_color", "LineEdit", TEXT)
	result.set_color("font_placeholder_color", "LineEdit", MUTED)
	result.set_color("caret_color", "LineEdit", ACCENT)
	result.set_stylebox("panel", "PanelContainer", _box(Color(0.11, 0.14, 0.19), Color(0.20, 0.25, 0.32), 1))
	return result

func _apply_margins() -> void:
	if not is_instance_valid(_margin):
		return
	var column := PLAYING_COLUMN_WIDTH if page == "playing" else COLUMN_WIDTH
	var side := maxf(24.0, floor((size.x - column) * 0.5))
	_margin.add_theme_constant_override("margin_left", int(side))
	_margin.add_theme_constant_override("margin_right", int(side))

func _button(id: String, text: String, callback: Callable, primary: bool = false) -> Button:
	var button := Button.new()
	button.name = id
	button.text = text
	button.custom_minimum_size.y = 48
	if primary:
		button.theme_type_variation = "PrimaryButton"
	button.pressed.connect(callback)
	body.add_child(button)
	return button

## Secondary page actions share the title row instead of a full-width line.
func _header_button(id: String, text: String, callback: Callable) -> Button:
	var button := Button.new()
	button.name = id
	button.text = text
	button.custom_minimum_size = Vector2(132, 44)
	button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	button.pressed.connect(callback)
	_header.add_child(button)
	return button

func _caption(text: String) -> Label:
	var caption := _label(text)
	caption.add_theme_font_size_override("font_size", 16)
	caption.add_theme_color_override("font_color", MUTED)
	return caption

func _label(text: String) -> Label:
	var label := Label.new()
	label.text = text
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	body.add_child(label)
	return label

func _field(id: String, placeholder: String, text: String) -> LineEdit:
	var edit := LineEdit.new()
	edit.name = id
	edit.placeholder_text = placeholder
	edit.text = text
	edit.custom_minimum_size.y = 44
	body.add_child(edit)
	return edit

func _reset(next_page: String, title: String) -> void:
	Session.input_provider = Callable()
	if is_instance_valid(module_view):
		module_view.release()
		module_view = null
	for child in get_children():
		remove_child(child)
		child.queue_free()
	page = next_page
	_ready_button = null
	_start_button = null
	_rematch_button = null
	_join_buttons.clear()
	var margin := MarginContainer.new()
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 20)
	add_child(margin)
	_margin = margin
	_apply_margins()
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	margin.add_child(scroll)
	body = VBoxContainer.new()
	body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	body.add_theme_constant_override("separation", 12)
	scroll.add_child(body)
	_header = HBoxContainer.new()
	_header.name = "Header"
	_header.add_theme_constant_override("separation", 12)
	body.add_child(_header)
	var heading := Label.new()
	heading.text = title
	heading.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	heading.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	heading.add_theme_font_size_override("font_size", 28)
	_header.add_child(heading)
	status = _label(_notice_text)
	status.name = "Status"
	status.add_theme_font_size_override("font_size", 16)
	status.add_theme_color_override("font_color", MUTED)
	status.visible = not _notice_text.is_empty()

func _show_login() -> void:
	_draft_name = "新房间"
	_draft_capacity = 4
	_draft_module = ""
	_page_key = ""
	_reset("login", "Godot + Nakama · 登录")
	_name = _field("PlayerName", "显示名称", Session.username)
	_name.max_length = 20
	_host = _field("Host", "服务器域名或本地地址", Session.host)
	_port = SpinBox.new()
	_port.name = "Port"
	_port.min_value = 1
	_port.max_value = 65535
	_port.value = Session.port
	body.add_child(_port)
	_tls = CheckBox.new()
	_tls.name = "TLS"
	_tls.text = "TLS（远端连接必须开启，证书验证保持开启）"
	_tls.button_pressed = Session.tls
	body.add_child(_tls)
	_key = _field("ServerKey", "Nakama 客户端 server key", Session.server_key)
	_key.secret = true
	_button("Login", "登录 / 创建本地设备账号", func():
		Session.host = _host.text.strip_edges()
		Session.port = int(_port.value)
		Session.tls = _tls.button_pressed
		Session.server_key = _key.text
		Session.login(_name.text), true)
	_caption("设备身份和昵称仅保存在当前本地 profile；不保存密码、令牌或 server key。")
	_button("Quit", "退出", _request_exit)

func _show_lobby() -> void:
	if not Session.connected or not Session.match_id.is_empty() or _closing:
		return
	if page == "lobby" and is_instance_valid(_room_name) and is_instance_valid(_capacity) and is_instance_valid(_modules):
		_draft_name = _room_name.text
		_draft_capacity = int(_capacity.value)
		if _modules.selected >= 0 and _modules.selected < _available.size():
			_draft_module = str(_available[_modules.selected].id)
	_page_key = ""
	_reset("lobby", "大厅")
	_header_button("Logout", "注销", Session.logout)
	_caption("房间列表")
	_button("Refresh", "刷新房间", Session.refresh_rooms)
	_rooms_body = VBoxContainer.new()
	_rooms_body.name = "RoomList"
	body.add_child(_rooms_body)
	_render_rooms()
	_available.clear()
	for entry in Session.catalog:
		if ModuleRegistry.compatible(entry):
			_available.append(entry)
	if _available.is_empty():
		var empty := _label("尚未安装玩法。请按 docs/ADDING_GAME.md 同时注册客户端和服务端模块。")
		empty.name = "EmptyState"
		_label("登录与连接已就绪；没有玩法时不创建房间，也不会加载旧游戏。")
		return
	_caption("创建房间")
	_modules = OptionButton.new()
	_modules.name = "Modules"
	_modules.custom_minimum_size.y = 44
	for entry in _available:
		_modules.add_item(str(entry.get("title", entry.id)))
		if str(entry.id) == _draft_module:
			_modules.select(_modules.item_count - 1)
	body.add_child(_modules)
	_room_name = _field("RoomName", "房间名", _draft_name)
	_capacity = SpinBox.new()
	_capacity.name = "Capacity"
	_capacity.min_value = 2
	_capacity.max_value = 8
	_capacity.value = _draft_capacity
	body.add_child(_capacity)
	_button("Create", "创建房间", func():
		var entry: Dictionary = _available[_modules.selected]
		Session.create_room(_room_name.text, str(entry.id), {}, int(_capacity.value)), true)

func _render_rooms() -> void:
	if not is_instance_valid(_rooms_body): return
	for child in _rooms_body.get_children():
		_rooms_body.remove_child(child)
		child.queue_free()
	_join_buttons.clear()
	var state := Label.new()
	state.name = "RoomListState"
	state.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	match Session.rooms_state:
		"loading": state.text = "正在刷新房间；下方为上次列表，可能已过期。" if Session.rooms_have_success else "正在加载房间列表……"
		"error": state.text = "刷新失败；下方保留上次列表，可能已过期。请点击刷新房间重试。" if Session.rooms_have_success else "房间列表加载失败。请点击刷新房间重试。"
		"ready": state.text = "暂无房间。" if Session.rooms.is_empty() else "房间列表已更新。"
		_: state.text = "房间列表尚未加载。"
	_rooms_body.add_child(state)
	for room in Session.rooms:
		var label: Dictionary = room.get("label", {})
		var id := str(label.get("game_id", ""))
		if not ModuleRegistry.modules.has(id):
			continue
		var button := Button.new()
		button.name = "Join" + str(_join_buttons.size())
		button.text = "%s · %s/%s · 加入" % [str(label.get("name", "房间")), str(room.get("size", 0)), str(label.get("capacity", 8))]
		button.custom_minimum_size.y = 44
		button.pressed.connect(func(): Session.join_room(str(room.match_id), id))
		_rooms_body.add_child(button)
		button.disabled = label.get("phase") != "lobby"
		button.set_meta("joinable", label.get("phase") == "lobby")
		_join_buttons.append(button)

func _show_room() -> void:
	_page_key = ""
	_on_snapshot(Session.snapshot)

func _on_snapshot(data: Dictionary) -> void:
	if Session.match_id.is_empty() or data.is_empty() or _closing:
		return
	var phase := str(data.get("phase", "lobby"))
	var key := "%s:%s:%d" % [Session.match_id, phase, int(data.get("round_id", 0))]
	if key != _page_key:
		_page_key = key
		_reset("room" if phase == "lobby" else phase, "房间 · 第 %d 局 · %s" % [int(data.get("round_id", 0)), PHASE_NAMES.get(phase, phase)])
		_header_button("Leave", "退出房间", Session.leave_room)
		members = _label("")
		members.name = "Members"
		if phase == "lobby":
			_ready_button = _button("Ready", "准备 / 取消准备", _toggle_ready, true)
			_start_button = _button("Start", "开始", Session.start_round, true)
		elif phase == "countdown":
			_caption("全部准备就绪，服务端倒计时中……")
		elif phase == "playing":
			module_view = ModuleRegistry.create(str(data.get("game_id", "")))
			if module_view == null:
				_label("缺少客户端模块，请退出房间并安装匹配模块。")
			else:
				module_view.configure(Session.user_id())
				module_view.set_presentation_scope(Session.presentation_scope())
				module_view.custom_minimum_size.y = 180
				module_view.exit_requested.connect(Session.leave_room)
				body.add_child(module_view)
				if module_view.continuous_input:
					Session.input_provider = module_view.collect_input
		elif phase == "results":
			var card := PanelContainer.new()
			card.name = "ResultsCard"
			body.add_child(card)
			var rows_box := VBoxContainer.new()
			rows_box.add_theme_constant_override("separation", 6)
			card.add_child(rows_box)
			var title := Label.new()
			title.text = "服务端结算"
			title.add_theme_color_override("font_color", MUTED)
			rows_box.add_child(title)
			for result in data.get("results", []):
				var row := Label.new()
				row.text = "%s · %s" % [str(result.get("username", "玩家")), str(result.get("score", ""))]
				row.add_theme_font_size_override("font_size", 24)
				rows_box.add_child(row)
			_rematch_button = _button("Rematch", "留在房间 / 房主开启下一局", Session.rematch, true)
	var rows: PackedStringArray = []
	var all_ready := true
	var connected_count := 0
	for player in data.get("players", []):
		if not player.get("connected", false):
			continue
		connected_count += 1
		all_ready = all_ready and bool(player.get("ready", false))
		rows.append("%s%s · %s" % [str(player.get("username", "玩家")), "（房主）" if player.get("user_id") == data.get("host_id") else "", "已准备" if player.get("ready", false) else "未准备"])
	members.text = "\n".join(rows)
	if is_instance_valid(_start_button):
		_start_button.disabled = Session.user_id() != data.get("host_id") or not all_ready or connected_count < int(data.get("min_players", 2))
	if is_instance_valid(module_view):
		module_view.apply_snapshot(data)

func _toggle_ready() -> void:
	for player in Session.snapshot.get("players", []):
		if player.get("user_id") == Session.user_id():
			Session.ready_up(not bool(player.get("ready", false)))
			return

func _process(_delta: float) -> void:
	for id in ["Login", "Create", "Refresh"]:
		var button := find_child(id, true, false) as Button
		if button != null:
			button.disabled = Session.busy
	for button in _join_buttons:
		if is_instance_valid(button):
			button.disabled = Session.busy or not bool(button.get_meta("joinable", false))

func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_CLOSE_REQUEST:
		_request_exit()

func _request_exit() -> void:
	if _closing:
		return
	_closing = true
	Session.input_provider = Callable()
	if is_instance_valid(module_view):
		module_view.release()
	await Session.logout()
	get_tree().quit()
