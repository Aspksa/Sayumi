/* ==========================================================================
   Sayumi work tools: notes, tasks, workspace files
   ========================================================================== */
(function (global) {
  "use strict";

  var notes = S.load("tools.notes", []);
  var tasks = S.load("tools.tasks", []);

  function saveNotes() { S.save("tools.notes", notes); S.syncOut("tools.notes", notes); }
  function saveTasks() { S.save("tools.tasks", tasks); S.syncOut("tools.tasks", tasks); }

  var notesApi = null;

  /* ------------------------------------------------------- note linking */
  /* [[Заголовок]] ties one note to another, the way a wiki does */
  function linkNames(text) {
    var out = [];
    String(text || "").replace(/\[\[([^\[\]\n]{1,80})\]\]/g, function (_, name) {
      var clean = name.trim();
      if (clean && out.indexOf(clean) < 0) out.push(clean);
      return "";
    });
    return out;
  }

  function byTitle(name) {
    var want = String(name || "").trim().toLowerCase();
    return notes.filter(function (n) {
      return (n.title || "").trim().toLowerCase() === want;
    })[0] || null;
  }

  function backlinks(note) {
    if (!note || !note.title) return [];
    var want = note.title.trim().toLowerCase();
    return notes.filter(function (other) {
      if (other.id === note.id) return false;
      return linkNames(other.text).some(function (name) {
        return name.toLowerCase() === want;
      });
    });
  }

  /* render markdown with [[links]] turned into clickable anchors */
  function renderNote(text) {
    var found = [];
    var staged = String(text || "").replace(/\[\[([^\[\]\n]{1,80})\]\]/g, function (_, name) {
      found.push(name.trim());
      return "\u0002" + (found.length - 1) + "\u0002";
    });
    var html = MD.render(staged);
    return html.replace(/\u0002(\d+)\u0002/g, function (_, idx) {
      var name = found[+idx];
      var exists = !!byTitle(name);
      return '<a href="#" class="wikilink' + (exists ? "" : " missing") +
        '" data-note="' + S.esc(name) + '">' + S.esc(name) + "</a>";
    });
  }

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
    var bLink = S.el("button", { class: "btn sm ghost", title: "Вставить ссылку на заметку", text: "[[ ]]" });
    var bGraph = S.el("button", { class: "btn sm ghost", title: "Граф связей", text: "✦" });
    var bCopy = S.el("button", { class: "btn sm ghost", text: "⧉" });
    var bDown = S.el("button", { class: "btn sm ghost", text: "⤓" });
    var bDel = S.el("button", { class: "btn sm ghost danger", text: "×" });
    [titleIn, bLink, bGraph, bPreview, bCopy, bDown, bDel].forEach(function (n) { bar.appendChild(n); });

    var editor = S.el("textarea", {
      class: "field",
      style: "flex:1;border:0;border-radius:0;background:var(--bg-0);padding:16px 18px;font-size:13.5px;resize:none"
    });
    var preview = S.el("div", { class: "chat-log hide" });

    var links = S.el("div", {
      class: "chat-bar",
      style: "border-top:var(--bw) solid var(--line-soft);border-bottom:0;gap:6px"
    });

    main.appendChild(bar);
    main.appendChild(editor);
    main.appendChild(preview);
    main.appendChild(links);
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
      preview.innerHTML = n ? renderNote(n.text) : "";
      drawLinks();
    }

    function touch() {
      var n = active();
      if (!n) return;
      n.title = titleIn.value;
      n.text = editor.value;
      n.updated = Date.now();
      saveNotes();
      preview.innerHTML = renderNote(n.text);
      drawLinks();
    }

    function drawLinks() {
      links.innerHTML = "";
      var n = active();
      if (!n) return;
      var outgoing = linkNames(n.text);
      var incoming = backlinks(n);
      if (!outgoing.length && !incoming.length) {
        links.appendChild(S.el("span", { class: "tiny muted",
          text: "Связей нет. Напишите [[Другая заметка]], чтобы связать." }));
        return;
      }
      if (outgoing.length) {
        links.appendChild(S.el("span", { class: "tiny muted", text: "ведёт к:" }));
        outgoing.forEach(function (name) {
          var exists = !!byTitle(name);
          var chip = S.el("span", {
            class: "chip",
            style: "cursor:pointer" + (exists ? "" : ";opacity:.6;border-style:dashed")
          });
          chip.appendChild(S.el("b", { text: name }));
          chip.addEventListener("click", function () { gotoNote(name); });
          links.appendChild(chip);
        });
      }
      if (incoming.length) {
        links.appendChild(S.el("span", { class: "tiny muted", text: "сюда ссылаются:" }));
        incoming.forEach(function (other) {
          var chip = S.el("span", { class: "chip", style: "cursor:pointer" });
          chip.appendChild(S.el("b", { text: other.title || "Без названия" }));
          chip.addEventListener("click", function () {
            activeId = other.id;
            drawList();
            load();
          });
          links.appendChild(chip);
        });
      }
    }

    function gotoNote(name) {
      var found = byTitle(name);
      if (!found) {
        if (!confirm('Заметки «' + name + '» ещё нет. Создать?')) return;
        found = { id: S.uid("n"), title: name, text: "", updated: Date.now() };
        notes.unshift(found);
        saveNotes();
      }
      activeId = found.id;
      drawList();
      load();
    }

    preview.addEventListener("click", function (e) {
      var link = e.target.closest(".wikilink");
      if (!link) return;
      e.preventDefault();
      gotoNote(link.getAttribute("data-note"));
    });

    bLink.addEventListener("click", function () {
      var items = notes
        .filter(function (n) { return n.id !== activeId; })
        .slice(0, 40)
        .map(function (n) {
          return {
            label: n.title || "Без названия",
            act: function () { insert("[[" + (n.title || "Без названия") + "]]"); }
          };
        });
      if (!items.length) {
        S.toast("Других заметок пока нет", "bad");
        return;
      }
      var rect = bLink.getBoundingClientRect();
      global.Menu.show(rect.left, rect.bottom + 4, items, "Ссылка на заметку");
    });

    function insert(text) {
      var at = editor.selectionStart || 0;
      editor.value = editor.value.slice(0, at) + text + editor.value.slice(editor.selectionEnd || at);
      editor.focus();
      editor.selectionStart = editor.selectionEnd = at + text.length;
      touch();
      drawLinks();
    }

    bGraph.addEventListener("click", openGraph);

    notesApi = {
      openById: function (id) {
        activeId = id;
        drawList();
        load();
        Win.get("notes").focus();
      }
    };

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

  /* -------------------------------------------------------------- graph */
  /* notes as nodes, [[links]] as edges, laid out by repulsion and springs */
  function openGraph() {
    if (Win.get("graph")) { Win.get("graph").focus(); return; }

    var pane = S.el("div", { class: "pane" });
    var bar = S.el("div", { class: "chat-bar" });
    var info = S.el("div", { class: "title tiny" });
    var bRelax = S.el("button", { class: "btn sm ghost", title: "Разложить заново", text: "⟳" });
    var bFit = S.el("button", { class: "btn sm ghost", title: "Вписать в окно", text: "⤢" });
    bar.appendChild(info);
    bar.appendChild(bRelax);
    bar.appendChild(bFit);

    var holder = S.el("div", { style: "flex:1;min-height:0;position:relative;background:var(--bg-0)" });
    var canvas = S.el("canvas", { style: "position:absolute;inset:0;width:100%;height:100%;cursor:grab" });
    holder.appendChild(canvas);
    pane.appendChild(bar);
    pane.appendChild(holder);

    var ctx = canvas.getContext("2d");
    var nodes = [], edges = [], frames = 0, raf = null;
    var drag = null, hover = null;

    function build() {
      nodes = notes.map(function (n, i) {
        var angle = (i / Math.max(1, notes.length)) * Math.PI * 2;
        return {
          id: n.id,
          title: n.title || "Без названия",
          x: Math.cos(angle) * 160 + (Math.random() - 0.5) * 30,
          y: Math.sin(angle) * 160 + (Math.random() - 0.5) * 30,
          vx: 0, vy: 0, deg: 0
        };
      });
      var index = {};
      nodes.forEach(function (n) { index[n.title.trim().toLowerCase()] = n; });

      edges = [];
      notes.forEach(function (note) {
        var from = index[(note.title || "Без названия").trim().toLowerCase()];
        if (!from) return;
        linkNames(note.text).forEach(function (name) {
          var to = index[name.trim().toLowerCase()];
          if (!to || to === from) return;
          edges.push({ a: from, b: to });
          from.deg++;
          to.deg++;
        });
      });
      info.textContent = "заметок " + nodes.length + " · связей " + edges.length;
      frames = 0;
      run();
    }

    function step() {
      var k = 0.0016;
      for (var i = 0; i < nodes.length; i++) {
        var a = nodes[i];
        a.vx -= a.x * k;            /* pull gently toward the centre */
        a.vy -= a.y * k;
        for (var j = i + 1; j < nodes.length; j++) {
          var b = nodes[j];
          var dx = b.x - a.x, dy = b.y - a.y;
          var d2 = dx * dx + dy * dy || 0.01;
          var d = Math.sqrt(d2);
          var push = 2600 / d2;
          var ux = dx / d, uy = dy / d;
          a.vx -= ux * push; a.vy -= uy * push;
          b.vx += ux * push; b.vy += uy * push;
        }
      }
      edges.forEach(function (e) {
        var dx = e.b.x - e.a.x, dy = e.b.y - e.a.y;
        var d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        var force = (d - 110) * 0.012;
        var ux = dx / d, uy = dy / d;
        e.a.vx += ux * force; e.a.vy += uy * force;
        e.b.vx -= ux * force; e.b.vy -= uy * force;
      });
      nodes.forEach(function (n) {
        if (n === drag) { n.vx = n.vy = 0; return; }
        n.vx *= 0.82; n.vy *= 0.82;
        n.x += n.vx; n.y += n.vy;
      });
    }

    function css(name) {
      return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }

    function paint() {
      var ratio = window.devicePixelRatio || 1;
      var w = holder.clientWidth, h = holder.clientHeight;
      if (canvas.width !== w * ratio || canvas.height !== h * ratio) {
        canvas.width = w * ratio;
        canvas.height = h * ratio;
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w / 2, h / 2);

      var accent = css("--acc") || "#c9a227";
      var dim = css("--faint") || "#5d5b57";

      ctx.strokeStyle = dim;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1;
      edges.forEach(function (e) {
        ctx.beginPath();
        ctx.moveTo(e.a.x, e.a.y);
        ctx.lineTo(e.b.x, e.b.y);
        ctx.stroke();
      });
      ctx.globalAlpha = 1;

      nodes.forEach(function (n) {
        var r = 5 + Math.min(7, n.deg * 1.6);
        var on = n === hover || n === drag;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = n.deg ? accent : dim;
        ctx.globalAlpha = on ? 1 : 0.85;
        ctx.fill();
        if (on) {
          ctx.lineWidth = 2;
          ctx.strokeStyle = accent;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = on ? accent : (css("--dim") || "#8e8b85");
        ctx.font = (on ? "600 " : "") + "11px " + (css("--font-ui") || "sans-serif");
        ctx.textAlign = "center";
        ctx.fillText(n.title.slice(0, 22), n.x, n.y + r + 13);
      });
      ctx.restore();
    }

    function run() {
      cancelAnimationFrame(raf);
      (function loop() {
        if (frames < 420 || drag) { step(); frames++; }
        paint();
        raf = requestAnimationFrame(loop);
      })();
    }

    function at(e) {
      var rect = canvas.getBoundingClientRect();
      var x = e.clientX - rect.left - rect.width / 2;
      var y = e.clientY - rect.top - rect.height / 2;
      var best = null, bestD = 18;
      nodes.forEach(function (n) {
        var d = Math.hypot(n.x - x, n.y - y);
        if (d < bestD) { bestD = d; best = n; }
      });
      return { x: x, y: y, node: best };
    }

    canvas.addEventListener("pointerdown", function (e) {
      var hit = at(e);
      if (!hit.node) return;
      drag = hit.node;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
    });
    canvas.addEventListener("pointermove", function (e) {
      var hit = at(e);
      if (drag) { drag.x = hit.x; drag.y = hit.y; return; }
      hover = hit.node;
      canvas.style.cursor = hover ? "pointer" : "grab";
    });
    canvas.addEventListener("pointerup", function (e) {
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
      drag = null;
      canvas.style.cursor = "grab";
    });
    canvas.addEventListener("click", function (e) {
      var hit = at(e);
      if (!hit.node) return;
      openNotes();
      setTimeout(function () {
        if (notesApi) notesApi.openById(hit.node.id);
      }, 60);
    });

    bRelax.addEventListener("click", build);
    bFit.addEventListener("click", function () {
      var scale = 0.82;
      nodes.forEach(function (n) { n.x *= scale; n.y *= scale; });
    });

    build();
    Win.create({
      id: "graph",
      title: "Граф заметок",
      width: 720, height: 540,
      content: pane,
      onClose: function () { cancelAnimationFrame(raf); }
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
    openGraph: openGraph,
    openTasks: openTasks,
    openFiles: openFiles,
    get notes() { return notes; },
    get tasks() { return tasks; }
  };
})(window);
