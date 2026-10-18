extends Control
## Test-only four-way pad. Each touch index or the real mouse owns at most one
## direction; release, slide-out, cancel, hide, focus loss and exit clear it.
## Mouse events emulated from touch are ignored so one finger is never counted twice.
signal direction_changed(direction: Vector2)
const MOUSE_POINTER := -1
const MAX_POINTERS := 4
const DIRECTIONS := {"up": Vector2(0, -1), "down": Vector2(0, 1), "left": Vector2(-1, 0), "right": Vector2(1, 0)}
var _pointers: Dictionary = {}

func _ready() -> void:
	name = "DirectionPad"
	mouse_filter = Control.MOUSE_FILTER_STOP
	if custom_minimum_size == Vector2.ZERO:
		custom_minimum_size = Vector2(180, 180)

func direction() -> Vector2:
	var total := Vector2.ZERO
	for id in _pointers:
		total += DIRECTIONS[_pointers[id]]
	return total.limit_length(1.0)

func active_pointer_count() -> int:
	return _pointers.size()

func clear() -> void:
	if _pointers.is_empty():
		return
	_pointers.clear()
	_changed()

## Region under a local point: the middle cell of each edge of a 3x3 grid.
func region_at(local: Vector2) -> String:
	if size.x <= 0 or size.y <= 0 or not Rect2(Vector2.ZERO, size).has_point(local):
		return ""
	var column := clampi(int(local.x / (size.x / 3.0)), 0, 2)
	var row := clampi(int(local.y / (size.y / 3.0)), 0, 2)
	if column == 1 and row == 0: return "up"
	if column == 1 and row == 2: return "down"
	if column == 0 and row == 1: return "left"
	if column == 2 and row == 1: return "right"
	return ""

## Returns true when the event belonged to this pad.
func handle_pointer_event(event: InputEvent) -> bool:
	if not is_visible_in_tree():
		return false
	if event is InputEventScreenTouch:
		var touch := event as InputEventScreenTouch
		if touch.pressed and not touch.canceled:
			return _press(touch.index, _local(touch.position))
		return _release(touch.index)
	if event is InputEventScreenDrag:
		var drag := event as InputEventScreenDrag
		return _move(drag.index, _local(drag.position))
	if event is InputEventMouseButton:
		var button := event as InputEventMouseButton
		if button.device == InputEvent.DEVICE_ID_EMULATION or button.button_index != MOUSE_BUTTON_LEFT:
			return false
		if button.pressed:
			return _press(MOUSE_POINTER, _local(button.position))
		return _release(MOUSE_POINTER)
	if event is InputEventMouseMotion:
		var motion := event as InputEventMouseMotion
		if motion.device == InputEvent.DEVICE_ID_EMULATION:
			return false
		return _move(MOUSE_POINTER, _local(motion.position))
	return false

func _input(event: InputEvent) -> void:
	var was_press: bool = (event is InputEventScreenTouch and event.pressed) or (event is InputEventMouseButton and event.pressed)
	if handle_pointer_event(event) and was_press:
		get_viewport().set_input_as_handled()

func _notification(what: int) -> void:
	match what:
		NOTIFICATION_EXIT_TREE, NOTIFICATION_APPLICATION_FOCUS_OUT, NOTIFICATION_APPLICATION_PAUSED:
			clear()
		NOTIFICATION_VISIBILITY_CHANGED:
			if not is_visible_in_tree():
				clear()

func _local(position: Vector2) -> Vector2:
	return get_global_transform_with_canvas().affine_inverse() * position

func _press(id: int, local: Vector2) -> bool:
	var region := region_at(local)
	if region.is_empty() or (not _pointers.has(id) and _pointers.size() >= MAX_POINTERS):
		return false
	_pointers[id] = region
	_changed()
	return true

func _move(id: int, local: Vector2) -> bool:
	if not _pointers.has(id):
		return false
	var region := region_at(local)
	if region.is_empty():
		# Sliding off a direction releases it; returning requires a new press.
		_pointers.erase(id)
	elif _pointers[id] == region:
		return true
	else:
		_pointers[id] = region
	_changed()
	return true

func _release(id: int) -> bool:
	if not _pointers.has(id):
		return false
	_pointers.erase(id)
	_changed()
	return true

func _changed() -> void:
	queue_redraw()
	direction_changed.emit(direction())

func _draw() -> void:
	var cell := size / 3.0
	var active: Array = _pointers.values()
	for region in DIRECTIONS:
		var offset: Vector2 = (DIRECTIONS[region] + Vector2.ONE) * cell
		var rect := Rect2(offset, cell).grow(-4)
		draw_rect(rect, Color(0.95, 0.75, 0.25, 0.9) if region in active else Color(0.35, 0.42, 0.55, 0.85))
		var arrow: Vector2 = DIRECTIONS[region]
		var center := rect.get_center()
		var tip := center + arrow * cell.x * 0.25
		var side := Vector2(-arrow.y, arrow.x) * cell.x * 0.18
		draw_colored_polygon(PackedVector2Array([tip, center - arrow * cell.x * 0.1 + side, center - arrow * cell.x * 0.1 - side]), Color(0.08, 0.10, 0.14, 0.9))
