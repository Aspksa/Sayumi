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
    cooldown: 6,
    semantic: false,
    embedModel: "",
    reflectEvery: 40
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

  /* Porter stemmer for Russian (Snowball). A homemade "cut the ending off"
     rule left "проекта", "проектом" and "проекты" as three different keys,
     so recall missed the obvious. This folds them all to "проект". */
  var VOWEL = /[аеиоуыэюя]/;

  var PERFECTIVE_1 = /(в|вши|вшись)$/;
  var PERFECTIVE_2 = /(ив|ивши|ившись|ыв|ывши|ывшись)$/;
  var ADJECTIVE = /(ее|ие|ые|ое|ими|ыми|ей|ий|ый|ой|ем|им|ым|ом|его|ого|ему|ому|их|ых|ую|юю|ая|яя|ою|ею)$/;
  var PARTICIPLE_1 = /(ем|нн|вш|ющ|щ)$/;
  var PARTICIPLE_2 = /(ивш|ывш|ующ)$/;
  var REFLEXIVE = /(ся|сь)$/;
  var VERB_1 = /(ла|на|ете|йте|ли|й|л|ем|н|ло|но|ет|ют|ны|ть|ешь|нно)$/;
  var VERB_2 = /(ила|ыла|ена|ейте|уйте|ите|или|ыли|ей|уй|ил|ыл|им|ым|ен|ит|ыт|ену|ует|уют|ены|ить|ыть|ишь|ую|ю)$/;
  var NOUN = /(а|ев|ов|ие|ье|е|иями|ями|ами|еи|ии|и|ией|ей|ой|ий|й|иям|ям|ием|ем|ам|ом|о|у|ах|иях|ях|ы|ь|ию|ью|ю|ия|ья|я)$/;
  var SUPERLATIVE = /(ейш|ейше)$/;
  var DERIVATIONAL = /(ост|ость)$/;
  var I_END = /и$/;
  var SOFT_END = /ь$/;
  var DOUBLE_N = /нн$/;

  /* a suffix only counts when it sits inside the region it belongs to */
  function cut(word, region, re) {
    var tail = word.slice(region);
    var m = tail.match(re);
    if (!m) return null;
    return word.slice(0, region + tail.length - m[0].length);
  }

  /* the same, but the suffix must follow а or я */
  function cutAfterAYa(word, region, re) {
    var tail = word.slice(region);
    var m = tail.match(re);
    if (!m) return null;
    var before = tail.charAt(tail.length - m[0].length - 1);
    if (before !== "а" && before !== "я") return null;
    return word.slice(0, region + tail.length - m[0].length);
  }

  function regions(word) {
    var rv = word.length, r1 = word.length, r2 = word.length, i;
    for (i = 0; i < word.length; i++) {
      if (VOWEL.test(word[i])) { rv = i + 1; break; }
    }
    for (i = 1; i < word.length; i++) {
      if (!VOWEL.test(word[i]) && VOWEL.test(word[i - 1])) { r1 = i + 1; break; }
    }
    for (i = r1 + 1; i < word.length; i++) {
      if (!VOWEL.test(word[i]) && VOWEL.test(word[i - 1])) { r2 = i + 1; break; }
    }
    return { rv: rv, r1: r1, r2: r2 };
  }

  function stemRu(word) {
    word = word.replace(/ё/g, "е");
    if (word.length < 4) return word;
    var reg = regions(word);
    var out;

    /* step 1: gerund, or reflexive plus adjective / verb / noun */
    out = cutAfterAYa(word, reg.rv, PERFECTIVE_1) || cut(word, reg.rv, PERFECTIVE_2);
    if (!out) {
      var base = cut(word, reg.rv, REFLEXIVE) || word;
      var adj = cutAfterAYa(base, reg.rv, ADJECTIVE) || cut(base, reg.rv, ADJECTIVE);
      if (adj !== null && adj !== undefined && adj !== base) {
        out = cutAfterAYa(adj, reg.rv, PARTICIPLE_1) || cut(adj, reg.rv, PARTICIPLE_2) || adj;
      } else {
        out = cutAfterAYa(base, reg.rv, VERB_1) || cut(base, reg.rv, VERB_2) ||
              cut(base, reg.rv, NOUN) || base;
      }
    }

    /* step 2: a trailing и in RV goes */
    var trimmed = cut(out, reg.rv, I_END);
    if (trimmed) out = trimmed;

    /* step 3: derivational suffix inside R2 */
    var derived = cut(out, reg.r2, DERIVATIONAL);
    if (derived) out = derived;

    /* step 4: нн -> н, superlative, soft sign */
    if (DOUBLE_N.test(out)) {
      out = out.slice(0, -1);
    } else {
      var sup = cut(out, reg.rv, SUPERLATIVE);
      if (sup) {
        out = sup;
        if (DOUBLE_N.test(out)) out = out.slice(0, -1);
      } else {
        var soft = cut(out, reg.rv, SOFT_END);
        if (soft) out = soft;
      }
    }
    return out || word;
  }

  function stemEn(word) {
    if (word.length < 5) return word;
    var w = word
      .replace(/(ational|ization|iveness|fulness|ousness)$/, "")
      .replace(/(ements|ations|ingly|edly)$/, "")
      .replace(/(ement|ation)$/, "");
    /* plural first, so "settings" and "setting" land on the same root */
    if (/(sses|ies)$/.test(w)) w = w.slice(0, -2);
    else if (/[^s]s$/.test(w)) w = w.slice(0, -1);
    w = w.replace(/(ing|ness|ment|ism|ist|ed|ly)$/, "");
    return w.length >= 3 ? w : word;
  }

  function stem(word) {
    if (!word) return word;
    if (/^[a-z0-9_]+$/.test(word)) return stemEn(word);
    return stemRu(word);
  }

  function tokens(text) {
    var raw = String(text || "").toLowerCase().replace(/ё/g, "е");
    var words = raw.split(/[^0-9a-zA-Zа-яА-Я_]+/);
    var out = [];
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (!w || w.length < 3 || STOPSET[w]) continue;
      var root = stem(w);
      out.push(root);
      /* The algorithm is heuristic: "память" looks like a verb and folds to
         "памя" while "памяти" folds to "памят". A shared prefix key bridges
         those near misses; both sides of a search get it, so it stays fair. */
      if (w.length >= 6 && /[а-я]/.test(w)) {
        var prefix = w.slice(0, 5);
        if (prefix !== root) out.push(prefix);
      }
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

  /* ------------------------------------------------------------ vectors */
  /* Keyword search cannot tell that "на чём я программирую" and "пишет на
     Python" are the same question. When an embedding model is configured the
     facts are vectorised once and compared by cosine, blended with the
     keyword score so a miss on one side is covered by the other. */
  function cosine(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    var dot = 0, na = 0, nb = 0;
    for (var i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    if (!na || !nb) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  function canEmbed() {
    return settings.enabled && settings.semantic && settings.embedModel &&
      S.server.up && Chat.config.provider !== "local";
  }

  function embedRequest(texts) {
    var cfg = Chat.config;
    return S.api("/api/embed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: cfg.provider, baseUrl: cfg.baseUrl, apiKey: cfg.apiKey,
        model: settings.embedModel, input: texts
      })
    });
  }

  var embedding = false;

  /* vectorise whatever is still missing one, in small batches */
  function embedPending(onDone) {
    if (!canEmbed() || embedding) { if (onDone) onDone(0); return; }
    var pending = db.facts.filter(function (f) { return !f.vec; }).slice(0, 32);
    if (!pending.length) { if (onDone) onDone(0); return; }
    embedding = true;
    embedRequest(pending.map(function (f) { return f.text; }))
      .then(function (res) {
        embedding = false;
        if (!res.ok) {
          note("векторы не получились: " + (res.error || "?"), "embed");
          settings.semantic = false;
          saveSettings();
          S.toast("Семантический поиск выключен: " + (res.error || "ошибка"), "bad");
          if (onDone) onDone(0);
          return;
        }
        pending.forEach(function (f, i) {
          if (res.vectors[i]) f.vec = res.vectors[i];
        });
        note("векторизовано записей: " + pending.length, "embed");
        save();
        if (onDone) onDone(pending.length);
      })
      .catch(function (e) {
        embedding = false;
        note("векторы не получились: " + e.message, "embed");
        if (onDone) onDone(0);
      });
  }

  function semanticSearch(query, limit) {
    return embedRequest([query]).then(function (res) {
      if (!res.ok || !res.vectors.length) return [];
      var q = res.vectors[0];
      return db.facts
        .filter(function (f) { return f.vec; })
        .map(function (f) { return { f: f, s: cosine(q, f.vec) }; })
        .filter(function (x) { return x.s > 0.2; })
        .sort(function (a, b) { return b.s - a.s; })
        .slice(0, limit || 10)
        .map(function (x) { return x.f; });
    }).catch(function () { return []; });
  }

  /* --------------------------------------------------- prompt injection */
  /* filled by the background pass before a request, so context() stays sync */
  var semanticHint = [];

  function warm(query) {
    if (!canEmbed()) { semanticHint = []; return Promise.resolve(); }
    return new Promise(function (resolve) {
      embedPending(function () {
        semanticSearch(query, settings.recall).then(function (hits) {
          semanticHint = hits;
          resolve();
        });
      });
    });
  }

  function context(query) {
    if (!settings.enabled || !db.facts.length) return "";
    var picked = [];
    var seenId = {};
    /* vector hits first, they understood the question rather than matched it */
    semanticHint.forEach(function (f) {
      if (picked.length >= settings.recall || seenId[f.id]) return;
      seenId[f.id] = 1;
      picked.push(f);
    });
    search(query, settings.recall).forEach(function (f) {
      if (picked.length >= settings.recall || seenId[f.id]) return;
      seenId[f.id] = 1;
      picked.push(f);
    });
    semanticHint = [];

    /* keyword retrieval can miss entirely - "программирую" shares no stem with
       "пишу на Python". Top up with the memories that matter most anyway, so
       pinned and heavy facts are in front of her on every turn. */
    if (picked.length < settings.recall) {
      var seen = seenId;
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

  /* --------------------------------------------------------- reflection */
  /* Every so often she rereads what she knows and tidies it: merges the
     repetitive, drops what a later fact contradicts, and writes down the
     generalisation. Only ever applied to unpinned entries. */
  var reflecting = false;

  function reflect(manual) {
    if (reflecting) return Promise.resolve(false);
    var cfg = Chat.config;
    if (!settings.enabled || cfg.provider === "local" || !S.server.up) {
      if (manual) S.toast("Нужна подключённая модель и локальный сервер", "bad");
      return Promise.resolve(false);
    }
    var pool = db.facts.filter(function (f) { return !f.pinned; });
    if (pool.length < 6) {
      if (manual) S.toast("Пока слишком мало записей для осмысления", "bad");
      return Promise.resolve(false);
    }

    reflecting = true;
    var numbered = pool.slice(0, 80).map(function (f, i) { return (i + 1) + ". " + f.text; }).join("\n");

    return S.api("/api/llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: cfg.provider, model: cfg.model, baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey, stream: false, temperature: 0, maxTokens: 900,
        system: "Ты наводишь порядок в списке фактов о собеседнике и его проекте. " +
          "Верни ТОЛЬКО объект JSON вида " +
          '{"drop":[номера],"merge":[{"into":"новая формулировка","from":[номера]}],"insight":"одно наблюдение"}. ' +
          "В drop — номера записей, которые устарели, противоречат более новым или бессмысленны. " +
          "В merge — группы повторяющихся записей и их общая формулировка. " +
          "insight — короткий вывод о собеседнике, которого в списке ещё нет, или пустая строка. " +
          "Ничего не выдумывай сверх списка.",
        messages: [{ role: "user", content: numbered }]
      })
    }).then(function (res) {
      reflecting = false;
      if (!res.ok || !res.text) {
        if (manual) S.toast("Осмыслить не вышло: " + (res.error || "?"), "bad");
        return false;
      }
      var raw = res.text.trim().replace(/^```(?:json)?/, "").replace(/```$/, "").trim();
      var plan;
      try { plan = JSON.parse(raw); } catch (e) {
        if (manual) S.toast("Модель ответила не по форме", "bad");
        return false;
      }

      var dropped = 0, merged = 0;
      var byNumber = function (n) { return pool[Number(n) - 1]; };

      (plan.merge || []).slice(0, 20).forEach(function (group) {
        if (!group || !group.into || !Array.isArray(group.from)) return;
        var victims = group.from.map(byNumber).filter(function (f) { return f && !f.pinned; });
        if (victims.length < 2) return;
        var weight = victims.reduce(function (sum, f) { return sum + (f.weight || 1); }, 0);
        victims.forEach(function (f) {
          db.facts = db.facts.filter(function (x) { return x !== f; });
        });
        db.facts.push({
          id: S.uid("f"), text: String(group.into).slice(0, 400), kind: "fact",
          tags: [], weight: Math.min(5, weight), pinned: false,
          created: Date.now(), updated: Date.now(), uses: 0, lastUse: 0,
          src: "после осмысления"
        });
        merged += victims.length;
      });

      (plan.drop || []).slice(0, 40).forEach(function (n) {
        var f = byNumber(n);
        if (!f || f.pinned) return;
        if (db.facts.indexOf(f) < 0) return;
        db.facts = db.facts.filter(function (x) { return x !== f; });
        dropped++;
      });

      if (plan.insight && String(plan.insight).trim().length > 8) {
        add(String(plan.insight).trim(), { kind: "summary", weight: 2, src: "вывод после осмысления" });
      }

      db.growth.reflections = (db.growth.reflections || 0) + 1;
      db.growth.sinceReflect = 0;
      note("осмыслила память: объединила " + merged + ", убрала " + dropped, "reflect");
      save();
      if (merged || dropped) {
        S.toast("Осмыслила память: −" + (merged + dropped) + " записей", "ok");
      } else if (manual) {
        S.toast("Память уже в порядке", "ok");
      }
      return true;
    }).catch(function (e) {
      reflecting = false;
      if (manual) S.toast("Ошибка: " + e.message, "bad");
      return false;
    });
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
    db.growth.sinceReflect = (db.growth.sinceReflect || 0) + 1;
    if (settings.reflectEvery > 0 && db.growth.sinceReflect >= settings.reflectEvery) {
      db.growth.sinceReflect = 0;
      reflect(false);
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
      graph:   { label: "Связи",    note: "карта того, что знает", icon: "graph", draw: drawGraph },
      time:    { label: "Хроника",  note: "что и когда узнала", icon: "refresh", draw: drawTimeline },
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
    var offWidth = Win.watchWidth(body, 780);

    Win.create({
      id: "memory",
      title: "Память Sayumi",
      weight: 0.96, weightH: 1, minWidth: 560, minHeight: 440,
      content: shell,
      onClose: function () { off(); offWidth(); }
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
      Dialog.prompt({ title: "Изменить запись", value: fact.text, multiline: true, rows: 3 })
        .then(function (next) {
          if (!next || !next.trim()) return;
          update(fact.id, { text: next.trim() });
          redraw();
        });
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
    box.parentNode.classList.add("wide");

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
      Dialog.prompt({
        title: "Записать в память",
        text: "Короткий факт, который она должна помнить всегда.",
        placeholder: "например: проект на Python, отвечать кратко",
        multiline: true, rows: 3
      }).then(function (text) {
        if (!text) return;
        add(text, { kind: "fact", weight: 2, pinned: true, src: "ручное" });
        redraw();
      });
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
      Dialog.confirm({
        title: "Стереть память",
        text: "Все записи, портрет собеседника и накопленный опыт исчезнут. " +
              "Выгрузите копию, если она может пригодиться.",
        ok: "Стереть всё", danger: true
      }).then(function (yes) {
        if (!yes) return;
        global.Memory.wipe();
        redraw();
      });
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

  /* --------------------------------------------------------- graph page */
  /* Facts become nodes; two facts are tied when they share a stem. The same
     spring layout as the notes graph, so the two read as one idea. */
  function drawGraph(root, redraw) {
    var box = card(root, "Карта памяти",
      "записи связаны общими словами, цвет — по виду", "graph");
    box.parentNode.classList.add("wide");

    if (db.facts.length < 2) {
      box.appendChild(S.el("div", { class: "empty", text: "Нужно хотя бы две записи" }));
      return;
    }

    var holder = S.el("div", { class: "grow-canvas" });
    var canvas = S.el("canvas", { style: "position:absolute;inset:0;width:100%;height:100%;cursor:grab" });
    var label = S.el("div", {
      class: "note tiny",
      style: "position:absolute;left:12px;right:12px;bottom:10px;pointer-events:none;" +
             "text-align:center;color:var(--acc)"
    });
    holder.appendChild(canvas);
    holder.appendChild(label);
    box.appendChild(holder);
    /* the graph takes whatever height the window leaves after the legend */
    var offHeight = Win.fillHeight(holder, 190);

    var KIND_HUE = {
      user: "#6f94c0", pref: "#c9a227", project: "#5f9c7b",
      decision: "#b4674a", summary: "#8a6fb5", fact: "#a4acb8"
    };

    var ctx = canvas.getContext("2d");
    var nodes = db.facts.slice(0, 90).map(function (f, i) {
      var angle = (i / Math.min(90, db.facts.length)) * Math.PI * 2;
      return {
        f: f,
        x: Math.cos(angle) * 170 + (Math.random() - 0.5) * 30,
        y: Math.sin(angle) * 170 + (Math.random() - 0.5) * 30,
        vx: 0, vy: 0, deg: 0, keys: new Set(tokens(f.text))
      };
    });

    var edges = [];
    for (var i = 0; i < nodes.length; i++) {
      for (var j = i + 1; j < nodes.length; j++) {
        var shared = 0;
        nodes[i].keys.forEach(function (k) { if (nodes[j].keys.has(k)) shared++; });
        if (shared >= 2) {
          edges.push({ a: nodes[i], b: nodes[j], w: shared });
          nodes[i].deg++; nodes[j].deg++;
        }
      }
    }
    label.textContent = "записей " + nodes.length + " · связей " + edges.length;

    var centre = { x: 0, y: 0 };
    var frames = 0, raf = null, hover = null, drag = null, near = null;

    function step() {
      for (var i = 0; i < nodes.length; i++) {
        var a = nodes[i];
        a.vx -= a.x * 0.0018;
        a.vy -= a.y * 0.0018;
        for (var j = i + 1; j < nodes.length; j++) {
          var b = nodes[j];
          var dx = b.x - a.x, dy = b.y - a.y;
          var d2 = dx * dx + dy * dy || 0.01;
          var d = Math.sqrt(d2);
          var push = 2200 / d2;
          a.vx -= (dx / d) * push; a.vy -= (dy / d) * push;
          b.vx += (dx / d) * push; b.vy += (dy / d) * push;
        }
      }
      edges.forEach(function (e) {
        var dx = e.b.x - e.a.x, dy = e.b.y - e.a.y;
        var d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        var force = (d - 100) * 0.011;
        e.a.vx += (dx / d) * force; e.a.vy += (dy / d) * force;
        e.b.vx -= (dx / d) * force; e.b.vy -= (dy / d) * force;
      });
      nodes.forEach(function (n) {
        if (n === drag) { n.vx = n.vy = 0; return; }
        n.vx *= 0.82; n.vy *= 0.82;
        n.x += n.vx; n.y += n.vy;
      });
      var sx = 0, sy = 0;
      nodes.forEach(function (n) { sx += n.x; sy += n.y; });
      centre.x += (sx / nodes.length - centre.x) * 0.08;
      centre.y += (sy / nodes.length - centre.y) * 0.08;
    }

    function paint() {
      var ratio = window.devicePixelRatio || 1;
      var w = holder.clientWidth, h = holder.clientHeight;
      if (canvas.width !== w * ratio || canvas.height !== h * ratio) {
        canvas.width = w * ratio; canvas.height = h * ratio;
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.scale(0.8, 0.8);
      ctx.translate(-centre.x, -centre.y);

      edges.forEach(function (e) {
        var lit = near && near.has(e.a) && near.has(e.b);
        ctx.beginPath();
        ctx.moveTo(e.a.x, e.a.y);
        ctx.lineTo(e.b.x, e.b.y);
        ctx.strokeStyle = lit ? "rgba(var(--acc-rgb),1)" : "#3a3a44";
        ctx.globalAlpha = near ? (lit ? 0.8 : 0.08) : Math.min(0.5, 0.18 + e.w * 0.08);
        ctx.lineWidth = lit ? 1.6 : 1;
        ctx.stroke();
      });
      ctx.globalAlpha = 1;

      nodes.forEach(function (n) {
        var r = 4 + Math.min(7, n.deg * 1.2) + (n.f.pinned ? 2 : 0);
        var dim = near && !near.has(n) ? 0.18 : 1;
        ctx.globalAlpha = dim;
        ctx.beginPath();
        ctx.ellipse(n.x + 1, n.y + r, r * 0.9, r * 0.3, 0, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,.5)";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = KIND_HUE[n.f.kind] || "#a4acb8";
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = n === hover ? 18 : 8;
        ctx.fill();
        ctx.shadowBlur = 0;
        if (n.f.pinned) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + 3, 0, Math.PI * 2);
          ctx.strokeStyle = "#e0bb45";
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      });
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    function loop() {
      if (frames < 380 || drag) { step(); frames++; }
      paint();
      raf = requestAnimationFrame(loop);
    }
    loop();

    function at(e) {
      var rect = canvas.getBoundingClientRect();
      var x = (e.clientX - rect.left - rect.width / 2) / 0.8 + centre.x;
      var y = (e.clientY - rect.top - rect.height / 2) / 0.8 + centre.y;
      var best = null, bestD = 18;
      nodes.forEach(function (n) {
        var d = Math.hypot(n.x - x, n.y - y);
        if (d < bestD) { bestD = d; best = n; }
      });
      return { x: x, y: y, node: best };
    }

    canvas.addEventListener("pointermove", function (e) {
      var hit = at(e);
      if (drag) { drag.x = hit.x; drag.y = hit.y; return; }
      hover = hit.node;
      if (hover) {
        near = new Set([hover]);
        edges.forEach(function (edge) {
          if (edge.a === hover) near.add(edge.b);
          if (edge.b === hover) near.add(edge.a);
        });
        label.textContent = hover.f.text;
      } else {
        near = null;
        label.textContent = "записей " + nodes.length + " · связей " + edges.length;
      }
      canvas.style.cursor = hover ? "pointer" : "grab";
    });
    canvas.addEventListener("pointerdown", function (e) {
      var hit = at(e);
      if (hit.node) { drag = hit.node; canvas.setPointerCapture(e.pointerId); }
    });
    canvas.addEventListener("pointerup", function (e) {
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
      drag = null;
    });
    canvas.addEventListener("pointerleave", function () {
      near = null; hover = null;
      label.textContent = "записей " + nodes.length + " · связей " + edges.length;
    });

    var legend = S.el("div", { class: "inline", style: "margin-top:12px" });
    Object.keys(KIND_LABEL).forEach(function (kind) {
      var chip = S.el("span", { class: "chip" });
      var dot = S.el("i", {
        style: "width:8px;height:8px;border-radius:50%;display:inline-block;background:" +
               (KIND_HUE[kind] || "#a4acb8")
      });
      chip.appendChild(dot);
      chip.appendChild(S.el("span", { text: KIND_LABEL[kind] }));
      legend.appendChild(chip);
    });
    box.appendChild(legend);

    /* the window redraws on every memory change, so the loop must be stopped */
    var win = Win.get("memory");
    if (win) {
      var stop = function () { cancelAnimationFrame(raf); };
      holder.addEventListener("DOMNodeRemoved", stop);
      var guard = setInterval(function () {
        if (!document.body.contains(canvas)) {
          stop();
          offHeight();
          clearInterval(guard);
        }
      }, 1200);
    }
  }

  /* ------------------------------------------------------ timeline page */
  function drawTimeline(root, redraw) {
    var box = card(root, "Хроника знаний",
      "что она узнала и когда; ползунок показывает память на дату", "refresh");
    box.parentNode.classList.add("wide");

    if (!db.facts.length) {
      box.appendChild(S.el("div", { class: "empty", text: "Пока нечего вспоминать" }));
      return;
    }

    var sorted = db.facts.slice().sort(function (a, b) { return a.created - b.created; });
    var first = sorted[0].created;
    var last = sorted[sorted.length - 1].created;
    var span = Math.max(1, last - first);

    var row = S.el("div", { class: "row" });
    row.appendChild(S.el("div", { class: "lab", text: "Память на момент" }));
    var ctl = S.el("div", { class: "ctl", style: "flex:1" });
    var slider = S.el("input", { type: "range", min: 0, max: 100, value: 100, style: "width:100%" });
    var when = S.el("span", { class: "val", style: "min-width:120px", text: S.dateTime(last) });
    ctl.appendChild(slider);
    ctl.appendChild(when);
    row.appendChild(ctl);
    box.appendChild(row);

    var count = S.el("div", { class: "note tiny" });
    var list = S.el("div", { class: "list" });
    box.appendChild(count);
    box.appendChild(list);

    function paint() {
      var cut = first + span * (Number(slider.value) / 100);
      when.textContent = S.dateTime(cut);
      var known = sorted.filter(function (f) { return f.created <= cut; });
      count.textContent = "знала записей: " + known.length + " из " + sorted.length;

      list.innerHTML = "";
      var byDay = {};
      known.forEach(function (f) {
        var day = S.dateTime(f.created).slice(0, 10);
        (byDay[day] = byDay[day] || []).push(f);
      });
      Object.keys(byDay).sort().reverse().slice(0, 12).forEach(function (day) {
        var head = S.el("div", {
          class: "tiny gold",
          style: "margin:10px 0 2px;letter-spacing:.1em;text-transform:uppercase"
        });
        head.textContent = day + "  ·  " + byDay[day].length;
        list.appendChild(head);
        byDay[day].slice(0, 10).forEach(function (f) {
          var item = S.el("div", { class: "item" });
          item.appendChild(S.el("span", { class: "tiny muted", style: "min-width:46px", text: S.time(f.created) }));
          item.appendChild(S.el("span", { class: "grow", style: "white-space:normal", text: f.text }));
          item.appendChild(S.el("span", { class: "tiny muted", text: KIND_LABEL[f.kind] || f.kind }));
          list.appendChild(item);
        });
      });
    }
    slider.addEventListener("input", paint);
    paint();
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

    var think = card(root, "Осмысление",
      "раз в " + Memory.settings.reflectEvery + " ответов она пересматривает память", "refresh");
    think.appendChild(S.el("div", { class: "note tiny",
      text: "Объединяет повторы, убирает устаревшее и записывает вывод. " +
            "Закреплённое не трогает. Осмыслений: " + (db.growth.reflections || 0) }));
    var bThink = S.el("button", { class: "btn primary", text: "Осмыслить сейчас" });
    bThink.addEventListener("click", function () {
      bThink.disabled = true;
      bThink.textContent = "Думает...";
      reflect(true).then(function () {
        bThink.disabled = false;
        bThink.textContent = "Осмыслить сейчас";
        redraw();
      });
    });
    think.appendChild(S.el("div", { class: "inline", style: "margin-top:10px" })).appendChild(bThink);

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
    box.parentNode.classList.add("wide");
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
    reflect: reflect, warm: warm, embedPending: embedPending, cosine: cosine,
    canEmbed: canEmbed,
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
