/* ==========================================================================
   Sayumi work tools: notes, tasks, workspace files
   ========================================================================== */
(function (global) {
  "use strict";

  var notes = S.load("tools.notes", []);
  var tasks = S.load("tools.tasks", []);

  function saveNotes() { S.save("tools.notes", notes); S.syncOut("tools.notes", notes); }
  function saveTasks() { S.save("tools.tasks", tasks); S.syncOut("tools.tasks", tasks); }

  /* -------------------------------------------------------------- notes */
  function openNotes() {
    if (Win.get("notes")) { Win.get("notes").focus(); return; }

    var root = S.el("div", { class: "chat" });
    var side = S.el("div", { class: "chat-side" });
    var top = S.el("div", { class: "side-top" });
    var bNew = S.el("button", { class: "btn sm primary", text: "+ Заметка" });
    top.appendChild(bNew);
    var searchWrap = S.el("div", { class: "side-top" });
    var search = S.el("input", { class: "search", placeholder: "Поиск..." });
    searchWrap.appendChild(search);
    var list = S.el("div", { class: "side-list" });
    side.appendChild(top);
    side.appendChild(searchWrap);
    side.appendChild(list);

    var main = S.el("div", { class: "chat-main" });
    var bar = S.el("div", { class: "chat-bar" });
    var titleIn = S.el("input", { class: "search", placeholder: "Заголовок заметки" });
    var bPreview = S.el("button", { class: "btn sm ghost", text: "👁 Вид" });
    var bCopy = S.el("button", { class: "btn sm ghost", text: "⧉" });
    var bDown = S.el("button", { class: "btn sm ghost", text: "⤓" });
    var bDel = S.el("button", { class: "btn sm ghost danger", text: "×" });
    [titleIn, bPreview, bCopy, bDown, bDel].forEach(function (n) { bar.appendChild(n); });

    var editor = S.el("textarea", {
      class: "field",
      style: "flex:1;border:0;border-radius:0;background:var(--bg-0);padding:16px 18px;font-size:13.5px;resize:none"
    });
    var preview = S.el("div", { class: "chat-log hide" });

    main.appendChild(bar);
    main.appendChild(editor);
    main.appendChild(preview);
    root.appendChild(side);
    root.appendChild(main);

    var activeId = notes.length ? notes[0].id : null;

    function active() {
      return notes.filter(function (n) { return n.id === activeId; })[0] || null;
    }

    function drawList() {
      list.innerHTML = "";
      var q = search.value.toLowerCase();
      var shown = notes.filter(function (n) {
        return !q || (n.title + " " + n.text).toLowerCase().indexOf(q) >= 0;
      });
      if (!shown.length) list.appendChild(S.el("div", { class: "empty", text: "Пусто" }));
      shown.forEach(function (n) {
        var row = S.el("div", { class: "sess" + (n.id === activeId ? " on" : "") });
        row.appendChild(S.el("span", { class: "nm", text: n.title || "Без названия" }));
        row.addEventListener("click", function () { activeId = n.id; drawList(); load(); });
        list.appendChild(row);
      });
    }

    function load() {
      var n = active();
      titleIn.value = n ? n.title : "";
      editor.value = n ? n.text : "";
      preview.innerHTML = n ? MD.render(n.text) : "";
    }

    function touch() {
      var n = active();
      if (!n) return;
      n.title = titleIn.value;
      n.text = editor.value;
      n.updated = Date.now();
      saveNotes();
      preview.innerHTML = MD.render(n.text);
    }

    bNew.addEventListener("click", function () {
      var n = { id: S.uid("n"), title: "Новая заметка", text: "", updated: Date.now() };
      notes.unshift(n);
      activeId = n.id;
      saveNotes();
      drawList();
      load();
      titleIn.focus();
      titleIn.select();
    });
    search.addEventListener("input", S.debounce(drawList, 120));
    titleIn.addEventListener("input", S.debounce(function () { touch(); drawList(); }, 300));
    editor.addEventListener("input", S.debounce(touch, 400));
    bPreview.addEventListener("click", function () {
      editor.classList.toggle("hide");
      preview.classList.toggle("hide");
      bPreview.classList.toggle("on");
    });
    bCopy.addEventListener("click", function () {
      S.copy(editor.value).then(function () { S.toast(S.t("copied"), "ok"); });
    });
    bDown.addEventListener("click", function () {
      var n = active();
      if (!n) return;
      S.download((n.title || "note") + ".md", n.text, "text/markdown");
    });
    bDel.addEventListener("click", function () {
      if (!active()) return;
      if (!confirm("Удалить заметку?")) return;
      notes = notes.filter(function (n) { return n.id !== activeId; });
      activeId = notes.length ? notes[0].id : null;
      saveNotes();
      drawList();
      load();
    });

    if (!notes.length) bNew.click();
    drawList();
    load();

    Win.create({
      id: "notes",
      title: S.t("notes"),
      width: 760, height: 540,
      content: root
    });
  }

  /* -------------------------------------------------------------- tasks */
  function openTasks() {
    if (Win.get("tasks")) { Win.get("tasks").focus(); return; }

    var pane = S.el("div", { class: "pane" });
    var bar = S.el("div", { class: "chat-bar" });
    var input = S.el("input", { class: "search", placeholder: "Новая задача, Enter — добавить" });
    var sel = S.el("select", { style: "width:120px" });
    [["all", "Все"], ["open", "Активные"], ["done", "Готовые"]].forEach(function (o) {
      sel.appendChild(S.el("option", { value: o[0], text: o[1] }));
    });
    var bClear = S.el("button", { class: "btn sm ghost danger", text: "Убрать готовые" });
    bar.appendChild(input);
    bar.appendChild(sel);
    bar.appendChild(bClear);

    var body = S.el("div", { class: "pane-body" });
    pane.appendChild(bar);
    pane.appendChild(body);

    function draw() {
      body.innerHTML = "";
      var mode = sel.value;
      var shown = tasks.filter(function (t) {
        return mode === "all" || (mode === "done" ? t.done : !t.done);
      });
      var stat = S.el("div", { class: "note tiny" });
      stat.textContent = "Всего " + tasks.length +
        " · активных " + tasks.filter(function (t) { return !t.done; }).length;
      body.appendChild(stat);

      if (!shown.length) {
        body.appendChild(S.el("div", { class: "empty", text: "Список пуст" }));
        return;
      }
      var list = S.el("div", { class: "list" });
      shown.forEach(function (t) {
        var item = S.el("div", { class: "item" + (t.done ? " done" : "") });
        var cb = S.el("span", { class: "cb", text: t.done ? "✓" : "" });
        cb.addEventListener("click", function () {
          t.done = !t.done;
          t.updated = Date.now();
          saveTasks();
          draw();
        });
        var text = S.el("span", { class: "grow", text: t.text });
        text.addEventListener("dblclick", function () {
          var v = prompt("Задача:", t.text);
          if (v) { t.text = v; saveTasks(); draw(); }
        });
        var toChat = S.el("button", { class: "btn sm ghost", title: "Обсудить в чате", text: "→" });
        toChat.addEventListener("click", function () {
          Chat.openWindow();
          setTimeout(function () {
            var box = S.qs(".composer textarea");
            if (box) { box.value = "Помоги с задачей: " + t.text; box.focus(); }
          }, 120);
        });
        var x = S.el("button", { class: "btn sm ghost danger", text: "×" });
        x.addEventListener("click", function () {
          tasks = tasks.filter(function (o) { return o.id !== t.id; });
          saveTasks();
          draw();
        });
        item.appendChild(cb);
        item.appendChild(text);
        item.appendChild(toChat);
        item.appendChild(x);
        list.appendChild(item);
      });
      body.appendChild(list);
    }

    input.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      var v = input.value.trim();
      if (!v) return;
      tasks.unshift({ id: S.uid("t"), text: v, done: false, updated: Date.now() });
      input.value = "";
      saveTasks();
      draw();
    });
    sel.addEventListener("change", draw);
    bClear.addEventListener("click", function () {
      tasks = tasks.filter(function (t) { return !t.done; });
      saveTasks();
      draw();
    });

    draw();
    Win.create({ id: "tasks", title: S.t("tasks"), width: 560, height: 480, content: pane });
  }

  /* -------------------------------------------------------------- files */
  function openFiles() {
    if (Win.get("files")) { Win.get("files").focus(); return; }

    var pane = S.el("div", { class: "pane" });
    var bar = S.el("div", { class: "chat-bar" });
    var path = S.el("div", { class: "title mono", text: "workspace/" });
    var bUp = S.el("button", { class: "btn sm ghost", text: "↑" });
    var bRefresh = S.el("button", { class: "btn sm ghost", text: "⟳" });
    var bNew = S.el("button", { class: "btn sm ghost", text: "+ файл" });
    bar.appendChild(bUp);
    bar.appendChild(path);
    bar.appendChild(bNew);
    bar.appendChild(bRefresh);

    var body = S.el("div", { class: "pane-body" });
    pane.appendChild(bar);
    pane.appendChild(body);

    var dir = "";

    function draw() {
      body.innerHTML = "";
      if (!S.server.up) {
        body.appendChild(S.el("div", { class: "empty" },
          "Рабочая папка доступна только с запущенным сервером.<br><br>" +
          'Запустите <b class="gold">Sayumi.bat</b> и выберите пункт «Запустить Sayumi».'));
        return;
      }
      path.textContent = "workspace/" + dir;
      S.api("/api/files?dir=" + encodeURIComponent(dir)).then(function (res) {
        body.innerHTML = "";
        if (!res.ok) { body.appendChild(S.el("div", { class: "empty", text: res.error || "Ошибка" })); return; }
        if (!res.entries.length) {
          body.appendChild(S.el("div", { class: "empty", text: "Папка пуста" }));
          return;
        }
        var list = S.el("div", { class: "list" });
        res.entries.forEach(function (entry) {
          var item = S.el("div", { class: "item" });
          item.appendChild(S.el("span", { text: entry.dir ? "📁" : "📄" }));
          var nm = S.el("span", { class: "grow", text: entry.name });
          item.appendChild(nm);
          if (!entry.dir) {
            item.appendChild(S.el("span", { class: "tiny muted mono", text: S.bytes(entry.size) }));
          }
          item.addEventListener("click", function () {
            if (entry.dir) { dir = (dir ? dir + "/" : "") + entry.name; draw(); }
            else openFile((dir ? dir + "/" : "") + entry.name);
          });
          list.appendChild(item);
        });
        body.appendChild(list);
      }).catch(function (e) {
        body.appendChild(S.el("div", { class: "empty", text: "Ошибка: " + e.message }));
      });
    }

    function openFile(rel) {
      S.api("/api/file?path=" + encodeURIComponent(rel)).then(function (res) {
        if (!res.ok) { S.toast(res.error || "Не прочиталось", "bad"); return; }
        body.innerHTML = "";
        var head = S.el("div", { class: "inline", style: "margin-bottom:10px" });
        var bBack = S.el("button", { class: "btn sm", text: "← назад" });
        bBack.addEventListener("click", draw);
        var bSave = S.el("button", { class: "btn sm primary", text: "Сохранить" });
        var bToChat = S.el("button", { class: "btn sm", text: "В чат" });
        head.appendChild(bBack);
        head.appendChild(S.el("span", { class: "mono tiny gold", text: rel }));
        head.appendChild(bSave);
        head.appendChild(bToChat);
        body.appendChild(head);

        var area = S.el("textarea", { class: "field", rows: 22 });
        area.value = res.text;
        body.appendChild(area);

        bSave.addEventListener("click", function () {
          S.api("/api/file", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: rel, text: area.value })
          }).then(function (r) {
            S.toast(r.ok ? "Сохранено" : "Ошибка", r.ok ? "ok" : "bad");
          });
        });
        bToChat.addEventListener("click", function () {
          Chat.openWindow();
          setTimeout(function () {
            var box = S.qs(".composer textarea");
            if (box) {
              box.value = "Посмотри файл " + rel + ":\n\n```\n" + area.value.slice(0, 20000) + "\n```";
              box.focus();
            }
          }, 120);
        });
      });
    }

    bUp.addEventListener("click", function () {
      dir = dir.split("/").slice(0, -1).join("/");
      draw();
    });
    bRefresh.addEventListener("click", draw);
    bNew.addEventListener("click", function () {
      var name = prompt("Имя файла:", "notes.md");
      if (!name) return;
      S.api("/api/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: (dir ? dir + "/" : "") + name, text: "" })
      }).then(draw);
    });

    draw();
    Win.create({ id: "files", title: S.t("files"), width: 680, height: 520, content: pane });
  }

  global.Tools = {
    openNotes: openNotes,
    openTasks: openTasks,
    openFiles: openFiles,
    get notes() { return notes; },
    get tasks() { return tasks; }
  };
})(window);
