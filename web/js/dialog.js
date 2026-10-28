/* ==========================================================================
   Sayumi dialogs: confirm, prompt, alert and choose, in the project's own
   skin. Everything resolves a promise, so call sites read like the native
   calls they replace but never block the page.
   ========================================================================== */
(function (global) {
  "use strict";

  var open = null;

  function close(result) {
    if (!open) return;
    var box = open;
    open = null;
    box.node.classList.remove("show");
    document.removeEventListener("keydown", box.onKey, true);
    setTimeout(function () { box.node.remove(); }, 160);
    box.done(result);
  }

  function build(options) {
    options = options || {};
    if (open) close(null);

    var back = S.el("div", { class: "modal-back" });
    var card = S.el("div", { class: "modal" + (options.danger ? " danger" : "") });

    var head = S.el("header");
    head.innerHTML = I.svg(options.icon || (options.danger ? "trash" : "info")) +
      "<h3>" + S.esc(options.title || "Sayumi") + "</h3>";
    card.appendChild(head);

    var body = S.el("div", { class: "modal-body" });
    if (options.text) {
      body.appendChild(S.el("p", { class: "modal-text", text: options.text }));
    }
    if (options.html) {
      body.appendChild(S.el("div", { class: "modal-text" }, options.html));
    }
    card.appendChild(body);

    var foot = S.el("div", { class: "modal-foot" });
    card.appendChild(foot);

    back.appendChild(card);
    document.body.appendChild(back);
    requestAnimationFrame(function () { back.classList.add("show"); });

    back.addEventListener("pointerdown", function (e) {
      if (e.target === back) close(options.onBackdrop === undefined ? null : options.onBackdrop);
    });

    return { back: back, card: card, body: body, foot: foot };
  }

  function button(label, kind, onClick) {
    var b = S.el("button", { class: "btn " + (kind || ""), text: label });
    b.addEventListener("click", onClick);
    return b;
  }

  function confirm(options) {
    if (typeof options === "string") options = { text: options };
    options = options || {};
    return new Promise(function (resolve) {
      var ui = build(options);
      var cancel = button(options.cancel || "Отмена", "", function () { close(false); });
      var ok = button(options.ok || "Да", options.danger ? "danger" : "primary",
        function () { close(true); });
      ui.foot.appendChild(cancel);
      ui.foot.appendChild(ok);

      open = {
        node: ui.back,
        done: resolve,
        onKey: function (e) {
          if (e.key === "Escape") { e.preventDefault(); close(false); }
          if (e.key === "Enter") { e.preventDefault(); close(true); }
        }
      };
      document.addEventListener("keydown", open.onKey, true);
      setTimeout(function () { ok.focus(); }, 40);
    });
  }

  function prompt(options) {
    if (typeof options === "string") options = { title: options };
    options = options || {};
    return new Promise(function (resolve) {
      var ui = build(options);
      var field = options.multiline
        ? S.el("textarea", { class: "field", rows: options.rows || 5 })
        : S.el("input", { type: "text", class: "wide" });
      field.value = options.value === undefined ? "" : options.value;
      if (options.placeholder) field.placeholder = options.placeholder;
      ui.body.appendChild(field);

      function accept() {
        var value = field.value;
        close(options.allowEmpty ? value : (value.trim() ? value : null));
      }

      ui.foot.appendChild(button(options.cancel || "Отмена", "", function () { close(null); }));
      ui.foot.appendChild(button(options.ok || "Сохранить", "primary", accept));

      open = {
        node: ui.back,
        done: resolve,
        onKey: function (e) {
          if (e.key === "Escape") { e.preventDefault(); close(null); }
          if (e.key === "Enter" && !options.multiline) { e.preventDefault(); accept(); }
          if (e.key === "Enter" && e.ctrlKey && options.multiline) { e.preventDefault(); accept(); }
        }
      };
      document.addEventListener("keydown", open.onKey, true);
      setTimeout(function () { field.focus(); field.select(); }, 40);
    });
  }

  function alert(options) {
    if (typeof options === "string") options = { text: options };
    options = options || {};
    return new Promise(function (resolve) {
      var ui = build(options);
      var ok = button(options.ok || "Понятно", "primary", function () { close(true); });
      ui.foot.appendChild(ok);
      open = {
        node: ui.back,
        done: resolve,
        onKey: function (e) {
          if (e.key === "Escape" || e.key === "Enter") { e.preventDefault(); close(true); }
        }
      };
      document.addEventListener("keydown", open.onKey, true);
      setTimeout(function () { ok.focus(); }, 40);
    });
  }

  /* a short list to pick from, used where a prompt would be guesswork */
  function choose(options) {
    options = options || {};
    return new Promise(function (resolve) {
      var ui = build(options);
      var list = S.el("div", { class: "list" });
      (options.options || []).forEach(function (opt) {
        var row = S.el("button", { class: "modal-opt" });
        row.innerHTML = (opt.icon ? I.svg(opt.icon) : "") +
          "<span>" + S.esc(opt.label) + (opt.note ? "<small>" + S.esc(opt.note) + "</small>" : "") + "</span>";
        row.addEventListener("click", function () { close(opt.value); });
        list.appendChild(row);
      });
      ui.body.appendChild(list);
      ui.foot.appendChild(button(options.cancel || "Отмена", "", function () { close(null); }));

      open = {
        node: ui.back,
        done: resolve,
        onKey: function (e) { if (e.key === "Escape") { e.preventDefault(); close(null); } }
      };
      document.addEventListener("keydown", open.onKey, true);
    });
  }

  global.Dialog = { confirm: confirm, prompt: prompt, alert: alert, choose: choose, close: close };
})(window);
