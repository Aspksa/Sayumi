/* ==========================================================================
   Server tests: the launcher now decides whether the site is up by asking
   the server who it is and by reading its log, so both have to be reliable.
   ========================================================================== */
"use strict";

const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SERVER = path.join(ROOT, "server", "server.py");

const results = [];
let group = "";
function describe(n) { group = n; }
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
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error((hint ? hint + ": " : "") + "ожидалось " + JSON.stringify(b) + ", получено " + JSON.stringify(a));
  }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function tmp(name) {
  const dir = path.join(os.tmpdir(), "sayumi-srv-" + Date.now() + "-" + name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

(async () => {
  describe("журнал сервера");

  let dir = tmp("ok");
  let logPath = path.join(dir, "server.log");
  const port = 8823;
  const child = spawn("python3", [SERVER, "--port", String(port), "--root", ROOT,
    "--data", path.join(dir, "data"), "--log", logPath, "--no-pick-port"], { stdio: "ignore" });

  await it("пишет журнал в указанный файл", async () => {
    for (let i = 0; i < 30 && !fs.existsSync(logPath); i++) await wait(200);
    ok(fs.existsSync(logPath), "файл журнала должен появиться");
    const text = fs.readFileSync(logPath, "utf8");
    ok(text.includes("Sayumi"), "в журнале должно быть имя: " + text.slice(0, 80));
    ok(text.includes(String(port)), "и порт");
  });

  await it("отвечает на проверку, которой пользуется лаунчер", async () => {
    let body = "";
    for (let i = 0; i < 30; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/api/health`);
        body = await r.text();
        if (body) break;
      } catch (e) { await wait(200); }
    }
    ok(body.includes("Sayumi"), "ответ должен содержать Sayumi: " + body.slice(0, 80));
    eq(JSON.parse(body).ok, true);
  });

  await it("отдаёт страницу по корню", async () => {
    const r = await fetch(`http://127.0.0.1:${port}/`);
    const html = await r.text();
    eq(r.status, 200);
    ok(html.includes("<title>Sayumi</title>"), "должна прийти страница интерфейса");
    ok(html.includes("js/app.js"), "и подключать скрипты");
  });

  await it("отдаёт каждый скрипт интерфейса", async () => {
    const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    const scripts = [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
    ok(scripts.length >= 10, "ожидался список скриптов, найдено " + scripts.length);
    const broken = [];
    for (const src of scripts) {
      const r = await fetch(`http://127.0.0.1:${port}/${src}`);
      if (!r.ok) broken.push(src + " → " + r.status);
    }
    eq(broken, [], "ни один файл не должен отдавать ошибку");
  });

  await it("отдаёт стили и картинки", async () => {
    const broken = [];
    for (const file of ["css/theme.css", "css/app.css", "assets/sayumi.png", "assets/sayumi-icon.png"]) {
      const r = await fetch(`http://127.0.0.1:${port}/${file}`);
      if (!r.ok) broken.push(file + " → " + r.status);
    }
    eq(broken, []);
  });

  child.kill();
  await wait(400);

  describe("падение видно в журнале");

  await it("нет папки web — причина записана", async () => {
    const d = tmp("nodir");
    const lp = path.join(d, "fail.log");
    const res = spawnSync("python3", [SERVER, "--port", "8824", "--root", path.join(d, "пусто"),
      "--data", path.join(d, "data"), "--log", lp], { encoding: "utf8" });
    ok(res.status !== 0, "код выхода должен быть ненулевым");
    const text = fs.readFileSync(lp, "utf8");
    ok(text.includes("web folder not found"), "в журнале должна быть причина: " + text.slice(0, 120));
  });

  await it("занятый порт — трассировка в журнале", async () => {
    const d = tmp("busy");
    const lp = path.join(d, "busy.log");
    const keep = spawn("python3", [SERVER, "--port", "8825", "--root", ROOT,
      "--data", path.join(d, "a"), "--no-pick-port"], { stdio: "ignore" });
    await wait(1500);
    const res = spawnSync("python3", [SERVER, "--port", "8825", "--no-pick-port", "--root", ROOT,
      "--data", path.join(d, "b"), "--log", lp], { encoding: "utf8" });
    keep.kill();
    ok(res.status !== 0, "второй запуск должен упасть");
    const text = fs.readFileSync(lp, "utf8");
    ok(text.includes("ОШИБКА ЗАПУСКА"), "журнал должен начинаться с пометки об ошибке");
    ok(text.includes("Address already in use") || text.includes("address"), "и содержать причину");
  });

  await it("занятый порт подбирается автоматически", async () => {
    const d = tmp("pick");
    const keep = spawn("python3", [SERVER, "--port", "8826", "--root", ROOT,
      "--data", path.join(d, "a"), "--no-pick-port"], { stdio: "ignore" });
    await wait(1500);
    const lp = path.join(d, "pick.log");
    const second = spawn("python3", [SERVER, "--port", "8826", "--root", ROOT,
      "--data", path.join(d, "b"), "--log", lp], { stdio: "ignore" });
    await wait(1800);
    const text = fs.existsSync(lp) ? fs.readFileSync(lp, "utf8") : "";
    keep.kill(); second.kill();
    ok(text.includes("8827"), "должен был занять соседний порт: " + text.slice(0, 120));
  });

  const bad = results.filter((r) => !r.ok);
  results.forEach((r) => {
    console.log((r.ok ? "  ok   " : "  ПАДЕТ") + "  " + r.name + (r.err ? "\n         " + r.err : ""));
  });
  console.log("\nсервер: " + (results.length - bad.length) + " из " + results.length + " прошли");
  process.exit(bad.length ? 1 : 0);
})();
