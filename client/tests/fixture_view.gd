extends GameModule
## Loaded explicitly by the test runner only. Excluded from the production PCK.
var text: Label

func _ready() -> void:
	var box := VBoxContainer.new()
	add_child(box)
	text = Label.new()
	box.add_child(text)
	var button := Button.new()
	button.name = "Pulse"
	button.text = "测试计数 +1（服务端决定结果）"
	button.pressed.connect(func(): Session.submit_input({"pulse": true}))
	box.add_child(button)

func apply_snapshot(data: Dictionary) -> void:
	super.apply_snapshot(data)
	text.text = "本局计数：" + str(data.get("players", []))
