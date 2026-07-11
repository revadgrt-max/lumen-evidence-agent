/* Lumen Evidence Agent — runtime configuration.
 * ---------------------------------------------------------------------------
 * LUMEN_API_BASE controls OFFLINE vs LIVE mode:
 *
 *   ""  (empty, default)  → OFFLINE: the app runs the 6 verified molecule
 *                            replays fully on-device. No network, no data
 *                            collected. This is the App-Store-default build.
 *
 *   "https://your-backend" → LIVE "any molecule": the app probes
 *                            <BASE>/api/health and streams dossiers from
 *                            <BASE>/api/dossier (Server-Sent Events). The
 *                            backend is the evidence-agent server; it holds the
 *                            ANTHROPIC_API_KEY server-side — the key is NEVER in
 *                            this app. See LIVE-MODE.md to deploy it.
 *
 * After editing this value, run `npx cap copy` to push it into ios/ + android/.
 * No trailing slash.
 */
window.LUMEN_API_BASE = "";
