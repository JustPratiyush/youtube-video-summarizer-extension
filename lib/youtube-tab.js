// Fallback for when YouTube refuses the direct API call (bot checks, age-restricted
// videos, private videos you can see when signed in). We open the video in a muted
// background tab with your normal YouTube session, ask its player to load captions,
// and reuse the caption request the player makes, which carries the proof-of-origin
// token that direct requests lack.

import { runInTab, waitForTabComplete } from './tabs.js';
import { TranscriptError, assembleTranscript, noCaptionsError, parseTimedText, pickTrack } from './youtube.js';

// Runs in the YouTube page's main world, so it must be self-contained.
async function captureCaptionRequest() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // YouTube clears the performance buffer as it goes, so watch for new entries too.
  const captionUrls = performance
    .getEntriesByType('resource')
    .map((e) => e.name)
    .filter((u) => u.includes('/api/timedtext'));
  const observer = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (e.name.includes('/api/timedtext')) captionUrls.push(e.name);
  });
  observer.observe({ type: 'resource' });

  let player = null;
  for (let i = 0; i < 80; i++) {
    const p = document.querySelector('#movie_player');
    if (p?.getPlayerResponse?.()?.videoDetails) {
      player = p;
      break;
    }
    await sleep(250);
  }
  if (!player) {
    observer.disconnect();
    return { error: "YouTube's player didn't load." };
  }

  try {
    player.pauseVideo();
  } catch {}
  const response = player.getPlayerResponse();
  const tracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const d = response.videoDetails;
  const result = {
    details: { title: d.title, author: d.author, lengthSeconds: d.lengthSeconds, shortDescription: d.shortDescription },
    tracks: tracks.map((t) => ({ languageCode: t.languageCode, kind: t.kind, name: t.name, vssId: t.vssId })),
    captionUrl: null,
  };
  if (!tracks.length) {
    observer.disconnect();
    return result;
  }

  // YouTube remembers caption choices in localStorage; put the user's settings back afterwards.
  const savedPrefs = Object.keys(localStorage)
    .filter((k) => /caption/i.test(k))
    .map((k) => [k, localStorage.getItem(k)]);

  // Re-selecting an already loaded track is served from cache, so each attempt forces a fresh
  // request: load the module, reload it, then ask for a translation (tlang is stripped later).
  const lang = tracks[0].languageCode;
  const attempts = [
    () => player.loadModule('captions'),
    () => player.setOption('captions', 'track', { languageCode: lang }),
    () => {
      player.unloadModule('captions');
      player.loadModule('captions');
      player.setOption('captions', 'track', { languageCode: lang });
    },
    () =>
      player.setOption('captions', 'track', {
        languageCode: lang,
        translationLanguage: { languageCode: lang === 'fr' ? 'de' : 'fr' },
      }),
  ];
  for (const attempt of attempts) {
    if (captionUrls.length) break;
    try {
      attempt();
    } catch {}
    for (let i = 0; i < 16 && !captionUrls.length; i++) await sleep(250);
  }
  observer.disconnect();
  result.captionUrl = captionUrls.at(-1) ?? null;

  try {
    player.unloadModule('captions');
    for (const k of Object.keys(localStorage)) if (/caption/i.test(k)) localStorage.removeItem(k);
    for (const [k, v] of savedPrefs) localStorage.setItem(k, v);
  } catch {}
  return result;
}

async function fetchInPage(url) {
  const res = await fetch(url, { credentials: 'include' });
  return res.ok ? res.text() : '';
}

export async function getTranscriptViaTab(videoId, { preferredLang = 'en' } = {}) {
  const tab = await chrome.tabs.create({ url: `https://www.youtube.com/watch?v=${videoId}`, active: false });
  try {
    const loaded = waitForTabComplete(tab.id, 30_000);
    await chrome.tabs.update(tab.id, { muted: true }).catch(() => {});
    await loaded;

    const page = await runInTab(tab.id, captureCaptionRequest, [], 'MAIN');
    if (!page || page.error) throw new TranscriptError(page?.error ?? "Couldn't read the YouTube page.", 'BLOCKED');
    if (!page.tracks.length) throw noCaptionsError();
    if (!page.captionUrl) throw new TranscriptError("YouTube's player wouldn't load the captions.", 'BLOCKED');

    const track = pickTrack(page.tracks, preferredLang);
    const url = new URL(page.captionUrl);
    url.searchParams.set('lang', track.languageCode);
    if (track.kind) url.searchParams.set('kind', track.kind);
    else url.searchParams.delete('kind');
    url.searchParams.delete('tlang');
    url.searchParams.set('fmt', 'json3');

    const segments = parseTimedText((await runInTab(tab.id, fetchInPage, [url.href], 'MAIN')) ?? '');
    if (!segments.length) throw new TranscriptError('YouTube returned an empty caption file for this video.', 'EMPTY');
    return assembleTranscript(videoId, page.details, track, segments);
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}
