export const CHAT_SITES = {
  chatgpt: {
    id: 'chatgpt',
    name: 'ChatGPT',
    newChatUrl: 'https://chatgpt.com/',
    matches: (url) => /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(url ?? ''),
  },
  claude: {
    id: 'claude',
    name: 'Claude',
    newChatUrl: 'https://claude.ai/new',
    matches: (url) => /^https:\/\/claude\.ai\//.test(url ?? ''),
  },
};

export function siteForUrl(url) {
  return Object.values(CHAT_SITES).find((site) => site.matches(url)) ?? null;
}
