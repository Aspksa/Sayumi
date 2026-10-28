/* ==========================================================================
   Sayumi project settings - the gear icon in the top bar
   ========================================================================== */
(function (global) {
  "use strict";

  var PAGES = {
    look:  { ru: "Оформление", en: "Appearance" },
    ui:    { ru: "Интерфейс",  en: "Interface" },
    model: { ru: "Модель",     en: "Model" },
    data:  { ru: "Данные",     en: "Data" },
    about: { ru: "О проекте",  en: "About" }
  };

  var active = "look";

  function openWindow() {
    if (Win.get("settings")) { Win.get("settings").focus(); return; }

    var pane = S.el("div", { class: "pane" });
    var tabs = S.el("div", { class: "tabs" });
    var body = S.el("div", { class: "pane-body" });
    pane.appendChild(tabs);
    pane.appendChild(body);

    Object.keys(PAGES).forEach(function (key) {
      var b = S.el("button", {
        class: "tab" + (key === active ? " on" : ""),
        text: S.getLang() === "en" ? PAGES[key].en : PAGES[key].ru
      });
      b.addEventListener("click", function () {
        active = key;
        S.qsa(".tab", tabs).forEach(function (t) { t.classList.remove("on"); });
        b.classList.add("on");
        render();
      });
      tabs.appendChild(b);
    });

    function render() {
      body.innerHTML = "";
      ({ look: drawLook, ui: drawUI, model: drawModel, data: drawData, about: drawAbout })[active](body, render);
    }
    render();

    Win.create({
      id: "settings",
      title: S.t("settings"),
      width: 680,
      height: 600,
      content: pane
    });
  }

  /* ------------------------------------------------------------ helpers */
  function section(parent, title, note) {
    var sec = S.el("div", { class: "sec" });
    sec.appendChild(S.el("h3", { text: title }));
    if (note) sec.appendChild(S.el("div", { class: "note", text: note }));
    parent.appendChild(sec);
    return sec;
  }

  function rowSelect(parent, label, options, value, onChange, note) {
    var row = S.el("div", { class: "row" });
    var lab = S.el("div", { class: "lab" });
    lab.appendChild(document.createTextNode(label));
    if (note) lab.appendChild(S.el("small", { text: note }));
    row.appendChild(lab);
    var sel = S.el("select");
    options.forEach(function (o) {
      sel.appendChild(S.el("option", { value: o[0], text: o[1] }));
    });
    sel.value = value;
    sel.addEventListener("change", function () { onChange(sel.value); });
    var ctl = S.el("div", { class: "ctl" });
    ctl.appendChild(sel);
    row.appendChild(ctl);
    parent.appendChild(row);
    return sel;
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

  function rowText(parent, label, value, onChange, type) {
    var row = S.el("div", { class: "row" });
    row.appendChild(S.el("div", { class: "lab", text: label }));
    var ctl = S.el("div", { class: "ctl" });
    var input = S.el("input", { type: type || "text", value: value || "" });
    input.addEventListener("change", function () { onChange(input.value); });
    ctl.appendChild(input);
    row.appendChild(ctl);
    parent.appendChild(row);
    return input;
  }

  function swatchCard(entry, isOn, fill, onPick) {
    var wrap = S.el("div", { class: "sw-wrap" + (isOn ? " on" : ""), title: Theme.label(entry) });
    var sw = S.el("div", { class: "swatch" + (isOn ? " on" : "") });
    sw.style.background = fill;
    wrap.appendChild(sw);
    wrap.appendChild(S.el("span", { text: Theme.label(entry) }));
    wrap.addEventListener("click", onPick);
    return wrap;
  }

  /* --------------------------------------------------------- appearance */
  function drawLook(root, redraw) {
    var st = Theme.state;

    var sec0 = section(root, "Готовые сочетания",
      "Подобранные пары фона и акцента — нажмите, чтобы применить целиком.");
    var grid = S.el("div", { class: "presets" });
    Theme.PRESETS.forEach(function (p) {
      var bgHex = Theme.BACKGROUNDS.filter(function (b) { return b.id === p.bg; })[0].hex;
      var acHex = Theme.ACCENTS.filter(function (a) { return a.id === p.accent; })[0].hex;
      var card = S.el("div", { class: "preset" + (st.preset === p.id ? " on" : "") });
      card.style.background = bgHex;
      card.appendChild(S.el("div", { class: "nm", text: Theme.label(p), style: "color:" + acHex }));
      var strip = S.el("div", { class: "strip" });
      strip.appendChild(S.el("i", { style: "background:" + bgHex }));
      strip.appendChild(S.el("i", { style: "background:" + acHex }));
      strip.appendChild(S.el("i", { style: "background:" + acHex + "55" }));
      strip.appendChild(S.el("i", { style: "background:#ffffff14" }));
      card.appendChild(strip);
      card.addEventListener("click", function () { Theme.usePreset(p.id); redraw(); });
      grid.appendChild(card);
    });
    sec0.appendChild(grid);

    var sec1 = section(root, "Фон", "Основной цвет всего интерфейса.");
    var bgRow = S.el("div", { class: "swatches" });
    Theme.BACKGROUNDS.forEach(function (b) {
      bgRow.appendChild(swatchCard(b, st.bg === b.id, b.hex, function () {
        Theme.set({ bg: b.id });
        redraw();
      }));
    });
    sec1.appendChild(bgRow);

    var sec2 = section(root, "Цвет кнопок и меню", "Акцент применяется к кнопкам, рамкам и подсветке.");
    var acRow = S.el("div", { class: "swatches" });
    Theme.ACCENTS.forEach(function (a) {
      var fill = "linear-gradient(135deg," + a.hex + " 0%," + a.hex + "aa 70%," + a.hex + "55 100%)";
      acRow.appendChild(swatchCard(a, st.accent === a.id, fill, function () {
        Theme.set({ accent: a.id });
        redraw();
      }));
    });
    sec2.appendChild(acRow);

    var sec3 = section(root, "Детали оформления");
    rowSelect(sec3, "Текстура фона", [
      ["none", "Нет"], ["vignette", "Виньетка"], ["grid", "Сетка"],
      ["rays", "Лучи"], ["noise", "Зерно"]
    ], st.texture, function (v) { Theme.set({ texture: v }); });

    rowSelect(sec3, "Углы", [
      ["sharp", "Прямые"], ["soft", "Мягкие"], ["round", "Круглые"]
    ], st.corners, function (v) { Theme.set({ corners: v }); });

    rowSelect(sec3, "Плотность", [
      ["compact", "Плотно"], ["cozy", "Обычно"], ["roomy", "Просторно"]
    ], st.density, function (v) { Theme.set({ density: v }); });

    rowRange(sec3, "Размер шрифта", st.fontScale, 85, 125, 1,
      function (v) { Theme.set({ fontScale: v }); }, " %");

    rowSwitch(sec3, "Свечение акцента", st.glow === "on",
      function (v) { Theme.set({ glow: v ? "on" : "off" }); }, "Мягкий ореол вокруг активных элементов");

    rowSwitch(sec3, "Анимации", st.motion === "on",
      function (v) { Theme.set({ motion: v ? "on" : "off" }); }, "Выключите, если интерфейс подтормаживает");

    var acts = S.el("div", { class: "inline" });
    var bReset = S.el("button", { class: "btn danger", text: "Сбросить оформление" });
    bReset.addEventListener("click", function () { Theme.reset(); redraw(); });
    acts.appendChild(bReset);
    root.appendChild(acts);
  }

  /* ---------------------------------------------------------- interface */
  function drawUI(root, redraw) {
    var cfg = Chat.config;

    var sec = section(root, "Общее");
    rowSelect(sec, "Язык интерфейса", [["ru", "Русский"], ["en", "English"]],
      S.getLang(), function (v) { S.setLang(v); redraw(); });

    rowSwitch(sec, "Enter отправляет сообщение", cfg.sendOnEnter,
      function (v) { Chat.setConfig({ sendOnEnter: v }); },
      "Выключено — отправка по Ctrl+Enter");

    rowSwitch(sec, "Показывать время сообщений", cfg.showTimestamps,
      function (v) { Chat.setConfig({ showTimestamps: v }); });

    var sec2 = section(root, "Аватар");
    var p = Persona.get();
    rowSwitch(sec2, "Показывать аватар", !p.hidden, function (v) {
      Persona.set({ hidden: !v });
      Avatar.style();
    });
    rowSwitch(sec2, "Прилипание к краю", p.snap, function (v) { Persona.set({ snap: v }); });
    var acts2 = S.el("div", { class: "inline" });
    var bOpen = S.el("button", { class: "btn", text: "Открыть настройки Sayumi" });
    bOpen.addEventListener("click", function () { Persona.openWindow(); });
    var bPos = S.el("button", { class: "btn", text: "Вернуть аватар на место" });
    bPos.addEventListener("click", function () { Avatar.reset(); });
    acts2.appendChild(bOpen);
    acts2.appendChild(bPos);
    sec2.appendChild(acts2);

    var sec3 = section(root, "Окна");
    var acts3 = S.el("div", { class: "inline" });
    var bWins = S.el("button", { class: "btn", text: "Сбросить положение окон" });
    bWins.addEventListener("click", function () {
      S.allKeys().forEach(function (k) { if (k.indexOf("win.") === 0) S.drop(k); });
      S.toast("Положение окон сброшено — откройте их заново", "ok");
    });
    var bClose = S.el("button", { class: "btn", text: "Закрыть все окна" });
    bClose.addEventListener("click", function () {
      Object.keys(Win.open).forEach(function (k) {
        if (k !== "settings") Win.open[k].close();
      });
    });
    acts3.appendChild(bWins);
    acts3.appendChild(bClose);
    sec3.appendChild(acts3);

    var sec4 = section(root, "Горячие клавиши");
    var keys = [
      ["Ctrl + /", "открыть или закрыть чат"],
      ["Ctrl + ,", "настройки проекта"],
      ["Ctrl + .", "настройки Sayumi"],
      ["Enter", "отправить сообщение"],
      ["Shift + Enter", "перенос строки"],
      ["Esc", "прервать ответ, закрыть меню"]
    ];
    var list = S.el("div", { class: "list" });
    keys.forEach(function (k) {
      var item = S.el("div", { class: "item" });
      item.appendChild(S.el("span", { class: "mono gold", text: k[0], style: "min-width:120px" }));
      item.appendChild(S.el("span", { class: "grow muted", text: k[1] }));
      list.appendChild(item);
    });
    sec4.appendChild(list);
  }

  /* -------------------------------------------------------------- model */
  function drawModel(root, redraw) {
    var cfg = Chat.config;

    var sec = section(root, "Подключение модели",
      "Без модели Sayumi работает автономно: заметки, задачи, файлы и инструменты остаются доступны.");

    rowSelect(sec, "Провайдер", [
      ["local", "Автономно, без модели"],
      ["openai", "OpenAI-совместимый"],
      ["anthropic", "Anthropic"],
      ["ollama", "Ollama, локально"]
    ], cfg.provider, function (v) {
      var patch = { provider: v };
      if (v === "ollama" && !/:/.test(cfg.model)) patch.model = "llama3.1";
      if (v === "anthropic") patch.model = "claude-sonnet-4-5";
      if (v === "openai") patch.model = "gpt-4o-mini";
      Chat.setConfig(patch);
      redraw();
    });

    if (cfg.provider !== "local") {
      rowText(sec, "Модель", cfg.model, function (v) { Chat.setConfig({ model: v }); });
      rowText(sec, "Base URL", cfg.baseUrl, function (v) { Chat.setConfig({ baseUrl: v }); });
      if (cfg.provider !== "ollama") {
        var keyInput = rowText(sec, "API ключ", cfg.apiKey, function (v) { Chat.setConfig({ apiKey: v }); }, "password");
        keyInput.setAttribute("autocomplete", "off");
        sec.appendChild(S.el("div", { class: "note tiny",
          text: "Ключ хранится только в этом браузере, на вашем компьютере." }));
      }
    }

    var sec2 = section(root, "Параметры генерации");
    rowRange(sec2, "Температура", cfg.temperature, 0, 2, 0.05,
      function (v) { Chat.setConfig({ temperature: v }); });
    rowRange(sec2, "Максимум токенов", cfg.maxTokens, 256, 8192, 64,
      function (v) { Chat.setConfig({ maxTokens: v }); });
    rowRange(sec2, "Сообщений в контексте", cfg.contextLimit, 4, 60, 1,
      function (v) { Chat.setConfig({ contextLimit: v }); });
    rowSwitch(sec2, "Потоковый ответ", cfg.stream,
      function (v) { Chat.setConfig({ stream: v }); }, "Текст появляется по мере генерации");
    rowSwitch(sec2, "Озвучивать ответы", cfg.tts,
      function (v) { Chat.setConfig({ tts: v }); });

    var sec3 = section(root, "Проверка");
    var out = S.el("div", { class: "note tiny muted", text: "" });
    var bTest = S.el("button", { class: "btn primary", text: "Проверить соединение" });
    bTest.addEventListener("click", function () {
      out.textContent = "Проверяю...";
      if (cfg.provider === "local") { out.textContent = "Автономный режим: внешние запросы не нужны."; return; }
      var probe = {
        provider: cfg.provider, model: cfg.model, baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey, system: "", stream: false, maxTokens: 32,
        temperature: 0, messages: [{ role: "user", content: "ping" }]
      };
      if (!S.server.up) {
        out.textContent = "Локальный сервер не запущен — проверка пойдёт прямо из браузера и может быть заблокирована CORS.";
      }
      var url = S.server.up ? S.server.base + "/api/llm" : null;
      if (!url) { out.textContent += " Запустите Sayumi.bat для надёжной проверки."; return; }
      fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(probe)
      }).then(function (r) { return r.json(); }).then(function (d) {
        out.textContent = d.ok ? "Соединение в порядке. Ответ: " + (d.text || "").slice(0, 80)
          : "Ошибка: " + (d.error || "?") + " " + (d.detail || "").slice(0, 160);
      }).catch(function (e) { out.textContent = "Ошибка: " + e.message; });
    });
    sec3.appendChild(S.el("div", { class: "inline" })).appendChild(bTest);
    sec3.appendChild(out);
  }

  /* --------------------------------------------------------------- data */
  function drawData(root, redraw) {
    var sec = section(root, "Локальный сервер");
    var status = S.el("div", { class: "item" });
    status.appendChild(S.el("span", { class: "dot " + (S.server.up ? "live" : "off") }));
    status.appendChild(S.el("span", { class: "grow", text: S.server.up ? S.t("online") : S.t("offline") }));
    if (S.server.info) {
      status.appendChild(S.el("span", { class: "tiny mono muted",
        text: "python " + S.server.info.python }));
    }
    sec.appendChild(status);
    if (S.server.info) {
      sec.appendChild(S.el("div", { class: "note tiny mono", text: "data: " + S.server.info.data }));
    } else {
      sec.appendChild(S.el("div", { class: "note tiny",
        text: "Запустите Sayumi.bat, чтобы включить сервер: он даёт файлы, сохранение на диск и обход CORS." }));
    }
    rowSwitch(sec, "Дублировать данные на сервер", S.load("syncServer", true),
      function (v) { S.save("syncServer", v); },
      "Копия настроек и чатов в папке данных");

    var bRetry = S.el("button", { class: "btn", text: "Проверить сервер" });
    bRetry.addEventListener("click", function () {
      S.probeServer().then(function () { redraw(); });
    });
    sec.appendChild(S.el("div", { class: "inline" })).appendChild(bRetry);

    var sec2 = section(root, "Резервная копия",
      "Один файл со всеми чатами, заметками, задачами и настройками.");
    var acts = S.el("div", { class: "inline" });

    var bOut = S.el("button", { class: "btn primary", text: "Выгрузить всё" });
    bOut.addEventListener("click", function () {
      var dump = {};
      S.allKeys().forEach(function (k) { dump[k] = S.load(k, null); });
      var stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
      S.download("sayumi-backup-" + stamp + ".json", JSON.stringify(dump, null, 2), "application/json");
    });

    var bIn = S.el("button", { class: "btn", text: "Загрузить копию" });
    bIn.addEventListener("click", function () {
      var picker = S.el("input", { type: "file", accept: ".json" });
      picker.addEventListener("change", function () {
        var f = picker.files[0];
        if (!f) return;
        var reader = new FileReader();
        reader.onload = function () {
          try {
            var dump = JSON.parse(String(reader.result));
            Object.keys(dump).forEach(function (k) { S.save(k, dump[k]); });
            S.toast("Копия загружена, перезагружаю...", "ok");
            setTimeout(function () { location.reload(); }, 900);
          } catch (e) { S.toast("Повреждённый файл", "bad"); }
        };
        reader.readAsText(f);
      });
      picker.click();
    });
    acts.appendChild(bOut);
    acts.appendChild(bIn);
    sec2.appendChild(acts);

    var sec3 = section(root, "Хранилище");
    var used = 0;
    S.allKeys().forEach(function (k) {
      try { used += (localStorage.getItem(S.NS + k) || "").length; } catch (e) {}
    });
    sec3.appendChild(S.el("div", { class: "item" },
      '<span class="grow">Занято в браузере</span><span class="mono gold">' + S.bytes(used * 2) + "</span>"));
    sec3.appendChild(S.el("div", { class: "item" },
      '<span class="grow">Ключей сохранено</span><span class="mono gold">' + S.allKeys().length + "</span>"));

    var danger = S.el("div", { class: "inline", style: "margin-top:12px" });
    var bChats = S.el("button", { class: "btn danger", text: "Удалить все чаты" });
    bChats.addEventListener("click", function () {
      if (!confirm("Удалить все диалоги безвозвратно?")) return;
      Chat.clearAll();
      S.toast("Чаты удалены");
    });
    var bAll = S.el("button", { class: "btn danger", text: "Полный сброс" });
    bAll.addEventListener("click", function () {
      if (!confirm("Удалить все данные Sayumi из этого браузера?")) return;
      if (!confirm("Точно? Это действие нельзя отменить.")) return;
      S.allKeys().forEach(S.drop);
      setTimeout(function () { location.reload(); }, 400);
    });
    danger.appendChild(bChats);
    danger.appendChild(bAll);
    sec3.appendChild(danger);
  }

  /* -------------------------------------------------------------- about */
  function drawAbout(root) {
    var sec = section(root, "Sayumi");
    sec.appendChild(S.el("div", { class: "note" },
      "Локальный рабочий интерфейс: чат, заметки, задачи и файлы в одном окне. " +
      "Всё хранится на вашем компьютере, ничего не уходит наружу без вашего ключа."));

    var rows = [
      ["Версия", "1.0.0"],
      ["Запуск", S.isFile() ? "из файла (file://)" : "через локальный сервер"],
      ["Адрес", location.href.split("?")[0]],
      ["Сервер", S.server.up ? S.server.base : "не запущен"],
      ["Хранилище", S.hasLS ? "localStorage доступен" : "только память сессии"]
    ];
    var list = S.el("div", { class: "list" });
    rows.forEach(function (r) {
      var item = S.el("div", { class: "item" });
      item.appendChild(S.el("span", { class: "grow muted", text: r[0] }));
      item.appendChild(S.el("span", { class: "mono tiny gold", text: r[1] }));
      list.appendChild(item);
    });
    sec.appendChild(list);

    var sec2 = section(root, "Как запускать");
    sec2.appendChild(S.el("div", { class: "note" },
      "Sayumi.bat в корне проекта: меню с выбором диска и папки данных, работа с флешки, " +
      "поиск Python и его установка, если он не найден."));

    var sec3 = section(root, "Команды чата");
    var box = S.el("div", { class: "body", style: "background:var(--bg-2);padding:12px;border-radius:var(--r-m)" });
    box.innerHTML = MD.render(Chat.helpText());
    sec3.appendChild(box);
  }

  global.Settings = { openWindow: openWindow };
})(window);
