// Injected into ChatGPT / Claude on demand. Attaches the transcript and writes the
// prompt into the message box, the same way a person pasting would.
(() => {
  if (globalThis.__ytsChatInject) return;
  globalThis.__ytsChatInject = true;

  const SITES = {
    chatgpt: {
      name: 'ChatGPT',
      editor: [
        '#prompt-textarea[contenteditable="true"]',
        'form div.ProseMirror[contenteditable="true"]',
        'div.ProseMirror[contenteditable="true"]',
        '[role="textbox"][contenteditable="true"]',
        'form textarea',
      ],
      send: [
        'button[data-testid="send-button"]',
        '#composer-submit-button',
        'form button[aria-label="Send" i]',
        'form button[type="submit"][aria-label*="Send" i]',
      ],
    },
    claude: {
      name: 'Claude',
      // Claude briefly renders a static <textarea> before the real editor hydrates, so no textarea here.
      editor: [
        '[data-testid="chat-input"][contenteditable="true"]',
        'div.ProseMirror[contenteditable="true"]',
        '[role="textbox"][contenteditable="true"]',
      ],
      send: ['button[aria-label="Send message" i]', 'fieldset button[aria-label*="Send" i]'],
    },
  };
  const site = location.hostname.endsWith('claude.ai') ? SITES.claude : SITES.chatgpt;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isVisible = (el) => el.getClientRects().length > 0;

  async function waitFor(fn, timeoutMs, intervalMs = 250) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = fn();
      if (value || Date.now() > deadline) return value;
      await sleep(intervalMs);
    }
  }

  function findFirst(selectors, filter = () => true) {
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) if (filter(el)) return el;
    }
    return null;
  }

  const findEditor = () => findFirst(site.editor, isVisible);

  function composerOf(editor) {
    let el = editor.closest('form, fieldset');
    if (el) return el;
    el = editor;
    for (let i = 0; i < 5 && el.parentElement; i++) el = el.parentElement;
    return el;
  }

  // ---- attaching the file ---------------------------------------------------

  function acceptsText(input) {
    const accept = input.accept.trim();
    return !accept || accept.split(',').some((a) => /^(\*|\*\/\*|text\/.*|\.txt)$/.test(a.trim()));
  }

  function findFileInput(editor) {
    const inputs = [...document.querySelectorAll('input[type="file"]')].filter(acceptsText);
    return inputs.find((i) => composerOf(editor).contains(i)) ?? inputs[0] ?? null;
  }

  const ATTACH_METHODS = [
    function viaFileInput(editor, dataTransfer) {
      const input = findFileInput(editor);
      if (!input) return false;
      input.files = dataTransfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    function viaPaste(editor, dataTransfer) {
      editor.focus();
      editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dataTransfer, bubbles: true, cancelable: true }));
      return true;
    },
    function viaDrop(editor, dataTransfer) {
      for (const type of ['dragenter', 'dragover', 'drop']) {
        editor.dispatchEvent(new DragEvent(type, { dataTransfer, bubbles: true, cancelable: true }));
      }
      return true;
    },
  ];

  /** Snapshots the composer; the returned check reports whether an attachment card has appeared since. */
  function attachmentProbe(editor, label) {
    const stem = label.replace(/\.txt$/i, '').trim().slice(0, 18);
    const measure = () => {
      const composer = composerOf(editor);
      let mentions = 0;
      const walker = document.createTreeWalker(composer, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!editor.contains(n) && n.nodeValue.includes(stem)) mentions++;
      }
      for (const el of composer.querySelectorAll('[title], [aria-label]')) {
        if ((el.title + el.getAttribute('aria-label')).includes(stem)) mentions++;
      }
      return { mentions, nodes: composer.querySelectorAll('*').length - editor.querySelectorAll('*').length };
    };
    const before = measure();
    return () => {
      const now = measure();
      return now.mentions > before.mentions || now.nodes >= before.nodes + 4;
    };
  }

  async function attachFile(editor, file) {
    for (const method of ATTACH_METHODS) {
      const appeared = attachmentProbe(editor, file.name);
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      try {
        if (!method(editor, dataTransfer)) continue;
      } catch (err) {
        console.warn('[YT Summariser] attach method failed:', method.name, err);
        continue;
      }
      if (await waitFor(appeared, 5000, 200)) return true;
    }
    return false;
  }

  // ---- writing text ---------------------------------------------------------

  const normalize = (s) => s.replace(/\s+/g, ' ').trim();

  function placeCaretAtEnd(editor) {
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  async function insertText(editor, text) {
    if (editor instanceof HTMLTextAreaElement) {
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setValue.call(editor, editor.value ? `${editor.value}\n\n${text}` : text);
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    placeCaretAtEnd(editor);
    const lengthBefore = normalize(editor.innerText).length;
    // Both sites may turn a long paste into an attachment card instead of editor text.
    const becameCard = attachmentProbe(editor, text);

    // A synthetic paste goes through the editor's own paste handling, which keeps line breaks.
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', text);
    editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dataTransfer, bubbles: true, cancelable: true }));
    const handled = () => normalize(editor.innerText).length > lengthBefore || becameCard();
    if (await waitFor(handled, 1500, 100)) return;

    // The site ignored the synthetic paste: type it instead.
    placeCaretAtEnd(editor);
    text.split('\n').forEach((line, i) => {
      if (i) document.execCommand('insertParagraph');
      if (line) document.execCommand('insertText', false, line);
    });
  }

  // ---- sending --------------------------------------------------------------

  async function clickSendWhenReady() {
    await sleep(1000);
    const deadline = Date.now() + 120_000;
    let lastSeen = Date.now();
    while (Date.now() < deadline) {
      const button = findFirst(site.send, isVisible);
      if (button && !button.disabled && button.getAttribute('aria-disabled') !== 'true') {
        await sleep(300);
        button.click();
        return true;
      }
      // A disabled button means an upload is still running, so keep waiting; no button at all
      // for a while means the site changed and we can't find it.
      if (button) lastSeen = Date.now();
      else if (Date.now() - lastSeen > 8_000) return false;
      await sleep(500);
    }
    return false;
  }

  // ---- on-page status toast -------------------------------------------------

  let toastHost = null;
  let toastTimer = null;

  function showToast(message, kind = 'info') {
    if (!toastHost) {
      toastHost = document.createElement('div');
      toastHost.style.cssText = 'position:fixed;z-index:2147483647;left:50%;bottom:24px;transform:translateX(-50%);';
      const root = toastHost.attachShadow({ mode: 'open' });
      root.innerHTML = `
        <style>
          .toast { display:flex; align-items:center; gap:10px; max-width:min(520px, calc(100vw - 32px));
            padding:10px 14px; border-radius:12px; font:500 13px/1.4 system-ui, -apple-system, sans-serif;
            color:#fff; background:#1f2430; box-shadow:0 8px 28px rgba(0,0,0,.28); }
          .toast.error { background:#b42318; }
          .toast.success { background:#16794a; }
          .dot { flex:none; width:8px; height:8px; border-radius:50%; background:currentColor; opacity:.9; }
          .toast.progress .dot { animation:pulse 1s ease-in-out infinite; }
          @keyframes pulse { 50% { opacity:.25; } }
          .close { all:unset; cursor:pointer; opacity:.7; padding:0 2px; font-size:16px; line-height:1; }
          .close:hover { opacity:1; }
        </style>
        <div class="toast" role="status"><span class="dot"></span><span class="msg"></span><button class="close" aria-label="Dismiss">×</button></div>`;
      root.querySelector('.close').addEventListener('click', () => toastHost.remove());
    }
    const root = toastHost.shadowRoot;
    root.querySelector('.toast').className = `toast ${kind}`;
    root.querySelector('.msg').textContent = message;
    if (!toastHost.isConnected) document.documentElement.append(toastHost);

    clearTimeout(toastTimer);
    if (kind !== 'progress') toastTimer = setTimeout(() => toastHost.remove(), kind === 'error' ? 12_000 : 7_000);
  }

  // ---- entry point ----------------------------------------------------------

  async function insert({ prompt, fallbackPrompt, file, inlineTranscript, autoSend, title }) {
    showToast(`Adding “${title}” to ${site.name}…`, 'progress');
    const editor = await waitFor(findEditor, 20_000);
    if (!editor) throw new Error(`Couldn't find ${site.name}'s message box. Open a chat and try again.`);

    let attached = false;
    let transcriptText = inlineTranscript;
    if (file) {
      attached = await attachFile(editor, new File([file.content], file.name, { type: 'text/plain' }));
      if (!attached) transcriptText = `----- TRANSCRIPT -----\n\n${file.content}`;
    }

    await insertText(editor, attached || !file ? prompt : fallbackPrompt);
    if (transcriptText) await insertText(editor, `\n${transcriptText}`);
    placeCaretAtEnd(editor);

    let sent = false;
    if (autoSend) {
      showToast('Waiting for the upload to finish, then sending…', 'progress');
      sent = await clickSendWhenReady();
    }

    const note = file && !attached ? ' (as text — attaching the file didn’t work here)' : '';
    let message = `Transcript added${note}. Review it and press Enter to send.`;
    if (sent) message = `Sent to ${site.name}${note}.`;
    else if (autoSend) message = `Transcript added${note}, but the send button wasn’t found. Press Enter to send.`;
    showToast(message, 'success');
    return { ok: true, attached, sent };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'yts:toast') {
      showToast(msg.message, msg.kind);
      return false;
    }
    if (msg?.type === 'yts:insert') {
      insert(msg.payload).then(sendResponse, (err) => {
        showToast(err.message, 'error');
        sendResponse({ ok: false, error: err.message });
      });
      return true;
    }
    return false;
  });
})();
