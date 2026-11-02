'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');

// Minimal .env loader (no dependency)
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch (_) {}

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';
const CLOSE_RAW = (process.env.APPLICATIONS_CLOSE_AT || '').trim();
const CLOSE_AT = CLOSE_RAW ? new Date(CLOSE_RAW) : null;
if (CLOSE_RAW && isNaN(CLOSE_AT)) console.warn(`APPLICATIONS_CLOSE_AT is not a valid ISO 8601 date ("${CLOSE_RAW}"); ignoring it.`);
const closesAtISO = () => (CLOSE_AT && !isNaN(CLOSE_AT) ? CLOSE_AT.toISOString() : null);
const isOpen = () => { const c = closesAtISO(); return !c || Date.now() < CLOSE_AT.getTime(); };
const CLOSED_MSG = 'Applications are closed. Thank you for your interest in Ethereal!';
const DATA_FILE = path.resolve(process.env.DATA_FILE || path.join(__dirname, 'applications.json'));

const app = express();
app.set('trust proxy', true); // behind Render's proxy chain; rate limiting uses clientIp() below
app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- validation (mirrors public/app.js) ----------
const LIMITS = { why: [20, 1500], value: [20, 1500], about: [20, 1500] };
function validate(body) {
  const errors = {};
  const s = (v) => (typeof v === 'string' ? v.trim() : '');
  const discord = s(body.discord);
  let x = s(body.x).replace(/^@/, '');
  const why = s(body.why), value = s(body.value), about = s(body.about);

  // Discord: new usernames 2-32 chars, lowercase letters, digits, _ and . ; allow legacy name#1234
  if (!discord) errors.discord = 'Discord username is required.';
  else if (!/^(?!.*\.\.)[a-zA-Z0-9_.]{2,32}(#\d{4})?$/.test(discord)) errors.discord = 'Enter a valid Discord username.';

  if (!x) errors.x = 'X username is required.';
  else if (!/^[A-Za-z0-9_]{1,15}$/.test(x)) errors.x = 'Enter a valid X username (letters, numbers, _; max 15).';

  for (const [k, label, v] of [['why', 'This', why], ['value', 'This', value], ['about', 'This', about]]) {
    const [min, max] = LIMITS[k];
    if (!v) errors[k] = 'This field is required.';
    else if (v.length < min) errors[k] = `${label} needs at least ${min} characters.`;
    else if (v.length > max) errors[k] = `${label} must be under ${max} characters.`;
  }
  return { errors, data: { discord, x, why, value, about } };
}

// ---------- rate limit (in-memory, per IP) ----------
// Configurable via env; defaults suit a community (shared mobile/university networks).
const WINDOW_MS = (Number(process.env.RATE_LIMIT_WINDOW_MIN) || 15) * 60 * 1000;
const MAX_PER_WINDOW = Number(process.env.RATE_LIMIT_MAX) || 10;

// Real client IP behind Render/Railway/Cloudflare proxies. req.ip alone can be the proxy's
// address (all visitors would share one bucket), so prefer the proxy-set client headers,
// then the first valid X-Forwarded-For entry, then the socket address.
function clientIp(req) {
  const clean = (v) => {
    if (!v) return '';
    let ip = String(v).trim().replace(/^\[|\]$/g, '');
    if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(ip)) ip = ip.replace(/:\d+$/, ''); // strip IPv4 port
    if (ip.startsWith('::ffff:')) ip = ip.slice(7);
    return net.isIP(ip) ? ip : '';
  };
  for (const h of ['cf-connecting-ip', 'true-client-ip']) {
    const ip = clean(req.headers[h]);
    if (ip) return ip;
  }
  const xff = String(req.headers['x-forwarded-for'] || '').split(',');
  for (const part of xff) { const ip = clean(part); if (ip) return ip; }
  return clean(req.ip) || clean(req.socket.remoteAddress) || 'unknown';
}
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= MAX_PER_WINDOW) { hits.set(ip, arr); return true; }
  arr.push(now); hits.set(ip, arr); return false;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, arr] of hits) if (!arr.some((t) => now - t < WINDOW_MS)) hits.delete(ip);
}, WINDOW_MS).unref();

// ---------- storage ----------
function readApps() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (_) { return []; }
}
let writing = Promise.resolve();
function appendApp(entry) {
  writing = writing.then(() => {
    const apps = readApps();
    apps.push(entry);
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(apps, null, 2));
    fs.renameSync(tmp, DATA_FILE);
  });
  return writing;
}

// ---------- discord ----------
async function postToDiscord(a) {
  if (!DISCORD_WEBHOOK_URL) return;
  const clip = (t) => (t.length > 1000 ? t.slice(0, 997) + '...' : t);
  const body = {
    username: 'Ethereal Applications',
    allowed_mentions: { parse: [] },
    embeds: [{
      title: 'New application',
      color: 0x8b5cf6,
      fields: [
        { name: "What's your Discord username?", value: a.discord, inline: true },
        { name: "What's your X (Twitter) username?", value: `[@${a.x}](https://x.com/${a.x})`, inline: true },
        { name: 'Why do you want to join Ethereal?', value: clip(a.why) },
        { name: 'What value can you bring to Ethereal?', value: clip(a.value) },
        { name: 'Tell us a little about yourself.', value: clip(a.about) },
      ],
      footer: { text: `ID ${a.id}` },
      timestamp: a.submittedAt,
    }],
  };
  try {
    const r = await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!r.ok) console.error('Discord webhook failed:', r.status, await r.text());
  } catch (e) { console.error('Discord webhook error:', e.message); }
}

