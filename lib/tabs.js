/** Resolves once the tab finishes loading. Call it before anything that could let the load finish first. */
export function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const done = (fn, arg) => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      fn(arg);
    };
    const onUpdated = (id, info) => id === tabId && info.status === 'complete' && done(resolve);
    const timer = setTimeout(() => done(reject, new Error('Timed out waiting for the page to load.')), timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

export async function runInTab(tabId, func, args = [], world = 'ISOLATED') {
  const [injection] = await chrome.scripting.executeScript({ target: { tabId }, world, func, args });
  return injection?.result;
}
