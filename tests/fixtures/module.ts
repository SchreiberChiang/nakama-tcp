// Test-only authoritative 2D movement/click fixture. Never production registered.
function fixturePlayer(p: any, recipient: string): any {
  var out: any = {
    user_id: p.user_id,
    username: p.username,
    score: p.score,
    position: { x: p.x, y: p.y },
    velocity: { x: p.dx * 60, y: p.dy * 60 },
  };
  if (p.user_id === recipient) out.private_note = p.private_note;
  return out;
}
var LifecycleFixture: GameModule = {
  id: "fixture",
  version: 1,
  inputKinds: ["state", "command"],
  title: "Lifecycle test",
  description: "2D movement and server click counter; tests only",
  duration: 12,
  minimumPlayers: 2,
  normalizeOptions: function (o: any) {
    if (!exactKeys(o, ["test_failure", "test_projection_user"]) ||
        (o.test_failure !== undefined && ["input", "step", "inputExpired"].indexOf(o.test_failure) < 0) ||
        (o.test_projection_user !== undefined && (typeof o.test_projection_user !== "string" || o.test_projection_user.length > 32))) throw Error("Invalid fixture options");
    return o;
  },
  create: function (options: any) {
    return { players: {}, test_failure: (options || {}).test_failure, test_projection_user: (options || {}).test_projection_user, started: false };
  },
  join: function (s: any, id: string, name: string) {
    s.players[id] = {
      user_id: id,
      username: name,
      score: 0,
      x: 0,
      y: 0,
      dx: 0,
      dy: 0,
      private_note: "PRIVATE_" + id,
    };
  },
  leave: function (s: any, id: string) {
    delete s.players[id];
  },
  start: function (s: any, tick: number) { s.started = true; },
  validateInput: function (p: any) {
    if (p.kind === "command")
      return (
        exactKeys(p, ["seq", "round_id", "kind", "client_tick", "pulse"]) &&
        typeof p.pulse === "boolean"
      );
    return (
      p.kind === "state" &&
      exactKeys(p, ["seq", "round_id", "kind", "client_tick", "direction"]) &&
      p.direction &&
      typeof p.direction === "object" &&
      !Array.isArray(p.direction) &&
      exactKeys(p.direction, ["x", "y"]) &&
      finite(p.direction.x) &&
      finite(p.direction.y) &&
      Math.abs(p.direction.x) <= 1 &&
      Math.abs(p.direction.y) <= 1
    );
  },
  input: function (s: any, id: string, p: any) {
    var player = s.players[id];
    if (!player) return;
    if (p.kind === "command") {
      if (p.pulse) player.score++;
    } else {
      player.dx = p.direction.x;
      player.dy = p.direction.y;
    }
    if (s.test_failure === "input") throw Error("PRIVATE_MODULE_FAILURE");
  },
  inputExpired: function (s: any, id: string) {
    if (s.players[id]) {
      s.players[id].dx = 0;
      s.players[id].dy = 0;
    }
    if (s.test_failure === "inputExpired") throw Error("PRIVATE_MODULE_FAILURE");
  },
  step: function (s: any, tick: number) {
    Object.keys(s.players).forEach(function (id) {
      var p = s.players[id];
      p.x += (p.dx * 60) / TICK_RATE;
      p.y += (p.dy * 60) / TICK_RATE;
    });
    if (s.test_failure === "step") throw Error("PRIVATE_MODULE_FAILURE");
  },
  snapshot: function (s: any, recipient: string) {
    if (s.started && s.players[recipient] && s.players[recipient].username === s.test_projection_user) throw Error("PRIVATE_PROJECTION_FAILURE");
    return {
      players: Object.keys(s.players).map(function (id) {
        return fixturePlayer(s.players[id], recipient);
      }),
    };
  },
  finished: function (s: any) {
    return false;
  },
  results: function (s: any) {
    return Object.keys(s.players)
      .map(function (id) {
        return s.players[id];
      })
      .sort(function (a, b) {
        return b.score - a.score;
      });
  },
  projectResults: function (s: any, results: any[], recipient: string) {
    return results.map(function (p) {
      return fixturePlayer(p, recipient);
    });
  },
};
