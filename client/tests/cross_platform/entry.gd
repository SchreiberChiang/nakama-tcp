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

func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
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
	_bar_button(bar, "ToggleDiagnostics", "诊断", func(): diagnostics_panel.visible = not diagnostics_panel.visible)
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
	card.bg_color = Color(0.06, 0.08, 0.11, 0.97)
	card.border_color = Color(0.30, 0.55, 1.0)
	card.set_border_width_all(1)
	card.set_corner_radius_all(10)
	card.content_margin_left = 14
	card.content_margin_right = 14
	card.content_margin_top = 10
	card.content_margin_bottom = 10
	diagnostics_panel.add_theme_stylebox_override("panel", card)
	diagnostics_panel.set_anchors_and_offsets_preset(Control.PRESET_TOP_RIGHT)
	diagnostics_panel.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	diagnostics_panel.offset_right = -12
	layer.add_child(diagnostics_panel)
	diagnostics_panel.setup(session, current_view)
	diagnostics_panel.visible = false

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
		diagnostics_panel.offset_top = height + 8

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

func current_view() -> Variant:
	return main.module_view if is_instance_valid(main) and is_instance_valid(main.module_view) else null

func _exit_tree() -> void:
	if is_instance_valid(_session_node) and _session_node.logged_out.is_connected(_on_logged_out):
		_session_node.logged_out.disconnect(_on_logged_out)
	if is_instance_valid(lifecycle):
		lifecycle.release()
	if _owns_registration:
		ModuleRegistry.modules.erase("fixture")
		_owns_registration = false
