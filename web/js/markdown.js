/* ==========================================================================
   Sayumi markdown renderer - small, dependency free, escapes everything first
   Supports: fenced code, headings, lists, quotes, tables, rules, links,
             bold / italic / strike / inline code.
   ========================================================================== */
(function (global) {
  "use strict";

  var LANG_WORDS = {
    js: /\b(const|let|var|function|return|if|else|for|while|class|new|await|async|import|export|from|try|catch|throw|typeof|of|in|this|null|true|false|undefined)\b/g,
    py: /\b(def|class|return|if|elif|else|for|while|import|from|as|try|except|finally|with|lambda|yield|None|True|False|self|not|and|or|in|is|raise|pass)\b/g,
    sh: /\b(echo|set|if|then|else|fi|for|do|done|while|exit|cd|export|call|goto|rem)\b/gi,
    html: /\b(div|span|class|id|href|src|script|style|body|head|html)\b/g
  };

  function pickLang(name) {
    name = (name || "").toLowerCase();
    if (/^(js|javascript|ts|typescript|json|jsonc)$/.test(name)) return LANG_WORDS.js;
    if (/^(py|python)$/.test(name)) return LANG_WORDS.py;
    if (/^(sh|bash|zsh|bat|cmd|batch|powershell|ps1)$/.test(name)) return LANG_WORDS.sh;
    if (/^(html|xml|svg|vue)$/.test(name)) return LANG_WORDS.html;
    return null;
  }

  /* very light tokenizer that runs on already escaped text */
  function highlight(code, lang) {
    var words = pickLang(lang);
    var slots = [];

    function stash(html) {
      slots.push(html);
      return "\u0000" + (slots.length - 1) + "\u0000";
    }

    var out = code;
    /* strings first so keywords inside them stay plain */
    out = out.replace(/(&quot;|&#39;|`)(?:(?!\1)[\s\S])*?\1/g, function (m) {
      return stash('<span class="tk-str">' + m + "</span>");
    });
    /* comments */
    out = out.replace(/(^|\s)(\/\/|#|rem\s)[^\n]*/gim, function (m) {
      return stash('<span class="tk-com">' + m + "</span>");
    });
    out = out.replace(/\/\*[\s\S]*?\*\//g, function (m) {
      return stash('<span class="tk-com">' + m + "</span>");
    });
    if (words) {
      out = out.replace(words, function (m) {
        return stash('<span class="tk-key">' + m + "</span>");
      });
    }
    out = out.replace(/\b\d+(\.\d+)?\b/g, function (m) {
      return stash('<span class="tk-num">' + m + "</span>");
    });
    out = out.replace(/\u0000(\d+)\u0000/g, function (_, i) { return slots[+i]; });
    return out;
  }

  function inline(text) {
    var out = text;
    out = out.replace(/`([^`\n]+)`/g, function (_, code) {
      return "<code>" + code + "</code>";
    });
    out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
    out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    out = out.replace(/~~([^~\n]+)~~/g, "<s>$1</s>");
    out = out.replace(/\[([^\]\n]+)\]\((https?:[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    out = out.replace(/(^|[\s(])((?:https?:\/\/)[^\s<)]+)/g,
      '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
    return out;
  }

  function render(src) {
    var text = S.esc(src === undefined || src === null ? "" : src);
    var blocks = [];

    /* pull fenced code out before anything else touches it */
    text = text.replace(/```([\w+-]*)\n?([\s\S]*?)```/g, function (_, lang, code) {
      var clean = code.replace(/\n$/, "");
      blocks.push({ lang: lang || "", code: clean });
      return "\u0001CODE" + (blocks.length - 1) + "\u0001";
    });

    var lines = text.split("\n");
    var html = [];
    var listType = null;
    var inQuote = false;
    var tableBuf = [];

    function closeList() {
      if (listType) { html.push("</" + listType + ">"); listType = null; }
    }
    function closeQuote() {
      if (inQuote) { html.push("</blockquote>"); inQuote = false; }
    }
    function flushTable() {
      if (!tableBuf.length) return;
      var rows = tableBuf.filter(function (r) { return !/^\s*\|?[\s:|-]+\|?\s*$/.test(r); });
      var head = rows.shift();
      function cells(row) {
        return row.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map(function (c) {
          return c.trim();
        });
      }
      var out = "<table><thead><tr>";
      cells(head).forEach(function (c) { out += "<th>" + inline(c) + "</th>"; });
      out += "</tr></thead><tbody>";
      rows.forEach(function (r) {
        out += "<tr>";
        cells(r).forEach(function (c) { out += "<td>" + inline(c) + "</td>"; });
        out += "</tr>";
      });
      out += "</tbody></table>";
      html.push(out);
      tableBuf = [];
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      if (/^\s*\|.*\|\s*$/.test(line)) { tableBuf.push(line); continue; }
      flushTable();

      if (/^\u0001CODE\d+\u0001$/.test(line.trim())) {
        closeList(); closeQuote();
        html.push(line.trim());
        continue;
      }
      if (!line.trim()) { closeList(); closeQuote(); continue; }

      var h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h) {
        closeList(); closeQuote();
        var level = Math.min(h[1].length, 3);
        html.push("<h" + level + ">" + inline(h[2]) + "</h" + level + ">");
        continue;
      }
      if (/^\s*([-*_]\s*){3,}$/.test(line)) {
        closeList(); closeQuote();
        html.push("<hr>");
        continue;
      }
      var q = line.match(/^\s*&gt;\s?(.*)$/);
      if (q) {
        closeList();
        if (!inQuote) { html.push("<blockquote>"); inQuote = true; }
        html.push("<p>" + inline(q[1]) + "</p>");
        continue;
      }
      closeQuote();

      var ul = line.match(/^\s*[-*+]\s+(.*)$/);
      var ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (ul || ol) {
        var want = ul ? "ul" : "ol";
        if (listType !== want) { closeList(); html.push("<" + want + ">"); listType = want; }
        html.push("<li>" + inline((ul || ol)[1]) + "</li>");
        continue;
      }
      closeList();
      html.push("<p>" + inline(line) + "</p>");
    }
    flushTable();
    closeList();
    closeQuote();

    var result = html.join("\n");
    result = result.replace(/\u0001CODE(\d+)\u0001/g, function (_, idx) {
      var b = blocks[+idx];
      var label = b.lang || "text";
      return '<div class="code"><div class="code-top"><span>' + S.esc(label) +
        '</span><button type="button" data-copy-code>копировать</button></div>' +
        "<pre><code>" + highlight(b.code, b.lang) + "</code></pre></div>";
    });
    return result;
  }

  /* plain text back out of a rendered message, for copy / export */
  function strip(src) {
    return String(src || "").replace(/```[\w+-]*\n?/g, "").replace(/[*_`~#>]/g, "");
  }

  global.MD = { render: render, strip: strip, highlight: highlight };
})(window);
