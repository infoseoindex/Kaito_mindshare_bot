# Daily History Notes

This bot tracks the Polymarket row in Kaito's Information Markets Mindshare Arena historical data.

Page:

```text
https://kaito.ai/mindshare-arena/infomarkets
```

Primary JSON endpoint discovered from the web app's network traffic:

```text
https://hub.kaito.ai/api/v1/yapper/leaderboard/mindshare_history?ticker=POLYMARKET&order=desc&duration=24h&category=infomkt
```

## Response Shape

The endpoint returns an array where the newest daily snapshot is first. Example shape:

```json
[
  {
    "ticker": "POLYMARKET",
    "mindshare": 0.5978664542589283,
    "snapshot_timestamp": "2026-06-15 00:00:00"
  }
]
```

The bot converts `mindshare` from a ratio to a percentage and rounds to two decimals for Telegram alerts and duplicate detection. For example, `0.5978664542589283` becomes `59.79%`.

The duplicate signature is based on:

```text
<date>|<rounded percentage>|<value key>
```

At this handoff, the latest known finalized value in runtime state was:

```text
2026-06-15: 59.79%
```

## Manual Check

Use this command on the server to inspect the public data endpoint without exposing Telegram secrets:

```bash
curl -sS -L -A 'Mozilla/5.0' \
  -H 'Referer: https://kaito.ai/mindshare-arena/infomarkets' \
  -H 'Origin: https://kaito.ai' \
  'https://hub.kaito.ai/api/v1/yapper/leaderboard/mindshare_history?ticker=POLYMARKET&order=desc&duration=24h&category=infomkt' | head -c 2000
```

If the endpoint is temporarily unavailable, the bot should keep the previous state, record the error internally, and retry on the next interval. The important production behavior is to avoid sending a false new-value alert from preview or intraday data.

## Alert Timing

The base polling interval is user-configurable from Telegram settings. When the bot detects that today's UTC daily snapshot has not appeared yet, it tightens polling to about 15 seconds so the next finalized value is caught quickly.

This setting answers a common question: the interval in Telegram settings is the normal interval for checking current data. The bot can temporarily check faster around the expected daily update window.

## Safety

Do not commit or paste:

- `.env`
- `data/state.json`
- Telegram bot tokens
- Telegram chat IDs
- SSH keys
- raw reports or session/build artifacts