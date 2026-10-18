extends Control
## Test-only acceptance entry: registers the existing server fixture (module_version 1)
## for this process, then runs the original Main.tscn with the shared Session.
## Never referenced by production registration or the player export.
const VIEW_SCRIPT := "res://tests/cross_platform/cross_platform_view.gd"
const LIFECYCLE_SCRIPT := preload("res://tests/cross_platform/lifecycle.gd")
const PANEL_SCRIPT := preload("res://tests/cross_platform/diagnostics_panel.gd")
const GUIDE_SCRIPT := preload("res://tests/cross_platform/acceptance_guide.gd")
const GUIDE_TOP := 28.0
const HEADER_GAP := 6.0
var main: Control
var lifecycle: Node
var diagnostics_panel: PanelContainer
var guide: Label
## Fixed flag: another factory already owned "fixture" in this process.
var registration_conflict := false
var _owns_registration := false

func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	if ModuleRegistry.modules.has("fixture"):
		registration_conflict = ModuleRegistry.version("fixture") != 1
	else:
		register_fixture()
		_owns_registration = true
	main = load("res://Main.tscn").instantiate()
	add_child(main)
	# Reserve a header strip, so the fixed test marker cannot cover Main controls.
	main.offset_top = 32
	var marker := Label.new()
	marker.name = "IsolatedTestLabel"
	marker.text = "隔离测试"
	marker.position = Vector2(24, 4)
	marker.mouse_filter = Control.MOUSE_FILTER_IGNORE
	marker.add_theme_font_override("font", main.get_theme_font("font"))
	marker.add_theme_font_size_override("font_size", 16)
	add_child(marker)
	var session := get_node_or_null("/root/Session")
	lifecycle = LIFECYCLE_SCRIPT.new()
	lifecycle.name = "Lifecycle"
	add_child(lifecycle)
	lifecycle.setup(session, LIFECYCLE_SCRIPT.engine_bridge(), current_view)
	_build_guide(session)
	_build_overlay(session)
	_layout_header()

## Static so the factory never captures this node. The entry removes its own
## registration on exit: a lambda left in the static registry until engine
## shutdown outlives its script and crashes the process on quit.
static func register_fixture() -> void:
	ModuleRegistry.register_module("fixture", func(): return load(VIEW_SCRIPT).new(), {"module_version": 1})

## Read-only stage guide in the header strip under the marker. Main starts below
## its actual wrapped height, so the guide never covers Main's own controls.
func _build_guide(session: Node) -> void:
	guide = GUIDE_SCRIPT.new()
	guide.theme = main.theme
	guide.set_anchors_and_offsets_preset(Control.PRESET_TOP_WIDE)
	guide.offset_left = 24
	guide.offset_right = -24
	guide.offset_top = GUIDE_TOP
	add_child(guide)
	guide.setup(session, main, lifecycle)
	guide.minimum_size_changed.connect(_layout_header)
	guide.resized.connect(_layout_header)

func _layout_header() -> void:
	if not is_instance_valid(guide) or not is_instance_valid(main):
		return
	var guide_height := guide.get_combined_minimum_size().y
	guide.offset_bottom = GUIDE_TOP + guide_height
	main.offset_top = GUIDE_TOP + guide_height + HEADER_GAP
	if is_instance_valid(diagnostics_panel):
		diagnostics_panel.offset_top = main.offset_top

func current_view() -> Variant:
	return main.module_view if is_instance_valid(main) and is_instance_valid(main.module_view) else null

func _build_overlay(session: Node) -> void:
	var layer := CanvasLayer.new()
	layer.name = "AcceptanceOverlay"
	layer.layer = 10
	add_child(layer)
	var bar := HBoxContainer.new()
	bar.name = "AcceptanceBar"
	bar.theme = main.theme
	bar.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_RIGHT)
	bar.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	bar.grow_vertical = Control.GROW_DIRECTION_BEGIN
	bar.offset_right = -8
	bar.offset_bottom = -8
	layer.add_child(bar)
	_overlay_button(bar, "SimulateBackground", "模拟后台", func(): lifecycle.enter_background("simulated"))
	_overlay_button(bar, "SimulateForeground", "模拟返回前台", func(): lifecycle.return_foreground("simulated"))
	_overlay_button(bar, "ToggleDiagnostics", "诊断", func(): diagnostics_panel.visible = not diagnostics_panel.visible)
	diagnostics_panel = PANEL_SCRIPT.new()
	diagnostics_panel.theme = main.theme
	diagnostics_panel.set_anchors_and_offsets_preset(Control.PRESET_TOP_RIGHT)
	diagnostics_panel.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	diagnostics_panel.offset_right = -8
	diagnostics_panel.offset_top = 8
	diagnostics_panel.modulate = Color(1, 1, 1, 0.9)
	layer.add_child(diagnostics_panel)
	diagnostics_panel.setup(session, current_view)
	diagnostics_panel.visible = session != null and bool(session.diagnostics.enabled)

func _overlay_button(parent: Control, id: String, text: String, callback: Callable) -> Button:
	var button := Button.new()
	button.name = id
	button.text = text
	button.custom_minimum_size = Vector2(0, 40)
	button.add_theme_font_size_override("font_size", 16)
	button.pressed.connect(callback)
	parent.add_child(button)
	return button

func _exit_tree() -> void:
	if is_instance_valid(lifecycle):
		lifecycle.release()
	if _owns_registration:
		ModuleRegistry.modules.erase("fixture")
		_owns_registration = false
