extends RefCounted
## Generic optional 2D presentation only: server tick time, bounded history, no physics/prediction.
## The clock offset is an observed arrival offset, not synchronized server time
## or a network latency estimate. Playback includes that unknown one-way delay.
const MAX_SNAPSHOTS := 32
const MAX_CLOCK_SAMPLES := 64
const MAX_PLAYERS := 8
const JITTER_RESERVE_SECONDS := 0.050
const RESET_GAP_SECONDS := 0.500
const MAX_CATCHUP_GAP_SECONDS := 0.250
const CLOCK_SLEW := 0.02
const RECOVERY_RATE := 1.20
const RECOVERY_LIMIT_SECONDS := 0.750
var sim_hz: float = 30.0
var snapshot_hz: float = 10.0
var delay_seconds: float = 0.150
var frames: Array = []
var arrival_offsets: Array[float] = []
var render_time_seconds: float = 0.0
var presented_time_seconds: Variant = null
var last_server_tick: int = -1
var underrun_frames: int = 0
var late_snapshot_drops: int = 0
var discontinuities: int = 0
var extrapolated_frames: int = 0
var state: String = "empty"
var _scope: String = ""
var _round: int = -1
var _phase: String = ""
var _clock_offset: float = 0.0
var _last_sample_seconds: float = -1.0
var _last_receive_seconds: float = -1.0
var _playhead_ready: bool = false
var _delay_override_ms: Variant = null
var _extrapolation_ms: float = 0.0
var playback_rate: float = 0.0
var recovery_age_ms: float = 0.0
var recovery_debt_ms: float = 0.0
var correction_this_sample: bool = false
var _underrun_debt: bool = false
var _recovery_started_seconds: float = -1.0
var _pending_correction: bool = false
var _clock_offset_decreased: bool = false
var underrun_reanchor_seconds: float = 0.350
var clock_reanchors: int = 0
var _underrun_started_seconds: float = -1.0
var _rebuffering: bool = false

## A sustained delivery-offset increase trades a short explicit rebuffer for
## seconds of repeated underrun. This is an arrival anchor, never RTT.
func configure_recovery(underrun_ms: float = 350.0) -> bool:
	if not is_finite(underrun_ms) or underrun_ms < 100 or underrun_ms > 1000:
		return false
	underrun_reanchor_seconds = underrun_ms / 1000.0
	return true

func configure(delay_ms: float, extrapolation_ms: float = 0.0) -> bool:
	if not is_finite(delay_ms) or delay_ms < 0 or delay_ms > 500 or not is_finite(extrapolation_ms) or extrapolation_ms < 0:
		return false
	_delay_override_ms = delay_ms
	_extrapolation_ms = minf(extrapolation_ms, 1000.0 / sim_hz)
	delay_seconds = delay_ms / 1000.0
	return true

func reset() -> void:
	frames.clear()
	arrival_offsets.clear()
	render_time_seconds = 0.0
	presented_time_seconds = null
	last_server_tick = -1
	underrun_frames = 0
	late_snapshot_drops = 0
	discontinuities = 0
	extrapolated_frames = 0
	state = "empty"
	_scope = ""
	_round = -1
	_phase = ""
	_clock_offset = 0.0
	_last_sample_seconds = -1.0
	_last_receive_seconds = -1.0
	_playhead_ready = false
	playback_rate = 0.0
	recovery_age_ms = 0.0
	recovery_debt_ms = 0.0
	correction_this_sample = false
	_underrun_debt = false
	_recovery_started_seconds = -1.0
	_pending_correction = false
	_clock_offset_decreased = false
	clock_reanchors = 0
	_underrun_started_seconds = -1.0
	_rebuffering = false

static func _number(value: Variant) -> bool:
	return (value is int or value is float) and is_finite(float(value))

