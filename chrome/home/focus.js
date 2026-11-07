"use strict";

// The blocked site arrives in the hash, and only ever lands in textContent.
const site = decodeURIComponent(location.hash.slice(1));
if (site) document.getElementById("site").textContent = `${site} подождёт, пока идёт фокус.`;

document.getElementById("settings").addEventListener("click", () => {
  const { CUSTOMIZE_URL } = ChromeUtils.importESModule("chrome://nyx/content/NyxTheme.sys.mjs");
  window.browsingContext.topChromeWindow.switchToTabHavingURI(`${CUSTOMIZE_URL}#focus`, true, {
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
  });
});
