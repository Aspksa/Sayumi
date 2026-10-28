/* ==========================================================================
   Sayumi bootstrap: top bar wiring, hotkeys, server probe
   ========================================================================== */
(function (global) {
  "use strict";

  function bindTopBar() {
    S.qs("#nav-chat").addEventListener("click", function () { Chat.openWindow(); });
    S.qs("#nav-notes").addEventListener("click", function () { Tools.openNotes(); });
    S.qs("#nav-tasks").addEventListener("click", function () { Tools.openTasks(); });
    S.qs("#nav-files").addEventListener("click", function () { Tools.openFiles(); });
    S.qs("#btn-persona").addEventListener("click", function () { Persona.openWindow(); });
    S.qs("#btn-settings").addEventListener("click", function () { Settings.openWindow(); });

    S.qs("#btn-settings").addEventListener("contextmenu", function (e) {
      e.preventDefault();
      Menu.show(e.clientX, e.clientY, [
        { label: "Оформление", act: function () { Settings.openWindow(); } },
        { label: "Сменить фон", act: cycleBackground },
        { label: "Сменить акцент", act: cycleAccent },
        { sep: true },
        { label: "Следующее сочетание", act: cyclePreset }
      ], "Быстро");
    });
  }

  function cycleBackground() {
    var list = Theme.BACKGROUNDS;
    var i = list.findIndex(function (b) { return b.id === Theme.state.bg; });
    var next = list[(i + 1) % list.length];
    Theme.set({ bg: next.id });
    S.toast("Фон: " + Theme.label(next));
  }

  function cycleAccent() {
    var list = Theme.ACCENTS;
    var i = list.findIndex(function (a) { return a.id === Theme.state.accent; });
    var next = list[(i + 1) % list.length];
    Theme.set({ accent: next.id });
    S.toast("Акцент: " + Theme.label(next));
  }

  function cyclePreset() {
    var list = Theme.PRESETS;
    var i = list.findIndex(function (p) { return p.id === Theme.state.preset; });
    var next = list[(i + 1) % list.length];
    Theme.usePreset(next.id);
    S.toast("Тема: " + Theme.label(next));
  }

  function bindHotkeys() {
    document.addEventListener("keydown", function (e) {
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key === "/") { e.preventDefault(); Win.toggle("chat", Chat.openWindow); }
      else if (e.key === ",") { e.preventDefault(); Settings.openWindow(); }
      else if (e.key === ".") { e.preventDefault(); Persona.openWindow(); }
      else if (e.key === "m") { e.preventDefault(); Memory.openWindow(); }
    });
  }

  function bindStage() {
    var stage = S.qs("#stage");
    stage.addEventListener("contextmenu", function (e) {
      if (e.target.closest(".win") || e.target.closest("#avatar")) return;
      e.preventDefault();
      Menu.show(e.clientX, e.clientY, [
        { label: S.t("chat"), act: function () { Chat.openWindow(); } },
        { label: S.t("notes"), act: function () { Tools.openNotes(); } },
        { label: S.t("tasks"), act: function () { Tools.openTasks(); } },
        { label: S.t("files"), act: function () { Tools.openFiles(); } },
        { label: "Граф заметок", act: function () { Tools.openGraph(); } },
        { label: "Память", act: function () { Memory.openWindow(); } },
        { sep: true },
        { label: S.t("persona"), act: function () { Persona.openWindow(); } },
        { label: S.t("settings"), act: function () { Settings.openWindow(); } }
      ], "Sayumi");
    });
  }

  /* ------------------------------------------------------- status bar --- */
  var clockTimer = null;

  function statusBar() {
    var dot = S.qs("#st-dot");
    var srv = S.qs("#st-server-text");
    var model = S.qs("#st-model");
    var ctxSeg = S.qs("#st-ctx");
    var work = S.qs("#st-work");
    var theme = S.qs("#st-theme");
    var mem = S.qs("#st-mem");
    if (!srv) return;

    dot.className = "dot " + (S.server.up ? "live" : "off");
    srv.textContent = S.server.up
      ? "127.0.0.1:" + (S.server.info ? S.server.info.port : "?")
      : "офлайн";

    var cfg = Chat.config;
    var names = { local: "без модели", openai: "openai", anthropic: "claude", ollama: "ollama" };
    model.innerHTML = I.svg("cpu") + "<b>" +
      S.esc(names[cfg.provider] || cfg.provider) +
      (cfg.provider === "local" ? "" : " " + S.esc(cfg.model)) + "</b>";

    var sessions = Chat.exportAll();
    var open = sessions.filter(function (x) { return x.id === S.load("chat.current", ""); })[0] || sessions[0];
    var msgs = open ? open.messages.length : 0;
    var tok = open ? open.messages.reduce(function (sum, m) { return sum + S.tokens(m.text); }, 0) : 0;
    ctxSeg.innerHTML = I.svg("chat") + "<b>" + msgs + "</b> сообщ · <b>~" + tok + "</b> tok";

    var openTasks = Tools.tasks.filter(function (t) { return !t.done; }).length;
    work.innerHTML = I.svg("note") + "<b>" + Tools.notes.length + "</b> зам · " +
      I.svg("task") + "<b>" + openTasks + "</b> задач";

    var lv = Memory.levelProgress();
    mem.innerHTML = I.svg("sparkle") + "<b>" + Memory.db.facts.length + "</b> пам · ур. <b>" +
      lv.lv + "</b>";

    var st = Theme.state;
    var bg = Theme.BACKGROUNDS.filter(function (b) { return b.id === st.bg; })[0];
    var ac = Theme.ACCENTS.filter(function (a) { return a.id === st.accent; })[0];
    theme.innerHTML = I.svg("palette") + "<b>" + S.esc(Theme.label(bg)) + " · " +
      S.esc(Theme.label(ac)) + "</b>";
  }

  function tickClock() {
    var node = S.qs("#st-clock");
    if (!node) return;
    var d = new Date();
    function pad(n) { return n < 10 ? "0" + n : "" + n; }
    node.textContent = pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  }

  function bindStatusBar() {
    S.qs("#st-server").addEventListener("click", function () {
      S.probeServer().then(function () {
        statusBar();
        S.toast(S.server.up ? S.t("online") : S.t("offline"), S.server.up ? "ok" : "bad");
      });
    });
    S.qs("#st-model").addEventListener("click", function () { Settings.openWindow(); });
    S.qs("#st-work").addEventListener("click", function () { Tools.openTasks(); });
    S.qs("#st-mem").addEventListener("click", function () { Memory.openWindow(); });

    ["server", "theme", "persona", "lang", "memory"].forEach(function (name) {
      S.on(name, statusBar);
    });
    S.on("win:close", statusBar);
    S.on("win:open", statusBar);
    document.addEventListener("click", function (e) {
      if (e.target.closest(".composer")) setTimeout(statusBar, 120);
    }, true);
    S.qs("#st-ctx").classList.add("act");
    S.qs("#st-ctx").addEventListener("click", function () { Chat.openWindow(); });

    /* the clock ticks every second, the rest only needs a lazy refresh */
    clearInterval(clockTimer);
    tickClock();
    var ticks = 0;
    clockTimer = setInterval(function () {
      tickClock();
      if (++ticks % 5 === 0) statusBar();
    }, 1000);
  }

  function paintStatus() {
    var dot = S.qs("#srv-dot");
    var text = S.qs("#srv-text");
    if (!dot) return;
    dot.className = "dot " + (S.server.up ? "live" : "off");
    text.textContent = S.server.up ? S.t("online") : S.t("offline");
    text.title = S.server.up ? S.server.base : "Запустите Sayumi.bat для полного режима";
  }

  function applyLangLabels() {
    S.qs("#nav-chat span").textContent = S.t("chat");
    S.qs("#nav-notes span").textContent = S.t("notes");
    S.qs("#nav-tasks span").textContent = S.t("tasks");
    S.qs("#nav-files span").textContent = S.t("files");
    S.qs("#btn-persona").title = S.t("persona");
    S.qs("#btn-settings").title = S.t("settings");
    paintStatus();
    statusBar();
  }

  function start() {
    document.documentElement.setAttribute("lang", S.getLang());

    /* stored shapes are brought up to date before anything reads them */
    var moved = Migrate.run();
    if (moved.ran && !moved.fresh) {
      S.toast("Данные обновлены до версии " + moved.version, "ok", 3600);
    }

    bindTopBar();
    bindHotkeys();
    bindStage();
    Avatar.init();
    bindStatusBar();
    applyLangLabels();

    S.on("server", paintStatus);
    S.on("lang", applyLangLabels);
    S.on("persona", function () {
      var brandName = S.qs("#brand-name");
      if (brandName) brandName.textContent = Persona.get().name || "Sayumi";
    });

    S.probeServer();
    setInterval(function () { S.probeServer(); }, 60000);

    var seen = S.load("seen", false);
    if (!seen) {
      S.save("seen", true);
      setTimeout(function () {
        Avatar.say(Persona.get().greeting || "Я здесь.", 5200);
      }, 900);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})(window);
