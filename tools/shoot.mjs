// Phone-sized screenshots of the EON app for the site and the Play listing, always with made-up
// data. Run the app's dev server first (the EON repo, port 5281 by default), then:
//   node tools/shoot.mjs [http://localhost:5281]
// Every /api call is answered here with "no source connected", so the app shows its demo data
// and nothing real can reach a picture. Needs Chrome; nothing to install.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const APP = process.argv[2] ?? 'http://localhost:5281';
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;
// a Pixel 9a's screen in CSS pixels, at 3x so the pictures stay sharp (1236 × 2745)
const PHONE = { width: 412, height: 915, deviceScaleFactor: 3, mobile: true };

// which tab, as its label in the tab bar ('' stays on Launch), in both themes
const SHOTS = [
  { name: 'launch', tab: '' },
  { name: 'launch-day', tab: '', scroll: 1250 },
  { name: 'probe', tab: 'Probe' },
  { name: 'thrust', tab: 'Thrust' },
  { name: 'orbit', tab: 'Orbit' },
];

const API = {
  '/api/status': {
    configured: true,
    ai: false,
    autoSyncMinutes: 0,
    connected: false,
    connectedAt: null,
    lastSyncAt: null,
    lastSync: null,
    counts: {},
    sync: { status: 'done' },
  },
  '/api/profile': { birth_year: 1993, sex: 'male', max_hr: null, name: 'Alex' },
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'eon-shoot-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--hide-scrollbars',
  '--no-first-run',
  'about:blank',
]);

async function target() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await wait(200);
  }
  throw new Error('Chrome did not start');
}

const ws = new WebSocket(await target());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
  } else if (m.method === 'Fetch.requestPaused') {
    const path = new URL(m.params.request.url).pathname;
    const body = API[path] ?? {};
    send('Fetch.fulfillRequest', {
      requestId: m.params.requestId,
      responseCode: path in API ? 200 : 404,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      body: Buffer.from(JSON.stringify(body)).toString('base64'),
    });
  }
});

await send('Page.enable');
await send('Runtime.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*', requestStage: 'Request' }] });
await send('Emulation.setDeviceMetricsOverride', PHONE);
await send('Emulation.setTouchEmulationEnabled', { enabled: true });

const click = (label) =>
  send('Runtime.evaluate', {
    expression: `(() => { const b = [...document.querySelectorAll('button, a')].find((e) => e.textContent.trim() === ${JSON.stringify(label)}); b?.click(); return !!b; })()`,
    returnByValue: true,
  });

for (const theme of ['dark', 'light']) {
  const script = await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('eon:tour-done', '1'); localStorage.setItem('eon:setup-done', '1'); localStorage.setItem('eon:theme', '${theme}'); } catch {}`,
  });
  for (const shot of SHOTS) {
    await send('Page.navigate', { url: `${APP}/?demo` });
    await wait(7000); // the launch dive and the first draw
    if (shot.tab) {
      const found = (await click(shot.tab)).result.value;
      if (!found) console.warn(`no "${shot.tab}" tab`);
      await wait(3500);
    }
    if (shot.scroll) {
      await send('Runtime.evaluate', { expression: `(document.scrollingElement.scrollTo(0, ${shot.scroll}), [...document.querySelectorAll('*')].filter((e) => e.scrollHeight > e.clientHeight + 40 && getComputedStyle(e).overflowY.match(/auto|scroll/)).forEach((e) => e.scrollTo(0, ${shot.scroll})))` });
      await wait(1500);
    }
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    const file = `img/${shot.name}-${theme}.png`;
    writeFileSync(file, Buffer.from(data, 'base64'));
    console.log(file);
  }
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: script.identifier });
}

ws.close();
chrome.kill();
await wait(500);
try {
  rmSync(profile, { recursive: true, force: true });
} catch {}
