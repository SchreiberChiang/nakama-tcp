extends GameModule
## Test-only 2D view for the existing fixture: two squares, keyboard arrows plus a
## four-way touch/mouse pad for state.direction, and a Pulse button for command.pulse.
## Input is bound to the Session presentation scope captured when Main created this
## view, so a retained callback from an old view cannot send into a later room.
const PAD_SCRIPT := preload("res://tests/cross_platform/direction_pad.gd")
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

func _ready() -> void:
	continuous_input = true
	enable_timeline(117, 33)
	var transport_node := _session()
	diagnostics_enabled = transport_node != null and bool(transport_node.diagnostics.enabled)
	custom_minimum_size.y = 320
	var box := VBoxContainer.new()
	box.name = "CrossPlatformView"
	box.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(box)
	score_label = Label.new()
	score_label.name = "Score"
	score_label.text = "服务端计数：—"
	box.add_child(score_label)
	field = Control.new()
	field.name = "Field"
	field.custom_minimum_size = Vector2(0, 120)
	field.clip_contents = true
	field.mouse_filter = Control.MOUSE_FILTER_IGNORE
	field.draw.connect(_draw_field)
	box.add_child(field)
	var controls := HBoxContainer.new()
	controls.add_theme_constant_override("separation", 16)
	box.add_child(controls)
	pulse_button = Button.new()
	pulse_button.name = "Pulse"
	pulse_button.text = "计数 +1（服务端决定）"
	pulse_button.custom_minimum_size = Vector2(160, 72)
	pulse_button.pressed.connect(click_pulse)
	controls.add_child(pulse_button)
	pad = PAD_SCRIPT.new()
	pad.custom_minimum_size = Vector2(180, 180)
	controls.add_child(pad)

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
	for player in data.get("players", []):
		if not player is Dictionary or not player.get("user_id") is String:
			continue
		_order.append(player.user_id)
		if player.user_id == local_user_id and _number(player.get("score")):
			own_score = player.score
	if is_instance_valid(score_label):
		score_label.text = "服务端计数：%s" % (str(int(own_score)) if own_score != null else "—")

func _process(delta: float) -> void:
	poses = sample_presentation(delta)
	if is_instance_valid(field):
		field.queue_redraw()

func _draw_field() -> void:
	var origin := Vector2(field.size.x * 0.5, field.size.y * 0.5)
	field.draw_rect(Rect2(Vector2.ZERO, field.size), Color(0.12, 0.15, 0.20, 1.0))
	for index in range(mini(2, _order.size())):
		var id := _order[index]
		if not poses.has(id):
			continue
		var at: Vector2 = poses[id].position
		field.draw_rect(Rect2(origin + at - Vector2(10, 10), Vector2(20, 20)), Color.CORNFLOWER_BLUE if index == 0 else Color.ORANGE)

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
