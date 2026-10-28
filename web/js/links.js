/* ==========================================================================
   Sayumi links: one thread running through tasks, notes, chats and memory.

   Anything can point at anything else. A reference is just a type and an id,
   so the store stays tiny and survives an entity being renamed or rebuilt.
   Both directions are written, so "what points here" costs nothing.
   ========================================================================== */
(function (global) {
  "use strict";

  var KINDS = {
    task: { icon: "task", label: "задача" },
    note: { icon: "note", label: "заметка" },
    chat: { icon: "chat", label: "чат" },
    fact: { icon: "sparkle", label: "память" }
  };

  var db = S.load("links", {});

  function key(ref) { return ref.t + ":" + ref.id; }
  function parse(k) {
    var at = k.indexOf(":");
    return { t: k.slice(0, at), id: k.slice(at + 1) };
  }

  function save() {
    S.save("links", db);
    S.syncOut("links", db);
    S.emit("links", db);
  }

  function link(a, b) {
    if (!a || !b || key(a) === key(b)) return;
    var ka = key(a), kb = key(b);
    db[ka] = db[ka] || [];
    db[kb] = db[kb] || [];
    if (db[ka].indexOf(kb) < 0) db[ka].push(kb);
    if (db[kb].indexOf(ka) < 0) db[kb].push(ka);
    save();
  }

  function unlink(a, b) {
    var ka = key(a), kb = key(b);
    if (db[ka]) db[ka] = db[ka].filter(function (x) { return x !== kb; });
    if (db[kb]) db[kb] = db[kb].filter(function (x) { return x !== ka; });
    if (db[ka] && !db[ka].length) delete db[ka];
    if (db[kb] && !db[kb].length) delete db[kb];
    save();
  }

  function of(ref) {
    return (db[key(ref)] || []).map(parse);
  }

  function count(ref) {
    return (db[key(ref)] || []).length;
  }

  /* drop links pointing at things that no longer exist */
  function prune() {
    var removed = 0;
    Object.keys(db).forEach(function (k) {
      var ref = parse(k);
      if (resolve(ref).exists) return;
      (db[k] || []).forEach(function (other) {
        db[other] = (db[other] || []).filter(function (x) { return x !== k; });
        if (!db[other].length) delete db[other];
      });
      delete db[k];
      removed++;
    });
    if (removed) save();
    return removed;
  }

  /* --------------------------------------------------------------- titles */
  function resolve(ref) {
    var out = { title: "", icon: KINDS[ref.t] ? KINDS[ref.t].icon : "file",
                label: KINDS[ref.t] ? KINDS[ref.t].label : ref.t, exists: false };
    try {
      if (ref.t === "task") {
        var task = Tools.tasks.filter(function (t) { return t.id === ref.id; })[0];
        if (task) { out.title = task.text; out.exists = true; out.done = task.col === "done"; }
      } else if (ref.t === "note") {
        var note = Tools.notes.filter(function (n) { return n.id === ref.id; })[0];
        if (note) { out.title = note.title || "Без названия"; out.exists = true; }
      } else if (ref.t === "chat") {
        var session = Chat.exportAll().filter(function (s) { return s.id === ref.id; })[0];
        if (session) { out.title = session.title; out.exists = true; }
      } else if (ref.t === "fact") {
        var fact = Memory.db.facts.filter(function (f) { return f.id === ref.id; })[0];
        if (fact) { out.title = fact.text; out.exists = true; }
      }
    } catch (e) { /* a module may not be loaded in a stripped page */ }
    if (!out.title) out.title = "удалено";
    return out;
  }

  /* opens whatever owns the reference and brings it into view */
  function open(ref) {
    try {
      if (ref.t === "task") Tools.openTask(ref.id);
      else if (ref.t === "note") Tools.openNote(ref.id);
      else if (ref.t === "chat") Chat.openSession(ref.id);
      else if (ref.t === "fact") Memory.openFact(ref.id);
    } catch (e) {
      S.toast("Не вышло открыть: " + e.message, "bad");
    }
  }

  /* ---------------------------------------------------------------- chips */
  /* a row of what this thing is tied to, with a cross to untie */
  function chips(ref, options) {
    options = options || {};
    var row = S.el("div", { class: "links-row" });
    var items = of(ref);

    if (!items.length) {
      if (options.hideEmpty) return row;
      row.appendChild(S.el("span", { class: "tiny muted", text: options.empty || "связей нет" }));
      return row;
    }

    row.appendChild(S.el("span", { class: "tiny muted", text: "связано:" }));
    items.forEach(function (other) {
      var info = resolve(other);
      var chip = S.el("span", {
        class: "chip link-chip" + (info.exists ? "" : " gone"),
        title: info.label + ": " + info.title
      });
      chip.appendChild(S.el("span", { class: "ic-wrap" }, I.svg(info.icon)));
      chip.appendChild(S.el("b", { text: info.title.slice(0, 34) }));
      chip.addEventListener("click", function (e) {
        if (e.target.closest(".x")) return;
        open(other);
      });
      var x = S.el("span", { class: "x", text: "×", title: "Убрать связь" });
      x.addEventListener("click", function (e) {
        e.stopPropagation();
        unlink(ref, other);
        if (options.onChange) options.onChange();
      });
      chip.appendChild(x);
      row.appendChild(chip);
    });
    return row;
  }

  /* a menu offering every place this thing can be sent to */
  function sendMenu(x, y, source, text, after) {
    Menu.show(x, y, [
      {
        icon: "✦", label: "Записать в память",
        act: function () {
          var fact = Memory.add(text.slice(0, 300), {
            kind: "fact", weight: 2, pinned: true, src: "из " + resolve(source).label
          });
          if (fact) {
            link(source, { t: "fact", id: fact.id });
            S.toast("Записала в память", "ok");
          } else {
            S.toast("Такое уже помню", "");
          }
          if (after) after();
        }
      },
      {
        icon: "☑", label: "Сделать задачей",
        act: function () {
          var task = Tools.addTask(text.slice(0, 200));
          link(source, { t: "task", id: task.id });
          S.toast("Добавила в задачи", "ok");
          if (after) after();
        }
      },
      {
        icon: "▤", label: "Сохранить заметкой",
        act: function () {
          var note = Tools.addNote(text.slice(0, 60), text);
          link(source, { t: "note", id: note.id });
          S.toast("Сохранила заметкой", "ok");
          if (after) after();
        }
      },
      { sep: true },
      {
        icon: "⌕", label: "Найти везде",
        act: function () { global.Search.open(text.slice(0, 60)); }
      }
    ], "Отправить");
  }

  global.Links = {
    KINDS: KINDS,
    link: link, unlink: unlink, of: of, count: count, resolve: resolve,
    open: open, chips: chips, sendMenu: sendMenu, prune: prune,
    get db() { return db; },
    ref: function (t, id) { return { t: t, id: id }; }
  };
})(window);
