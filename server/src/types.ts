// Authoritative module contract; no installed games by default.
interface GameModule {
  id: string;
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
  snapshot(state: any): any;
  finished(state: any): boolean;
  results(state: any, tick: number): any[];
}
var TICK_RATE = 30;
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
