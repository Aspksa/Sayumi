/* ==========================================================================
   Sayumi memory: a durable store of what she knows, how it is retrieved,
   and how she adapts over time.

   There is no embedding model available offline, so retrieval is a compact
   BM25-style scorer over stemmed tokens, blended with recency, usage and the
   weight a memory was given. It is honest keyword retrieval, not semantics,
   but it is fast, works from file:// and never leaves the machine.
   ========================================================================== */
(function (global) {
  "use strict";

  var LIMIT = 600;             /* hard cap before the weakest are forgotten */
  var CONTEXT_TOKENS = 700;    /* budget for what is injected into a prompt */

  var DEF = {
    v: 1,
    facts: [],
    sessions: {},
    growth: {
      xp: 0,
      messages: 0,
      replies: 0,
      sessions: 0,
      firstSeen: Date.now(),
      topics: {},
      hours: new Array(24).fill(0),
      cmds: {},
      tuned: []
    },
    log: []
  };

  var db = Object.assign({}, DEF, S.load("memory", {}));
  if (!db.growth.hours || db.growth.hours.length !== 24) db.growth.hours = new Array(24).fill(0);
  if (!Array.isArray(db.log)) db.log = [];

  var settings = Object.assign({
    enabled: true,
    autoLearn: true,
    distill: true,
    adapt: true,
    recall: 8,
    cooldown: 6
  }, S.load("memory.settings", {}));

  var index = null;            /* lazily rebuilt inverted index */
  var sinceDistill = 0;

  function save() {
    S.save("memory", db);
    S.syncOut("memory", db);
    index = null;
    S.emit("memory", db);
  }

  function saveSettings() {
    S.save("memory.settings", settings);
    S.emit("memory", db);
  }

  /* ------------------------------------------------------------ language */
  var STOP = ("и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по " +
    "только ее мне было вот от меня еще нет о из ему теперь когда даже ну вдруг ли если уже или " +
    "ни быть был него до вас нибудь опять уж вам ведь там потом себя ничего ей может они тут где " +
    "есть надо ней для мы тебя их чем была сам чтоб без будто чего раз тоже себе под будет ж тогда " +
    "кто этот того потому этого какой совсем ним здесь этом один почти мой тем чтобы нее сейчас " +
    "были куда зачем всех никогда можно при наконец два об другой хоть после над больше тот через " +
    "эти нас про всего них какая много разве три эту моя впрочем хорошо свою этой перед иногда " +
    "лучше чуть том нельзя такой им более всегда конечно всю между " +
    "the a an and or but is are was were be been to of in on at for with that this it as by from " +
    "not no yes do does did have has had will would can could should i you he she we they").split(/\s+/);

  var STOPSET = {};
  STOP.forEach(function (w) { STOPSET[w] = 1; });

  /* crude but effective: fold a word to its first syllables so that
     "проекта", "проектом", "проекты" all collapse to one key */
  function stem(word) {
    if (word.length <= 4) return word;
    var w = word
      .replace(/(ость|ения|ение|ениям|ами|ями|ого|ему|ых|ие|ые|ую|ой|ей|ом|ам|ов|ах|ях|ть|ся)$/u, "")
      .replace(/(ing|edly|ness|ment|tion|ies|ed|es|s)$/u, "");
    if (w.length < 3) w = word;
    return w.slice(0, 7);
  }

  function tokens(text) {
    var raw = String(text || "").toLowerCase().replace(/ё/g, "е");
    var words = raw.split(/[^0-9a-zA-Zа-яА-Я_]+/);
    var out = [];
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (!w || w.length < 3 || STOPSET[w]) continue;
      out.push(stem(w));
    }
    return out;
  }

  /* ------------------------------------------------------------- storage */
  function similarity(a, b) {
    var ta = tokens(a), tb = tokens(b);
    if (!ta.length || !tb.length) return 0;
    var set = {};
    ta.forEach(function (t) { set[t] = 1; });
    var hit = 0;
    tb.forEach(function (t) { if (set[t]) hit++; });
    return hit / Math.max(ta.length, tb.length);
  }

  function add(text, options) {
    text = String(text || "").trim().replace(/\s+/g, " ");
    if (!text || text.length < 4) return null;
    if (text.length > 400) text = text.slice(0, 400);
    options = options || {};

    /* a near duplicate strengthens the existing memory instead of piling up */
    for (var i = 0; i < db.facts.length; i++) {
      if (similarity(db.facts[i].text, text) > 0.72) {
        var old = db.facts[i];
        old.weight = Math.min(5, (old.weight || 1) + 0.5);
        old.updated = Date.now();
        if (text.length > old.text.length) old.text = text;
        save();
        return old;
      }
    }

    var fact = {
      id: S.uid("f"),
      text: text,
      kind: options.kind || "fact",
      tags: options.tags || [],
      weight: options.weight || 1,
      pinned: !!options.pinned,
      created: Date.now(),
      updated: Date.now(),
      uses: 0,
      lastUse: 0,
      src: options.src || "ручное"
    };
    db.facts.push(fact);
    note("запомнила: " + text.slice(0, 70), "add");
    forgetWeakest();
    save();
    return fact;
  }

  function remove(id) {
    db.facts = db.facts.filter(function (f) { return f.id !== id; });
    save();
  }

  function update(id, patch) {
    var fact = db.facts.filter(function (f) { return f.id === id; })[0];
    if (!fact) return;
    Object.assign(fact, patch, { updated: Date.now() });
    save();
  }

  /* when the store is full, the least useful unpinned memories fade out */
  function forgetWeakest() {
    if (db.facts.length <= LIMIT) return;
    var scored = db.facts.map(function (f) {
      return { f: f, s: staticScore(f) };
    }).sort(function (a, b) { return a.s - b.s; });
    var drop = db.facts.length - LIMIT;
    var dropped = 0;
    for (var i = 0; i < scored.length && dropped < drop; i++) {
      if (scored[i].f.pinned) continue;
      db.facts = db.facts.filter(function (f) { return f !== scored[i].f; });
      dropped++;
    }
    if (dropped) note("забыла " + dropped + " слабых записей, стало тесно", "forget");
  }

  function staticScore(f) {
    var ageDays = (Date.now() - (f.updated || f.created)) / 86400000;
    var recency = Math.exp(-ageDays / 45);
    return (f.weight || 1) + recency * 0.8 + Math.log(1 + (f.uses || 0)) * 0.4 +
      (f.pinned ? 10 : 0);
  }

  /* --------------------------------------------------------------- index */
  function buildIndex() {
    var map = {};
    db.facts.forEach(function (f) {
      var seen = {};
      tokens(f.text).forEach(function (t) {
        if (seen[t]) { seen[t]++; return; }
        seen[t] = 1;
      });
      f._tf = seen;
      Object.keys(seen).forEach(function (t) {
        (map[t] = map[t] || []).push(f);
      });
    });
    index = map;
  }

  function search(query, limit) {
    if (!index) buildIndex();
    var terms = tokens(query);
    if (!terms.length) {
      return db.facts.slice()
        .sort(function (a, b) { return staticScore(b) - staticScore(a); })
        .slice(0, limit || 10);
    }
    var total = Math.max(1, db.facts.length);
    var hits = {};
    terms.forEach(function (t) {
      var bucket = index[t];
      if (!bucket) return;
      var idf = Math.log(1 + total / bucket.length);
      bucket.forEach(function (f) {
        var tf = f._tf[t] || 1;
        hits[f.id] = (hits[f.id] || 0) + idf * (tf / (tf + 1.2));
      });
    });
    var out = [];
    db.facts.forEach(function (f) {
      if (!hits[f.id]) return;
      out.push({ f: f, s: hits[f.id] + staticScore(f) * 0.35 });
    });
    out.sort(function (a, b) { return b.s - a.s; });
    return out.slice(0, limit || 10).map(function (x) { return x.f; });
  }

  /* --------------------------------------------------- prompt injection */
  function context(query) {
    if (!settings.enabled || !db.facts.length) return "";
    var picked = search(query, settings.recall);

    /* keyword retrieval can miss entirely - "программирую" shares no stem with
       "пишу на Python". Top up with the memories that matter most anyway, so
       pinned and heavy facts are in front of her on every turn. */
    if (picked.length < settings.recall) {
      var seen = {};
      picked.forEach(function (f) { seen[f.id] = 1; });
      db.facts.slice()
        .sort(function (a, b) { return staticScore(b) - staticScore(a); })
        .forEach(function (f) {
          if (picked.length >= settings.recall || seen[f.id]) return;
          seen[f.id] = 1;
          picked.push(f);
        });
    }
    if (!picked.length) return "";

    var lines = [];
    var used = 0;
    picked.forEach(function (f) {
      var line = "- " + f.text;
      var cost = S.tokens(line);
      if (used + cost > CONTEXT_TOKENS) return;
      used += cost;
      lines.push(line);
      f.uses = (f.uses || 0) + 1;
      f.lastUse = Date.now();
    });
    if (!lines.length) return "";
    S.save("memory", db);
    return "Что ты помнишь о собеседнике и проекте (используй, если уместно, " +
      "не пересказывай без нужды):\n" + lines.join("\n");
  }

  /* ---------------------------------------------------- self observation */
  /* A sentence tail that keeps "Cloud.ru" whole: a dot only ends the capture
     when a space follows it, the way a real sentence ends. */
  var TAIL = "(?:[^.!?\\n]|\\.(?=\\S))";

  function rule(source, options) {
    options = options || {};
    return Object.assign({ re: new RegExp(source.replace(/@/g, TAIL), "iu") }, options);
  }

  var CATCH = [
    rule("(?:^|\\s)запомни[:,]?\\s+(@{6,300})", { kind: "fact", weight: 3, pin: true }),
    rule("(?:^|\\s)меня зовут\\s+([A-ZА-Яа-яa-z][^,!?\\n]{1,60})", { tpl: "Собеседника зовут $1", kind: "user", weight: 3, pin: true }),
    rule("(?:^|\\s)я работаю\\s+(@{3,90})", { tpl: "Собеседник работает $1", kind: "user", weight: 2 }),
    rule("(?:^|\\s)я живу\\s+(@{3,70})", { tpl: "Собеседник живёт $1", kind: "user", weight: 2 }),
    rule("(?:^|\\s)я (?:использую|пишу на|программирую на)\\s+(@{2,70})", { tpl: "Собеседник использует $1", kind: "pref", weight: 2 }),
    rule("(?:^|\\s)(?:мне нравится|я люблю|я предпочитаю)\\s+(@{3,90})", { tpl: "Собеседнику нравится $1", kind: "pref", weight: 2 }),
    rule("(?:^|\\s)(?:я не люблю|мне не нравится|терпеть не могу)\\s+(@{3,90})", { tpl: "Собеседник не любит $1", kind: "pref", weight: 2 }),
    rule("(?:^|\\s)(?:всегда|каждый раз)\\s+(@{4,90})", { tpl: "Правило: всегда $1", kind: "pref", weight: 2 }),
    rule("(?:^|\\s)(?:никогда не|не надо|не нужно)\\s+(@{4,90})", { tpl: "Правило: не $1", kind: "pref", weight: 2 }),
    rule("(?:^|\\s)(?:мой|моя|мои)\\s+(проект|репозиторий|сайт|бот|скрипт)\\s+(@{2,70})", { tpl: "У собеседника $1 $2", kind: "project", weight: 2 }),
    rule("(?:^|\\s)(?:решили|договорились|остановились на)\\s+(@{4,110})", { tpl: "Решение: $1", kind: "decision", weight: 2 })
  ];

  /* "Python и использую Cloud.ru" would otherwise become
     "использует Python и использую Cloud.ru" - drop the repeated verb */
  function cleanClause(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .replace(/\s+и\s+(?:использую|пишу на|программирую на|люблю|предпочитаю|работаю)\s+/giu, " и ")
      .replace(/^[\s,;:—-]+/u, "")
      .replace(/[\s,;:.!?—-]+$/u, "")
      .trim();
  }

  function learnFromUser(text) {
    if (!settings.enabled || !settings.autoLearn) return [];
    var found = [];
    CATCH.forEach(function (rule) {
      var m = String(text || "").match(rule.re);
      if (!m) return;
      var line = rule.tpl
        ? rule.tpl.replace(/\$(\d)/g, function (_, i) { return cleanClause(m[+i]); })
        : cleanClause(m[1]);
      if (line.length < 5) return;
      var fact = add(line, {
        kind: rule.kind,
        weight: rule.weight,
        pinned: !!rule.pin,
        src: "из беседы"
      });
      if (fact) found.push(fact);
    });
    return found;
  }

  /* an LLM, when one is connected, pulls out what the patterns above miss */
  function distill(session) {
    if (!settings.enabled || !settings.distill) return;
    var cfg = Chat.config;
    if (cfg.provider === "local" || !S.server.up) return;

    var recent = session.messages.slice(-10)
      .filter(function (m) { return m.role === "user" || m.role === "assistant"; })
      .map(function (m) { return (m.role === "user" ? "Собеседник: " : "Я: ") + m.text.slice(0, 600); })
      .join("\n");
    if (!recent) return;

    var known = db.facts.slice(-40).map(function (f) { return f.text; }).join("\n");

    S.api("/api/llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: cfg.provider, model: cfg.model, baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey, stream: false, temperature: 0, maxTokens: 400,
        system: "Ты выделяешь из диалога долговременные факты о собеседнике и его проекте: " +
          "имена, предпочтения, решения, правила, технологии, сроки. " +
          "Не записывай сиюминутное, вопросы и общие рассуждения. " +
          "Отвечай ТОЛЬКО массивом JSON строк на русском, каждая строка — один короткий факт. " +
          "Если запоминать нечего, верни []. Уже известное не повторяй.",
        messages: [{
          role: "user",
          content: "Уже известно:\n" + known + "\n\nНовый фрагмент диалога:\n" + recent
        }]
      })
    }).then(function (res) {
      if (!res.ok || !res.text) return;
      var raw = res.text.trim().replace(/^```(?:json)?/, "").replace(/```$/, "").trim();
      var list;
      try { list = JSON.parse(raw); } catch (e) { return; }
      if (!Array.isArray(list)) return;
      var added = 0;
      list.slice(0, 8).forEach(function (line) {
        if (typeof line !== "string") return;
        if (add(line, { kind: "fact", weight: 1.5, src: "выделено моделью" })) added++;
      });
      if (added) {
        note("модель выделила " + added + " новых фактов", "distill");
        S.toast("Запомнила " + added + " новых фактов", "ok");
      }
    }).catch(function () {});
  }

  /* summarise a conversation so an old session stays recallable cheaply */
  function summarise(session) {
    if (!session || session.messages.length < 4) return;
    var text = session.messages
      .filter(function (m) { return m.role === "user"; })
      .slice(-12).map(function (m) { return m.text; }).join(" ");
    var top = topTerms(text, 6);
    db.sessions[session.id] = {
      title: session.title,
      summary: top.join(", "),
      msgs: session.messages.length,
      updated: Date.now()
    };
  }

  function topTerms(text, n) {
    var counts = {};
    tokens(text).forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
    return Object.keys(counts)
      .sort(function (a, b) { return counts[b] - counts[a]; })
      .slice(0, n || 8);
  }

  /* ------------------------------------------------------ self adjusting */
  /* JavaScript \b is ASCII only, so it never fires next to a Cyrillic letter.
     These patterns guard the start with an explicit non letter instead. */
  var EDGE = "(?:^|[^А-Яа-яЁёA-Za-z])";

  function cue(words, field, by, why) {
    return { re: new RegExp(EDGE + "(?:" + words + ")", "iu"), field: field, by: by, why: why };
  }

  var TUNE = [
    cue("короче|покороче|кратко|не так подробно|без воды", "detail", -12, "просили короче"),
    cue("подробнее|подробней|подробно|развернуто|развёрнуто|детальн", "detail", 12, "просили подробнее"),
    cue("на ты(?![А-Яа-яЁё])", "formality", -25, "перешли на ты"),
    cue("на вы(?![А-Яа-яЁё])", "formality", 25, "перешли на вы"),
    cue("без шуток|серьезн|серьёзн", "humor", -15, "просили серьёзнее"),
    cue("пошути|с юмором|веселее", "humor", 15, "просили больше юмора"),
    cue("теплее|мягче|дружелюбн", "warmth", 12, "просили теплее"),
    cue("суше|строже|по делу(?![А-Яа-яЁё])", "warmth", -12, "просили строже")
  ];

  function adapt(text) {
    if (!settings.enabled || !settings.adapt) return;
    var persona = Persona.get();
    TUNE.forEach(function (rule) {
      if (!rule.re.test(text || "")) return;
      var before = persona[rule.field];
      var after = S.clamp(before + rule.by, 0, 100);
      if (after === before) return;
      var patch = {};
      patch[rule.field] = after;
      Persona.set(patch);
      db.growth.tuned.unshift({
        at: Date.now(), field: rule.field, from: before, to: after, why: rule.why
      });
      db.growth.tuned = db.growth.tuned.slice(0, 60);
      note("подстроилась: " + rule.field + " " + before + " → " + after + " (" + rule.why + ")", "tune");
      S.toast("Подстроилась: " + rule.why, "ok");
    });
  }

  function undoTuning() {
    var list = db.growth.tuned;
    if (!list.length) return;
    var patch = {};
    /* walk back in time so the earliest value wins */
    list.forEach(function (t) { patch[t.field] = t.from; });
    Persona.set(patch);
    db.growth.tuned = [];
    note("откатила все подстройки характера", "tune");
    save();
  }

  /* ------------------------------------------------------------- growth */
  function grow(amount, topicText) {
    var g = db.growth;
    g.xp += amount;
    if (topicText) {
      topTerms(topicText, 4).forEach(function (t) {
        g.topics[t] = (g.topics[t] || 0) + 1;
      });
    }
    g.hours[new Date().getHours()]++;
  }

  function level() {
    return Math.floor(Math.sqrt(db.growth.xp / 40)) + 1;
  }

  function levelProgress() {
    var lv = level();
    var base = (lv - 1) * (lv - 1) * 40;
    var next = lv * lv * 40;
    return { lv: lv, have: db.growth.xp - base, need: next - base, next: next };
  }

  function insights() {
    var g = db.growth;
    var out = [];
    var topics = Object.keys(g.topics).sort(function (a, b) { return g.topics[b] - g.topics[a]; });
    if (topics.length) out.push({ k: "Чаще всего обсуждаем", v: topics.slice(0, 5).join(", ") });

    var busiest = g.hours.indexOf(Math.max.apply(null, g.hours));
    if (g.hours[busiest]) out.push({ k: "Самое активное время", v: busiest + ":00 — " + (busiest + 1) + ":00" });

    var days = Math.max(1, Math.round((Date.now() - g.firstSeen) / 86400000));
    out.push({ k: "Знакомы", v: days + " дн., сообщений " + g.messages });
    if (g.messages) out.push({ k: "Ответов дано", v: String(g.replies) });

    var cmds = Object.keys(g.cmds).sort(function (a, b) { return g.cmds[b] - g.cmds[a]; });
    if (cmds.length) out.push({ k: "Любимые команды", v: cmds.slice(0, 4).map(function (c) { return "/" + c; }).join(" ") });

    var kinds = {};
    db.facts.forEach(function (f) { kinds[f.kind] = (kinds[f.kind] || 0) + 1; });
    var kindNames = { user: "о вас", pref: "предпочтения", project: "о проекте", decision: "решения", fact: "факты", summary: "итоги" };
    var parts = Object.keys(kinds).map(function (k) { return (kindNames[k] || k) + " " + kinds[k]; });
    if (parts.length) out.push({ k: "В памяти", v: parts.join(", ") });
    return out;
  }

  function profile() {
    var byKind = { user: [], pref: [], project: [], decision: [] };
    db.facts.forEach(function (f) {
      if (byKind[f.kind]) byKind[f.kind].push(f);
    });
    Object.keys(byKind).forEach(function (k) {
      byKind[k].sort(function (a, b) { return staticScore(b) - staticScore(a); });
    });
    return byKind;
  }

  function note(text, kind) {
    db.log.unshift({ at: Date.now(), text: text, kind: kind || "info" });
    db.log = db.log.slice(0, 200);
  }

  /* ------------------------------------------------------------- hooks */
  function onUser(text, session) {
    if (!settings.enabled) return;
    db.growth.messages++;
    grow(2, text);
    if (text.charAt(0) === "/") {
      var cmd = text.slice(1).split(/\s+/)[0].toLowerCase();
      db.growth.cmds[cmd] = (db.growth.cmds[cmd] || 0) + 1;
    }
    var learned = learnFromUser(text);
    if (learned.length) grow(5 * learned.length);
    adapt(text);
    save();
  }

  function onReply(session) {
    if (!settings.enabled) return;
    db.growth.replies++;
    grow(1);
    summarise(session);
    sinceDistill++;
    if (sinceDistill >= settings.cooldown) {
      sinceDistill = 0;
      distill(session);
    }
    save();
  }

  /* ------------------------------------------------------------- window */
  var KIND_LABEL = {
    user: "о вас", pref: "привычка", project: "проект",
    decision: "решение", fact: "факт", summary: "итог"
  };

  function openWindow() {
    if (Win.get("memory")) { Win.get("memory").focus(); return; }

    var shell = S.el("div", { class: "shell" });
    var rail = S.el("div", { class: "rail", style: "width:168px;flex:0 0 168px" });
    var body = S.el("div", { class: "pane-body" });
    shell.appendChild(rail);
    shell.appendChild(body);

    var pages = {
      facts:   { label: "Факты",    note: "что она помнит",   icon: "note",   draw: drawFacts },
      profile: { label: "Профиль",  note: "портрет собеседника", icon: "user", draw: drawProfile },
      growth:  { label: "Развитие", note: "опыт и подстройка", icon: "sparkle", draw: drawGrowth },
      log:     { label: "Журнал",   note: "что происходило",  icon: "task",   draw: drawLog }
    };
    var current = "facts";
    var buttons = {};

    rail.appendChild(S.el("div", { class: "rail-head", text: "Память" }));
    Object.keys(pages).forEach(function (key) {
      var page = pages[key];
      var item = S.el("button", { class: "rail-item" + (key === current ? " on" : "") });
      item.innerHTML = I.svg(page.icon) +
        '<span class="nm">' + page.label + "<small>" + page.note + "</small></span>";
      item.addEventListener("click", function () {
        current = key;
        Object.keys(buttons).forEach(function (k) { buttons[k].classList.toggle("on", k === key); });
        render();
      });
      buttons[key] = item;
      rail.appendChild(item);
    });

    function render() {
      body.innerHTML = "";
      body.scrollTop = 0;
      pages[current].draw(body, render);
    }
    render();
    var off = S.on("memory", function () { if (Win.get("memory")) render(); });

    Win.create({
      id: "memory",
      title: "Память Sayumi",
      width: 780, height: 600,
      content: shell,
      onClose: off
    });
  }

  function card(parent, title, note, icon) {
    var box = S.el("div", { class: "card" });
    var head = S.el("header");
    head.innerHTML = I.svg(icon || "note") +
      "<h3>" + S.esc(title) + (note ? "<small>" + S.esc(note) + "</small>" : "") + "</h3>";
    var inner = S.el("div", { class: "inner" });
    box.appendChild(head);
    box.appendChild(inner);
    parent.appendChild(box);
    return inner;
  }

  function factRow(fact, redraw) {
    var item = S.el("div", { class: "item", style: "align-items:flex-start" });

    var pin = S.el("button", {
      class: "btn sm ghost",
      title: fact.pinned ? "Открепить" : "Закрепить навсегда",
      style: fact.pinned ? "color:var(--acc)" : ""
    });
    pin.innerHTML = I.svg("pin");
    pin.addEventListener("click", function () {
      update(fact.id, { pinned: !fact.pinned });
      redraw();
    });

    var text = S.el("span", { class: "grow", style: "white-space:normal" });
    text.appendChild(S.el("span", { text: fact.text }));
    var meta = S.el("small", {
      class: "muted",
      style: "display:block;margin-top:4px;font-size:10.5px",
      text: (KIND_LABEL[fact.kind] || fact.kind) + " · " + fact.src +
        " · " + S.dateTime(fact.created) +
        (fact.uses ? " · вспоминала " + fact.uses : "")
    });
    text.appendChild(meta);
    text.addEventListener("dblclick", function () {
      var next = prompt("Изменить запись:", fact.text);
      if (next && next.trim()) { update(fact.id, { text: next.trim() }); redraw(); }
    });

    var del = I.btn("trash", { class: "btn sm ghost danger", title: "Забыть" });
    del.addEventListener("click", function () { remove(fact.id); redraw(); });

    item.appendChild(pin);
    item.appendChild(text);
    item.appendChild(del);
    return item;
  }

  function drawFacts(root, redraw) {
    var box = card(root, "Что она помнит",
      db.facts.length + " записей, предел " + LIMIT, "note");

    var tools = S.el("div", { class: "inline", style: "margin-bottom:12px" });
    var find = S.el("input", { class: "search", placeholder: "Поиск по памяти...", style: "flex:1" });
    var addBtn = I.btn("plus", { class: "btn sm primary", label: "Записать" });
    tools.appendChild(find);
    tools.appendChild(addBtn);
    box.appendChild(tools);

    var list = S.el("div", { class: "list" });
    box.appendChild(list);

    function paint() {
      list.innerHTML = "";
      var query = find.value.trim();
      var items = query
        ? search(query, 60)
        : db.facts.slice().sort(function (a, b) { return staticScore(b) - staticScore(a); });
      if (!items.length) {
        list.appendChild(S.el("div", { class: "empty" },
          query ? "Ничего не нашлось" :
          "Память пуста. Скажите в чате <b class=\"gold\">запомни: ...</b> — и она сохранит."));
        return;
      }
      items.slice(0, 120).forEach(function (f) { list.appendChild(factRow(f, redraw)); });
      if (items.length > 120) {
        list.appendChild(S.el("div", { class: "note tiny", text: "показаны первые 120 из " + items.length }));
      }
    }
    find.addEventListener("input", S.debounce(paint, 140));
    addBtn.addEventListener("click", function () {
      var text = prompt("Что запомнить?");
      if (!text) return;
      add(text, { kind: "fact", weight: 2, pinned: true, src: "ручное" });
      redraw();
    });
    paint();

    var acts = card(root, "Обслуживание", null, "database");
    var row = S.el("div", { class: "inline" });
    var bOut = S.el("button", { class: "btn", text: "Выгрузить память" });
    bOut.addEventListener("click", function () {
      S.download("sayumi-memory-" + new Date().toISOString().slice(0, 10) + ".json",
        JSON.stringify(db, null, 2), "application/json");
    });
    var bIn = S.el("button", { class: "btn", text: "Загрузить" });
    bIn.addEventListener("click", function () {
      var picker = S.el("input", { type: "file", accept: ".json" });
      picker.addEventListener("change", function () {
        var file = picker.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          try {
            if (global.Memory.importAll(JSON.parse(String(reader.result)))) {
              S.toast("Память загружена", "ok");
              redraw();
            } else S.toast("Файл не похож на память", "bad");
          } catch (e) { S.toast("Повреждённый файл", "bad"); }
        };
        reader.readAsText(file);
      });
      picker.click();
    });
    var bWipe = S.el("button", { class: "btn danger", text: "Стереть всё" });
    bWipe.addEventListener("click", function () {
      if (!confirm("Стереть всю память и опыт? Это нельзя отменить.")) return;
      global.Memory.wipe();
      redraw();
    });
    row.appendChild(bOut);
    row.appendChild(bIn);
    row.appendChild(bWipe);
    acts.appendChild(row);
  }

  function drawProfile(root, redraw) {
    var groups = profile();
    var titles = {
      user: ["Кто он", "имя, работа, обстоятельства", "user"],
      pref: ["Привычки и правила", "как он любит, чтобы было", "star"],
      project: ["Проект", "над чем работает", "folder"],
      decision: ["Решения", "о чём договорились", "check"]
    };
    var any = false;
    Object.keys(titles).forEach(function (kind) {
      var items = groups[kind] || [];
      if (!items.length) return;
      any = true;
      var box = card(root, titles[kind][0], titles[kind][1], titles[kind][2]);
      var list = S.el("div", { class: "list" });
      items.slice(0, 14).forEach(function (f) {
        var item = S.el("div", { class: "item" });
        item.appendChild(S.el("span", { class: "grow", style: "white-space:normal", text: f.text }));
        if (f.pinned) item.appendChild(S.el("span", { class: "gold tiny", text: "закреплено" }));
        list.appendChild(item);
      });
      box.appendChild(list);
    });
    if (!any) {
      card(root, "Портрет пока пуст", null, "user").appendChild(S.el("div", { class: "empty" },
        "Поговорите с ней — она сама начнёт замечать и запоминать.<br><br>" +
        "Можно и прямо: <b class=\"gold\">запомни: я пишу на Python</b>"));
    }
  }

  function drawGrowth(root, redraw) {
    var p = levelProgress();
    var box = card(root, "Уровень " + p.lv, "опыт накапливается от общения и работы", "sparkle");

    var bar = S.el("div", {
      style: "height:10px;border-radius:99px;background:var(--bg-0);overflow:hidden;" +
             "border:var(--bw) solid var(--line);margin-bottom:8px"
    });
    var fill = S.el("div", {
      style: "height:100%;width:" + Math.round(100 * p.have / Math.max(1, p.need)) + "%;" +
             "background:linear-gradient(90deg,var(--acc-soft),var(--acc));box-shadow:var(--glow)"
    });
    bar.appendChild(fill);
    box.appendChild(bar);
    box.appendChild(S.el("div", { class: "note tiny",
      text: p.have + " / " + p.need + " опыта до уровня " + (p.lv + 1) }));

    var stats = card(root, "Что она заметила", "выводы из вашей переписки", "search");
    var list = S.el("div", { class: "list" });
    insights().forEach(function (row) {
      var item = S.el("div", { class: "item" });
      item.appendChild(S.el("span", { class: "muted", style: "min-width:170px", text: row.k }));
      item.appendChild(S.el("span", { class: "grow gold", style: "white-space:normal", text: row.v }));
      list.appendChild(item);
    });
    stats.appendChild(list);

    var tuned = db.growth.tuned || [];
    var tuneBox = card(root, "Подстройка характера",
      tuned.length ? "она меняла себя " + tuned.length + " раз" : "пока не меняла себя", "sliders");
    if (!tuned.length) {
      tuneBox.appendChild(S.el("div", { class: "empty" },
        "Скажите в чате <b class=\"gold\">отвечай короче</b>, <b class=\"gold\">давай на ты</b> " +
        "или <b class=\"gold\">без шуток</b> — она подстроится сама."));
    } else {
      var tlist = S.el("div", { class: "list" });
      var names = { detail: "подробность", formality: "формальность", humor: "юмор", warmth: "теплота" };
      tuned.slice(0, 12).forEach(function (t) {
        var item = S.el("div", { class: "item" });
        item.appendChild(S.el("span", { class: "grow", style: "white-space:normal",
          text: (names[t.field] || t.field) + ": " + t.from + " → " + t.to + " · " + t.why }));
        item.appendChild(S.el("span", { class: "tiny muted", text: S.dateTime(t.at) }));
        tlist.appendChild(item);
      });
      tuneBox.appendChild(tlist);
      var undo = S.el("button", { class: "btn sm danger", text: "Откатить все подстройки" });
      undo.addEventListener("click", function () { undoTuning(); redraw(); });
      tuneBox.appendChild(S.el("div", { class: "inline", style: "margin-top:10px" })).appendChild(undo);
    }

    var sess = Object.keys(db.sessions || {});
    if (sess.length) {
      var sBox = card(root, "О чём были беседы", sess.length + " диалогов в памяти", "chat");
      var slist = S.el("div", { class: "list" });
      sess.map(function (k) { return db.sessions[k]; })
        .sort(function (a, b) { return b.updated - a.updated; })
        .slice(0, 12)
        .forEach(function (x) {
          var item = S.el("div", { class: "item" });
          item.appendChild(S.el("span", { style: "min-width:150px", text: x.title || "без названия" }));
          item.appendChild(S.el("span", { class: "grow muted tiny", style: "white-space:normal", text: x.summary }));
          item.appendChild(S.el("span", { class: "tiny muted", text: x.msgs + " сообщ." }));
          slist.appendChild(item);
        });
      sBox.appendChild(slist);
    }
  }

  function drawLog(root, redraw) {
    var box = card(root, "Журнал памяти", "последние события", "task");
    if (!db.log.length) {
      box.appendChild(S.el("div", { class: "empty", text: "Пока ничего не происходило" }));
      return;
    }
    var list = S.el("div", { class: "list" });
    db.log.slice(0, 80).forEach(function (entry) {
      var item = S.el("div", { class: "item" });
      item.appendChild(S.el("span", { class: "tiny muted", style: "min-width:110px", text: S.dateTime(entry.at) }));
      item.appendChild(S.el("span", { class: "grow", style: "white-space:normal", text: entry.text }));
      list.appendChild(item);
    });
    box.appendChild(list);
  }

  global.Memory = {
    get db() { return db; },
    get settings() { return settings; },
    setSettings: function (patch) { Object.assign(settings, patch); saveSettings(); },
    add: add, remove: remove, update: update, search: search, context: context,
    onUser: onUser, onReply: onReply, distill: distill,
    insights: insights, profile: profile, level: level, levelProgress: levelProgress,
    undoTuning: undoTuning, tokensOf: tokens,
    wipe: function () {
      db = JSON.parse(JSON.stringify(DEF));
      db.growth.firstSeen = Date.now();
      save();
    },
    openWindow: openWindow,
    exportAll: function () { return db; },
    importAll: function (data) {
      if (!data || !Array.isArray(data.facts)) return false;
      db = Object.assign({}, DEF, data);
      if (!db.growth.hours || db.growth.hours.length !== 24) db.growth.hours = new Array(24).fill(0);
      save();
      return true;
    }
  };
})(window);
