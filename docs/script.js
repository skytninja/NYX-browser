// Points the download button straight at the newest .dmg. Without this file it leads to the releases page.
(async () => {
  try {
    const response = await fetch("latest.json", { cache: "no-store" });
    if (!response.ok) return;
    const latest = await response.json();
    if (!/^https:\/\/github\.com\/skytninja\/NYX-browser\/releases\/download\//.test(latest.dmg)) return;
    document.getElementById("download-button").href = latest.dmg;
    const size = latest.size ? ` · ${Math.round(latest.size / 1024 / 1024)} МБ` : "";
    document.getElementById("download-meta").textContent =
      `Версия ${latest.version} · Firefox ${latest.firefox}${size} · macOS 10.15+ · Apple Silicon и Intel`;
    if (/^[0-9a-f]{64}$/.test(latest.sha256)) {
      document.getElementById("sha256").textContent = latest.sha256;
      document.getElementById("checksum").hidden = false;
    }
  } catch {
    // The static link and text still work.
  }
})();
