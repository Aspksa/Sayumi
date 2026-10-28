/* ==========================================================================
   Browser tests: the flows a person actually performs, driven through a real
   Chromium against a real server, with a stand-in model provider.
   ========================================================================== */
"use strict";

const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");

const ROOT = path.join(__dirname, "..");
const PORT = 8899;
const FAKE_PORT = 9912;

const results = [];
let group = "";

function describe(name) { group = name; }
async function it(name, fn) {
  try {
    await fn();
    results.push({ ok: true, name: group + " › " + name });
  } catch (e) {
    results.push({ ok: false, name: group + " › " + name, err: e.message });
  }
}
function ok(v, hint) { if (!v) throw new Error(hint || "ожидалось истинное значение"); }
function eq(a, b, hint) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error((hint ? hint + ": " : "") + "ожидалось " + y + ", получено " + x);
}

/* a tiny OpenAI-compatible provider so chat paths can be exercised */
function fakeProvider() {
  const MODELS = ["openai/gpt-oss-120b", "Qwen/Qwen3-235B-A22B", "deepseek-ai/DeepSeek-V3"];
  return http.createServer((req, res) => {
    const auth = req.headers.authorization === "Bearer TEST-KEY";
    const send = (obj, code = 200) => {
      const raw = JSON.stringify(obj);
      res.writeHead(code, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(raw) });
      res.end(raw);
    };
    if (!auth) return send({ error: { message: "bad key" } }, 401);
    if (req.method === "GET" && req.url.endsWith("/models")) {
      return send({ data: MODELS.map((id) => ({ id })) });
    }
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      let parsed = {};
      try { parsed = JSON.parse(body || "{}"); } catch (e) { /* keep empty */ }
      const asked = (parsed.messages || []).map((m) => m.content).join(" ");
      const text = asked.includes("JSON") || (parsed.system || "").includes("JSON")
        ? '["собеседник проверяет тесты"]'
        : "ответ от " + parsed.model;
      send({ choices: [{ message: { role: "assistant", content: text } }] });
    });
  }).listen(FAKE_PORT, "127.0.0.1");
}

async function waitFor(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("сервер не поднялся: " + url);
}

