/* Compact, dependency-free Markdown renderer for chat messages.
   Escapes HTML first, then applies block + inline rules. Good enough for
   LLM output: headings, lists, fenced code, tables, quotes, links, emphasis. */
(function () {
  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function inline(s) {
    s = s.replace(/`([^`]+)`/g, function (_, c) { return '<code>' + c + '</code>'; });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
    return s;
  }

  function render(src) {
    if (!src) return '';
    var text = esc(src.replace(/\r\n/g, '\n'));
    var lines = text.split('\n');
    var out = [];
    var i = 0;
    var inList = null;

    function closeList() { if (inList) { out.push('</' + inList + '>'); inList = null; } }

    while (i < lines.length) {
      var line = lines[i];

      // fenced code
      var fence = line.match(/^\s*```(\w*)/);
      if (fence) {
        closeList();
        var lang = fence[1] || '';
        var buf = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++; // skip closing fence
        var code = buf.join('\n');
        out.push('<pre><button class="code-copy" data-code="' +
          encodeURIComponent(code) + '">copy</button><code class="lang-' + lang + '">' + code + '</code></pre>');
        continue;
      }

      // table
      if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
        closeList();
        var head = line.split('|').map(function (c) { return c.trim(); });
        if (head[0] === '') head.shift();
        if (head[head.length - 1] === '') head.pop();
        i += 2;
        var rows = [];
        while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim() !== '') {
          var cells = lines[i].split('|').map(function (c) { return c.trim(); });
          if (cells[0] === '') cells.shift();
          if (cells[cells.length - 1] === '') cells.pop();
          rows.push(cells);
          i++;
        }
        var t = '<table><thead><tr>' + head.map(function (h) { return '<th>' + inline(h) + '</th>'; }).join('') + '</tr></thead><tbody>';
        rows.forEach(function (r) {
          t += '<tr>' + r.map(function (c) { return '<td>' + inline(c) + '</td>'; }).join('') + '</tr>';
        });
        t += '</tbody></table>';
        out.push(t);
        continue;
      }

      // headings
      var h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) { closeList(); out.push('<h' + h[1].length + '>' + inline(h[2]) + '</h' + h[1].length + '>'); i++; continue; }

      // hr
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { closeList(); out.push('<hr>'); i++; continue; }

      // blockquote
      if (/^\s*>\s?/.test(line)) {
        closeList();
        var q = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
        out.push('<blockquote>' + inline(q.join('<br>')) + '</blockquote>');
        continue;
      }

      // lists
      var ul = line.match(/^\s*[-*+]\s+(.*)$/);
      var ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (ul || ol) {
        var want = ul ? 'ul' : 'ol';
        if (inList !== want) { closeList(); out.push('<' + want + '>'); inList = want; }
        out.push('<li>' + inline((ul ? ul[1] : ol[1])) + '</li>');
        i++;
        continue;
      }

      // blank
      if (line.trim() === '') { closeList(); i++; continue; }

      // paragraph (gather contiguous plain lines)
      closeList();
      var para = [line];
      i++;
      while (i < lines.length && lines[i].trim() !== '' &&
        !/^\s*(#{1,6}\s|>|[-*+]\s|\d+[.)]\s|```)/.test(lines[i]) && !/\|/.test(lines[i])) {
        para.push(lines[i]); i++;
      }
      out.push('<p>' + inline(para.join('<br>')) + '</p>');
    }
    closeList();
    return out.join('');
  }

  window.SaathiMarkdown = { render: render };
})();
