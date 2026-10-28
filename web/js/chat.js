/* ==========================================================================
   Sayumi chat: sessions, streaming, attachments, commands, voice, export
   ========================================================================== */
(function (global) {
  "use strict";

  var PROVIDER_BASES = {
    cloudru: "https://foundation-models.api.cloud.ru/v1",
    openai: "https://api.openai.com/v1",
    anthropic: "https://api.anthropic.com",
    ollama: "http://127.0.0.1:11434"
  };

  var DEF_CONFIG = {
    provider: "local",
    model: "gpt-4o-mini",
    baseUrl: "",
    apiKey: "",
    temperature: 0.7,
    maxTokens: 2048,
    stream: true,
    contextLimit: 24,
    tts: false,
    sendOnEnter: true,
    showTimestamps: true
  };

  var cfg = Object.assign({}, DEF_CONFIG, S.load("chat.config", {}));
  var sessions = S.load("chat.sessions", []);
  var currentId = S.load("chat.current", "");
  var templates = S.load("chat.templates", [
    { id: "t1", name: "Разбор кода", text: "Разбери этот код, найди ошибки и предложи улучшения:\n\n" },
    { id: "t2", name: "Кратко", text: "Сократи текст до главных тезисов, маркированным списком:\n\n" },
    { id: "t3", name: "План работ", text: "Составь пошаговый план реализации задачи с оценкой времени:\n\n" },
    { id: "t4", name: "Объясни просто", text: "Объясни простыми словами, с примером:\n\n" }
  ]);

  var win = null;
  var ui = {};
  var attachments = [];
  var streaming = null;
  var recog = null;

  /* ------------------------------------------------------------ storage */
  function persist() {
    S.save("chat.sessions", sessions);
    S.save("chat.current", currentId);
    S.syncOut("chat.sessions", sessions);
  }
  function persistConfig() {
    S.save("chat.config", cfg);
    S.syncOut("chat.config", cfg);
  }

  function current() {
    var s = sessions.filter(function (x) { return x.id === currentId; })[0];
    if (!s) s = sessions[0];
    if (!s) s = newSession(false);
    currentId = s.id;
    return s;
  }

  function newSession(render) {
    var s = {
      id: S.uid("s"),
      title: S.getLang() === "en" ? "New chat" : "Новый чат",
      pinned: false,
      created: Date.now(),
      updated: Date.now(),
      messages: []
    };
    sessions.unshift(s);
    currentId = s.id;
    persist();
    if (render !== false) { drawSessions(); drawLog(); }
    return s;
  }

  function sortSessions() {
    sessions.sort(function (a, b) {
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      return b.updated - a.updated;
    });
  }

  /* --------------------------------------------------------------- view */
  function openWindow() {
    if (Win.get("chat")) { Win.get("chat").focus(); return Win.get("chat"); }

    var root = S.el("div", { class: "chat" });

    /* ---- sidebar */
    var side = S.el("div", { class: "chat-side" });
    var sideTop = S.el("div", { class: "side-top" });
    var bNew = S.el("button", { class: "btn sm primary", text: "+ " + S.t("newChat") });
    bNew.addEventListener("click", function () { newSession(); ui.input.focus(); });
    var findBox = S.el("input", { class: "search", type: "text", placeholder: S.t("search") + "..." });
    findBox.addEventListener("input", S.debounce(drawSessions, 120));
    sideTop.appendChild(bNew);
    var sideWrap = S.el("div", { class: "side-top" });
    sideWrap.appendChild(findBox);
    var list = S.el("div", { class: "side-list" });
    side.appendChild(sideTop);
    side.appendChild(sideWrap);
    side.appendChild(list);

    /* ---- main */
    var main = S.el("div", { class: "chat-main" });

    var bar = S.el("div", { class: "chat-bar" });
    var bSide = I.btn("menu", { title: "Список чатов" });
    bSide.addEventListener("click", function () { side.classList.toggle("hidden"); });
    var title = S.el("div", { class: "title" });
    var chip = S.el("div", { class: "model-chip", title: "Настройки модели" });
    chip.addEventListener("click", toggleModelPanel);
    var bFind = I.btn("search", { title: "Поиск в диалоге" });
    bFind.addEventListener("click", toggleFind);
    var bTpl = I.btn("pencil", { title: "Шаблоны" });
    bTpl.addEventListener("click", showTemplates);
    var bExport = I.btn("download", { title: "Экспорт" });
    bExport.addEventListener("click", showExport);
    var bClear = I.btn("trash", { class: "btn sm ghost danger", title: "Очистить диалог" });
    bClear.addEventListener("click", function () {
      var s = current();
      if (!s.messages.length) return;
      Dialog.confirm({
        title: "Очистить диалог",
        text: "Все сообщения этого чата будут удалены. Сам чат останется.",
        ok: "Очистить", danger: true
      }).then(function (yes) {
        if (!yes) return;
        s.messages = [];
        s.updated = Date.now();
        persist();
        drawLog();
      });
    });
    [bSide, title, chip, bFind, bTpl, bExport, bClear].forEach(function (n) { bar.appendChild(n); });

    var findRow = S.el("div", { class: "chat-bar hide" });
    var findIn = S.el("input", { class: "search", type: "text", placeholder: "Найти в диалоге..." });
    findIn.addEventListener("input", S.debounce(function () { runFind(findIn.value); }, 160));
    findRow.appendChild(findIn);

    var modelPanel = S.el("div", { class: "chat-bar hide" });
    buildModelPanel(modelPanel);

    var log = S.el("div", { class: "chat-log" });

    var foot = S.el("div", { class: "chat-foot" });
    var attRow = S.el("div", { class: "attach-row" });
    var comp = S.el("div", { class: "composer" });
    var input = S.el("textarea", {
      rows: 1,
      placeholder: S.t("placeholder"),
      spellcheck: "false"
    });
    var sideBtns = S.el("div", { class: "side" });
    var bAttach = I.btn("clip", { class: "btn icon ghost", title: "Прикрепить файл" });
    var bMic = I.btn("mic", { class: "btn icon ghost", title: "Голосовой ввод" });
    var bSend = S.el("button", { class: "btn primary", text: S.t("send") });
    sideBtns.appendChild(bAttach);
    sideBtns.appendChild(bMic);
    sideBtns.appendChild(bSend);
    comp.appendChild(input);
    comp.appendChild(sideBtns);

    var fileInput = S.el("input", { type: "file", multiple: "multiple", class: "hide" });
    fileInput.addEventListener("change", function () { takeFiles(fileInput.files); fileInput.value = ""; });
    bAttach.addEventListener("click", function () { fileInput.click(); });
    bMic.addEventListener("click", toggleVoice);

    var hint = S.el("div", { class: "hintbar" });
    var meter = S.el("span", { class: "mono" });
    var hintText = S.el("span", { class: "grow" });
    var bTts = I.btn("sound", { label: "TTS" });
    bTts.addEventListener("click", function () {
      cfg.tts = !cfg.tts;
      persistConfig();
      bTts.classList.toggle("on", cfg.tts);
      S.toast(cfg.tts ? "Озвучивание включено" : "Озвучивание выключено");
    });
    bTts.classList.toggle("on", cfg.tts);
    hint.appendChild(meter);
    hint.appendChild(hintText);
    hint.appendChild(bTts);

    foot.appendChild(attRow);
    foot.appendChild(comp);
    foot.appendChild(hint);
    foot.appendChild(fileInput);

    main.appendChild(bar);
    main.appendChild(findRow);
    main.appendChild(modelPanel);
    main.appendChild(log);
    main.appendChild(foot);

    root.appendChild(side);
    root.appendChild(main);

    var dropHint = S.el("div", { class: "drop-hint", text: S.t("dropFiles") });

    ui = {
      root: root, side: side, list: list, find: findBox, title: title, chip: chip,
      log: log, input: input, send: bSend, attRow: attRow, meter: meter,
      hint: hintText, modelPanel: modelPanel, findRow: findRow, findIn: findIn,
      mic: bMic, tts: bTts
    };

    win = Win.create({
      id: "chat",
      title: "Sayumi — " + S.t("chat"),
      width: Math.min(980, window.innerWidth - 60),
      height: Math.min(640, window.innerHeight - 110),
      content: root,
      onClose: function () { win = null; stopStream(); }
    });
    win.node.appendChild(dropHint);
    wireDrop(win.node);

    input.addEventListener("keydown", onKey);
    input.addEventListener("input", function () {
      autoGrow(input);
      updateMeter();
      maybeCommandHint(input.value);
    });
    bSend.addEventListener("click", function () {
      if (streaming) stopStream();
      else send(input.value);
    });

    log.addEventListener("click", onLogClick);

    drawSessions();
    drawLog();
    updateChip();
    setTimeout(function () { input.focus(); }, 60);
    return win;
  }

  function autoGrow(node) {
    node.style.height = "auto";
    node.style.height = Math.min(220, node.scrollHeight) + "px";
  }

  function updateMeter() {
    if (!ui.meter) return;
    var s = current();
    var ctx = s.messages.reduce(function (sum, m) { return sum + S.tokens(m.text); }, 0);
    ctx += S.tokens(ui.input.value);
    ui.meter.textContent = "~" + ctx + " tok · " + s.messages.length + " msg";
  }

  function updateChip() {
    if (!ui.chip) return;
    var names = { local: "offline", cloudru: "cloud.ru", openai: "openai",
                  anthropic: "claude", ollama: "ollama" };
    ui.chip.textContent = (names[cfg.provider] || cfg.provider) +
      (cfg.provider === "local" ? "" : " · " + cfg.model);
  }

  /* ----------------------------------------------------------- sessions */
  function drawSessions() {
    if (!ui.list) return;
    sortSessions();
    var filter = (ui.find.value || "").toLowerCase();
    ui.list.innerHTML = "";

    var shown = sessions.filter(function (s) {
      if (!filter) return true;
      if (s.title.toLowerCase().indexOf(filter) >= 0) return true;
      return s.messages.some(function (m) {
        return (m.text || "").toLowerCase().indexOf(filter) >= 0;
      });
    });

    if (!shown.length) {
      ui.list.appendChild(S.el("div", { class: "empty", text: S.t("empty") }));
    }

    shown.forEach(function (s) {
      var row = S.el("div", { class: "sess" + (s.id === currentId ? " on" : "") });
      if (s.pinned) row.appendChild(S.el("span", { class: "pin", text: "★" }));
      var nm = S.el("span", { class: "nm", text: s.title });
      var x = S.el("span", { class: "x", text: "×", title: S.t("del") });
      row.appendChild(nm);
      row.appendChild(x);

      row.addEventListener("click", function () {
        currentId = s.id;
        persist();
        drawSessions();
        drawLog();
      });
      row.addEventListener("dblclick", function (e) {
        e.stopPropagation();
        Dialog.prompt({ title: S.t("rename"), value: s.title }).then(function (name) {
          if (!name) return;
          s.title = name.slice(0, 80);
          persist(); drawSessions(); drawLog();
        });
      });
      row.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        e.stopPropagation();
        global.Menu.show(e.clientX, e.clientY, [
          { label: s.pinned ? "Открепить" : "Закрепить", act: function () { s.pinned = !s.pinned; persist(); drawSessions(); } },
          { label: S.t("rename"), act: function () {
              Dialog.prompt({ title: S.t("rename"), value: s.title }).then(function (n) {
                if (!n) return;
                s.title = n.slice(0, 80);
                persist(); drawSessions(); drawLog();
              });
            } },
          { label: "Дублировать", act: function () {
              var copy = JSON.parse(JSON.stringify(s));
              copy.id = S.uid("s");
              copy.title = s.title + " (копия)";
              copy.updated = Date.now();
              sessions.unshift(copy);
              persist(); drawSessions();
            } },
          { sep: true },
          { label: S.t("del"), act: function () { removeSession(s.id); } }
        ]);
      });
      x.addEventListener("click", function (e) {
        e.stopPropagation();
        removeSession(s.id);
      });
      ui.list.appendChild(row);
    });
  }

  function removeSession(id) {
    var victim = sessions.filter(function (s) { return s.id === id; })[0];
    Dialog.confirm({
      title: "Удалить чат",
      text: victim ? "«" + victim.title + "» и все его сообщения исчезнут навсегда."
                   : "Чат исчезнет навсегда.",
      ok: "Удалить", danger: true
    }).then(function (yes) {
      if (!yes) return;
      sessions = sessions.filter(function (s) { return s.id !== id; });
      if (currentId === id) currentId = sessions.length ? sessions[0].id : "";
      if (!sessions.length) newSession(false);
      persist();
      drawSessions();
      drawLog();
    });
  }

  /* --------------------------------------------------------------- log */
  function drawLog() {
    if (!ui.log) return;
    var s = current();
    ui.title.textContent = s.title;
    ui.log.innerHTML = "";

    if (!s.messages.length) {
      var p = (global.Persona && Persona.get()) || {};
      ui.log.appendChild(S.el("div", { class: "empty" },
        '<div style="font-size:15px;color:var(--acc);letter-spacing:.2em;text-transform:uppercase;margin-bottom:8px">' +
        S.esc(p.name || "Sayumi") + "</div>" +
        S.esc(p.greeting || "Чем помочь?") +
        '<div class="tiny muted" style="margin-top:14px">Введите <b class="gold">/</b> для списка команд</div>'));
    }

    s.messages.forEach(function (m) {
      if (m.hidden) return;
      ui.log.appendChild(renderMessage(m));
    });
    scrollDown();
    updateMeter();
  }

  function renderMessage(m) {
    var p = (global.Persona && Persona.get()) || {};
    var roleClass = m.role === "user" ? "u" : m.role === "assistant" ? "a" : m.role === "error" ? "sys err" : "sys";
    var node = S.el("div", { class: "msg " + roleClass, "data-mid": m.id });

    var ava = S.el("div", { class: "ava" });
    if (m.role === "assistant") {
      ava.appendChild(S.el("img", { src: p.image || "assets/sayumi.png", alt: "" }));
    } else if (m.role === "user") {
      ava.textContent = "Вы";
    } else {
      ava.textContent = "·";
    }

    var wrap = S.el("div", { class: "wrap" });
    var who = S.el("div", { class: "who" });
    var name = m.role === "assistant" ? (p.name || "Sayumi")
      : m.role === "user" ? S.t("you") : "system";
    who.appendChild(S.el("b", { text: name }));
    if (cfg.showTimestamps) who.appendChild(S.el("span", { text: S.time(m.ts) }));
    if (m.model) who.appendChild(S.el("span", { class: "mono", text: m.model }));

    var body = S.el("div", { class: "body" });
    body.innerHTML = MD.render(m.text || "");

    if (m.atts && m.atts.length) {
      var row = S.el("div", { class: "attach-row", style: "margin-top:8px" });
      m.atts.forEach(function (a) {
        row.appendChild(S.el("span", { class: "chip" },
          "<b>" + S.esc(a.name) + "</b> " + S.esc(S.bytes(a.size || 0))));
      });
      body.appendChild(row);
    }

    var acts = S.el("div", { class: "acts" });
    function act(icon, name, label, title) {
      var b = S.el("button", { type: "button", "data-act": name, title: title || label || "" });
      b.innerHTML = I.svg(icon) + (label ? "<span>" + S.esc(label) + "</span>" : "");
      acts.appendChild(b);
    }
    act("copy", "copy", S.t("copy"));
    if (m.role === "user") {
      act("pencil", "edit", S.t("edit"));
      act("refresh", "resend", null, "Отправить заново");
    }
    if (m.role === "assistant") {
      act("refresh", "regen", S.t("regen"));
      act("sound", "speak", null, S.t("speak"));
      var session = current();
      var variants = m.group ? session.messages.filter(function (x) { return x.group === m.group; }) : [];
      if (variants.length > 1) {
        var at = variants.indexOf(m) + 1;
        var pager = S.el("span", {
          class: "variants",
          title: "Варианты этого ответа"
        });
        var back = S.el("button", { type: "button", "data-act": "prev", title: "Предыдущий вариант" });
        back.innerHTML = "‹";
        var label = S.el("span", { text: at + " / " + variants.length });
        var fwd = S.el("button", { type: "button", "data-act": "next", title: "Следующий вариант" });
        fwd.innerHTML = "›";
        pager.appendChild(back);
        pager.appendChild(label);
        pager.appendChild(fwd);
        acts.appendChild(pager);
      }
    }
    act("trash", "del", null, S.t("del"));

    wrap.appendChild(who);
    wrap.appendChild(body);
    wrap.appendChild(acts);
    node.appendChild(ava);
    node.appendChild(wrap);
    return node;
  }

  function onLogClick(e) {
    var codeBtn = e.target.closest("[data-copy-code]");
    if (codeBtn) {
      var pre = codeBtn.closest(".code").querySelector("code");
      S.copy(pre.innerText).then(function () { S.toast(S.t("copied"), "ok"); });
      return;
    }
    var btn = e.target.closest("[data-act]");
    if (!btn) return;
    var holder = btn.closest("[data-mid]");
    if (!holder) return;
    var s = current();
    var id = holder.getAttribute("data-mid");
    var idx = s.messages.findIndex(function (m) { return m.id === id; });
    if (idx < 0) return;
    var m = s.messages[idx];

    switch (btn.getAttribute("data-act")) {
      case "copy":
        S.copy(m.text).then(function () { S.toast(S.t("copied"), "ok"); });
        break;
      case "edit":
        ui.input.value = m.text;
        autoGrow(ui.input);
        ui.input.focus();
        break;
      case "resend":
        s.messages = s.messages.slice(0, idx + 1);
        persist();
        drawLog();
        ask();
        break;
      case "regen":
        branchFrom(s, idx);
        break;
      case "prev":
        stepVariant(s, m, -1);
        break;
      case "next":
        stepVariant(s, m, 1);
        break;
      case "speak":
        speak(m.text);
        break;
      case "del":
        s.messages.splice(idx, 1);
        persist();
        drawLog();
        break;
    }
  }

  /* ------------------------------------------------------------ branching */
  /* Regenerating used to throw the old answer away. Now the answers live
     side by side as variants of the same turn, and you can walk between
     them; only the selected one is sent as context. */
  function branchFrom(session, idx) {
    var old = session.messages[idx];
    var group = old.group || S.uid("g");
    old.group = group;

    /* keep every variant of this turn, drop whatever came after it */
    var kept = session.messages.slice(0, idx + 1);
    var siblings = session.messages.slice(idx + 1).filter(function (m) {
      return m.group === group;
    });
    session.messages = kept.concat(siblings);
    session.messages.forEach(function (m) {
      if (m.group === group) m.hidden = true;
    });

    persist();
    drawLog();
    ask(group);
  }

  function variantsOf(session, message) {
    if (!message.group) return [message];
    return session.messages.filter(function (m) { return m.group === message.group; });
  }

  function stepVariant(session, message, dir) {
    var list = variantsOf(session, message);
    if (list.length < 2) return;
    var at = list.indexOf(message);
    var next = list[(at + dir + list.length) % list.length];
    list.forEach(function (m) { m.hidden = m !== next; });
    persist();
    drawLog();
  }

  function scrollDown() {
    if (ui.log) ui.log.scrollTop = ui.log.scrollHeight;
  }

  /* ------------------------------------------------------------ sending */
  function onKey(e) {
    if (e.key === "Enter" && !e.shiftKey && cfg.sendOnEnter) {
      e.preventDefault();
      send(ui.input.value);
      return;
    }
    if (e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();
      send(ui.input.value);
    }
    if (e.key === "Escape") { stopStream(); }
  }

  function send(text) {
    text = (text || "").trim();
    if (!text && !attachments.length) return;
    if (streaming) return;

    if (text.charAt(0) === "/") {
      if (runCommand(text)) {
        ui.input.value = "";
        autoGrow(ui.input);
        return;
      }
    }

    var s = current();
    s.messages.push({
      id: S.uid("m"),
      role: "user",
      text: text,
      ts: Date.now(),
      atts: attachments.map(function (a) { return { name: a.name, size: a.size }; })
    });
    if (s.title === "Новый чат" || s.title === "New chat") {
      s.title = text.slice(0, 42) || "Файлы";
    }
    s.updated = Date.now();
    persist();
    if (global.Memory) Memory.onUser(text, s);

    ui.input.value = "";
    autoGrow(ui.input);
    drawSessions();
    drawLog();

    /* give semantic recall a moment to find what matters before asking */
    if (global.Memory && Memory.canEmbed()) {
      setBusy(true);
      Memory.warm(text).then(ask);
    } else {
      ask();
    }
  }

  function buildPayload() {
    var s = current();
    var persona = (global.Persona && Persona.systemPrompt()) || "";
    var lastUser = "";
    for (var i = s.messages.length - 1; i >= 0; i--) {
      if (s.messages[i].role === "user") { lastUser = s.messages[i].text; break; }
    }
    var recalled = (global.Memory && Memory.context(lastUser)) || "";
    if (recalled) persona += "\n\n" + recalled;
    var code = (global.Codebase && Codebase.context(lastUser)) || "";
    if (code) persona += "\n\n" + code;
    var history = s.messages
      .filter(function (m) { return !m.hidden; })
      .filter(function (m) { return m.role === "user" || m.role === "assistant"; })
      .slice(-cfg.contextLimit)
      .map(function (m) { return { role: m.role, content: m.text }; });

    if (attachments.length && history.length) {
      var extra = attachments.map(function (a) {
        if (a.text) return "Файл: " + a.name + "\n```\n" + a.text.slice(0, 40000) + "\n```";
        return "Файл: " + a.name + " (" + S.bytes(a.size) + ", бинарный)";
      }).join("\n\n");
      history[history.length - 1].content += "\n\n" + extra;
    }
    return { system: persona, messages: history };
  }

  function ask(group) {
    var s = current();
    var payload = buildPayload();
    attachments = [];
    drawAttachments();

    var holder = {
      id: S.uid("m"),
      role: "assistant",
      text: "",
      ts: Date.now(),
      model: cfg.provider === "local" ? "offline" : cfg.model
    };
    if (group) holder.group = group;
    s.messages.push(holder);
    s.updated = Date.now();

    var node = renderMessage(holder);
    ui.log.appendChild(node);
    var bodyNode = node.querySelector(".body");
    bodyNode.innerHTML = '<span class="typing"><span></span><span></span><span></span></span>';
    scrollDown();
    setBusy(true);

    if (cfg.provider === "local") {
      var answer = localBrain(payload.messages[payload.messages.length - 1].content || "");
      typeOut(bodyNode, holder, answer, function () { finish(s, holder); });
      return;
    }

    var request = {
      provider: cfg.provider,
      model: cfg.model,
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      temperature: Number(cfg.temperature),
      maxTokens: Number(cfg.maxTokens),
      system: payload.system,
      messages: payload.messages,
      stream: !!cfg.stream
    };

    if (S.server.up) {
      streamViaServer(request, bodyNode, holder, function () { finish(s, holder); });
    } else {
      directCall(request, bodyNode, holder, function () { finish(s, holder); });
    }
  }

  function finish(s, holder) {
    setBusy(false);
    streaming = null;
    if (!holder.text) holder.text = "(пустой ответ)";
    s.updated = Date.now();
    persist();
    if (global.Memory) Memory.onReply(s);
    drawLog();
    if (cfg.tts) speak(holder.text);
    if (global.Avatar && !Win.get("chat")) Avatar.say("Ответ готов");
  }

  function setBusy(on) {
    if (!ui.send) return;
    ui.send.textContent = on ? S.t("stop") : S.t("send");
    ui.send.classList.toggle("danger", on);
    ui.hint.textContent = on ? "..." : "";
  }

  function stopStream() {
    if (streaming && streaming.abort) {
      try { streaming.abort(); } catch (e) {}
    }
    streaming = null;
    setBusy(false);
  }

  function typeOut(node, holder, text, done) {
    var i = 0;
    var speed = Math.max(6, Math.min(26, Math.round(900 / Math.max(20, text.length / 12))));
    streaming = { abort: function () { i = text.length; } };
    (function step() {
      if (i >= text.length) {
        holder.text = text;
        node.innerHTML = MD.render(text);
        done();
        return;
      }
      i = Math.min(text.length, i + 3);
      holder.text = text.slice(0, i);
      node.innerHTML = MD.render(holder.text);
      scrollDown();
      setTimeout(step, speed);
    })();
  }

  function streamViaServer(request, node, holder, done) {
    var ctrl = new AbortController();
    streaming = ctrl;

    if (!request.stream) {
      fetch(S.server.base + "/api/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: ctrl.signal
      }).then(function (r) { return r.json(); }).then(function (data) {
        holder.text = data.ok ? data.text : "**Ошибка:** " + (data.error || "?") +
          (data.detail ? "\n```\n" + data.detail + "\n```" : "");
        node.innerHTML = MD.render(holder.text);
        done();
      }).catch(function (err) {
        holder.text = "**Ошибка соединения:** " + err.message;
        node.innerHTML = MD.render(holder.text);
        done();
      });
      return;
    }

    fetch(S.server.base + "/api/llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: ctrl.signal
    }).then(function (response) {
      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var buffer = "";

      function pump() {
        return reader.read().then(function (res) {
          if (res.done) { done(); return; }
          buffer += decoder.decode(res.value, { stream: true });
          var parts = buffer.split("\n\n");
          buffer = parts.pop();
          parts.forEach(function (chunk) {
            var line = chunk.replace(/^data:\s*/, "").trim();
            if (!line) return;
            var obj;
            try { obj = JSON.parse(line); } catch (e) { return; }
            if (obj.delta) {
              holder.text += obj.delta;
              node.innerHTML = MD.render(holder.text);
              scrollDown();
            } else if (obj.error) {
              holder.text += "\n\n**Ошибка:** " + obj.error +
                (obj.detail ? "\n```\n" + obj.detail + "\n```" : "");
              node.innerHTML = MD.render(holder.text);
            }
          });
          return pump();
        });
      }
      return pump();
    }).catch(function (err) {
      if (err.name === "AbortError") { done(); return; }
      holder.text += "\n\n**Ошибка соединения:** " + err.message;
      node.innerHTML = MD.render(holder.text);
      done();
    });
  }

  /* direct browser call when the python server is not running */
  function directCall(request, node, holder, done) {
    var url, headers, body;
    if (request.provider === "anthropic") {
      url = (request.baseUrl || "https://api.anthropic.com") + "/v1/messages";
      headers = {
        "content-type": "application/json",
        "x-api-key": request.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      };
      body = {
        model: request.model, max_tokens: request.maxTokens,
        temperature: request.temperature, system: request.system,
        messages: request.messages, stream: false
      };
    } else if (request.provider === "ollama") {
      url = (request.baseUrl || "http://127.0.0.1:11434") + "/api/chat";
      headers = { "content-type": "application/json" };
      body = {
        model: request.model, stream: false,
        messages: (request.system ? [{ role: "system", content: request.system }] : []).concat(request.messages),
        options: { temperature: request.temperature }
      };
    } else {
      var openaiBase = request.baseUrl ||
        PROVIDER_BASES[request.provider] || PROVIDER_BASES.openai;
      url = openaiBase + "/chat/completions";
      headers = { "content-type": "application/json", authorization: "Bearer " + request.apiKey };
      body = {
        model: request.model, temperature: request.temperature,
        max_tokens: request.maxTokens,
        messages: (request.system ? [{ role: "system", content: request.system }] : []).concat(request.messages)
      };
    }

    var ctrl = new AbortController();
    streaming = ctrl;

    fetch(url, { method: "POST", headers: headers, body: JSON.stringify(body), signal: ctrl.signal })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var text = "";
        if (request.provider === "anthropic") {
          text = (data.content || []).map(function (c) { return c.text || ""; }).join("");
        } else if (request.provider === "ollama") {
          text = (data.message || {}).content || "";
        } else {
          text = ((data.choices || [])[0] || {}).message
            ? data.choices[0].message.content : "";
        }
        if (!text && data.error) {
          text = "**Ошибка API:** " + (data.error.message || JSON.stringify(data.error));
        }
        holder.text = text || "(пустой ответ)";
        node.innerHTML = MD.render(holder.text);
        done();
      })
      .catch(function (err) {
        if (err.name === "AbortError") { done(); return; }
        holder.text = "**Запрос не прошёл:** " + err.message +
          "\n\nБраузер блокирует прямые запросы к API. Запустите Sayumi через `Sayumi.bat` — тогда запросы пойдут через локальный сервер.";
        node.innerHTML = MD.render(holder.text);
        done();
      });
  }

  /* ----------------------------------------------------- offline helper */
  function localBrain(input) {
    var text = (input || "").trim();
    var low = text.toLowerCase();

    var math = text.match(/^[\s\d+\-*/().,%^]+$/);
    if (math && /\d/.test(text)) {
      try {
        var expr = text.replace(/,/g, ".").replace(/\^/g, "**");
        var value = Function('"use strict";return (' + expr + ")")();
        if (typeof value === "number" && isFinite(value)) {
          return "`" + text.trim() + "` = **" + value + "**";
        }
      } catch (e) {}
    }

    if (/^(привет|здравствуй|хай|hello|hi|доброе|добрый)/.test(low)) {
      var p = (global.Persona && Persona.get()) || {};
      return (p.greeting || "Привет. Я Sayumi.") +
        "\n\nСейчас я в автономном режиме — без подключённой модели. " +
        "Подключить можно в шапке чата: нажмите на чип с названием модели.";
    }
    if (/\b(время|сколько времени|дата|date|time)\b/.test(low)) {
      return "Сейчас **" + S.dateTime() + "**";
    }
    if (/\b(uuid|guid|идентификатор)\b/.test(low)) {
      return "```\n" + S.uid("id") + "\n" + S.uid("id") + "\n" + S.uid("id") + "\n```";
    }
    if (/\b(сколько слов|посчитай слова|word count)\b/.test(low)) {
      var words = text.split(/\s+/).filter(Boolean).length;
      return "Слов: **" + words + "**, символов: **" + text.length + "**";
    }
    if (/^\/?help|помощь|что ты умеешь/.test(low)) {
      return helpText();
    }

    return [
      "Я получила сообщение, но языковая модель сейчас не подключена, " +
      "поэтому отвечаю из автономного режима.",
      "",
      "**Что доступно без модели:**",
      "- заметки, задачи и файлы рабочей папки",
      "- шаблоны запросов и экспорт диалогов",
      "- арифметика, дата и время, генерация id",
      "- полный доступ к настройкам внешнего вида",
      "",
      "**Чтобы я отвечала по-настоящему**, нажмите чип модели в шапке чата " +
      "и выберите провайдера: OpenAI-совместимый, Anthropic или локальный Ollama.",
      "",
      "> Ваш текст сохранён в истории — после подключения модели можно нажать «Заново»."
    ].join("\n");
  }

  function helpText() {
    return [
      "### Команды",
      "",
      "| Команда | Что делает |",
      "| --- | --- |",
      "| `/help` | этот список |",
      "| `/new` | новый чат |",
      "| `/clear` | очистить текущий диалог |",
      "| `/rename имя` | переименовать чат |",
      "| `/model` | настройки модели |",
      "| `/system текст` | задать системный промпт |",
      "| `/temp 0.7` | температура |",
      "| `/export md` | выгрузить диалог |",
      "| `/theme графит золото` | сменить оформление |",
      "| `/lang ru` | язык интерфейса |",
      "| `/notes`, `/tasks`, `/files` | открыть панели |",
      "| `/graph` | граф связей заметок |",
      "| `/memory` | что она помнит |",
      "| `/code` | чтение файлов проекта |",
      "| `запомни: ...` | записать в долгую память |",
      "| `/persona` | настройки Sayumi |",
      "| `/settings` | настройки проекта |",
      "| `/tts` | озвучивание ответов |",
      "",
      "**Горячие клавиши:** `Enter` отправить · `Shift+Enter` перенос строки · " +
      "`Esc` прервать · `Ctrl+/` открыть чат."
    ].join("\n");
  }

  /* ----------------------------------------------------------- commands */
  function runCommand(line) {
    var parts = line.slice(1).split(/\s+/);
    var cmd = (parts.shift() || "").toLowerCase();
    var rest = parts.join(" ").trim();
    var s = current();

    switch (cmd) {
      case "help": case "?":
        pushSystem(helpText());
        return true;
      case "new":
        newSession();
        return true;
      case "clear":
        s.messages = []; persist(); drawLog();
        return true;
      case "rename":
        if (rest) { s.title = rest.slice(0, 80); persist(); drawSessions(); drawLog(); }
        return true;
      case "model":
        toggleModelPanel();
        return true;
      case "system":
        if (rest && global.Persona) {
          Persona.set({ systemExtra: rest });
          pushSystem("Системный промпт обновлён.");
        } else if (global.Persona) {
          Persona.openWindow();
        }
        return true;
      case "temp":
        if (rest) { cfg.temperature = S.clamp(parseFloat(rest) || 0.7, 0, 2); persistConfig(); pushSystem("Температура: " + cfg.temperature); }
        return true;
      case "export":
        exportChat(rest || "md");
        return true;
      case "theme":
        applyThemeWords(rest);
        return true;
      case "lang":
        S.setLang(rest || (S.getLang() === "ru" ? "en" : "ru"));
        pushSystem("Язык: " + S.getLang());
        return true;
      case "tts":
        cfg.tts = !cfg.tts; persistConfig();
        if (ui.tts) ui.tts.classList.toggle("on", cfg.tts);
        pushSystem("Озвучивание: " + (cfg.tts ? "вкл" : "выкл"));
        return true;
      case "memory": case "память": global.Memory.openWindow(); return true;
      case "code": case "проект": global.Codebase.openWindow(); return true;
      case "notes": global.Tools.openNotes(); return true;
      case "graph": global.Tools.openGraph(); return true;
      case "tasks": global.Tools.openTasks(); return true;
      case "files": global.Tools.openFiles(); return true;
      case "persona": global.Persona.openWindow(); return true;
      case "settings": global.Settings.openWindow(); return true;
      case "stop": stopStream(); return true;
      default:
        return false;
    }
  }

  function applyThemeWords(words) {
    if (!words) { global.Settings.openWindow(); return; }
    var found = false;
    words.toLowerCase().split(/\s+/).forEach(function (w) {
      Theme.BACKGROUNDS.forEach(function (b) {
        if (b.id === w || b.ru.toLowerCase() === w || b.en.toLowerCase() === w) {
          Theme.set({ bg: b.id }); found = true;
        }
      });
      Theme.ACCENTS.forEach(function (a) {
        if (a.id === w || a.ru.toLowerCase() === w || a.en.toLowerCase() === w) {
          Theme.set({ accent: a.id }); found = true;
        }
      });
      Theme.PRESETS.forEach(function (p) {
        if (p.id === w || p.ru.toLowerCase() === w) { Theme.usePreset(p.id); found = true; }
      });
    });
    pushSystem(found ? "Оформление обновлено." : "Не нашла такую тему. Откройте настройки проекта.");
  }

  function pushSystem(text) {
    var s = current();
    s.messages.push({ id: S.uid("m"), role: "system", text: text, ts: Date.now() });
    persist();
    drawLog();
  }

  function maybeCommandHint(value) {
    if (!ui.hint) return;
    if (value.charAt(0) === "/" && value.indexOf(" ") < 0) {
      ui.hint.textContent = "команда · /help покажет весь список";
    } else if (!streaming) {
      ui.hint.textContent = "";
    }
  }

  /* -------------------------------------------------------- attachments */
  function wireDrop(target) {
    ["dragenter", "dragover"].forEach(function (ev) {
      target.addEventListener(ev, function (e) {
        e.preventDefault();
        target.classList.add("dropping");
      });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      target.addEventListener(ev, function (e) {
        e.preventDefault();
        if (ev === "drop" && e.dataTransfer) takeFiles(e.dataTransfer.files);
        target.classList.remove("dropping");
      });
    });
  }

  function takeFiles(fileList) {
    Array.prototype.slice.call(fileList || []).slice(0, 12).forEach(function (file) {
      var item = { name: file.name, size: file.size, text: null };
      attachments.push(item);
      drawAttachments();
      if (file.size > 4 * 1024 * 1024) return;
      if (/\.(txt|md|json|js|ts|py|html|css|csv|log|xml|yml|yaml|ini|cfg|bat|sh|sql|java|c|cpp|go|rs|php|rb)$/i.test(file.name)
          || /^text\//.test(file.type)) {
        var reader = new FileReader();
        reader.onload = function () { item.text = String(reader.result); drawAttachments(); };
        reader.readAsText(file);
      }
    });
  }

  function drawAttachments() {
    if (!ui.attRow) return;
    ui.attRow.innerHTML = "";
    attachments.forEach(function (a, i) {
      var chip = S.el("span", { class: "chip" });
      chip.innerHTML = "<b>" + S.esc(a.name) + "</b> " + S.esc(S.bytes(a.size)) +
        (a.text ? ' <span class="gold">txt</span>' : "");
      var x = S.el("span", { class: "x", text: "×" });
      x.addEventListener("click", function () {
        attachments.splice(i, 1);
        drawAttachments();
      });
      chip.appendChild(x);
      ui.attRow.appendChild(chip);
    });
  }

  /* -------------------------------------------------------------- voice */
  function toggleVoice() {
    var Rec = global.SpeechRecognition || global.webkitSpeechRecognition;
    if (!Rec) { S.toast("Голосовой ввод не поддерживается этим браузером", "bad"); return; }
    if (recog) { recog.stop(); recog = null; ui.mic.classList.remove("on"); return; }
    recog = new Rec();
    recog.lang = S.getLang() === "en" ? "en-US" : "ru-RU";
    recog.continuous = true;
    recog.interimResults = true;
    var base = ui.input.value;
    recog.onresult = function (e) {
      var text = "";
      for (var i = e.resultIndex; i < e.results.length; i++) text += e.results[i][0].transcript;
      ui.input.value = (base + " " + text).trim();
      autoGrow(ui.input);
      updateMeter();
    };
    recog.onend = function () { recog = null; ui.mic.classList.remove("on"); };
    recog.onerror = function () { S.toast("Ошибка микрофона", "bad"); };
    recog.start();
    ui.mic.classList.add("on");
  }

  function speak(text) {
    if (!global.speechSynthesis) return;
    try {
      speechSynthesis.cancel();
      var p = (global.Persona && Persona.get()) || {};
      var u = new SpeechSynthesisUtterance(MD.strip(text).slice(0, 2400));
      u.lang = S.getLang() === "en" ? "en-US" : "ru-RU";
      u.rate = p.voiceRate || 1;
      u.pitch = p.voicePitch || 1.05;
      if (p.voiceName) {
        var match = speechSynthesis.getVoices().filter(function (v) { return v.name === p.voiceName; })[0];
        if (match) u.voice = match;
      }
      speechSynthesis.speak(u);
    } catch (e) {}
  }

  /* ------------------------------------------------------------- panels */
  function buildModelPanel(panel) {
    panel.innerHTML = "";
    panel.style.flexWrap = "wrap";

    var provider = S.el("select");
    [["local", "Автономно (без модели)"], ["cloudru", "Cloud.ru Foundation Models"],
     ["openai", "OpenAI-совместимый"], ["anthropic", "Anthropic"],
     ["ollama", "Ollama (локально)"]].forEach(function (o) {
      provider.appendChild(S.el("option", { value: o[0], text: o[1] }));
    });
    provider.value = cfg.provider;

    var model = S.el("input", { type: "text", value: cfg.model, placeholder: "модель", style: "width:180px" });
    var base = S.el("input", { type: "text", value: cfg.baseUrl, placeholder: "base url (необязательно)", style: "width:200px" });
    var key = S.el("input", { type: "password", value: cfg.apiKey, placeholder: "api key", style: "width:170px" });
    var temp = S.el("input", { type: "number", value: cfg.temperature, step: "0.1", min: "0", max: "2", style: "width:70px" });
    var save = S.el("button", { class: "btn sm primary", text: S.t("save") });

    save.addEventListener("click", function () {
      cfg.provider = provider.value;
      cfg.model = model.value.trim() || cfg.model;
      cfg.baseUrl = base.value.trim();
      cfg.apiKey = key.value;
      cfg.temperature = S.clamp(parseFloat(temp.value) || 0.7, 0, 2);
      persistConfig();
      updateChip();
      S.toast("Настройки модели сохранены", "ok");
      panel.classList.add("hide");
    });

    provider.addEventListener("change", function () {
      base.placeholder = PROVIDER_BASES[provider.value] || "base url (необязательно)";
      if (provider.value === "ollama" && !model.value) model.value = "llama3.1";
      if (provider.value === "anthropic" && !/claude/.test(model.value)) model.value = "claude-sonnet-4-5";
      if (provider.value === "cloudru" && !model.value) model.value = "openai/gpt-oss-120b";
    });
    base.placeholder = PROVIDER_BASES[cfg.provider] || "base url (необязательно)";

    [["Провайдер", provider], ["Модель", model], ["URL", base], ["Ключ", key], ["t°", temp]]
      .forEach(function (pair) {
        var box = S.el("label", { class: "inline", style: "gap:5px" });
        box.appendChild(S.el("span", { class: "tiny muted", text: pair[0] }));
        box.appendChild(pair[1]);
        panel.appendChild(box);
      });
    panel.appendChild(save);
    panel.appendChild(S.el("span", { class: "tiny muted", text: S.server.up ? "через локальный сервер" : "прямо из браузера" }));
  }

  function toggleModelPanel() {
    if (!ui.modelPanel) return;
    buildModelPanel(ui.modelPanel);
    ui.modelPanel.classList.toggle("hide");
  }

  function toggleFind() {
    ui.findRow.classList.toggle("hide");
    if (!ui.findRow.classList.contains("hide")) ui.findIn.focus();
    else runFind("");
  }

  function runFind(term) {
    term = (term || "").toLowerCase();
    S.qsa(".msg", ui.log).forEach(function (node) {
      var hit = term && node.textContent.toLowerCase().indexOf(term) >= 0;
      node.classList.toggle("hit", !!hit);
      node.style.display = (!term || hit) ? "" : "none";
    });
  }

  function showTemplates() {
    var items = templates.map(function (tpl) {
      return {
        label: tpl.name,
        act: function () {
          ui.input.value = tpl.text + ui.input.value;
          autoGrow(ui.input);
          ui.input.focus();
        }
      };
    });
    items.push({ sep: true });
    items.push({
      label: "+ Сохранить текущий текст как шаблон",
      act: function () {
        var text = ui.input.value.trim();
        if (!text) { S.toast("Поле ввода пустое", "bad"); return; }
        Dialog.prompt({
          title: "Новый шаблон",
          text: "Под каким именем сохранить этот текст?",
          value: text.slice(0, 24)
        }).then(function (name) {
          if (!name) return;
          templates.push({ id: S.uid("t"), name: name, text: text });
          S.save("chat.templates", templates);
          S.toast("Шаблон сохранён", "ok");
        });
      }
    });
    items.push({
      label: "Удалить шаблон...",
      act: function () {
        if (!templates.length) { S.toast("Шаблонов нет", "bad"); return; }
        Dialog.choose({
          title: "Удалить шаблон",
          options: templates.map(function (t) {
            return { label: t.name, note: t.text.slice(0, 48), value: t.id, icon: "trash" };
          })
        }).then(function (id) {
          if (!id) return;
          templates = templates.filter(function (t) { return t.id !== id; });
          S.save("chat.templates", templates);
          S.toast("Шаблон удалён", "ok");
        });
      }
    });
    var rect = ui.chip.getBoundingClientRect();
    global.Menu.show(rect.left, rect.bottom + 4, items, "Шаблоны");
  }

  function showExport() {
    var rect = ui.chip.getBoundingClientRect();
    global.Menu.show(rect.left, rect.bottom + 4, [
      { label: "Markdown (.md)", act: function () { exportChat("md"); } },
      { label: "Текст (.txt)", act: function () { exportChat("txt"); } },
      { label: "JSON (.json)", act: function () { exportChat("json"); } },
      { sep: true },
      { label: "Все чаты в JSON", act: function () { exportChat("all"); } },
      { label: "Импорт из JSON", act: importChat }
    ], S.t("export"));
  }

  function exportChat(kind) {
    var s = current();
    var stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    if (kind === "all") {
      S.download("sayumi-chats-" + stamp + ".json", JSON.stringify(sessions, null, 2), "application/json");
      return;
    }
    if (kind === "json") {
      S.download("sayumi-" + stamp + ".json", JSON.stringify(s, null, 2), "application/json");
      return;
    }
    var persona = (global.Persona && Persona.get()) || {};
    var lines = kind === "md"
      ? ["# " + s.title, "", "_" + S.dateTime(s.created) + "_", ""]
      : [s.title, ""];
    s.messages.forEach(function (m) {
      var who = m.role === "user" ? S.t("you") : m.role === "assistant" ? (persona.name || "Sayumi") : "system";
      if (kind === "md") lines.push("**" + who + "** · " + S.time(m.ts), "", m.text, "");
      else lines.push("[" + S.time(m.ts) + "] " + who + ": " + MD.strip(m.text), "");
    });
    S.download("sayumi-" + stamp + (kind === "md" ? ".md" : ".txt"), lines.join("\n"),
      kind === "md" ? "text/markdown" : "text/plain");
  }

  function importChat() {
    var picker = S.el("input", { type: "file", accept: ".json" });
    picker.addEventListener("change", function () {
      var file = picker.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var data = JSON.parse(String(reader.result));
          var list = Array.isArray(data) ? data : [data];
          list.forEach(function (s) {
            if (!s || !s.messages) return;
            s.id = S.uid("s");
            sessions.unshift(s);
          });
          persist();
          drawSessions();
          drawLog();
          S.toast("Импортировано: " + list.length, "ok");
        } catch (e) {
          S.toast("Не удалось прочитать файл", "bad");
        }
      };
      reader.readAsText(file);
    });
    picker.click();
  }

  /* --------------------------------------------------------------- init */
  if (!sessions.length) newSession(false);

  S.on("persona", function () { if (ui.log) drawLog(); });
  S.on("lang", function () { if (ui.log) { drawLog(); drawSessions(); } });

  global.Chat = {
    openWindow: openWindow,
    send: send,
    get config() { return cfg; },
    setConfig: function (patch) { Object.assign(cfg, patch); persistConfig(); updateChip(); },
    resetConfig: function () { cfg = Object.assign({}, DEF_CONFIG); persistConfig(); updateChip(); },
    PROVIDER_BASES: PROVIDER_BASES,
    exportAll: function () { return sessions; },
    clearAll: function () { sessions = []; newSession(false); persist(); if (ui.log) { drawSessions(); drawLog(); } },
    speak: speak,
    helpText: helpText
  };
})(window);