(async () => {
  const provider = fakeProvider();
  const dataDir = path.join(require("os").tmpdir(), "sayumi-test-" + Date.now());
  const server = spawn("python3", [path.join(ROOT, "server", "server.py"),
    "--port", String(PORT), "--root", ROOT, "--data", dataDir, "--no-pick-port"],
    { stdio: "ignore" });

  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const errors = [];
  let page;

  try {
    await waitFor(`http://127.0.0.1:${PORT}/api/health`);
    page = await browser.newPage({ viewport: { width: 1360, height: 880 } });
    page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE: " + m.text()); });

    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(700);

    /* ---------------------------------------------------------- avatar -- */
    describe("аватар");
    await it("левая кнопка открывает чат", async () => {
      await page.click("#avatar");
      await page.waitForTimeout(500);
      eq(await page.locator('[data-win="chat"]').count(), 1);
    });

    await it("правая кнопка открывает её настройки", async () => {
      await page.click("#avatar", { button: "right" });
      await page.waitForTimeout(400);
      eq(await page.locator('[data-win="persona"]').count(), 1);
      await page.locator('[data-win="persona"] .win-tools button.close').click();
    });

    await it("перетаскивается по экрану", async () => {
      const before = await page.locator("#avatar").boundingBox();
      await page.mouse.move(before.x + before.width / 2, before.y + 40);
      await page.mouse.down();
      await page.mouse.move(260, 520, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(300);
      const after = await page.locator("#avatar").boundingBox();
      ok(Math.abs(after.x - before.x) > 100, "должна сдвинуться");
    });

    /* ----------------------------------------------------------- chat --- */
    describe("чат");
    await it("автономный режим отвечает без модели", async () => {
      await page.fill(".composer textarea", "2+2*10");
      await page.press(".composer textarea", "Enter");
      await page.waitForTimeout(1800);
      const last = await page.evaluate(() => {
        const s = Chat.exportAll().find((x) => x.messages.length);
        return s.messages[s.messages.length - 1].text;
      });
      ok(last.includes("22"), "должна посчитать: " + last);
    });

    await it("команда /help печатает справку", async () => {
      await page.fill(".composer textarea", "/help");
      await page.press(".composer textarea", "Enter");
      await page.waitForTimeout(500);
      ok(await page.locator('[data-win="chat"] .msg.sys').count() > 0);
    });

    await it("подключается к провайдеру и отвечает", async () => {
      await page.evaluate((port) => Chat.setConfig({
        provider: "cloudru", baseUrl: `http://127.0.0.1:${port}/v1`,
        apiKey: "TEST-KEY", model: "openai/gpt-oss-120b", stream: false
      }), FAKE_PORT);
      await page.fill(".composer textarea", "скажи что-нибудь");
      await page.press(".composer textarea", "Enter");
      await page.waitForTimeout(2200);
      const last = await page.evaluate(() => {
        const s = Chat.exportAll().find((x) => x.messages.length);
        return s.messages[s.messages.length - 1].text;
      });
      ok(last.includes("ответ от"), "получено: " + last);
    });

    await it("каталог моделей приходит с сервера", async () => {
      const models = await page.evaluate(() => S.api("/api/models", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "cloudru", baseUrl: Chat.config.baseUrl, apiKey: Chat.config.apiKey })
      }));
      ok(models.ok && models.models.length >= 3, JSON.stringify(models).slice(0, 120));
    });

    await it("неверный ключ не ломает интерфейс", async () => {
      const res = await page.evaluate(() => S.api("/api/models", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "cloudru", baseUrl: Chat.config.baseUrl, apiKey: "WRONG" })
      }));
      eq(res.ok, false);
      ok(String(res.error).includes("401"), "ожидался 401: " + res.error);
    });

    /* --------------------------------------------------------- dialogs -- */
    describe("диалоги");
    await it("подтверждение рисуется своё, не браузерное", async () => {
      /* the promise settles only when the dialog closes, so awaiting it here
         would hang the test waiting for an answer it has not given yet */
      await page.evaluate(() => {
        window.__answer = Dialog.confirm({ title: "Проверка", text: "вопрос" });
      });
      await page.waitForTimeout(300);
      eq(await page.locator(".modal-back.show").count(), 1);
    });

    await it("Esc отменяет и возвращает false", async () => {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
      eq(await page.locator(".modal-back.show").count(), 0);
      eq(await page.evaluate(() => window.__answer), false);
    });

    await it("возвращает введённое значение", async () => {
      const value = await page.evaluate(async () => {
        const p = Dialog.prompt({ title: "Имя", value: "" });
        await new Promise((r) => setTimeout(r, 120));
        const field = document.querySelector(".modal input");
        field.value = "Алексей";
        document.querySelectorAll(".modal-foot .btn")[1].click();
        return p;
      });
      eq(value, "Алексей");
    });

    /* ---------------------------------------------------------- memory -- */
    describe("память");
    await it("запоминает сказанное прямо", async () => {
      await page.fill(".composer textarea", "запомни: проект на Python");
      await page.press(".composer textarea", "Enter");
      await page.waitForTimeout(1600);
      const facts = await page.evaluate(() => Memory.db.facts.map((f) => f.text));
      ok(facts.some((f) => f.includes("Python")), JSON.stringify(facts));
    });

    await it("ловит имя из обычной речи", async () => {
      await page.fill(".composer textarea", "меня зовут Алексей");
      await page.press(".composer textarea", "Enter");
      await page.waitForTimeout(1600);
      const facts = await page.evaluate(() => Memory.db.facts.map((f) => f.text));
      ok(facts.some((f) => f.includes("Алексей")), JSON.stringify(facts));
    });

    await it("подстраивает характер по просьбе", async () => {
      const before = await page.evaluate(() => Persona.get().detail);
      await page.fill(".composer textarea", "отвечай короче");
      await page.press(".composer textarea", "Enter");
      await page.waitForTimeout(1600);
      const after = await page.evaluate(() => Persona.get().detail);
      ok(after < before, `подробность должна упасть: ${before} -> ${after}`);
    });

    await it("переживает перезагрузку", async () => {
      const before = await page.evaluate(() => Memory.db.facts.length);
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForTimeout(800);
      const after = await page.evaluate(() => Memory.db.facts.length);
      eq(after, before);
    });

    /* ----------------------------------------------------------- notes -- */
    describe("заметки и задачи");
    await it("связывает заметки через [[ссылки]]", async () => {
      await page.evaluate(() => {
        localStorage.setItem("sayumi.tools.notes", JSON.stringify([
          { id: "n1", title: "Проект", text: "Смотри [[Сервер]]", updated: Date.now() },
          { id: "n2", title: "Сервер", text: "Назад к [[Проект]]", updated: Date.now() }
        ]));
      });
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForTimeout(700);
      await page.click("#nav-notes");
      await page.waitForTimeout(500);
      await page.locator('[data-win="notes"] button[title="Предпросмотр"]').click();
      await page.waitForTimeout(400);
      ok(await page.locator('[data-win="notes"] .wikilink').count() > 0);
    });

    await it("строит граф связей", async () => {
      await page.locator('[data-win="notes"] button[title="Граф связей"]').click();
      await page.waitForTimeout(1500);
      eq(await page.locator('[data-win="graph"] canvas').count(), 1);
      await page.locator('[data-win="graph"] .win-tools button.close').click();
      await page.locator('[data-win="notes"] .win-tools button.close').click();
    });

    await it("добавляет задачу", async () => {
      await page.click("#nav-tasks");
      await page.waitForTimeout(400);
      await page.fill('[data-win="tasks"] input.search', "проверить тесты");
      await page.press('[data-win="tasks"] input.search', "Enter");
      await page.waitForTimeout(400);
      const count = await page.evaluate(() => Tools.tasks.length);
      ok(count > 0);
      await page.locator('[data-win="tasks"] .win-tools button.close').click();
    });

    /* -------------------------------------------------------- settings -- */
    describe("настройки");
    await it("меняет тему целиком", async () => {
      await page.click("#btn-settings");
      await page.waitForTimeout(500);
      await page.locator('[data-win="settings"] .tile', { hasText: "Графит" }).click();
      await page.waitForTimeout(400);
      eq(await page.evaluate(() => document.documentElement.getAttribute("data-bg")), "graphite");
    });

    await it("живой макет и превью тем на месте", async () => {
      eq(await page.locator('[data-win="settings"] .mock').count(), 1);
      ok(await page.locator('[data-win="settings"] .tile').count() >= 10);
    });

    await it("ползунок формы правит токены", async () => {
      await page.evaluate(() => Theme.set({ radius: 20, borderW: 2 }));
      await page.waitForTimeout(200);
      const vars = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        return [cs.getPropertyValue("--r-m").trim(), cs.getPropertyValue("--bw").trim()];
      });
      eq(vars, ["20px", "2px"]);
    });

    /* ----------------------------------------------------- status bar --- */
    describe("строка состояния");
    await it("показывает сервер, модель и память", async () => {
      const text = await page.evaluate(() => document.querySelector(".statusbar").textContent);
      ok(text.includes("127.0.0.1"), "адрес сервера");
      ok(/пам/.test(text), "память");
    });

    /* --------------------------------------------------------- branching */
    describe("ветвление диалога");
    await it("перегенерация сохраняет прежний ответ как вариант", async () => {
      await page.evaluate(() => {
        Object.keys(Win.open).forEach((k) => Win.open[k].close());
        localStorage.setItem("sayumi.chat.sessions", JSON.stringify([{
          id: "b1", title: "ветка", pinned: false, created: Date.now(), updated: Date.now(),
          messages: [
            { id: "u1", role: "user", text: "вопрос", ts: Date.now() },
            { id: "a1", role: "assistant", text: "первый ответ", ts: Date.now() }
          ]
        }]));
        localStorage.setItem("sayumi.chat.current", JSON.stringify("b1"));
      });
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForTimeout(800);
      await page.evaluate((port) => {
        Chat.setConfig({ provider: "cloudru", baseUrl: "http://127.0.0.1:" + port + "/v1",
                         apiKey: "TEST-KEY", model: "openai/gpt-oss-120b", stream: false });
        Chat.openWindow();
      }, FAKE_PORT);
      await page.waitForTimeout(500);
      await page.locator('[data-win="chat"] .msg.a [data-act="regen"]').first().click();
      await page.waitForTimeout(2400);

      const info = await page.evaluate(() => {
        const s = Chat.exportAll().find((x) => x.id === "b1");
        const group = s.messages.filter((m) => m.group);
        return {
          kept: s.messages.some((m) => m.text === "первый ответ"),
          variants: group.length,
          visible: group.filter((m) => !m.hidden).length
        };
      });
      ok(info.kept, "старый ответ не должен исчезнуть");
      ok(info.variants >= 2, "должно стать минимум два варианта, стало " + info.variants);
      eq(info.visible, 1, "виден ровно один вариант");
    });

    await it("переключает варианты стрелками", async () => {
      ok(await page.locator('[data-win="chat"] .variants').count() > 0, "пагинатор должен появиться");
      const before = await page.evaluate(() => {
        const s = Chat.exportAll().find((x) => x.id === "b1");
        return s.messages.find((m) => m.group && !m.hidden).text;
      });
      await page.locator('[data-win="chat"] .variants [data-act="prev"]').first().click();
      await page.waitForTimeout(400);
      const after = await page.evaluate(() => {
        const s = Chat.exportAll().find((x) => x.id === "b1");
        return s.messages.find((m) => m.group && !m.hidden).text;
      });
      ok(before !== after, "видимый вариант должен смениться");
    });

    /* ---------------------------------------------------------- codebase */
    describe("чтение проекта");
    await it("читает рабочую папку и режет на фрагменты", async () => {
      const filler = "# наполнение строкой\n".repeat(60);
      await page.evaluate((body) => S.api("/api/file", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "demo/launcher.py", text: body })
      }), "def start_server(port):\n    # Поднимает локальный сервер Sayumi\n    return port\n\n" + filler);
      const res = await page.evaluate(() => new Promise((done) => Codebase.scan(done)));
      ok(res && res.files.length > 0, "файлы должны найтись");
      ok(res.chunks.length > 0, "фрагменты должны получиться");
    });

    await it("находит фрагмент по смыслу вопроса", async () => {
      const hits = await page.evaluate(() => Codebase.search("как поднимается сервер", 3)
        .map((c) => c.path));
      ok(hits.some((p) => p.includes("launcher")), "ожидался launcher.py, получено " + hits);
    });

    await it("подмешивает код в промпт только когда включено", async () => {
      const off = await page.evaluate(() => {
        Codebase.setSettings({ enabled: false });
        return Codebase.context("сервер");
      });
      eq(off, "");
      const on = await page.evaluate(() => {
        Codebase.setSettings({ enabled: true });
        return Codebase.context("как поднимается сервер");
      });
      ok(on.indexOf("launcher.py") >= 0, "в промпт должен попасть путь файла");
    });

    /* -------------------------------------------------------------- board */
    describe("доска задач");
    await it("разбирает приоритет и дату из строки", async () => {
      await page.evaluate(() => {
        Object.keys(Win.open).forEach((k) => Win.open[k].close());
        localStorage.setItem("sayumi.tools.tasks", "[]");
      });
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForTimeout(700);
      await page.click("#nav-tasks");
      await page.waitForTimeout(400);
      await page.fill('[data-win="tasks"] input.search', "сдать отчёт !важно 2020-01-01");
      await page.press('[data-win="tasks"] input.search', "Enter");
      await page.waitForTimeout(400);
      const t = await page.evaluate(() => Tools.tasks[0]);
      eq(t.prio, "high");
      eq(t.due, "2020-01-01");
      ok(t.text.indexOf("!важно") < 0, "метка должна уйти из текста: " + t.text);
    });

    await it("вчерашний срок считается просроченным, а не сегодняшним", async () => {
      const kinds = await page.evaluate(() => {
        const day = 86400000;
        const at = (shift) => new Date(Date.now() + shift * day).toISOString().slice(0, 10);
        return {
          yesterday: Tools.dueState({ due: at(-1), col: "todo" }).kind,
          today: Tools.dueState({ due: at(0), col: "todo" }).kind,
          tomorrow: Tools.dueState({ due: at(1), col: "todo" }).kind,
          far: Tools.dueState({ due: at(30), col: "todo" }).kind,
          done: Tools.dueState({ due: at(-1), col: "done" })
        };
      });
      eq(kinds.yesterday, "late");
      eq(kinds.today, "today");
      eq(kinds.tomorrow, "soon");
      eq(kinds.far, "far");
      eq(kinds.done, null, "готовая задача не напоминает о себе");
    });

    await it("показывает просрочку", async () => {
      const state = await page.evaluate(() => Tools.dueState(Tools.tasks[0]));
      eq(state.kind, "late");
      ok(await page.locator('[data-win="tasks"] .t-due.late').count() > 0);
    });

    await it("рисует три колонки", async () => {
      eq(await page.locator('[data-win="tasks"] .column').count(), 3);
      await page.locator('[data-win="tasks"] .win-tools button.close').click();
    });

    /* ------------------------------------------------------------ compact */
    describe("компактная раскладка");
    await it("окно разворачивается во весь экран на узком", async () => {
      await page.setViewportSize({ width: 420, height: 760 });
      await page.waitForTimeout(400);
      await page.evaluate(() => Chat.openWindow());
      await page.waitForTimeout(400);
      const box = await page.locator('[data-win="chat"]').boundingBox();
      ok(box.width >= 410, "ширина окна должна занять экран, стало " + box.width);
      eq(await page.locator(".topnav").isVisible(), false, "навигация прячется");
      await page.setViewportSize({ width: 1360, height: 880 });
      await page.waitForTimeout(400);
    });

    /* ------------------------------------------------------- window size */
    describe("размер окон");
    await it("окно открывается долей экрана, а не фиксированным размером", async () => {
      await page.evaluate(() => {
        Object.keys(Win.open).forEach((k) => Win.open[k].close());
        S.allKeys().forEach((k) => { if (k.indexOf("win.") === 0) S.drop(k); });
        S.save("winSize", "normal");
      });
      await page.setViewportSize({ width: 1800, height: 1000 });
      await page.waitForTimeout(300);
      await page.evaluate(() => Chat.openWindow());
      await page.waitForTimeout(400);
      const wide = (await page.locator('[data-win="chat"]').boundingBox()).width;

      await page.evaluate(() => {
        Object.keys(Win.open).forEach((k) => Win.open[k].close());
        S.allKeys().forEach((k) => { if (k.indexOf("win.") === 0) S.drop(k); });
      });
      await page.setViewportSize({ width: 1200, height: 900 });
      await page.waitForTimeout(300);
      await page.evaluate(() => Chat.openWindow());
      await page.waitForTimeout(400);
      const narrow = (await page.locator('[data-win="chat"]').boundingBox()).width;

      ok(wide > narrow + 300, `на широком экране окно должно быть шире: ${wide} против ${narrow}`);
      ok(wide > 1800 * 0.6, "на 1800 ширина должна превысить 60% экрана, стало " + wide);
    });

    await it("регулятор размера меняет ширину", async () => {
      await page.setViewportSize({ width: 1600, height: 950 });
      await page.waitForTimeout(300);
      const sizes = await page.evaluate(async () => {
        const out = {};
        for (const name of ["compact", "roomy", "huge"]) {
          Object.keys(Win.open).forEach((k) => Win.open[k].close());
          Win.setSize(name);
          Chat.openWindow();
          await new Promise((r) => setTimeout(r, 120));
          out[name] = document.querySelector('[data-win="chat"]').getBoundingClientRect().width;
        }
        Win.setSize("normal");
        return out;
      });
      ok(sizes.compact < sizes.roomy, "просторно должно быть шире компактного");
      ok(sizes.roomy < sizes.huge, "во весь экран шире просторного");
    });

    await it("память раскладывает карточки в две колонки на широком", async () => {
      await page.evaluate(() => {
        Object.keys(Win.open).forEach((k) => Win.open[k].close());
        S.allKeys().forEach((k) => { if (k.indexOf("win.") === 0) S.drop(k); });
        Win.setSize("huge");
        Memory.openWindow();
      });
      await page.waitForTimeout(600);
      eq(await page.locator('[data-win="memory"] .pane-body.cols').count(), 1,
        "широкая панель должна перейти в колонки");
      await page.evaluate(() => Win.setSize("compact"));
      await page.waitForTimeout(600);
      eq(await page.locator('[data-win="memory"] .pane-body.cols').count(), 0,
        "узкая панель остаётся одной лентой");
      await page.evaluate(() => { Win.setSize("normal"); Win.open.memory.close(); });
    });

    await it("карточки в колонках не налезают друг на друга", async () => {
      await page.setViewportSize({ width: 1800, height: 1000 });
      await page.evaluate(() => {
        Object.keys(Win.open).forEach((k) => Win.open[k].close());
        S.allKeys().forEach((k) => { if (k.indexOf("win.") === 0) S.drop(k); });
        Win.setSize("huge");
        Settings.openWindow();
      });
      await page.waitForTimeout(700);
      const bad = await page.evaluate(() => {
        const body = document.querySelector('[data-win="settings"] .pane-body');
        const problems = [];
        [...body.children].forEach((el) => {
          /* a card taller than the grid row it sits in spills over the next */
          if (el.scrollHeight > el.getBoundingClientRect().height + 2) {
            problems.push((el.textContent || "").slice(0, 24) + " обрезана");
          }
        });
        const boxes = [...body.children].map((el) => el.getBoundingClientRect());
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i], b = boxes[j];
            const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            if (overlapY > 4 && overlapX > 4) problems.push("наложение " + i + " и " + j);
          }
        }
        return problems;
      });
      eq(bad, []);
      await page.evaluate(() => { Win.setSize("normal"); Win.open.settings.close(); });
      await page.setViewportSize({ width: 1360, height: 880 });
      await page.waitForTimeout(300);
    });

    await it("карта памяти растёт вместе с окном", async () => {
      await page.evaluate(() => {
        S.allKeys().forEach((k) => { if (k.indexOf("win.") === 0) S.drop(k); });
        Win.setSize("huge");
        Memory.openWindow();
      });
      await page.waitForTimeout(500);
      await page.evaluate(() => {
        const w = document.querySelector('[data-win="memory"]');
        [...w.querySelectorAll(".rail-item")].find((b) => b.textContent.includes("Связи")).click();
      });
      await page.waitForTimeout(900);
      const tall = await page.evaluate(() =>
        document.querySelector('[data-win="memory"] .grow-canvas').clientHeight);
      ok(tall > 420, "холст должен перерасти прежние 420 точек, стало " + tall);
      await page.evaluate(() => { Win.setSize("normal"); Win.open.memory.close(); });
      await page.setViewportSize({ width: 1360, height: 880 });
      await page.waitForTimeout(300);
    });

    /* ------------------------------------------------------------- links */
    describe("связи между окнами");
    await it("сообщение чата становится задачей со связью", async () => {
      await page.evaluate(() => {
        Object.keys(Win.open).forEach((k) => Win.open[k].close());
        localStorage.setItem("sayumi.tools.tasks", "[]");
        localStorage.setItem("sayumi.links", "{}");
        localStorage.setItem("sayumi.chat.sessions", JSON.stringify([{
          id: "L1", title: "рабочий", pinned: false, created: Date.now(), updated: Date.now(),
          messages: [{ id: "m1", role: "assistant", text: "Надо вынести стеммер в отдельный модуль", ts: Date.now() }]
        }]));
        localStorage.setItem("sayumi.chat.current", JSON.stringify("L1"));
      });
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForTimeout(800);
      await page.evaluate(() => Chat.openWindow());
      await page.waitForTimeout(400);

      await page.locator('[data-win="chat"] .msg [data-act="send"]').first().click();
      await page.waitForTimeout(300);
      await page.locator("#ctx button", { hasText: "Сделать задачей" }).click();
      await page.waitForTimeout(500);

      const made = await page.evaluate(() => ({
        tasks: Tools.tasks.map((t) => t.text),
        links: Links.of({ t: "chat", id: "L1" })
      }));
      ok(made.tasks.some((t) => t.includes("стеммер")), "задача должна появиться: " + made.tasks);
      ok(made.links.some((r) => r.t === "task"), "связь чат → задача должна записаться");
    });

    await it("связь видна обеими сторонами и ведёт назад", async () => {
      const back = await page.evaluate(() => {
        const task = Tools.tasks[0];
        return Links.of({ t: "task", id: task.id }).map((r) => r.t);
      });
      ok(back.indexOf("chat") >= 0, "задача должна знать про чат, получено " + back);
    });

    await it("сообщение можно записать в память", async () => {
      await page.locator('[data-win="chat"] .msg [data-act="send"]').first().click();
      await page.waitForTimeout(300);
      await page.locator("#ctx button", { hasText: "Записать в память" }).click();
      await page.waitForTimeout(600);
      const facts = await page.evaluate(() => Memory.db.facts.map((f) => f.text));
      ok(facts.some((f) => f.includes("стеммер")), "факт должен появиться: " + facts.length);
    });

    await it("удаление сущности убирает мёртвые связи", async () => {
      const before = await page.evaluate(() => Object.keys(Links.db).length);
      const removed = await page.evaluate(() => {
        Tools.tasks.length = 0;
        S.save("tools.tasks", []);
        return Links.prune();
      });
      ok(removed > 0, "мёртвая связь должна быть убрана");
      const after = await page.evaluate(() => Object.keys(Links.db).length);
      ok(after < before, `связей должно стать меньше: ${before} → ${after}`);
    });

    /* ------------------------------------------------------------ search */
    describe("сквозной поиск");
    await it("находит одним запросом в чатах, заметках, задачах и памяти", async () => {
      await page.evaluate(() => {
        Object.keys(Win.open).forEach((k) => Win.open[k].close());
        localStorage.setItem("sayumi.tools.notes", JSON.stringify([
          { id: "sn1", title: "Стеммер", text: "Алгоритм Портера для русского", updated: Date.now() }
        ]));
        localStorage.setItem("sayumi.tools.tasks", JSON.stringify([
          { id: "st1", text: "Переписать стеммер", col: "todo", prio: "normal", due: "", updated: Date.now() }
        ]));
      });
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForTimeout(800);
      const kinds = await page.evaluate(() => {
        const hits = Search.all("стеммер", 40);
        return [...new Set(hits.map((h) => h.kind))].sort();
      });
      ok(kinds.indexOf("note") >= 0, "заметка: " + kinds);
      ok(kinds.indexOf("task") >= 0, "задача: " + kinds);
      ok(kinds.indexOf("chat") >= 0, "чат: " + kinds);
      ok(kinds.indexOf("fact") >= 0, "память: " + kinds);
    });

    await it("ищет по другой форме слова", async () => {
      const hits = await page.evaluate(() => Search.all("стеммера", 20).length);
      ok(hits > 0, "словоформа должна находиться");
    });

    await it("открывается по Ctrl+K и ведёт к найденному", async () => {
      await page.keyboard.press("Control+k");
      await page.waitForTimeout(500);
      eq(await page.locator('[data-win="search"]').count(), 1);
      await page.fill('[data-win="search"] input.search', "Портера");
      await page.waitForTimeout(500);
      ok(await page.locator('[data-win="search"] .item.result').count() > 0, "должны быть результаты");
      await page.locator('[data-win="search"] .item.result').first().click();
      await page.waitForTimeout(700);
      ok(await page.locator('[data-win="notes"]').count() === 1 ||
         await page.locator('[data-win="tasks"]').count() === 1,
         "клик должен открыть нужное окно");
      await page.evaluate(() => Object.keys(Win.open).forEach((k) => Win.open[k].close()));
    });

    describe("консоль");
    await it("ни одной ошибки за весь прогон", () => {
      eq(errors, []);
    });
  } catch (e) {
    results.push({ ok: false, name: "прогон", err: e.message });
  } finally {
    await browser.close();
    server.kill();
    provider.close();
  }

  const bad = results.filter((r) => !r.ok);
  results.forEach((r) => {
    console.log((r.ok ? "  ok   " : "  ПАДЕТ") + "  " + r.name + (r.err ? "\n         " + r.err : ""));
  });
  console.log("\nбраузер: " + (results.length - bad.length) + " из " + results.length + " прошли");
  process.exit(bad.length ? 1 : 0);
})();
