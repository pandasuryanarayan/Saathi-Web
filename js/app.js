/* Saathi — application core. UI state, conversation tree, streaming chat,
   settings pages. Rendering is plain DOM; provider I/O is delegated to the
   native bridge via window.Android. */
(function () {
  var P = window.SaathiProviders;
  var MD = window.SaathiMarkdown;
  var I = window.SaathiI18n;
  var T = window.SaathiTree;
  var nodeById = T.nodeById;
  var childrenOf = T.childrenOf;
  var siblingsOf = T.siblingsOf;
  var activePath = T.activePath;
  var deepestLast = T.deepestLast;

  /* ---------------- helpers ---------------- */
  function $(id) { return document.getElementById(id); }
  function t(k) { return I.t(k); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function mk(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  var ICON = (window.SaathiIcons && window.SaathiIcons.svg) || function () { return ''; };
  var raf = window.requestAnimationFrame
    ? window.requestAnimationFrame.bind(window)
    : function (fn) { fn(); };
  function openOverlay(id) { var el = $(id); raf(function () { el.classList.add('open'); }); }
  function icEl(name, size, cls) {
    var s = mk('span', cls || 'ico');
    s.innerHTML = ICON(name, size || 20);
    return s;
  }
  function loadMoreRow(onClick) {
    var b = mk('button', 'load-more');
    b.appendChild(icEl('refresh', 16, 'load-ico'));
    b.appendChild(mk('span', null, t('nav.loadMore')));
    b.addEventListener('click', onClick);
    return b;
  }
  function fmtDate(ts) {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) { return ''; }
  }
  function actBtn(iconName, label, extra) {
    var b = mk('button', 'act' + (extra ? ' ' + extra : ''));
    b.appendChild(icEl(iconName, 15, 'act-ico'));
    b.appendChild(mk('span', 'act-label', label));
    return b;
  }
  var SPARKLE_PATH = '<path fill="currentColor" d="M50,6 Q55,45 94,50 Q55,55 50,94 Q45,55 6,50 Q45,45 50,6 Z"/>' +
    '<path fill="currentColor" d="M78,10 Q79.33,20.67 90,22 Q79.33,23.33 78,34 Q76.67,23.33 66,22 Q76.67,20.67 78,10 Z"/>';
  function sparkle(px) {
    return '<svg viewBox="0 0 100 100" width="' + px + '" height="' + px + '" aria-hidden="true">' + SPARKLE_PATH + '</svg>';
  }

  function toast(msg) {
    var el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('show'); }, 1800);
  }

  /* ---------------- persistence ---------------- */
  function readStore(key, def) {
    try {
      var s = window.Android ? window.Android.readStore(key) : (localStorage.getItem(key) || '');
      if (!s) return def;
      return JSON.parse(s);
    } catch (e) { return def; }
  }
  function writeStore(key, val) {
    var s = JSON.stringify(val);
    if (window.Android) window.Android.writeStore(key, s);
    else localStorage.setItem(key, s);
  }

  /* ---------------- state ---------------- */
  var DEFAULT_SETTINGS = {
    theme: 'system',
    accent: '#0B6B5B',
    fontSize: 15,
    language: 'system',
    providers: [],
    activeProviderId: null,
    activeModel: null,
    systemPrompt: ''
  };

  var state = {
    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
    convs: [],
    currentId: null,
    streaming: false,
    activeCall: null,
    attachments: [],
    sysLocale: 'en',
    drawerLimit: 10
  };

  var ACCENTS = ['#0B6B5B', '#1A73E8', '#7C4DFF', '#D81B60', '#E8710A', '#00897B', '#5D4037', '#455A64'];
  var INDIAN_LANGS = [
    { code: 'as', name: 'অসমীয়া' },
    { code: 'bn', name: 'বাংলা' },
    { code: 'gu', name: 'ગુજરાતી' },
    { code: 'hi', name: 'हिन्दी' },
    { code: 'kn', name: 'ಕನ್ನಡ' },
    { code: 'ml', name: 'മലയാളം' },
    { code: 'mr', name: 'मराठी' },
    { code: 'ne', name: 'नेपाली' },
    { code: 'or', name: 'ଓଡ଼ିଆ' },
    { code: 'pa', name: 'ਪੰਜਾਬੀ' },
    { code: 'sa', name: 'संस्कृतम्' },
    { code: 'ta', name: 'தமிழ்' },
    { code: 'te', name: 'తెలుగు' }
  ];

  /* ---------------- theming / i18n ---------------- */
  function resolvedTheme() {
    if (state.settings.theme === 'light') return 'light';
    if (state.settings.theme === 'dark') return 'dark';
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function hexToRgb(hex) {
    var h = (hex || '').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (isNaN(n) || h.length !== 6) return { r: 11, g: 107, b: 91 };
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function applyTheme() {
    var root = document.documentElement;
    root.setAttribute('data-theme', resolvedTheme());
    var accent = state.settings.accent || '#0B6B5B';
    var c = hexToRgb(accent);
    var lum = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--accent-ink', lum > 0.62 ? '#0b1116' : '#ffffff');
    root.style.setProperty('--accent-soft', 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',0.12)');
    root.style.setProperty('--accent-soft-2', 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',0.20)');
    root.style.setProperty('--accent-line', 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',0.38)');
    root.style.setProperty('--fs', state.settings.fontSize + 'px');
  }
  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(function (e) {
      var k = e.getAttribute('data-i18n');
      var v = t(k);
      if (v) e.textContent = v;
    });
    document.querySelectorAll('[data-i18n-ph]').forEach(function (e) {
      e.setAttribute('placeholder', t(e.getAttribute('data-i18n-ph')));
    });
    document.querySelectorAll('[data-i18n-title]').forEach(function (e) {
      e.setAttribute('title', t(e.getAttribute('data-i18n-title')));
    });
  }
  function currentLang() {
    if (state.settings.language && state.settings.language !== 'system') return state.settings.language;
    var code = (state.sysLocale || 'en').split(/[-_]/)[0].toLowerCase();
    return code;
  }
  function refreshLang() {
    I.setLanguage(currentLang());
    applyI18n();
  }

  /* ---------------- conversation model (tree) ---------------- */
  function newConv() {
    var c = {
      id: uid(),
      title: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      systemPrompt: '',
      providerId: null,
      model: null,
      nodes: [],
      leafId: null
    };
    state.convs.unshift(c);
    state.currentId = c.id;
    return c;
  }
  function convById(id) {
    for (var i = 0; i < state.convs.length; i++) if (state.convs[i].id === id) return state.convs[i];
    return null;
  }
  function currentConv() { return convById(state.currentId); }
  function addNode(c, parentId, role, content) {
    var n = { id: uid(), parentId: parentId || null, role: role, content: content || '', ts: Date.now() };
    c.nodes.push(n);
    c.leafId = n.id;
    c.updatedAt = Date.now();
    return n;
  }
  function saveConvs() { writeStore('conversations', state.convs); }
  function saveSettings() { writeStore('settings', state.settings); }

  /* ---------------- drawer ---------------- */
  var DRAWER_PAGE = 10;
  function renderDrawer() {
    var list = $('convList');
    list.innerHTML = '';
    if (!state.convs.length) {
      list.appendChild(mk('div', 'hint', t('chat.emptyTitle')));
      return;
    }
    var sorted = state.convs.slice().sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    var shown = sorted.slice(0, state.drawerLimit);
    shown.forEach(function (c) {
      var item = mk('div', 'conv-item' + (c.id === state.currentId ? ' active' : ''));
      var title = mk('div', 'ci-title', c.title || t('nav.newChat'));
      var more = mk('button', 'ci-more');
      more.innerHTML = ICON('more', 18);
      more.addEventListener('click', function (ev) { ev.stopPropagation(); convSheet(c); });
      item.appendChild(title);
      item.appendChild(more);
      item.addEventListener('click', function () {
        state.currentId = c.id;
        closeDrawer();
        clearAttachments();
        renderAll();
      });
      list.appendChild(item);
    });
    if (sorted.length > shown.length) {
      list.appendChild(loadMoreRow(function () {
        state.drawerLimit += DRAWER_PAGE;
        renderDrawer();
      }));
    }
  }
  function openDrawer() { $('drawer').classList.add('open'); $('scrim').classList.add('show'); }
  function closeDrawer() { $('drawer').classList.remove('open'); $('scrim').classList.remove('show'); }

  /* ---------------- sheet ---------------- */
  function closeSheet() {
    var s = document.getElementById('dynSheet');
    if (s) s.remove();
    var sc = document.getElementById('dynScrim');
    if (sc) sc.remove();
  }
  function openSheet(items) {
    closeSheet();
    var scrim = mk('div', 'sheet-scrim show'); scrim.id = 'dynScrim';
    scrim.addEventListener('click', closeSheet);
    var sheet = mk('div', 'sheet open'); sheet.id = 'dynSheet';
    items.forEach(function (it) {
      var row = mk('div', 'sheet-item' + (it.danger ? ' danger' : ''));
      if (it.icon) row.appendChild(icEl(it.icon, 20, 'di'));
      row.appendChild(mk('span', null, it.label));
      row.addEventListener('click', function () { closeSheet(); it.action(); });
      sheet.appendChild(row);
    });
    document.body.appendChild(scrim);
    document.body.appendChild(sheet);
    raf(function () { sheet.classList.add('open'); });
  }
  function convSheet(c) {
    openSheet([
      { icon: 'edit', label: t('nav.rename'), action: function () { renameConv(c); } },
      { icon: 'share', label: t('nav.share'), action: function () { shareConv(c); } },
      { icon: 'trash', label: t('nav.delete'), danger: true, action: function () { deleteConv(c); } }
    ]);
  }
  function renameConv(c) {
    openEditor(t('nav.rename'), function (body) {
      var f = field(body, t('nav.rename'), 'text', c.title);
      return function () {
        c.title = f.value.trim() || c.title;
        c.updatedAt = Date.now();
        saveConvs(); renderAll();
      };
    });
  }
  function shareConv(c) {
    var path = activePath(c);
    var txt = path.map(function (n) {
      return (n.role === 'user' ? t('msg.you') : t('msg.assistant')) + ':\n' + n.content;
    }).join('\n\n');
    if (window.Android) window.Android.shareText(txt);
  }
  function deleteConv(c) {
    confirmDialog(t('confirm.deleteChat'), function () {
      state.convs = state.convs.filter(function (x) { return x.id !== c.id; });
      if (state.currentId === c.id) state.currentId = state.convs.length ? state.convs[0].id : null;
      saveConvs(); renderAll();
    });
  }

  /* ---------------- export ---------------- */
  function exportPayload(chats) {
    return {
      app: 'Saathi',
      schema: 1,
      exportedAt: new Date().toISOString(),
      chatCount: chats.length,
      chats: chats.map(function (c) {
        var path = activePath(c).filter(function (n) { return n.role !== 'system'; });
        return {
          id: c.id,
          title: c.title || '',
          createdAt: c.createdAt || null,
          updatedAt: c.updatedAt || null,
          providerId: c.providerId || null,
          model: c.model || null,
          systemPrompt: c.systemPrompt || '',
          messages: path.map(function (n) {
            var m = { role: n.role, content: n.content || '', ts: n.ts || null };
            if (n.model) m.model = n.model;
            if (n.attachments && n.attachments.length) {
              m.attachments = n.attachments.map(function (a) {
                var o = { kind: a.kind, name: a.name || '', mime: a.mime || '' };
                if (a.size != null) o.size = a.size;
                if (a.kind === 'text' && typeof a.text === 'string') o.text = a.text;
                return o;
              });
            }
            return m;
          })
        };
      })
    };
  }

  var EXPORT_PAGE = 10;
  function openExportPage() {
    closeDrawer();
    var selected = {};
    var limit = EXPORT_PAGE;

    openEditor(t('export.title'), function (body) {
      body.appendChild(mk('div', 'hint', t('export.hint')));
      var card = mk('div', 'card');
      body.appendChild(card);

      function newestFirst() {
        return state.convs.slice().sort(function (a, b) { return b.updatedAt - a.updatedAt; });
      }
      function renderList() {
        card.innerHTML = '';
        var all = newestFirst();
        var shown = all.slice(0, limit);
        shown.forEach(function (c) {
          var row = mk('label', 'row export-row');
          var cb = mk('input');
          cb.type = 'checkbox';
          cb.className = 'checkbox';
          cb.checked = !!selected[c.id];
          cb.addEventListener('change', function () {
            if (cb.checked) selected[c.id] = true; else delete selected[c.id];
          });
          row.appendChild(cb);
          var main = mk('div', 'r-main');
          main.appendChild(mk('div', 'r-title', c.title || t('nav.newChat')));
          var d = fmtDate(c.updatedAt);
          if (d) main.appendChild(mk('div', 'r-sub', d));
          row.appendChild(main);
          card.appendChild(row);
        });
        if (all.length > shown.length) {
          card.appendChild(loadMoreRow(function () {
            limit += EXPORT_PAGE;
            renderList();
          }));
        }
      }
      renderList();

      return function () {
        var ids = Object.keys(selected);
        if (!ids.length) { toast(t('export.empty')); return false; }
        var picked = state.convs.filter(function (c) { return selected[c.id]; });
        picked.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
        var json = JSON.stringify(exportPayload(picked), null, 2);
        if (window.Android && window.Android.shareText) window.Android.shareText(json);
        return true;
      };
    }, t('export.action'));
  }

  /* ---------------- message rendering ---------------- */
  function renderMessages() {
    var box = $('messages');
    box.innerHTML = '';
    var c = currentConv();
    var path = c ? activePath(c) : [];
    if (!path.length) {
      var empty = mk('div', 'empty');
      var emMark = mk('div', 'em-mark');
      emMark.innerHTML = sparkle(34);
      empty.appendChild(emMark);
      empty.appendChild(mk('div', 'em-title', t('chat.emptyTitle')));
      empty.appendChild(mk('div', 'em-hint', t('chat.emptyHint')));
      box.appendChild(empty);
      return;
    }
    path.forEach(function (n) { box.appendChild(renderMessage(c, n)); });
    scrollBottom();
  }

  function renderMessage(c, n) {
    var wrap = mk('div', 'msg ' + (n.role === 'user' ? 'user' : 'assistant'));
    wrap.dataset.id = n.id;
    wrap.appendChild(mk('div', 'role', n.role === 'user' ? t('msg.you') : t('msg.assistant')));

    var bubble = mk('div', 'bubble');
    var atts = n.attachments || [];
    if (atts.length) {
      var attBox = mk('div', 'atts');
      atts.forEach(function (a) {
        if (a.kind === 'image') {
          var im = mk('img'); im.src = a.dataUrl; im.alt = a.name || 'image';
          attBox.appendChild(im);
        } else {
          var f = mk('div', 'att-file');
          f.appendChild(icEl('file', 15, 'di'));
          f.appendChild(mk('span', null, a.name || 'file'));
          attBox.appendChild(f);
        }
      });
      bubble.appendChild(attBox);
    }
    var textEl = mk('div', 'bubble-text');
    if (n.role === 'assistant') textEl.innerHTML = MD.render(n.content) || '<span class="typing"><i></i><i></i><i></i></span>';
    else if (n.content) textEl.textContent = n.content;
    bubble.appendChild(textEl);
    wrap.appendChild(bubble);

    // version switcher
    var sibs = siblingsOf(c, n);
    if (sibs.length > 1) {
      var idx = sibs.indexOf(n);
      var ver = mk('div', 'ver');
      var prev = mk('button', null); prev.innerHTML = ICON('chevronLeft', 16); prev.disabled = idx === 0;
      var label = mk('span', null, (idx + 1) + '/' + sibs.length);
      var next = mk('button', null); next.innerHTML = ICON('chevronRight', 16); next.disabled = idx === sibs.length - 1;
      prev.addEventListener('click', function () { switchVersion(c, n, -1); });
      next.addEventListener('click', function () { switchVersion(c, n, 1); });
      ver.appendChild(prev); ver.appendChild(label); ver.appendChild(next);
      wrap.appendChild(ver);
    }

    // actions
    var actions = mk('div', 'actions');
    if (n.role === 'assistant') {
      var modelName = n.model || c.model || '';
      if (modelName) {
        var tag = mk('span', 'model-tag', modelName);
        tag.title = modelName;
        actions.appendChild(tag);
      }
    }
    var copy = actBtn('copy', t('chat.copy'));
    copy.addEventListener('click', function () {
      if (window.Android) window.Android.copyText(n.content);
      toast(t('toast.copied'));
    });
    actions.appendChild(copy);
    if (n.role === 'user') {
      var edit = actBtn('edit', t('chat.edit'));
      edit.addEventListener('click', function () { editMessage(c, n); });
      actions.appendChild(edit);
    } else {
      var regen = actBtn('refresh', t('chat.regenerate'), 'act-regen');
      regen.addEventListener('click', function () { regenerate(c, n); });
      actions.appendChild(regen);
    }
    wrap.appendChild(actions);

    bubble.addEventListener('click', function (e) {
      var cp = e.target.closest && e.target.closest('.code-copy');
      if (cp) {
        var code = decodeURIComponent(cp.getAttribute('data-code'));
        if (window.Android) window.Android.copyText(code);
        toast(t('toast.copied'));
      }
    });
    return wrap;
  }

  function switchVersion(c, n, dir) {
    var leaf = T.switchTo(c, n, dir);
    if (!leaf) return;
    c.leafId = leaf;
    c.updatedAt = Date.now();
    saveConvs(); renderAll();
  }

  function scrollBottom() {
    var box = $('messages');
    box.scrollTop = box.scrollHeight;
  }

  /* ---------------- sending / streaming ---------------- */
  function effectiveProvider(c) {
    var pid = (c && c.providerId) || state.settings.activeProviderId;
    var list = state.settings.providers || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === pid) return list[i];
    return list[0] || null;
  }
  function effectiveModel(c) {
    return (c && c.model) || state.settings.activeModel || (effectiveProvider(c) ? (effectiveProvider(c).models || [])[0] : null);
  }

  function contextMessages(c) {
    var path = activePath(c);
    var out = [];
    // char budget, keep most recent
    var budget = 24000;
    for (var i = path.length - 1; i >= 0; i--) {
      var n = path[i];
      if (n.role === 'system') continue;
      var hasAtt = n.attachments && n.attachments.length;
      if (!n.content && !hasAtt) continue;
      budget -= (n.content || '').length;
      if (budget < 0 && out.length) break;
      var m = { role: n.role, content: n.content || '' };
      if (hasAtt) m.attachments = n.attachments;
      out.unshift(m);
    }
    return out;
  }

  function systemPromptFor(c) {
    return (c && c.systemPrompt) || state.settings.systemPrompt || '';
  }

  function sendMessage(text) {
    text = (text || '').trim();
    if (state.streaming) return;
    var atts = state.attachments.slice();
    if (!text && !atts.length) return;
    var c = currentConv() || newConv();
    var parent = c.leafId;
    var node = addNode(c, parent, 'user', text);
    if (atts.length) node.attachments = atts;
    state.attachments = [];
    renderAttachBar();
    if (!c.title) {
      var seed = text || (atts.length ? (atts[0].name || '') : '');
      c.title = seed.length > 40 ? seed.slice(0, 40) + '…' : seed;
    }
    saveConvs();
    renderAll();
    runAssistant(c);
  }

  function runAssistant(c) {
    var provider = effectiveProvider(c);
    var model = effectiveModel(c);
    if (!provider) { toast(t('error.noProvider')); return; }
    if (!model) { toast(t('error.noModel')); return; }
    if (provider.type !== 'ollama' && !provider.apiKey) { toast(t('error.noKey')); return; }

    var parent = c.leafId;
    var node = addNode(c, parent, 'assistant', '');
    node.model = model;
    c.providerId = provider.id;
    c.model = model;
    renderAll();

    var msgs = contextMessages(c);
    var req = P.buildChat(provider, model, msgs, systemPromptFor(c), true);
    var parser = P.createStreamParser(provider);
    var callId = 'c' + uid();
    state.streaming = true;
    state.activeCall = callId;
    setComposerState(true);

    window.__saathiStream = { node: node, c: c, callId: callId, parser: parser, rendered: false };

    window.Android.httpStart(callId, 'POST', req.url, JSON.stringify(req.headers), req.body, true);
  }

  function appendToStreaming(text, reasoning) {
    var s = window.__saathiStream;
    if (!s) return;
    if (text) s.node.content += text;
    var el = document.querySelector('.msg[data-id="' + s.node.id + '"] .bubble-text');
    if (el) {
      el.innerHTML = MD.render(s.node.content) || '<span class="typing"><i></i><i></i><i></i></span>';
      scrollBottom();
    }
  }

  function finishStreaming() {
    var s = window.__saathiStream;
    if (!s) return;
    s.c.updatedAt = Date.now();
    saveConvs();
    state.streaming = false;
    state.activeCall = null;
    window.__saathiStream = null;
    setComposerState(false);
    renderAll();
  }

  function regenerate(c, node) {
    if (state.streaming) return;
    // new assistant sibling under the same user parent
    var parentId = node.parentId;
    var parentNode = nodeById(c, parentId);
    if (!parentNode) return;
    // temporarily make the user parent the leaf so addNode attaches correctly
    c.leafId = parentId;
    runAssistant(c);
  }

  function editMessage(c, node) {
    openEditor(t('edit.title'), function (body) {
      var f = field(body, t('msg.you'), 'textarea', node.content);
      return function () {
        var val = f.value.trim();
        if (!val) return;
        // new sibling user node with same parent
        var parentId = node.parentId;
        var nn = addNode(c, parentId, 'user', val);
        saveConvs();
        renderAll();
        runAssistant(c);
      };
    });
  }

  /* ---------------- native stream callbacks ---------------- */
  window.__saathiHttpStatus = function (callId, status) { };
  window.__saathiHttpChunk = function (callId, chunk) {
    var s = window.__saathiStream;
    if (!s || s.callId !== callId) return;
    var events = s.parser.push(chunk);
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      if (ev.error) { toast(ev.error); continue; }
      if (ev.text || ev.reasoning) appendToStreaming(ev.text, ev.reasoning);
      if (ev.done) { /* final content may still arrive in same batch */ }
    }
  };
  window.__saathiHttpDone = function (callId) {
    var s = window.__saathiStream;
    if (!s || s.callId !== callId) return;
    finishStreaming();
  };
  window.__saathiHttpError = function (callId, msg) {
    var s = window.__saathiStream;
    if (!s || s.callId !== callId) return;
    toast(t('error.title') + ': ' + msg);
    finishStreaming();
  };
  window.__saathiHttpResult = function (callId, status, body) {
    if (window.__saathiPending && window.__saathiPending[callId]) {
      window.__saathiPending[callId](status, body);
      delete window.__saathiPending[callId];
    }
  };

  function httpResult(method, url, headers, body, cb) {
    var callId = 'r' + uid();
    window.__saathiPending = window.__saathiPending || {};
    window.__saathiPending[callId] = cb;
    window.Android.httpStart(callId, method, url, JSON.stringify(headers || {}), body || '', false);
  }

  function stopStreaming() {
    if (state.activeCall) window.Android.httpCancel(state.activeCall);
    var s = window.__saathiStream;
    if (s) { s.c.updatedAt = Date.now(); saveConvs(); }
    state.streaming = false;
    state.activeCall = null;
    window.__saathiStream = null;
    setComposerState(false);
    renderAll();
  }

  function setComposerState(streaming) {
    $('sendBtn').classList.toggle('hidden', streaming);
    $('stopBtn').classList.toggle('hidden', !streaming);
    $('input').disabled = false;
  }

  /* ---------------- attachments ---------------- */
  var MAX_IMAGE_BYTES = 6 * 1024 * 1024;
  var MAX_TEXT_CHARS = 200000;

  function isTextFile(file) {
    if (file.type && file.type.indexOf('text/') === 0) return true;
    var n = (file.name || '').toLowerCase();
    return /\.(txt|md|markdown|json|csv|log|js|jsx|ts|tsx|py|java|kt|kts|xml|html|htm|css|scss|yml|yaml|sh|bash|sql|ini|toml|c|cpp|cc|h|hpp|rb|go|rs|php|env|conf|cfg|properties)$/.test(n);
  }
  function readAsDataUrl(file) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(r.result); };
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }
  function readAsText(file) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(r.result); };
      r.onerror = rej;
      r.readAsText(file);
    });
  }

  function addFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    var jobs = [];
    var rejected = false;
    files.forEach(function (f) {
      if (f.type && f.type.indexOf('image/') === 0) {
        if (f.size > MAX_IMAGE_BYTES) { rejected = true; return; }
        jobs.push(readAsDataUrl(f).then(function (url) {
          state.attachments.push({ kind: 'image', name: f.name || 'image', mime: f.type || 'image/png', dataUrl: url, size: f.size });
        }));
      } else if (isTextFile(f)) {
        jobs.push(readAsText(f).then(function (txt) {
          if (txt.length > MAX_TEXT_CHARS) txt = txt.slice(0, MAX_TEXT_CHARS) + '\n\u2026(truncated)';
          state.attachments.push({ kind: 'text', name: f.name || 'file', mime: f.type || 'text/plain', text: txt, size: f.size });
        }));
      } else {
        rejected = true;
      }
    });
    Promise.all(jobs).then(function () {
      renderAttachBar();
      if (rejected) toast(t('chat.attachUnsupported'));
    });
  }

  function renderAttachBar() {
    var bar = $('attachBar');
    bar.innerHTML = '';
    if (!state.attachments.length) {
      bar.classList.add('hidden');
      updateAttachHint();
      return;
    }
    bar.classList.remove('hidden');
    state.attachments.forEach(function (a, i) {
      var chip = mk('div', 'attach-chip');
      if (a.kind === 'image') {
        var im = mk('img'); im.src = a.dataUrl; im.alt = a.name;
        chip.appendChild(im);
      } else {
        chip.appendChild(icEl('file', 18, 'di'));
      }
      chip.appendChild(mk('span', 'ac-name', a.name));
      var rm = mk('button', 'ac-rm');
      rm.innerHTML = ICON('close', 15);
      rm.addEventListener('click', function () {
        state.attachments.splice(i, 1);
        renderAttachBar();
      });
      chip.appendChild(rm);
      bar.appendChild(chip);
    });
    updateAttachHint();
  }

  function updateAttachHint() {
    var hint = $('attachHint');
    var hasImg = state.attachments.some(function (a) { return a.kind === 'image'; });
    if (!state.attachments.length) {
      hint.classList.add('hidden'); hint.textContent = '';
      return;
    }
    var c = currentConv();
    var model = (c && c.model) || state.settings.activeModel || '';
    if (hasImg && !P.isVisionModel(model)) {
      hint.textContent = t('chat.visionHint');
      hint.classList.add('warn');
      hint.classList.remove('hidden');
    } else {
      hint.classList.add('hidden');
      hint.textContent = '';
    }
  }

  function clearAttachments() {
    if (!state.attachments.length) return;
    state.attachments = [];
    renderAttachBar();
  }

  /* ---------------- generic editor overlay ---------------- */
  function openEditor(title, build, submitLabel) {
    var body = $('editorBody');
    body.innerHTML = '';
    $('editorTitle').textContent = title;
    var submit = build(body);
    var row = mk('div', 'btn-row');
    var cancel = mk('button', 'btn', t('common.cancel'));
    cancel.addEventListener('click', closeEditor);
    var save = mk('button', 'btn btn-primary', submitLabel || t('common.save'));
    save.addEventListener('click', function () {
      var ok = submit ? submit() : true;
      if (ok !== false) closeEditor();
    });
    row.appendChild(cancel); row.appendChild(save);
    body.appendChild(row);
    openOverlay('editorOverlay');
  }
  function closeEditor() { $('editorOverlay').classList.remove('open'); }

  function field(parent, label, type, value, placeholder) {
    var wrap = mk('div', 'field');
    if (label) wrap.appendChild(mk('label', null, label));
    var inp;
    if (type === 'textarea') { inp = mk('textarea'); inp.value = value || ''; }
    else if (type === 'select') { inp = mk('select'); }
    else { inp = mk('input'); inp.type = type; inp.value = value || ''; }
    if (placeholder) inp.placeholder = placeholder;
    wrap.appendChild(inp);
    parent.appendChild(wrap);
    return inp;
  }

  function confirmDialog(msg, onYes) {
    openSheet([
      { icon: 'alert', label: msg, action: function () { } },
      { icon: 'check', label: t('common.confirm'), danger: true, action: onYes },
      { icon: 'close', label: t('common.cancel'), action: function () { } }
    ]);
  }

  /* ---------------- settings ---------------- */
  function openSettings() {
    closeDrawer();
    renderSettings();
    openOverlay('settingsOverlay');
  }
  function closeSettings() { $('settingsOverlay').classList.remove('open'); }

  function group(parent, title) {
    var g = mk('div', 'group');
    if (title) g.appendChild(mk('div', 'group-title', title));
    var card = mk('div', 'card');
    g.appendChild(card);
    parent.appendChild(g);
    return card;
  }
  function row(card, icon, title, sub, value, onClick, danger) {
    var r = mk('div', 'row' + (danger ? ' danger' : ''));
    if (icon) r.appendChild(icEl(icon, 20, 'r-ico'));
    var main = mk('div', 'r-main');
    main.appendChild(mk('div', 'r-title', title));
    if (sub) main.appendChild(mk('div', 'r-sub', sub));
    r.appendChild(main);
    if (value != null) r.appendChild(mk('div', 'r-val', value));
    if (onClick) {
      var arrow = mk('div', 'r-arrow'); arrow.innerHTML = ICON('chevronRight', 18);
      r.appendChild(arrow);
      r.addEventListener('click', onClick);
    }
    card.appendChild(r);
    return r;
  }

  function renderSettings() {
    var body = $('settingsBody');
    body.innerHTML = '';
    $('settingsTitle').textContent = t('nav.settings');

    var c1 = group(body, null);
    row(c1, 'plug', t('settings.providers'), t('settings.providersSub'), null, openProvidersPage);
    row(c1, 'layers', t('settings.models'), t('settings.modelsSub'), currentModelLabel(), openModelsPage);
    row(c1, 'fileText', t('settings.systemPrompt'), t('settings.systemPromptSub'), null, openSystemPromptPage);

    var c2 = group(body, null);
    row(c2, 'palette', t('settings.appearance'), t('settings.appearanceSub'), null, openAppearancePage);
    row(c2, 'globe', t('settings.language'), t('settings.languageSub'), langLabel(), openLanguagePage);

    var c3 = group(body, null);
    row(c3, 'trash', t('settings.clearChats'), t('settings.clearChatsSub'), null, function () {
      confirmDialog(t('confirm.clearChats'), function () {
        state.convs = [];
        state.currentId = null;
        saveConvs(); renderAll();
        toast(t('toast.saved'));
      });
    }, true);

    var note = mk('div', 'about-note');
    note.appendChild(mk('b', null, t('about.madeBy')));
    body.appendChild(note);
  }

  function currentModelLabel() {
    var c = currentConv();
    var m = (c && c.model) || state.settings.activeModel;
    return m || t('models.choose');
  }
  function langLabel() {
    if (!state.settings.language || state.settings.language === 'system') return t('language.system');
    if (state.settings.language === 'en') return 'English';
    for (var i = 0; i < INDIAN_LANGS.length; i++) if (INDIAN_LANGS[i].code === state.settings.language) return INDIAN_LANGS[i].name;
    return 'English';
  }

  /* ---- providers ---- */
  function openProvidersPage() {
    $('editorTitle').textContent = t('providers.title');
    var body = $('editorBody');
    body.innerHTML = '';
    var card = mk('div', 'card');
    var list = state.settings.providers || [];
    if (!list.length) {
      body.appendChild(mk('div', 'hint', t('providers.none')));
    } else {
      list.forEach(function (p) {
        row(card, 'plug', p.name, (P.typeById(p.type).name), (p.models || []).length + '', function () {
          openProviderEditor(p);
        });
      });
      body.appendChild(card);
    }
    var add = mk('button', 'btn btn-primary btn-block');
    add.appendChild(icEl('plus', 18, 'btn-ico'));
    add.appendChild(mk('span', 'btn-label', t('providers.add')));
    add.style.marginTop = '14px';
    add.addEventListener('click', function () { openProviderEditor(null); });
    body.appendChild(add);
    openOverlay('editorOverlay');
  }

  function openProviderEditor(p) {
    var isNew = !p;
    var draft = p ? JSON.parse(JSON.stringify(p)) : {
      id: uid(), type: 'openai', name: 'OpenAI', baseUrl: P.typeById('openai').baseUrl,
      apiKey: '', protocol: 'openai', models: P.typeById('openai').models.slice()
    };
    $('editorTitle').textContent = isNew ? t('providers.add') : draft.name;
    var body = $('editorBody');
    body.innerHTML = '';

    var typeWrap = mk('div', 'field');
    typeWrap.appendChild(mk('label', null, t('providers.type')));
    var sel = mk('select');
    P.TYPES.forEach(function (ty) {
      var o = mk('option', null, ty.name); o.value = ty.id;
      if (ty.id === draft.type) o.selected = true;
      sel.appendChild(o);
    });
    typeWrap.appendChild(sel);
    body.appendChild(typeWrap);

    var nameF = field(body, t('providers.name'), 'text', draft.name);
    var baseF = field(body, t('providers.baseUrl'), 'text', draft.baseUrl);
    var keyF = field(body, t('providers.apiKey'), 'password', draft.apiKey);
    keyF.setAttribute('autocomplete', 'off');

    var modelsHint = mk('div', 'hint');
    function updateModelsHint() { modelsHint.textContent = (draft.models || []).length + ' ' + t('providers.models'); }
    updateModelsHint();
    body.appendChild(modelsHint);

    var fetchBtn = mk('button', 'btn btn-block');
    var fetchLabel = mk('span', 'btn-label', t('providers.fetchModels'));
    fetchBtn.appendChild(icEl('refresh', 18, 'btn-ico'));
    fetchBtn.appendChild(fetchLabel);
    fetchBtn.style.marginBottom = '12px';
    fetchBtn.addEventListener('click', function () {
      var key = keyF.value.trim();
      var base = baseF.value.trim();
      if (!base) { toast(t('providers.baseUrl')); return; }
      fetchBtn.classList.add('loading');
      fetchLabel.textContent = t('providers.fetching');
      var prov = { id: draft.id, type: sel.value, baseUrl: base, apiKey: key, protocol: P.typeById(sel.value).protocol };
      var req = P.buildModels(prov);
      httpResult('GET', req.url, req.headers, '', function (status, rbody) {
        fetchBtn.classList.remove('loading');
        fetchLabel.textContent = t('providers.fetchModels');
        if (status >= 200 && status < 300) {
          var models = P.parseModels(prov, rbody);
          if (models.length) {
            draft.models = models;
            updateModelsHint();
            toast(models.length + ' ' + t('providers.modelsFound'));
          } else toast(t('providers.noModels'));
        } else {
          toast(P.parseError(status, rbody));
        }
      });
    });
    body.appendChild(fetchBtn);

    sel.addEventListener('change', function () {
      var ty = P.typeById(sel.value);
      draft.type = sel.value;
      draft.protocol = ty.protocol;
      nameF.value = ty.name;
      if (ty.baseUrl) baseF.value = ty.baseUrl;
      draft.models = (ty.models || []).slice();
      updateModelsHint();
    });

    var row2 = mk('div', 'btn-row');
    if (!isNew) {
      var del = mk('button', 'btn btn-danger', t('common.delete'));
      del.addEventListener('click', function () {
        confirmDialog(t('confirm.deleteProvider'), function () {
          state.settings.providers = state.settings.providers.filter(function (x) { return x.id !== draft.id; });
          if (state.settings.activeProviderId === draft.id) {
            state.settings.activeProviderId = state.settings.providers.length ? state.settings.providers[0].id : null;
          }
          saveSettings(); closeEditor(); openProvidersPage();
        });
      });
      row2.appendChild(del);
    }
    var save = mk('button', 'btn btn-primary', t('common.save'));
    save.addEventListener('click', function () {
      draft.name = nameF.value.trim() || P.typeById(sel.value).name;
      draft.type = sel.value;
      draft.protocol = P.typeById(sel.value).protocol;
      draft.baseUrl = baseF.value.trim();
      draft.apiKey = keyF.value.trim();
      var list = state.settings.providers;
      var idx = -1;
      for (var i = 0; i < list.length; i++) if (list[i].id === draft.id) idx = i;
      if (idx >= 0) list[idx] = draft; else list.push(draft);
      if (!state.settings.activeProviderId) state.settings.activeProviderId = draft.id;
      if (!state.settings.activeModel && (draft.models || []).length) state.settings.activeModel = draft.models[0];
      saveSettings();
      closeEditor(); openProvidersPage();
      renderSettings();
    });
    row2.appendChild(save);
    body.appendChild(row2);

    var cancel = mk('button', 'btn btn-block', t('common.cancel'));
    cancel.style.marginTop = '10px';
    cancel.addEventListener('click', function () { closeEditor(); openProvidersPage(); });
    body.appendChild(cancel);

    openOverlay('editorOverlay');
  }

  /* ---- models ---- */
  function openModelsPage() {
    $('editorTitle').textContent = t('settings.models');
    var body = $('editorBody');
    body.innerHTML = '';
    var providers = state.settings.providers || [];
    if (!providers.length) {
      body.appendChild(mk('div', 'hint', t('providers.none')));
      openOverlay('editorOverlay');
      return;
    }
    providers.forEach(function (p) {
      var card = group(body, p.name);
      var models = p.models || [];
      if (!models.length) {
        row(card, null, t('providers.noModels'), null, null, null);
      }
      models.forEach(function (m) {
        var isSel = state.settings.activeProviderId === p.id && state.settings.activeModel === m;
        row(card, isSel ? 'check' : null, m, null, null, function () {
          state.settings.activeProviderId = p.id;
          state.settings.activeModel = m;
          var c = currentConv();
          if (c) { c.providerId = p.id; c.model = m; saveConvs(); }
          saveSettings();
          renderAll();
          renderSettings();
          openModelsPage();
        });
      });
    });
    openOverlay('editorOverlay');
  }

  /* ---- system prompt ---- */
  function openSystemPromptPage() {
    openEditor(t('settings.systemPrompt'), function (body) {
      body.appendChild(mk('div', 'hint', t('prompt.hint')));
      var f = field(body, null, 'textarea', state.settings.systemPrompt);
      return function () {
        state.settings.systemPrompt = f.value;
        var c = currentConv();
        if (c) { c.systemPrompt = f.value; saveConvs(); }
        saveSettings();
        renderSettings();
      };
    });
  }

  /* ---- appearance ---- */
  function openAppearancePage() {
    $('editorTitle').textContent = t('settings.appearance');
    var body = $('editorBody');
    body.innerHTML = '';

    var c1 = group(body, t('appearance.theme'));
    var seg = mk('div', 'seg');
    [['system', t('appearance.themeSystem')], ['light', t('appearance.themeLight')], ['dark', t('appearance.themeDark')]]
      .forEach(function (pair) {
        var b = mk('button', state.settings.theme === pair[0] ? 'sel' : '', pair[1]);
        b.addEventListener('click', function () {
          state.settings.theme = pair[0];
          saveSettings(); applyTheme(); openAppearancePage();
        });
        seg.appendChild(b);
      });
    c1.appendChild(seg);
    c1.style.padding = '14px';

    var c2 = group(body, t('appearance.accent'));
    var sw = mk('div', 'swatches');
    ACCENTS.forEach(function (col) {
      var s = mk('div', 'swatch' + (state.settings.accent === col ? ' sel' : ''));
      s.style.background = col;
      s.addEventListener('click', function () {
        state.settings.accent = col;
        saveSettings(); applyTheme(); openAppearancePage();
      });
      sw.appendChild(s);
    });
    c2.appendChild(sw);
    c2.style.padding = '14px';

    var c3 = group(body, t('appearance.fontSize'));
    var wrap = mk('div');
    wrap.style.padding = '14px';
    var rng = mk('input'); rng.type = 'range'; rng.min = '13'; rng.max = '21'; rng.step = '1';
    rng.value = state.settings.fontSize; rng.className = 'range';
    var lab = mk('div', 'hint', state.settings.fontSize + 'px');
    rng.addEventListener('input', function () {
      state.settings.fontSize = parseInt(rng.value, 10);
      lab.textContent = rng.value + 'px';
      applyTheme();
    });
    rng.addEventListener('change', function () { saveSettings(); });
    wrap.appendChild(rng); wrap.appendChild(lab);
    c3.appendChild(wrap);

    openOverlay('editorOverlay');
  }

  /* ---- language ---- */
  function openLanguagePage() {
    $('editorTitle').textContent = t('settings.language');
    var body = $('editorBody');
    body.innerHTML = '';
    body.appendChild(mk('div', 'hint', t('language.hint')));
    var card = mk('div', 'card');
    function pick(code) {
      state.settings.language = code;
      saveSettings();
      refreshLang();
      renderAll();
      openLanguagePage();
    }
    row(card, state.settings.language === 'system' ? 'check' : null, t('language.system'), null, null, function () { pick('system'); });
    row(card, state.settings.language === 'en' ? 'check' : null, 'English', null, null, function () { pick('en'); });
    INDIAN_LANGS.forEach(function (l) {
      row(card, state.settings.language === l.code ? 'check' : null, l.name, null, null, function () { pick(l.code); });
    });
    body.appendChild(card);
    openOverlay('editorOverlay');
  }

  /* ---------------- model chip ---------------- */
  function updateModelChip() {
    var c = currentConv();
    var m = (c && c.model) || state.settings.activeModel;
    $('modelChipText').textContent = m || t('models.choose');
  }

  /* ---------------- render orchestration ---------------- */
  function renderAll() {
    renderDrawer();
    renderMessages();
    updateModelChip();
    var c = currentConv();
    $('chatTitle').textContent = c && c.title ? c.title : t('nav.newChat');
  }

  /* ---------------- composer ---------------- */
  function autoGrow(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
  }

  function wireEvents() {
    $('menuBtn').addEventListener('click', openDrawer);
    $('drawerClose').addEventListener('click', closeDrawer);
    $('scrim').addEventListener('click', closeDrawer);
    $('newChat').addEventListener('click', function () {
      newConv(); saveConvs(); closeDrawer(); clearAttachments(); renderAll();
      $('input').focus();
    });
    $('openSettings').addEventListener('click', openSettings);
    $('openExport').addEventListener('click', openExportPage);
    $('settingsBack').addEventListener('click', closeSettings);
    $('editorBack').addEventListener('click', closeEditor);
    $('modelChip').addEventListener('click', openModelsPage);

    $('sendBtn').addEventListener('click', function () {
      var v = $('input').value;
      $('input').value = ''; autoGrow($('input'));
      sendMessage(v);
    });
    $('stopBtn').addEventListener('click', stopStreaming);
    $('attachBtn').addEventListener('click', function () { $('fileInput').click(); });
    $('fileInput').addEventListener('change', function (e) {
      addFiles(e.target.files);
      e.target.value = '';
    });
    var input = $('input');
    input.addEventListener('input', function () { autoGrow(input); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        var v = input.value;
        input.value = ''; autoGrow(input);
        sendMessage(v);
      }
    });

    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var fn = function () { if (state.settings.theme === 'system') applyTheme(); };
      if (mq.addEventListener) mq.addEventListener('change', fn);
      else if (mq.addListener) mq.addListener(fn);
    }
  }

  /* ---------------- back handling ---------------- */
  window.Saathi = {
    onBack: function () {
      if ($('editorOverlay').classList.contains('open')) { closeEditor(); return true; }
      if ($('settingsOverlay').classList.contains('open')) { closeSettings(); return true; }
      if (document.getElementById('dynSheet')) { closeSheet(); return true; }
      if ($('drawer').classList.contains('open')) { closeDrawer(); return true; }
      return false;
    }
  };

  /* ---------------- splash ---------------- */
  function dismissSplash() {
    var el = document.getElementById('splash');
    if (!el) return;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // hold so the whole intro reads (about 2.5 s), then cross-fade to the app
    var hold = reduce ? 350 : 2600;
    setTimeout(function () {
      el.classList.add('hide');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 700);
    }, hold);
  }

  /* ---------------- boot ---------------- */
  function boot() {
    state.settings = Object.assign(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), readStore('settings', {}));
    state.convs = readStore('conversations', []);
    try { state.sysLocale = window.Android ? window.Android.systemLocale() : (navigator.language || 'en'); }
    catch (e) { state.sysLocale = navigator.language || 'en'; }

    applyTheme();
    refreshLang();
    wireEvents();
    if (!state.convs.length) { newConv(); }
    else state.currentId = state.convs.slice().sort(function (a, b) { return b.updatedAt - a.updatedAt; })[0].id;

    renderAttachBar();
    renderAll();
    dismissSplash();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
