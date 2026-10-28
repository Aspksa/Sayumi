/* ==========================================================================
   Sayumi theme engine: backgrounds, accents, shape, motion, presets
   ========================================================================== */
(function (global) {
  "use strict";

  var BACKGROUNDS = [
    { id: "black",    ru: "Чёрный",     en: "Black",    hex: "#000000", panel: "#0a0a0c", card: "#111115", line: "#26262f", txt: "#e8e6e1", dim: "#8e8b85" },
    { id: "coal",     ru: "Уголь",      en: "Coal",     hex: "#0f0f0f", panel: "#161616", card: "#1d1d1d", line: "#313131", txt: "#e8e6e1", dim: "#8e8b85" },
    { id: "graphite", ru: "Графит",     en: "Graphite", hex: "#15171a", panel: "#1b1e22", card: "#22262c", line: "#343a43", txt: "#e6e8ea", dim: "#949aa3" },
    { id: "obsidian", ru: "Обсидиан",   en: "Obsidian", hex: "#06080b", panel: "#0c1016", card: "#131922", line: "#243040", txt: "#e3e7ec", dim: "#879099" },
    { id: "midnight", ru: "Полночь",    en: "Midnight", hex: "#070a14", panel: "#0e1322", card: "#151c30", line: "#2a3553", txt: "#e4e7f0", dim: "#8b92a8" },
    { id: "wenge",    ru: "Венге",      en: "Wenge",    hex: "#100d0b", panel: "#181411", card: "#211b17", line: "#3a2f26", txt: "#ece6dd", dim: "#9a8f82" }
  ];

  var ACCENTS = [
    { id: "gold",      ru: "Золото",        en: "Gold",      hex: "#c9a227" },
    { id: "antique",   ru: "Старое золото", en: "Antique",   hex: "#b08d57" },
    { id: "champagne", ru: "Шампань",       en: "Champagne", hex: "#d3c08b" },
    { id: "bronze",    ru: "Бронза",        en: "Bronze",    hex: "#a9742f" },
    { id: "copper",    ru: "Медь",          en: "Copper",    hex: "#b4674a" },
    { id: "silver",    ru: "Серебро",       en: "Silver",    hex: "#a4acb8" },
    { id: "jade",      ru: "Нефрит",        en: "Jade",      hex: "#5f9c7b" },
    { id: "wine",      ru: "Вино",          en: "Wine",      hex: "#9c4a52" },
    { id: "ice",       ru: "Лёд",           en: "Ice",       hex: "#6f94c0" },
    { id: "violet",    ru: "Аметист",       en: "Amethyst",  hex: "#8a6fb5" }
  ];

  /* curated combinations - these are the pairings that actually look right */
  var PRESETS = [
    { id: "kitsune",  ru: "Кицунэ",     en: "Kitsune",   bg: "black",    accent: "gold",      texture: "vignette", glow: "on" },
    { id: "temple",   ru: "Храм",       en: "Temple",    bg: "obsidian", accent: "antique",   texture: "rays",     glow: "on" },
    { id: "graphite", ru: "Графит",     en: "Graphite",  bg: "graphite", accent: "champagne", texture: "none",     glow: "off" },
    { id: "forge",    ru: "Кузница",    en: "Forge",     bg: "coal",     accent: "bronze",    texture: "noise",    glow: "on" },
    { id: "moon",     ru: "Луна",       en: "Moon",      bg: "midnight", accent: "ice",       texture: "grid",     glow: "on" },
    { id: "bamboo",   ru: "Бамбук",     en: "Bamboo",    bg: "obsidian", accent: "jade",      texture: "vignette", glow: "on" },
    { id: "sakura",   ru: "Сакура",     en: "Sakura",    bg: "wenge",    accent: "wine",      texture: "vignette", glow: "on" },
    { id: "steel",    ru: "Сталь",      en: "Steel",     bg: "graphite", accent: "silver",    texture: "none",     glow: "off" },
    { id: "ember",    ru: "Уголёк",     en: "Ember",     bg: "black",    accent: "copper",    texture: "rays",     glow: "on" },
    { id: "night",    ru: "Ночной сад", en: "Night",     bg: "midnight", accent: "violet",    texture: "noise",    glow: "on" }
  ];

  /* fonts offered in the settings; availability is probed at runtime */
  var FONTS_UI = [
    { id: "", ru: "По умолчанию", en: "Default", stack: '"Segoe UI", "Inter", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif' },
    { id: "Segoe UI", ru: "Segoe UI", en: "Segoe UI" },
    { id: "Inter", ru: "Inter", en: "Inter" },
    { id: "Roboto", ru: "Roboto", en: "Roboto" },
    { id: "Calibri", ru: "Calibri", en: "Calibri" },
    { id: "Candara", ru: "Candara", en: "Candara" },
    { id: "Corbel", ru: "Corbel", en: "Corbel" },
    { id: "Tahoma", ru: "Tahoma", en: "Tahoma" },
    { id: "Verdana", ru: "Verdana", en: "Verdana" },
    { id: "Trebuchet MS", ru: "Trebuchet MS", en: "Trebuchet MS" },
    { id: "Arial", ru: "Arial", en: "Arial" },
    { id: "Georgia", ru: "Georgia", en: "Georgia" },
    { id: "Constantia", ru: "Constantia", en: "Constantia" },
    { id: "Palatino Linotype", ru: "Palatino Linotype", en: "Palatino Linotype" },
    { id: "Times New Roman", ru: "Times New Roman", en: "Times New Roman" }
  ];

  var FONTS_MONO = [
    { id: "", ru: "По умолчанию", en: "Default", stack: '"JetBrains Mono", "Cascadia Mono", "Consolas", "SFMono-Regular", monospace' },
    { id: "Consolas", ru: "Consolas", en: "Consolas" },
    { id: "Cascadia Mono", ru: "Cascadia Mono", en: "Cascadia Mono" },
    { id: "Cascadia Code", ru: "Cascadia Code", en: "Cascadia Code" },
    { id: "JetBrains Mono", ru: "JetBrains Mono", en: "JetBrains Mono" },
    { id: "Fira Code", ru: "Fira Code", en: "Fira Code" },
    { id: "Source Code Pro", ru: "Source Code Pro", en: "Source Code Pro" },
    { id: "Lucida Console", ru: "Lucida Console", en: "Lucida Console" },
    { id: "Courier New", ru: "Courier New", en: "Courier New" }
  ];

  var FONTS_DISPLAY = [
    { id: "", ru: "Декоративный", en: "Decorative", stack: '"Constantia", "Palatino Linotype", "Book Antiqua", Georgia, serif' },
    { id: "ui", ru: "Как интерфейс", en: "Same as interface" },
    { id: "Georgia", ru: "Georgia", en: "Georgia" },
    { id: "Constantia", ru: "Constantia", en: "Constantia" },
    { id: "Palatino Linotype", ru: "Palatino Linotype", en: "Palatino Linotype" },
    { id: "Book Antiqua", ru: "Book Antiqua", en: "Book Antiqua" },
    { id: "Cambria", ru: "Cambria", en: "Cambria" },
    { id: "Garamond", ru: "Garamond", en: "Garamond" },
    { id: "Times New Roman", ru: "Times New Roman", en: "Times New Roman" },
    { id: "Candara", ru: "Candara", en: "Candara" },
    { id: "Trebuchet MS", ru: "Trebuchet MS", en: "Trebuchet MS" }
  ];

  /* a font counts as present when it renders differently from a known fallback */
  var fontCache = {};
  function hasFont(name) {
    if (!name) return true;
    if (fontCache[name] !== undefined) return fontCache[name];
    var ok = false;
    try {
      if (document.fonts && document.fonts.check) {
        ok = document.fonts.check('12px "' + name + '"');
      }
      if (!ok) {
        var canvas = document.createElement("canvas");
        var ctx = canvas.getContext("2d");
        var probe = "mmmwwwiiilll0123";
        ctx.font = '72px monospace';
        var base = ctx.measureText(probe).width;
        ctx.font = '72px "' + name + '", monospace';
        ok = ctx.measureText(probe).width !== base;
      }
    } catch (e) {
      ok = false;
    }
    fontCache[name] = ok;
    return ok;
  }

  function fontStack(entry, fallback) {
    if (!entry || !entry.id) return (entry && entry.stack) || fallback;
    return '"' + entry.id + '", ' + fallback;
  }

  var DEFAULTS = {
    bg: "black",
    accent: "gold",
    texture: "vignette",
    glow: "on",
    corners: "soft",
    density: "cozy",
    motion: "on",
    contrast: "normal",
    fontScale: 100,
    fontUI: "",
    fontMono: "",
    fontDisplay: "",
    radius: 10,
    borderW: 1,
    shadow: 70,
    preset: "kitsune"
  };

  var state = Object.assign({}, DEFAULTS, S.load("theme", {}));

  function apply() {
    var root = document.documentElement;
    root.setAttribute("data-bg", state.bg);
    root.setAttribute("data-accent", state.accent);
    root.setAttribute("data-texture", state.texture);
    root.setAttribute("data-glow", state.glow);
    root.setAttribute("data-corners", state.corners);
    root.setAttribute("data-density", state.density);
    root.setAttribute("data-motion", state.motion);
    root.setAttribute("data-contrast", state.contrast || "normal");
    root.style.setProperty("--fs", (14 * (state.fontScale / 100)).toFixed(1) + "px");

    var uiFallback = FONTS_UI[0].stack;
    var monoFallback = FONTS_MONO[0].stack;
    root.style.setProperty("--font-ui",
      state.fontUI ? '"' + state.fontUI + '", ' + uiFallback : uiFallback);
    root.style.setProperty("--font-mono",
      state.fontMono ? '"' + state.fontMono + '", ' + monoFallback : monoFallback);

    var uiValue = state.fontUI ? '"' + state.fontUI + '", ' + uiFallback : uiFallback;
    var displayFallback = FONTS_DISPLAY[0].stack;
    var displayValue = displayFallback;
    if (state.fontDisplay === "ui") displayValue = uiValue;
    else if (state.fontDisplay) displayValue = '"' + state.fontDisplay + '", ' + displayFallback;
    root.style.setProperty("--font-display", displayValue);

    var r = Number(state.radius);
    root.style.setProperty("--r-s", Math.round(r * 0.6) + "px");
    root.style.setProperty("--r-m", r + "px");
    root.style.setProperty("--r-l", Math.round(r * 1.6) + "px");
    root.style.setProperty("--bw", Number(state.borderW) + "px");
    root.style.setProperty("--sh", (Number(state.shadow) / 100).toFixed(2));
    var meta = S.qs('meta[name="theme-color"]');
    if (meta) {
      var bg = BACKGROUNDS.filter(function (b) { return b.id === state.bg; })[0];
      meta.setAttribute("content", bg ? bg.hex : "#000000");
    }
    S.emit("theme", state);
    if (global.Avatar && Avatar.dust) Avatar.dust();
  }

  function set(patch, silent) {
    Object.assign(state, patch || {});
    /* any manual tweak detaches the named preset unless it matches again */
    var match = PRESETS.filter(function (p) {
      return p.bg === state.bg && p.accent === state.accent;
    })[0];
    state.preset = match ? match.id : "";
    S.save("theme", state);
    apply();
    if (!silent) S.emit("theme:changed", state);
  }

  function usePreset(id) {
    var p = PRESETS.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    set({ bg: p.bg, accent: p.accent, texture: p.texture, glow: p.glow });
    state.preset = p.id;
    S.save("theme", state);
  }

  function reset() {
    state = Object.assign({}, DEFAULTS);
    S.save("theme", state);
    apply();
    S.emit("theme:changed", state);
  }

  function label(entry) {
    return S.getLang() === "en" ? entry.en : entry.ru;
  }

  global.Theme = {
    BACKGROUNDS: BACKGROUNDS,
    FONTS_UI: FONTS_UI,
    FONTS_MONO: FONTS_MONO,
    FONTS_DISPLAY: FONTS_DISPLAY,
    hasFont: hasFont,
    fontStack: fontStack,
    ACCENTS: ACCENTS,
    PRESETS: PRESETS,
    DEFAULTS: DEFAULTS,
    get state() { return state; },
    apply: apply,
    set: set,
    usePreset: usePreset,
    reset: reset,
    label: label
  };

  apply();
})(window);
