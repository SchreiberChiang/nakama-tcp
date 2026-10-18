// Authoritative module contract; no installed games by default.
interface GameModule {
  id: string;
  version: number;
  inputKinds: string[];
  title: string;
  description: string;
  // Positive seconds enable the core safety deadline; 0 uses module completion only.
  duration: number;
  minimumPlayers?: number;
  validateSelection?(selection: any): boolean;
  select?(state: any, id: string, selection: any): boolean;
  choices?: { id: string; title: string; description: string }[];
  normalizeOptions?(options: any): any;
  // Optional module-owned compatibility gate; empty string accepts the client.
  joinRejection?(state: any, metadata: { [key: string]: string }): string;
  create(options?: any): any;
  join(state: any, id: string, name: string, slot: number): void;
  leave(state: any, id: string, active: boolean, tick: number): void;
  start(state: any, tick: number): void;
  validateInput(payload: any): boolean;
  input(state: any, id: string, payload: any, tick: number): void;
  step(state: any, tick: number): void;
  snapshot(state: any, recipientId: string): any;
  projectResults(state: any, results: any[], recipientId: string): any[];
  inputExpired?(state: any, id: string, tick: number): void;
  finished(state: any): boolean;
  results(state: any, tick: number): any[];
}
var TICK_RATE = 30;
var PROTOCOL_VERSION = 2;
interface QueuedInput {
  payload: any;
  tick: number;
}
function newStats(): any {
  return {
    projection_error: 0,
    received: 0,
    received_bytes: 0,
    accepted: 0,
    consumed: 0,
    sent: 0,
    sent_bytes: 0,
    expired: 0,
    state_timeout: 0, command_expired: 0, rate_dropped: 0,
    late: 0, future: 0, not_playing: 0, round: 0, dup: 0, queue_full: 0,
    coalesced: 0,
    last_receive_tick: -1,
    last_consume_tick: -1,
    receive_gap_ticks: 0,
    consume_gap_ticks: 0,
    last_receive_ms: -1,
    receive_gap_ms: -1,
    last_send_ms: -1,
    send_gap_ms: -1,
    last_consume_ms: -1,
    consume_gap_ms: -1,
  };
}
function bump(stats: any, key: string, amount: number): void {
  stats[key] = Math.min(2147483647, stats[key] + amount);
}
// Wall clock only; backwards corrections invalidate an interval.
function wallGap(stats: any, channel: string): void {
  var now = Date.now(),
    previous = stats["last_" + channel + "_ms"];
  stats[channel + "_gap_ms"] =
    previous < 0 || now < previous ? -1 : Math.min(2147483647, now - previous);
  stats["last_" + channel + "_ms"] = now;
}
function utf8Bytes(v: string): number {
  return encodeURIComponent(v).replace(/%[A-F0-9]{2}/g, "x").length;
}
// Shared phases: lobby, countdown, playing, results.
var ROOM_PHASE_VERSION = 2;
var PHASE_PLAYING = "playing";
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
function finite(v: any): boolean {
  return typeof v === "number" && isFinite(v);
}
function approach(v: number, target: number, amount: number): number {
  return v < target
    ? Math.min(target, v + amount)
    : Math.max(target, v - amount);
}
function exactKeys(obj: any, keys: string[]): boolean {
  return Object.keys(obj).every(function (k) {
    return keys.indexOf(k) >= 0;
  });
}
