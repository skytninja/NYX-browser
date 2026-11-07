// Focus mode: while it's on (by schedule or "for an hour"), the listed sites open a quiet stub page
// instead, and with the hard limit on, new tabs over the limit are closed right away.

import { NyxTheme } from "chrome://nyx/content/NyxTheme.sys.mjs";

export const FOCUS_URL = "chrome://nyx/content/focus.html";
const HOUR_MS = 60 * 60 * 1000;

let observing = false;

const toMinutes = clock => {
  const [hours, minutes] = clock.split(":").map(Number);
  return hours * 60 + minutes;
};

// "youtube.com" also covers "m.youtube.com" and "www.youtube.com".
function siteFor(host, sites) {
  return sites.find(site => host === site || host.endsWith(`.${site}`)) ?? null;
}

// A pasted link or "www.site.com/page" turns into "site.com".
export function siteFromInput(text) {
  let value = text.trim().toLowerCase();
  if (!value) return null;
  try {
    value = new URL(value.includes("://") ? value : `https://${value}`).hostname;
  } catch {
    return null;
  }
  return value.replace(/^www\./, "") || null;
}

function isActive(settings, now = new Date()) {
  if (settings.focusUntil > now.getTime()) return true;
  if (!settings.focusSchedule || !settings.focusDays.includes(now.getDay())) return false;
  const minute = now.getHours() * 60 + now.getMinutes();
  const from = toMinutes(settings.focusFrom);
  const to = toMinutes(settings.focusTo);
  // A schedule like 22:00–02:00 runs over midnight.
  return from <= to ? minute >= from && minute < to : minute >= from || minute < to;
}

function onRequest(subject) {
  const channel = subject.QueryInterface(Ci.nsIHttpChannel);
  const { loadInfo } = channel;
  if (loadInfo.externalContentPolicyType !== Ci.nsIContentPolicy.TYPE_DOCUMENT) return;
  const settings = NyxTheme.settings;
  if (!settings.focusSites.length || !isActive(settings)) return;
  const site = siteFor(channel.URI.host, settings.focusSites);
  if (!site) return;
  channel.cancel(Cr.NS_BINDING_ABORTED);
  const browser = loadInfo.browsingContext?.top?.embedderElement;
  if (!browser) return;
  Services.tm.dispatchToMainThread(() => {
    browser.loadURI(Services.io.newURI(`${FOCUS_URL}#${encodeURIComponent(site)}`), {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
  });
}

export const NyxFocus = {
  get active() {
    return isActive(NyxTheme.settings);
  },

  // Time the current manual focus ends, or 0.
  get manualUntil() {
    const { focusUntil } = NyxTheme.settings;
    return focusUntil > Date.now() ? focusUntil : 0;
  },

  start() {
    if (observing) return;
    observing = true;
    Services.obs.addObserver(onRequest, "http-on-modify-request");
  },

  forAnHour() {
    return NyxTheme.update({ focusUntil: Date.now() + HOUR_MS });
  },

  stopManual() {
    return NyxTheme.update({ focusUntil: 0 });
  },
};
