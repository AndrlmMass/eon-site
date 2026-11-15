// The page's three small behaviours: each cut-out from the app follows the visitor's light or dark
// setting, the switchers move through their examples, and sections rise into view.

// ---- pictures in the visitor's theme ----
const light = matchMedia('(prefers-color-scheme: light)');
const theme = () => {
  const t = light.matches ? 'light' : 'dark';
  for (const img of document.querySelectorAll('img[data-p]')) img.src = `img/cards/${img.dataset.p}-${t}.png`;
};
theme();
light.addEventListener('change', theme);

// ---- switchers: tabs that change the picture, moving on by themselves until someone chooses ----
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
for (const sw of document.querySelectorAll('.switch')) {
  // a switcher's tabs sit inside it, or (data-tabs-before) in the text beside it
  const tabs = [...(sw.querySelector('.tabs') ?? sw.closest('.wrap').querySelector('.tabs')).querySelectorAll('button')];
  const slides = [...sw.querySelectorAll('.slide')];
  const ms = Number(sw.dataset.auto) || 5000;
  let at = 0;
  let timer = null;
  let chosen = false;
  const show = (i) => {
    at = i;
    tabs.forEach((t, k) => {
      t.setAttribute('aria-selected', String(k === i));
      t.classList.remove('run');
    });
    slides.forEach((s, k) => s.classList.toggle('on', k === i));
  };
  const run = () => {
    if (chosen || still) return;
    const tab = tabs[at];
    // the bar under the tab fills while it waits
    void tab.offsetWidth;
    tab.style.setProperty('--ms', `${ms}ms`);
    tab.classList.add('run');
    clearTimeout(timer);
    timer = setTimeout(() => {
      show((at + 1) % slides.length);
      run();
    }, ms);
  };
  tabs.forEach((t, i) =>
    t.addEventListener('click', () => {
      chosen = true;
      clearTimeout(timer);
      show(i);
    }),
  );
  // only moves while it's on screen
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting) run();
    else {
      clearTimeout(timer);
      tabs[at].classList.remove('run');
    }
  }, { threshold: 0.4 }).observe(sw);
  show(0);
}

// ---- sections rise a little as they come into view ----
if (!still && 'IntersectionObserver' in window) {
  const io = new IntersectionObserver(
    (es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add('in'), io.unobserve(e.target))),
    { rootMargin: '0px 0px -8% 0px' },
  );
  for (const el of document.querySelectorAll('.rise')) io.observe(el);
} else for (const el of document.querySelectorAll('.rise')) el.classList.add('in');
