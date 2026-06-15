# Latest Handoff - Kaito Mindshare Bot

Last updated: 2026-06-16 MSK.

## Current State

The bot runs on the remote server from `/root/kaito-infomarkets-bot` as a systemd service named `kaito-infomarkets-bot.service`.

The latest runtime state observed during this handoff:

- Service: active under systemd.
- Git branch: `main`.
- Git remote: `git@github.com-kaito-mindshare-bot:infoseoindex/Kaito_mindshare_bot.git`.
- Latest known Polymarket daily snapshot: `2026-06-15`, `59.79%` rounded to two decimals.
- Notifications: enabled.
- Base check interval: `30` seconds.
- Fast-watch behavior: when the current UTC day does not yet have a finalized snapshot, polling tightens to about `15` seconds until the new daily value appears.
- Ignored runtime files: `.env`, `data/state.json`, `node_modules`.

No secrets should be copied into docs, commits, chat messages, or logs. `.env` contains the bot token and admin chat configuration. `data/state.json` contains runtime state and chat IDs.

## Latest Changes

Recent work added and stabilized:

- Direct Kaito historical data polling from the JSON endpoint used by the web app.
- Polymarket-only tracking for `Information Markets Mindshare Arena > Historical Data`.
- Telegram bot UI with clean text formatting, inline buttons, status/check/source/settings commands.
- User settings stored in runtime state:
  - notifications on/off;
  - check interval selection;
  - manual check from Telegram.
- Fast daily detection so the bot checks more aggressively when the new finalized daily value is expected but not yet present.
- Git hygiene: runtime files and dependency symlink are ignored.
- Handoff documentation started in `docs/`.

## Open Tasks

Recommended next improvements:

- Watch the next daily publication window and confirm that the first new finalized Polymarket value triggers exactly one high-priority Telegram alert.
- Add small parser/state tests if code behavior changes again.
- Consider adding structured health logs if intermittent Telegram `fetch failed` messages become frequent.
- Optionally update `README.md` to point to `docs/START_HERE.md` and `docs/context.md`.
- Consider a lightweight uptime check or systemd watchdog only if the process ever stops unexpectedly.

## Verification Commands

Run these from the remote server:

```bash
cd /root/kaito-infomarkets-bot
git status --short --ignored
node --check src/index.js
systemctl is-active kaito-infomarkets-bot.service
journalctl -u kaito-infomarkets-bot.service -n 80 --no-pager
```

Manual Telegram checks:

- Send `/status` to confirm current settings and last seen value.
- Send `/check` to force a data refresh.
- Open `Settings` from the menu to toggle notifications or change the base polling interval.

Direct data check without Telegram secrets:

```bash
curl -sS -L -A 'Mozilla/5.0' \
  -H 'Referer: https://kaito.ai/mindshare-arena/infomarkets' \
  -H 'Origin: https://kaito.ai' \
  'https://hub.kaito.ai/api/v1/yapper/leaderboard/mindshare_history?ticker=POLYMARKET&order=desc&duration=24h&category=infomkt' | head -c 1000
```

## Safe Restart

Only restart after config or code changes have been checked:

```bash
cd /root/kaito-infomarkets-bot
node --check src/index.js
systemctl restart kaito-infomarkets-bot.service
systemctl is-active kaito-infomarkets-bot.service
journalctl -u kaito-infomarkets-bot.service -n 80 --no-pager
```

Do not print `.env`, bot token values, chat IDs, SSH keys, or raw state contents.

## Next Safe Step

A new Codex should first read `docs/START_HERE.md`, `docs/context.md`, this file, `README.md`, `package.json`, `deploy/kaito-infomarkets-bot.service`, and then run the verification commands above. If everything is active and clean, the safest next product step is to observe the next daily Kaito snapshot and verify alert timing.