func push_snapshot(snapshot: Dictionary, receive_seconds: float, match_scope: String) -> bool:
	if not is_finite(receive_seconds) or not _number(snapshot.get("tick")) or not _number(snapshot.get("round_id")):
		return false
	if _scope == match_scope and _last_receive_seconds >= 0 and receive_seconds < _last_receive_seconds:
		return false
	if float(snapshot.tick) > 9007199254740991.0 or float(snapshot.round_id) > 9007199254740991.0:
		return false
	var tick := int(snapshot.tick)
	if tick < 0 or float(tick) != float(snapshot.tick):
		return false
	var round_id := int(snapshot.round_id)
	if float(round_id) != float(snapshot.round_id) or round_id < 0:
		return false
	var phase := str(snapshot.get("phase", ""))
	var phases := ["lobby", "countdown", "playing", "results"]
	if phase not in phases:
		return false
	if _scope == match_scope and _round == round_id and phases.find(phase) < phases.find(_phase):
		late_snapshot_drops += 1
		return false
	if _scope == match_scope and _round > round_id:
		late_snapshot_drops += 1
		return false
	if _scope == match_scope and _round == round_id and tick <= last_server_tick:
		late_snapshot_drops += 1
		return false
	var next_sim := float(snapshot.get("tick_rate", 30)) if _number(snapshot.get("tick_rate", 30)) else 30.0
	var next_snapshot := float(snapshot.get("snapshot_rate", 10)) if _number(snapshot.get("snapshot_rate", 10)) else 10.0
	if next_sim < 1 or next_sim > 120 or next_snapshot < 1 or next_snapshot > next_sim:
		return false
	if _scope != match_scope or _round != round_id or _phase != phase or sim_hz != next_sim or snapshot_hz != next_snapshot:
		reset()
		_scope = match_scope
		_round = round_id
		_phase = phase
		sim_hz = next_sim
		snapshot_hz = next_snapshot
		# ceil matters: 20 Hz / 30 Hz simulation has 33/67 ms source gaps.
		delay_seconds = float(_delay_override_ms) / 1000.0 if _delay_override_ms != null else ceil(sim_hz / snapshot_hz) / sim_hz + JITTER_RESERVE_SECONDS
		_extrapolation_ms = minf(_extrapolation_ms, 1000.0 / sim_hz)
	if tick <= last_server_tick:
		late_snapshot_drops += 1
		return false
	var poses: Dictionary = {}
	var source_players: Variant = snapshot.get("players", [])
	if not source_players is Array:
		return false
	for player in source_players.slice(0, MAX_PLAYERS):
		if not player is Dictionary or not player.get("user_id") is String:
			continue
		var position: Variant = player.get("position", {})
		var motion: Variant = player.get("velocity", {})
		if not position is Dictionary or not _number(position.get("x")) or not _number(position.get("y")):
			continue
		var velocity := Vector2.ZERO
		if phase == "playing" and player.get("stationary", false) != true and motion is Dictionary and _number(motion.get("x")) and _number(motion.get("y")):
			velocity = Vector2(float(motion.x), float(motion.y))
		poses[str(player.user_id)] = {"position": Vector2(float(position.x), float(position.y)), "angle": float(player.get("angle", 0.0)) if _number(player.get("angle", 0.0)) else 0.0, "velocity": velocity}
	var source_time := float(tick) / sim_hz
	var source_gap := source_time - float(last_server_tick) / sim_hz if last_server_tick >= 0 else 0.0
	var receive_gap := receive_seconds - _last_receive_seconds if _last_receive_seconds >= 0 else 0.0
	if source_gap > RESET_GAP_SECONDS or receive_gap > RESET_GAP_SECONDS:
		# A long interruption cannot be concealed by unbounded extrapolation or
		# a long fast-forward. Explicitly rebuffer and count the discontinuity.
		frames.clear()
		# Keep the bounded clock observations: a delayed first TCP batch is
		# not evidence that the source clock acquired that extra latency.
		_playhead_ready = false
		_pending_correction = presented_time_seconds != null
		_recovery_started_seconds = -1.0
		_underrun_debt = false
		discontinuities += 1
	arrival_offsets.append(receive_seconds - source_time)
	if arrival_offsets.size() > MAX_CLOCK_SAMPLES:
		arrival_offsets.pop_front()
	var observed_offset: float = arrival_offsets.min()
	if _playhead_ready and observed_offset < _clock_offset - 0.000001:
		_clock_offset_decreased = true
	_clock_offset = observed_offset
	frames.append({"time": source_time, "poses": poses})
	while frames.size() > MAX_SNAPSHOTS:
		frames.pop_front()
	last_server_tick = tick
	_last_receive_seconds = receive_seconds
	return true

