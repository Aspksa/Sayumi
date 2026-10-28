/* ==========================================================================
   Sayumi core: storage, event bus, i18n, helpers
   Plain script, no modules, works from file:// as well as from the server.
   ========================================================================== */
(function (global) {
  "use strict";

  var NS = "sayumi.";

  /* ------------------------------------------------------------- storage */
  var mem = {};
  var hasLS = (function () {
    try {
      window.localStorage.setItem(NS + "__t", "1");
      window.localStorage.removeItem(NS + "__t");
      return true;
    } catch (e) {
      return false;
    }
  })();

  function load(key, fallback) {
    try {
      var raw = hasLS ? window.localStorage.getItem(NS + key) : mem[key];
      if (raw === null || raw === undefined) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function save(key, value) {
    var raw;
    try {
      raw = JSON.stringify(value);
    } catch (e) {
      return false;
    }
    try {
      if (hasLS) window.localStorage.setItem(NS + key, raw);
      else mem[key] = raw;
      return true;
    } catch (e) {
      mem[key] = raw;
      return false;
    }
  }

  function drop(key) {
    try {
      if (hasLS) window.localStorage.removeItem(NS + key);
    } catch (e) {}
    delete mem[key];
  }

  function allKeys() {
    var out = [];
    try {
      for (var i = 0; i < window.localStorage.length; i++) {
        var k = window.localStorage.key(i);
        if (k && k.indexOf(NS) === 0) out.push(k.slice(NS.length));
      }
    } catch (e) {}
    return out;
  }

  /* ----------------------------------------------------------- event bus */
  var handlers = {};

  function on(name, fn) {
    (handlers[name] = handlers[name] || []).push(fn);
    return function () { off(name, fn); };
  }

  function off(name, fn) {
    var list = handlers[name];
    if (!list) return;
    var i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  function emit(name, data) {
    var list = (handlers[name] || []).slice();
    for (var i = 0; i < list.length; i++) {
      try { list[i](data); } catch (e) { console.error("[sayumi]", name, e); }
    }
  }

  /* --------------------------------------------------------------- utils */
  function uid(prefix) {
    return (prefix || "id") + "-" + Date.now().toString(36) + "-" +
      Math.random().toString(36).slice(2, 7);
  }

  function esc(text) {
    return String(text === undefined || text === null ? "" : text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  function time(ts) {
    var d = new Date(ts || Date.now());
    return pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function dateTime(ts) {
    var d = new Date(ts || Date.now());
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function bytes(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / 1048576).toFixed(1) + " MB";
  }

  function el(tag, attrs, html) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        if (k === "class") node.className = attrs[k];
        else if (k === "text") node.textContent = attrs[k];
        else if (k.indexOf("on") === 0 && typeof attrs[k] === "function") {
          node.addEventListener(k.slice(2), attrs[k]);
        } else if (attrs[k] !== null && attrs[k] !== undefined) {
          node.setAttribute(k, attrs[k]);
        }
      }
    }
    if (html !== undefined) node.innerHTML = html;
    return node;
  }

  function qs(sel, scope) { return (scope || document).querySelector(sel); }
  function qsa(sel, scope) {
    return Array.prototype.slice.call((scope || document).querySelectorAll(sel));
  }

  function download(name, text, mime) {
    try {
      var blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(url);
        a.remove();
      }, 400);
      return true;
    } catch (e) {
      return false;
    }
  }

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(
        function () { return true; },
        function () { return legacyCopy(text); }
      );
    }
    return Promise.resolve(legacyCopy(text));
  }

  function legacyCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (e) {
      return false;
    }
  }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, wait || 160);
    };
  }

  function tokens(text) {
    /* rough estimate, good enough for a context meter */
    return Math.ceil(String(text || "").length / 3.4);
  }

  /* ---------------------------------------------------------------- i18n */
  var DICT = {
    ru: {
      chat: "Чат", notes: "Заметки", tasks: "Задачи", files: "Файлы",
      settings: "Настройки проекта", persona: "Настройки Sayumi",
      send: "Отправить", stop: "Стоп", clear: "Очистить", close: "Закрыть",
      save: "Сохранить", cancel: "Отмена", reset: "Сбросить", apply: "Применить",
      newChat: "Новый чат", rename: "Переименовать", del: "Удалить",
      search: "Поиск", export: "Экспорт", importData: "Импорт",
      copy: "Копировать", copied: "Скопировано", edit: "Изменить",
      regen: "Заново", speak: "Озвучить", pin: "Закрепить",
      placeholder: "Напишите сообщение. Enter - отправить, Shift+Enter - новая строка, / - команды",
      you: "Вы", thinking: "думает", empty: "Пока пусто",
      offline: "Автономный режим", online: "Сервер на связи",
      dropFiles: "Отпустите файлы здесь"
    },
    en: {
      chat: "Chat", notes: "Notes", tasks: "Tasks", files: "Files",
      settings: "Project settings", persona: "Sayumi settings",
      send: "Send", stop: "Stop", clear: "Clear", close: "Close",
      save: "Save", cancel: "Cancel", reset: "Reset", apply: "Apply",
      newChat: "New chat", rename: "Rename", del: "Delete",
      search: "Search", export: "Export", importData: "Import",
      copy: "Copy", copied: "Copied", edit: "Edit",
      regen: "Regenerate", speak: "Speak", pin: "Pin",
      placeholder: "Write a message. Enter to send, Shift+Enter for a new line, / for commands",
      you: "You", thinking: "thinking", empty: "Nothing here yet",
      offline: "Offline mode", online: "Server connected",
      dropFiles: "Drop the files here"
    }
  };

  var lang = load("lang", "ru");

  function t(key) {
    var table = DICT[lang] || DICT.ru;
    return table[key] || (DICT.ru[key] || key);
  }

  function setLang(code) {
    lang = DICT[code] ? code : "ru";
    save("lang", lang);
    document.documentElement.setAttribute("lang", lang);
    emit("lang", lang);
  }

  function getLang() { return lang; }

  /* -------------------------------------------------------------- server */
  var server = {
    up: false,
    base: "",
    info: null
  };

  function isFileProtocol() {
    return location.protocol === "file:";
  }

  function api(path, options) {
    if (!server.base) return Promise.reject(new Error("no server"));
    return fetch(server.base + path, options).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function probeServer() {
    var base = isFileProtocol()
      ? "http://127.0.0.1:" + (load("serverPort", 8723))
      : location.origin;
    server.base = base;
    return fetch(base + "/api/health", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (info) {
        server.up = !!(info && info.ok);
        server.info = info;
        emit("server", server);
        return server;
      })
      .catch(function () {
        server.up = false;
        server.base = isFileProtocol() ? "" : location.origin;
        emit("server", server);
        return server;
      });
  }

  /* mirror a blob to the server when it is available */
  function syncOut(key, value) {
    if (!server.up || !load("syncServer", true)) return;
    api("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: key, value: value })
    }).catch(function () {});
  }

  /* ------------------------------------------------------------- toasts */
  function toast(text, kind, ms) {
    var box = qs("#toasts");
    if (!box) return;
    var node = el("div", { class: "toast " + (kind || ""), text: text });
    box.appendChild(node);
    setTimeout(function () {
      node.style.transition = "opacity 220ms";
      node.style.opacity = "0";
      setTimeout(function () { node.remove(); }, 240);
    }, ms || 2600);
  }

  global.S = {
    NS: NS,
    load: load, save: save, drop: drop, allKeys: allKeys, hasLS: hasLS,
    on: on, off: off, emit: emit,
    uid: uid, esc: esc, clamp: clamp, time: time, dateTime: dateTime,
    bytes: bytes, el: el, qs: qs, qsa: qsa,
    download: download, copy: copy, debounce: debounce, tokens: tokens,
    t: t, setLang: setLang, getLang: getLang, DICT: DICT,
    server: server, api: api, probeServer: probeServer, syncOut: syncOut,
    isFile: isFileProtocol, toast: toast
  };
})(window);
