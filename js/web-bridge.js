/* Saathi — web bridge.
 *
 * On Android the UI (the files in this folder) runs inside a WebView and talks to
 * native code through a `window.Android` object (see Bridge.kt + HttpEngine.kt).
 * This file provides the *same* object using plain browser APIs, so the unchanged
 * web layer runs as an ordinary website:
 *
 *   storage   -> localStorage
 *   locale    -> navigator.language
 *   clipboard -> navigator.clipboard (with a legacy fallback)
 *   share     -> Web Share API, else a downloaded .txt
 *   HTTP      -> fetch() with a streaming body reader, feeding the same
 *                window.__saathiHttp* callbacks the native engine used
 *
 * It also wires the browser Back button and the Esc key to the app's own back
 * handler (window.Saathi.onBack), and adds the one extra header Anthropic needs
 * before it will answer a request made from a browser.
 *
 * Load this BEFORE js/app.js.
 */
(function () {
  'use strict';

  var PREFIX = 'saathi:';          // namespace for localStorage keys
  var inflight = {};               // callId -> AbortController

  /* ---------------- storage ---------------- */
  function readStore(key) {
    try { return window.localStorage.getItem(PREFIX + key) || ''; }
    catch (e) { return ''; }
  }
  function writeStore(key, value) {
    try { window.localStorage.setItem(PREFIX + key, String(value)); }
    catch (e) { /* private mode / quota — chat simply won't persist */ }
  }
  function deleteStore(key) {
    try { window.localStorage.removeItem(PREFIX + key); }
    catch (e) { }
  }

  /* ---------------- clipboard ---------------- */
  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (e) { }
  }
  function copyText(text) {
    text = text == null ? '' : String(text);
    if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () { legacyCopy(text); });
    } else {
      legacyCopy(text);
    }
  }

  /* ---------------- share ---------------- */
  function shareText(text) {
    text = text == null ? '' : String(text);
    if (navigator.share) {
      navigator.share({ title: 'Saathi', text: text }).catch(function () { });
      return;
    }
    // Fallback: hand the conversation over as a file download.
    try {
      var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'saathi-chat.txt';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    } catch (e) { }
  }

  /* ---------------- toast (kept for parity; the UI has its own) ---------------- */
  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = String(msg == null ? '' : msg);
    el.classList.add('show');
    clearTimeout(el._bridgeT);
    el._bridgeT = setTimeout(function () { el.classList.remove('show'); }, 1800);
  }

  /* ---------------- HTTP + streaming ---------------- */
  function hasHeader(headers, name) {
    var lower = name.toLowerCase();
    for (var k in headers) if (Object.prototype.hasOwnProperty.call(headers, k)) {
      if (k.toLowerCase() === lower) return true;
    }
    return false;
  }
  function errorMessage(status, text) {
    var msg = '';
    try {
      var j = JSON.parse(text);
      msg = (j.error && (j.error.message || j.error.type)) || j.message || '';
    } catch (e) { msg = (text || '').slice(0, 300); }
    if (!msg) msg = 'HTTP ' + status;
    return msg;
  }

  function httpStart(callId, method, url, headersJson, body, stream) {
    method = (method || 'GET').toUpperCase();
    var headers = {};
    if (headersJson) { try { headers = JSON.parse(headersJson) || {}; } catch (e) { headers = {}; } }

    // Anthropic refuses browser-originated calls unless this header is present.
    if (/^https?:\/\/api\.anthropic\.com/i.test(url) &&
        !hasHeader(headers, 'anthropic-dangerous-direct-browser-access')) {
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
    }

    var ctrl = ('AbortController' in window) ? new AbortController() : null;
    inflight[callId] = ctrl;

    var opts = { method: method, headers: headers, cache: 'no-store' };
    if (ctrl) opts.signal = ctrl.signal;
    if (body && method !== 'GET') opts.body = body;

    fetch(url, opts).then(function (res) {
      if (stream && res.ok && res.body && res.body.getReader) {
        if (window.__saathiHttpStatus) window.__saathiHttpStatus(callId, res.status);
        var reader = res.body.getReader();
        var dec = new TextDecoder('utf-8');
        var buf = '';
        // Feed the page whole lines, exactly like HttpEngine.readLine() did.
        var pump = function () {
          return reader.read().then(function (r) {
            if (r.done) {
              if (buf.length && window.__saathiHttpChunk) window.__saathiHttpChunk(callId, buf);
              buf = '';
              delete inflight[callId];
              if (window.__saathiHttpDone) window.__saathiHttpDone(callId);
              return;
            }
            buf += dec.decode(r.value, { stream: true });
            var idx;
            while ((idx = buf.indexOf('\n')) >= 0) {
              var line = buf.slice(0, idx);
              buf = buf.slice(idx + 1);
              if (window.__saathiHttpChunk) window.__saathiHttpChunk(callId, line + '\n');
            }
            return pump();
          });
        };
        return pump();
      }

      return res.text().then(function (text) {
        delete inflight[callId];
        if (stream && !res.ok) {
          // The native engine reported a non-2xx chat response through
          // __saathiHttpResult, which the chat path never listens for — the UI would
          // hang. Report it as an error so the message shows and streaming stops.
          if (window.__saathiHttpError) window.__saathiHttpError(callId, errorMessage(res.status, text));
          return;
        }
        if (window.__saathiHttpResult) window.__saathiHttpResult(callId, res.status, text);
      });
    }).catch(function (err) {
      delete inflight[callId];
      if (err && err.name === 'AbortError') return;   // user pressed Stop
      var msg = (err && err.message) || String(err);
      if (/Failed to fetch|NetworkError|Load failed|Network request failed/i.test(msg)) {
        msg = 'Could not reach this endpoint from the browser. It may be offline, blocked by CORS, ' +
              'or the URL / API key may be wrong.';
      }
      if (window.__saathiHttpError) window.__saathiHttpError(callId, msg);
    });
  }

  function httpCancel(callId) {
    var c = inflight[callId];
    if (c) { try { c.abort(); } catch (e) { } }
    delete inflight[callId];
  }

  /* ---------------- the bridge object ---------------- */
  window.Android = {
    systemLocale: function () { return navigator.language || 'en'; },
    readStore: readStore,
    writeStore: writeStore,
    deleteStore: deleteStore,
    copyText: copyText,
    shareText: shareText,
    toast: toast,
    httpStart: httpStart,
    httpCancel: httpCancel
  };

  /* ---------------- browser chrome: Back button + Esc ---------------- */
  function appBack() {
    if (window.Saathi && typeof window.Saathi.onBack === 'function') window.Saathi.onBack();
  }

  function wire() {
    // Click the dimmed area around a centred panel (desktop) to dismiss it.
    Array.prototype.forEach.call(document.querySelectorAll('.overlay'), function (ov) {
      ov.addEventListener('mousedown', function (e) { if (e.target === ov) appBack(); });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') appBack();
    });

    // Mirror the app's own back handling onto browser history, so the Back button
    // (and the Android-style back gesture) closes a panel instead of leaving the app.
    var depth = 0;
    var suppress = false;

    window.addEventListener('popstate', function () {
      if (depth <= 0) return;
      depth--;
      suppress = true;
      appBack();
      setTimeout(function () { suppress = false; }, 0);
    });

    function openState() {
      var s = [];
      var d = document.getElementById('drawer');
      if (d && d.classList.contains('open')) s.push('drawer');
      var so = document.getElementById('settingsOverlay');
      if (so && so.classList.contains('open')) s.push('settings');
      var eo = document.getElementById('editorOverlay');
      if (eo && eo.classList.contains('open')) s.push('editor');
      if (document.getElementById('dynSheet')) s.push('sheet');
      return s;
    }

    var prev = openState();
    var scheduled = false;
    function reconcile() {
      scheduled = false;
      var cur = openState();
      if (!suppress) {
        if (cur.length > prev.length) {
          depth++;
          try { history.pushState({ saathi: depth }, ''); } catch (e) { }
        } else if (cur.length < prev.length && depth > 0) {
          depth--;
        }
      }
      prev = cur;
    }
    function schedule() {
      if (scheduled) return;
      scheduled = true;
      (window.requestAnimationFrame || function (fn) { setTimeout(fn, 16); })(reconcile);
    }

    var mo = new MutationObserver(schedule);
    ['drawer', 'settingsOverlay', 'editorOverlay'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) mo.observe(el, { attributes: true, attributeFilter: ['class'] });
    });
    mo.observe(document.body, { childList: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
