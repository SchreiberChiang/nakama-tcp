extends GameModule
## Test-only 2D view for the existing fixture: two squares, keyboard arrows plus a
## four-way touch/mouse pad for state.direction, and a Pulse button for command.pulse.
## Input is bound to the Session presentation scope captured when Main created this
## view, so a retained callback from an old view cannot send into a later room.
const PAD_SCRIPT := preload("res://tests/cross_platform/direction_pad.gd")
const MIN_EXTENT := 150.0
const SIDE_COLUMN := 210.0
const MIN_HEIGHT := 260.0
const MAX_HEIGHT := 560.0
const SELF_COLOR := Color(0.36, 0.62, 1.0)
const OTHER_COLOR := Color(1.0, 0.62, 0.22)
const MUTED := Color(0.60, 0.65, 0.72)
## Optional injected transport for unit tests; otherwise the Session autoload.
var transport: Node = null
var pad: Control
var pulse_button: Button
var score_label: Label
var field: Control
var poses: Dictionary = {}
var stale_input_rejections := 0
var _bound_scope := ""
var _released := false
var _order: Array[String] = []
## Smoothed half-width of the visible world in fixture units. It grows at once
## to keep both squares on screen and never shrinks below MIN_EXTENT.
var _extent := MIN_EXTENT
var _background: StyleBoxFlat = _field_box()

func _ready() -> void:
	continuous_input = true
	enable_timeline(117, 33)
	var transport_node := _session()
	diagnostics_enabled = transport_node != null and bool(transport_node.diagnostics.enabled)
	custom_minimum_size.y = MIN_HEIGHT
	# Landscape layout: pad bottom-left (left thumb), field in the middle,
	# server count and Pulse on the right (right thumb).
	var row := HBoxContainer.new()
	row.name = "CrossPlatformView"
	row.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	row.add_theme_constant_override("separation", 16)
	add_child(row)
	var left := VBoxContainer.new()
	left.custom_minimum_size.x = SIDE_COLUMN
	left.alignment = BoxContainer.ALIGNMENT_END
	row.add_child(left)
	left.add_child(_muted("方向键或方向盘移动，松开即停"))
	pad = PAD_SCRIPT.new()
	pad.custom_minimum_size = Vector2(SIDE_COLUMN, SIDE_COLUMN)
	left.add_child(pad)
	field = Control.new()
	field.name = "Field"
	field.custom_minimum_size = Vector2(200, MIN_HEIGHT - 20)
	field.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	field.size_flags_vertical = Control.SIZE_EXPAND_FILL
	field.clip_contents = true
	field.mouse_filter = Control.MOUSE_FILTER_IGNORE
	field.draw.connect(_draw_field)
	row.add_child(field)
	var right := VBoxContainer.new()
	right.custom_minimum_size.x = SIDE_COLUMN
	right.alignment = BoxContainer.ALIGNMENT_END
	right.add_theme_constant_override("separation", 12)
	row.add_child(right)
	score_label = Label.new()
	score_label.name = "Score"
	score_label.text = "我 — · 对方 —"
	score_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	score_label.add_theme_font_size_override("font_size", 24)
	right.add_child(score_label)
	right.add_child(_muted("计数由服务端决定"))
	pulse_button = Button.new()
	pulse_button.name = "Pulse"
	pulse_button.text = "计数 +1"
	pulse_button.theme_type_variation = "PrimaryButton"
	pulse_button.add_theme_font_size_override("font_size", 26)
	pulse_button.custom_minimum_size = Vector2(SIDE_COLUMN, 120)
	pulse_button.pressed.connect(click_pulse)
	right.add_child(pulse_button)

func _muted(text: String) -> Label:
	var label := Label.new()
	label.text = text
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.add_theme_font_size_override("font_size", 15)
	label.add_theme_color_override("font_color", MUTED)
	return label

## Fill the visible height below Main's header without forcing a scroll.
func _fit_height() -> void:
	if not is_inside_tree() or _released:
		return
	var target := clampf(get_viewport_rect().size.y - global_position.y - 24.0, MIN_HEIGHT, MAX_HEIGHT)
	# Layout settles over a few frames; only a real change touches the size.
	if absf(custom_minimum_size.y - target) > 1.0:
		custom_minimum_size.y = target

func set_presentation_scope(scope: String) -> void:
	super.set_presentation_scope(scope)
	_bound_scope = scope

func input_allowed() -> bool:
	return not _released and not _bound_scope.is_empty() and _session() != null and _session().presentation_scope() == _bound_scope

