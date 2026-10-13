// Page-side link to the hidden local game server: a keep-alive ping while the
// page is open (so the server knows it is still wanted) and the Quit action.
// fetch and the document are injected so this unit tests without a browser.

export const PING_INTERVAL_MS = 30000;

export const QUIT_SCREEN_HTML =
  '<div style="position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;' +
  'justify-content:center;background:#050805;color:#cfe8c6;font-family:inherit;text-align:center;">' +
  '<div style="font-size:clamp(34px,6vw,64px);font-weight:800;letter-spacing:0.28em;">DEADFALL</div>' +
  '<div style="margin-top:22px;font-size:17px;letter-spacing:0.12em;">Deadfall has quit. You can close this tab.</div>' +
  '</div>';

export function startPing(fetchFn, setIntervalFn = setInterval) {
  const ping = () => {
    try {
      Promise.resolve(fetchFn('/api/ping')).catch(() => {});
    } catch {
      // a failed ping must never reach the game
    }
  };
  ping();
  return setIntervalFn(ping, PING_INTERVAL_MS);
}

export async function quitGame(fetchFn, doc) {
  try {
    await fetchFn('/api/quit', { method: 'POST' });
  } catch {
    // the server may drop the connection as it exits; the quit still happened
  }
  doc.body.innerHTML = QUIT_SCREEN_HTML;
}
