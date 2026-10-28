/* ==========================================================================
   Sayumi notifications: a badge on the avatar and a small panel beside her.

   Toasts vanish; these stay until read. Anything that happens while you were
   looking elsewhere lands here: due tasks, a finished background job, an
   answer that arrived with the chat closed.
   ========================================================================== */
(function (global) {
  "use strict";

  var MAX = 60;

  var KINDS = {
    due:    { icon: "task",    label: "срок" },
    late:   { icon: "task",    label: "просрочено" },
    memory: { icon: "sparkle", label: "память" },
    reply:  { icon: "chat",    label: "ответ" },
    info:   { icon: "info",    label: "" },
    fail:   { icon: "close",   label: "ошибка" }
  };

  var list = S.load("notify", []);
  var panel = null;

  function save() {
    list = list.slice(0, MAX);
    S.save("notify", list);
    S.emit("notify", list);
  }

  function unread() {
    return list.filter(function (n) { return !n.read; }).length;
  }

  function add(kind, text, options) {
    options = options || {};
    /* the same reminder must not pile up twice in one day */
    if (options.once) {
      var exists = list.some(function (n) {
        return n.once === options.once && !n.read;
      });
      if (exists) return null;
    }
    var item = {
      id: S.uid("n"),
      kind: KINDS[kind] ? kind : "info",
      text: String(text || "").slice(0, 200),
      ref: options.ref || null,
      once: options.once || "",
      at: Date.now(),
      read: false
    };
    list.unshift(item);
    save();
    pulse();
    return item;
  }

  function markRead(id) {
    var item = list.filter(function (n) { return n.id === id; })[0];
    if (item) { item.read = true; save(); }
  }

  function readAll() {
    list.forEach(function (n) { n.read = true; });
    save();
  }

  function clear() {
    list = [];
    save();
    close();
  }

  /* ---------------------------------------------------------------- badge */
  function badgeNode() {
    return S.qs("#avatar .badge");
  }

  function paint() {
    var node = badgeNode();
    if (!node) return;
    var count = unread();
    node.textContent = count > 9 ? "9+" : String(count);
    node.classList.toggle("show", count > 0);
    var late = list.some(function (n) { return !n.read && n.kind === "late"; });
    node.classList.toggle("alarm", late);
  }

  function pulse() {
    var node = badgeNode();
    if (!node) return;
    paint();
    node.classList.remove("ping");
    void node.offsetWidth;
    node.classList.add("ping");
  }

  /* ---------------------------------------------------------------- panel */
  function close() {
    if (!panel) return;
    panel.classList.remove("show");
    var dead = panel;
    panel = null;
    setTimeout(function () { dead.remove(); }, 180);
    document.removeEventListener("pointerdown", onOutside, true);
  }

  function onOutside(e) {
    if (!panel) return;
    if (panel.contains(e.target)) return;
    if (e.target.closest && e.target.closest("#avatar")) return;
    close();
  }

  function toggle() {
    if (panel) { close(); return; }
    open();
  }

  function open() {
    close();
    panel = S.el("div", { class: "notif" });

    var head = S.el("header");
    head.innerHTML = I.svg("sparkle") + "<b>Уведомления</b>";
    var bRead = S.el("button", { class: "btn sm ghost", text: "Прочитано" });
    bRead.addEventListener("click", function () { readAll(); render(); });
    var bClear = S.el("button", { class: "btn sm ghost danger", title: "Очистить" });
    bClear.innerHTML = I.svg("trash");
    bClear.addEventListener("click", clear);
    head.appendChild(bRead);
    head.appendChild(bClear);
    panel.appendChild(head);

    var body = S.el("div", { class: "notif-body" });
    panel.appendChild(body);

    function render() {
      body.innerHTML = "";
      if (!list.length) {
        body.appendChild(S.el("div", { class: "empty tiny", text: "Пока тихо" }));
        return;
      }
      list.slice(0, 30).forEach(function (item) {
        var kind = KINDS[item.kind] || KINDS.info;
        var row = S.el("div", { class: "notif-item" + (item.read ? " read" : "") });
        row.appendChild(S.el("span", { class: "ic-wrap" }, I.svg(kind.icon)));
        var wrap = S.el("span", { class: "grow" });
        wrap.appendChild(S.el("div", { text: item.text }));
        wrap.appendChild(S.el("div", {
          class: "tiny muted",
          text: (kind.label ? kind.label + " · " : "") + S.time(item.at)
        }));
        row.appendChild(wrap);
        row.addEventListener("click", function () {
          markRead(item.id);
          if (item.ref) Links.open(item.ref);
          close();
        });
        body.appendChild(row);
      });
    }
    render();

    document.body.appendChild(panel);
    place();
    requestAnimationFrame(function () { panel.classList.add("show"); });
    document.addEventListener("pointerdown", onOutside, true);
  }

  /* the panel sits beside her, flipping to whichever side has room */
  function place() {
    if (!panel) return;
    var avatar = S.qs("#avatar");
    if (!avatar) return;
    var box = avatar.getBoundingClientRect();
    var width = panel.offsetWidth || 300;
    var height = panel.offsetHeight || 320;

    var left = box.left - width - 12;
    if (left < 12) left = box.right + 12;
    if (left + width > window.innerWidth - 12) left = Math.max(12, window.innerWidth - width - 12);

    var top = S.clamp(box.top, 60, Math.max(60, window.innerHeight - height - 36));
    panel.style.left = Math.round(left) + "px";
    panel.style.top = Math.round(top) + "px";
  }

  window.addEventListener("resize", function () { if (panel) place(); });
  S.on("notify", paint);

  global.Notify = {
    add: add, markRead: markRead, readAll: readAll, clear: clear,
    unread: unread, toggle: toggle, open: open, close: close, paint: paint,
    get list() { return list; },
    get isOpen() { return !!panel; }
  };
})(window);