func sample(now_seconds: float) -> Dictionary:
	correction_this_sample = false
	if frames.is_empty() or not is_finite(now_seconds):
		state = "empty"
		return {}
	if _underrun_started_seconds >= 0 and now_seconds - _underrun_started_seconds >= underrun_reanchor_seconds and _last_receive_seconds >= 0:
		var latest_offset := _last_receive_seconds - float(last_server_tick) / sim_hz
		if latest_offset > _clock_offset + 1.0 / sim_hz:
			# Forget the old low offset only after sustained starvation. A TCP
			# batch can temporarily overestimate the anchor; later lower samples
			# recover through the existing bounded rate/correction path.
			arrival_offsets.assign([latest_offset])
			_clock_offset = latest_offset
			_rebuffering = true
			_playhead_ready = false
			_pending_correction = true
			_recovery_started_seconds = -1.0
			_underrun_debt = false
			clock_reanchors += 1
			discontinuities += 1
		_underrun_started_seconds = -1.0
	var desired := now_seconds - _clock_offset - delay_seconds
	var oldest := float(frames[0].time)
	var newest := float(frames[-1].time)
	var allowed := _extrapolation_ms / 1000.0
	var elapsed := maxf(0, now_seconds - _last_sample_seconds) if _last_sample_seconds >= 0 else 0.0
	var delta := minf(elapsed, 0.250)
	var previous_time := render_time_seconds
	var previous_presented: Variant = presented_time_seconds
	var continuous_time := render_time_seconds
	if _rebuffering and previous_presented != null and desired < float(previous_presented):
		# Hold the last displayed source pose; never rewind already shown time.
		state = "buffering"
		_last_sample_seconds = now_seconds
		playback_rate = 0.0
		recovery_age_ms = 0.0
		recovery_debt_ms = 0.0
		if float(previous_presented) > newest:
			# Recreate the same bounded extrapolation, rather than snapping to
			# the latest authority while the displayed source time stays fixed.
			return _extrapolated_poses(clampf(float(previous_presented) - newest, 0.0, allowed))
		return _poses_at(float(previous_presented))
	_rebuffering = false
	if not _playhead_ready:
		render_time_seconds = maxf(desired, float(previous_presented)) if previous_presented != null else desired
		correction_this_sample = _pending_correction
		_pending_correction = false
		_playhead_ready = true
	else:
		var advanced := render_time_seconds + delta
		# Observed-clock drift and lost playback during an underrun are distinct.
		# Only the latter may use the bounded recovery rate below.
		render_time_seconds = advanced + clampf(desired - advanced, -delta * CLOCK_SLEW, delta * CLOCK_SLEW)
		var available_goal := minf(desired, newest + allowed)
		# A material delivery-latency decrease can reveal old playback debt
		# without any prior underrun. Require both a falling observed offset
		# and >one simulation tick of debt already covered by received data.
		# Ordinary small clock drift still uses only the +/-2% path above.
		var clock_recovery_due := _clock_offset_decreased and available_goal - render_time_seconds > 1.0 / sim_hz + 0.000001
		if (_underrun_debt or clock_recovery_due) and _recovery_started_seconds < 0 and available_goal - render_time_seconds > 0.000001:
			_recovery_started_seconds = now_seconds
		if _recovery_started_seconds >= 0:
			var age := now_seconds - _recovery_started_seconds
			render_time_seconds = maxf(previous_time, minf(available_goal, previous_time + delta * RECOVERY_RATE))
			continuous_time = render_time_seconds
			if age >= RECOVERY_LIMIT_SECONDS:
				if available_goal > render_time_seconds + 0.000001:
					render_time_seconds = available_goal
					correction_this_sample = true
					discontinuities += 1
				_recovery_started_seconds = -1.0
				_underrun_debt = false
			elif desired - render_time_seconds <= 0.000001:
				_recovery_started_seconds = -1.0
				_underrun_debt = false
		elif elapsed > 0.250 and minf(desired, newest) - render_time_seconds > MAX_CATCHUP_GAP_SECONDS:
			# A long render callback gap is itself a visible discontinuity.
			# This does not reclassify an ordinary arrival-clock change as debt.
			continuous_time = render_time_seconds
			render_time_seconds = maxf(previous_time, minf(desired, newest))
			correction_this_sample = true
			discontinuities += 1
		else:
			continuous_time = render_time_seconds
	_last_sample_seconds = now_seconds
	_clock_offset_decreased = false
	if previous_presented != null and oldest > float(previous_presented) + delta * RECOVERY_RATE + 0.000001 and render_time_seconds < oldest:
		# History eviction cannot silently jump the displayed source time.
		render_time_seconds = oldest
		if not correction_this_sample:
			discontinuities += 1
		correction_this_sample = true
	playback_rate = clampf((continuous_time - previous_time) / delta, 0, RECOVERY_RATE) if delta > 0 else 0.0
	recovery_age_ms = maxf(0, now_seconds - _recovery_started_seconds) * 1000.0 if _recovery_started_seconds >= 0 else 0.0
	if render_time_seconds < oldest:
		state = "buffering"
		presented_time_seconds = oldest
		playback_rate = 0.0
		recovery_debt_ms = maxf(0, desired - render_time_seconds) * 1000.0
		return frames[0].poses.duplicate(true)
	if render_time_seconds > newest + 0.000001:
		var requested := render_time_seconds - newest
		if requested > allowed + 0.000001:
			render_time_seconds = newest + allowed
			state = "underrun"
			underrun_frames += 1
			_underrun_debt = true
			if _underrun_started_seconds < 0:
				_underrun_started_seconds = now_seconds
		else:
			state = "extrapolating"
			extrapolated_frames += 1
		presented_time_seconds = newest + minf(requested, allowed)
		if not correction_this_sample and previous_presented != null and delta > 0:
			playback_rate = clampf((float(presented_time_seconds) - float(previous_presented)) / delta, 0, RECOVERY_RATE)
		recovery_debt_ms = maxf(0, desired - render_time_seconds) * 1000.0
		return _extrapolated_poses(minf(requested, allowed))
	state = "interpolating"
	# A fresh packet can give one interpolating frame while the old min clock
	# still leaves no reserve. That frame must not restart the starvation timer.
	if _last_receive_seconds - float(last_server_tick) / sim_hz <= _clock_offset + 1.0 / sim_hz:
		_underrun_started_seconds = -1.0
	presented_time_seconds = render_time_seconds
	recovery_debt_ms = maxf(0, desired - render_time_seconds) * 1000.0
	return _poses_at(render_time_seconds)

