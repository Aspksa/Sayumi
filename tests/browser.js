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
