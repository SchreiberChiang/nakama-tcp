class_name GameModule
extends Control
## Created only during playing; all authority remains on the server.
signal exit_requested
var continuous_input := false
var local_user_id := ""
var latest_snapshot: Dictionary = {}
var timeline: RefCounted
var diagnostics_enabled := false
var _frame_intervals: Array[float] = []
var _sample_costs: Array[int] = []
var _receive_msec := -1
var _presentation_scope := ""

func configure(id: String) -> void:
	local_user_id = id

func set_presentation_scope(scope: String) -> void:
	_presentation_scope = scope

## Opt-in: a module chooses its own units and mapping to position/velocity.
func enable_timeline(delay_ms: float = 117.0, extrapolation_ms: float = 0.0) -> bool:
	var candidate = preload("res://core/snapshot_timeline.gd").new()
	if not candidate.configure(delay_ms, extrapolation_ms): return false
	timeline = candidate
	return true

func apply_snapshot(data: Dictionary) -> void:
	latest_snapshot = data.duplicate(true)
	_receive_msec = Time.get_ticks_msec()
	if timeline != null:
		timeline.push_snapshot(data, float(_receive_msec) / 1000.0, _presentation_scope)

func sample_presentation(delta: float) -> Dictionary:
	if timeline == null: return {}
	var started := Time.get_ticks_usec()
	var poses: Dictionary = timeline.sample(float(started) / 1000000.0)
	if diagnostics_enabled:
		_frame_intervals.append(maxf(0, delta) * 1000.0)
		_sample_costs.append(Time.get_ticks_usec() - started)
		if _frame_intervals.size() > 120: _frame_intervals.pop_front()
		if _sample_costs.size() > 120: _sample_costs.pop_front()
	return poses

func presentation_diagnostics() -> Dictionary:
	if not diagnostics_enabled: return {"enabled": false}
	return {"enabled": true, "snapshot_receive_age_ms": Time.get_ticks_msec() - _receive_msec if _receive_msec >= 0 else null,
		"frame_callback_interval_ms": _frame_intervals[-1] if not _frame_intervals.is_empty() else null,
		"sample_cpu_usec": _sample_costs[-1] if not _sample_costs.is_empty() else null,
		"gpu_ms": null, "gpu_missing_reason": "No GPU timing source is installed", "timeline": timeline.summary() if timeline != null else {}}

func collect_input() -> Dictionary:
	return {}

func release() -> void:
	if timeline != null: timeline.reset()
	timeline = null
	latest_snapshot = {}
	_frame_intervals.clear()
	_sample_costs.clear()
	_receive_msec = -1
	_presentation_scope = ""
	set_process(false)