func current_direction() -> Vector2:
	var direction := Vector2.ZERO
	if is_instance_valid(pad):
		direction += pad.direction()
	if is_inside_tree():
		direction += Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down")
	return direction.limit_length(1.0)

## Session calls this for continuous state. A released or stale view returns empty,
## which Session never sends; an active view always sends the full direction,
## including zero after release.
func collect_input() -> Dictionary:
	if not input_allowed():
		stale_input_rejections += 1
		return {}
	var direction := current_direction()
	return {"direction": {"x": direction.x, "y": direction.y}}

func click_pulse() -> bool:
	if not input_allowed():
		stale_input_rejections += 1
		return false
	_session().submit_input({"pulse": true})
	return true

## Background/stop path: drop held pointers without releasing the view itself.
func clear_local_input() -> void:
	if is_instance_valid(pad):
		pad.clear()

func apply_snapshot(data: Dictionary) -> void:
	super.apply_snapshot(data)
	_order.clear()
	var own_score: Variant = null
	var other_score: Variant = null
	for player in data.get("players", []):
		if not player is Dictionary or not player.get("user_id") is String:
			continue
		_order.append(player.user_id)
		if not _number(player.get("score")):
			continue
		if player.user_id == local_user_id:
			own_score = player.score
		elif other_score == null:
			other_score = player.score
	if is_instance_valid(score_label):
		score_label.text = "我 %s · 对方 %s" % [_count(own_score), _count(other_score)]

static func _count(value: Variant) -> String:
	return str(int(value)) if value != null else "—"

func _process(delta: float) -> void:
	_fit_height()
	poses = sample_presentation(delta)
	update_extent(poses, delta)
	if is_instance_valid(field):
		field.queue_redraw()

## Presentation-only zoom: out at once to keep every square visible, back in slowly.
func update_extent(sample: Dictionary, delta: float) -> void:
	var target := MIN_EXTENT
	for id in sample:
		var at: Vector2 = sample[id].position
		target = maxf(target, maxf(absf(at.x), absf(at.y)) * 1.25)
	_extent = target if target > _extent else lerpf(_extent, target, clampf(delta * 0.8, 0.0, 1.0))

## World units -> field pixels: the visible extent fits the field's shorter side.
func world_scale() -> float:
	if not is_instance_valid(field):
		return 1.0
	return maxf(0.01, minf(field.size.x, field.size.y) * 0.5 / _extent)

func world_to_field(at: Vector2) -> Vector2:
	return field.size * 0.5 + at * world_scale()

func _draw_field() -> void:
	field.draw_style_box(_background, Rect2(Vector2.ZERO, field.size))
	var unit := world_scale()
	var center := field.size * 0.5
	var step := 50.0
	while step * unit < 28.0:
		step *= 2.0
	var grid := Color(1, 1, 1, 0.05)
	var lines := int(ceil(maxf(field.size.x, field.size.y) / (step * unit) * 0.5)) + 1
	for i in range(-lines, lines + 1):
		var offset := i * step * unit
		field.draw_line(Vector2(center.x + offset, 0), Vector2(center.x + offset, field.size.y), grid)
		field.draw_line(Vector2(0, center.y + offset), Vector2(field.size.x, center.y + offset), grid)
	field.draw_line(Vector2(center.x, 0), Vector2(center.x, field.size.y), Color(1, 1, 1, 0.12))
	field.draw_line(Vector2(0, center.y), Vector2(field.size.x, center.y), Color(1, 1, 1, 0.12))
	var font := field.get_theme_font("font")
	for index in range(mini(2, _order.size())):
		var id := _order[index]
		if not poses.has(id):
			continue
		var mine := id == local_user_id
		var colour := SELF_COLOR if mine else OTHER_COLOR
		var at := world_to_field(poses[id].position)
		field.draw_rect(Rect2(at - Vector2(11, 11), Vector2(22, 22)), colour)
		if font != null:
			field.draw_string(font, at + Vector2(-16, -18), "我" if mine else "对方", HORIZONTAL_ALIGNMENT_CENTER, 32, 15, colour)

static func _field_box() -> StyleBoxFlat:
	var box := StyleBoxFlat.new()
	box.bg_color = Color(0.09, 0.11, 0.16)
	box.border_color = Color(0.20, 0.25, 0.32)
	box.set_border_width_all(1)
	box.set_corner_radius_all(12)
	return box

func release() -> void:
	_released = true
	clear_local_input()
	poses.clear()
	_order.clear()
	super.release()

func _session() -> Node:
	if transport != null:
		return transport
	return get_node_or_null("/root/Session")

static func _number(value: Variant) -> bool:
	return (value is int or value is float) and is_finite(float(value))
