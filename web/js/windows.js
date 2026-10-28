/* ==========================================================================
   Sayumi window manager: draggable, resizable, focusable panels
   ========================================================================== */
(function (global) {
  "use strict";

  var zTop = 60;
  var open = {};

  var ICONS = {
    min: '<svg viewBox="0 0 16 16"><path d="M3 11h10"/></svg>',
    max: '<svg viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="10" rx="1"/></svg>',
    close: '<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>'
  };

  function create(options) {
    var id = options.id;
    if (open[id]) {
      focus(open[id]);
      return open[id];
    }

    var saved = S.load("win." + id, null);
    var width = (saved && saved.w) || options.width || 720;
    var height = (saved && saved.h) || options.height || 520;
    width = Math.min(width, window.innerWidth - 24);
    height = Math.min(height, window.innerHeight - 76);

    var left = saved && saved.x !== undefined
      ? saved.x
      : Math.max(12, (window.innerWidth - width) / 2 + (Object.keys(open).length * 26));
    var top = saved && saved.y !== undefined
      ? saved.y
      : Math.max(62, (window.innerHeight - height) / 2);

    left = S.clamp(left, 0, Math.max(0, window.innerWidth - 120));
    top = S.clamp(top, 52, Math.max(52, window.innerHeight - 80));

    var win = S.el("div", { class: "win", "data-win": id });
    win.style.cssText = "left:" + left + "px;top:" + top + "px;width:" + width + "px;height:" + height + "px;";

    var head = S.el("div", { class: "win-head" });
    var title = S.el("div", { class: "win-title", text: options.title || "" });
    var tools = S.el("div", { class: "win-tools" });

    var bMin = S.el("button", { title: "Свернуть", "aria-label": "minimize" }, ICONS.min);
    var bMax = S.el("button", { title: "Развернуть", "aria-label": "maximize" }, ICONS.max);
    var bClose = S.el("button", { class: "close", title: "Закрыть", "aria-label": "close" }, ICONS.close);
    tools.appendChild(bMin);
    tools.appendChild(bMax);
    tools.appendChild(bClose);

    head.appendChild(title);
    if (options.headExtra) head.appendChild(options.headExtra);
    head.appendChild(tools);

    var body = S.el("div", { class: "win-body" });
    if (options.content) body.appendChild(options.content);

    var grip = S.el("div", { class: "win-resize" });

    win.appendChild(head);
    win.appendChild(body);
    win.appendChild(grip);

    var api = {
      id: id,
      node: win,
      body: body,
      head: head,
      setTitle: function (text) { title.textContent = text; },
      close: function () { destroy(api); },
      focus: function () { focus(api); },
      options: options
    };

    bClose.addEventListener("click", function () { api.close(); });
    bMin.addEventListener("click", function () {
      win.classList.toggle("min");
      if (win.classList.contains("min")) {
        api._h = win.style.height;
        win.style.height = "40px";
      } else {
        win.style.height = api._h || height + "px";
      }
    });
    bMax.addEventListener("click", function () { toggleMax(api); });
    head.addEventListener("dblclick", function (e) {
      if (e.target.closest("button")) return;
      toggleMax(api);
    });

    win.addEventListener("pointerdown", function () { focus(api); }, true);

    dragWith(head, win, api);
    resizeWith(grip, win, api);

    document.getElementById("windows").appendChild(win);
    open[id] = api;
    focus(api);
    S.emit("win:open", id);
    return api;
  }

  function toggleMax(api) {
    var win = api.node;
    if (win.classList.contains("max")) {
      win.classList.remove("max");
      win.style.cssText = api._restore || win.style.cssText;
    } else {
      api._restore = win.style.cssText;
      win.classList.add("max");
      win.style.cssText = "left:0;top:52px;width:100%;height:calc(100% - 52px);";
    }
  }

  function destroy(api) {
    remember(api);
    api.node.remove();
    delete open[api.id];
    if (api.options && typeof api.options.onClose === "function") api.options.onClose();
    S.emit("win:close", api.id);
  }

  function remember(api) {
    if (api.node.classList.contains("max")) return;
    var rect = api.node.getBoundingClientRect();
    S.save("win." + api.id, {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      w: Math.round(rect.width),
      h: Math.round(rect.height)
    });
  }

  function focus(api) {
    Object.keys(open).forEach(function (k) { open[k].node.classList.remove("focus"); });
    api.node.classList.add("focus");
    api.node.style.zIndex = ++zTop;
  }

  function dragWith(handle, win, api) {
    var sx = 0, sy = 0, ox = 0, oy = 0, active = false;

    handle.addEventListener("pointerdown", function (e) {
      if (e.target.closest("button, input, select")) return;
      if (win.classList.contains("max")) return;
      active = true;
      sx = e.clientX; sy = e.clientY;
      var rect = win.getBoundingClientRect();
      ox = rect.left; oy = rect.top;
      handle.classList.add("drag");
      handle.setPointerCapture(e.pointerId);
    });

    handle.addEventListener("pointermove", function (e) {
      if (!active) return;
      var x = S.clamp(ox + e.clientX - sx, -win.offsetWidth + 110, window.innerWidth - 110);
      var y = S.clamp(oy + e.clientY - sy, 52, window.innerHeight - 44);
      win.style.left = x + "px";
      win.style.top = y + "px";
    });

    function stop(e) {
      if (!active) return;
      active = false;
      handle.classList.remove("drag");
      try { handle.releasePointerCapture(e.pointerId); } catch (err) {}
      remember(api);
    }
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  }

  function resizeWith(grip, win, api) {
    var sx = 0, sy = 0, ow = 0, oh = 0, active = false;

    grip.addEventListener("pointerdown", function (e) {
      active = true;
      sx = e.clientX; sy = e.clientY;
      ow = win.offsetWidth; oh = win.offsetHeight;
      grip.setPointerCapture(e.pointerId);
      e.stopPropagation();
    });

    grip.addEventListener("pointermove", function (e) {
      if (!active) return;
      win.style.width = Math.max(320, ow + e.clientX - sx) + "px";
      win.style.height = Math.max(200, oh + e.clientY - sy) + "px";
    });

    function stop(e) {
      if (!active) return;
      active = false;
      try { grip.releasePointerCapture(e.pointerId); } catch (err) {}
      remember(api);
    }
    grip.addEventListener("pointerup", stop);
    grip.addEventListener("pointercancel", stop);
  }

  function get(id) { return open[id] || null; }

  function toggle(id, factory) {
    if (open[id]) { open[id].close(); return null; }
    return factory();
  }

  global.Win = {
    create: create,
    get: get,
    toggle: toggle,
    focus: focus,
    get open() { return open; }
  };
})(window);
