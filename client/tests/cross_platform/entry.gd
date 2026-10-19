extends Control
## Test-only acceptance entry: registers the existing server fixture (module_version 1)
## for this process, then runs the original Main.tscn with the shared Session.
## Never referenced by production registration or the player export.
const VIEW_SCRIPT := "res://tests/cross_platform/cross_platform_view.gd"
const LIFECYCLE_SCRIPT := preload("res://tests/cross_platform/lifecycle.gd")
const PANEL_SCRIPT := preload("res://tests/cross_platform/diagnostics_panel.gd")
const GUIDE_SCRIPT := preload("res://tests/cross_platform/acceptance_guide.gd")
## Right inset on Web builds keeps the top bar clear of the WeChat menu capsule.
const CAPSULE_INSET := 170
const PRESET_CONNECTION_FIELDS := ["Host", "Port", "TLS", "ServerKey"]
var main: Control
var lifecycle: Node
var diagnostics_panel: PanelContainer
var guide: Label
var top_bar: PanelContainer
## Fixed flag: another factory already owned "fixture" in this process.
var registration_conflict := false
var _owns_registration := false
var _session_node: Node = null
var _geometry_interface: Variant = null
var _geometry_elapsed := 0.0
var _diagnostics_requested := false
var _applying_geometry := false
var geometry_status := "native"
var geometry_failure := ""
var geometry_override: Variant = null # Synthetic normalized observations for tests.

## Fixed public categories only; never display bridge exceptions or arbitrary text.
const GEOMETRY_FAILURES := {
	"window_api": ["W1", "微信窗口接口不可用"], "window_fields": ["W2", "微信窗口尺寸不完整"],
	"window_bounds": ["W3", "微信屏幕与窗口尺寸不一致"], "window_exception": ["W4", "读取微信窗口失败"],
	"safearea_fields": ["S1", "微信安全区域不完整"], "safearea_bounds": ["S2", "微信安全区域坐标不一致"],
	"capsule_api": ["M1", "微信胶囊接口不可用"], "capsule_fields": ["M2", "微信胶囊尺寸不完整"],
	"capsule_bounds": ["M3", "微信胶囊坐标不一致"], "capsule_exception": ["M4", "读取微信胶囊失败"],
	"canvas_missing": ["C1", "未找到游戏画布"], "canvas_fields": ["C2", "游戏画布尺寸不完整"],
	"canvas_origin": ["C3", "游戏画布偏移尚未适配"], "canvas_exception": ["C4", "读取游戏画布失败"],
	"safearea_empty": ["S3", "没有可用的安全区域"], "canvas_empty": ["C5", "安全区域与游戏画布没有交集"],
	"geometry_exception": ["G1", "读取显示区域失败"]
}

static func geometry_failure_message(reason: Variant) -> Array:
	return GEOMETRY_FAILURES.get(reason, ["G0", "未取得有效的平台显示区域"]) if reason is String else ["G0", "未取得有效的平台显示区域"]

func _ready() -> void:
	if OS.has_feature("web"):
		_geometry_interface = JavaScriptBridge.get_interface("FoundationAcceptance")
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	resized.connect(_layout_header)
	if ModuleRegistry.modules.has("fixture"):
		registration_conflict = ModuleRegistry.version("fixture") != 1
	else:
		register_fixture()
		_owns_registration = true
	main = load("res://Main.tscn").instantiate()
	add_child(main)
	_session_node = get_node_or_null("/root/Session")
	lifecycle = LIFECYCLE_SCRIPT.new()
	lifecycle.name = "Lifecycle"
	add_child(lifecycle)
	lifecycle.setup(_session_node, LIFECYCLE_SCRIPT.engine_bridge(), current_view)
	_build_top_bar(_session_node)
	_build_diagnostics(_session_node)
	_layout_header()
	if _session_node != null:
		_session_node.logged_out.connect(_on_logged_out)
		_session_node.snapshot_received.connect(_sync_diagnostic_controls)
		_session_node.joined.connect(_sync_diagnostic_controls)
	compact_login(_session_node)

## Static so the factory never captures this node. The entry removes its own
## registration on exit: a lambda left in the static registry until engine
## shutdown outlives its script and crashes the process on quit.
static func register_fixture() -> void:
	ModuleRegistry.register_module("fixture", func(): return load(VIEW_SCRIPT).new(), {"module_version": 1})

static func _badge_box() -> StyleBoxFlat:
	var box := StyleBoxFlat.new()
	box.bg_color = Color(0.95, 0.62, 0.20)
	box.set_corner_radius_all(8)
	box.content_margin_left = 10
	box.content_margin_right = 10
	box.content_margin_top = 3
	box.content_margin_bottom = 3
	return box

