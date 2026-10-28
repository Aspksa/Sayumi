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
        { sep: true },
        { label: S.t("persona"), act: function () { Persona.openWindow(); } },
        { label: S.t("settings"), act: function () { Settings.openWindow(); } }
      ], "Sayumi");
    });
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
  }

  function start() {
    document.documentElement.setAttribute("lang", S.getLang());
    bindTopBar();
    bindHotkeys();
    bindStage();
    Avatar.init();
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
