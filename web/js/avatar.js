/* ==========================================================================
   Sayumi avatar: drag anywhere, left click opens the chat,
   right click opens her own settings.
   ========================================================================== */
(function (global) {
  "use strict";

  var node, img, blinkImg, bubble, tag;
  var pos = S.load("avatar.pos", { x: 0.80, y: 0.58 });
  var idleTimer = null;
  var bubbleTimer = null;
  var blinkTimer = null;
  var hideTimer = null;

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
    img = S.qs("#avatar img.figure");
    blinkImg = S.qs("#avatar img.blink");
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

    /* wheel over her changes the size */
    node.addEventListener("wheel", function (e) {
      if (!settings().wheelSize) return;
      e.preventDefault();
      var step = e.deltaY < 0 ? 8 : -8;
      var next = S.clamp((settings().size || 190) + step, 90, 420);
      if (global.Persona) Persona.set({ size: next });
      style();
      place();
      say(Math.round(next) + " px", 900);
    }, { passive: false });

    window.addEventListener("resize", S.debounce(place, 120));
    S.on("persona", function () { style(); place(); startBlink(); });

    watchTyping();
    startIdle();
    startBlink();
  }

  /* ------------------------------------------------------------- blinking */
  function startBlink() {
    clearTimeout(blinkTimer);
    if (!blinkImg) return;
    var p = settings();
    if (!p.imageBlink || p.alive === false || p.hidden) {
      blinkImg.removeAttribute("src");
      node.classList.remove("blinking");
      return;
    }
    blinkImg.src = p.imageBlink;
    (function loop() {
      blinkTimer = setTimeout(function () {
        if (!document.hidden && !node.classList.contains("dragging")) {
          node.classList.add("blinking");
          setTimeout(function () { node.classList.remove("blinking"); }, 130);
          /* now and then a double blink, the way people actually do it */
          if (Math.random() < 0.3) {
            setTimeout(function () {
              node.classList.add("blinking");
              setTimeout(function () { node.classList.remove("blinking"); }, 120);
            }, 290);
          }
        }
        loop();
      }, 2600 + Math.random() * 4200);
    })();
  }

  /* -------------------------------------------- fade out while you type */
  function watchTyping() {
    document.addEventListener("input", function (e) {
      if (!settings().autoHide) return;
      var tag = (e.target.tagName || "").toLowerCase();
      if (tag !== "textarea" && tag !== "input") return;
      node.classList.add("away");
      clearTimeout(hideTimer);
      hideTimer = setTimeout(function () { node.classList.remove("away"); }, 1400);
    }, true);

    document.addEventListener("pointerdown", function (e) {
      if (!node.classList.contains("away")) return;
      if (e.target.closest("textarea, input")) return;
      clearTimeout(hideTimer);
      node.classList.remove("away");
    }, true);
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

    var alive = p.alive !== false;
    node.classList.toggle("alive", alive);
    var power = (p.aliveLevel === undefined ? 50 : p.aliveLevel) / 50;
    node.style.setProperty("--swayY", (3 * power).toFixed(2) + "px");
    node.style.setProperty("--swayR", (0.4 * power).toFixed(2) + "deg");
    node.style.setProperty("--sway", (9 - 3.5 * power).toFixed(1) + "s");
    if (!alive) node.classList.remove("blinking");

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
    blink: startBlink,
    say: say,
    style: style,
    place: place,
    center: center,
    reset: reset,
    get node() { return node; }
  };
})(window);