func _poses_at(at_seconds: float) -> Dictionary:
	if at_seconds <= float(frames[0].time): return frames[0].poses.duplicate(true)
	for i in range(1, frames.size()):
		var upper: Dictionary = frames[i]
		if float(upper.time) + 0.000001 < at_seconds:
			continue
		var lower: Dictionary = frames[i - 1]
		var alpha := clampf((at_seconds - float(lower.time)) / (float(upper.time) - float(lower.time)), 0, 1)
		var result: Dictionary = {}
		for id in upper.poses:
			var end: Dictionary = upper.poses[id]
			if lower.poses.has(id):
				var start: Dictionary = lower.poses[id]
				result[id] = {"position": (start.position as Vector2).lerp(end.position, alpha), "angle": lerp_angle(float(start.angle), float(end.angle), alpha), "velocity": (start.velocity as Vector2).lerp(end.velocity, alpha)}
			else:
				result[id] = end.duplicate(true)
		return result
	return frames[-1].poses.duplicate(true)

func _extrapolated_poses(seconds: float) -> Dictionary:
	if seconds <= 0:
		return frames[-1].poses.duplicate(true)
	var result: Dictionary = {}
	for id in frames[-1].poses:
		var pose: Dictionary = frames[-1].poses[id]
		# A maximum of one simulation tick of authoritative velocity only.
		# No local input, steering guess, collision solver or input ACK claim.
		result[id] = {"position": pose.position + pose.velocity * seconds, "angle": pose.angle, "velocity": pose.velocity}
	return result

func summary() -> Dictionary:
	return {"clock_reanchors": clock_reanchors, "underrun_reanchor_ms": underrun_reanchor_seconds * 1000.0, "sim_hz": sim_hz if last_server_tick >= 0 else null, "snapshot_hz": snapshot_hz if last_server_tick >= 0 else null, "interpolation_delay_ms": delay_seconds * 1000.0, "extrapolation_limit_ms": _extrapolation_ms, "buffer_samples": frames.size(), "buffer_depth_ms": (float(frames[-1].time) - float(frames[0].time)) * 1000.0 if frames.size() > 1 else 0.0, "underrun_frames": underrun_frames, "extrapolated_frames": extrapolated_frames, "late_snapshot_drops": late_snapshot_drops, "timeline_resets": discontinuities, "render_tick": float(presented_time_seconds) * sim_hz if presented_time_seconds != null else null, "latest_snapshot_tick": last_server_tick if last_server_tick >= 0 else null, "latest_snapshot_render_gap_ms": (float(last_server_tick) / sim_hz - float(presented_time_seconds)) * 1000.0 if presented_time_seconds != null else null, "playback_rate": playback_rate if presented_time_seconds != null else null, "recovery_age_ms": recovery_age_ms if presented_time_seconds != null else null, "recovery_debt_ms": recovery_debt_ms if presented_time_seconds != null else null, "presentation_state": state}
