extends GameModule
## Isolated test view. Never registered or packaged by production.
var text: Label
var poses: Dictionary = {}
var test_direction := Vector2.ZERO
var _order: Array[String] = []

func _ready() -> void:
	continuous_input = true
	enable_timeline(117, 33)
	diagnostics_enabled = _transport().diagnostics.enabled
	custom_minimum_size.y = 250
	var box := VBoxContainer.new()
	add_child(box)
	text = Label.new()
	box.add_child(text)
	var button := Button.new()
	button.name = "Pulse"
	button.text = "测试计数 +1（服务端决定结果）；方向键移动"
	button.pressed.connect(func(): _transport().submit_input({"pulse": true}))
	box.add_child(button)

func apply_snapshot(data: Dictionary) -> void:
	super.apply_snapshot(data)
	_order.clear()
	var counts: PackedStringArray = []
	for player in data.get("players", []):
		_order.append(str(player.user_id))
		counts.append("%s: %s" % [player.get("username", "玩家"), player.get("score", 0)])
	text.text = "服务端计数：" + ", ".join(counts)

func collect_input() -> Dictionary:
	var direction := test_direction + Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down")
	direction = direction.limit_length(1.0)
	return {"direction": {"x": direction.x, "y": direction.y}}

func _process(delta: float) -> void:
	poses = sample_presentation(delta)
	queue_redraw()

func _draw() -> void:
	for index in range(mini(2, _order.size())):
		var id := _order[index]
		if not poses.has(id): continue
		var at: Vector2 = poses[id].position
		draw_rect(Rect2(at + Vector2(30, 120), Vector2(20, 20)), Color.CORNFLOWER_BLUE if index == 0 else Color.ORANGE)

func release() -> void:
	poses.clear()
	_order.clear()
	super.release()

func set_test_direction(value: Vector2) -> void:
	test_direction = value.limit_length(1.0)

func click_pulse() -> void:
	_transport().submit_input({"pulse": true})

func _transport() -> Node:
	return get_node("/root/Session")
