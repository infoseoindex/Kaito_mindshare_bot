import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const APP = 'kaito-infomarkets-bot';
const TELEGRAM_API = 'https://api.telegram.org';
const KAITO_PAGE = 'https://kaito.ai/mindshare-arena/infomarkets';
const STATE_FILE = new URL('../data/state.json', import.meta.url);
const INTERVAL_OPTIONS = [15, 30, 60, 300];

loadDotEnv();
const config = {
  token: process.env.TELEGRAM_BOT_TOKEN || '',
  chatId: process.env.TELEGRAM_CHAT_ID || process.env.TELEGRAM_ADMIN_CHAT_ID || '',
  pollSeconds: num(process.env.CHECK_INTERVAL_SECONDS, 60),
  browserEverySeconds: num(process.env.BROWSER_CHECK_INTERVAL_SECONDS, 180),
  browserWaitMs: num(process.env.BROWSER_WAIT_MS, 25000),
  dataUrls: list(process.env.KAITO_DATA_URLS),
  notifyNoDataEveryMinutes: num(process.env.NOTIFY_NO_DATA_EVERY_MINUTES, 0),
  telegramPolling: process.env.TELEGRAM_POLLING === 'true',
};
const state = loadState();
ensureStateDefaults();

main().catch((error) => {
  console.error(`[${APP}] fatal`, error);
  process.exitCode = 1;
});

async function main() {
  if (!config.token) throw new Error('TELEGRAM_BOT_TOKEN is missing');
  console.log(`[${APP}] started. Direct urls: ${config.dataUrls.length}. Poll: ${getPollSeconds()}s. Effective: ${getEffectivePollSeconds()}s. Browser: ${config.browserEverySeconds}s.`);
  await setupTelegramCommands();
  if (config.chatId) await sendMessage(config.chatId, formatWelcome(), mainKeyboard()).catch((error) => console.error(`[${APP}] startup telegram notice skipped: ${error.message}`));
  if (config.telegramPolling) await Promise.all([telegramLoop(), monitorLoop()]);
  else await monitorLoop();
}

async function telegramLoop() {
  while (true) {
    try {
      const updates = await telegram('getUpdates', { offset: state.telegramOffset + 1, timeout: 25, allowed_updates: ['message', 'callback_query'] });
      for (const update of updates.result || []) {
        state.telegramOffset = Math.max(state.telegramOffset, update.update_id);
        if (update.callback_query) {
          await handleCallbackQuery(update.callback_query);
          continue;
        }

        const msg = update.message;
        if (!msg?.text || !msg.chat?.id) continue;
        state.chatIds[String(msg.chat.id)] = true;
        ensureStateDefaults();
        saveState();

        const command = msg.text.trim().split(/\s+/)[0].split('@')[0].toLowerCase();
        if (command === '/start' || command === '/menu' || command === '/help') await sendWelcome(msg.chat.id);
        else if (command === '/status') await sendStatus(msg.chat.id);
        else if (command === '/check') await handleCheck(msg.chat.id);
        else if (command === '/sources') await sendSources(msg.chat.id);
        else if (command === '/settings') await sendSettings(msg.chat.id);
        else await sendWelcome(msg.chat.id);
      }
      saveState();
    } catch (error) {
      console.error(`[${APP}] telegram failed:`, error.message);
      await delay(5000);
    }
  }
}

async function monitorLoop() {
  while (true) {
    ensureStateDefaults();
    if (!state.paused) await checkOnce({ forced: false }).catch((e) => console.error(`[${APP}] check failed:`, e));
    await delay(getEffectivePollSeconds() * 1000);
  }
}

async function handleCallbackQuery(query) {
  const chatId = query.message?.chat?.id;
  const data = query.data || '';
  await telegram('answerCallbackQuery', { callback_query_id: query.id }).catch(() => {});
  if (!chatId) return;

  state.chatIds[String(chatId)] = true;
  ensureStateDefaults();

  if (data === 'menu') {
    saveState();
    return sendWelcome(chatId);
  }
  if (data === 'status') {
    saveState();
    return sendStatus(chatId);
  }
  if (data === 'check') {
    saveState();
    return handleCheck(chatId);
  }
  if (data === 'sources') {
    saveState();
    return sendSources(chatId);
  }
  if (data === 'settings') {
    saveState();
    return sendSettings(chatId);
  }
  if (data === 'toggle_notifications') {
    state.settings.notificationsEnabled = !state.settings.notificationsEnabled;
    saveState();
    return sendSettings(chatId);
  }
  if (data.startsWith('interval:')) {
    const next = Number(data.slice('interval:'.length));
    if (INTERVAL_OPTIONS.includes(next)) state.settings.pollSeconds = next;
    saveState();
    return sendSettings(chatId);
  }
}

