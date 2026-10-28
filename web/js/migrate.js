/* ==========================================================================
   Sayumi data migrations.

   Stored shapes change as the project grows. Every change gets a numbered
   step here; on start the steps between the saved version and the current
   one run in order, after a snapshot is taken so nothing is lost if a step
   turns out to be wrong.
   ========================================================================== */
(function (global) {
  "use strict";

  var VERSION = 3;

  var STEPS = [
    {
      to: 1,
      what: "начальная разметка версии",
      run: function () { /* nothing to move, this only stamps a version */ }
    },
    {
      to: 2,
      what: "у сообщений чата появились устойчивые id",
      run: function () {
        var sessions = S.load("chat.sessions", []);
        var touched = 0;
        sessions.forEach(function (session) {
          (session.messages || []).forEach(function (m) {
            if (!m.id) { m.id = S.uid("m"); touched++; }
            if (!m.ts) m.ts = session.updated || Date.now();
          });
          if (!session.created) session.created = session.updated || Date.now();
        });
        if (touched) S.save("chat.sessions", sessions);
        return touched ? touched + " сообщений получили id" : "";
      }
    },
    {
      to: 3,
      what: "память переехала в общий store",
      run: function () {
        var memory = S.load("memory", null);
        var persona = S.load("persona", null);
        if (!memory && persona && persona.facts && persona.facts.length) {
          /* facts used to live only on the persona; carry them over */
          var moved = persona.facts.map(function (text) {
            return {
              id: S.uid("f"), text: text, kind: "user", tags: [],
              weight: 2, pinned: true, created: Date.now(), updated: Date.now(),
              uses: 0, lastUse: 0, src: "из настроек Sayumi"
            };
          });
          S.save("memory", {
            v: 1, facts: moved, sessions: {},
            growth: {
              xp: 0, messages: 0, replies: 0, sessions: 0, firstSeen: Date.now(),
              topics: {}, hours: new Array(24).fill(0), cmds: {}, tuned: []
            },
            log: [{ at: Date.now(), text: "перенесла " + moved.length + " фактов из настроек", kind: "migrate" }]
          });
          return "перенесено фактов: " + moved.length;
        }
        return "";
      }
    }
  ];

  function snapshot(from) {
    var dump = {};
    S.allKeys().forEach(function (k) {
      if (k.indexOf("backup.") === 0) return;
      dump[k] = S.load(k, null);
    });
    S.save("backup.v" + from, { at: Date.now(), from: from, data: dump });
  }

  function restore(from) {
    var box = S.load("backup.v" + from, null);
    if (!box || !box.data) return false;
    Object.keys(box.data).forEach(function (k) { S.save(k, box.data[k]); });
    return true;
  }

  function run() {
    var saved = S.load("schemaVersion", 0);
    if (saved === VERSION) return { ran: 0, version: VERSION };
    if (saved > VERSION) {
      /* data written by a newer build: leave it alone rather than mangle it */
      console.warn("[sayumi] данные от более новой версии:", saved);
      return { ran: 0, version: saved, newer: true };
    }

    var isFresh = !S.allKeys().some(function (k) {
      return k === "chat.sessions" || k === "memory" || k === "persona";
    });
    if (!isFresh) snapshot(saved);

    var notes = [];
    STEPS.forEach(function (step) {
      if (step.to <= saved || step.to > VERSION) return;
      try {
        var note = step.run();
        notes.push({ to: step.to, what: step.what, note: note || "" });
      } catch (e) {
        console.error("[sayumi] миграция " + step.to + " не прошла:", e);
        notes.push({ to: step.to, what: step.what, note: "ошибка: " + e.message, failed: true });
      }
    });

    S.save("schemaVersion", VERSION);
    S.save("migrations.last", { at: Date.now(), from: saved, to: VERSION, notes: notes });
    return { ran: notes.length, from: saved, version: VERSION, notes: notes, fresh: isFresh };
  }

  global.Migrate = {
    VERSION: VERSION,
    run: run,
    restore: restore,
    snapshot: snapshot,
    last: function () { return S.load("migrations.last", null); },
    backups: function () {
      return S.allKeys().filter(function (k) { return k.indexOf("backup.v") === 0; });
    }
  };
})(window);
