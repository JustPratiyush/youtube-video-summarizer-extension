// Fetches a YouTube video's metadata and captions without opening the video.
//
// YouTube's web caption URLs now require a proof-of-origin token (they return an
// empty body without one), so we ask the InnerTube player API as a mobile client.
// The caption URLs it hands back still work without a token.

const PLAYER_URL = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';

const CLIENTS = [
  { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 30 },
  {
    clientName: 'IOS',
    clientVersion: '20.10.4',
    deviceMake: 'Apple',
    deviceModel: 'iPhone16,2',
    osName: 'iPhone',
    osVersion: '18.3.2.22D82',
  },
];

export class TranscriptError extends Error {
  /** @param {'NO_CAPTIONS'|'UNAVAILABLE'|'BLOCKED'|'EMPTY'|'NETWORK'} code */
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

/** Accepts any common YouTube link form (watch, youtu.be, shorts, live, embed) or a bare ID. */
export function parseVideoId(input) {
  const s = (input || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  const valid = (id) => (id && /^[\w-]{11}$/.test(id) ? id : null);
  const host = url.hostname.replace(/^(www|m|music)\./, '');

  if (host === 'youtu.be') return valid(url.pathname.split('/')[1]);
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.searchParams.has('v')) return valid(url.searchParams.get('v'));
    return valid(url.pathname.match(/^\/(?:shorts|live|embed|v|e)\/([\w-]{11})/)?.[1]);
  }
  return null;
}

async function fetchPlayerResponse(videoId) {
  let lastProblem = null;
  for (const client of CLIENTS) {
    let data;
    try {
      const res = await fetch(PLAYER_URL, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: { client: { ...client, hl: 'en' } },
          videoId,
          contentCheckOk: true,
          racyCheckOk: true,
        }),
      });
      if (!res.ok) {
        lastProblem = { code: 'BLOCKED', message: `YouTube responded with HTTP ${res.status}.` };
        continue;
      }
      data = await res.json();
    } catch (err) {
      lastProblem = { code: 'NETWORK', message: `Couldn't reach YouTube (${err.message}).` };
      continue;
    }

    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    const status = data?.playabilityStatus?.status;
    if (tracks.length || status === 'OK') return { data, tracks };

    const reason = data?.playabilityStatus?.reason || status || 'unknown reason';
    lastProblem =
      status === 'ERROR'
        ? { code: 'UNAVAILABLE', message: `YouTube says this video is unavailable: ${reason}` }
        : { code: 'BLOCKED', message: `YouTube wouldn't share this video's details: ${reason}` };
  }
  throw new TranscriptError(lastProblem.message, lastProblem.code);
}

export function trackLabel(track) {
  return track?.name?.simpleText ?? track?.name?.runs?.map((r) => r.text).join('') ?? track.languageCode;
}

/**
 * Preference order: creator-made captions in the preferred language, auto-generated
 * captions in the preferred language, creator-made captions in the spoken language,
 * auto-generated captions, then anything at all.
 */
export function pickTrack(tracks, preferredLang = 'en') {
  const pref = preferredLang.trim().toLowerCase();
  const lang = (t) => t.languageCode.toLowerCase();
  const isPreferred = (t) => lang(t) === pref || lang(t).startsWith(`${pref}-`);
  const manual = tracks.filter((t) => t.kind !== 'asr');
  const auto = tracks.filter((t) => t.kind === 'asr');
  const spoken = auto[0] && lang(auto[0]).split('-')[0];

  return (
    manual.find(isPreferred) ||
    auto.find(isPreferred) ||
    (spoken && manual.find((t) => lang(t).split('-')[0] === spoken)) ||
    auto[0] ||
    manual[0]
  );
}

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntitiesOnce(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] !== '#') return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
    const cp = /^#x/i.test(entity) ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return Number.isInteger(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : match;
  });
}

export function cleanCaptionText(raw) {
  // Caption XML is often double-encoded (&amp;#39;), so decode twice.
  const text = decodeEntitiesOnce(decodeEntitiesOnce(raw.replace(/<[^>]+>/g, '')));
  return text.replace(/\s+/g, ' ').trim();
}

/** Parses YouTube timedtext: JSON (fmt=json3), or XML format 1 `<text start dur>` / format 3 `<p t d>`. */
export function parseTimedText(body) {
  if (body.trimStart().startsWith('{')) {
    let events = [];
    try {
      events = JSON.parse(body).events ?? [];
    } catch {
      return [];
    }
    return events
      .filter((e) => e.segs)
      .map((e) => ({
        start: (e.tStartMs ?? 0) / 1000,
        dur: (e.dDurationMs ?? 0) / 1000,
        text: e.segs.map((s) => s.utf8 ?? '').join('').replace(/\s+/g, ' ').trim(),
      }))
      .filter((s) => s.text);
  }

  const xml = body;
  const attr = (attrs, name) => attrs.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
  const segments = [];

  for (const [, attrs, body] of xml.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    segments.push({
      start: parseFloat(attr(attrs, 'start') ?? '0'),
      dur: parseFloat(attr(attrs, 'dur') ?? '0'),
      text: cleanCaptionText(body),
    });
  }
  if (!segments.length) {
    for (const [, attrs, body] of xml.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)) {
      segments.push({
        start: parseInt(attr(attrs, 't') ?? '0', 10) / 1000,
        dur: parseInt(attr(attrs, 'd') ?? '0', 10) / 1000,
        text: cleanCaptionText(body),
      });
    }
  }
  return segments.filter((s) => s.text);
}

async function fetchSegments(track) {
  const url = track.baseUrl.replace(/&fmt=[^&]*/g, '');
  let xml;
  try {
    const res = await fetch(url, { credentials: 'omit' });
    xml = await res.text();
  } catch (err) {
    throw new TranscriptError(`Couldn't download the captions (${err.message}).`, 'NETWORK');
  }
  const segments = parseTimedText(xml);
  if (!segments.length) {
    throw new TranscriptError('YouTube returned an empty caption file for this video.', 'EMPTY');
  }
  return segments;
}

export const noCaptionsError = () =>
  new TranscriptError(
    "This video has no subtitles or auto-generated captions, so there's no transcript to summarize.",
    'NO_CAPTIONS'
  );

/**
 * @typedef {{videoId: string, title: string, channel: string, durationSec: number,
 *   description: string, language: string, languageCode: string, isAutoGenerated: boolean,
 *   segments: {start: number, dur: number, text: string}[]}} Transcript
 * @returns {Transcript}
 */
export function assembleTranscript(videoId, videoDetails, track, segments) {
  const details = videoDetails ?? {};
  return {
    videoId,
    title: details.title || 'Untitled video',
    channel: details.author || 'Unknown channel',
    durationSec: Number(details.lengthSeconds) || 0,
    description: details.shortDescription || '',
    language: trackLabel(track),
    languageCode: track.languageCode,
    isAutoGenerated: track.kind === 'asr',
    segments,
  };
}

/** @returns {Promise<Transcript>} */
export async function getTranscript(videoId, { preferredLang = 'en' } = {}) {
  const { data, tracks } = await fetchPlayerResponse(videoId);
  if (!tracks.length) throw noCaptionsError();

  const track = pickTrack(tracks, preferredLang);
  return assembleTranscript(videoId, data.videoDetails, track, await fetchSegments(track));
}
