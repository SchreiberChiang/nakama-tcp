interface Member extends ChatMember {
  presence: nkruntime.Presence;
  name: string;
  ready: boolean;
  staying: boolean;
  seq: number;
  acceptedTick: number;
  appliedSeq: number;
  appliedTick: number;
  receipts: { seq: number; tick: number; kind: string }[];
  commandResults: { seq: number; round_id: number; tick: number; status: string }[];
  projectionFailures: number;
  projectionErrorTick: number;
  commands: QueuedInput[];
  continuous: QueuedInput | null;
  continuousFresh: boolean;
  diagnostics: any;
  window: number;
  inputs: number;
  controls: number;
  strikes: number;
  selection: any;
  requestErrorTick?: number;
  requestLogTicks?: { [category: string]: number };
}
interface RoomState extends ChatRoomState {
  game_id: string;
  options: any;
  name: string;
  host_id: string;
  capacity: number;
  host_change: {
    seq: number;
    reason: string;
    previous_host_id: string;
    host_id: string;
  };
  phase: string;
  members: { [id: string]: Member };
  // Join order. Nakama hands match state through Go maps between ticks, so
  // object key order is not stable; arrays keep their order.
  order: string[];
  pending: { [id: string]: { sessionId: string; expires: number } };
  game: any;
  countdown: number;
  roundStart: number;
  emptyTicks: number;
  tick: number;
  round_id: number;
  results: any[];
  diagnosticsEnabled: boolean;
  snapshotRate: number;
  snapshotAccumulator: number;
  inputWindow: number;
  stateTimeout: number;
}
function configuredTicks(ctx: nkruntime.Context, key: string, fallback: number): number {
  var raw = ctx.env && ctx.env[key], value = raw === undefined ? fallback : Number(raw);
  return finite(value) && Math.floor(value) === value && value >= 1 && value <= 300 ? value : fallback;
}
function commandResult(m: Member, p: any, tick: number, status: string): void {
  if (m.commandResults.some(function (r) { return r.seq === p.seq && r.round_id === p.round_id; })) return;
  m.commandResults.push({ seq: p.seq, round_id: p.round_id, tick: tick, status: status });
  if (m.commandResults.length > 32) m.commandResults.shift();
}
// Launch-time snapshot setting, captured independently by each new room.
function configuredSnapshotRate(ctx: nkruntime.Context): number {
  var value = ctx.env && ctx.env.GAME_SNAPSHOT_RATE;
  return value === "10" ? 10 : value === "30" ? 30 : 20;
}
function minimumPlayers(game: GameModule): number {
  return game.minimumPlayers || 2;
}
function roomCapacity(game: GameModule, value: any): number {
  if (value === undefined) return 8;
  if (
    !finite(value) ||
    Math.floor(value) !== value ||
    value < minimumPlayers(game) ||
    value > 8
  )
    throw Error("Invalid room capacity");
  return value;
}
function transferHost(s: RoomState, next: string, reason: string): void {
  var previous = s.host_id;
  s.host_id = next;
  s.host_change = {
    seq: s.host_change.seq + 1,
    reason: reason,
    previous_host_id: previous,
    host_id: next,
  };
}
function memberIds(s: RoomState): string[] {
  return s.order.filter(function (id) {
    return !!s.members[id];
  });
}
function roomLabel(s: RoomState): string {
  return JSON.stringify({
    game_id: s.game_id,
    options: s.options,
    name: s.name,
    phase: s.phase,
    host_id: s.host_id,
    capacity: s.capacity,
    room_flow_version: 1,
    room_phase_version: ROOM_PHASE_VERSION,
  });
}
function snapshot(s: RoomState, recipientId: string): any {
  var module = GAMES[s.game_id];
  var result = JSON.parse(JSON.stringify(module.snapshot(s.game, recipientId)));
  delete result.diagnostics;
  result.protocol_version = PROTOCOL_VERSION;
  result.module_version = module.version;
  result.tick = s.tick;
  result.tick_rate = TICK_RATE;
  result.snapshot_rate = s.snapshotRate;
  result.phase = s.phase;
  result.game_id = s.game_id;
  result.min_players = minimumPlayers(GAMES[s.game_id]);
  result.options = s.options;
  result.host_id = s.host_id;
  result.capacity = s.capacity;
  result.room_flow_version = 1;
  result.room_phase_version = ROOM_PHASE_VERSION;
  result.room_chat_version = CHAT_VERSION;
  result.host_change = s.host_change;
  result.countdown = s.countdown;
  result.round_id = s.round_id;
  result.results =
    s.phase === "results"
      ? JSON.parse(
          JSON.stringify(module.projectResults(s.game, s.results, recipientId)),
        )
      : [];
  if (!Array.isArray(result.players) || !Array.isArray(result.results))
    throw Error("Invalid projection");
  if (s.diagnosticsEnabled && s.members[recipientId])
    result.diagnostics = s.members[recipientId].diagnostics;
  // Clients number and colour players by position: list them in join order.
  var rank = function (p: any): number {
    var i = s.order.indexOf(p.user_id);
    return i < 0 ? s.order.length : i;
  };
  result.players = result.players
    .map(function (p: any, i: number) {
      return { p: p, i: i };
    })
    .sort(function (a: any, b: any) {
      return rank(a.p) - rank(b.p) || a.i - b.i;
    })
    .map(function (e: any) {
      return e.p;
    });
  result.players.forEach(function (p: any) {
    p.ready = !!s.members[p.user_id] && s.members[p.user_id].ready;
    p.connected = !!s.members[p.user_id];
    p.staying = !!s.members[p.user_id] && s.members[p.user_id].staying;
    // Schema/round/sequence accepted, not a promise the game applied it.
    var member = s.members[p.user_id];
    p.accepted_input_seq = member ? member.seq : -1;
    p.accepted_input_tick = member ? member.acceptedTick : -1;
    p.applied_input_seq = member ? member.appliedSeq : -1;
    p.applied_input_tick = member ? member.appliedTick : -1;
    delete p.input_receipts;
    delete p.command_results;
    if (member && p.user_id === recipientId) {
      p.input_receipts = member.receipts;
      p.command_results = member.commandResults;
    }
  });
  return result;
}
function broadcast(d: nkruntime.MatchDispatcher, s: RoomState): void {
  memberIds(s).forEach(function (id) {
    var data: string;
    try {
      data = JSON.stringify(snapshot(s, id));
      if (utf8Bytes(data) > 65536) throw Error("Snapshot too large");
    } catch (e) {
      if (s.diagnosticsEnabled)
        bump(s.members[id].diagnostics, "projection_error", 1);
      var member = s.members[id];
      member.projectionFailures++;
      if (member.projectionErrorTick < 0 || s.tick - member.projectionErrorTick >= TICK_RATE) {
        member.projectionErrorTick = s.tick;
        d.broadcastMessage(11, JSON.stringify({ error: "Projection failure", message: "Room data unavailable" }), [member.presence]);
      }
      if (member.projectionFailures >= 3) {
        d.matchKick([member.presence]);
        GAMES[s.game_id].leave(s.game, id, s.phase === PHASE_PLAYING || s.phase === "results", s.tick);
        delete s.members[id];
        s.order = s.order.filter(function (other) { return other !== id; });
        if (s.host_id === id) transferHost(s, memberIds(s)[0] || "", "projection_failure");
        if (s.phase === "countdown" && memberIds(s).length < minimumPlayers(GAMES[s.game_id])) {
          s.phase = "lobby";
          s.countdown = 0;
          memberIds(s).forEach(function (remaining) { s.members[remaining].ready = false; });
        }
        d.matchLabelUpdate(roomLabel(s));
      }
      return;
    }
    s.members[id].projectionFailures = 0;
    d.broadcastMessage(10, data, [s.members[id].presence]);
    if (s.diagnosticsEnabled) {
      wallGap(s.members[id].diagnostics, "send");
      bump(s.members[id].diagnostics, "sent", 1);
      bump(s.members[id].diagnostics, "sent_bytes", utf8Bytes(data));
    }
  });
}
function parseObject(raw: string): any {
  var obj: any;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    throw Error("Invalid JSON");
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj))
    throw Error("Expected object");
  return obj;
}
function requireUser(ctx: nkruntime.Context): void {
  if (!ctx.userId) throw Error("Authentication required");
}
var rpcCatalog: nkruntime.RpcFunction = function (ctx, logger, nk, payload) {
  requireUser(ctx);
  return JSON.stringify({
    room_flow_version: 1,
    room_phase_version: ROOM_PHASE_VERSION,
    protocol_version: PROTOCOL_VERSION,
    room_capacity: true,
    chat: chatCapability(),
    games: Object.keys(GAMES).map(function (id) {
      var g = GAMES[id];
      return {
        id: g.id,
        module_version: g.version,
        input_kinds: g.inputKinds,
        title: g.title,
        description: g.description,
        choices: g.choices || [],
        min_players: minimumPlayers(g),
        max_players: 8,
      };
    }),
  });
};
var rpcRoomList: nkruntime.RpcFunction = function (ctx, logger, nk, payload) {
  requireUser(ctx);
  var p = parseObject(payload || "{}");
  if (!exactKeys(p, ["game_id"])) throw Error("Unknown field");
  if (
    p.game_id !== undefined &&
    (typeof p.game_id !== "string" ||
      !Object.prototype.hasOwnProperty.call(GAMES, p.game_id))
  )
    throw Error("Invalid game");
  var matches = nk.matchList(100, true, null, 0, 8);
  return JSON.stringify({
    rooms: matches
      .filter(function (m) {
        var label = JSON.parse(m.label || "{}");
        return (
          !!GAMES[label.game_id] && (!p.game_id || label.game_id === p.game_id)
        );
      })
      .map(function (m) {
        return {
          match_id: m.matchId,
          label: JSON.parse(m.label || "{}"),
          size: m.size,
        };
      }),
  });
};
// The room core carries immutable module options; only the module interprets them.
function normalizeRoomOptions(game: GameModule, value: any): any {
  var options = value === undefined ? {} : value;
  if (!options || typeof options !== "object" || Array.isArray(options))
    throw Error("Invalid room options");
  if (game.normalizeOptions) return game.normalizeOptions(options);
  if (Object.keys(options).length) throw Error("Unsupported room options");
  return {};
}
var rpcRoomCreate: nkruntime.RpcFunction = function (ctx, logger, nk, payload) {
  requireUser(ctx);
  if (payload.length > 256) throw Error("Request too large");
  var p = parseObject(payload);
  if (
    !exactKeys(p, ["game_id", "name", "options", "capacity"]) ||
    typeof p.game_id !== "string" ||
    !Object.prototype.hasOwnProperty.call(GAMES, p.game_id)
  )
    throw Error("Invalid game");
  if (
    typeof p.name !== "string" ||
    p.name.length < 1 ||
    p.name.length > 32 ||
    /[\x00-\x1f]/.test(p.name)
  )
    throw Error("Name must be 1–32 printable characters");
  var options = normalizeRoomOptions(GAMES[p.game_id], p.options);
  var capacity = roomCapacity(GAMES[p.game_id], p.capacity);
  // Server-side storage timestamp bounds room creation per account; no client clock trusted.
  var existing = nk.storageRead([
    { collection: "framework_rate", key: "create", userId: ctx.userId! },
  ]);
  var now = Date.now();
  if (existing.length && now - Number(existing[0].value.at) < 3000)
    throw Error("Wait 3 seconds before creating another room");
  nk.storageWrite([
    {
      collection: "framework_rate",
      key: "create",
      userId: ctx.userId!,
      version: existing.length ? existing[0].version : "*",
      value: { at: now },
      permissionRead: 0,
      permissionWrite: 0,
    },
  ]);
  return JSON.stringify({
    match_id: nk.matchCreate("game_room", {
      game_id: p.game_id,
      name: p.name,
      host_id: ctx.userId,
      options: options,
      capacity: capacity,
    }),
  });
};
var matchInit: nkruntime.MatchInitFunction<RoomState> = function (
  ctx,
  logger,
  nk,
  p,
) {
  var module = GAMES[p.game_id];
  if (
    !module ||
    module.id !== p.game_id ||
    !finite(module.version) ||
    Math.floor(module.version) !== module.version ||
    module.version < 1 ||
    module.version > 2147483647 ||
    !module.snapshot ||
    !module.projectResults ||
    !Array.isArray(module.inputKinds) ||
    !module.inputKinds.length ||
    module.inputKinds.some(function (kind) {
      return kind !== "state" && kind !== "command";
    }) ||
    (module.inputKinds.indexOf("state") >= 0 && !module.inputExpired)
  )
    throw Error("Invalid module contract");
  var s: RoomState = {
    game_id: p.game_id,
    options: normalizeRoomOptions(GAMES[p.game_id], p.options),
    name: p.name,
    host_id: p.host_id,
    capacity: roomCapacity(GAMES[p.game_id], p.capacity),
    host_change: {
      seq: 0,
      reason: "",
      previous_host_id: "",
      host_id: p.host_id,
    },
    phase: "lobby",
    members: {},
    order: [],
    pending: {},
    game: GAMES[p.game_id].create(
      normalizeRoomOptions(GAMES[p.game_id], p.options),
    ),
    countdown: 0,
    roundStart: 0,
    emptyTicks: 0,
    tick: 0,
    round_id: 1,
    chatSequence: 0,
    results: [],
    diagnosticsEnabled: !!ctx.env && ctx.env.GAME_DIAGNOSTICS === "1",
    snapshotRate: configuredSnapshotRate(ctx),
    snapshotAccumulator: 0,
    inputWindow: configuredTicks(ctx, "GAME_INPUT_WINDOW_TICKS", 30),
    stateTimeout: configuredTicks(ctx, "GAME_STATE_TIMEOUT_TICKS", 15),
  };
  return { state: s, tickRate: TICK_RATE, label: roomLabel(s) };
};
var matchJoinAttempt: nkruntime.MatchJoinAttemptFunction<RoomState> = function (
  ctx,
  logger,
  nk,
  d,
  tick,
  s,
  p,
  metadata,
) {
  var module = GAMES[s.game_id];
  if (
    (metadata || {}).protocol_version !== String(PROTOCOL_VERSION) ||
    (metadata || {}).module_version !== String(module.version)
  )
    return {
      state: s,
      accept: false,
      rejectMessage: "Protocol or module version mismatch",
    };
  var rejection = module.joinRejection
    ? module.joinRejection(s.game, metadata || {})
    : "";
  if (rejection) return { state: s, accept: false, rejectMessage: rejection };
  // Require the shared protocol version before reserving a seat.
  if ((metadata || {}).room_phase_version !== String(ROOM_PHASE_VERSION))
    return {
      state: s,
      accept: false,
      rejectMessage: "客户端版本过旧，请更新后加入",
    };
  if (s.phase !== "lobby")
    return {
      state: s,
      accept: false,
      rejectMessage:
        s.phase === "results"
          ? "本局已结束，请等待房主开启下一局后加入"
          : "比赛已开始，请等待下一局或加入其他房间",
    };
  if (memberIds(s).length + Object.keys(s.pending).length >= s.capacity)
    return { state: s, accept: false, rejectMessage: "房间已满" };
  if (s.members[p.userId] || s.pending[p.userId])
    return {
      state: s,
      accept: false,
      rejectMessage: "此账号已在房间中",
    };
  s.pending[p.userId] = { sessionId: p.sessionId, expires: tick + 60 };
  return { state: s, accept: true };
};
var matchJoin: nkruntime.MatchJoinFunction<RoomState> = function (
  ctx,
  logger,
  nk,
  d,
  tick,
  s,
  presences,
) {
  presences.forEach(function (p) {
    delete s.pending[p.userId];
    var slot = memberIds(s).length;
    if (slot >= s.capacity || s.members[p.userId]) {
      d.matchKick([p]);
      return;
    }
    var name = p.username;
    try {
      var users = nk.usersGetId([p.userId]);
      if (users.length && users[0].displayName) name = users[0].displayName;
    } catch (e) {}
    name = name.replace(/[\x00-\x1f]/g, "").substr(0, 32);
    s.members[p.userId] = {
      presence: p,
      name: name,
      ready: false,
      staying: false,
      seq: -1,
      acceptedTick: -1,
      appliedSeq: -1,
      appliedTick: -1,
      receipts: [],
      commandResults: [],
      projectionFailures: 0,
      projectionErrorTick: -1,
      commands: [],
      continuous: null,
      continuousFresh: false,
      diagnostics: newStats(),
      window: Math.floor(tick / TICK_RATE),
      inputs: 0,
      controls: 0,
      strikes: 0,
      selection: null,
    };
    s.order.push(p.userId);
    GAMES[s.game_id].join(s.game, p.userId, name, slot);
  });
  // Reserve the creator role briefly; a faster guest cannot steal initial host.
  if (!s.host_id) s.host_id = memberIds(s)[0] || "";
  s.emptyTicks = 0;
  s.tick = tick;
  d.matchLabelUpdate(roomLabel(s));
  broadcast(d, s);
  return { state: s };
};
var matchLeave: nkruntime.MatchLeaveFunction<RoomState> = function (
  ctx,
  logger,
  nk,
  d,
  tick,
  s,
  presences,
) {
  var hostDeparted = false;
  presences.forEach(function (p) {
    var m = s.members[p.userId];
    if (m && m.presence.sessionId === p.sessionId) {
      if (p.userId === s.host_id) hostDeparted = true;
      GAMES[s.game_id].leave(
        s.game,
        p.userId,
        s.phase === PHASE_PLAYING || s.phase === "results",
        tick,
      );
      delete s.members[p.userId];
      s.order = s.order.filter(function (id) {
        return id !== p.userId;
      });
    }
  });
  var ids = memberIds(s);
  if (hostDeparted) transferHost(s, ids[0] || "", "member_left");
  if (
    s.phase === "countdown" &&
    ids.length < minimumPlayers(GAMES[s.game_id])
  ) {
    s.phase = "lobby";
    s.countdown = 0;
    ids.forEach(function (id) {
      s.members[id].ready = false;
    });
  }
  s.tick = tick;
  d.matchLabelUpdate(roomLabel(s));
  broadcast(d, s);
  return { state: s };
};
function invalid(
  d: nkruntime.MatchDispatcher,
  m: Member,
  reason: string,
): void {
  m.strikes++;
  if (m.strikes === 1)
    d.broadcastMessage(
      11,
      JSON.stringify({
        error: reason,
        message:
          reason === "Only host may start"
            ? "只有房主可以开始比赛"
            : reason === "Control rate exceeded"
              ? "操作过于频繁，请稍后再试"
              : "操作无效，请更新客户端后重试",
      }),
      [m.presence],
    );
  if (m.strikes >= 8) d.matchKick([m.presence]);
}
// Request transactions accept only bounded finite plain-data trees. Inspect
// descriptors without invoking getters, toJSON hooks or arbitrary serialization.
function cloneRequestData(value: any): any {
  var seen: any[] = [], nodes = 0, bytes = 0;
  var add = function (amount: number): void {
    bytes += amount;
    if (bytes > 65536) throw Error("Request clone limit");
  };
  var visit = function (v: any, depth: number): any {
    if (++nodes > 10000 || depth > 32) throw Error("Request clone limit");
    if (v === null || typeof v === "boolean" || typeof v === "string" || finite(v)) {
      add(utf8Bytes(JSON.stringify(v)));
      return v;
    }
    if (!v || typeof v !== "object") throw Error("Unsupported request data");
    if (seen.indexOf(v) >= 0) throw Error("Request data must be a tree");
    seen.push(v);
    var array = Array.isArray(v), proto = Object.getPrototypeOf(v);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null)
      throw Error("Unsupported request prototype");
    var symbols = (Object as any).getOwnPropertySymbols;
    if (symbols && symbols(v).length) throw Error("Unsupported request keys");
    var names = Object.getOwnPropertyNames(v), result: any = array ? [] : {};
    if (names.length > 10001 || (array && v.length > 10000)) throw Error("Request clone limit");
    if (array && names.length !== v.length + 1) throw Error("Sparse request array");
    add(2);
    var count = 0;
    names.forEach(function (key) {
      if (array && key === "length") return;
      if (key === "__proto__" || key === "constructor" || key === "prototype")
        throw Error("Unsafe request key");
      if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= v.length))
        throw Error("Unsupported request array key");
      var descriptor = Object.getOwnPropertyDescriptor(v, key)!;
      if (!descriptor.enumerable || !("value" in descriptor)) throw Error("Unsupported request descriptor");
      if (count++) add(1);
      if (!array) add(utf8Bytes(JSON.stringify(key)) + 1);
      result[key] = visit(descriptor.value, depth + 1);
    });
    return result;
  };
  return visit(value, 0);
}
function requestFailure(
  d: nkruntime.MatchDispatcher, s: RoomState, m: Member, tick: number,
  category: string, logger?: nkruntime.Logger,
): void {
  if (s.diagnosticsEnabled) {
    bump(m.diagnostics, "module_request_error", 1);
    bump(m.diagnostics, category, 1);
  }
  var logTicks = m.requestLogTicks || (m.requestLogTicks = {});
  if (logTicks[category] === undefined || tick - logTicks[category] >= TICK_RATE) {
    logTicks[category] = tick;
    if (logger && typeof logger.warn === "function") logger.warn("Module request failure: " + category);
  }
  if (m.requestErrorTick === undefined || tick - m.requestErrorTick >= TICK_RATE) {
    m.requestErrorTick = tick;
    d.broadcastMessage(11, JSON.stringify({ error: "Module request failure", message: "Module request failure" }), [m.presence]);
  }
}
function requestRejected(d: nkruntime.MatchDispatcher, m: Member, reason: string): void {
  d.broadcastMessage(11, JSON.stringify({ error: reason, message: "Request rejected" }), [m.presence]);
}
function applySelection(
  d: nkruntime.MatchDispatcher, s: RoomState, m: Member, id: string,
  selection: any, tick: number, logger?: nkruntime.Logger,
): boolean {
  var game = GAMES[s.game_id], validation: any, stored: any, candidate: any, selectRequest: any;
  if (!game.validateSelection || !game.select) return false;
  try {
    validation = cloneRequestData(selection);
    stored = cloneRequestData(selection);
    selectRequest = cloneRequestData(selection);
  } catch (e) { requestFailure(d, s, m, tick, "request_clone_error", logger); return false; }
  var valid: any;
  try { valid = game.validateSelection(validation); }
  catch (e) { requestFailure(d, s, m, tick, "validate_selection_error", logger); return false; }
  if (typeof valid !== "boolean") { requestFailure(d, s, m, tick, "validate_selection_error", logger); return false; }
  if (!valid) { requestRejected(d, m, "Invalid player selection"); return false; }
  try { candidate = cloneRequestData(s.game); }
  catch (e) { requestFailure(d, s, m, tick, "request_clone_error", logger); return false; }
  var resetReady: any;
  try { resetReady = game.select(candidate, id, selectRequest); }
  catch (e) { requestFailure(d, s, m, tick, "select_error", logger); return false; }
  if (typeof resetReady !== "boolean") { requestFailure(d, s, m, tick, "select_error", logger); return false; }
  try { candidate = cloneRequestData(candidate); }
  catch (e) { requestFailure(d, s, m, tick, "request_clone_error", logger); return false; }
  // A second copy prevents retained callback references from mutating live state.
  s.game = candidate;
  m.selection = stored;
  if (resetReady) m.ready = false;
  return true;
}
function handleMessage(
  nk: nkruntime.Nakama,
  d: nkruntime.MatchDispatcher,
  s: RoomState,
  tick: number,
  msg: nkruntime.MatchMessage,
  logger?: nkruntime.Logger,
): void {
  var m = s.members[msg.sender.userId];
  if (!m || m.presence.sessionId !== msg.sender.sessionId) return;
  if (s.diagnosticsEnabled) {
    var stats = m.diagnostics;
    wallGap(stats, "receive");
    bump(stats, "received", 1);
    bump(stats, "received_bytes", msg.data.byteLength);
    stats.receive_gap_ticks =
      stats.last_receive_tick < 0 ? 0 : tick - stats.last_receive_tick;
    stats.last_receive_tick = tick;
  }
  // Only chat has its own payload/rate budget; gameplay controls retain 256 bytes.
  if (chatHandleRoomMessage(nk, d, s, tick, msg)) return;
  var w = Math.floor(tick / TICK_RATE);
  if (w !== m.window) {
    m.window = w;
    m.inputs = 0;
    m.controls = 0;
  }
  if (msg.data.byteLength > 256) {
    invalid(d, m, "Payload too large");
    return;
  }
  var p: any;
  try {
    p = parseObject(nk.binaryToString(msg.data));
  } catch (e) {
    invalid(d, m, "Malformed JSON");
    return;
  }
  if (msg.opCode === 1) {
    if (
      (p.kind !== "state" && p.kind !== "command") ||
      GAMES[s.game_id].inputKinds.indexOf(p.kind) < 0 ||
      !finite(p.client_tick) ||
      Math.floor(p.client_tick) !== p.client_tick ||
      p.client_tick < 0 ||
      p.client_tick > 2147483647 ||
      !finite(p.seq) ||
      p.seq < 0 ||
      p.seq > 2147483647 ||
      Math.floor(p.seq) !== p.seq ||
      !finite(p.round_id) ||
      Math.floor(p.round_id) !== p.round_id ||
      p.round_id < 1
    ) {
      invalid(d, m, "Invalid input schema");
      return;
    }
    var reject = function (reason: string, status: string): void {
      if (s.diagnosticsEnabled) bump(m.diagnostics, reason, 1);
      if (p.kind === "command") commandResult(m, p, tick, status);
    };
    if (p.kind === "command" && (m.commandResults.some(function (r) { return r.seq === p.seq && r.round_id === p.round_id; }) || m.commands.some(function (q) { return q.payload.seq === p.seq && q.payload.round_id === p.round_id; }))) {
      if (s.diagnosticsEnabled) bump(m.diagnostics, "dup", 1);
      return;
    }
    if (++m.inputs > 60) { reject("rate_dropped", "rejected_rate"); return; }
    if (s.phase !== PHASE_PLAYING) { reject("not_playing", "rejected_not_playing"); return; }
    if (p.round_id !== s.round_id) { reject("round", "rejected_round"); return; }
    if (p.seq <= m.seq) { reject("dup", "rejected_old_seq"); return; }
    if (p.client_tick < tick - s.inputWindow) { reject("late", "rejected_stale"); return; }
    if (p.client_tick > tick + 2) { reject("future", "rejected_future"); return; }
    if (p.kind === "command" && m.commands.length >= 8) { reject("queue_full", "rejected_full"); return; }
    var validation: any, valid: any;
    try { validation = cloneRequestData(p); }
    catch (e) {
      if (p.kind === "command") commandResult(m, p, tick, "rejected_module_error");
      requestFailure(d, s, m, tick, "request_clone_error", logger);
      return;
    }
    try { valid = GAMES[s.game_id].validateInput(validation); }
    catch (e) {
      if (p.kind === "command") commandResult(m, p, tick, "rejected_module_error");
      requestFailure(d, s, m, tick, "validate_input_error", logger);
      return;
    }
    if (typeof valid !== "boolean") {
      if (p.kind === "command") commandResult(m, p, tick, "rejected_module_error");
      requestFailure(d, s, m, tick, "validate_input_error", logger);
      return;
    }
    if (!valid) { requestRejected(d, m, "Invalid input schema"); return; }
    m.seq = p.seq;
    m.acceptedTick = tick;
    if (s.diagnosticsEnabled) bump(m.diagnostics, "accepted", 1);
    var queued = { payload: p, tick: tick };
    if (p.kind === "command") m.commands.push(queued);
    else {
      if (m.continuousFresh && s.diagnosticsEnabled)
        bump(m.diagnostics, "coalesced", 1);
      m.continuous = queued;
      m.continuousFresh = true;
    }
  } else {
    // Staying in the current room is an idempotent membership acknowledgement,
    // not an attempt to leave/rejoin or to start a round without host authority.
    // Ignore already handled clicks before counting control rate: duplicates
    // cannot turn a normal results button into an accumulated-strike kick.
    if (msg.opCode === 4) {
      if (
        !exactKeys(p, ["round_id"]) ||
        !finite(p.round_id) ||
        Math.floor(p.round_id) !== p.round_id ||
        p.round_id < 1
      ) {
        invalid(d, m, "Invalid rematch schema");
        return;
      }
      if (
        s.phase !== "results" ||
        (p.round_id !== undefined && p.round_id !== s.round_id)
      )
        return;
      if (m.staying && s.host_id !== msg.sender.userId) return;
    }
    if (++m.controls > 6) {
      invalid(d, m, "Control rate exceeded");
      return;
    }
    if (msg.opCode === 2) {
      if (
        !exactKeys(p, ["ready", "round_id"]) ||
        typeof p.ready !== "boolean" ||
        !finite(p.round_id) ||
        Math.floor(p.round_id) !== p.round_id ||
        p.round_id < 1
      ) {
        invalid(d, m, "Invalid ready schema");
        return;
      }
      if (
        s.phase === "lobby" &&
        (p.round_id === undefined || p.round_id === s.round_id)
      )
        m.ready = p.ready;
    } else if (msg.opCode === 3) {
      if (
        !exactKeys(p, ["round_id"]) ||
        !finite(p.round_id) ||
        Math.floor(p.round_id) !== p.round_id
      ) {
        invalid(d, m, "Invalid start schema");
        return;
      }
      if (p.round_id !== s.round_id) return;
      if (s.host_id !== msg.sender.userId) {
        invalid(d, m, "Only host may start");
        return;
      }
      var ids = memberIds(s);
      if (
        s.phase === "lobby" &&
        ids.length >= minimumPlayers(GAMES[s.game_id]) &&
        ids.every(function (id) {
          return s.members[id].ready;
        })
      ) {
        s.phase = "countdown";
        s.countdown = 3 * TICK_RATE;
        s.results = [];
        d.matchLabelUpdate(roomLabel(s));
      }
    } else if (msg.opCode === 4) {
      if (s.host_id !== msg.sender.userId) {
        m.staying = true;
        return;
      }
      if (s.phase === "results") {
        s.phase = "lobby";
        s.round_id++;
        s.results = [];
        s.game = GAMES[s.game_id].create(s.options);
        memberIds(s).forEach(function (id, i) {
          var mm = s.members[id];
          mm.ready = false;
          mm.staying = false;
          mm.seq = -1;
          mm.acceptedTick = -1;
          mm.appliedSeq = -1;
          mm.appliedTick = -1;
          mm.receipts = [];
          mm.commandResults = [];
          mm.diagnostics = newStats();
          mm.commands = [];
          mm.continuous = null;
          mm.continuousFresh = false;
          GAMES[s.game_id].join(s.game, id, mm.name, i);
        });
        // Finish all joined defaults before independently replaying selections.
        memberIds(s).forEach(function (id) {
          var mm = s.members[id], oldSelection = mm.selection;
          if (oldSelection !== null && !applySelection(d, s, mm, id, oldSelection, tick, logger))
            mm.selection = null;
        });
        d.matchLabelUpdate(roomLabel(s));
      }
    } else if (msg.opCode === 5) {
      var game = GAMES[s.game_id];
      if (
        !exactKeys(p, ["round_id", "selection"]) ||
        !finite(p.round_id) ||
        Math.floor(p.round_id) !== p.round_id ||
        p.round_id < 1 ||
        !p.selection ||
        typeof p.selection !== "object" ||
        Array.isArray(p.selection) ||
        !game.validateSelection ||
        !game.select
      ) {
        invalid(d, m, "Invalid player selection");
        return;
      }
      // A member may change only their own module-approved presentation while
      // in the current lobby. Stale clicks cannot cross the rematch boundary.
      if (s.phase !== "lobby" || p.round_id !== s.round_id) return;
      applySelection(d, s, m, msg.sender.userId, p.selection, tick, logger);
    } else invalid(d, m, "Unknown opcode");
  }
}
// Acknowledgement is a high-water mark of first consumption, never a gap-free ledger.
function consumeInputs(
  s: RoomState,
  tick: number,
): { id: string; seq: number; kind: string }[] {
  var module = GAMES[s.game_id];
  var consumed: { id: string; seq: number; kind: string }[] = [];
  memberIds(s).forEach(function (id) {
    var m = s.members[id];
    var apply = function (q: QueuedInput): void {
      module.input(s.game, id, q.payload, tick);
      consumed.push({ id: id, seq: q.payload.seq, kind: q.payload.kind });
    };
    if (m.continuous && tick - m.continuous.tick >= s.stateTimeout) {
      if (module.inputExpired) module.inputExpired(s.game, id, tick);
      m.continuous = null;
      m.continuousFresh = false;
      if (s.diagnosticsEnabled) { bump(m.diagnostics, "expired", 1); bump(m.diagnostics, "state_timeout", 1); }
    }
    if (m.continuous && m.continuousFresh) {
      apply(m.continuous);
      m.continuousFresh = false;
    }
    var count = 0;
    while (m.commands.length && count < 2) {
      var command = m.commands.shift()!;
      if (tick - command.payload.client_tick > s.inputWindow) {
        commandResult(m, command.payload, tick, "expired");
        if (s.diagnosticsEnabled) { bump(m.diagnostics, "expired", 1); bump(m.diagnostics, "command_expired", 1); }
        continue;
      }
      apply(command);
      count++;
    }
  });
  return consumed;
}
var matchLoop: nkruntime.MatchLoopFunction<RoomState> = function (
  ctx,
  logger,
  nk,
  d,
  tick,
  s,
  messages,
) {
  s.tick = tick;
  Object.keys(s.pending).forEach(function (id) {
    if (s.pending[id].expires < tick) delete s.pending[id];
  });
  var ids = memberIds(s);
  if (!s.members[s.host_id] && ids.length > 0 && tick > 300) {
    transferHost(s, ids[0], "host_unavailable");
    d.matchLabelUpdate(roomLabel(s));
  }
  if (ids.length === 0) {
    if (++s.emptyTicks > 300) return null;
  } else s.emptyTicks = 0;
  try {
    messages.forEach(function (msg) {
      handleMessage(nk, d, s, tick, msg, logger);
    });
    if (s.phase === "countdown" && --s.countdown <= 0) {
      s.phase = PHASE_PLAYING;
      s.roundStart = tick;
      GAMES[s.game_id].start(s.game, tick);
      d.matchLabelUpdate(roomLabel(s));
    }
    if (s.phase === PHASE_PLAYING) {
      var consumed = consumeInputs(s, tick);
      GAMES[s.game_id].step(s.game, tick);
      consumed.forEach(function (entry) {
        var m = s.members[entry.id];
        if (entry.seq > m.appliedSeq) {
          m.appliedSeq = entry.seq;
          m.appliedTick = tick;
        }
        if (s.diagnosticsEnabled) {
          var stats = m.diagnostics;
          wallGap(stats, "consume");
          bump(stats, "consumed", 1);
          stats.consume_gap_ticks =
            stats.last_consume_tick < 0 ? 0 : tick - stats.last_consume_tick;
          stats.last_consume_tick = tick;
        }
        if (entry.kind === "command") commandResult(m, { seq: entry.seq, round_id: s.round_id }, tick, "applied");
        m.receipts.push({ seq: entry.seq, tick: tick, kind: entry.kind });
        if (m.receipts.length > 16) m.receipts.shift();
      });
      if (
        GAMES[s.game_id].finished(s.game) ||
        (GAMES[s.game_id].duration > 0 &&
          tick - s.roundStart > GAMES[s.game_id].duration * TICK_RATE)
      ) {
        s.phase = "results";
        s.results = GAMES[s.game_id].results(s.game, tick);
        memberIds(s).forEach(function (id) {
          var m = s.members[id];
          m.commands.forEach(function (q) { commandResult(m, q.payload, tick, "cancelled_round"); });
          m.commands = [];
          m.continuous = null;
          m.continuousFresh = false;
        });
        d.matchLabelUpdate(roomLabel(s));
      }
    }
    // Integer accumulation preserves fractional cadence: 20Hz at 30 simulation
    // ticks per second alternates 1/2-tick gaps without changing physics.
    s.snapshotAccumulator += s.snapshotRate;
    if (s.snapshotAccumulator >= TICK_RATE) {
      s.snapshotAccumulator -= TICK_RATE;
      broadcast(d, s);
    }
    return { state: s };
  } catch (e) {
    // Module mutations may already exist. Never resume this room or claim rollback.
    var presences = memberIds(s).map(function (id) { return s.members[id].presence; });
    d.broadcastMessage(11, JSON.stringify({ error: "Module failure", message: "Room module failed" }), presences);
    if (presences.length) d.matchKick(presences);
    return null;
  }
};
var matchTerminate: nkruntime.MatchTerminateFunction<RoomState> = function (
  ctx,
  logger,
  nk,
  d,
  tick,
  s,
  grace,
) {
  d.broadcastMessage(
    11,
    JSON.stringify({
      error: "Server shutting down",
      message: "服务器正在关闭，当前房间即将结束",
    }),
  );
  return null;
};
var matchSignal: nkruntime.MatchSignalFunction<RoomState> = function (
  ctx,
  logger,
  nk,
  d,
  tick,
  s,
  data,
) {
  // Never let an untrusted command escape the match callback: Nakama stops
  // the entire match on a thrown signal error. Reject at the outer RPC instead.
  return {
    state: s,
    data: JSON.stringify({ phase: s.phase, players: memberIds(s).length }),
  };
};
function InitModule(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  initializer: nkruntime.Initializer,
): void {
  initializer.registerRpc("game_catalog", rpcCatalog);
  initializer.registerRpc("room_create", rpcRoomCreate);
  initializer.registerRpc("room_list", rpcRoomList);
  // Nakama 3.41 resolves callbacks by inspecting direct InitModule registrations.
  initializer.registerRtBefore("ChannelJoin", chatBeforeLobbyJoin);
  initializer.registerRtBefore("ChannelMessageSend", chatBeforeLobbySend);
  initializer.registerRtBefore("ChannelMessageUpdate", chatBeforeUpdate);
  initializer.registerRtBefore("ChannelMessageRemove", chatBeforeRemove);
  initializer.registerMatch<RoomState>("game_room", {
    matchInit: matchInit,
    matchJoinAttempt: matchJoinAttempt,
    matchJoin: matchJoin,
    matchLeave: matchLeave,
    matchLoop: matchLoop,
    matchTerminate: matchTerminate,
    matchSignal: matchSignal,
  });
  logger.info("Generic rooms: 30Hz authoritative room lifecycle");
}