// ---------- API ----------
app.get('/api/status', (req, res) => {
  res.set('Cache-Control', 'no-store').json({ open: isOpen(), closesAt: closesAtISO(), now: new Date().toISOString() });
});

app.post('/api/apply', async (req, res) => {
  if (!isOpen()) return res.status(403).json({ ok: false, closed: true, error: CLOSED_MSG });
  const body = req.body || {};
  // Honeypot: real users never fill "website". Pretend success for bots.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    return res.json({ ok: true });
  }
  const { errors, data } = validate(body);
  if (Object.keys(errors).length) return res.status(400).json({ ok: false, errors });
  if (rateLimited(clientIp(req))) {
    return res.status(429).json({ ok: false, error: 'Too many applications from your network. Please try again later.' });
  }
  const entry = { id: crypto.randomUUID(), submittedAt: new Date().toISOString(), ...data };
  try { await appendApp(entry); }
  catch (e) { console.error(e); return res.status(500).json({ ok: false, error: 'Could not save your application. Please try again.' }); }
  postToDiscord(entry); // fire and forget
  res.json({ ok: true });
});

// ---------- admin ----------
function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) return res.status(503).send('Admin disabled: set ADMIN_PASSWORD.');
  const [scheme, encoded] = (req.headers.authorization || '').split(' ');
  if (scheme === 'Basic' && encoded) {
    const pass = Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':');
    const a = Buffer.from(pass), b = Buffer.from(ADMIN_PASSWORD);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Ethereal Admin"').status(401).send('Authentication required.');
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const csvCell = (v) => {
  let t = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; // guard against spreadsheet formula injection
  return '"' + t.replace(/"/g, '""') + '"';
};
app.get('/admin/applications.csv', requireAdmin, (req, res) => {
  const header = ['id', 'submitted time', 'Discord username', 'X username', 'why join', 'value', 'about'];
  const rows = readApps().map((a) => [a.id, a.submittedAt, a.discord, a.x, a.why, a.value, a.about]);
  const csv = '\uFEFF' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  const stamp = new Date().toISOString().slice(0, 10);
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="ethereal-applications-${stamp}.csv"`,
    'Cache-Control': 'no-store',
  }).send(csv);
});
app.get('/admin/applications.json', requireAdmin, (req, res) => res.json(readApps()));
app.get('/admin', requireAdmin, (req, res) => {
  const apps = readApps().slice().reverse();
  const open = isOpen(), closes = closesAtISO();
  const rows = apps.map((a) => `
    <article class="card">
      <header><span class="lbl">Discord</span> <strong>${esc(a.discord)}</strong> · <span class="lbl">X</span> · <a href="https://x.com/${esc(a.x)}" target="_blank" rel="noopener">@${esc(a.x)}</a>
      <time>${esc(new Date(a.submittedAt).toLocaleString('en-GB', { timeZone: 'UTC' }))} UTC</time></header>
      <h4>Why do you want to join Ethereal?</h4><p>${esc(a.why)}</p>
      <h4>What value can you bring to Ethereal?</h4><p>${esc(a.value)}</p>
      <h4>Tell us a little about yourself.</h4><p>${esc(a.about)}</p>
    </article>`).join('');
  res.set('Cache-Control', 'no-store').send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Ethereal · Applications</title>
<style>
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0b0a1a;color:#e8e6f5;padding:24px}
h1{font-weight:600;margin:0 0 4px}.sub{color:#9a96b8;margin:0 0 24px}a{color:#c4b5fd}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(320px,1fr))}
.card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:16px}
.card header{display:flex;flex-wrap:wrap;gap:6px;align-items:baseline}.card time{margin-left:auto;color:#8b87a8;font-size:12px}
h4{margin:14px 0 4px;font-size:13px;font-weight:600;color:#a78bfa}.lbl{color:#8b87a8;font-size:12px}
p{margin:0;white-space:pre-wrap;line-height:1.5;color:#d4d1e8}
.status{display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center;margin:8px 0 14px;color:#d4d1e8}
.pill{padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.06em}
.pill.open{background:rgba(52,211,153,.15);color:#6ee7b7}.pill.closed{background:rgba(251,113,133,.15);color:#fda4af}
.sub{display:flex;gap:14px;align-items:center}
.btn{display:inline-block;padding:8px 14px;border-radius:10px;background:linear-gradient(120deg,#7c3aed,#0891b2);color:#fff!important;text-decoration:none;font-weight:600}
</style></head><body>
<h1>Applications</h1>
<div class="status">
  <span class="pill ${open ? 'open' : 'closed'}">${open ? 'Open' : 'Closed'}</span>
  <span>${closes ? `${open ? 'Closes' : 'Closed'} <time id="closes" datetime="${esc(closes)}">${esc(new Date(closes).toUTCString())}</time>` : 'No deadline set (APPLICATIONS_CLOSE_AT not set)'}</span>
  <span class="total"><strong>${apps.length}</strong> total application${apps.length === 1 ? '' : 's'}</span>
</div>
<p class="sub"><a class="btn" href="/admin/applications.csv">Download CSV</a> <a href="/admin/applications.json">JSON</a></p>
<script>const t=document.getElementById('closes');if(t)t.textContent=new Date(t.dateTime).toLocaleString(undefined,{dateStyle:'full',timeStyle:'short'})+' (your local time)';</script>
<div class="grid">${rows || '<p>No applications yet.</p>'}</div></body></html>`);
});

app.use((req, res) => res.status(404).send('Not found'));

app.listen(PORT, () => console.log(`Ethereal running on http://localhost:${PORT}` + (closesAtISO() ? ` · applications close at ${closesAtISO()}` : '')));
