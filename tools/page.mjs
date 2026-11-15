// Full-length pictures of the site itself, at phone and desktop width, dark and light, for a look
// before anything goes live:  node tools/page.mjs [http://localhost:5297] [out-dir]
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SITE = process.argv[2] ?? 'http://localhost:5297';
const OUT = process.argv[3] ?? 'preview';
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9334;
const PAGES = ['', 'privacy.html'];
const SIZES = [
  { name: 'phone', width: 412, height: 915, deviceScaleFactor: 1.6, mobile: true },
  { name: 'desktop', width: 1366, height: 900, deviceScaleFactor: 1, mobile: false },
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'eon-page-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--hide-scrollbars', 'about:blank']);

let url;
for (let i = 0; i < 50 && !url; i++) {
  try {
    url = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl;
  } catch {}
  if (!url) await wait(200);
}
const ws = new WebSocket(url);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  const p = pending.get(m.id);
  if (p) (pending.delete(m.id), m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result));
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

await send('Page.enable');
for (const size of SIZES) {
  const { name, ...metrics } = size;
  await send('Emulation.setDeviceMetricsOverride', metrics);
  for (const theme of ['dark', 'light']) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    for (const page of PAGES) {
      await send('Page.navigate', { url: `${SITE}/${page}` });
      await wait(1500);
      // a viewport as tall as the page, so every lazy picture loads and nothing repeats
      const tall = await send('Runtime.evaluate', { expression: 'document.documentElement.scrollHeight', returnByValue: true });
      await send('Emulation.setDeviceMetricsOverride', { ...metrics, height: tall.result.value });
      await wait(2500);
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      await send('Emulation.setDeviceMetricsOverride', metrics);
      const file = join(OUT, `${(page || 'index').replace('.html', '')}-${name}-${theme}.png`);
      writeFileSync(file, Buffer.from(data, 'base64'));
      console.log(file);
    }
  }
}
ws.close();
chrome.kill();
await wait(500);
try {
  rmSync(profile, { recursive: true, force: true });
} catch {}
