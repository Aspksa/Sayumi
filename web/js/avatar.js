/* ==========================================================================
   Sayumi avatar: drag anywhere, left click opens the chat,
   right click opens her own settings.
   ========================================================================== */
(function (global) {
  "use strict";

  var node, img, bubble, tag;
  var pos = S.load("avatar.pos", { x: 0.80, y: 0.58 });
  var idleTimer = null;
  var bubbleTimer = null;

  var IDLE_RU = [
    "Я рядом.",
    "Нажми на меня - открою чат.",
    "Правая кнопка - мои настройки.",
    "Меня можно перетащить куда угодно.",
    "Готова к работе.",
    "Что сегодня делаем?"
  ];
  var IDLE_EN = [
    "I am here.",
    "Click me to open the chat.",
    "Right click opens my settings.",
    "You can drag me anywhere.",
    "Ready to work.",
    "What are we building today?"
  ];

  function settings() {
    return (global.Persona && Persona.get()) || {};
  }

  function build() {
    node = S.qs("#avatar");
    img = S.qs("#avatar img");
    bubble = S.qs("#avatar .bubble");
    tag = S.qs("#avatar .tag");

    place();
    style();

    var sx = 0, sy = 0, ox = 0, oy = 0, moved = 0, dragging = false, pid = null;

    node.addEventListener("pointerdown", function (e) {
      if (e.button === 2) return;              /* right button is a menu, not a drag */
      dragging = true;
      moved = 0;
      pid = e.pointerId;
      sx = e.clientX; sy = e.clientY;
      var rect = node.getBoundingClientRect();
      ox = rect.left; oy = rect.top;
      node.classList.add("dragging");
      try { node.setPointerCapture(pid); } catch (err) {}
      hideBubble();
    });

    node.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      var dx = e.clientX - sx;
      var dy = e.clientY - sy;
      moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
      var w = node.offsetWidth, h = node.offsetHeight;
      var x = S.clamp(ox + dx, -w * 0.35, window.innerWidth - w * 0.65);
      var y = S.clamp(oy + dy, 52, window.innerHeight - h * 0.4);
      node.style.left = x + "px";
      node.style.top = y + "px";
    });

    function release(e) {
      if (!dragging) return;
      dragging = false;
      node.classList.remove("dragging");
      try { node.releasePointerCapture(pid); } catch (err) {}
      if (moved < 6) {
        onClick(e);
      } else {
        if (settings().snap) snapToEdge();
        store();
      }
    }
    node.addEventListener("pointerup", release);
    node.addEventListener("pointercancel", function () {
      dragging = false;
      node.classList.remove("dragging");
    });

    node.addEventListener("contextmenu", function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (global.Persona) Persona.openWindow();
    });

    node.addEventListener("dblclick", function (e) { e.preventDefault(); });

    window.addEventListener("resize", S.debounce(place, 120));
    S.on("persona", function () { style(); place(); });

    startIdle();
  }

  function onClick(e) {
    if (e && e.shiftKey) {
      if (global.Persona) Persona.openWindow();
      return;
    }
    if (global.Chat) Chat.openWindow();
    say(greeting(), 2600);
  }

  function greeting() {
    var p = settings();
    if (p.greeting) return p.greeting;
    return S.getLang() === "en" ? "Yes? I am listening." : "Да? Слушаю.";
  }

  function place() {
    if (!node) return;
    var w = node.offsetWidth || 190;
    var h = node.offsetHeight || 260;
    var x = S.clamp(pos.x * window.innerWidth, -w * 0.3, window.innerWidth - w * 0.7);
    var y = S.clamp(pos.y * window.innerHeight, 56, window.innerHeight - h * 0.45);
    node.style.left = Math.round(x) + "px";
    node.style.top = Math.round(y) + "px";
  }

  function store() {
    var rect = node.getBoundingClientRect();
    pos = {
      x: rect.left / Math.max(1, window.innerWidth),
      y: rect.top / Math.max(1, window.innerHeight)
    };
    S.save("avatar.pos", pos);
  }

  function snapToEdge() {
    var rect = node.getBoundingClientRect();
    var mid = rect.left + rect.width / 2;
    var target = mid < window.innerWidth / 2 ? 8 : window.innerWidth - rect.width - 8;
    node.style.transition = "left 220ms ease, top 220ms ease";
    node.style.left = target + "px";
    setTimeout(function () {
      node.style.transition = "";
      store();
    }, 240);
  }

  function style() {
    if (!node) return;
    var p = settings();
    node.style.width = (p.size || 190) + "px";
    node.style.opacity = ((p.opacity === undefined ? 100 : p.opacity) / 100);
    node.style.display = p.hidden ? "none" : "";
    if (img && p.image) img.src = p.image;
    if (tag) tag.textContent = p.name || "Sayumi";
    var aura = S.qs("#avatar .aura");
    if (aura) aura.style.display = p.aura === false ? "none" : "";
  }

  function say(text, ms) {
    if (!bubble || !text) return;
    bubble.textContent = text;
    bubble.classList.add("show");
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(hideBubble, ms || 3200);
  }

  function hideBubble() {
    if (bubble) bubble.classList.remove("show");
  }

  function startIdle() {
    clearInterval(idleTimer);
    idleTimer = setInterval(function () {
      var p = settings();
      if (p.idleTalk === false || p.hidden) return;
      if (document.hidden) return;
      if (Win.get("chat")) return;
      var pool = S.getLang() === "en" ? IDLE_EN : IDLE_RU;
      say(pool[Math.floor(Math.random() * pool.length)], 3400);
    }, 42000);
  }

  function center() {
    pos = { x: 0.5 - (node.offsetWidth / 2) / window.innerWidth, y: 0.4 };
    S.save("avatar.pos", pos);
    place();
  }

  function reset() {
    pos = { x: 0.80, y: 0.58 };
    S.save("avatar.pos", pos);
    place();
  }

  global.Avatar = {
    init: build,
    say: say,
    style: style,
    place: place,
    center: center,
    reset: reset,
    get node() { return node; }
  };
})(window);
