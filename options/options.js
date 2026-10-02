import { DEFAULT_SETTINGS, PROMPT_PLACEHOLDERS, loadSettings, saveSetting } from '../lib/settings.js';

const $ = (id) => document.getElementById(id);
const settings = await loadSettings();
let savedTimer;

async function save(key, value) {
  await saveSetting(key, value);
  $('saved').textContent = 'Saved';
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => ($('saved').textContent = ''), 1500);
}

for (const radio of document.querySelectorAll('input[name="delivery"]')) {
  radio.checked = radio.value === settings.delivery;
  radio.addEventListener('change', () => save('delivery', radio.value));
}

for (const key of ['timestamps', 'includeDescription', 'autoStartOnPaste', 'autoSend']) {
  $(key).checked = settings[key];
  $(key).addEventListener('change', () => save(key, $(key).checked));
}

$('preferredLang').value = settings.preferredLang;
$('preferredLang').addEventListener('change', () => {
  const value = $('preferredLang').value.trim().toLowerCase() || DEFAULT_SETTINGS.preferredLang;
  $('preferredLang').value = value;
  save('preferredLang', value);
});

const prompt = $('promptTemplate');
prompt.value = settings.promptTemplate;
let promptTimer;
prompt.addEventListener('input', () => {
  clearTimeout(promptTimer);
  promptTimer = setTimeout(() => save('promptTemplate', prompt.value.trim() ? prompt.value : DEFAULT_SETTINGS.promptTemplate), 400);
});
$('reset-prompt').addEventListener('click', () => {
  prompt.value = DEFAULT_SETTINGS.promptTemplate;
  save('promptTemplate', prompt.value);
});

for (const [key, description] of Object.entries(PROMPT_PLACEHOLDERS)) {
  $('placeholders').append(
    Object.assign(document.createElement('dt'), { textContent: `{{${key}}}` }),
    Object.assign(document.createElement('dd'), { textContent: description })
  );
}
