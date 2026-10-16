# Player on Vercel

Only the **test player** (static files) is hosted on Vercel. **AzuraCast and the registry API cannot run on Vercel.** They need always-running processes, Docker, disk space for the mixes, and audio connections that stay open for hours. They stay on the radio server: for now that's this PC through a temporary HTTPS tunnel, and later the VPS.

```
iPhone / browser ──► https://player-beryl-rho.vercel.app   (player: HTML/JS/CSS)
                         │  station list + audio
                         ▼
               https://<radio-server>   (now: localhost.run tunnel → gateway on this PC;
                                         later: https://api.radio.<domain> on the VPS)
```

| | |
|---|---|
| Live URL | **https://player-beryl-rho.vercel.app** |
| Vercel project | `usamahafiz8s-projects/player` |
| Built from | `infra/vercel/build-player.mjs`, which copies `/player` without dev tools, writes `config.js` with the radio-server address, and adds cache headers (`sw.js`, `config.js` and `index.html` are never cached) |

## When the radio-server address changes
The free tunnel address changes each time it's restarted. You don't need to redeploy:
- **Link:** open `https://player-beryl-rho.vercel.app/?api=https://NEW-TUNNEL-ADDRESS`. The phone remembers it.
- **Or:** in the player, open **Diagnostics → Radio server**, paste the new address, and tap **Save**. Leave it empty and Save to go back to the built-in default.

## Redeploying (after player code changes)
```bash
API_BASE=https://<radio-server> node infra/vercel/build-player.mjs
cd .vercel-build/player && npx vercel@64.3.1 deploy --prod
```

## Requirements and notes
- The radio-server address **must be HTTPS**, or browsers block it as mixed content. The build script refuses `http://`.
- CORS: the registry allows the Vercel origin. Locally it allows `*`; on the VPS, add `https://player-beryl-rho.vercel.app` (or your custom domain) to `CORS_ORIGINS`.
- Vercel's free **Hobby** plan is for non-commercial use. For client/commercial use, check whether you need **Pro**.
- When the VPS is ready, rebuild with `API_BASE=https://api.radio.<domain>`. The tunnel is then no longer needed.
