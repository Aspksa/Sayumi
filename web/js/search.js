/* ==========================================================================
   Sayumi global search: one field over chats, notes, tasks, memory and the
   project files. Scored with the same stemmer memory uses, so a query finds
   word forms it was not typed in.
   ========================================================================== */
(function (global) {
  "use strict";

  function score(text, terms) {
    if (!text) return 0;
    var stems = Memory.tokensOf(text);
    if (!stems.length) return 0;
    var bag = {};
    stems.forEach(function (t) { bag[t] = (bag[t] || 0) + 1; });
    var hit = 0, exact = 0;
    terms.forEach(function (t) { if (bag[t]) hit += 1 + Math.min(2, bag[t] * 0.3); });
    var low = text.toLowerCase();
    terms.forEach(function (t) { if (low.indexOf(t) >= 0) exact += 0.4; });
    return hit + exact;
  }

  function all(query, limit) {
    var text = String(query || "").trim();
    if (text.length < 2) return [];
    var terms = Memory.tokensOf(text);
    if (!terms.length) terms = [text.toLowerCase()];
    var out = [];

    /* ---- chats: match the title and every message */
    Chat.exportAll().forEach(function (session) {
      var best = score(session.title, terms) * 1.4;
      var where = "";
      session.messages.forEach(function (m) {
        var s = score(m.text, terms);
        if (s > best) { best = s; where = m.text; }
      });
      if (best > 0.6) {
        out.push({
          kind: "chat", id: session.id, title: session.title,
          note: (where || "").slice(0, 120), score: best, when: session.updated
        });
      }
    });

    /* ---- notes */
    Tools.notes.forEach(function (note) {
      var s = score(note.title, terms) * 1.5 + score(note.text, terms);
      if (s > 0.6) {
        out.push({
          kind: "note", id: note.id, title: note.title || "Без названия",
          note: (note.text || "").slice(0, 120), score: s, when: note.updated
        });
      }
    });

    /* ---- tasks */
    Tools.tasks.forEach(function (task) {
      var s = score(task.text, terms);
      if (s > 0.6) {
        out.push({
          kind: "task", id: task.id, title: task.text,
          note: (task.col === "done" ? "готово" : task.due ? "срок " + task.due : "в работе"),
          score: s, when: task.updated
        });
      }
    });

    /* ---- memory */
    Memory.db.facts.forEach(function (fact) {
      var s = score(fact.text, terms);
      if (s > 0.6) {
        out.push({
          kind: "fact", id: fact.id, title: fact.text,
          note: (Links.KINDS.fact.label + " · " + fact.src), score: s + (fact.pinned ? 0.6 : 0),
          when: fact.updated
        });
      }
    });

    /* ---- project files, when they have been read */
    try {
      Codebase.search(text, 4).forEach(function (chunk) {
        out.push({
          kind: "code", id: chunk.path, title: chunk.path + ":" + chunk.line,
          note: chunk.text.slice(0, 120).replace(/\s+/g, " "), score: 1.2, when: 0
        });
      });
    } catch (e) { /* project reading is optional */ }

    out.sort(function (a, b) {
      if (Math.abs(b.score - a.score) > 0.15) return b.score - a.score;
      return (b.when || 0) - (a.when || 0);
    });
    return out.slice(0, limit || 40);
  }

  /* ---------------------------------------------------------------- view */
  var ICONS = { chat: "chat", note: "note", task: "task", fact: "sparkle", code: "file" };
  var LABELS = { chat: "чат", note: "заметка", task: "задача", fact: "память", code: "файл" };

  function open(initial) {
    var existing = Win.get("search");
    var pane, field, list;

    if (existing) {
      existing.focus();
      field = S.qs('[data-win="search"] .search');
      if (initial !== undefined && field) {
        field.value = initial;
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.focus();
      }
      return existing;
    }

    pane = S.el("div", { class: "pane" });
    var bar = S.el("div", { class: "chat-bar" });
    field = S.el("input", {
      class: "search",
      placeholder: "Искать в чатах, заметках, задачах, памяти и файлах..."
    });
    bar.appendChild(field);
    var hint = S.el("span", { class: "tiny muted" });
    bar.appendChild(hint);

    var body = S.el("div", { class: "pane-body" });
    list = S.el("div", { class: "list" });
    body.appendChild(list);
    pane.appendChild(bar);
    pane.appendChild(body);

    var chosen = -1;
    var rows = [];

    function paint() {
      var query = field.value.trim();
      list.innerHTML = "";
      rows = [];
      chosen = -1;

      if (query.length < 2) {
        hint.textContent = "";
        list.appendChild(S.el("div", { class: "empty" },
          "Один запрос — по всему сразу: чаты, заметки, задачи, память и прочитанные файлы." +
          '<br><br><span class="tiny">Стрелки — выбор, Enter — открыть</span>'));
        return;
      }

      var found = all(query, 40);
      hint.textContent = found.length ? "найдено " + found.length : "ничего";
      if (!found.length) {
        list.appendChild(S.el("div", { class: "empty", text: "Ничего не нашлось" }));
        return;
      }

      found.forEach(function (hit, i) {
        var item = S.el("div", { class: "item result", "data-i": i });
        item.appendChild(S.el("span", { class: "ic-wrap" }, I.svg(ICONS[hit.kind] || "file")));
        var wrap = S.el("span", { class: "grow", style: "white-space:normal;min-width:0" });
        wrap.appendChild(S.el("div", { text: hit.title.slice(0, 110) }));
        if (hit.note) {
          wrap.appendChild(S.el("div", { class: "tiny muted", text: hit.note }));
        }
        item.appendChild(wrap);
        item.appendChild(S.el("span", { class: "tiny gold", text: LABELS[hit.kind] }));
        item.addEventListener("click", function () { go(hit); });
        list.appendChild(item);
        rows.push({ node: item, hit: hit });
      });
    }

    function go(hit) {
      if (hit.kind === "code") {
        Codebase.openWindow();
        return;
      }
      Links.open({ t: hit.kind, id: hit.id });
    }

    function move(step) {
      if (!rows.length) return;
      if (chosen >= 0) rows[chosen].node.classList.remove("on");
      chosen = (chosen + step + rows.length) % rows.length;
      rows[chosen].node.classList.add("on");
      rows[chosen].node.scrollIntoView({ block: "nearest" });
    }

    field.addEventListener("input", S.debounce(paint, 160));
    field.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      else if (e.key === "Enter") {
        e.preventDefault();
        if (chosen >= 0) go(rows[chosen].hit);
        else if (rows.length) go(rows[0].hit);
      }
    });

    if (initial) field.value = initial;
    paint();

    var win = Win.create({
      id: "search",
      title: "Поиск по всему",
      content: pane,
      weight: 0.8, weightH: 0.9, minWidth: 480, minHeight: 400
    });
    setTimeout(function () { field.focus(); field.select(); }, 60);
    return win;
  }

  global.Search = { all: all, open: open };
})(window);
