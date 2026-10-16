#!/usr/bin/env node
// LOCAL DEVELOPMENT ONLY - never use on the production server (there, the owner creates the
// admin account themselves through the SSH tunnel; see docs/stage2-vps-setup.md).
//
// Completes AzuraCast's first-run setup on the local WSL install:
//   1. registers the Super Administrator with a randomly generated password,
//   2. creates an API key for the provisioning script,
//   3. stores both in /secrets (mode 600). Neither value is ever printed.
//
// Run inside WSL (node in Docker, host network so 127.0.0.1:18080 is AzuraCast):
//   docker run --rm --network host -v /opt/sbradio/secrets:/secrets -v /mnt/d/radio/infra:/infra:ro \
//     node:22-alpine node /infra/local/bootstrap-admin.mjs
import { writeFileSync, existsSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const BASE = (process.env.AZURACAST_URL || 'http://127.0.0.1:18080').replace(/\/+$/, '');
const EMAIL = process.env.ADMIN_EMAIL || 'admin@sbradio.test';
const ADMIN_FILE = '/secrets/azuracast-admin.env';
const KEY_FILE = '/secrets/azuracast-api.env';

const cookies = new Map();
const cookieHeader = () => [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
async function req(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    redirect: 'manual',
    ...opts,
    headers: { ...(opts.headers || {}), Cookie: cookieHeader() },
  });
  for (const c of res.headers.getSetCookie?.() || []) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  return res;
}
function extract(html, name) {
  const decoded = html.replace(/&quot;/g, '"').replace(/&#34;/g, '"').replace(/\\\//g, '/');
  const m = decoded.match(new RegExp(`"${name}"\\s*:\\s*"([^"]+)"`));
  return m ? m[1] : null;
}

async function main() {
  if (existsSync(KEY_FILE)) {
    console.log(`API key file already exists (${KEY_FILE}); nothing to do.`);
    return;
  }

  // 1. Register the first (super) administrator.
  let res = await req('/setup/register');
  const page = await res.text();
  if (res.status !== 200) throw new Error(`/setup/register returned HTTP ${res.status} - setup may already be done (an admin exists).`);
  const csrf = extract(page, 'csrf');
  if (!csrf) throw new Error('Could not find the setup form token.');

  const password = randomBytes(18).toString('base64url'); // 24 chars, ~144 bits
  res = await req('/setup/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: EMAIL, password, csrf }).toString(),
  });
  if (res.status !== 302) throw new Error(`Registration failed (HTTP ${res.status}).`);
  writeFileSync(ADMIN_FILE, `# AzuraCast local admin (test credentials, local WSL install only)\nAZURACAST_ADMIN_EMAIL=${EMAIL}\nAZURACAST_ADMIN_PASSWORD=${password}\n`, { mode: 0o600 });
  chmodSync(ADMIN_FILE, 0o600);
  console.log(`Admin account created: ${EMAIL} (password saved to ${ADMIN_FILE})`);

  // 2. Logged in now: fetch a page that carries the API CSRF token, then create an API key.
  res = await req('/setup/station');
  const stationPage = await res.text();
  const apiCsrf = extract(stationPage, 'apiCsrf');
  if (!apiCsrf) throw new Error(`Could not find the API token on /setup/station (HTTP ${res.status}).`);

  res = await req('/api/frontend/account/api-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-API-CSRF': apiCsrf },
    body: JSON.stringify({ comment: 'provisioning (local)' }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.key) throw new Error(`API key creation failed (HTTP ${res.status}): ${body.message || ''}`);
  writeFileSync(KEY_FILE, `AZURACAST_API_KEY=${body.key}\n`, { mode: 0o600 });
  chmodSync(KEY_FILE, 0o600);
  console.log(`API key created (saved to ${KEY_FILE}).`);
}

main().catch((err) => {
  console.error(`FAILED: ${err.message}`);
  process.exit(1);
});
