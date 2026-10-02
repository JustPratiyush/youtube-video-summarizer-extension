export const DEFAULT_PROMPT = `Please summarize the YouTube video "{{title}}" by {{channel}} ({{duration}}): {{url}}

Its complete transcript is {{where}}. Read the ENTIRE transcript from beginning to end before you write anything. Don't skim and don't stop partway: the second half matters as much as the first.

Then write a detailed, comprehensive summary that lets someone who never watches the video understand everything valuable in it. Use this structure:

## TL;DR
3–5 sentences on what the video is about and its central message.

## Detailed breakdown
Follow the video's own structure, in order. For each major section, give a heading with its timestamp range, then explain the points, arguments, explanations, examples and stories in depth. Don't compress several ideas into one vague sentence.

## Key learnings and insights
Every important lesson, idea and takeaway, each explained in a sentence or two.

## Facts, figures and references
Statistics, numbers, names, studies, tools, books, products and resources mentioned, with their context.

## Actionable advice
Concrete steps, frameworks, techniques or recommendations a viewer can apply.

## Notable quotes
The most memorable lines, quoted exactly, with timestamps.

## Open questions and caveats
Claims made without evidence, points the speaker was unsure about, and anything left unresolved.

Cite timestamps like [12:34] so I can jump to the source. The captions may be auto-generated, so silently fix obvious speech-recognition errors in names and terms. Skip a section only if it genuinely doesn't apply. Write the summary in English.`;

export const PROMPT_PLACEHOLDERS = {
  title: 'Video title',
  channel: 'Channel name',
  url: 'Video link',
  duration: 'Video length, e.g. "18 min 40 s"',
  language: 'Caption language, e.g. "English (auto-generated)"',
  where: 'Where the transcript is: "in the attached file …" or "pasted at the end of this message"',
};

export const DEFAULT_SETTINGS = {
  delivery: 'file', // 'file' attaches a .txt; 'inline' pastes the transcript into the message
  timestamps: true,
  includeDescription: true,
  preferredLang: 'en',
  autoStartOnPaste: true,
  autoSend: false,
  promptTemplate: DEFAULT_PROMPT,
};

export async function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...(await chrome.storage.sync.get(DEFAULT_SETTINGS)) };
}

export async function saveSetting(key, value) {
  // Store only what differs from the defaults, so improved defaults reach existing installs.
  if (value === DEFAULT_SETTINGS[key]) await chrome.storage.sync.remove(key);
  else await chrome.storage.sync.set({ [key]: value });
}
