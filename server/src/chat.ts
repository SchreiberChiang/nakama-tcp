// Shared chat policy: fixed native lobby and private authoritative room messages.
// No mutable JavaScript global limiter, chat history, message logging or schema DDL.
var CHAT_VERSION = 1;
var CHAT_LOBBY_TARGET = "tcp_lobby_v1";
var CHAT_SEND_OP = 6;
var CHAT_MESSAGE_OP = 12;
var CHAT_ERROR_OP = 13;
var CHAT_MAX_PAYLOAD_BYTES = 768;
var CHAT_MAX_TEXT_BYTES = 512;
var CHAT_MAX_CODEPOINTS = 128;
var CHAT_TICK_RATE = 30;

interface ChatMember {
  presence: nkruntime.Presence;
  name: string;
  chatSendTicks?: number[];
  chatErrorTick?: number;
}
interface ChatRoomState {
  phase: string;
  round_id: number;
  members: { [id: string]: ChatMember };
  chatSequence?: number;
}

function chatCapability(): any {
  return {
    version: CHAT_VERSION,
    lobby: {
      target: CHAT_LOBBY_TARGET,
      type: 1,
      persistence: false,
      hidden: false,
    },
    room: {
      send_op: CHAT_SEND_OP,
      message_op: CHAT_MESSAGE_OP,
      error_op: CHAT_ERROR_OP,
    },
    limits: {
      codepoints: CHAT_MAX_CODEPOINTS,
      utf8_bytes: CHAT_MAX_TEXT_BYTES,
      messages_per_second: 2,
    },
  };
}
function chatFiniteInteger(n: any): boolean {
  return typeof n === "number" && isFinite(n) && Math.floor(n) === n;
}
function chatObject(raw: string): any {
  var p = JSON.parse(raw);
  if (!p || typeof p !== "object" || Array.isArray(p))
    throw Error("CHAT_INVALID_SCHEMA");
  return p;
}
function chatExactKeys(p: any, keys: string[]): boolean {
  var actual = Object.keys(p);
  if (actual.length !== keys.length) return false;
  for (var i = 0; i < keys.length; i++)
    if (!Object.prototype.hasOwnProperty.call(p, keys[i])) return false;
  return true;
}
function chatText(nk: nkruntime.Nakama, input: any): string {
  if (typeof input !== "string") throw Error("CHAT_INVALID_TEXT");
  // Reject controls before trimming: tabs/newlines are not silently normalized.
  // Bidi overrides/isolates are rejected; emoji ZWJ remains valid.
  if (/[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/.test(input))
    throw Error("CHAT_INVALID_TEXT");
  var text = input.trim();
  if (!text || /^[\s\u200b\u200c\u200d\u2060]*$/.test(text))
    throw Error("CHAT_INVALID_TEXT");
  var count = 0;
  for (var i = 0; i < text.length; i++) {
    var u = text.charCodeAt(i);
    if (u >= 0xd800 && u <= 0xdbff) {
      var low = text.charCodeAt(++i);
      if (!(low >= 0xdc00 && low <= 0xdfff)) throw Error("CHAT_INVALID_TEXT");
    } else if (u >= 0xdc00 && u <= 0xdfff) throw Error("CHAT_INVALID_TEXT");
    if (++count > CHAT_MAX_CODEPOINTS) throw Error("CHAT_TEXT_TOO_LONG");
  }
  if (nk.stringToBinary(text).byteLength > CHAT_MAX_TEXT_BYTES)
    throw Error("CHAT_TEXT_TOO_LONG");
  return text;
}
function chatRequireSession(ctx: nkruntime.Context): void {
  if (!ctx.userId || !ctx.sessionId) throw Error("CHAT_AUTH_REQUIRED");
}
function chatCleanDisplayName(input: any): string {
  if (typeof input !== "string") return "";
  var clean = input
    .replace(
      /[\x00-\x1f\x7f-\x9f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g,
      "",
    )
    .trim();
  var result = "",
    count = 0;
  for (var i = 0; i < clean.length && count < 32; i++) {
    var u = clean.charCodeAt(i);
    if (u >= 0xd800 && u <= 0xdbff) {
      var low = clean.charCodeAt(i + 1);
      if (!(low >= 0xdc00 && low <= 0xdfff)) continue;
      result += clean.charAt(i) + clean.charAt(++i);
    } else if (u >= 0xdc00 && u <= 0xdfff) continue;
    else result += clean.charAt(i);
    count++;
  }
  result = result.trim();
  return /^[\s\u200b\u200c\u200d\u2060]*$/.test(result) ? "" : result;
}
function chatLobbyDisplayName(
  ctx: nkruntime.Context,
  nk: nkruntime.Nakama,
): string {
  try {
    var users = nk.usersGetId([ctx.userId!]);
    if (users.length && users[0].userId === ctx.userId) {
      var display = chatCleanDisplayName(users[0].displayName);
      if (display) return display;
    }
  } catch (_) {
    /* Public display lookup failure falls back without raw logging. */
  }
  return chatCleanDisplayName(ctx.username) || "玩家";
}
function chatLobbyId(nk: nkruntime.Nakama): string {
  return nk.channelIdBuild(
    undefined,
    CHAT_LOBBY_TARGET,
    nkruntime.ChanType.Room,
  );
}

function chatReserveLobbyRate(
  nk: nkruntime.Nakama,
  userId: string,
  now: number,
): void {
  if (!chatFiniteInteger(now) || now < 0) throw Error("CHAT_UNAVAILABLE");
  var found: nkruntime.StorageObject[];
  try {
    found = nk.storageRead([
      { collection: "framework_rate", key: "chat_lobby_v1", userId: userId },
    ]);
  } catch (_) {
    throw Error("CHAT_UNAVAILABLE");
  }
  if (found.length > 1) throw Error("CHAT_UNAVAILABLE");
  var recent: number[] = [];
  if (found.length) {
    var old = found[0],
      times = old.value && old.value.sent_ms;
    if (
      !old.version ||
      !old.value ||
      old.value.schema !== 1 ||
      !Array.isArray(times) ||
      times.length > 2
    )
      throw Error("CHAT_UNAVAILABLE");
    for (var i = 0; i < times.length; i++) {
      if (
        !chatFiniteInteger(times[i]) ||
        times[i] < 0 ||
        times[i] > now ||
        (i && times[i] < times[i - 1])
      )
        throw Error("CHAT_UNAVAILABLE");
      if (now - times[i] < 1000) recent.push(times[i]);
    }
  }
  if (recent.length >= 2) throw Error("CHAT_RATE_LIMITED");
  recent.push(now);
  try {
    var acks = nk.storageWrite([
      {
        collection: "framework_rate",
        key: "chat_lobby_v1",
        userId: userId,
        version: found.length ? found[0].version : "*",
        permissionRead: 0,
        permissionWrite: 0,
        value: { schema: 1, sent_ms: recent },
      },
    ]);
    if (
      acks.length !== 1 ||
      !acks[0].version ||
      acks[0].key !== "chat_lobby_v1" ||
      acks[0].collection !== "framework_rate" ||
      acks[0].userId !== userId
    )
      throw Error("CHAT_UNAVAILABLE");
  } catch (_) {
    // CAS conflict and DB error both fail closed. No automatic retry or raw-error log.
    // A consumed quota with a subsequently failed channel send is acceptable.
    throw Error("CHAT_UNAVAILABLE");
  }
}

var chatBeforeLobbyJoin: nkruntime.RtBeforeHookFunction<nkruntime.EnvelopeChannelJoin> =
  function (ctx, logger, nk, envelope) {
    chatRequireSession(ctx);
    var join = envelope && envelope.channelJoin;
    if (
      !join ||
      join.target !== CHAT_LOBBY_TARGET ||
      join.type !== nkruntime.ChanType.Room
    )
      throw Error("CHAT_CHANNEL_NOT_ALLOWED");
    join.persistence = false;
    join.hidden = false;
    return envelope;
  };
var chatBeforeLobbySend: nkruntime.RtBeforeHookFunction<nkruntime.EnvelopeChannelMessageSend> =
  function (ctx, logger, nk, envelope) {
    chatRequireSession(ctx);
    var send = envelope && envelope.channelMessageSend;
    if (!send || send.channelId !== chatLobbyId(nk))
      throw Error("CHAT_CHANNEL_NOT_ALLOWED");
    if (
      typeof send.content !== "string" ||
      nk.stringToBinary(send.content).byteLength > CHAT_MAX_PAYLOAD_BYTES
    )
      throw Error("CHAT_PAYLOAD_TOO_LARGE");
    var p: any;
    try {
      p = chatObject(send.content);
    } catch (_) {
      throw Error("CHAT_INVALID_SCHEMA");
    }
    if (!chatExactKeys(p, ["text"])) throw Error("CHAT_INVALID_SCHEMA");
    var text = chatText(nk, p.text);
    chatReserveLobbyRate(nk, ctx.userId!, Date.now());
    // Native username is a unique account name, not the saved public nickname.
    // Client requests cannot supply this field; only the authenticated user lookup can.
    send.content = JSON.stringify({
      text: text,
      display_name: chatLobbyDisplayName(ctx, nk),
    });
    // Native Nakama then checks channel session membership and supplies sender identity.
    return envelope;
  };
var chatBeforeUpdate: nkruntime.RtBeforeHookFunction<nkruntime.EnvelopeChannelMessageUpdate> =
  function () {
    throw Error("CHAT_EDIT_NOT_SUPPORTED");
  };
var chatBeforeRemove: nkruntime.RtBeforeHookFunction<nkruntime.EnvelopeChannelMessageRemove> =
  function () {
    throw Error("CHAT_EDIT_NOT_SUPPORTED");
  };

function chatRoomError(
  d: nkruntime.MatchDispatcher,
  s: ChatRoomState,
  m: ChatMember,
  tick: number,
  error: string,
): void {
  if (m.chatErrorTick !== undefined && tick - m.chatErrorTick < CHAT_TICK_RATE)
    return;
  m.chatErrorTick = tick;
  d.broadcastMessage(
    CHAT_ERROR_OP,
    JSON.stringify({
      chat_version: CHAT_VERSION,
      round_id: s.round_id,
      error: error,
    }),
    [m.presence],
    null,
    true,
  );
}
function chatHandleRoomMessage(
  nk: nkruntime.Nakama,
  d: nkruntime.MatchDispatcher,
  s: ChatRoomState,
  tick: number,
  msg: nkruntime.MatchMessage,
): boolean {
  if (msg.opCode !== CHAT_SEND_OP) return false;
  var m = s.members[msg.sender.userId];
  if (!m || m.presence.sessionId !== msg.sender.sessionId) return true;
  if (msg.data.byteLength > CHAT_MAX_PAYLOAD_BYTES) {
    chatRoomError(d, s, m, tick, "CHAT_PAYLOAD_TOO_LARGE");
    return true;
  }
  var p: any, text: string;
  try {
    p = chatObject(nk.binaryToString(msg.data));
    if (
      !chatExactKeys(p, ["round_id", "text"]) ||
      !chatFiniteInteger(p.round_id) ||
      p.round_id < 1
    )
      throw Error("CHAT_INVALID_SCHEMA");
    // Delayed old-round messages do not consume quota or produce new content.
    if (p.round_id !== s.round_id) return true;
    text = chatText(nk, p.text);
  } catch (_) {
    chatRoomError(d, s, m, tick, "CHAT_INVALID_MESSAGE");
    return true;
  }
  if (s.phase !== "lobby" && s.phase !== "results") {
    chatRoomError(d, s, m, tick, "CHAT_PHASE_UNAVAILABLE");
    return true;
  }
  var times = m.chatSendTicks || [],
    recent: number[] = [];
  for (var i = 0; i < times.length; i++)
    if (tick - times[i] < CHAT_TICK_RATE) recent.push(times[i]);
  if (recent.length >= 2) {
    chatRoomError(d, s, m, tick, "CHAT_RATE_LIMITED");
    return true;
  }
  recent.push(tick);
  m.chatSendTicks = recent;
  s.chatSequence = (s.chatSequence || 0) + 1;
  d.broadcastMessage(
    CHAT_MESSAGE_OP,
    JSON.stringify({
      chat_version: CHAT_VERSION,
      message_seq: s.chatSequence,
      round_id: s.round_id,
      tick: tick,
      user_id: m.presence.userId,
      username: chatCleanDisplayName(m.name) || "玩家",
      text: text,
    }),
    null,
    null,
    true,
  );
  return true;
}
