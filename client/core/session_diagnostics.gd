extends RefCounted
## Numeric local observations only. No identifiers, payloads, files or upload.
const LIMIT := 120
const EVENTS := ["send_attempt", "send_completed", "snapshot_received", "snapshot_consumed"]
var enabled := false
var _samples: Dictionary = {}
var _counts: Dictionary = {}
var _ack: Dictionary = {}
var _receipts: Array = []
var _command_results: Array = []

func set_enabled(value: bool) -> void:
	enabled = value
	reset()

func reset() -> void:
	_samples.clear()
	_counts.clear()
	_ack.clear()
	_receipts.clear()
	_command_results.clear()

func observe_command_results(values: Array) -> void:
	if not enabled: return
	_command_results.clear()
	var statuses := ["applied", "expired", "rejected_full", "rejected_stale", "rejected_future", "rejected_not_playing", "rejected_round", "rejected_old_seq", "cancelled_round", "rejected_rate"]
	for item in values.slice(-32):
		if not item is Dictionary or item.get("status") not in statuses: continue
		var valid := true
		for key in ["seq", "round_id", "tick"]:
			var value: Variant = item.get(key)
			valid = valid and typeof(value) in [TYPE_INT, TYPE_FLOAT] and is_finite(float(value)) and float(value) >= 0 and float(value) <= 9007199254740991.0 and float(value) == floor(float(value))
		if valid:
			# Numeric enum only in diagnostics; Session offers named statuses.
			_command_results.append({"seq": int(item.seq), "round_id": int(item.round_id), "tick": int(item.tick), "status_code": statuses.find(item.status)})

func record(event: String, bytes: int, now_msec: int) -> void:
	if not enabled or event not in EVENTS: return
	if not _samples.has(event): _samples[event] = []
	_counts[event] = int(_counts.get(event, 0)) + 1
	_samples[event].append({"at": now_msec, "bytes": maxi(0, bytes)})
	if _samples[event].size() > LIMIT: _samples[event].pop_front()

func observe_input_ack(player: Dictionary) -> void:
	if not enabled: return
	for field in ["accepted_input_seq", "accepted_input_tick", "applied_input_seq", "applied_input_tick"]:
		var value: Variant = player.get(field)
		if typeof(value) in [TYPE_INT, TYPE_FLOAT] and is_finite(float(value)) and float(value) >= -1 and float(value) <= 9007199254740991.0 and float(value) == floor(float(value)):
			_ack[field] = int(value)

func observe_receipts(values: Variant) -> void:
	if not enabled: return
	_receipts.clear()
	if not values is Array: return
	for value in values.slice(-16):
		if not value is Dictionary or value.get("kind") not in ["state", "command"]: continue
		if typeof(value.get("seq")) not in [TYPE_INT, TYPE_FLOAT] or typeof(value.get("tick")) not in [TYPE_INT, TYPE_FLOAT]: continue
		if not is_finite(float(value.seq)) or not is_finite(float(value.tick)): continue
		if float(value.seq) < 0 or float(value.tick) < 0 or float(value.seq) > 9007199254740991.0 or float(value.tick) > 9007199254740991.0: continue
		if float(value.seq) != floor(float(value.seq)) or float(value.tick) != floor(float(value.tick)): continue
		_receipts.append({"seq": int(value.seq), "tick": int(value.tick), "kind": value.kind})

func summary(now_msec: int) -> Dictionary:
	if not enabled: return {"enabled": false}
	var result := {"enabled": true, "rtt_ms": null, "server_consume_delay_ms": null, "observed_input_ack": _ack.duplicate(), "exact_input_receipts": _receipts.duplicate(true), "ack_semantics": "highest_observed_not_cumulative", "missing_reason": "RTT and server consume delay have no same-clock round trip measurement"}
	result.command_results = _command_results.duplicate(true)
	for event in EVENTS:
		var samples: Array = _samples.get(event, [])
		var total_bytes := 0
		var interval_total := 0
		var interval_max := 0
		for index in range(1, samples.size()):
			var interval := int(samples[index].at) - int(samples[index - 1].at)
			interval_total += interval
			interval_max = maxi(interval_max, interval)
		for item in samples: total_bytes += int(item.bytes)
		result[event] = {"count": int(_counts.get(event, 0)), "window_samples": samples.size(), "window_interval_mean_ms": float(interval_total) / (samples.size() - 1) if samples.size() > 1 else null, "window_interval_max_ms": interval_max if samples.size() > 1 else null, "window_bytes": total_bytes,
			"last_age_ms": maxi(0, now_msec - int(samples[-1].at)) if not samples.is_empty() else null,
			"last_interval_ms": int(samples[-1].at) - int(samples[-2].at) if samples.size() > 1 else null}
	return result
