import { loadSettings } from '../lib/settings.js';
import { CHAT_SITES, siteForUrl } from '../lib/sites.js';
import { parseVideoId } from '../lib/youtube.js';

const $ = (id) => document.getElementById(id);
const input = $('url');
const statusEl = $('status');

const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
const site = siteForUrl(activeTab?.url);
const settings = await loadSettings();
let busy = false;

function setStatus(text, kind) {
  statusEl.hidden = false;
  statusEl.className = `status ${kind}`;
  statusEl.textContent = text;
}

function setBusy(value) {
  busy = value;
  input.disabled = value;
  for (const el of document.querySelectorAll('button.btn, button.video')) el.disabled = value;
}

/** @param {{url: string, newChat?: 'chatgpt'|'claude'}} job */
function start({ url, newChat }) {
  if (busy) return;
  if (!parseVideoId(url)) {
    setStatus("That doesn't look like a YouTube video link. Paste a youtube.com or youtu.be URL.", 'error');
    input.focus();
    return;
  }

  setBusy(true);
  setStatus('Starting…', 'busy');
  const port = chrome.runtime.connect({ name: 'summarize' });
  port.onMessage.addListener((msg) => {
    if (msg.type === 'progress') setStatus(msg.text, 'busy');
    if (msg.type === 'done') {
      const r = msg.result;
      const how = r.sent ? 'sent' : r.attached ? 'attached' : 'pasted';
      setStatus(`Done: ${r.words} words (${r.language}) ${how} in ${r.siteName}.`, 'done');
      port.disconnect();
      setTimeout(() => window.close(), 1500);
    }
    if (msg.type === 'error') {
      setStatus(msg.message, 'error');
      setBusy(false);
      port.disconnect();
    }
  });
  port.postMessage({ url: url.trim(), tabId: site ? activeTab.id : undefined, newChat });
}

function button(label, className, onClick, type = 'button') {
  const b = document.createElement('button');
  b.type = type;
  b.className = className;
  b.textContent = label;
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

// ---- where the transcript goes ---------------------------------------------

if (site) {
  $('target').innerHTML = `Adding to this <strong></strong> chat.`;
  $('target').querySelector('strong').textContent = site.name;
  $('actions').append(button(`Summarise in ${site.name}`, 'btn', null, 'submit'));
} else {
  $('target').textContent = 'Not on ChatGPT or Claude. Start a new chat in:';
  for (const s of Object.values(CHAT_SITES)) {
    $('actions').append(button(s.name, 'btn secondary', () => start({ url: input.value, newChat: s.id })));
  }
}

$('form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (site) start({ url: input.value });
  else setStatus('Choose ChatGPT or Claude below the link.', 'error');
});

input.addEventListener('paste', (e) => {
  const text = e.clipboardData.getData('text/plain').trim();
  if (!site || !settings.autoStartOnPaste || !parseVideoId(text)) return;
  e.preventDefault();
  input.value = text;
  start({ url: text });
});

// ---- YouTube videos already open in other tabs ------------------------------

const PLAY_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M8 5.5v13l10-6.5z"/></svg>';

const youtubeTabs = await chrome.tabs.query({ url: 'https://www.youtube.com/*' });
const seen = new Set();
const openVideos = youtubeTabs
  .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))
  .map((t) => ({ id: parseVideoId(t.url), url: t.url, title: t.title }))
  .filter((v) => v.id && !seen.has(v.id) && seen.add(v.id))
  .slice(0, 4);

for (const v of openVideos) {
  const title = v.title.replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube$/, '');
  const b = button('', 'video', () => {
    input.value = v.url;
    if (site) start({ url: v.url });
    else input.focus();
  });
  b.innerHTML = PLAY_ICON;
  b.append(Object.assign(document.createElement('span'), { textContent: title }));
  b.title = title;
  const li = document.createElement('li');
  li.append(b);
  $('open-video-list').append(li);
}
$('open-videos').hidden = openVideos.length === 0;

// ---- footer -----------------------------------------------------------------

const summary = [
  settings.delivery === 'inline' ? 'Pastes text' : 'Attaches .txt',
  settings.timestamps ? 'timestamps' : 'no timestamps',
  settings.autoSend ? 'auto-send' : 'you press send',
].join(' · ');
const settingsLink = Object.assign(document.createElement('a'), { textContent: 'Settings', href: '#' });
settingsLink.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
$('footer').append(Object.assign(document.createElement('span'), { textContent: summary }), settingsLink);
$('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());

input.focus();
