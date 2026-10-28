/* ==========================================================================
   Unit tests for the parts that are pure logic.
   The browser files are loaded into a sandbox with the few globals they
   expect, so they are tested exactly as they ship - no duplicated code.
   ========================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WEB = path.join(__dirname, "..", "web", "js");

function sandbox() {
  const store = {};
  const win = {
    localStorage: {
      length: 0,
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
      key: (i) => Object.keys(store)[i]
    },
    location: { protocol: "http:", origin: "http://127.0.0.1:1", href: "http://127.0.0.1:1/" },
    navigator: {},
    document: {
      documentElement: { setAttribute() {}, style: { setProperty() {} }, getAttribute: () => "on" },
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {},
                              classList: { add() {}, remove() {}, toggle() {} },
                              getContext: () => ({ font: "", measureText: () => ({ width: 10 }) }) }),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      fonts: { check: () => true }
    },
    fetch: () => Promise.reject(new Error("no network in unit tests")),
    setTimeout, clearTimeout, setInterval, clearInterval,
    console
  };
  Object.defineProperty(win.localStorage, "length", {
    get: () => Object.keys(store).length
  });
  win.window = win;
  const ctx = vm.createContext(win);
  return { ctx, store };
}

function load(ctx, ...files) {
  for (const f of files) {
    const code = fs.readFileSync(path.join(WEB, f + ".js"), "utf8");
    vm.runInContext(code, ctx, { filename: f + ".js" });
  }
}

/* ------------------------------------------------------------- harness -- */
const results = [];
let group = "";

function describe(name, fn) { group = name; fn(); }
function it(name, fn) {
  try {
    fn();
    results.push({ ok: true, name: group + " › " + name });
  } catch (e) {
    results.push({ ok: false, name: group + " › " + name, err: e.message });
  }
}
function eq(actual, expected, hint) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error((hint ? hint + ": " : "") + "ожидалось " + b + ", получено " + a);
}
function ok(value, hint) {
  if (!value) throw new Error(hint || "ожидалось истинное значение, получено " + JSON.stringify(value));
}

/* ========================================================== markdown ==== */
describe("markdown", () => {
  const { ctx } = sandbox();
  load(ctx, "core", "markdown");
  const MD = ctx.MD;
  const un = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const codeOf = (out) => {
    const body = out.slice(out.indexOf("<pre>") + 11, out.indexOf("</code>"));
    return un(body.replace(/<[^>]+>/g, ""));
  };

  it("экранирует html из текста", () => {
    const out = MD.render("<script>alert(1)</script>");
    ok(out.indexOf("<script>") < 0, "тег не должен пройти сырым");
    ok(out.indexOf("&lt;script&gt;") >= 0);
  });

  it("сохраняет код посимвольно, без утечки плейсхолдеров", () => {
    const src = "const grid = 4; // всё кратно четырём\nlet n = 12;";
    const out = MD.render("```js\n" + src + "\n```");
    eq(codeOf(out).trim(), src);
    ok(!/[\u0000-]/.test(out), "плейсхолдеры не должны попасть в вывод");
  });

  it("не считает # комментарием в javascript", () => {
    const out = MD.render("```js\nvar a = '#hash';\n```");
    ok(out.indexOf("tk-str") >= 0, "строка должна подсветиться");
  });

  it("строит таблицу", () => {
    const out = MD.render("| a | b |\n| --- | --- |\n| 1 | 2 |");
    ok(out.indexOf("<table>") >= 0 && out.indexOf("<th>") >= 0);
  });

  it("делает ссылку кликабельной, но не выполняет javascript:", () => {
    const out = MD.render("[тык](https://example.com) и javascript:alert(1)");
    ok(out.indexOf('href="https://example.com"') >= 0);
    ok(out.indexOf('href="javascript:') < 0, "javascript-ссылка не должна стать href");
  });

  it("переживает незакрытый блок кода", () => {
    const out = MD.render("```js\nconst a = 1;");
    ok(typeof out === "string" && out.length > 0);
  });
});