async function handleCheck(chatId) {
  const started = Date.now();
  const result = await checkOnce({ forced: true });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  await sendMessage(chatId, formatResult(result, elapsed), mainKeyboard());
}

async function checkOnce({ forced }) {
  ensureStateDefaults();
  const now = Date.now();
  let result = await fetchDirect();
  if (!result && (forced || now - (state.lastBrowserCheckAt || 0) >= config.browserEverySeconds * 1000)) {
    state.lastBrowserCheckAt = now;
    result = await fetchWithBrowser();
  }

  state.lastRunAt = new Date().toISOString();
  if (!result) {
    state.noDataCount = (state.noDataCount || 0) + 1;
    maybeNotifyNoData();
    saveState();
    return { ok: false, message: 'No finalized daily value found yet.' };
  }

  state.noDataCount = 0;
  state.lastSeen = result;
  const sig = signature(result);
  if (sig !== state.lastSignature) {
    const old = state.lastSignature;
    state.lastSignature = sig;
    saveState();
    if ((old || forced) && shouldNotify()) await broadcast(formatAlert(result, old ? 'NEW / CHANGED' : 'INITIAL'), mainKeyboard());
  } else {
    saveState();
  }
  return { ok: true, result };
}

async function fetchDirect() {
  let best = null;
  for (const url of config.dataUrls) {
    try {
      const json = await fetchJson(url);
      const candidate = chooseBest(extractCandidates(json, url));
      if (candidate) best = chooseBest([best, candidate].filter(Boolean));
    } catch (error) {
      state.lastErrors[url] = error.message;
    }
  }
  return best;
}

