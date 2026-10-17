// Test fixture only. Not in production tsconfig; no artwork, maps, audio or business rules.
var LifecycleFixture: GameModule = {
  id: "fixture",
  title: "Lifecycle test",
  description: "Text counter; tests only",
  duration: 2,
  minimumPlayers: 2,
  create: function () {
    return { players: {} };
  },
  join: function (s: any, id: string, name: string) {
    s.players[id] = { user_id: id, username: name, score: 0 };
  },
  leave: function (s: any, id: string) {
    delete s.players[id];
  },
  start: function (s: any, tick: number) {},
  validateInput: function (p: any) {
    return (
      exactKeys(p, ["seq", "round_id", "pulse"]) && typeof p.pulse === "boolean"
    );
  },
  input: function (s: any, id: string, p: any) {
    if (p.pulse && s.players[id]) s.players[id].score++;
  },
  step: function (s: any, tick: number) {},
  snapshot: function (s: any) {
    return {
      players: Object.keys(s.players).map(function (id) {
        return s.players[id];
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
};
