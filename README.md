# Saathi — web version

A browser build of the Saathi Android app. It is the **same UI** as the app
(the HTML/CSS/JS that ran inside the app's WebView), with the native Android
layer replaced by ordinary browser APIs, plus a responsive layout so it works
on a phone, a tablet and a desktop.

Bring your own key: you add your own provider API keys, Saathi talks to those
endpoints directly, and your conversations are stored only in this browser.
There is no server, no account and no relay.

---

## Run it

The app is a static site — no build step, no dependencies.

```bash
# from this folder
python3 -m http.server 8000
# then open http://localhost:8000
```

Or with Node:

```bash
npx serve .        # or:  npx http-server -p 8000
```

Then open **Settings → Providers → Add provider**, pick a provider, paste your
API key, and (optionally) press **Fetch models**.

> Open it over `http://localhost` or `https://`, not by double-clicking the
> file. A `file://` page has an opaque origin, which breaks clipboard access and
> some providers' CORS checks.

To host it, just upload the whole folder to any static host (GitHub Pages,
Netlify, Cloudflare Pages, S3, an nginx directory — anything that serves files).

### Single-file build

`saathi-web.html` is the same app with the CSS and JS inlined, for when you want
one file to carry around or drop on a host. Same rules apply: serve it over
http(s).

---

## What changed from the Android app

The Android app is a thin native shell (one `Activity` + a `WebView`) around a
web UI. Almost everything — providers, request building, SSE parsing, the
conversation tree, Markdown, theming, all 14 languages — lived in the web layer
and is **unchanged**. Only the small native surface was re-implemented:

| Android (native) | Web |
| --- | --- |
| `Bridge.readStore` / `writeStore` / `deleteStore` (app-private JSON files) | `localStorage` (namespaced `saathi:`) |
| `Bridge.systemLocale` (device locale) | `navigator.language` |
| `Bridge.copyText` (ClipboardManager) | `navigator.clipboard`, with a legacy fallback |
| `Bridge.shareText` (ACTION_SEND chooser) | Web Share API, else a file download |
| `HttpEngine` (HttpURLConnection + line-by-line SSE) | `fetch()` with a streaming body reader |
| `MainActivity.onBackPressed` | browser Back button + `Esc` |

New in the web build:

- **Responsive layout.** On phones nothing changes: the conversation list is an
  overlay drawer and Settings slides in full-screen. At **≥ 960px** the list
  becomes a permanent sidebar, the message column is centred and capped for
  comfortable reading, and Settings / editor panels become centred dialogs over
  a dimmed backdrop. A 720px breakpoint centres the column on small tablets.
- **Export saves a real file.** *Export chats* hands the bridge a JSON document.
  On Android that goes to the share sheet; in a browser it downloads as
  `saathi-chats-YYYY-MM-DD.json` (`application/json`), which is what you want if
  you are keeping or moving a backup. Sharing a single chat as text still uses
  the Web Share API where available, and otherwise downloads a `.txt`.
- **Browser chrome.** Back closes a panel instead of leaving the page; `Esc`
  does the same; clicking the dimmed area outside a dialog dismisses it.
- **Anthropic header.** Browsers are refused by `api.anthropic.com` unless the
  request carries `anthropic-dangerous-direct-browser-access: true`. The bridge
  adds it automatically for that host.
- **Honest error surfacing.** If a chat request comes back `4xx`/`5xx`, the
  provider's error message is shown and streaming stops — it will not hang.
- **Favicon + install meta**, so it looks right in a tab and can be added to a
  phone home screen.

Everything added in the latest app update is present and behaves the same:
**Export chats** (a checkbox picker, 10 at a time, that writes a JSON backup) and
the **Load more** paging on the conversation list (10 chats at a time).

---

## Export format

*Export chats* writes one JSON file containing the chats you ticked, newest
first. Each chat holds the active branch of its conversation tree, so every
message you can currently see is included, in order:

```json
{
  "app": "Saathi",
  "schema": 1,
  "exportedAt": "2026-10-26T10:30:00.000Z",
  "chatCount": 2,
  "chats": [
    {
      "id": "…", "title": "…", "createdAt": 0, "updatedAt": 0,
      "providerId": "…", "model": "…", "systemPrompt": "…",
      "messages": [
        { "role": "user", "content": "…", "ts": 0 },
        { "role": "assistant", "content": "…", "ts": 0, "model": "…" }
      ]
    }
  ]
}
```

Alternate branches you did not have selected are not included, and image
attachments are exported as their name/type/size rather than as image data — the
same as the Android app.

---

## Providers and CORS — read this first

Because the browser calls the provider directly, the provider has to allow it.
Support varies and can change; the situation at the time of writing:

- **Works from the browser:** OpenRouter, OpenAI, Groq, Google Gemini, DeepSeek,
  Anthropic (the bridge adds the required header), and any OpenAI-compatible
  endpoint that sends `Access-Control-Allow-Origin` (including many self-hosted
  gateways).
- **Ollama on your own machine** needs the origin allowed, e.g. start it with
  `OLLAMA_ORIGINS=* ollama serve`. It also must be `http://localhost:11434`; if
  you serve Saathi over `https`, the browser blocks the plain-`http` call as
  mixed content — serve Saathi over `http://localhost` instead.
- **Custom endpoints** work if they return CORS headers.

If a provider refuses, you will see
*"Could not reach this endpoint from the browser…"*. That is a CORS or network
refusal, not a bug in the key. Some providers send CORS headers on success but
not on errors, which makes a bad key look like a network failure.

**Your key is in your browser.** It is kept in `localStorage` on your device and
sent only to the provider you configured — but anyone with access to the device
or to a hosted copy of this app's origin can read it. Use keys with a spend
limit, and don't deploy a shared public copy with your key in it.

---

## Storage

Everything is in this browser's `localStorage` under the `saathi:` prefix
(`saathi:settings`, `saathi:conversations`). Clearing site data deletes your
chats and keys — use *Export chats* first if you want a backup. Conversations are
stored as the same branch-preserving node tree the app used, so editing or
regenerating a message still keeps every alternative under the `‹ n/m ›`
switcher.

---

## Files

```
index.html          UI shell
css/style.css       theming + layout, incl. the responsive rules at the end
js/i18n-data.js     the 13 Indian-language string tables
js/i18n.js          string store + lookup
js/markdown.js      dependency-free Markdown renderer
js/icons.js         inline SVG icon set
js/providers.js     provider catalogue, request builders, SSE parsers
js/tree.js          conversation-tree logic
js/web-bridge.js    the browser replacement for the native bridge  (new)
js/app.js           app core: state, rendering, settings, export, streaming
```

The rest of `js/` and the whole of `css/style.css` (above the responsive
section) are the Android app's files, unmodified, so the two versions stay in
step.

---

## Tests

The Android project's five Node suites (jsdom) pass unchanged against this
build — 104 app checks plus 20 for paging and export — and the bridge has its
own checks (streaming, line reassembly across chunk boundaries, error paths,
cancel, the Anthropic header, storage, export-to-file).

Made by Suryanarayan Panda.
