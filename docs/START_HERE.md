# Start Here - Kaito Mindshare Bot

This is the first file to read when continuing work on the Kaito Info Markets Telegram monitor.

## Bootstrap Prompt for New Codex

```text
You are continuing work on the Kaito Mindshare Bot.

Project location on the production server:
/root/kaito-infomarkets-bot

GitHub repo:
git@github.com:infoseoindex/Kaito_mindshare_bot.git

Goal:
Maintain a Telegram bot that monitors Kaito Info Markets Arena Historical Data for the Polymarket project. The bot reads Kaito's direct API endpoint, tracks the latest finalized daily snapshot, and alerts Telegram when a new daily value appears.

Start by reading:
- README.md
- docs/context.md
- docs/handoff-latest.md
- docs/daily-history.md
- package.json
- deploy/kaito-infomarkets-bot.service

Safety rules:
- Do not print, commit, or overwrite .env, Telegram tokens, SSH keys, deploy keys, raw state, chat IDs, session data, or node_modules.
- Treat data/state.json as runtime state. You may inspect summaries, but do not commit it.
- Before edits, check `git status --short --ignored` and `systemctl status kaito-infomarkets-bot.service`.
- After edits, run `node --check src/index.js`, restart systemd safely, check logs, then commit only GitHub-safe docs/code/config examples.

Useful commands:
cd /root/kaito-infomarkets-bot
git status --short --ignored
node --check src/index.js
systemctl is-active kaito-infomarkets-bot.service
journalctl -u kaito-infomarkets-bot.service -n 80 --no-pager
systemctl restart kaito-infomarkets-bot.service
```

## Quick Status

- Runtime: Node.js ESM bot.
- Process manager: systemd.
- Service: `kaito-infomarkets-bot.service`.
- Current production path: `/root/kaito-infomarkets-bot`.
- Primary data source: Kaito direct API endpoint for Polymarket `mindshare_history`.
- Telegram UI includes buttons for refresh, status, settings, sources, and Kaito page.
- Settings include notification toggle and interval selection; fast-watch checks every 15s when a new daily snapshot is due.
