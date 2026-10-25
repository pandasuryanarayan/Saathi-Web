/* Provider catalogue + request building + streaming parsers.
   All provider-specific knowledge lives here; the app core only deals with
   {url, headers, body} and streams of {text, reasoning, done, error}. */
(function () {
  var TYPES = [
    { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', protocol: 'openai',
      models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'o3-mini'] },
    { id: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com', protocol: 'anthropic',
      models: ['claude-sonnet-4-20250514', 'claude-3-7-sonnet-20250219', 'claude-3-5-haiku-20241022'] },
    { id: 'gemini', name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com', protocol: 'google',
      models: ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-pro', 'gemini-1.5-flash'] },
    { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', protocol: 'openai',
      models: ['deepseek-chat', 'deepseek-reasoner'] },
    { id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', protocol: 'openai',
      models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'] },
    { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', protocol: 'openai',
      models: ['openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet', 'google/gemini-flash-1.5'] },
    { id: 'qwen', name: 'Qwen (DashScope)', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', protocol: 'openai',
      models: ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen2.5-72b-instruct'] },
    { id: 'ollama', name: 'Ollama', baseUrl: 'http://localhost:11434/v1', protocol: 'openai',
      models: ['llama3.1', 'qwen2.5', 'mistral'] },
    { id: 'custom', name: 'Custom', baseUrl: '', protocol: 'openai', models: [] }
  ];

  function typeById(id) {
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i].id === id) return TYPES[i];
    return TYPES[TYPES.length - 1];
  }

  function trimSlash(u) { return (u || '').replace(/\/+$/, ''); }

  /* ---- attachments: images become multimodal blocks, text files are inlined ---- */
  function textOf(m) {
    var out = m.content || '';
    (m.attachments || []).forEach(function (a) {
      if (a.kind === 'text') out += '\n\n' + (a.name || 'file') + ':\n```\n' + (a.text || '') + '\n```';
    });
    return out;
  }
  function imagesOf(m) {
    return (m.attachments || []).filter(function (a) { return a.kind === 'image'; });
  }
  function dataUrlParts(dataUrl) {
    var i = (dataUrl || '').indexOf(',');
    if (i < 0) return { mime: 'image/png', data: '' };
    var meta = dataUrl.substring(0, i);
    var data = dataUrl.substring(i + 1);
    var mime = meta.substring(meta.indexOf(':') + 1, meta.indexOf(';'));
    return { mime: mime || 'image/png', data: data };
  }
  function openAiContent(m) {
    var imgs = imagesOf(m), text = textOf(m);
    if (!imgs.length) return text;
    var arr = [];
    if (text) arr.push({ type: 'text', text: text });
    imgs.forEach(function (a) { arr.push({ type: 'image_url', image_url: { url: a.dataUrl } }); });
    return arr;
  }
  function anthropicContent(m) {
    var imgs = imagesOf(m), text = textOf(m);
    if (!imgs.length) return text;
    var arr = [];
    imgs.forEach(function (a) {
      var q = dataUrlParts(a.dataUrl);
      arr.push({ type: 'image', source: { type: 'base64', media_type: q.mime, data: q.data } });
    });
    if (text) arr.push({ type: 'text', text: text });
    return arr;
  }
  function googleParts(m) {
    var parts = [], text = textOf(m);
    if (text) parts.push({ text: text });
    imagesOf(m).forEach(function (a) {
      var q = dataUrlParts(a.dataUrl);
      parts.push({ inlineData: { mimeType: q.mime, data: q.data } });
    });
    if (!parts.length) parts.push({ text: '' });
    return parts;
  }

  /* Best-effort guess at whether a model accepts image input. Used only for a UI
     hint; the request is always sent and the provider decides. */
  var VISION_RE = /gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-4-vision|gpt-5|(^|[-_\/])o[134]([-_.]|$)|claude|gemini|llava|vision|pixtral|internvl|minicpm|moondream|smolvlm|gemma-?3|llama-?4|[-_]vl([-_.]|$)|vl[-_.]|deepseek[-\w]*vl|glm-?4v/i;
  function isVisionModel(model) { return VISION_RE.test(model || ''); }

  function buildChat(provider, model, messages, systemPrompt, stream) {
    var proto = provider.protocol || 'openai';
    var base = trimSlash(provider.baseUrl);
    var key = provider.apiKey || '';

    if (proto === 'anthropic') {
      var body = {
        model: model,
        max_tokens: 4096,
        messages: messages.map(function (m) { return { role: m.role, content: anthropicContent(m) }; }),
        stream: !!stream
      };
      if (systemPrompt) body.system = systemPrompt;
      return {
        url: base + '/v1/messages',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify(body)
      };
    }

    if (proto === 'google') {
      var contents = messages.map(function (m) {
        return { role: m.role === 'assistant' ? 'model' : 'user', parts: googleParts(m) };
      });
      var gbody = { contents: contents };
      if (systemPrompt) gbody.systemInstruction = { parts: [{ text: systemPrompt }] };
      var url = base + '/v1beta/models/' + encodeURIComponent(model) +
        ':streamGenerateContent?alt=sse&key=' + encodeURIComponent(key);
      return { url: url, headers: { 'content-type': 'application/json' }, body: JSON.stringify(gbody) };
    }

    // OpenAI-compatible (openai, deepseek, groq, openrouter, qwen, ollama, custom)
    var msgs = [];
    if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt });
    messages.forEach(function (m) { msgs.push({ role: m.role, content: openAiContent(m) }); });
    var headers = { 'Content-Type': 'application/json' };
    if (key) headers['Authorization'] = 'Bearer ' + key;
    if (provider.id === 'openrouter') {
      headers['HTTP-Referer'] = 'https://saathi.app';
      headers['X-Title'] = 'Saathi';
    }
    return {
      url: base + '/chat/completions',
      headers: headers,
      body: JSON.stringify({ model: model, messages: msgs, stream: !!stream })
    };
  }

  function buildModels(provider) {
    var proto = provider.protocol || 'openai';
    var base = trimSlash(provider.baseUrl);
    var key = provider.apiKey || '';
    if (proto === 'anthropic') {
      return { url: base + '/v1/models?limit=100', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } };
    }
    if (proto === 'google') {
      return { url: base + '/v1beta/models?key=' + encodeURIComponent(key), headers: {} };
    }
    var headers = {};
    if (key) headers['Authorization'] = 'Bearer ' + key;
    return { url: base + '/models', headers: headers };
  }

  function parseModels(provider, body) {
    var proto = provider.protocol || 'openai';
    var json;
    try { json = JSON.parse(body); } catch (e) { return []; }
    if (proto === 'google') {
      return (json.models || []).map(function (m) { return (m.name || '').replace(/^models\//, ''); })
        .filter(function (n) { return n; });
    }
    return (json.data || []).map(function (m) { return m.id; }).filter(function (n) { return n; });
  }

  function parseError(status, body) {
    var msg = '';
    try {
      var j = JSON.parse(body);
      msg = (j.error && (j.error.message || j.error.type)) || j.message || '';
    } catch (e) { msg = (body || '').slice(0, 300); }
    if (!msg) msg = 'HTTP ' + status;
    return msg;
  }

  /* Incremental SSE / NDJSON parser. push() returns an array of events. */
  function createStreamParser(provider) {
    var proto = provider.protocol || 'openai';
    var buffer = '';
    var anthropicEvent = '';
    var googleDone = false;

    function handleData(data) {
      if (data === '[DONE]') return { done: true };
      var json;
      try { json = JSON.parse(data); } catch (e) { return null; }
      if (json.error) return { error: (json.error.message || json.error.type || 'provider error') };

      if (proto === 'anthropic') {
        if (json.type === 'content_block_delta' && json.delta) {
          if (json.delta.type === 'text_delta') return { text: json.delta.text || '' };
          if (json.delta.type === 'thinking_delta') return { reasoning: json.delta.thinking || '' };
        }
        if (json.type === 'message_stop') return { done: true };
        return null;
      }

      if (proto === 'google') {
        var cand = (json.candidates || [])[0];
        if (!cand) return null;
        var parts = (cand.content && cand.content.parts) || [];
        var txt = '';
        for (var i = 0; i < parts.length; i++) if (parts[i].text) txt += parts[i].text;
        var out = { text: txt };
        if (cand.finishReason) out.done = true;
        return out;
      }

      // openai
      var choice = (json.choices || [])[0];
      if (!choice) return null;
      var d = choice.delta || {};
      var ev = {};
      if (d.content) ev.text = d.content;
      if (d.reasoning_content) ev.reasoning = d.reasoning_content;
      if (choice.finish_reason) ev.done = true;
      return (ev.text || ev.reasoning || ev.done) ? ev : null;
    }

    return {
      push: function (chunk) {
        buffer += chunk;
        var events = [];
        var idx;
        while ((idx = buffer.indexOf('\n')) >= 0) {
          var line = buffer.slice(0, idx).replace(/\r$/, '');
          buffer = buffer.slice(idx + 1);
          if (line === '') continue;
          if (line.indexOf(':') === 0) continue; // SSE comment / ping
          if (line.indexOf('event:') === 0) { anthropicEvent = line.slice(6).trim(); continue; }
          var dataLine = null;
          if (line.indexOf('data:') === 0) dataLine = line.slice(5).trim();
          else if (proto === 'openai' && line.charAt(0) === '{') dataLine = line; // NDJSON (ollama-native)
          if (dataLine === null) continue;
          var ev = handleData(dataLine);
          if (ev) events.push(ev);
        }
        return events;
      }
    };
  }

  window.SaathiProviders = {
    TYPES: TYPES,
    typeById: typeById,
    buildChat: buildChat,
    buildModels: buildModels,
    parseModels: parseModels,
    parseError: parseError,
    isVisionModel: isVisionModel,
    createStreamParser: createStreamParser
  };
})();
