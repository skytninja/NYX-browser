// Trash for tabs that auto-cleanup closed: kept for a week in the profile's nyx-trash.json.
// Only the address and title are kept, so a restored tab loads the page anew.

import { listFile, WEB_URL } from "chrome://nyx/content/NyxListFile.sys.mjs";

const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ITEMS = 200;

const store = listFile("nyx-trash.json", items => {
  const since = Date.now() - KEEP_MS;
  return items.filter(item =>
    typeof item?.id === "string" && WEB_URL.test(item.url) && typeof item.title === "string" &&
    Number.isFinite(item.closedAt) && item.closedAt > since
  );
});

export const NyxTrash = {
  // Newest first.
  list: () => store.list(),

  // entries: [{ url, title }]. Anything that isn't a web page is skipped.
  add(entries) {
    const closedAt = Date.now();
    const added = entries
      .filter(entry => WEB_URL.test(entry.url))
      .map(entry => ({ id: crypto.randomUUID(), url: entry.url, title: String(entry.title || entry.url), closedAt }));
    if (!added.length) return Promise.resolve();
    return store.change(items => ({ items: [...added, ...items].slice(0, MAX_ITEMS) }));
  },

  // Removes the item and returns it, or null if it's gone already.
  take(id) {
    return store.change(items => {
      const item = items.find(each => each.id === id) ?? null;
      return item ? { items: items.filter(each => each !== item), result: item } : { result: null };
    });
  },

  clear: () => store.change(() => ({ items: [] })),
};
