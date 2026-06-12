# Kaito Mindshare Bot

Telegram monitor for Kaito Info Markets Arena Historical Data.

It tracks the finalized daily Polymarket mindshare snapshot from Kaito's direct API endpoint and sends Telegram alerts when the latest date/value changes.

## Source

Primary endpoint discovered from the Kaito page runtime/cache:

```text
https://hub.kaito.ai/api/v1/yapper/leaderboard/mindshare_history?ticker=POLYMARKET&order=desc&duration=24h&category=infomkt
```

The bot reads the first item from the response, uses `snapshot_timestamp` as the finalized date, and converts `mindshare` from ratio to percent.

## Commands

- `/start` - open control panel
- `/status` - show latest snapshot and monitor health
- `/check` - force a check now
- `/sources` - show configured data sources

## Deploy

1. Copy `.env.example` to `.env`.
2. Fill `TELEGRAM_BOT_TOKEN` and optionally `TELEGRAM_CHAT_ID`.
3. Run:

```bash
npm install
npm run check
npm start
```

For systemd, use `deploy/kaito-infomarkets-bot.service`.

## Security

Runtime secrets and state are intentionally ignored:

- `.env`
- `data/*.json`
- `node_modules/`
