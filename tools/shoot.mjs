// Phone-sized screenshots of the Ambrose app for the site and the Play listing, always with
// made-up data. Run the app's dev server first (the app repo), then:
//   node tools/shoot.mjs [app url] [out dir] [only these shots, comma-separated]
// Every /api call is answered here with "no source connected", so the app shows its demo data
// and nothing real can reach a picture. Needs Chrome; nothing to install.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const APP = process.argv[2] ?? 'http://localhost:5299';
const OUT = process.argv[3] ?? 'img';
const ONLY = process.argv[4]?.split(',');
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;
// a Pixel 9a's screen in CSS pixels, at 3x so the pictures stay sharp (1236 × 2745)
const PHONE = { width: 412, height: 915, deviceScaleFactor: 3, mobile: true };

// each shot starts on Launch and takes its steps: tap something by its words (or its aria-label),
// scroll the page down, or wait
const SHOTS = [
  // Launch sometimes asks about last night in a bubble over the rings: closed when it's there
  { name: 'launch', steps: [{ tap: 'Close', optional: true }] },
  { name: 'launch-day', steps: [{ tap: 'Close', optional: true }, { scroll: 1500 }] },
  { name: 'energy', steps: [{ tap: 'Energy' }] },
  { name: 'food', steps: [{ tap: 'Food' }] },
  { name: 'probe', steps: [{ tap: 'Probe' }] },
  { name: 'thrust', steps: [{ tap: 'Thrust' }] },
  { name: 'orbit', demo: true, steps: [{ tap: 'Orbit' }] },
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
// a shot with `demo: true` is taken with no watch connected, so the app draws its built-in demo
// (Orbit's needs a week of step history the made-up summary doesn't have)
const LIVE = {};
let demoShot = false;
const status = () => (demoShot ? API['/api/status'] : { ...API['/api/status'], ...LIVE });
// what the web build asks its server for besides: answered with the same made-up meals
const meals = () => API['/api/summary']?.meals ?? [];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'ambrose-shoot-'));
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
    const lists = { '/api/meals': meals, '/api/foods/frequent': () => [] };
    const known = path in API || path in lists;
    const body = path in lists ? lists[path]() : path === '/api/status' ? status() : (API[path] ?? {});
    send('Fetch.fulfillRequest', {
      requestId: m.params.requestId,
      responseCode: known ? 200 : 404,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      body: Buffer.from(JSON.stringify(body)).toString('base64'),
    });
  }
});

const run = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result.value;

// the smallest element whose words (or aria-label) are exactly this, tapped where it shows
const tap = (label) =>
  run(`(() => {
    const want = ${JSON.stringify(label)};
    const all = [...document.querySelectorAll('body *')].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (e.getAttribute('aria-label') === want || e.textContent.trim() === want);
    });
    const e = all.find((a) => !all.some((b) => b !== a && a.contains(b))) ?? all[0];
    if (!e) return false;
    e.scrollIntoView({ block: 'center' });
    (e.closest('button, a, [role=button]') ?? e).click();
    return true;
  })()`);

const scroll = (y) =>
  run(`(document.scrollingElement.scrollTo(0, ${y}), [...document.querySelectorAll('*')]
    .filter((e) => e.scrollHeight > e.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(e).overflowY))
    .forEach((e) => e.scrollTo(0, ${y})))`);

await send('Page.enable');
await send('Runtime.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*', requestStage: 'Request' }] });
await send('Emulation.setDeviceMetricsOverride', PHONE);
await send('Emulation.setTouchEmulationEnabled', { enabled: true });

// a first load, so the dev server has its modules ready before any picture
await send('Page.navigate', { url: `${APP}/?demo` });
await wait(12000);