async function fetchWithBrowser() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (error) {
    state.lastErrors.playwright = `playwright import failed: ${error.message}`;
    return null;
  }

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36' });
  const page = await context.newPage();
  const candidates = [];
  const seenUrls = new Set();

  page.on('response', async (response) => {
    const url = response.url();
    const contentType = response.headers()['content-type'] || '';
    const interesting = /historical|history|mindshare|arena|chart|info.?market|leaderboard/i.test(url) || contentType.includes('json');
    if (!interesting || seenUrls.has(url)) return;
    seenUrls.add(url);
    try {
      const json = await response.json();
      const found = extractCandidates(json, url);
      if (found.length) {
        candidates.push(...found);
        state.discoveredSources[url] = { lastSeenAt: new Date().toISOString(), candidateCount: found.length };
      }
    } catch {}
  });

  try {
    await page.goto(KAITO_PAGE, { waitUntil: 'domcontentloaded', timeout: 45000 });
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 900);
      await page.waitForTimeout(Math.max(1000, Math.floor(config.browserWaitMs / 6)));
    }
    const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
    const domCandidate = extractFromVisibleHistoricalData(bodyText);
    if (domCandidate) candidates.push(domCandidate);
    const title = await page.title().catch(() => '');
    if (/just a moment|security verification|captcha/i.test(title)) state.lastErrors.browser = `Cloudflare challenge: ${title}`;
  } catch (error) {
    state.lastErrors.browser = error.message;
  } finally {
    await browser.close().catch(() => {});
  }

  return chooseBest(candidates);
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json,text/plain,*/*', Referer: KAITO_PAGE, Origin: 'https://kaito.ai', 'User-Agent': 'Mozilla/5.0' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function extractCandidates(root, sourceUrl) {
  const out = [];
  walk(root, (obj) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
    const keys = Object.keys(obj);
    const dateKey = keys.find((k) => /^(date|day|timestamp|time|created_at|createdAt|snapshot_timestamp|snapshotTimestamp)$/i.test(k));
    if (!dateKey) return;
    const valueKey = keys.find((k) => /final|daily|value|mindshare|score|percentage|percent|pct/i.test(k) && Number.isFinite(Number(obj[k])));
    if (!valueKey) return;
    const date = normalizeDate(obj[dateKey]);
    if (!date) return;
    let value = Number(obj[valueKey]);
    if (/mindshare|percent|percentage|pct/i.test(valueKey) && value > 0 && value <= 1) value *= 100;
    const finalized = keys.some((k) => /final/i.test(k) && truthy(obj[k])) || /final/i.test(valueKey) || !keys.some((k) => /intraday|preview/i.test(k));
    out.push({ date, value, valueRounded: Math.round(value * 100) / 100, valueKey, finalized, sourceUrl, rawKeys: keys.slice(0, 20) });
  });
  return out.filter((c) => c.finalized !== false);
}

function extractFromVisibleHistoricalData(text) {
  if (!/Historical Data/i.test(text) || !/Polymarket/i.test(text)) return null;
  const month = '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
  const re = new RegExp(`${month}\\s+\\d{1,2},\\s+20\\d{2}\\s+([0-9]+(?:\\.[0-9]+)?)%`, 'i');
  const match = text.match(re);
  if (!match) return null;
  const dateMatch = match[0].match(new RegExp(`${month}\\s+\\d{1,2},\\s+20\\d{2}`, 'i'));
  const date = normalizeDate(dateMatch?.[0]);
  if (!date) return null;
  const value = Number(match[2]);
  return { date, value, valueRounded: Math.round(value * 100) / 100, valueKey: 'visible_historical_data_mindshare_percent', finalized: true, sourceUrl: KAITO_PAGE, rawKeys: ['visibleText'] };
}

function walk(value, visit) {
  if (Array.isArray(value)) return value.forEach((v) => walk(v, visit));
  if (value && typeof value === 'object') {
    visit(value);
    for (const v of Object.values(value)) walk(v, visit);
  }
}

function chooseBest(candidates) {
  if (!candidates.length) return null;
  return candidates.sort((a, b) => new Date(b.date) - new Date(a.date) || score(b) - score(a))[0];
}
function score(c) { return (/final/i.test(c.valueKey) ? 10 : 0) + (/mindshare/i.test(c.valueKey) ? 5 : 0) + (/daily|value/i.test(c.valueKey) ? 2 : 0); }
function signature(r) { return `${r.date}|${r.valueRounded}|${r.valueKey}`; }
function normalizeDate(v) { if (typeof v === 'string') { const m = v.match(/^(\d{4}-\d{2}-\d{2})/); if (m) return m[1]; } const d = typeof v === 'number' ? new Date(v > 1e12 ? v : v * 1000) : new Date(v); return Number.isNaN(+d) ? '' : d.toISOString().slice(0, 10); }
function truthy(v) { return v === true || v === 1 || v === 'true' || v === 'finalized' || v === 'final'; }

function formatWelcome() {
  return [
    '🧠 <b>Kaito Mindshare Bot</b>',
    '<code>LIVE · POLYMARKET · DAILY SNAPSHOTS</code>',
    '',
    '🎯 <b>Latest</b>',
    state.lastSeen ? compactValueLine(state.lastSeen) : '<i>not loaded yet</i>',
    '',
    '📌 <b>Tracking</b>',
    'Project: <b>Polymarket</b>',
    'Dataset: <b>Historical Data</b>',
    'Source: <b>direct Kaito API</b>',
    '',
    settingsLine(),
  ].join('\n');
}

async function sendWelcome(chatId) {
  await sendMessage(chatId, formatWelcome(), mainKeyboard());
}

function formatAlert(r, prefix) {
  const title = prefix === 'NEW / CHANGED' ? '🚨 New finalized snapshot' : prefix === 'CURRENT' ? '🔎 Current snapshot' : '🧠 Kaito snapshot';
  return [
    `<b>${escapeHtml(title)}</b>`,
    '<code>INFO MARKETS ARENA</code>',
    '',
    `📅 <b>Date</b>: ${escapeHtml(r.date)}`,
    `💎 <b>Polymarket mindshare</b>: ${r.valueRounded.toFixed(2)}%`,
    '',
    `🧩 <b>Raw key</b>: <code>${escapeHtml(r.valueKey)}</code>`,
    `🕒 <b>Checked</b>: <code>${escapeHtml(formatDateTime(new Date()))}</code>`
  ].join('\n');
}

function formatResult(x, elapsed = '') {
  if (x.ok) {
    const suffix = elapsed ? `\n⚡ <b>Response</b>: <code>${escapeHtml(elapsed)}s</code>` : '';
    return formatAlert(x.result, 'CURRENT') + suffix;
  }

  return [
    '🟡 <b>No finalized value found</b>',
    '',
    escapeHtml(x.message),
    `🕒 <b>Last run</b>: <code>${escapeHtml(state.lastRunAt || 'never')}</code>`
  ].join('\n');
}

async function sendStatus(chatId) {
  const sourceHealth = state.noDataCount ? `🟡 Checking (${state.noDataCount})` : '🟢 OK';
  await sendMessage(chatId, [
    '📊 <b>Monitor Status</b>',
    '<code>KAITO MINDSHARE BOT</code>',
    '',
    state.lastSeen ? compactValueLine(state.lastSeen) : 'Latest: <i>not loaded yet</i>',
    '',
    `🕒 <b>Last run</b>: <code>${escapeHtml(state.lastRunAt || 'never')}</code>`,
    `⏱ <b>Base interval</b>: ${formatInterval(getPollSeconds())}`,
    `🚀 <b>Effective now</b>: ${formatInterval(getEffectivePollSeconds())}${isWaitingForNewDailySnapshot() ? ' · fast-watch' : ''}`,
    `🔔 <b>Notifications</b>: ${state.settings.notificationsEnabled ? 'ON' : 'OFF'}`,
    `🔌 <b>Direct sources</b>: ${config.dataUrls.length}`,
    `🩺 <b>Source health</b>: ${sourceHealth}`,
  ].join('\n'), mainKeyboard());
}

async function sendSources(chatId) {
  const directRows = config.dataUrls.map((url, index) => `${index + 1}. <code>${escapeHtml(shortUrl(url))}</code>`);
  const discoveredRows = Object.entries(state.discoveredSources).slice(-5).map(([url, meta]) => `${escapeHtml(meta.lastSeenAt)} · ${meta.candidateCount}x\n<code>${escapeHtml(shortUrl(url))}</code>`);
  await sendMessage(chatId, [
    '🧭 <b>Data Sources</b>',
    '<code>DIRECT API FIRST</code>',
    '',
    '⚡ <b>Primary direct API</b>',
    directRows.length ? directRows.join('\n') : '<i>none</i>',
    '',
    '🛟 <b>Browser-discovered fallbacks</b>',
    discoveredRows.length ? discoveredRows.join('\n\n') : '<i>none yet</i>'
  ].join('\n'), sourceKeyboard());
}

async function sendSettings(chatId) {
  ensureStateDefaults();
  await sendMessage(chatId, [
    '⚙️ <b>Settings</b>',
    '<code>ALERTS · SPEED · CONTROL</code>',
    '',
    `🔔 <b>Notifications</b>: ${state.settings.notificationsEnabled ? 'ON' : 'OFF'}`,
    `⏱ <b>Base interval</b>: ${formatInterval(getPollSeconds())}`,
    `🚀 <b>Fast-watch</b>: ${isWaitingForNewDailySnapshot() ? 'ACTIVE · 15s until new day appears' : 'standby'}`,
    '',
    'Choose a base interval or toggle alerts below. Fast-watch automatically checks every 15s when a new daily snapshot is due.'
  ].join('\n'), settingsKeyboard());
}

function maybeNotifyNoData() {
  if (!config.notifyNoDataEveryMinutes || !state.noDataCount || !shouldNotify()) return;
  const due = Date.now() - (state.lastNoDataNotifyAt || 0) >= config.notifyNoDataEveryMinutes * 60000;
  if (due) { state.lastNoDataNotifyAt = Date.now(); broadcast(`🟡 Kaito check: no finalized daily value found yet. Last error: ${state.lastErrors.browser || 'none'}`).catch(console.error); }
}
async function broadcast(text, replyMarkup = mainKeyboard()) { for (const id of chatIds()) await sendMessage(id, text, replyMarkup); }
function chatIds() { return [...new Set([config.chatId, ...Object.keys(state.chatIds || {})].filter(Boolean).map(String))]; }
async function sendMessage(chatId, text, replyMarkup) {
  return telegram('sendMessage', {
    chat_id: chatId,
    text: text.slice(0, 3900),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {})
  });
}

async function setupTelegramCommands() {
  await telegram('setMyCommands', {
    commands: [
      { command: 'start', description: 'Open control panel' },
      { command: 'status', description: 'Show latest snapshot' },
      { command: 'check', description: 'Force check now' },
      { command: 'settings', description: 'Alerts and interval' },
      { command: 'sources', description: 'Show data sources' }
    ]
  }).catch((error) => console.error(`[${APP}] setMyCommands failed: ${error.message}`));
}

function mainKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '🔄 Refresh', callback_data: 'check' },
        { text: '📊 Status', callback_data: 'status' }
      ],
      [
        { text: '⚙️ Settings', callback_data: 'settings' },
        { text: '🧭 Sources', callback_data: 'sources' }
      ],
      [
        { text: '🌐 Kaito page', url: KAITO_PAGE }
      ]
    ]
  };
}

function settingsKeyboard() {
  const enabled = state.settings.notificationsEnabled;
  return {
    inline_keyboard: [
      [{ text: enabled ? '🔕 Turn notifications OFF' : '🔔 Turn notifications ON', callback_data: 'toggle_notifications' }],
      INTERVAL_OPTIONS.map((seconds) => ({
        text: `${seconds === getPollSeconds() ? '✓ ' : ''}${formatInterval(seconds)}`,
        callback_data: `interval:${seconds}`
      })),
      [{ text: '📊 Status', callback_data: 'status' }, { text: '🏠 Menu', callback_data: 'menu' }]
    ]
  };
}

function sourceKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🌐 Open Kaito page', url: KAITO_PAGE }],
      [{ text: '⚙️ Settings', callback_data: 'settings' }, { text: '🏠 Menu', callback_data: 'menu' }]
    ]
  };
}

function compactValueLine(r) {
  return `💎 <b>${r.valueRounded.toFixed(2)}%</b> · 📅 <code>${escapeHtml(r.date)}</code>`;
}

function settingsLine() {
  return `🔔 Alerts: <b>${state.settings.notificationsEnabled ? 'ON' : 'OFF'}</b> · ⏱ Base: <b>${formatInterval(getPollSeconds())}</b> · 🚀 Now: <b>${formatInterval(getEffectivePollSeconds())}</b>`;
}

function getPollSeconds() {
  ensureStateDefaults();
  return state.settings.pollSeconds || config.pollSeconds;
}

function getEffectivePollSeconds() {
  return isWaitingForNewDailySnapshot() ? Math.min(getPollSeconds(), 15) : getPollSeconds();
}

function isWaitingForNewDailySnapshot() {
  const latestDate = state.lastSeen?.date;
  if (!latestDate) return true;
  return latestDate < currentKaitoTargetDate();
}

function currentKaitoTargetDate() {
  return new Date().toISOString().slice(0, 10);
}

function shouldNotify() {
  ensureStateDefaults();
  return state.settings.notificationsEnabled !== false;
}

function ensureStateDefaults() {
  state.chatIds ||= {};
  state.discoveredSources ||= {};
  state.lastErrors ||= {};
  state.settings ||= {};
  if (typeof state.settings.notificationsEnabled !== 'boolean') state.settings.notificationsEnabled = true;
  if (!INTERVAL_OPTIONS.includes(Number(state.settings.pollSeconds))) state.settings.pollSeconds = config.pollSeconds;
}

function formatInterval(seconds) {
  return seconds >= 60 ? `${seconds / 60}m` : `${seconds}s`;
}

function formatDateTime(date) {
  return date.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

function shortUrl(url) {
  return url.length > 120 ? url.slice(0, 117) + '...' : url;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>\"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}
async function telegram(method, payload) {
  const response = await fetch(`${TELEGRAM_API}/bot${config.token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.ok === false) throw new Error(`${method} failed: ${response.status} ${JSON.stringify(json)}`);
  return json;
}
function loadState() { try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return { telegramOffset: 0, chatIds: {}, discoveredSources: {}, lastErrors: {}, settings: {} }; } }
function saveState() { mkdirSync(dirname(new URL(STATE_FILE).pathname), { recursive: true }); writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); }
function loadDotEnv() { const p = new URL('../.env', import.meta.url); if (!existsSync(p)) return; for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['\"]|['\"]$/g, ''); } }
function num(v, fallback) { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : fallback; }
function list(v) { return (v || '').split(',').map((s) => s.trim()).filter(Boolean); }
