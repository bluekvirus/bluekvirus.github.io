export const THEME_BY_WEEKDAY = { 1: 'dune', 2: 'w40k', 3: 'dune', 4: 'w40k', 5: 'dune', 6: 'w40k', 7: 'dune' };
export const IMPLEMENTED = new Set(['dune']);
const DEFAULT_THEME = 'dune';

export function isoWeekday(date) {
  const d = date.getDay(); // Sun=0..Sat=6
  return d === 0 ? 7 : d;
}

export function resolveTheme({ date, search, byWeekday = THEME_BY_WEEKDAY, implemented = IMPLEMENTED }) {
  const forced = new URLSearchParams(search).get('theme');
  if (forced && implemented.has(forced)) return forced;
  const theme = byWeekday[isoWeekday(date)];
  return implemented.has(theme) ? theme : DEFAULT_THEME;
}

export function showFallback(fallbackEl) {
  fallbackEl.classList.add('visible');
  document.body.classList.add('fallback');
  const hud = document.getElementById('hud');
  const scene = document.getElementById('scene');
  if (hud) hud.style.display = 'none';
  if (scene) scene.style.display = 'none';
}

export async function boot(container, fallbackEl) {
  try {
    const theme = resolveTheme({ date: new Date(), search: window.location.search });
    const mod = await import(`../themes/${theme}/main.js`);
    await mod.mount(container);
  } catch (err) {
    console.warn('[router] theme mount failed, showing fallback:', err);
    showFallback(fallbackEl);
  }
}