// Then the app is shown as if a watch were connected, with made-up days: the app's own demo
// (core/demo.ts) and the made-up Energy day from its palette page (palette.tsx), read up to now.
// This is what draws the live screens (the Energy ring and page) rather than the older demo tiles.
const summary = (
  await send('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `(async () => {
      const { demoData } = await import('/src/core/demo.ts');
      const { energyDay, withNight } = await import('/src/core/energy.ts');
      const d = new Date();
      d.setHours(7, 0, 0, 0);
      const at = (h) => +d + (h - 7) * 3600e3;
      // read up to mid-afternoon at the latest, so the globe isn't drained to the evening
      const now = Math.min(Date.now(), at(15.5));
      const mins = [];
      for (let t = at(7); t < now; t += 60e3) {
        const h = 7 + (t - at(7)) / 3600e3;
        const bpm = h >= 17.5 && h < 18.33 ? 150 : h >= 13 && h < 13.5 ? 56 : h >= 8 && h < 8.4 ? 112 : 74 + 6 * Math.sin(h * 2.3);
        mins.push([t, bpm]);
      }
      const day = energyDay({
        start: 72, wake: at(7), now, mins, rest: 52, max: 188,
        sleeps: [[at(14.5), at(15)]].filter(([a]) => a < now),
        still: (t) => !(t >= at(8) && t < at(8.4)) && !(t >= at(17.5) && t < at(18.33)),
        stress: (t) => (t >= at(10) && t < at(11.5) ? 85 : 45),
      });
      const s = demoData().s;
      // training load: 60 made-up days
      const days = [];
      let atl = 60, ctl = 60;
      for (let i = 59; i >= 0; i--) {
        const dd = new Date(d); dd.setDate(dd.getDate() - i);
        const date = dd.toLocaleDateString('sv');
        // about four sessions a week, on no fixed days, and easy days in between
        const r = ((i * 2654435761) >>> 0) % 1000 / 1000;
        const trimp = i === 0 ? 95 : r < 0.55 ? 110 + r * 90 : 25 + r * 30;
        atl += (trimp - atl) / 7; ctl += (trimp - ctl) / 42;
        days.push({ date, trimp, atl, ctl, form: ctl - atl, acwr: atl / ctl });
      }
      // three made-up meals today, from the app's own food table, kept the way the app keeps them
      const { searchFoods, dietFacts, scale } = await import('/src/core/food.ts');
      const { dayIntake } = await import('/src/core/diet.ts');
      const MEALS = [
        { h: 7.6, name: 'Skyr bowl', foods: [['skyr', 250], ['blueberries', 100], ['oats', 40], ['walnuts', 15]] },
        { h: 12.75, name: 'Lentil soup, rye bread', foods: [['lentils', 200], ['carrot', 80], ['rye bread', 60]] },
        { h: 15.25, name: 'Apple and almonds', foods: [['apple', 150], ['almonds', 20]] },
      ];
      const meals = [];
      for (const [n, m] of MEALS.entries()) {
        if (at(m.h) > now) continue;
        const items = [];
        for (const [q, grams] of m.foods) {
          const f = (await searchFoods(q, 1))[0];
          if (f) items.push({ name: f.name, foodId: f.id, source: f.source, grams, portion: grams + ' g', per100: f.per100, nutrients: scale(f.per100, grams) });
        }
        const totals = {};
        for (const it of items) for (const [k, v] of Object.entries(it.nutrients)) totals[k] = (totals[k] ?? 0) + v;
        const facts = await Promise.all(items.map((i) => dietFacts(i.foodId)));
        meals.push({ id: n + 1, eatenAt: new Date(at(m.h)).toISOString(), name: m.name, items, totals, note: '', source: 'search', diet: dayIntake(items, facts) });
      }
      const load = { available: true, source: 'minutes', sex: 'male', hrMax: 188, hrMaxMethod: 'age', calibrating: false, latest: days[days.length - 1], days };
      return { ...s, load, meals, energy: { ...withNight(day, at(-0.92), 18), bedUsual: 23 * 60 + 10 } };
    })()`,
  })
).result.value;
if (!summary) throw new Error('could not build the made-up summary');
Object.assign(LIVE, { connected: true, connectedAt: Date.now() / 1000 - 90 * 86400, lastSyncAt: Math.round(Date.now() / 1000) });
API['/api/summary'] = summary;

for (const theme of ['dark', 'light']) {
  const script = await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('eon:tour-done', '1'); localStorage.setItem('eon:setup-done', '1'); localStorage.setItem('eon:theme', '${theme}'); } catch {}`,
  });
  for (const shot of SHOTS.filter((s) => !ONLY || ONLY.includes(s.name))) {
    demoShot = !!shot.demo;
    await send('Page.navigate', { url: `${APP}/?demo` });
    await wait(7000); // the launch dive and the first draw
    for (const step of shot.steps) {
      if (step.tap && !(await tap(step.tap)) && !step.optional) console.warn(`${shot.name}: nothing called "${step.tap}"`);
      if (step.scroll) await scroll(step.scroll);
      await wait(step.wait ?? 3000);
    }
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    const file = join(OUT, `${shot.name}-${theme}.png`);
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
