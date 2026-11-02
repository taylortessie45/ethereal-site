# Ethereal — community application site

A single-page site where people apply to join **Ethereal**. Five required questions:

1. **What's your Discord username?**
2. **What's your X (Twitter) username?** (with or without `@`)
3. **Why do you want to join Ethereal?** — *Tell us what interests you about our community and why you'd like to be part of it.*
4. **What value can you bring to Ethereal?** — *How do you see yourself contributing to the community?*
5. **Tell us a little about yourself.** — *Share a brief introduction, including your interests, experience, or what you're currently working on.*

The same question wording is used for the Discord embed field names and the `/admin` page.

Tiny Node.js + Express backend (only dependency: `express`).

## Links
- Community X: [@Etherealweb3_](https://x.com/Etherealweb3_)
- Founder: [@tenacious_ar](https://x.com/tenacious_ar)
- Discord: https://discord.gg/nZYb5DTMH ("Join Ethereal" button in the header, hero, footer and success screen)

To change them, edit `public/index.html` (search for `discord.gg` / `x.com`).
The logo / favicon is `public/logo.jpg` (the @Etherealweb3_ X profile picture, 400×400); replace the file to change it.

## Features
- Dark, dreamy, mobile-friendly landing page + application form
- Client **and** server validation (text answers 20–1500 chars; valid Discord/X handles)
- Thank-you screen after submitting, with a "Join our Discord" button
- Spam protection: hidden honeypot field + rate limit (3 submissions / 15 min per IP)
- Every application appended to `applications.json` with an ISO timestamp and id
- Optional: each application posted as an embed to a Discord channel via webhook
- Optional application deadline (`APPLICATIONS_CLOSE_AT`): live countdown on the page, form replaced by a "closed" message afterwards, enforced server-side (403)
- Password-protected `/admin` page (HTTP basic auth) listing applications, open/closed status, closing time and total count; **Download CSV** at `/admin/applications.csv`, raw JSON at `/admin/applications.json`

## Run locally
Requires Node 18+.

```bash
npm install
cp .env.example .env      # then edit ADMIN_PASSWORD (and DISCORD_WEBHOOK_URL if wanted)
npm start                 # http://localhost:3000
```

Admin: open `http://localhost:3000/admin`, any username, password = `ADMIN_PASSWORD`.

### Environment variables
| Var | Required | Purpose |
|---|---|---|
| `PORT` | no (default 3000) | Port to listen on |
| `ADMIN_PASSWORD` | for `/admin` | Basic-auth password. `/admin` is disabled if unset |
| `DISCORD_WEBHOOK_URL` | no | Discord channel webhook (Channel settings → Integrations → Webhooks → Copy URL) |
| `APPLICATIONS_CLOSE_AT` | no | ISO 8601 deadline, e.g. `2026-11-05T00:00:00+06:00` or `2026-11-04T18:00:00Z`. Always include a timezone. Unset = always open |
| `DATA_FILE` | no | Path of the JSON store (default `./applications.json`) |

## Application deadline
Set `APPLICATIONS_CLOSE_AT` to close applications at a fixed moment (server time is the source of truth):
- `GET /api/status` → `{ "open": true, "closesAt": "2026-11-05T00:00:00.000Z", "now": "..." }`
- While open, the page shows "Applications close in D/H/M/S" and the deadline in the visitor's local time.
- After the deadline, `POST /api/apply` returns `403` (`{"ok":false,"closed":true,...}`) and the page shows
  "Applications are now closed. Thank you for your interest in Ethereal!" with the Discord button.
- To set a 48-hour window, take the start time and add 48 hours, e.g. opening at
  2026-11-03 00:00 Dhaka time → `APPLICATIONS_CLOSE_AT=2026-11-05T00:00:00+06:00`.
  Quick helper: `node -e "console.log(new Date(Date.now()+48*3600e3).toISOString())"`.
- On Render: Service → Environment → add the variable → Save (the service redeploys).

## Viewing applications
Open `https://<your-site>/admin`, sign in with any username and `ADMIN_PASSWORD`.
Use **Download CSV** to open all answers in Excel / Google Sheets.

## Deploy

**Important:** applications are stored in a JSON file. Most hosts have an ephemeral filesystem, so
attach a persistent disk/volume (and point `DATA_FILE` at it), or rely on the Discord webhook as your record.

### Render
1. Push this folder to a GitHub repo.
2. Render → New → Web Service → pick the repo.
3. Build command `npm install`, start command `npm start`.
4. Add env vars `ADMIN_PASSWORD`, `DISCORD_WEBHOOK_URL`.
5. For persistence, add a Disk (paid plans) mounted at e.g. `/data` and set `DATA_FILE=/data/applications.json`.

### Railway
1. New Project → Deploy from GitHub repo (it auto-detects Node and runs `npm start`).
2. Add the env vars in Variables.
3. Add a Volume mounted at `/data` and set `DATA_FILE=/data/applications.json`.
4. Settings → Networking → Generate Domain.

### Vercel
Vercel runs serverless functions with a read-only/ephemeral filesystem and no long-lived process,
so `applications.json` and the in-memory rate limit won't persist. It works only if you treat the
**Discord webhook as the storage**. For this app, Render or Railway (or any VPS: `npm start` behind
nginx/pm2) is recommended. If you still want Vercel, you'd export the Express app as a serverless
function (`module.exports = app` in `api/index.js` plus a `vercel.json` rewrite) and swap the file
store for a database (e.g. Vercel KV/Postgres).

## Files
```
server.js          Express server: static files, POST /api/apply, /admin
public/index.html  Landing page + form
public/styles.css  Styles
public/app.js      Client-side validation and submit
.env.example       Env var template
```