static func _bar_box(right_inset: int) -> StyleBoxFlat:
	var box := StyleBoxFlat.new()
	box.bg_color = Color(0.06, 0.08, 0.11)
	box.border_color = Color(0.20, 0.25, 0.32)
	box.border_width_bottom = 1
	box.content_margin_left = 20
	box.content_margin_right = 20 + right_inset
	box.content_margin_top = 8
	box.content_margin_bottom = 8
	return box

## One top bar holds the marker, the read-only stage guide and the test buttons.
## Main starts below it, so nothing overlays Main's own controls or bottom area.
func _build_top_bar(session: Node) -> void:
	top_bar = PanelContainer.new()
	top_bar.name = "AcceptanceTopBar"
	top_bar.theme = main.theme
	top_bar.set_anchors_and_offsets_preset(Control.PRESET_TOP_WIDE)
	top_bar.add_theme_stylebox_override("panel", _bar_box(CAPSULE_INSET if OS.has_feature("web") else 0))
	add_child(top_bar)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 14)
	top_bar.add_child(row)
	var marker := Label.new()
	marker.name = "IsolatedTestLabel"
	marker.text = "隔离测试"
	marker.mouse_filter = Control.MOUSE_FILTER_IGNORE
	marker.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	marker.add_theme_font_size_override("font_size", 15)
	marker.add_theme_color_override("font_color", Color(0.10, 0.08, 0.04))
	marker.add_theme_stylebox_override("normal", _badge_box())
	row.add_child(marker)
	guide = GUIDE_SCRIPT.new()
	guide.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	guide.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(guide)
	guide.setup(session, main, lifecycle)
	var bar := HBoxContainer.new()
	bar.name = "AcceptanceBar"
	bar.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	bar.add_theme_constant_override("separation", 8)
	row.add_child(bar)
	_bar_button(bar, "SimulateBackground", "模拟后台", func(): lifecycle.enter_background("simulated"))
	_bar_button(bar, "SimulateForeground", "模拟返回前台", func(): lifecycle.return_foreground("simulated"))
	_bar_button(bar, "ToggleDiagnostics", "诊断", _toggle_diagnostics)
	top_bar.minimum_size_changed.connect(_layout_header)
	top_bar.resized.connect(_layout_header)

## Opaque card under the top bar; hidden until "诊断" is pressed, even in
## diagnostics packages, so it never sits on top of Main's buttons by default.
func _build_diagnostics(session: Node) -> void:
	var layer := CanvasLayer.new()
	layer.name = "AcceptanceOverlay"
	layer.layer = 10
	add_child(layer)
	diagnostics_panel = PANEL_SCRIPT.new()
	diagnostics_panel.theme = main.theme
	var card := StyleBoxFlat.new()
	card.bg_color = Color(0.06, 0.08, 0.11, 1.0)
	card.border_color = Color(0.30, 0.55, 1.0)
	card.set_border_width_all(1)
	card.set_corner_radius_all(10)
	card.content_margin_left = 14
	card.content_margin_right = 14
	card.content_margin_top = 10
	card.content_margin_bottom = 10
	diagnostics_panel.add_theme_stylebox_override("panel", card)
	diagnostics_panel.set_anchors_and_offsets_preset(Control.PRESET_TOP_LEFT)
	layer.add_child(diagnostics_panel)
	diagnostics_panel.setup(session, current_view)
	diagnostics_panel.visible = false
	diagnostics_panel.visibility_changed.connect(_on_diagnostics_visibility)
	diagnostics_panel.minimum_size_changed.connect(func(): _layout_header.call_deferred())

func _bar_button(parent: Control, id: String, text: String, callback: Callable) -> Button:
	var button := Button.new()
	button.name = id
	button.text = text
	button.custom_minimum_size = Vector2(0, 36)
	button.add_theme_font_size_override("font_size", 15)
	button.pressed.connect(callback)
	parent.add_child(button)
	return button

func _layout_header() -> void:
	if not is_instance_valid(top_bar) or not is_instance_valid(main):
		return
	var height := top_bar.get_combined_minimum_size().y
	top_bar.offset_bottom = height
	main.offset_top = height
	if is_instance_valid(diagnostics_panel):
		_layout_diagnostics(height)

func _toggle_diagnostics() -> void:
	_diagnostics_requested = not _diagnostics_requested
	_layout_header()

func _process(delta: float) -> void:
	if not _diagnostics_requested or _geometry_interface == null:
		return
	_geometry_elapsed += delta
	if _geometry_elapsed >= 0.25:
		_geometry_elapsed = 0.0
		_layout_header()

