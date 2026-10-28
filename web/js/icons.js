/* ==========================================================================
   Sayumi icon set - one stroke style for the whole interface
   All glyphs live on a 16x16 grid and inherit the current text colour.
   ========================================================================== */
(function (global) {
  "use strict";

  var P = {
    menu:     '<path d="M2.5 4h11M2.5 8h11M2.5 12h11"/>',
    search:   '<circle cx="7" cy="7" r="4.5"/><path d="M10.4 10.4L14 14"/>',
    pencil:   '<path d="M10.5 2.5l3 3-8 8-3.5.5.5-3.5z"/><path d="M9 4l3 3"/>',
    download: '<path d="M8 2v8"/><path d="M4.5 7L8 10.5 11.5 7"/><path d="M3 13.5h10"/>',
    upload:   '<path d="M8 10.5v-8"/><path d="M4.5 5.5L8 2l3.5 3.5"/><path d="M3 13.5h10"/>',
    trash:    '<path d="M2.5 4h11"/><path d="M6 4V2.5h4V4"/><path d="M4.5 4l.6 9.5h5.8L11.5 4"/>',
    clip:     '<path d="M11 6.2L6.4 10.8a2.2 2.2 0 003.1 3.1l5-5a3.8 3.8 0 00-5.4-5.4L3.9 8.7"/>',
    mic:      '<rect x="6" y="1.8" width="4" height="7.4" rx="2"/><path d="M3.8 8a4.2 4.2 0 008.4 0"/><path d="M8 12.2v2"/>',
    send:     '<path d="M14 2L2 7.2l4.6 1.6L13.4 3 8.4 10.2 14 14z"/>',
    stop:     '<rect x="4" y="4" width="8" height="8" rx="1.2"/>',
    sound:    '<path d="M3 6.2h2.3L8.6 3.4v9.2L5.3 9.8H3z"/><path d="M10.8 6a3 3 0 010 4"/><path d="M12.7 4.2a5.6 5.6 0 010 7.6"/>',
    eye:      '<path d="M1.6 8S4 3.8 8 3.8 14.4 8 14.4 8 12 12.2 8 12.2 1.6 8 1.6 8z"/><circle cx="8" cy="8" r="1.9"/>',
    copy:     '<rect x="5.2" y="5.2" width="8.3" height="8.6" rx="1.2"/><path d="M10.8 5.2V3.4a1.2 1.2 0 00-1.2-1.2H3.7a1.2 1.2 0 00-1.2 1.2v5.9a1.2 1.2 0 001.2 1.2h1.5"/>',
    close:    '<path d="M4 4l8 8M12 4l-8 8"/>',
    plus:     '<path d="M8 2.8v10.4M2.8 8h10.4"/>',
    refresh:  '<path d="M13.2 8a5.2 5.2 0 11-1.6-3.8"/><path d="M13.6 2.2v3.2h-3.2"/>',
    arrowUp:  '<path d="M8 13.2V3.4"/><path d="M4.2 7.2L8 3.4l3.8 3.8"/>',
    arrowRight: '<path d="M2.8 8h9.4"/><path d="M8.6 4.4L12.2 8l-3.6 3.6"/>',
    folder:   '<path d="M2 4.2h3.8L7.4 6.3H14v7.5H2z"/>',
    file:     '<path d="M4 2.2h5L12 5.2v8.6H4z"/><path d="M8.8 2.2v3.2H12"/>',
    brackets: '<path d="M6.2 2.8H4v10.4h2.2"/><path d="M9.8 2.8H12v10.4H9.8"/>',
    graph:    '<circle cx="8" cy="3.6" r="1.8"/><circle cx="3.6" cy="12" r="1.8"/><circle cx="12.4" cy="11" r="1.8"/><path d="M7 5.2l-2.5 5.2M9.2 5l2.4 4.4M5.4 11.7l5.2-.5"/>',
    expand:   '<path d="M6.2 2.2H2.2v4"/><path d="M9.8 13.8h4v-4"/><path d="M2.2 9.8v4h4"/><path d="M13.8 6.2v-4h-4"/>',
    check:    '<path d="M3.2 8.4l3.4 3.4 6.2-7"/>',
    star:     '<path d="M8 2.2l1.8 3.9 4.2.5-3.1 2.9.85 4.2L8 11.6l-3.75 2.1.85-4.2L2 6.6l4.2-.5z"/>',
    chat:     '<path d="M2.2 3.4h11.6v7.2H6.4l-4.2 3z"/>',
    note:     '<path d="M4 2.2h8v11.6H4z"/><path d="M6 5.4h4M6 8h4M6 10.6h2.4"/>',
    task:     '<path d="M2.4 5l1.8 1.8L7.4 3"/><path d="M2.4 11.4l1.8 1.8 3.2-3.8"/><path d="M9.6 5.6h4M9.6 11.8h4"/>',
    user:     '<circle cx="8" cy="5.4" r="2.6"/><path d="M2.6 13.8c.6-3 2.8-4.5 5.4-4.5s4.8 1.5 5.4 4.5"/>',
    gear:     '<circle cx="8" cy="8" r="2.4"/><path d="M8 1.6v1.8M8 12.6v1.8M1.6 8h1.8M12.6 8h1.8M3.5 3.5l1.3 1.3M11.2 11.2l1.3 1.3M12.5 3.5l-1.3 1.3M4.8 11.2l-1.3 1.3"/>',
    pin:      '<path d="M6 2.4h4l-.6 4 2.2 2.2H4.4L6.6 6.4z"/><path d="M8 8.6v5"/>',
    dust:     '<path d="M8 2.6v2M8 11.4v2M2.6 8h2M11.4 8h2"/><circle cx="8" cy="8" r="2.2"/>',
    palette:  '<path d="M8 1.8a6.2 6.2 0 000 12.4c1 0 1.5-.6 1.5-1.3 0-.8-.7-1.2-.7-1.9 0-.6.5-1 1.1-1h1.3A3 3 0 0014.2 7c0-2.9-2.8-5.2-6.2-5.2z"/><circle cx="5.4" cy="6.2" r=".9"/><circle cx="8.3" cy="4.7" r=".9"/><circle cx="11" cy="6.4" r=".9"/>',
    sliders:  '<path d="M2.6 4.4h10.8M2.6 8h10.8M2.6 11.6h10.8"/><circle cx="5.6" cy="4.4" r="1.5"/><circle cx="10.2" cy="8" r="1.5"/><circle cx="6.8" cy="11.6" r="1.5"/>',
    cpu:      '<rect x="4.4" y="4.4" width="7.2" height="7.2" rx="1.2"/><path d="M6.6 1.8v2.6M9.4 1.8v2.6M6.6 11.6v2.6M9.4 11.6v2.6M1.8 6.6h2.6M1.8 9.4h2.6M11.6 6.6h2.6M11.6 9.4h2.6"/>',
    database: '<ellipse cx="8" cy="4" rx="5" ry="2.1"/><path d="M3 4v8c0 1.2 2.2 2.1 5 2.1s5-.9 5-2.1V4"/><path d="M3 8c0 1.2 2.2 2.1 5 2.1s5-.9 5-2.1"/>',
    info:     '<circle cx="8" cy="8" r="6.2"/><path d="M8 7.4v4M8 4.9v.6"/>',
    type:     '<path d="M3 4.2V2.8h10v1.4"/><path d="M8 2.8v10.4"/><path d="M6 13.2h4"/>',
    frame:    '<rect x="2.4" y="2.4" width="11.2" height="11.2" rx="2"/><rect x="5.4" y="5.4" width="5.2" height="5.2" rx="1"/>',
    sparkle:  '<path d="M8 2l1.3 3.4L12.7 6.7 9.3 8 8 11.4 6.7 8 3.3 6.7 6.7 5.4z"/><path d="M12.6 10.6l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z"/>'
  };

  function svg(name, size) {
    var body = P[name];
    if (!body) return "";
    return '<svg class="ic" viewBox="0 0 16 16" aria-hidden="true"' +
      (size ? ' style="width:' + size + 'px;height:' + size + 'px"' : "") +
      ">" + body + "</svg>";
  }

  /* a button carrying an icon, and optionally a label after it */
  function btn(name, options) {
    options = options || {};
    var node = document.createElement("button");
    node.type = "button";
    node.className = options.class || "btn sm ghost";
    if (options.title) node.title = options.title;
    node.innerHTML = svg(name) + (options.label ? "<span>" + options.label + "</span>" : "");
    if (typeof options.on === "function") node.addEventListener("click", options.on);
    return node;
  }

  global.I = { svg: svg, btn: btn, paths: P };
})(window);
