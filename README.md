# Street Blackjack Radio

Standalone internet radio platform for Street Blackjack, built on [AzuraCast](https://www.azuracast.com/).
It runs independently of the game. The game's developer integrates it later through stream URLs and the Station Registry API.

| Folder | Contents |
|---|---|
| `/infra` | AzuraCast Docker setup, reverse proxy, server notes |
| `/registry-api` | Station Registry API: one combined station list (AzuraCast + external stations) |
| `/player` | Standalone test web player (desktop, Android, iPhone Safari / PWA) |
| `/docs` | Findings, admin guide, API docs, deployment guide |

## Status

- **Stage 1 (investigation):** done. See [docs/stage1-findings.md](docs/stage1-findings.md).
- **Stage 2 (proof of concept):** running locally on WSL2 - see [docs/stage2-local.md](docs/stage2-local.md); PoC details and tests in [docs/stage2-poc.md](docs/stage2-poc.md); VPS guide kept for later: [docs/stage2-vps-setup.md](docs/stage2-vps-setup.md).
- Licensing brief for PPL / PRS for Music: [docs/licensing-service-description.md](docs/licensing-service-description.md)
- Stage 3 (full setup): not started.
- Stage 4 (testing and handover): not started.

## Rules for this repo

- No secrets in git. AzuraCast admin API keys and passwords stay in `.env` files on the server only.
- Only licensed or royalty-free test audio. Never commit copyrighted music, and never commit audio files at all (see `.gitignore`).
