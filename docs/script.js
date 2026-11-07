// Points the download buttons straight at the newest files. Without latest.json they lead to the releases page.
const RELEASE_FILE = /^https:\/\/github\.com\/skytninja\/NYX-browser\/releases\/download\//;
const HASH = /^[0-9a-f]{64}$/;

// The visitor's own system gets the bright button, first in line.
const onWindows = /Win/i.test(navigator.userAgentData?.platform ?? navigator.platform ?? "");
if (onWindows) {
  const mac = document.getElementById("download-button");
  const win = document.getElementById("download-win");
  mac.classList.add("secondary");
  win.classList.remove("secondary");
  win.after(mac);
}

const megabytes = bytes => (bytes ? ` · ${Math.round(bytes / 1024 / 1024)} МБ` : "");

function showHash(value, codeId, boxId) {
  if (!HASH.test(value ?? "")) return;
  document.getElementById(codeId).textContent = value;
  document.getElementById(boxId).hidden = false;
}

(async () => {
  try {
    const response = await fetch("latest.json", { cache: "no-store" });
    if (!response.ok) return;
    const latest = await response.json();
    const parts = [`Версия ${latest.version} · Firefox ${latest.firefox}`];
    if (RELEASE_FILE.test(latest.dmg ?? "")) {
      document.getElementById("download-button").href = latest.dmg;
      parts.push(`macOS 10.15+${megabytes(latest.size)}`);
      showHash(latest.sha256, "sha256", "checksum");
    }
    if (RELEASE_FILE.test(latest.exe ?? "")) {
      document.getElementById("download-win").href = latest.exe;
      parts.push(`Windows 10 и 11 x64${megabytes(latest.exe_size)}`);
      showHash(latest.exe_sha256, "sha256-win", "checksum-win");
    }
    if (parts.length > 1) document.getElementById("download-meta").textContent = parts.join(" · ");
  } catch {
    // The static links and text still work.
  }
})();
