/* Internationalisation. English is the base; every other language is merged in
   from i18n-data.js. The active language follows the phone's system language by
   default, or an explicit choice from Settings → Language. */
(function () {
  var STR = {
    en: {
      'app.name': 'Saathi',
      'nav.newChat': 'New chat',
      'nav.chats': 'Chats',
      'nav.settings': 'Settings',
      'nav.export': 'Export chats',
      'nav.loadMore': 'Load more',
      'nav.rename': 'Rename',
      'nav.delete': 'Delete',
      'nav.share': 'Share',
      'chat.placeholder': 'Message Saathi…',
      'chat.send': 'Send',
      'chat.stop': 'Stop',
      'chat.regenerate': 'Regenerate',
      'chat.edit': 'Edit',
      'chat.copy': 'Copy',
      'chat.emptyTitle': 'How can I help?',
      'chat.emptyHint': 'Add a provider in Settings, then ask anything. Your chats stay on this device.',
      'chat.attach': 'Attach file',
      'chat.attachUnsupported': 'Only images and text files can be attached',
      'chat.visionHint': 'This model may not accept images',
      'msg.you': 'You',
      'msg.assistant': 'Saathi',
      'settings.providers': 'Providers',
      'settings.providersSub': 'Add API keys and endpoints',
      'settings.models': 'Models',
      'settings.modelsSub': 'Choose the default model',
      'settings.systemPrompt': 'System prompt',
      'settings.systemPromptSub': 'Instructions applied to every chat',
      'settings.appearance': 'Appearance',
      'settings.appearanceSub': 'Theme, accent and text size',
      'settings.language': 'Language',
      'settings.languageSub': 'App display language',
      'settings.clearChats': 'Clear all chats',
      'settings.clearChatsSub': 'Delete every conversation on this device',
      'providers.title': 'Providers',
      'providers.add': 'Add provider',
      'providers.none': 'No providers yet. Add one to start chatting.',
      'providers.type': 'Provider type',
      'providers.name': 'Display name',
      'providers.baseUrl': 'Base URL',
      'providers.apiKey': 'API key',
      'providers.fetchModels': 'Fetch models',
      'providers.fetching': 'Fetching…',
      'providers.models': 'models',
      'providers.modelsFound': 'models found',
      'providers.noModels': 'No models returned',
      'models.title': 'Models',
      'models.choose': 'Choose model',
      'appearance.title': 'Appearance',
      'appearance.theme': 'Theme',
      'appearance.themeSystem': 'System',
      'appearance.themeLight': 'Light',
      'appearance.themeDark': 'Dark',
      'appearance.accent': 'Accent colour',
      'appearance.fontSize': 'Text size',
      'language.title': 'Language',
      'language.system': 'System default',
      'language.hint': 'Follow your phone language, or pick one below.',
      'prompt.hint': 'This is sent to the model before your messages.',
      'edit.title': 'Edit message',
      'common.save': 'Save',
      'common.cancel': 'Cancel',
      'common.delete': 'Delete',
      'common.confirm': 'Confirm',
      'confirm.deleteChat': 'Delete this chat?',
      'confirm.deleteProvider': 'Delete this provider?',
      'confirm.clearChats': 'Delete all chats?',
      'export.title': 'Export chats',
      'export.hint': 'Choose the chats to export. They are saved as a JSON file.',
      'export.action': 'Export',
      'export.empty': 'Select at least one chat',
      'toast.copied': 'Copied',
      'toast.saved': 'Saved',
      'error.title': 'Error',
      'error.noProvider': 'Add a provider first',
      'error.noModel': 'Choose a model first',
      'error.noKey': 'Add an API key for this provider',
      'about.madeBy': 'Made by Suryanarayan Panda'
    }
  };

  if (window.SAATHI_I18N_EXTRA) {
    for (var code in window.SAATHI_I18N_EXTRA) {
      if (Object.prototype.hasOwnProperty.call(window.SAATHI_I18N_EXTRA, code)) {
        STR[code] = window.SAATHI_I18N_EXTRA[code];
      }
    }
  }

  var lang = 'en';
  function t(key) {
    var dict = STR[lang] || {};
    if (dict[key] != null && dict[key] !== '') return dict[key];
    var en = STR.en;
    return en[key] != null ? en[key] : key;
  }
  function setLanguage(code) { lang = code || 'en'; }
  function register(code, dict) { STR[code] = dict; }

  window.SaathiI18n = { t: t, setLanguage: setLanguage, register: register, STR: STR };
})();
