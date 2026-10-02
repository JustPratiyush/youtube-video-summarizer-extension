# Video Summariser for ChatGPT & Claude

A Chrome extension that puts a YouTube video's full transcript into your ChatGPT or Claude chat, together with a prompt asking for a detailed summary. It's an alternative to YouTube's built-in Gemini summary.

1. Open a chat on **chatgpt.com** or **claude.ai**.
2. Click the extension icon (or press **Alt+Shift+Y**).
3. Paste a YouTube link. It starts on its own.
4. The transcript is attached as a `.txt` file and the summary prompt is written into the message box. Review it and press **Enter**.

## Install

1. Open `chrome://extensions` (or `brave://extensions`, `edge://extensions`).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose this folder (`Video Summariser`).
4. Pin the extension: puzzle-piece icon → pin **Video Summariser**.

After editing any file here, click the reload icon on the extension's card. To change the keyboard shortcut, go to `chrome://extensions/shortcuts`.

## Using it

- **On a ChatGPT or Claude tab:** the popup adds the transcript to that chat.
- **On any other tab:** the popup offers **ChatGPT** / **Claude** buttons that open a new chat and add the transcript there.
- **YouTube tabs you already have open** are listed in the popup. Click one instead of copying its link.
- Accepted links: `youtube.com/watch?v=…`, `youtu.be/…`, `/shorts/…`, `/live/…`, `/embed/…`, `m.` and `music.` links, or a bare 11-character video ID. Timestamps and tracking parameters are ignored.

## What gets sent to the chat

**The prompt** asks the model to read the whole transcript before writing. It then requests a TL;DR, a section-by-section breakdown with timestamp ranges, key learnings, facts and references, actionable advice, notable quotes, and open questions or caveats. You can edit the prompt in Settings using placeholders such as `{{title}}`, `{{channel}}` and `{{url}}`.

**The transcript file** is plain text built to be easy for a model to read:

```
Title: But what is a neural network? | Deep learning chapter 1
Channel: 3Blue1Brown
URL: https://www.youtube.com/watch?v=aircAruvnKk
Length: 18:40
Captions: English

=== DESCRIPTION ===
…

=== TRANSCRIPT (timestamps are [m:ss]) ===

[0:04] This is a 3. It's sloppily written and rendered at an extremely low resolution…

[0:49] But if I told you, hey, sit down and write for me a program…
```

Caption fragments are merged into paragraphs of about 30–60 seconds, each starting with a timestamp. That costs far fewer tokens than SRT/VTT while still letting the summary cite `[12:34]`. An 18-minute video comes to roughly 22 KB.

## Settings

Open them from the sliders icon in the popup, or right-click the extension icon → **Options**.

| Setting | Default | Notes |
| --- | --- | --- |
| How the transcript is added | Attach `.txt` | Choose "Paste the text" if you suspect ChatGPT is skimming attached files. |
| Timestamps | On | |
| Video description | On | Descriptions often list chapters and links. |
| Preferred caption language | `en` | Order of preference: creator captions in this language → auto-generated in this language → captions in the spoken language → anything available. |
| Start when a link is pasted | On | |
| Send automatically | Off | Waits for the upload to finish, then clicks Send. |
| Prompt | Detailed summary | Fully editable; "Reset to default" restores it. |

## How it works

- **Transcript, main path:** the service worker asks YouTube's player API (as the Android app) for the video's caption tracks and downloads the best one. YouTube's web caption links now need a proof-of-origin token, but the app's links don't. A session rule (`declarativeNetRequest`) sets the `Origin` header on the extension's own requests so YouTube accepts them. No tab is opened, and it usually takes under a second.
- **Transcript, backup path:** if YouTube refuses that request (bot check, age-restricted or private video), the extension opens the video in a muted background tab using your normal YouTube session. It has the player load captions, reuses the player's own caption request, then closes the tab. Your YouTube caption preferences are restored afterwards.
- **Adding to the chat:** a small script is injected into the ChatGPT/Claude tab. It attaches the file the same way choosing a file or pasting does, checks that the attachment actually appeared, and only then tries another method. If attaching fails completely, it pastes the transcript as text and adjusts the prompt wording. A status toast at the bottom of the page shows progress and errors, even after the popup closes.

## Privacy

There is no server, account, analytics or API key. The extension only talks to YouTube (to fetch captions) and to the ChatGPT/Claude tab you're using. Settings are stored in Chrome's synced extension storage.

## Troubleshooting

- **"This video has no subtitles or auto-generated captions"**: there's nothing to transcribe. Some music videos, very new uploads and some live streams have none.
- **"Couldn't find ChatGPT's/Claude's message box"**: open a regular chat page (not settings or the GPT store) and try again. If it keeps happening, the site's layout has probably changed. The selectors are at the top of `content/chat-inject.js`.
- **Attached as text instead of a file**: the toast says so. The summary still works; this means the site's upload control changed.
- **Errors in general:** open `chrome://extensions` → Video Summariser → **Service worker** → Console.

## Files

```
manifest.json          Manifest V3 config
background.js          Service worker: runs a job from the popup (fetch → format → inject)
lib/youtube.js         Link parsing, caption track choice, caption download and parsing
lib/youtube-tab.js     Backup path through a background YouTube tab
lib/format.js          Builds the transcript file and fills in the prompt
lib/settings.js        Defaults, including the default prompt
lib/sites.js           ChatGPT / Claude URLs
lib/tabs.js            Tab helpers
content/chat-inject.js Attaches the file and writes the prompt inside ChatGPT/Claude
popup/                 The toolbar popup
options/               Settings page
icons/                 Extension icons
```
