extends Label
## Test-only, read-only stage guide for the isolated acceptance package. It reads
## existing Session state (connected/busy/match_id/authoritative snapshot) and the
## acceptance lifecycle, and never calls Session, sends input or changes rounds.
## Text is fixed per state; no ids, names, keys, tokens, raw snapshots or errors.
const PHASES := ["lobby", "countdown", "playing", "results"]
const POLL_SECONDS := 0.2
const TEXTS := {
	"login": "登录：设备游客，无需账号密码，连接信息已预置，直接点“登录”。",
	"connecting": "正在连接测试服务器，请稍候……",
	"after_background": "刚才切到后台，已退出会话。请手动重新登录，再重新加入房间；原局不会恢复。",
	"after_disconnect": "会话已结束（断开或注销），不是正常结算。请重新登录并重新加入房间；原局不会恢复。",
	"background": "已切到后台：本机已退出会话。返回后需手动重新登录、加入房间，不恢复原局。",
	"lobby": "大厅：一端创建房间，另一端刷新后加入同一房间。",
	"entering": "正在进入房间，请稍候……",
	"room_failed": "房间异常结束（不是正常结算），已回到大厅，可重新创建或加入。",
	"syncing": "正在同步房间状态……",
	"ready_needed": "第%d局：两端都点“准备”，然后由房主点“开始”。",
	"waiting_peer": "第%d局：你已准备，等待另一端准备。",
	"host_start": "第%d局：全部已准备，请房主点“开始”。",
	"waiting_host": "第%d局：全部已准备，等待房主点“开始”。",
	"countdown": "第%d局即将开始：服务端倒计时中，请稍候。",
	"playing": "第%d局进行中：方向键或屏幕方向盘移动，“计数 +1”加分。本验收包每局约12秒，结束自动进入服务端结算。",
	"results": "第%d局正常结束（服务端结算，不是掉线）。房主开启下一局后，两端重新准备。",
}
var session: Node = null
var main: Node = null
var lifecycle: Node = null
var state_key := ""
var text_updates := 0
var _logout_reason := ""
var _room_failed := false
var _connections: Array = []
var _elapsed := 0.0
var _released := false

func _ready() -> void:
	name = "AcceptanceGuide"
	autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	max_lines_visible = 3
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_theme_font_size_override("font_size", 16)

func setup(session_node: Node, main_node: Node, lifecycle_node: Node) -> void:
	session = session_node
	main = main_node
	lifecycle = lifecycle_node
	if session != null:
		_listen(session.authenticated, _on_authenticated)
		_listen(session.logged_out, _on_logged_out)
		_listen(session.joined, _on_joined)
		_listen(session.left, refresh)
		_listen(session.snapshot_received, _on_snapshot)
		_listen(session.connection_changed, _on_connection_changed)
		_listen(session.room_failed, _on_room_failed)
	if lifecycle != null:
		_listen(lifecycle.background_entered, _on_lifecycle)
		_listen(lifecycle.foreground_returned, _on_lifecycle)
	refresh()

func connection_count() -> int:
	return _connections.size()

## Pure mapping from fixed facts to a state key. Rooms use only a valid current
## snapshot: without one there is no round number and no phase text.
static func describe(facts: Dictionary) -> String:
	if facts.get("background") == true:
		return "background"
	if facts.get("connected") != true:
		if facts.get("busy") == true:
			return "connecting"
		if facts.get("logout_reason") == "background":
			return "after_background"
		if facts.get("logout_reason") == "disconnect":
			return "after_disconnect"
		return "login"
	if facts.get("in_room") != true:
		if facts.get("busy") == true:
			return "entering"
		return "room_failed" if facts.get("room_failed") == true else "lobby"
	var phase: Variant = facts.get("phase")
	if not (phase in PHASES) or not _round(facts.get("round")):
		return "syncing"
	if phase != "lobby":
		return phase
	if facts.get("self_ready") != true:
		return "ready_needed"
	if facts.get("all_ready") != true:
		return "waiting_peer"
	return "host_start" if facts.get("is_host") == true else "waiting_host"

static func text_for(key: String, round_id: Variant) -> String:
	var template: String = TEXTS.get(key, TEXTS.syncing)
	return template % int(round_id) if template.contains("%d") else template

static func _round(value: Variant) -> bool:
	return (value is int or value is float) and is_finite(float(value)) and float(value) >= 1 and float(value) == floor(float(value)) and float(value) <= 2147483647

## Reads only existing Session fields; identity values are compared, never kept.
func facts() -> Dictionary:
	var result := {"background": lifecycle != null and lifecycle.hidden == true, "logout_reason": _logout_reason, "room_failed": _room_failed}
	if session == null:
		return result
	result.connected = session.connected == true
	result.busy = session.busy == true
	result.in_room = not str(session.match_id).is_empty()
	var snapshot: Variant = session.snapshot
	if result.in_room and snapshot is Dictionary and not snapshot.is_empty():
		result.phase = snapshot.get("phase")
		result.round = snapshot.get("round_id")
		var own_id: String = session.user_id()
		var all_ready := true
		var connected_players := 0
		for player in snapshot.get("players", []) if snapshot.get("players") is Array else []:
			if not player is Dictionary or player.get("connected") != true:
				continue
			connected_players += 1
			all_ready = all_ready and player.get("ready") == true
			if not own_id.is_empty() and player.get("user_id") == own_id:
				result.self_ready = player.get("ready") == true
		result.all_ready = all_ready and connected_players >= 2
		result.is_host = not own_id.is_empty() and snapshot.get("host_id") == own_id
	return result

func refresh(_unused: Variant = null) -> void:
	if _released:
		return
	var current := facts()
	var key := describe(current)
	var next := text_for(key, current.get("round", 0))
	state_key = key
	if next != text:
		text = next
		text_updates += 1

func release() -> void:
	if _released:
		return
	_released = true
	for connection in _connections:
		if connection.signal_ref.is_connected(connection.callable):
			connection.signal_ref.disconnect(connection.callable)
	_connections.clear()
	session = null
	main = null
	lifecycle = null
	set_process(false)

func _listen(signal_ref: Signal, callable: Callable) -> void:
	if not signal_ref.is_connected(callable):
		signal_ref.connect(callable)
		_connections.append({"signal_ref": signal_ref, "callable": callable})

func _process(delta: float) -> void:
	# Busy has no signal: a bounded poll updates text only when the state changes.
	_elapsed += delta
	if _elapsed >= POLL_SECONDS:
		_elapsed = 0.0
		refresh()

func _on_authenticated() -> void:
	_logout_reason = ""
	_room_failed = false
	refresh()

func _on_logged_out() -> void:
	_logout_reason = "background" if lifecycle != null and lifecycle.hidden == true else "disconnect"
	_room_failed = false
	refresh()

func _on_joined() -> void:
	_room_failed = false
	refresh()

func _on_snapshot(_snapshot: Dictionary) -> void:
	refresh()

func _on_connection_changed(_online: bool) -> void:
	refresh()

func _on_room_failed(_category: String) -> void:
	_room_failed = true
	refresh()

func _on_lifecycle(_source: String) -> void:
	refresh()

func _exit_tree() -> void:
	release()