## CSS pixels are normalized to the actual rendered canvas by the bridge, then
## scaled with this logical viewport. No assumed device-pixel ratio.
func _layout_diagnostics(header_height: float) -> void:
	if _geometry_interface != null and not _diagnostics_requested and geometry_override == null:
		_applying_geometry = true
		diagnostics_panel.hide()
		_sync_diagnostic_controls()
		_applying_geometry = false
		return
	var observed: Variant = geometry_override
	if observed == null and _geometry_interface != null:
		observed = JSON.parse_string(str(_geometry_interface.geometryJSON()))
	var usable := Rect2(Vector2.ZERO, size)
	geometry_status = "native"
	geometry_failure = ""
	if observed != null or OS.has_feature("web"):
		geometry_status = "unknown"
		if observed is Dictionary and observed.get("status") in ["known", "conservative"]:
			var valid := true
			for key in ["x", "y", "width", "height"]:
				var value: Variant = observed.get(key)
				valid = valid and (value is int or value is float) and is_finite(float(value))
			if valid and observed.x >= 0 and observed.y >= 0 and observed.width > 0 and observed.height > 0 and observed.x + observed.width <= 1.000001 and observed.y + observed.height <= 1.000001:
				usable = Rect2(Vector2(observed.x, observed.y) * size, Vector2(observed.width, observed.height) * size)
				geometry_status = observed.status
		if geometry_status == "unknown":
			geometry_failure = str(observed.get("reason", "")) if observed is Dictionary else ""
			usable = Rect2()
	var start := maxf(usable.position.y, header_height + 8.0)
	usable = Rect2(Vector2(usable.position.x, start), Vector2(usable.size.x, maxf(0.0, usable.end.y - start)))
	var width := minf(1060.0, maxf(0.0, usable.size.x - 24.0))
	var height := maxf(0.0, usable.size.y - 12.0)
	diagnostics_panel.set_geometry_status(geometry_status)
	diagnostics_panel.position = Vector2(usable.position.x + (usable.size.x - width) * 0.5, usable.position.y)
	diagnostics_panel.size = Vector2(width, height)
	var fits := width >= diagnostics_panel.get_combined_minimum_size().x and height >= diagnostics_panel.get_combined_minimum_size().y
	_applying_geometry = true
	diagnostics_panel.visible = _diagnostics_requested and fits
	_applying_geometry = false
	var toggle := find_child("ToggleDiagnostics", true, false) as Button
	if toggle != null:
		var failure := geometry_failure_message(geometry_failure)
		toggle.text = ("诊断 " + failure[0]) if geometry_status == "unknown" else ("诊断不足" if not fits else "诊断")
		toggle.tooltip_text = failure[1] if geometry_status == "unknown" else ("安全区域不足以容纳诊断" if not fits else "")
	_applying_geometry = true
	_sync_diagnostic_controls()
	_applying_geometry = false

## Test packages preset host/port/TLS/key, so the login page hides those fields;
## Main still reads their (preset) values when the visible Login button is used.
func compact_login(session: Node) -> bool:
	if session == null or session.get("cross_platform_enabled") != true or not is_instance_valid(main) or main.page != "login":
		return false
	for id in PRESET_CONNECTION_FIELDS:
		var field := main.find_child(id, true, false) as Control
		if field != null:
			field.visible = false
	return true

func _on_logged_out() -> void:
	# Main rebuilds the login page in its own earlier logged_out handler.
	compact_login(_session_node)

## The pad handles _input before GUI dispatch; an overlay's mouse_filter alone
## cannot protect scrolling. Only covered test controls stop taking new presses;
## Session, keyboard input and the authoritative round keep running.
func _on_diagnostics_visibility() -> void:
	if not _applying_geometry:
		_diagnostics_requested = diagnostics_panel.visible
		if _diagnostics_requested:
			_layout_header.call_deferred()
	_sync_diagnostic_controls()

func _sync_diagnostic_controls(_snapshot: Variant = null) -> void:
	var view: Variant = current_view()
	if not is_instance_valid(view) or not is_instance_valid(diagnostics_panel):
		return
	if is_instance_valid(view.pad):
		if diagnostics_panel.visible:
			view.pad.clear()
		view.pad.set_process_input(not diagnostics_panel.visible)
	if is_instance_valid(view.pulse_button):
		view.pulse_button.disabled = diagnostics_panel.visible

func current_view() -> Variant:
	return main.module_view if is_instance_valid(main) and is_instance_valid(main.module_view) else null

func _exit_tree() -> void:
	_geometry_interface = null
	if is_instance_valid(_session_node) and _session_node.logged_out.is_connected(_on_logged_out):
		_session_node.logged_out.disconnect(_on_logged_out)
	if is_instance_valid(_session_node):
		if _session_node.snapshot_received.is_connected(_sync_diagnostic_controls):
			_session_node.snapshot_received.disconnect(_sync_diagnostic_controls)
		if _session_node.joined.is_connected(_sync_diagnostic_controls):
			_session_node.joined.disconnect(_sync_diagnostic_controls)
	if is_instance_valid(lifecycle):
		lifecycle.release()
	if _owns_registration:
		ModuleRegistry.modules.erase("fixture")
		_owns_registration = false