/* ============================================================ memory ==== */
describe("память", () => {
  const { ctx } = sandbox();
  load(ctx, "core", "icons", "markdown", "memory");
  const M = ctx.Memory;

  const shares = (a, b) => {
    const x = new Set(M.tokensOf(a));
    return M.tokensOf(b).some((t) => x.has(t));
  };

  /* tokensOf returns the stem first, then an optional prefix bridge key */
  const stemOf = (w) => M.tokensOf(w)[0];

  it("сводит падежи существительного к одной основе", () => {
    const forms = ["проект", "проекта", "проектом", "проекты", "проектах", "проектов"];
    eq(new Set(forms.map(stemOf)).size, 1, forms.map(stemOf).join("/"));
  });

  it("сводит формы прилагательного", () => {
    const forms = ["красивый", "красивая", "красивое", "красивые", "красивым"];
    eq(new Set(forms.map(stemOf)).size, 1, forms.map(stemOf).join("/"));
  });

  it("связывает слова, которые алгоритм разводит по-разному", () => {
    ok(shares("память", "памяти"), "память и памяти должны пересекаться");
    ok(shares("настройка", "настройки"), "настройка и настройки");
    ok(shares("работать", "работа"), "работать и работа");
  });

  it("не склеивает разные слова", () => {
    ok(!shares("проект", "программа"));
    ok(!shares("память", "помидор"));
  });

  it("стеммит английский отдельно", () => {
    eq(new Set(M.tokensOf("setting settings")).size, 1);
  });

  it("выбрасывает стоп-слова и короткие", () => {
    eq(M.tokensOf("и в на я с"), []);
  });

  it("запоминает факт и находит его по слову", () => {
    M.add("Собеседник использует Python и Cloud.ru", { kind: "pref" });
    const hit = M.search("python", 5);
    eq(hit.length > 0, true, "по слову python должно найтись");
    ok(hit[0].text.indexOf("Python") >= 0);
  });

  it("усиливает похожую запись вместо дубликата", () => {
    const before = M.db.facts.length;
    M.add("Собеседник использует Python и Cloud.ru", { kind: "pref" });
    eq(M.db.facts.length, before, "дубликат не должен добавиться");
  });

  it("подмешивает в промпт даже когда слова не совпали", () => {
    const text = M.context("на чём я программирую?");
    ok(text.length > 0, "должна добрать важное, а не молчать");
    ok(text.indexOf("Python") >= 0);
  });

  it("пустая память ничего не подмешивает", () => {
    const fresh = sandbox();
    load(fresh.ctx, "core", "icons", "markdown", "memory");
    eq(fresh.ctx.Memory.context("что угодно"), "");
  });

  it("растёт в уровне от опыта", () => {
    const start = M.level();
    for (let i = 0; i < 40; i++) M.add("факт номер " + i + " про разное дело " + i);
    ok(M.level() >= start);
  });

  it("не хранит больше предела", () => {
    for (let i = 0; i < 700; i++) M.add("мусорная запись под номером " + i + " совсем разная");
    ok(M.db.facts.length <= 600, "предел 600, стало " + M.db.facts.length);
  });
});

/* ========================================================= migrations === */
describe("миграции", () => {
  it("проставляет версию на пустых данных", () => {
    const { ctx } = sandbox();
    load(ctx, "core", "migrate");
    const res = ctx.Migrate.run();
    eq(res.version, ctx.Migrate.VERSION);
    eq(ctx.S.load("schemaVersion", 0), ctx.Migrate.VERSION);
  });

  it("даёт id старым сообщениям без них", () => {
    const { ctx } = sandbox();
    load(ctx, "core", "migrate");
    ctx.S.save("chat.sessions", [{ id: "s1", title: "x", messages: [{ role: "user", text: "привет" }] }]);
    ctx.Migrate.run();
    const after = ctx.S.load("chat.sessions", []);
    ok(after[0].messages[0].id, "id должен появиться");
    ok(after[0].messages[0].ts, "время должно появиться");
  });

  it("переносит факты из старых настроек в память", () => {
    const { ctx } = sandbox();
    load(ctx, "core", "migrate");
    ctx.S.save("persona", { name: "Sayumi", facts: ["пишет на Python", "любит кратко"] });
    ctx.Migrate.run();
    const mem = ctx.S.load("memory", null);
    ok(mem, "память должна появиться");
    eq(mem.facts.length, 2);
    ok(mem.facts[0].pinned);
  });

  it("делает снимок перед переносом", () => {
    const { ctx } = sandbox();
    load(ctx, "core", "migrate");
    ctx.S.save("chat.sessions", [{ id: "s1", messages: [] }]);
    ctx.Migrate.run();
    ok(ctx.Migrate.backups().length > 0, "снимок должен быть создан");
  });

  it("не трогает данные от более новой версии", () => {
    const { ctx } = sandbox();
    load(ctx, "core", "migrate");
    ctx.S.save("schemaVersion", 999);
    const res = ctx.Migrate.run();
    eq(res.newer, true);
    eq(ctx.S.load("schemaVersion", 0), 999);
  });

  it("повторный запуск ничего не делает", () => {
    const { ctx } = sandbox();
    load(ctx, "core", "migrate");
    ctx.Migrate.run();
    eq(ctx.Migrate.run().ran, 0);
  });
});

/* ============================================================== core ==== */
describe("ядро", () => {
  const { ctx } = sandbox();
  load(ctx, "core");
  const S = ctx.S;

  it("экранирует опасные символы", () => {
    eq(S.esc('<b>"x"</b>'), "&lt;b&gt;&quot;x&quot;&lt;/b&gt;");
  });

  it("зажимает значение в границы", () => {
    eq(S.clamp(50, 0, 10), 10);
    eq(S.clamp(-5, 0, 10), 0);
  });

  it("переживает недоступное хранилище", () => {
    const broken = sandbox();
    broken.ctx.localStorage.setItem = () => { throw new Error("quota"); };
    load(broken.ctx, "core");
    broken.ctx.S.save("k", { a: 1 });
    eq(broken.ctx.S.load("k", null), { a: 1 }, "должно уйти в память процесса");
  });

  it("возвращает запасное значение на битом json", () => {
    S.save("bad", { a: 1 });
    ctx.localStorage.setItem("sayumi.bad", "{не json");
    eq(S.load("bad", "fallback"), "fallback");
  });

  it("считает токены примерно", () => {
    ok(S.tokens("а".repeat(34)) >= 9 && S.tokens("а".repeat(34)) <= 11);
  });
});

/* ============================================================ report ==== */
const bad = results.filter((r) => !r.ok);
results.forEach((r) => {
  console.log((r.ok ? "  ok   " : "  ПАДЕТ") + "  " + r.name + (r.err ? "\n         " + r.err : ""));
});
console.log("\nюнит: " + (results.length - bad.length) + " из " + results.length + " прошли");
process.exit(bad.length ? 1 : 0);
