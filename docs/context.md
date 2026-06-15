# Project Context - Kaito Mindshare Bot

## Product

Kaito Mindshare Bot is a Telegram monitor for Kaito Info Markets Arena Historical Data.

It tracks the `Polymarket` project daily finalized mindshare value from Kaito and sends Telegram notifications when the latest daily snapshot changes.

The bot is intended for fast market-monitoring workflows where the Kaito website UI may lag behind the API response. The bot reads the direct JSON endpoint rather than scraping the visible web page as its primary path.

## Repository and Server Locations

Production server path:

```bash
/root/kaito-infomarkets-bot
```

GitHub remote configured on server:

```bash
git@github.com-kaito-mindshare-bot:infoseoindex/Kaito_mindshare_bot.git
```

Public GitHub URL:

```text
https://github.com/infoseoindex/Kaito_mindshare_bot
```

## Runtime

- Language/runtime: Node.js 20+, ESM.
- Entry point: `src/index.js`.
- Process manager: systemd.
- Service unit: `/etc/systemd/system/kaito-infomarkets-bot.service`.
- Service template in repo: `deploy/kaito-infomarkets-bot.service`.
- Working directory: `/root/kaito-infomarkets-bot`.
- ExecStart: `/usr/local/bin/node /root/kaito-infomarkets-bot/src/index.js`.

Check service:

```bash
systemctl is-active kaito-infomarkets-bot.service
systemctl --no-pager --full status kaito-infomarkets-bot.service
journalctl -u kaito-infomarkets-bot.service -n 80 --no-pager
```

Safe restart after code/config changes:

```bash
cd /root/kaito-infomarkets-bot
node --check src/index.js
systemctl restart kaito-infomarkets-bot.service
sleep 4
systemctl is-active kaito-infomarkets-bot.service
journalctl -u kaito-infomarkets-bot.service -n 40 --no-pager
```

## Data Source

Primary endpoint:

```text
https://hub.kaito.ai/api/v1/yapper/leaderboard/mindshare_history?ticker=POLYMARKET&order=desc&duration=24h&category=infomkt
```

Response shape is an array of objects similar to:

```json
{
  "ticker": "POLYMARKET",
  "mindshare": 0.5978664542589283,
  "snapshot_timestamp": "2026-06-15 00:00:00"
}
```

Bot behavior:

- Takes the first item as latest finalized daily snapshot.
- Uses `snapshot_timestamp` date as the daily date.
- Converts `mindshare` from ratio to percent.
- Rounds display to two decimals.
- Sends alert when signature changes: `date|roundedValue|valueKey`.

## Telegram Features

Commands:

- `/start`, `/menu`, `/help` - open control panel.
- `/status` - show latest snapshot and monitor health.
- `/check` - force a check now.
- `/sources` - show data sources.
- `/settings` - notification and interval settings.

Inline buttons:

- Refresh
- Status
- Settings
- Sources
- Kaito page
- Notification toggle
- Interval choices: 15s, 30s, 60s, 5m

Settings are persisted in `data/state.json` under `settings`.

## Fast-Watch Logic

The settings interval is the base poll interval. The bot also has fast-watch logic:

- If the latest stored snapshot date is older than the current UTC date, the bot treats the new daily snapshot as due.
- While due, effective polling is `min(baseInterval, 15s)`.
- This is intended to catch the new daily value quickly when it appears.

## Environment Variables

Do not print values. Known required/configurable keys:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID` or `TELEGRAM_ADMIN_CHAT_ID`
- `TELEGRAM_POLLING`
- `CHECK_INTERVAL_SECONDS`
- `BROWSER_CHECK_INTERVAL_SECONDS`
- `BROWSER_WAIT_MS`
- `KAITO_DATA_URLS`
- `NOTIFY_NO_DATA_EVERY_MINUTES`

`.env.example` is safe to commit. `.env` is not safe to commit.

## Git and Deploy

Check status:

```bash
cd /root/kaito-infomarkets-bot
git status --short --ignored
git log --oneline -5
```

Expected ignored runtime files:

- `.env`
- `data/state.json`
- `node_modules`

Commit only GitHub-safe files:

- README/docs
- source code
- package/config examples
- systemd template

Push:

```bash
git push
```

The server uses a deploy key alias in `/root/.ssh/config`:

```text
Host github.com-kaito-mindshare-bot
  HostName github.com
  User git
  IdentityFile /root/.ssh/github-kaito-mindshare-bot
  IdentitiesOnly yes
```

Do not print private keys.

## Security Rules

Never commit or paste:

- `.env`
- Telegram bot token
- chat IDs
- deploy/private SSH keys
- raw `data/state.json`
- browser/session/cookie data
- `node_modules`
- logs containing secrets

When showing logs, mask token-like strings if present.
