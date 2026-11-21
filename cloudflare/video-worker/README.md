# korfbal-video (Cloudflare Worker + R2)

Verplaatst wedstrijdvideo's van Firebase Storage naar Cloudflare R2 (gratis egress).
Uploads gaan via multipart direct naar R2; afspelen via `GET /v/<key>` met HTTP Range-support.

## Deploy

```bash
cd cloudflare/video-worker
npm install
npx wrangler login
npx wrangler r2 bucket create korfbal-videos
npx wrangler deploy
```

Zet daarna de getoonde `*.workers.dev` URL in `src/lib/videoStorage.js` bij `VIDEO_API_URL`.
Zodra die gevuld is, gebruikt de app automatisch R2 i.p.v. Firebase Storage.
