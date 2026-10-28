/* ==========================================================================
   Sayumi context menu
   ========================================================================== */
(function (global) {
  "use strict";

  var node = null;

  function ensure() {
    if (node) return node;
    node = S.el("div", { class: "ctx", id: "ctx" });
    document.body.appendChild(node);
    document.addEventListener("pointerdown", function (e) {
      if (node && !node.contains(e.target)) hide();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") hide();
    });
    window.addEventListener("blur", hide);
    return node;
  }

  function show(x, y, items, title) {
    var box = ensure();
    box.innerHTML = "";
    if (title) box.appendChild(S.el("div", { class: "head", text: title }));

    items.forEach(function (item) {
      if (item.sep) { box.appendChild(S.el("hr")); return; }
      var b = S.el("button", { type: "button" });
      if (item.icon) b.appendChild(S.el("span", { text: item.icon }));
      b.appendChild(S.el("span", { text: item.label }));
      b.addEventListener("click", function () {
        hide();
        if (typeof item.act === "function") item.act();
      });
      box.appendChild(b);
    });

    box.classList.add("show");
    box.style.left = "0px";
    box.style.top = "0px";
    var rect = box.getBoundingClientRect();
    var left = Math.min(x, window.innerWidth - rect.width - 8);
    var top = Math.min(y, window.innerHeight - rect.height - 8);
    box.style.left = Math.max(6, left) + "px";
    box.style.top = Math.max(6, top) + "px";
  }

  function hide() {
    if (node) node.classList.remove("show");
  }

  global.Menu = { show: show, hide: hide };
})(window);
