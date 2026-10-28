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
    var bNew = I.btn("plus", { class: "btn sm primary", label: "Заметка" });
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
    var bPreview = I.btn("eye", { title: "Предпросмотр" });
    var bLink = I.btn("brackets", { title: "Вставить ссылку на заметку" });
    var bGraph = I.btn("graph", { title: "Граф связей" });
    var bCopy = I.btn("copy", { title: "Копировать" });
    var bDown = I.btn("download", { title: "Выгрузить в .md" });
    var bDel = I.btn("trash", { class: "btn sm ghost danger", title: "Удалить заметку" });
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
      if (found) {
        activeId = found.id;
        drawList();
        load();
        return;
      }
      Dialog.confirm({
        title: "Заметки ещё нет",
        text: "«" + name + "» пока не существует. Создать её сейчас?",
        ok: "Создать", icon: "plus"
      }).then(function (yes) {
        if (!yes) return;
        var fresh = { id: S.uid("n"), title: name, text: "", updated: Date.now() };
        notes.unshift(fresh);
        saveNotes();
        activeId = fresh.id;
        drawList();
        load();
      });
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
      var victim = active();
      if (!victim) return;
      Dialog.confirm({
        title: "Удалить заметку",
        text: "«" + (victim.title || "Без названия") + "» исчезнет вместе со связями.",
        ok: "Удалить", danger: true
      }).then(function (yes) {
        if (!yes) return;
        notes = notes.filter(function (n) { return n.id !== victim.id; });
        activeId = notes.length ? notes[0].id : null;
        saveNotes();
        drawList();
        load();
      });
    });

    if (!notes.length) bNew.click();
    drawList();
    load();

    Win.create({
      id: "notes",
      title: S.t("notes"),
      weight: 0.94, weightH: 1, minWidth: 540, minHeight: 420,
      content: root
    });
  }

  /* -------------------------------------------------------------- graph */
  /* notes as nodes, [[links]] as curved edges, laid out by repulsion and
     springs. Edges carry drifting sparks so the direction of a link reads
     at a glance; hovering a node dims everything that is not its neighbour. */
  function openGraph() {
    if (Win.get("graph")) { Win.get("graph").focus(); return; }

    var pane = S.el("div", { class: "pane" });
    var bar = S.el("div", { class: "chat-bar" });
    var info = S.el("div", { class: "title tiny" });
    var bRelax = I.btn("refresh", { title: "Разложить заново" });
    var bFit = I.btn("expand", { title: "Вписать в окно" });
    bar.appendChild(info);
    bar.appendChild(bRelax);
    bar.appendChild(bFit);

    var holder = S.el("div", {
      style: "flex:1;min-height:0;position:relative;background:" +
             "radial-gradient(ellipse at 50% 42%, rgba(var(--acc-rgb),.05), transparent 62%), var(--bg-0)"
    });
    var canvas = S.el("canvas", { style: "position:absolute;inset:0;width:100%;height:100%;cursor:grab" });
    holder.appendChild(canvas);
    pane.appendChild(bar);
    pane.appendChild(holder);

    var ctx = canvas.getContext("2d");
    var nodes = [], edges = [], sparks = [];
    var frames = 0, raf = null, born = 0;
    var drag = null, hover = null, near = null;
    var palette = { acc: "#c9a227", accRgb: "201,162,39", dim: "#5d5b57", txt: "#8e8b85", font: "sans-serif" };

    function readPalette() {
      var cs = getComputedStyle(document.documentElement);
      function v(name, fallback) {
        var out = cs.getPropertyValue(name).trim();
        return out || fallback;
      }
      palette.acc = v("--acc", "#c9a227");
      palette.accRgb = v("--acc-rgb", "201,162,39");
      palette.dim = v("--faint", "#5d5b57");
      palette.txt = v("--dim", "#8e8b85");
      palette.font = v("--font-ui", "sans-serif");
    }

    function build() {
      readPalette();
      nodes = notes.map(function (n, i) {
        var angle = (i / Math.max(1, notes.length)) * Math.PI * 2;
        return {
          id: n.id,
          title: n.title || "Без названия",
          updated: n.updated || 0,
          x: Math.cos(angle) * 170 + (Math.random() - 0.5) * 40,
          y: Math.sin(angle) * 170 + (Math.random() - 0.5) * 40,
          vx: 0, vy: 0, deg: 0,
          links: []
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
          from.deg++; to.deg++;
          from.links.push(to);
          to.links.push(from);
        });
      });

      /* one drifting spark per edge, a second one on busy edges */
      sparks = [];
      edges.forEach(function (e, i) {
        sparks.push({ e: e, t: Math.random(), speed: 0.0022 + Math.random() * 0.0016 });
        if (i % 3 === 0) sparks.push({ e: e, t: Math.random(), speed: 0.0018 + Math.random() * 0.0014 });
      });

      info.textContent = "заметок " + nodes.length + " · связей " + edges.length;
      frames = 0;
      centre.x = 0;
      centre.y = 0;
      born = performance.now();
      run();
    }

    /* ------------------------------------------------------------ physics */
    function step() {
      var pull = 0.0016;
      for (var i = 0; i < nodes.length; i++) {
        var a = nodes[i];
        a.vx -= a.x * pull;
        a.vy -= a.y * pull;
        for (var j = i + 1; j < nodes.length; j++) {
          var b = nodes[j];
          var dx = b.x - a.x, dy = b.y - a.y;
          var d2 = dx * dx + dy * dy || 0.01;
          var d = Math.sqrt(d2);
          var push = 2800 / d2;
          var ux = dx / d, uy = dy / d;
          a.vx -= ux * push; a.vy -= uy * push;
          b.vx += ux * push; b.vy += uy * push;
        }
      }
      edges.forEach(function (e) {
        var dx = e.b.x - e.a.x, dy = e.b.y - e.a.y;
        var d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        var force = (d - 118) * 0.012;
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

    /* ------------------------------------------------------------ drawing */
    /* a link is drawn as a quadratic curve bowed away from the straight line */
    function control(e) {
      var mx = (e.a.x + e.b.x) / 2, my = (e.a.y + e.b.y) / 2;
      var dx = e.b.x - e.a.x, dy = e.b.y - e.a.y;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      var bow = Math.min(34, len * 0.17);
      return { x: mx - (dy / len) * bow, y: my + (dx / len) * bow };
    }

    function pointOn(e, t) {
      var c = control(e);
      var inv = 1 - t;
      return {
        x: inv * inv * e.a.x + 2 * inv * t * c.x + t * t * e.b.x,
        y: inv * inv * e.a.y + 2 * inv * t * c.y + t * t * e.b.y
      };
    }

    function radius(n) {
      return 5 + Math.min(8, n.deg * 1.7);
    }

    /* fresh notes glow a little warmer than stale ones */
    function freshness(n) {
      if (!n.updated) return 0;
      var days = (Date.now() - n.updated) / 86400000;
      return S.clamp(1 - days / 21, 0, 1);
    }

    function faded(n) {
      if (!near) return 1;
      return near.has(n) ? 1 : 0.14;
    }

    /* the drawing origin follows the centre of mass, smoothed */
    var centre = { x: 0, y: 0 };
    function recentre() {
      if (!nodes.length) return;
      var sx = 0, sy = 0;
      nodes.forEach(function (n) { sx += n.x; sy += n.y; });
      centre.x += (sx / nodes.length - centre.x) * 0.08;
      centre.y += (sy / nodes.length - centre.y) * 0.08;
    }

    function paint(now) {
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

      /* nodes fly out from the centre when the window opens */
      var grow = S.clamp((now - born) / 620, 0, 1);
      var ease = 1 - Math.pow(1 - grow, 3);
      ctx.scale(0.35 + 0.65 * ease, 0.35 + 0.65 * ease);
      ctx.translate(-centre.x, -centre.y);
      ctx.globalAlpha = ease;

      /* ---- curves */
      ctx.lineCap = "round";
      edges.forEach(function (e) {
        var alpha = Math.min(faded(e.a), faded(e.b));
        var lit = near && near.has(e.a) && near.has(e.b);
        var c = control(e);
        ctx.beginPath();
        ctx.moveTo(e.a.x, e.a.y);
        ctx.quadraticCurveTo(c.x, c.y, e.b.x, e.b.y);
        ctx.strokeStyle = lit ? palette.acc : palette.dim;
        ctx.globalAlpha = ease * alpha * (lit ? 0.75 : 0.4);
        ctx.lineWidth = lit ? 1.6 : 1;
        ctx.stroke();
      });

      /* ---- sparks riding the curves */
      sparks.forEach(function (sp) {
        var alpha = Math.min(faded(sp.e.a), faded(sp.e.b));
        if (alpha < 0.3) return;
        var pt = pointOn(sp.e, sp.t);
        var tail = pointOn(sp.e, Math.max(0, sp.t - 0.07));
        var grad = ctx.createLinearGradient(tail.x, tail.y, pt.x, pt.y);
        grad.addColorStop(0, "rgba(" + palette.accRgb + ",0)");
        grad.addColorStop(1, "rgba(" + palette.accRgb + ",.85)");
        ctx.beginPath();
        ctx.moveTo(tail.x, tail.y);
        ctx.lineTo(pt.x, pt.y);
        ctx.strokeStyle = grad;
        ctx.globalAlpha = ease * alpha;
        ctx.lineWidth = 2;
        ctx.stroke();
      });

      /* ---- nodes with a soft drop shadow for depth */
      nodes.forEach(function (n) {
        var r = radius(n);
        var on = n === hover || n === drag;
        var alpha = faded(n);
        ctx.globalAlpha = ease * alpha;

        ctx.beginPath();
        ctx.ellipse(n.x + 1.5, n.y + r * 0.95, r * 0.95, r * 0.34, 0, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,.55)";
        ctx.filter = "blur(2px)";
        ctx.fill();
        ctx.filter = "none";

        if (n.deg) {
          ctx.shadowColor = "rgba(" + palette.accRgb + ",.55)";
          ctx.shadowBlur = on ? 20 : 11;
        }
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        var warm = freshness(n);
        ctx.fillStyle = n.deg
          ? "rgba(" + palette.accRgb + "," + (0.55 + warm * 0.45).toFixed(2) + ")"
          : palette.dim;
        ctx.fill();
        ctx.shadowBlur = 0;

        if (on) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + 4, 0, Math.PI * 2);
          ctx.strokeStyle = palette.acc;
          ctx.lineWidth = 1.6;
          ctx.stroke();
        }
      });

      /* ---- labels: hubs always, the rest only when pointed at */
      var crowded = nodes.length > 14;
      nodes.forEach(function (n) {
        var on = n === hover || n === drag;
        var neighbour = near && near.has(n);
        if (crowded && !on && !neighbour && n.deg < 2) return;
        var r = radius(n);
        ctx.globalAlpha = ease * faded(n) * (on || neighbour ? 1 : 0.75);
        ctx.fillStyle = on ? palette.acc : palette.txt;
        ctx.font = (on ? "600 " : "") + "11px " + palette.font;
        ctx.textAlign = "center";
        ctx.fillText(n.title.slice(0, 24), n.x, n.y + r + 14);
      });

      ctx.restore();
      ctx.globalAlpha = 1;
    }

    function run() {
      cancelAnimationFrame(raf);
      (function loop(now) {
        now = now || performance.now();
        if (frames < 420 || drag) { step(); frames++; }
        recentre();
        sparks.forEach(function (sp) {
          sp.t += sp.speed;
          if (sp.t > 1) sp.t -= 1;
        });
        paint(now);
        raf = requestAnimationFrame(loop);
      })();
    }

    /* ------------------------------------------------------------- input */
    function at(e) {
      var rect = canvas.getBoundingClientRect();
      var grow = S.clamp((performance.now() - born) / 620, 0, 1);
      var ease = 1 - Math.pow(1 - grow, 3);
      var zoom = 0.35 + 0.65 * ease;
      var x = (e.clientX - rect.left - rect.width / 2) / zoom + centre.x;
      var y = (e.clientY - rect.top - rect.height / 2) / zoom + centre.y;
      var best = null, bestD = 20;
      nodes.forEach(function (n) {
        var d = Math.hypot(n.x - x, n.y - y);
        if (d < bestD) { bestD = d; best = n; }
      });
      return { x: x, y: y, node: best };
    }

    function setHover(node) {
      hover = node;
      if (!node) { near = null; return; }
      near = new Set([node]);
      node.links.forEach(function (n) { near.add(n); });
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
      setHover(hit.node);
      canvas.style.cursor = hover ? "pointer" : "grab";
    });
    canvas.addEventListener("pointerleave", function () { setHover(null); });
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
      nodes.forEach(function (n) { n.x *= 0.82; n.y *= 0.82; });
    });
    S.on("theme", readPalette);

    build();
    Win.create({
      id: "graph",
      title: "Граф заметок",
      weight: 0.9, weightH: 1, minWidth: 520, minHeight: 440,
      content: pane,
      onClose: function () { cancelAnimationFrame(raf); }
    });
  }

  /* -------------------------------------------------------------- tasks */
  var COLUMNS = [
    { id: "todo", label: "Надо сделать", icon: "note" },
    { id: "doing", label: "В работе", icon: "refresh" },
    { id: "done", label: "Готово", icon: "check" }
  ];
  var PRIORITY = { low: "низкий", normal: "обычный", high: "важно" };

  /* older tasks only had a done flag; give everything a column and a priority */
  function normaliseTasks() {
    var touched = false;
    tasks.forEach(function (t) {
      if (!t.col) { t.col = t.done ? "done" : "todo"; touched = true; }
      if (!t.prio) { t.prio = "normal"; touched = true; }
      if (t.due === undefined) { t.due = ""; touched = true; }
    });
    if (touched) saveTasks();
  }

  /* Compare calendar days, not timestamps: a task due yesterday at 23:59 is
     overdue by ten hours, and rounding that by the clock called it "today". */
  function daysUntil(dateText) {
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var due = new Date(dateText + "T00:00:00");
    if (isNaN(due.getTime())) return null;
    due.setHours(0, 0, 0, 0);
    return Math.round((due.getTime() - today.getTime()) / 86400000);
  }

  function dueState(task) {
    if (!task.due || task.col === "done") return null;
    var days = daysUntil(task.due);
    if (days === null) return null;
    if (days < 0) return { kind: "late", text: "просрочено на " + Math.abs(days) + " дн." };
    if (days === 0) return { kind: "today", text: "сегодня" };
    if (days === 1) return { kind: "soon", text: "завтра" };
    if (days <= 3) return { kind: "soon", text: "через " + days + " дн." };
    return { kind: "far", text: task.due };
  }

  function openTasks() {
    if (Win.get("tasks")) { Win.get("tasks").focus(); return; }
    normaliseTasks();

    var pane = S.el("div", { class: "pane" });
    var bar = S.el("div", { class: "chat-bar" });
    var input = S.el("input", { class: "search", placeholder: "Новая задача, Enter — добавить" });
    var view = S.el("select", { style: "width:130px" });
    [["board", "Доска"], ["list", "Список"]].forEach(function (o) {
      view.appendChild(S.el("option", { value: o[0], text: o[1] }));
    });
    view.value = S.load("tasks.view", "board");
    var bClear = I.btn("trash", { class: "btn sm ghost danger", label: "Убрать готовые" });
    bar.appendChild(input);
    bar.appendChild(view);
    bar.appendChild(bClear);

    var body = S.el("div", { class: "pane-body" });
    pane.appendChild(bar);
    pane.appendChild(body);

    function taskCard(task) {
      var node = S.el("div", {
        class: "task" + (task.col === "done" ? " done" : "") + " prio-" + task.prio,
        draggable: "true",
        "data-id": task.id
      });

      var text = S.el("div", { class: "t-text", text: task.text });
      text.addEventListener("dblclick", function () {
        Dialog.prompt({ title: "Изменить задачу", value: task.text }).then(function (v) {
          if (!v) return;
          task.text = v;
          saveTasks();
          draw();
        });
      });
      node.appendChild(text);

      var foot = S.el("div", { class: "t-foot" });
      var state = dueState(task);
      if (state) {
        foot.appendChild(S.el("span", { class: "t-due " + state.kind, text: state.text }));
      } else if (task.due) {
        foot.appendChild(S.el("span", { class: "t-due far", text: task.due }));
      }
      if (task.prio !== "normal") {
        foot.appendChild(S.el("span", { class: "t-prio", text: PRIORITY[task.prio] }));
      }
      foot.appendChild(S.el("span", { class: "grow" }));

      var bDate = I.btn("refresh", { title: "Срок" });
      bDate.addEventListener("click", function () {
        Dialog.prompt({
          title: "Срок задачи",
          text: "Дата в виде 2026-11-20. Пусто — убрать срок.",
          value: task.due || "",
          allowEmpty: true
        }).then(function (v) {
          if (v === null) return;
          task.due = (v || "").trim();
          saveTasks();
          draw();
        });
      });
      var bPrio = I.btn("star", { title: "Важность" });
      bPrio.addEventListener("click", function () {
        var order = ["low", "normal", "high"];
        task.prio = order[(order.indexOf(task.prio) + 1) % order.length];
        saveTasks();
        draw();
      });
      var bChat = I.btn("arrowRight", { title: "Обсудить в чате" });
      bChat.addEventListener("click", function () {
        Chat.openWindow();
        setTimeout(function () {
          var box = S.qs(".composer textarea");
          if (box) { box.value = "Помоги с задачей: " + task.text; box.focus(); }
        }, 120);
      });
      var bDel = I.btn("close", { class: "btn sm ghost danger", title: "Удалить" });
      bDel.addEventListener("click", function () {
        tasks = tasks.filter(function (o) { return o.id !== task.id; });
        saveTasks();
        draw();
      });
      [bDate, bPrio, bChat, bDel].forEach(function (b) { foot.appendChild(b); });
      node.appendChild(foot);

      node.addEventListener("dragstart", function (e) {
        e.dataTransfer.setData("text/plain", task.id);
        node.classList.add("dragging");
      });
      node.addEventListener("dragend", function () { node.classList.remove("dragging"); });
      return node;
    }

    function drawBoard() {
      var board = S.el("div", { class: "board" });
      COLUMNS.forEach(function (col) {
        var items = tasks.filter(function (t) { return t.col === col.id; });
        var column = S.el("div", { class: "column", "data-col": col.id });
        var head = S.el("header");
        head.innerHTML = I.svg(col.icon) + "<b>" + col.label + "</b>" +
          '<span class="count">' + items.length + "</span>";
        column.appendChild(head);

        var slot = S.el("div", { class: "slot" });
        items
          .sort(function (a, b) {
            var rank = { high: 0, normal: 1, low: 2 };
            if (rank[a.prio] !== rank[b.prio]) return rank[a.prio] - rank[b.prio];
            if (!!a.due !== !!b.due) return a.due ? -1 : 1;
            return (a.due || "").localeCompare(b.due || "");
          })
          .forEach(function (t) { slot.appendChild(taskCard(t)); });
        if (!items.length) slot.appendChild(S.el("div", { class: "empty tiny", text: "пусто" }));

        slot.addEventListener("dragover", function (e) {
          e.preventDefault();
          column.classList.add("over");
        });
        slot.addEventListener("dragleave", function () { column.classList.remove("over"); });
        slot.addEventListener("drop", function (e) {
          e.preventDefault();
          column.classList.remove("over");
          var id = e.dataTransfer.getData("text/plain");
          var task = tasks.filter(function (t) { return t.id === id; })[0];
          if (!task) return;
          task.col = col.id;
          task.done = col.id === "done";
          task.updated = Date.now();
          saveTasks();
          draw();
        });

        column.appendChild(slot);
        board.appendChild(column);
      });
      body.appendChild(board);
    }

    function drawList() {
      var open = tasks.filter(function (t) { return t.col !== "done"; });
      var done = tasks.filter(function (t) { return t.col === "done"; });
      var list = S.el("div", { class: "list" });
      open.concat(done).forEach(function (t) {
        var item = S.el("div", { class: "item" + (t.col === "done" ? " done" : "") });
        var cb = S.el("span", { class: "cb" }, t.col === "done" ? I.svg("check") : "");
        cb.addEventListener("click", function () {
          t.col = t.col === "done" ? "todo" : "done";
          t.done = t.col === "done";
          saveTasks();
          draw();
        });
        item.appendChild(cb);
        item.appendChild(S.el("span", { class: "grow", text: t.text }));
        var state = dueState(t);
        if (state) item.appendChild(S.el("span", { class: "t-due " + state.kind, text: state.text }));
        list.appendChild(item);
      });
      if (!tasks.length) list.appendChild(S.el("div", { class: "empty", text: "Список пуст" }));
      body.appendChild(list);
    }

    function draw() {
      body.innerHTML = "";
      var late = tasks.filter(function (t) {
        var st = dueState(t);
        return st && st.kind === "late";
      }).length;
      var soon = tasks.filter(function (t) {
        var st = dueState(t);
        return st && (st.kind === "today" || st.kind === "soon");
      }).length;

      var stat = S.el("div", { class: "note tiny" });
      stat.textContent = "всего " + tasks.length +
        " · активных " + tasks.filter(function (t) { return t.col !== "done"; }).length +
        (soon ? " · скоро " + soon : "") +
        (late ? " · просрочено " + late : "");
      body.appendChild(stat);

      if (view.value === "board") drawBoard();
      else drawList();
    }

    input.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      var v = input.value.trim();
      if (!v) return;
      /* "купить хлеб !важно 2026-11-20" sets priority and date inline */
      var prio = "normal";
      if (/!важно|!high/i.test(v)) { prio = "high"; v = v.replace(/!важно|!high/ig, ""); }
      if (/!потом|!low/i.test(v)) { prio = "low"; v = v.replace(/!потом|!low/ig, ""); }
      var due = "";
      var date = v.match(/\b(\d{4}-\d{2}-\d{2})\b/);
      if (date) { due = date[1]; v = v.replace(date[1], ""); }
      tasks.unshift({
        id: S.uid("t"), text: v.trim().replace(/\s+/g, " "),
        col: "todo", done: false, prio: prio, due: due, updated: Date.now()
      });
      input.value = "";
      saveTasks();
      draw();
    });
    view.addEventListener("change", function () {
      S.save("tasks.view", view.value);
      draw();
    });
    bClear.addEventListener("click", function () {
      var count = tasks.filter(function (t) { return t.col === "done"; }).length;
      if (!count) { S.toast("Готовых задач нет", "bad"); return; }
      Dialog.confirm({
        title: "Убрать готовые",
        text: "Будет удалено задач: " + count + ".",
        ok: "Убрать", danger: true
      }).then(function (yes) {
        if (!yes) return;
        tasks = tasks.filter(function (t) { return t.col !== "done"; });
        saveTasks();
        draw();
      });
    });

    draw();
    Win.create({
      id: "tasks", title: S.t("tasks"), content: pane,
      weight: 1, weightH: 0.96, minWidth: 560, minHeight: 420
    });
  }

  /* ------------------------------------------------------- reminders --- */
  /* A quiet check that surfaces what is due, at most once per task per day */
  function checkDue() {
    normaliseTasks();
    var seen = S.load("tasks.reminded", {});
    var today = new Date().toISOString().slice(0, 10);
    var hits = [];
    tasks.forEach(function (t) {
      var state = dueState(t);
      if (!state || state.kind === "far") return;
      if (seen[t.id] === today) return;
      seen[t.id] = today;
      hits.push({ task: t, state: state });
    });
    if (!hits.length) return;
    S.save("tasks.reminded", seen);

    hits.slice(0, 3).forEach(function (hit, i) {
      setTimeout(function () {
        S.toast((hit.state.kind === "late" ? "Просрочено: " : "Срок: ") + hit.task.text,
          hit.state.kind === "late" ? "bad" : "", 5200);
      }, 900 + i * 1400);
    });
    if (global.Avatar) {
      Avatar.say(hits.length === 1 ? "Срок: " + hits[0].task.text
                                   : "Подходят сроки у " + hits.length + " задач", 5200);
    }
  }

  /* -------------------------------------------------------------- files */
  function openFiles() {
    if (Win.get("files")) { Win.get("files").focus(); return; }

    var pane = S.el("div", { class: "pane" });
    var bar = S.el("div", { class: "chat-bar" });
    var path = S.el("div", { class: "title mono", text: "workspace/" });
    var bUp = I.btn("arrowUp", { title: "На уровень выше" });
    var bRefresh = I.btn("refresh", { title: "Обновить" });
    var bNew = I.btn("plus", { label: "файл" });
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
          item.appendChild(S.el("span", { class: "ic-wrap" }, I.svg(entry.dir ? "folder" : "file")));
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
        var bBack = I.btn("arrowUp", { class: "btn sm", label: "назад" });
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
      Dialog.prompt({
        title: "Новый файл",
        text: "Он появится в рабочей папке" + (dir ? ", в " + dir : "") + ".",
        value: "notes.md"
      }).then(function (name) {
        if (!name) return;
        S.api("/api/file", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: (dir ? dir + "/" : "") + name, text: "" })
        }).then(draw);
      });
    });

    draw();
    Win.create({
      id: "files", title: S.t("files"), content: pane,
      weight: 0.82, weightH: 0.94, minWidth: 460, minHeight: 400
    });
  }

  global.Tools = {
    openNotes: openNotes,
    checkDue: checkDue,
    dueState: dueState,
    openGraph: openGraph,
    openTasks: openTasks,
    openFiles: openFiles,
    get notes() { return notes; },
    get tasks() { return tasks; }
  };
})(window);
