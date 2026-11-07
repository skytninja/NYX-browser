// Snoozed tabs: closed now, opened again by themselves later. Kept in the profile's nyx-snoozed.json.

import { listFile, WEB_URL } from "chrome://nyx/content/NyxListFile.sys.mjs";

const MAX_ITEMS = 500;
const MORNING_HOUR = 9;

const store = listFile("nyx-snoozed.json", items => items.filter(item =>
  typeof item?.id === "string" && WEB_URL.test(item.url) && typeof item.title === "string" && Number.isFinite(item.until)
));

function atMorning(date) {
  date.setHours(MORNING_HOUR, 0, 0, 0);
  return date.getTime();
}

// Picked in the overview. Computed on each call, so "tomorrow" is always counted from now.
export function snoozeChoices(now = new Date()) {
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const monday = new Date(now);
  // Next Monday; on a Monday that's a week from today.
  monday.setDate(now.getDate() + (((8 - now.getDay()) % 7) || 7));
  return [
    { label: "Через 3 часа", until: now.getTime() + 3 * 60 * 60 * 1000 },
    { label: "Завтра в 9:00", until: atMorning(tomorrow) },
    { label: "В понедельник в 9:00", until: atMorning(monday) },
  ];
}

export const NyxSnooze = {
  // Soonest first.
  list: () => store.list(),

  add({ url, title }, until) {
    if (!WEB_URL.test(url)) return Promise.reject(new Error("only web pages can be snoozed"));
    const item = { id: crypto.randomUUID(), url, title: String(title || url), until };
    return store.change(items => ({ items: [...items, item].sort((a, b) => a.until - b.until).slice(0, MAX_ITEMS) }));
  },

  take(id) {
    return store.change(items => {
      const item = items.find(each => each.id === id) ?? null;
      return item ? { items: items.filter(each => each !== item), result: item } : { result: null };
    });
  },

  // Removes and returns everything whose time has come.
  due(now = Date.now()) {
    return store.change(items => {
      const ready = items.filter(item => item.until <= now);
      return ready.length ? { items: items.filter(item => item.until > now), result: ready } : { result: [] };
    });
  },
};
