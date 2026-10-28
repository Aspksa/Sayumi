/* ==========================================================================
   Sayumi persona: who she is, how she sounds, how she looks
   Opened with a right click on the avatar.
   ========================================================================== */
(function (global) {
  "use strict";

  var DEF = {
    name: "Sayumi",
    role: "Помощница и напарница по работе",
    address: "",
    greeting: "Я здесь. С чего начнём?",
    warmth: 70,
    formality: 30,
    humor: 35,
    detail: 60,
    systemExtra: "",
    facts: [],
    voiceName: "",
    voiceRate: 1,
    voicePitch: 1.05,
    image: "assets/sayumi.png",
    imageBlink: "",
    alive: true,
    dust: true,
    aliveLevel: 50,
    autoHide: false,
    wheelSize: true,
    size: 190,
    opacity: 100,
    aura: true,
    hidden: false,
    snap: false,
    idleTalk: true
  };

  var data = Object.assign({}, DEF, S.load("persona", {}));

  function get() { return data; }

  function set(patch) {
    Object.assign(data, patch || {});
    S.save("persona", data);
    S.syncOut("persona", data);
    S.emit("persona", data);
  }

  function reset() {
    data = Object.assign({}, DEF);
    S.save("persona", data);
    S.emit("persona", data);
  }

  function scale(value, low, high) {
    return value < 34 ? low : value > 66 ? high : "умеренно";
  }

  function systemPrompt() {
    var parts = [];
    parts.push("Тебя зовут " + data.name + ". " + (data.role || ""));
    parts.push(
      "Стиль общения: теплота " + scale(data.warmth, "сдержанная", "очень тёплая") +
      ", формальность " + scale(data.formality, "свободная, на ты", "деловая, на вы") +
      ", юмор " + scale(data.humor, "почти без шуток", "лёгкий и частый") +
      ", подробность ответов " + scale(data.detail, "коротко и по делу", "развёрнуто с примерами") + "."
    );
    parts.push("Отвечай на языке собеседника. Для кода используй блоки с указанием языка.");
    if (data.address) parts.push("Обращайся к собеседнику так: " + data.address + ".");
    if (data.facts.length) {
      parts.push("Факты о собеседнике и проекте, которые надо помнить:\n- " + data.facts.join("\n- "));
    }
    if (data.systemExtra) parts.push(data.systemExtra);
    return parts.join("\n\n");
  }

  /* --------------------------------------------------------------- view */
  function openWindow() {
    if (Win.get("persona")) { Win.get("persona").focus(); return; }

    var pane = S.el("div", { class: "pane" });
    var tabs = S.el("div", { class: "tabs" });
    var body = S.el("div", { class: "pane-body" });
    pane.appendChild(tabs);
    pane.appendChild(body);

    var pages = {
      character: { label: "Характер", draw: drawCharacter },
      voice: { label: "Голос", draw: drawVoice },
      look: { label: "Внешний вид", draw: drawLook },
      memory: { label: "Память", draw: drawMemory },
      prompt: { label: "Промпт", draw: drawPrompt }
    };
    var activeKey = "character";

    Object.keys(pages).forEach(function (key) {
      var b = S.el("button", { class: "tab" + (key === activeKey ? " on" : ""), text: pages[key].label });
      b.addEventListener("click", function () {
        activeKey = key;
        S.qsa(".tab", tabs).forEach(function (t) { t.classList.remove("on"); });
        b.classList.add("on");
        render();
      });
      tabs.appendChild(b);
    });

    function render() {
      body.innerHTML = "";
      pages[activeKey].draw(body, render);
    }
    render();

    Win.create({
      id: "persona",
      title: data.name + " — " + S.t("persona"),
      width: 620,
      height: 580,
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

  function rowText(parent, label, value, onChange, opts) {
    var row = S.el("div", { class: "row" + ((opts && opts.col) ? " col" : "") });
    row.appendChild(S.el("div", { class: "lab", text: label }));
    var input = S.el("input", {
      type: (opts && opts.type) || "text",
      value: value === undefined ? "" : value,
      class: (opts && opts.col) ? "wide" : ""
    });
    input.addEventListener("change", function () { onChange(input.value); });
    if (opts && opts.col) row.appendChild(input);
    else {
      var ctl = S.el("div", { class: "ctl" });
      ctl.appendChild(input);
      row.appendChild(ctl);
    }
    parent.appendChild(row);
    return input;
  }

  function rowRange(parent, label, value, min, max, step, onChange, suffix) {
    var row = S.el("div", { class: "row" });
    row.appendChild(S.el("div", { class: "lab", text: label }));
    var ctl = S.el("div", { class: "ctl" });
    var input = S.el("input", { type: "range", min: min, max: max, step: step || 1, value: value });
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

  function rowSwitch(parent, label, value, onChange, note) {
    var row = S.el("div", { class: "row" });
    var lab = S.el("div", { class: "lab" });
    lab.appendChild(document.createTextNode(label));
    if (note) lab.appendChild(S.el("small", { text: note }));
    row.appendChild(lab);
    var sw = S.el("div", { class: "sw" + (value ? " on" : ""), role: "switch" });
    sw.addEventListener("click", function () {
      var next = !sw.classList.contains("on");
      sw.classList.toggle("on", next);
      onChange(next);
    });
    row.appendChild(sw);
    parent.appendChild(row);
  }

  /* -------------------------------------------------------------- pages */
  function drawCharacter(root, redraw) {
    var sec = section(root, "Кто она", "Эти поля попадают в системный промпт модели.");
    rowText(sec, "Имя", data.name, function (v) {
      set({ name: v || "Sayumi" });
      var w = Win.get("persona");
      if (w) w.setTitle(data.name + " — " + S.t("persona"));
    });
    rowText(sec, "Роль", data.role, function (v) { set({ role: v }); });
    rowText(sec, "Как обращаться к вам", data.address, function (v) { set({ address: v }); });
    rowText(sec, "Приветствие", data.greeting, function (v) { set({ greeting: v }); });

    var sec2 = section(root, "Характер", "Ползунки меняют тон ответов.");
    rowRange(sec2, "Теплота", data.warmth, 0, 100, 1, function (v) { set({ warmth: v }); });
    rowRange(sec2, "Формальность", data.formality, 0, 100, 1, function (v) { set({ formality: v }); });
    rowRange(sec2, "Юмор", data.humor, 0, 100, 1, function (v) { set({ humor: v }); });
    rowRange(sec2, "Подробность", data.detail, 0, 100, 1, function (v) { set({ detail: v }); });

    var sec3 = section(root, "Поведение");
    rowSwitch(sec3, "Реплики в простое", data.idleTalk, function (v) { set({ idleTalk: v }); },
      "Иногда говорит пару слов, когда чат закрыт");
    rowSwitch(sec3, "Прилипать к краю экрана", data.snap, function (v) { set({ snap: v }); },
      "После перетаскивания прижимается к ближайшему краю");

    var actions = S.el("div", { class: "inline" });
    var bReset = S.el("button", { class: "btn danger", text: "Сбросить личность" });
    bReset.addEventListener("click", function () {
      Dialog.confirm({
        title: "Сбросить личность",
        text: "Имя, характер, голос и внешний вид вернутся к исходным. " +
              "Память и чаты не тронуты.",
        ok: "Сбросить", danger: true
      }).then(function (yes) {
        if (!yes) return;
        reset();
        redraw();
        if (global.Avatar) Avatar.style();
      });
    });
    actions.appendChild(bReset);
    root.appendChild(actions);
  }

  function drawVoice(root, redraw) {
    var sec = section(root, "Озвучивание", "Используется встроенный синтез речи браузера.");
    var voices = [];
    try { voices = speechSynthesis.getVoices() || []; } catch (e) {}

    var row = S.el("div", { class: "row" });
    row.appendChild(S.el("div", { class: "lab", text: "Голос" }));
    var sel = S.el("select");
    sel.appendChild(S.el("option", { value: "", text: "По умолчанию" }));
    voices.forEach(function (v) {
      sel.appendChild(S.el("option", { value: v.name, text: v.name + " · " + v.lang }));
    });
    sel.value = data.voiceName;
    sel.addEventListener("change", function () { set({ voiceName: sel.value }); });
    var ctl = S.el("div", { class: "ctl" });
    ctl.appendChild(sel);
    row.appendChild(ctl);
    sec.appendChild(row);

    rowRange(sec, "Скорость", data.voiceRate, 0.5, 2, 0.05, function (v) { set({ voiceRate: v }); });
    rowRange(sec, "Высота", data.voicePitch, 0.5, 2, 0.05, function (v) { set({ voicePitch: v }); });

    var test = S.el("button", { class: "btn", text: "Проверить голос" });
    test.addEventListener("click", function () {
      if (global.Chat) Chat.speak(data.greeting || "Проверка голоса.");
    });
    root.appendChild(S.el("div", { class: "inline" })).appendChild(test);

    if (!voices.length) {
      root.appendChild(S.el("div", { class: "note muted", text: "Голоса ещё не загружены — откройте вкладку ещё раз." }));
    }
  }

  function drawLook(root, redraw) {
    var sec = section(root, "Аватар", "Перетащите её мышкой в любое место окна.");

    var preview = S.el("div", { class: "inline", style: "margin-bottom:12px" });
    var img = S.el("img", {
      src: data.image,
      style: "width:92px;border-radius:10px;border:1px solid var(--line);background:var(--bg-2)"
    });
    preview.appendChild(img);

    var picks = S.el("div", { class: "stack" });
    var bUpload = S.el("button", { class: "btn", text: "Загрузить изображение" });
    var file = S.el("input", { type: "file", accept: "image/*", class: "hide" });
    bUpload.addEventListener("click", function () { file.click(); });
    file.addEventListener("change", function () {
      var f = file.files[0];
      if (!f) return;
      if (f.size > 3 * 1024 * 1024) { S.toast("Файл больше 3 МБ", "bad"); return; }
      var reader = new FileReader();
      reader.onload = function () {
        set({ image: String(reader.result) });
        img.src = data.image;
        if (global.Avatar) Avatar.style();
      };
      reader.readAsDataURL(f);
    });
    var bDefault = S.el("button", { class: "btn", text: "Вернуть стандартный" });
    bDefault.addEventListener("click", function () {
      set({ image: DEF.image });
      img.src = DEF.image;
      if (global.Avatar) Avatar.style();
    });
    picks.appendChild(bUpload);
    picks.appendChild(bDefault);
    picks.appendChild(file);
    preview.appendChild(picks);
    sec.appendChild(preview);

    var blinkRow = S.el("div", { class: "row" });
    var blinkLab = S.el("div", { class: "lab" });
    blinkLab.appendChild(document.createTextNode("Кадр с закрытыми глазами"));
    blinkLab.appendChild(S.el("small", { text: data.imageBlink
      ? "загружен, она будет моргать"
      : "необязательно: второй кадр той же позы" }));
    blinkRow.appendChild(blinkLab);
    var blinkCtl = S.el("div", { class: "ctl" });
    var blinkFile = S.el("input", { type: "file", accept: "image/*", class: "hide" });
    var bBlink = S.el("button", { class: "btn sm", text: data.imageBlink ? "Заменить" : "Загрузить" });
    bBlink.addEventListener("click", function () { blinkFile.click(); });
    blinkFile.addEventListener("change", function () {
      var f = blinkFile.files[0];
      if (!f) return;
      if (f.size > 3 * 1024 * 1024) { S.toast("Файл больше 3 МБ", "bad"); return; }
      var reader = new FileReader();
      reader.onload = function () {
        set({ imageBlink: String(reader.result) });
        if (global.Avatar) Avatar.blink();
        redraw();
      };
      reader.readAsDataURL(f);
    });
    blinkCtl.appendChild(bBlink);
    if (data.imageBlink) {
      var bBlinkOff = I.btn("close", { class: "btn sm ghost danger", title: "Убрать кадр" });
      bBlinkOff.addEventListener("click", function () {
        set({ imageBlink: "" });
        if (global.Avatar) Avatar.blink();
        redraw();
      });
      blinkCtl.appendChild(bBlinkOff);
    }
    blinkRow.appendChild(blinkCtl);
    blinkRow.appendChild(blinkFile);
    sec.appendChild(blinkRow);

    rowRange(sec, "Размер", data.size, 90, 420, 2, function (v) {
      set({ size: v });
      if (global.Avatar) { Avatar.style(); Avatar.place(); }
    }, " px");
    rowRange(sec, "Прозрачность", data.opacity, 20, 100, 1, function (v) {
      set({ opacity: v });
      if (global.Avatar) Avatar.style();
    }, " %");
    rowSwitch(sec, "Свечение вокруг", data.aura, function (v) {
      set({ aura: v });
      if (global.Avatar) Avatar.style();
    });
    rowSwitch(sec, "Скрыть аватар", data.hidden, function (v) {
      set({ hidden: v });
      if (global.Avatar) Avatar.style();
    }, "Открыть чат можно кнопкой в шапке");

    var secM = section(root, "Движение");
    rowSwitch(secM, "Живая анимация", data.alive !== false, function (v) {
      set({ alive: v });
      if (global.Avatar) { Avatar.style(); Avatar.blink(); }
    }, "Дыхание и лёгкое покачивание");
    rowRange(secM, "Сила движения", data.aliveLevel, 10, 100, 5, function (v) {
      set({ aliveLevel: v });
      if (global.Avatar) Avatar.style();
    }, " %");
    rowSwitch(secM, "Золотая пыль вокруг", data.dust, function (v) {
      set({ dust: v });
      if (global.Avatar) Avatar.dust();
    }, "Редкие медленные искры");
    rowSwitch(secM, "Уходить, пока вы печатаете", data.autoHide, function (v) {
      set({ autoHide: v });
    }, "Становится почти прозрачной и не мешает");
    rowSwitch(secM, "Размер колесом мыши", data.wheelSize, function (v) {
      set({ wheelSize: v });
    }, "Прокрутка над ней меняет размер");

    var acts = S.el("div", { class: "inline" });
    var bCenter = S.el("button", { class: "btn", text: "По центру" });
    bCenter.addEventListener("click", function () { if (global.Avatar) Avatar.center(); });
    var bPos = S.el("button", { class: "btn", text: "Вернуть на место" });
    bPos.addEventListener("click", function () { if (global.Avatar) Avatar.reset(); });
    acts.appendChild(bCenter);
    acts.appendChild(bPos);
    root.appendChild(acts);
  }

  function drawMemory(root, redraw) {
    var sec = section(root, "Что она помнит",
      "Короткие факты, которые добавляются к каждому запросу.");

    var list = S.el("div", { class: "list" });
    if (!data.facts.length) {
      list.appendChild(S.el("div", { class: "empty", text: "Пока ничего не записано" }));
    }
    data.facts.forEach(function (fact, i) {
      var item = S.el("div", { class: "item" });
      item.appendChild(S.el("span", { class: "grow", text: fact }));
      var x = I.btn("close", { class: "btn sm ghost danger", title: "Убрать" });
      x.addEventListener("click", function () {
        data.facts.splice(i, 1);
        set({ facts: data.facts });
        redraw();
      });
      item.appendChild(x);
      list.appendChild(item);
    });
    sec.appendChild(list);

    var add = S.el("div", { class: "inline", style: "margin-top:10px" });
    var input = S.el("input", { type: "text", class: "wide", placeholder: "Например: проект на Python, отвечать кратко" });
    var bAdd = S.el("button", { class: "btn primary", text: "Добавить" });
    function commit() {
      var v = input.value.trim();
      if (!v) return;
      data.facts.push(v.slice(0, 200));
      set({ facts: data.facts });
      redraw();
    }
    bAdd.addEventListener("click", commit);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") commit(); });
    add.appendChild(input);
    add.appendChild(bAdd);
    sec.appendChild(add);
  }

  function drawPrompt(root, redraw) {
    var sec = section(root, "Системный промпт",
      "Сверху — то, что собирается автоматически. Снизу можно дописать своё.");

    var pre = S.el("textarea", { class: "field", rows: 9, readonly: "readonly" });
    pre.value = systemPrompt();
    sec.appendChild(pre);

    var row = S.el("div", { class: "row col", style: "margin-top:14px" });
    row.appendChild(S.el("div", { class: "lab", text: "Дополнение от вас" }));
    var extra = S.el("textarea", { class: "field", rows: 5 });
    extra.value = data.systemExtra;
    extra.addEventListener("change", function () {
      set({ systemExtra: extra.value });
      pre.value = systemPrompt();
    });
    row.appendChild(extra);
    sec.appendChild(row);

    var acts = S.el("div", { class: "inline" });
    var bCopy = S.el("button", { class: "btn", text: "Скопировать промпт" });
    bCopy.addEventListener("click", function () {
      S.copy(pre.value).then(function () { S.toast(S.t("copied"), "ok"); });
    });
    acts.appendChild(bCopy);
    root.appendChild(acts);
  }

  global.Persona = {
    get: get,
    set: set,
    reset: reset,
    systemPrompt: systemPrompt,
    openWindow: openWindow,
    DEF: DEF
  };
})(window);
