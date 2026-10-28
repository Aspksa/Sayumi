/* ==========================================================================
   Sayumi project reader.

   The workspace is scanned, split into overlapping chunks, and indexed the
   same way memory is: BM25 over stemmed tokens. Before a question is sent,
   the chunks that match it are folded into the prompt, so she answers about
   your actual files instead of guessing.
   ========================================================================== */
(function (global) {
  "use strict";

  var CHUNK = 1600;       /* characters per chunk */
  var OVERLAP = 200;      /* carried into the next chunk so nothing is cut */
  var BUDGET = 3200;      /* tokens of code allowed into one prompt */

  var state = S.load("codebase", { files: [], chunks: [], scannedAt: 0, bytes: 0 });
  var settings = Object.assign({
    enabled: false,
    chunks: 4,
    autoRescan: true
  }, S.load("codebase.settings", {}));

  var index = null;
  var scanning = false;

  function save() {
    S.save("codebase", state);
    index = null;
    S.emit("codebase", state);
  }

  function saveSettings() {
    S.save("codebase.settings", settings);
    S.emit("codebase", state);
  }

  /* --------------------------------------------------------------- chunk */
  function splitFile(file) {
    var out = [];
    var text = file.text || "";
    if (!text.trim()) return out;

    /* prefer to break on blank lines so a function stays in one piece */
    var step = CHUNK - OVERLAP;
    for (var start = 0; start < text.length; start += step) {
      var end = Math.min(text.length, start + CHUNK);
      if (end < text.length) {
        var para = text.lastIndexOf("\n\n", end);
        if (para > start + CHUNK * 0.5) end = para;
      }
      var piece = text.slice(start, end);
      if (piece.trim().length > 40) {
        out.push({
          path: file.path,
          from: start,
          line: text.slice(0, start).split("\n").length,
          text: piece
        });
      }
      if (end >= text.length) break;
      start = end - OVERLAP - step > start ? end - OVERLAP - step : start;
    }
    return out;
  }

  /* ---------------------------------------------------------------- scan */
  function scan(onDone) {
    if (scanning) return;
    if (!S.server.up) {
      S.toast("Нужен запущенный сервер — откройте через Sayumi.bat", "bad");
      if (onDone) onDone(null);
      return;
    }
    scanning = true;
    S.emit("codebase", state);

    S.api("/api/scan")
      .then(function (res) {
        scanning = false;
        if (!res.ok) {
          S.toast("Не вышло прочитать папку: " + (res.error || "?"), "bad");
          if (onDone) onDone(null);
          return;
        }
        var chunks = [];
        res.files.forEach(function (file) {
          splitFile(file).forEach(function (chunk) { chunks.push(chunk); });
        });
        state = {
          files: res.files.map(function (f) {
            return { path: f.path, size: f.size, mtime: f.mtime };
          }),
          chunks: chunks,
          scannedAt: Date.now(),
          bytes: res.bytes
        };
        save();
        S.toast("Прочитано файлов: " + state.files.length +
                ", фрагментов: " + chunks.length, "ok");
        if (onDone) onDone(state);
      })
      .catch(function (e) {
        scanning = false;
        S.toast("Ошибка чтения: " + e.message, "bad");
        if (onDone) onDone(null);
      });
  }

  /* --------------------------------------------------------------- search */
  function buildIndex() {
    var map = {};
    state.chunks.forEach(function (chunk, i) {
      var seen = {};
      Memory.tokensOf(chunk.path.replace(/[\/._-]/g, " ") + " " + chunk.text)
        .forEach(function (t) { seen[t] = (seen[t] || 0) + 1; });
      chunk._tf = seen;
      Object.keys(seen).forEach(function (t) {
        (map[t] = map[t] || []).push(i);
      });
    });
    index = map;
  }

  function search(query, limit) {
    if (!state.chunks.length) return [];
    if (!index) buildIndex();
    var terms = Memory.tokensOf(query);
    if (!terms.length) return [];
    var total = state.chunks.length;
    var score = {};
    terms.forEach(function (t) {
      var bucket = index[t];
      if (!bucket) return;
      var idf = Math.log(1 + total / bucket.length);
      bucket.forEach(function (i) {
        var tf = state.chunks[i]._tf[t] || 1;
        score[i] = (score[i] || 0) + idf * (tf / (tf + 1.4));
      });
    });
    return Object.keys(score)
      .sort(function (a, b) { return score[b] - score[a]; })
      .slice(0, limit || settings.chunks)
      .map(function (i) { return state.chunks[i]; });
  }

  /* what gets folded into the prompt */
  function context(query) {
    if (!settings.enabled || !state.chunks.length) return "";
    var hits = search(query, settings.chunks);
    if (!hits.length) return "";

    var used = 0;
    var parts = [];
    hits.forEach(function (chunk) {
      var block = "Файл " + chunk.path + ", строка " + chunk.line + ":\n```\n" +
        chunk.text.trim() + "\n```";
      var cost = S.tokens(block);
      if (used + cost > BUDGET) return;
      used += cost;
      parts.push(block);
    });
    if (!parts.length) return "";
    return "Фрагменты из рабочей папки проекта, относящиеся к вопросу. " +
      "Опирайся на них и ссылайся на файлы по имени:\n\n" + parts.join("\n\n");
  }

  function stale() {
    return state.scannedAt > 0 && Date.now() - state.scannedAt > 20 * 60 * 1000;
  }

  /* ---------------------------------------------------------------- view */
  function openWindow() {
    if (Win.get("codebase")) { Win.get("codebase").focus(); return; }

    var pane = S.el("div", { class: "pane" });
    var body = S.el("div", { class: "pane-body" });
    pane.appendChild(body);

    function render() {
      body.innerHTML = "";

      var box = card(body, "Чтение проекта",
        "Она отвечает по файлам рабочей папки", "folder");

      rowSwitch(box, "Отвечать по файлам проекта", settings.enabled, function (v) {
        settings.enabled = v;
        saveSettings();
        if (v && !state.chunks.length) scan(render);
        else render();
      }, "Подходящие фрагменты подмешиваются в каждый вопрос");

      rowRange(box, "Фрагментов за раз", settings.chunks, 1, 10, 1, function (v) {
        settings.chunks = v;
        saveSettings();
      }, " шт.");

      var info = S.el("div", { class: "list" });
      [
        ["Файлов прочитано", String(state.files.length)],
        ["Фрагментов", String(state.chunks.length)],
        ["Объём", S.bytes(state.bytes || 0)],
        ["Последнее чтение", state.scannedAt ? S.dateTime(state.scannedAt) : "ни разу"]
      ].forEach(function (r) {
        var item = S.el("div", { class: "item" });
        item.appendChild(S.el("span", { class: "grow muted", text: r[0] }));
        item.appendChild(S.el("span", { class: "mono gold tiny", text: r[1] }));
        info.appendChild(item);
      });
      box.appendChild(info);

      var acts = S.el("div", { class: "inline", style: "margin-top:12px" });
      var bScan = S.el("button", {
        class: "btn primary",
        text: scanning ? "Читаю..." : "Перечитать папку"
      });
      bScan.disabled = scanning;
      bScan.addEventListener("click", function () { scan(render); });
      acts.appendChild(bScan);

      var bOpen = S.el("button", { class: "btn", text: "Открыть файлы" });
      bOpen.addEventListener("click", function () { Tools.openFiles(); });
      acts.appendChild(bOpen);
      box.appendChild(acts);

      if (!S.server.up) {
        box.appendChild(S.el("div", { class: "note tiny",
          text: "Сервер не запущен — чтение недоступно. Откройте через Sayumi.bat." }));
      }

      /* ---- try a query right here */
      var probe = card(body, "Проверить поиск",
        "Посмотрите, какие фрагменты найдутся по вопросу", "search");
      var field = S.el("input", { class: "search", placeholder: "например: как устроен запуск сервера" });
      probe.appendChild(field);
      var out = S.el("div", { class: "list", style: "margin-top:10px" });
      probe.appendChild(out);
      field.addEventListener("input", S.debounce(function () {
        out.innerHTML = "";
        var hits = search(field.value, 6);
        if (!field.value.trim()) return;
        if (!hits.length) {
          out.appendChild(S.el("div", { class: "empty", text: "Ничего не нашлось" }));
          return;
        }
        hits.forEach(function (chunk) {
          var item = S.el("div", { class: "item", style: "align-items:flex-start" });
          var wrap = S.el("span", { class: "grow", style: "white-space:normal" });
          wrap.appendChild(S.el("span", { class: "gold mono tiny", text: chunk.path + ":" + chunk.line }));
          wrap.appendChild(S.el("div", {
            class: "tiny muted",
            style: "margin-top:4px;white-space:pre-wrap;max-height:64px;overflow:hidden",
            text: chunk.text.slice(0, 220)
          }));
          item.appendChild(wrap);
          var send = I.btn("arrowRight", { title: "Спросить про этот файл" });
          send.addEventListener("click", function () {
            Chat.openWindow();
            setTimeout(function () {
              var box2 = S.qs(".composer textarea");
              if (box2) { box2.value = "Расскажи, что делает " + chunk.path; box2.focus(); }
            }, 120);
          });
          item.appendChild(send);
          out.appendChild(item);
        });
      }, 200));

      var files = card(body, "Что прочитано", state.files.length + " файлов", "file");
      if (!state.files.length) {
        files.appendChild(S.el("div", { class: "empty" },
          "Положите файлы в рабочую папку и нажмите «Перечитать». " +
          "Папку открывает кнопка «Открыть файлы»."));
      } else {
        var list = S.el("div", { class: "list" });
        state.files.slice(0, 60).forEach(function (f) {
          var item = S.el("div", { class: "item" });
          item.appendChild(S.el("span", { class: "mono tiny grow", text: f.path }));
          item.appendChild(S.el("span", { class: "tiny muted", text: S.bytes(f.size) }));
          list.appendChild(item);
        });
        files.appendChild(list);
      }
    }

    render();
    Win.create({ id: "codebase", title: "Проект", width: 720, height: 600, content: pane });
  }

  /* small local copies so this file does not depend on the settings module */
  function card(parent, title, note, icon) {
    var box = S.el("div", { class: "card" });
    var head = S.el("header");
    head.innerHTML = I.svg(icon || "folder") +
      "<h3>" + S.esc(title) + (note ? "<small>" + S.esc(note) + "</small>" : "") + "</h3>";
    var inner = S.el("div", { class: "inner" });
    box.appendChild(head);
    box.appendChild(inner);
    parent.appendChild(box);
    return inner;
  }

  function rowSwitch(parent, label, value, onChange, note) {
    var row = S.el("div", { class: "row" });
    var lab = S.el("div", { class: "lab" });
    lab.appendChild(document.createTextNode(label));
    if (note) lab.appendChild(S.el("small", { text: note }));
    row.appendChild(lab);
    var sw = S.el("div", { class: "sw" + (value ? " on" : "") });
    sw.addEventListener("click", function () {
      var next = !sw.classList.contains("on");
      sw.classList.toggle("on", next);
      onChange(next);
    });
    row.appendChild(sw);
    parent.appendChild(row);
  }

  function rowRange(parent, label, value, min, max, step, onChange, suffix) {
    var row = S.el("div", { class: "row" });
    row.appendChild(S.el("div", { class: "lab", text: label }));
    var ctl = S.el("div", { class: "ctl" });
    var input = S.el("input", { type: "range", min: min, max: max, step: step, value: value });
    var out = S.el("span", { class: "val", text: value + (suffix || "") });
    input.addEventListener("input", function () {
      out.textContent = input.value + (suffix || "");
      onChange(parseFloat(input.value));
    });
    ctl.appendChild(input);
    ctl.appendChild(out);
    row.appendChild(ctl);
    parent.appendChild(row);
  }

  global.Codebase = {
    get state() { return state; },
    get settings() { return settings; },
    setSettings: function (patch) { Object.assign(settings, patch); saveSettings(); },
    scan: scan, search: search, context: context, stale: stale,
    openWindow: openWindow,
    get scanning() { return scanning; }
  };
})(window);
