/* ==========================================================================
   Sayumi project settings - the gear icon in the top bar
   ========================================================================== */
(function (global) {
  "use strict";

  var PAGES = {
    look:  { ru: "Оформление", en: "Appearance", icon: "palette",
             ruNote: "цвета, шрифты, форма", enNote: "colours, fonts, shape" },
    ui:    { ru: "Интерфейс",  en: "Interface",  icon: "sliders",
             ruNote: "язык, окна, клавиши",  enNote: "language, windows, keys" },
    model: { ru: "Модель",     en: "Model",      icon: "cpu",
             ruNote: "подключение и ответы",  enNote: "connection and replies" },
    memory:{ ru: "Память",     en: "Memory",     icon: "sparkle",
             ruNote: "что и как запоминать",  enNote: "what and how to remember" },
    data:  { ru: "Данные",     en: "Data",       icon: "database",
             ruNote: "сервер и копии",        enNote: "server and backups" },
    about: { ru: "О проекте",  en: "About",      icon: "info",
             ruNote: "версия и команды",      enNote: "version and commands" }
  };

  var active = "look";

  function openWindow() {
    if (Win.get("settings")) { Win.get("settings").focus(); return; }

    var shell = S.el("div", { class: "shell" });
    var rail = S.el("div", { class: "rail" });
    var body = S.el("div", { class: "pane-body" });
    shell.appendChild(rail);
    shell.appendChild(body);

    rail.appendChild(S.el("div", { class: "rail-head", text: "Разделы" }));

    var buttons = {};
    Object.keys(PAGES).forEach(function (key) {
      var page = PAGES[key];
      var en = S.getLang() === "en";
      var item = S.el("button", { class: "rail-item" + (key === active ? " on" : "") });
      item.innerHTML = I.svg(page.icon) +
        '<span class="nm">' + S.esc(en ? page.en : page.ru) +
        "<small>" + S.esc(en ? page.enNote : page.ruNote) + "</small></span>";
      item.addEventListener("click", function () {
        active = key;
        Object.keys(buttons).forEach(function (k) { buttons[k].classList.toggle("on", k === key); });
        render();
      });
      buttons[key] = item;
      rail.appendChild(item);
    });

    function render() {
      body.innerHTML = "";
      body.scrollTop = 0;
      ({ look: drawLook, ui: drawUI, model: drawModel, memory: drawMemory,
         data: drawData, about: drawAbout })[active](body, render);
    }
    render();

    Win.create({
      id: "settings",
      title: S.t("settings"),
      width: 820,
      height: 620,
      content: shell
    });
  }

  /* ------------------------------------------------------------ helpers */
  /* every group of settings is its own card with an icon and a heading */
  function section(parent, title, note, icon) {
    var card = S.el("div", { class: "card" });
    var head = S.el("header");
    head.innerHTML = I.svg(icon || "sliders") +
      "<h3>" + S.esc(title) + (note ? "<small>" + S.esc(note) + "</small>" : "") + "</h3>";
    var inner = S.el("div", { class: "inner" });
    card.appendChild(head);
    card.appendChild(inner);
    parent.appendChild(card);
    return inner;
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

  /* a miniature of the real interface; it uses the same tokens, so it
     restyles itself the moment a colour or a slider changes */
  function liveMock() {
    var mock = S.el("div", { class: "mock" });
    mock.innerHTML =
      '<div class="m-bar"><span class="m-dot"></span><span class="m-title">Sayumi</span></div>' +
      '<div class="m-body">' +
        '<div class="m-side">' +
          '<span class="m-pill on"></span><span class="m-pill"></span><span class="m-pill"></span>' +
        "</div>" +
        '<div class="m-main">' +
          '<span class="m-line w70"></span><span class="m-line"></span><span class="m-line w45"></span>' +
          '<div class="m-quote">так выглядит цитата</div>' +
          '<div class="m-btn">Кнопка</div>' +
        "</div>" +
      "</div>";
    return mock;
  }

  /* a preset tile paints a tiny window in that preset's own colours */
  function presetTile(preset, isOn, onPick) {
    var bg = Theme.BACKGROUNDS.filter(function (b) { return b.id === preset.bg; })[0];
    var ac = Theme.ACCENTS.filter(function (a) { return a.id === preset.accent; })[0];

    var tile = S.el("div", { class: "tile" + (isOn ? " on" : ""), title: Theme.label(preset) });
    var art = S.el("div", { class: "t-art" });
    art.style.background = bg.hex;

    var bar = S.el("div", { class: "t-bar" });
    bar.style.background = bg.panel;
    var dot = S.el("span", { class: "t-dot" });
    dot.style.background = ac.hex;
    dot.style.boxShadow = "0 0 6px " + ac.hex;
    bar.appendChild(dot);
    var cap = S.el("span", { class: "t-chip" });
    cap.style.cssText = "width:28px;height:4px;border-radius:99px;background:" + ac.hex + "aa";
    bar.appendChild(cap);
    art.appendChild(bar);

    var rule = S.el("div", { class: "t-rule" });
    rule.style.background = "linear-gradient(90deg, transparent, " + ac.hex + "99, transparent)";
    art.appendChild(rule);

    var rows = S.el("div", { class: "t-rows" });
    var side = S.el("div", { class: "t-col", style: "flex:0 0 26px" });
    [0, 1, 2].forEach(function (i) {
      var p = S.el("span", { class: "t-l", style: "height:6px" });
      p.style.background = i === 0 ? ac.hex + "66" : bg.card;
      side.appendChild(p);
    });
    var main = S.el("div", { class: "t-col" });
    [["80%", bg.line], ["62%", bg.line], ["45%", bg.line]].forEach(function (pair) {
      var line = S.el("span", { class: "t-l" });
      line.style.width = pair[0];
      line.style.background = pair[1];
      main.appendChild(line);
    });
    var chip = S.el("span", { class: "t-chip" });
    chip.style.background = "linear-gradient(180deg," + ac.hex + "," + ac.hex + "bb)";
    main.appendChild(chip);
    rows.appendChild(side);
    rows.appendChild(main);
    art.appendChild(rows);
    tile.appendChild(art);

    var foot = S.el("div", { class: "t-foot" });
    foot.appendChild(S.el("span", { text: Theme.label(preset), style: "color:" + ac.hex }));
    var sw = S.el("span", { class: "sw-mini" });
    [bg.hex, bg.card, ac.hex].forEach(function (c) {
      var i = S.el("i");
      i.style.background = c;
      sw.appendChild(i);
    });
    foot.appendChild(sw);
    tile.appendChild(foot);

    tile.addEventListener("click", onPick);
    return tile;
  }

  function fontRow(parent, label, list, value, onChange, kind) {
    var row = S.el("div", { class: "row" });
    row.appendChild(S.el("div", { class: "lab", text: label }));
    var ctl = S.el("div", { class: "ctl" });
    var sel = S.el("select", { style: "min-width:190px" });
    var missing = 0;
    list.forEach(function (f) {
      if (f.id && !Theme.hasFont(f.id)) { missing++; return; }
      var option = S.el("option", { value: f.id, text: Theme.label(f) });
      option.style.fontFamily = f.id ? '"' + f.id + '"' : "inherit";
      sel.appendChild(option);
    });
    if (!S.qsa("option", sel).some(function (o) { return o.value === value; })) {
      sel.appendChild(S.el("option", { value: value, text: value + " (нет в системе)" }));
    }
    sel.value = value;
    sel.addEventListener("change", function () { onChange(sel.value); });
    ctl.appendChild(sel);
    row.appendChild(ctl);
    parent.appendChild(row);

    var sample = S.el("div", {
      class: "note tiny",
      style: "margin:-4px 0 10px;padding:7px 10px;border:var(--bw) solid var(--line-soft);" +
             "border-radius:var(--r-s);background:var(--bg-0);" +
             "font-family:var(--font-" + (kind || "ui") + ")" +
      (kind === "display" ? ";font-size:15px;letter-spacing:.04em" : ""),
      text: kind === "mono" ? "const sayumi = 1234567890;  Il1 O0"
          : kind === "display" ? "Sayumi · Заголовок раздела"
          : "Съешь ещё этих мягких булок 0123"
    });
    parent.appendChild(sample);
    if (missing) {
      parent.appendChild(S.el("div", { class: "note tiny muted",
        text: "Скрыто шрифтов, которых нет в системе: " + missing }));
    }
    return sel;
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

    var secPreview = section(root, "Предпросмотр",
      "Макет меняется вместе с настройками ниже", "sparkle");
    secPreview.appendChild(liveMock());

    var sec0 = section(root, "Готовые сочетания",
      "Подобранные пары фона и акцента", "star");
    var grid = S.el("div", { class: "tiles" });
    Theme.PRESETS.forEach(function (p) {
      grid.appendChild(presetTile(p, st.preset === p.id, function () {
        Theme.usePreset(p.id);
        redraw();
      }));
    });
    sec0.appendChild(grid);

    var sec1 = section(root, "Фон", "Основной цвет всего интерфейса", "palette");
    var bgRow = S.el("div", { class: "swatches" });
    Theme.BACKGROUNDS.forEach(function (b) {
      bgRow.appendChild(swatchCard(b, st.bg === b.id,
        "linear-gradient(135deg," + b.hex + " 0%," + b.hex + " 48%," + b.card + " 52%," + b.card + " 100%)",
        function () { Theme.set({ bg: b.id }); redraw(); }));
    });
    sec1.appendChild(bgRow);

    var sec2 = section(root, "Цвет кнопок и меню",
      "Акцент для кнопок, рамок и подсветки", "palette");
    var acRow = S.el("div", { class: "swatches" });
    Theme.ACCENTS.forEach(function (a) {
      var fill = "linear-gradient(135deg," + a.hex + " 0%," + a.hex + "aa 70%," + a.hex + "55 100%)";
      acRow.appendChild(swatchCard(a, st.accent === a.id, fill, function () {
        Theme.set({ accent: a.id });
        redraw();
      }));
    });
    sec2.appendChild(acRow);

    var secF = section(root, "Шрифты",
      "Показаны только установленные в системе", "type");
    fontRow(secF, "Заголовки", Theme.FONTS_DISPLAY, st.fontDisplay, function (v) {
      Theme.set({ fontDisplay: v });
    }, "display");
    fontRow(secF, "Интерфейс", Theme.FONTS_UI, st.fontUI, function (v) {
      Theme.set({ fontUI: v });
    });
    fontRow(secF, "Моноширинный", Theme.FONTS_MONO, st.fontMono, function (v) {
      Theme.set({ fontMono: v });
    }, "mono");

    var secB = section(root, "Рамки и тени", "Тонкая подстройка формы", "frame");
    rowRange(secB, "Скругление углов", st.radius, 0, 26, 1,
      function (v) { Theme.set({ radius: v }); }, " px");
    rowRange(secB, "Толщина рамок", st.borderW, 0, 3, 1,
      function (v) { Theme.set({ borderW: v }); }, " px");
    rowRange(secB, "Глубина тени", st.shadow, 0, 100, 1,
      function (v) { Theme.set({ shadow: v }); }, " %");

    var sec3 = section(root, "Детали оформления", null, "sliders");
    rowSelect(sec3, "Текстура фона", [
      ["none", "Нет"], ["vignette", "Виньетка"], ["grid", "Сетка"],
      ["rays", "Лучи"], ["noise", "Зерно"]
    ], st.texture, function (v) { Theme.set({ texture: v }); });

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

    var sec = section(root, "Общее", "Язык и поведение ввода", "sliders");
    rowSelect(sec, "Язык интерфейса", [["ru", "Русский"], ["en", "English"]],
      S.getLang(), function (v) { S.setLang(v); redraw(); });

    rowSwitch(sec, "Enter отправляет сообщение", cfg.sendOnEnter,
      function (v) { Chat.setConfig({ sendOnEnter: v }); },
      "Выключено — отправка по Ctrl+Enter");

    rowSwitch(sec, "Показывать время сообщений", cfg.showTimestamps,
      function (v) { Chat.setConfig({ showTimestamps: v }); });

    var sec2 = section(root, "Аватар", "Видимость и положение", "user");
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

    var sec3 = section(root, "Окна", "Положение и размеры панелей", "frame");
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

    var sec4 = section(root, "Горячие клавиши", null, "cpu");
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
  /* a model picker fed by the provider's own catalogue */
  function modelRow(parent, cfg, redraw) {
    var cacheKey = "chat.models." + cfg.provider;
    var cached = S.load(cacheKey, []);

    var row = S.el("div", { class: "row" });
    var lab = S.el("div", { class: "lab" });
    lab.appendChild(document.createTextNode("Модель"));
    lab.appendChild(S.el("small", {
      text: cached.length ? "в каталоге " + cached.length : "список ещё не загружен"
    }));
    row.appendChild(lab);

    var ctl = S.el("div", { class: "ctl" });
    var sel = S.el("select", { style: "min-width:260px" });

    function fill(list) {
      sel.innerHTML = "";
      list.forEach(function (id) {
        sel.appendChild(S.el("option", { value: id, text: id }));
      });
      if (cfg.model && list.indexOf(cfg.model) < 0) {
        sel.appendChild(S.el("option", { value: cfg.model, text: cfg.model + "  (своя)" }));
      }
      sel.appendChild(S.el("option", { value: "__manual", text: "Ввести вручную…" }));
      sel.value = cfg.model || (list[0] || "__manual");
    }
    fill(cached);

    var manual = S.el("input", {
      type: "text",
      value: cfg.model || "",
      placeholder: "id модели целиком, вместе со слешем",
      style: "min-width:260px" + (cached.length ? ";display:none" : "")
    });
    if (!cached.length) sel.style.display = "none";

    sel.addEventListener("change", function () {
      if (sel.value === "__manual") {
        sel.style.display = "none";
        manual.style.display = "";
        manual.focus();
        return;
      }
      Chat.setConfig({ model: sel.value });
    });
    manual.addEventListener("change", function () {
      Chat.setConfig({ model: manual.value.trim() });
    });

    var load = I.btn("refresh", { class: "btn sm", title: "Загрузить список моделей" });
    var note = S.el("div", { class: "note tiny", style: "margin:-4px 0 10px" });

    load.addEventListener("click", function () {
      if (!S.server.up) {
        note.textContent = "Нужен запущенный сервер: откройте Sayumi через Sayumi.bat.";
        return;
      }
      note.textContent = "Запрашиваю каталог...";
      S.api("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: cfg.provider,
          baseUrl: cfg.baseUrl,
          apiKey: cfg.apiKey
        })
      }).then(function (res) {
        if (!res.ok) {
          note.textContent = "Не вышло: " + (res.error || "?") + " " + (res.detail || "").slice(0, 180);
          return;
        }
        if (!res.models.length) {
          note.textContent = "Каталог пуст — проверьте ключ и адрес.";
          return;
        }
        S.save(cacheKey, res.models);
        note.textContent = "Загружено моделей: " + res.models.length;
        redraw();
      }).catch(function (e) {
        note.textContent = "Ошибка: " + e.message;
      });
    });

    ctl.appendChild(sel);
    ctl.appendChild(manual);
    ctl.appendChild(load);
    row.appendChild(ctl);
    parent.appendChild(row);
    parent.appendChild(note);
  }

  function drawModel(root, redraw) {
    var cfg = Chat.config;

    var sec = section(root, "Подключение модели",
      "Без модели остаются заметки, задачи, файлы и инструменты", "cpu");

    rowSelect(sec, "Провайдер", [
      ["local", "Автономно, без модели"],
      ["cloudru", "Cloud.ru Foundation Models"],
      ["openai", "OpenAI-совместимый"],
      ["anthropic", "Anthropic"],
      ["ollama", "Ollama, локально"]
    ], cfg.provider, function (v) {
      var patch = { provider: v, baseUrl: "" };
      if (v === "cloudru") patch.model = "openai/gpt-oss-120b";
      if (v === "ollama") patch.model = "llama3.1";
      if (v === "anthropic") patch.model = "claude-sonnet-4-5";
      if (v === "openai") patch.model = "gpt-4o-mini";
      Chat.setConfig(patch);
      redraw();
    });

    if (cfg.provider === "local") {
      sec.appendChild(S.el("div", { class: "note tiny",
        text: "Выберите провайдера выше, чтобы подключить настоящую модель." }));
    } else {
      modelRow(sec, cfg, redraw);

      var placeholder = (Chat.PROVIDER_BASES && Chat.PROVIDER_BASES[cfg.provider]) || "";
      var baseInput = rowText(sec, "Адрес API", cfg.baseUrl,
        function (v) { Chat.setConfig({ baseUrl: v.trim() }); });
      baseInput.placeholder = placeholder;
      baseInput.style.minWidth = "260px";
      if (!cfg.baseUrl && placeholder) {
        sec.appendChild(S.el("div", { class: "note tiny", style: "margin:-4px 0 10px",
          text: "Пусто — используется адрес по умолчанию: " + placeholder }));
      }

      if (cfg.provider !== "ollama") {
        var keyInput = rowText(sec, "API ключ", cfg.apiKey,
          function (v) { Chat.setConfig({ apiKey: v.trim() }); }, "password");
        keyInput.setAttribute("autocomplete", "off");
        keyInput.style.minWidth = "260px";

        var keyNote = S.el("div", { class: "note tiny", style: "margin:-4px 0 10px" });
        keyNote.textContent = cfg.apiKey
          ? "Ключ сохранён в этом браузере, длина " + cfg.apiKey.length + " символов."
          : "Ключ хранится только в этом браузере, на вашем компьютере.";
        sec.appendChild(keyNote);

        if (cfg.apiKey) {
          var keyActs = S.el("div", { class: "inline", style: "margin-bottom:8px" });
          var bWipe = S.el("button", { class: "btn sm danger", text: "Стереть ключ" });
          bWipe.addEventListener("click", function () {
            Chat.setConfig({ apiKey: "" });
            redraw();
          });
          keyActs.appendChild(bWipe);
          sec.appendChild(keyActs);
        }
      }

      if (cfg.provider === "cloudru") {
        sec.appendChild(S.el("div", { class: "note tiny" },
          "Ключ берётся в личном кабинете Cloud.ru, сервис Foundation Models. " +
          "Список моделей загружается кнопкой обновления рядом с полем модели — " +
          "идентификатор нужно хранить целиком, вместе со слешем."));
      }
    }

    var sec2 = section(root, "Параметры генерации", "Как именно она отвечает", "sliders");
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

    var sec3 = section(root, "Проверка", "Пробный запрос к провайдеру", "check");
    var out = S.el("div", { class: "note tiny muted" });
    var bTest = S.el("button", { class: "btn primary", text: "Проверить соединение" });
    bTest.addEventListener("click", function () {
      if (cfg.provider === "local") {
        out.textContent = "Автономный режим: внешние запросы не нужны.";
        return;
      }
      if (!S.server.up) {
        out.textContent = "Локальный сервер не запущен. Запустите Sayumi.bat — " +
          "иначе браузер заблокирует запрос по CORS.";
        return;
      }
      out.textContent = "Проверяю...";
      S.api("/api/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: cfg.provider, model: cfg.model, baseUrl: cfg.baseUrl,
          apiKey: cfg.apiKey, system: "", stream: false, maxTokens: 32,
          temperature: 0, messages: [{ role: "user", content: "Ответь одним словом: привет" }]
        })
      }).then(function (d) {
        out.textContent = d.ok
          ? "Работает. Ответ модели: " + (d.text || "").slice(0, 120)
          : "Ошибка: " + (d.error || "?") + " " + (d.detail || "").slice(0, 200);
      }).catch(function (e) { out.textContent = "Ошибка: " + e.message; });
    });
    sec3.appendChild(S.el("div", { class: "inline" })).appendChild(bTest);
    sec3.appendChild(out);
  }

  /* ------------------------------------------------------------- memory */
  function drawMemory(root, redraw) {
    var ms = Memory.settings;
    var lv = Memory.levelProgress();

    var sec = section(root, "Долговременная память",
      "Она помнит между запусками и подмешивает нужное в каждый запрос", "sparkle");

    rowSwitch(sec, "Память включена", ms.enabled, function (v) {
      Memory.setSettings({ enabled: v });
      redraw();
    }, "Выключите, если хотите разговор без следов");

    if (ms.enabled) {
      rowSwitch(sec, "Запоминать самой", ms.autoLearn, function (v) {
        Memory.setSettings({ autoLearn: v });
      }, "Ловит имена, привычки, правила и решения прямо из речи");

      rowSwitch(sec, "Выделять факты моделью", ms.distill, function (v) {
        Memory.setSettings({ distill: v });
      }, "Раз в несколько реплик просит модель вытащить то, что пропустили правила");

      rowSwitch(sec, "Подстраивать характер", ms.adapt, function (v) {
        Memory.setSettings({ adapt: v });
      }, "«отвечай короче», «давай на ты» — и ползунки сдвинутся сами");

      rowRange(sec, "Сколько вспоминать за раз", ms.recall, 2, 20, 1, function (v) {
        Memory.setSettings({ recall: v });
      }, " записей");

      rowRange(sec, "Как часто звать модель", ms.cooldown, 2, 20, 1, function (v) {
        Memory.setSettings({ cooldown: v });
      }, " ответов");
    }

    var secS = section(root, "Состояние", "Накопленное на этом компьютере", "database");
    var rows = [
      ["Записей в памяти", String(Memory.db.facts.length)],
      ["Уровень", lv.lv + "  (" + lv.have + " / " + lv.need + " опыта)"],
      ["Сообщений от вас", String(Memory.db.growth.messages)],
      ["Ответов дано", String(Memory.db.growth.replies)],
      ["Подстроек характера", String((Memory.db.growth.tuned || []).length)],
      ["Диалогов в памяти", String(Object.keys(Memory.db.sessions || {}).length)]
    ];
    var list = S.el("div", { class: "list" });
    rows.forEach(function (r) {
      var item = S.el("div", { class: "item" });
      item.appendChild(S.el("span", { class: "grow muted", text: r[0] }));
      item.appendChild(S.el("span", { class: "mono gold tiny", text: r[1] }));
      list.appendChild(item);
    });
    secS.appendChild(list);

    var acts = S.el("div", { class: "inline", style: "margin-top:12px" });
    var bOpen = S.el("button", { class: "btn primary", text: "Открыть память" });
    bOpen.addEventListener("click", function () { Memory.openWindow(); });
    var bWipe = S.el("button", { class: "btn danger", text: "Стереть память" });
    bWipe.addEventListener("click", function () {
      Dialog.confirm({
        title: "Стереть память",
        text: "Все записи и накопленный опыт исчезнут безвозвратно.",
        ok: "Стереть", danger: true
      }).then(function (yes) {
        if (!yes) return;
        Memory.wipe();
        redraw();
      });
    });
    acts.appendChild(bOpen);
    acts.appendChild(bWipe);
    secS.appendChild(acts);

    var secH = section(root, "Как ей запомнить нужное", null, "info");
    var box = S.el("div", { class: "body", style: "background:var(--bg-0);padding:12px;border-radius:var(--r-m)" });
    box.innerHTML = MD.render([
      "В чате достаточно сказать прямо:",
      "",
      "- `запомни: проект на Python, отвечай кратко`",
      "- `меня зовут Алексей`",
      "- `я использую Cloud.ru`",
      "- `никогда не предлагай сторонние библиотеки`",
      "",
      "Команда `/memory` открывает всё, что она помнит. " +
      "Там запись можно закрепить навсегда, поправить двойным щелчком или забыть."
    ].join("\n"));
    secH.appendChild(box);
  }

  /* --------------------------------------------------------------- data */
  function drawData(root, redraw) {
    var sec = section(root, "Локальный сервер", "Файлы, сохранение на диск и обход CORS", "database");
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
      "Один файл со всеми чатами, заметками и настройками", "download");
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

    var sec3 = section(root, "Хранилище", "Сколько занято и что можно очистить", "database");
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
      Dialog.confirm({
        title: "Удалить все чаты",
        text: "Каждый диалог и его история исчезнут. Память и заметки останутся.",
        ok: "Удалить всё", danger: true
      }).then(function (yes) {
        if (!yes) return;
        Chat.clearAll();
        S.toast("Чаты удалены");
      });
    });
    var bAll = S.el("button", { class: "btn danger", text: "Полный сброс" });
    bAll.addEventListener("click", function () {
      Dialog.confirm({
        title: "Полный сброс",
        text: "Чаты, заметки, задачи, память, настройки и ключ API — всё будет стёрто. " +
              "Отменить это нельзя.",
        ok: "Стереть всё", danger: true
      }).then(function (yes) {
        if (!yes) return;
        return Dialog.confirm({
          title: "Точно стереть?",
          text: "Последняя возможность передумать. Копию можно выгрузить кнопкой выше.",
          ok: "Да, стереть", danger: true
        });
      }).then(function (sure) {
        if (!sure) return;
        S.allKeys().forEach(S.drop);
        setTimeout(function () { location.reload(); }, 400);
      });
    });
    danger.appendChild(bChats);
    danger.appendChild(bAll);
    sec3.appendChild(danger);
  }

  /* -------------------------------------------------------------- about */
  function drawAbout(root) {
    var sec = section(root, "Sayumi", "Версия и режим запуска", "info");
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

    var sec2 = section(root, "Как запускать", null, "cpu");
    sec2.appendChild(S.el("div", { class: "note" },
      "Sayumi.bat в корне проекта: меню с выбором диска и папки данных, работа с флешки, " +
      "поиск Python и его установка, если он не найден."));

    var sec3 = section(root, "Команды чата", null, "chat");
    var box = S.el("div", { class: "body", style: "background:var(--bg-2);padding:12px;border-radius:var(--r-m)" });
    box.innerHTML = MD.render(Chat.helpText());
    sec3.appendChild(box);
  }

  global.Settings = { openWindow: openWindow };
})(window);
