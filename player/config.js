// Overwritten at deploy time. Can also be overridden with ?api=https://... in the URL.
window.SBR_CONFIG = {
  // Base URL of the Station Registry API. Empty = derive from this page's address
  // (player.<domain> -> api.<domain>, otherwise same origin).
  apiBase: '',
  // Prefer the HLS stream where the browser plays HLS natively (iOS Safari).
  // Off by default; MP3 is the most compatible. Decided after Stage 4 device tests.
  preferHls: false,
  // How often to refresh the station list while the page is visible.
  refreshMs: 15000,
};
