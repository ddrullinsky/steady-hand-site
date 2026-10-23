// Building blocks shared by the logger's views. The DOM helper h() and the basic
// icons come from the dashboard (shared/util.js); the extra icons are here.
import { h, icon as baseIcon } from '../shared/util.js';
import { state } from './data.js';

const ICONS = {
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  person: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  people: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4',
  case: 'M10 2h4a2 2 0 0 1 2 2v2H8V4a2 2 0 0 1 2-2zM3 6h18v14H3zM12 10v6M9 13h6',
  branch: 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  checklist: 'M9 6h12M9 12h12M9 18h12M3 6l1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17',
  seal: 'M12 2l2.4 2.2 3.2-.5.9 3.1 2.9 1.5-1 3.1 1 3.1-2.9 1.5-.9 3.1-3.2-.5L12 22l-2.4-2.2-3.2.5-.9-3.1-2.9-1.5 1-3.1-1-3.1 2.9-1.5.9-3.1 3.2.5zM8.5 12l2.5 2.5 4.5-5',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  target: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z',
  lock: 'M5 11h14v11H5zM8 11V7a4 4 0 0 1 8 0v4',
  cloudUp: 'M16 16l-4-4-4 4M12 12v9M20.4 18.4A5 5 0 0 0 18 9h-1.3A8 8 0 1 0 3 16.3',
  cloudOff: 'M22.6 17.6A5 5 0 0 0 18 10h-1.3A8 8 0 0 0 9 4.1M5 5a8 8 0 0 0 4 15h9a5 5 0 0 0 1.7-.3M1 1l22 22',
  cloudOk: 'M18 10h-1.3A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10zM9 15l2 2 4-4',
  cloudErr: 'M18 10h-1.3A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10zM12 11v3M12 17h.01',
  megaphone: 'M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1zM16 8a5 5 0 0 1 0 8M19 5a9 9 0 0 1 0 14',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  repeat: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  medal: 'M12 22a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM8.2 9.2L5 2h4l3 6M15.8 9.2L19 2h-4l-3 6M12 12l1.2 2.4 2.6.4-1.9 1.8.5 2.6-2.4-1.2-2.4 1.2.5-2.6-1.9-1.8 2.6-.4z',
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3a3 3 0 0 1-3 4M7 5H4a3 3 0 0 0 3 4',
  flame: 'M12 22c4 0 7-3 7-7 0-5-4-7-5-11-2 3-3 4-3 7-1-1-2-2-2-4-2 2-4 5-4 8 0 4 3 7 7 7z',
  hand: 'M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8a8 8 0 0 0 16 0v-3a2 2 0 0 0-4 0',
  more: 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  external: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  userX: 'M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M8.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM18 8l5 5M23 8l-5 5',
  sync: 'M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15',
  filter: 'M22 3H2l8 9.5V19l4 2v-8.5z',
  share: 'M12 3v12M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5',
  doc: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h8',
  help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
  masks: 'M2 4h9v6a4.5 4.5 0 0 1-9 0zM13 10h9v6a4.5 4.5 0 0 1-9 0zM5 8h.01M8 8h.01M16 14h.01M19 14h.01',
  sparkles: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  plusCircle: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 8v8M8 12h8',
};

/** Same look as util.icon, with the logger's extra shapes. */
export function icon(name, size = 18) {
  const svg = baseIcon(ICONS[name] ? 'x' : name, size);
  if (ICONS[name]) svg.querySelector('path').setAttribute('d', ICONS[name]);
  return svg;
}

export function card(title, iconName, ...children) {
  let accessory = null;
  if (children[0] && children[0].accessory !== undefined) accessory = children.shift().accessory;
  return h('section', { class: 'card' },
    title ? h('h2', { class: 'card-head' }, iconName ? icon(iconName) : null, title,
      accessory ? h('span', { class: 'acc' }, accessory) : null) : null,
    ...children);
}

/** One-tap pill. aria-pressed carries the selected state for screen readers and CSS. */
export function chip(label, selected, onclick, { large = false, tint = '', iconName = null, cls = '' } = {}) {
  return h('button', {
    type: 'button', class: `chip ${large ? 'large' : ''} ${tint} ${cls}`, 'aria-pressed': selected ? 'true' : 'false', onclick,
  }, iconName ? icon(iconName, 15) : null, label);
}

export function toggleSwitch(checked, onchange, label) {
  return h('label', { class: 'switch' },
    h('input', { type: 'checkbox', role: 'switch', checked, 'aria-label': label, onchange: (e) => onchange(e.target.checked) }),
    h('span'));
}

export function tickmark(on) {
  const t = h('span', { class: `tickmark ${on ? 'on' : ''}` });
  if (on) t.append(icon('check', 16));
  return t;
}

// ---------------------------------------------------------------------------
// Sheets: full-screen layers with their own history entry, so the phone's back
// button closes the sheet instead of leaving the page underneath.
// ---------------------------------------------------------------------------

const openSheets = [];

window.addEventListener('popstate', () => {
  // A back press closes the top sheet (its history entry is gone).
  const top = openSheets[openSheets.length - 1];
  if (top && history.state?.sheet !== top.id) closeTop(false);
});

function closeTop(viaHistory) {
  const top = openSheets.pop();
  if (!top) return;
  top.el.remove();
  top.onClose?.();
  if (viaHistory && history.state?.sheet === top.id) history.back();
}

/** Opens a full-screen sheet; `build(close)` returns its content. Resolves when closed. */
export function openSheet(build, { onClose } = {}) {
  const id = `sheet-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  history.pushState({ sheet: id }, '');
  const el = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' });
  const entry = { id, el, onClose };
  openSheets.push(entry);
  const close = () => { if (openSheets.includes(entry)) { while (openSheets[openSheets.length - 1] !== entry) closeTop(true); closeTop(true); } };
  el.append(...[build(close)].flat().filter(Boolean));
  document.getElementById('overlays').append(el);
  el.querySelector('[autofocus]')?.focus();
  return close;
}

/** Closes every sheet without touching history (used when the route changes). */
export function closeAllSheets() {
  while (openSheets.length) {
    const s = openSheets.pop();
    s.el.remove();
    s.onClose?.();
  }
}

/** A bottom action sheet. options: [{label, value, danger}]. Resolves with the value or null. */
export function actionSheet(options, title) {
  return new Promise((resolve) => {
    const done = (v) => { el.remove(); resolve(v); };
    const el = h('div', { class: 'action-sheet', onclick: (e) => { if (e.target === el) done(null); } },
      h('div', { class: 'panel', role: 'menu', 'aria-label': title || 'Actions' },
        h('div', { class: 'opts' }, options.map((o) =>
          h('button', { type: 'button', role: 'menuitem', class: o.danger ? 'danger' : '', onclick: () => done(o.value) }, o.label))),
        h('button', { type: 'button', class: 'cancel', onclick: () => done(null) }, 'Cancel')));
    document.getElementById('overlays').append(el);
    el.querySelector('button')?.focus();
  });
}

// ---------------------------------------------------------------------------
// Sync badge (CaseListView.SyncBadge)
// ---------------------------------------------------------------------------

export function syncValue() {
  const s = state.sync;
  if (s.phase === 'syncing') return 'syncing';
  if (s.pending === 0) return 'synced';
  if (s.phase === 'offline' || !state.online) return 'offline';
  if (s.phase === 'error') return 'error';
  return 'pending';
}

export function syncBadge(onTap) {
  const v = syncValue();
  const n = state.sync.pending;
  const map = {
    synced: ['cloudOk', 'All cases synced'],
    syncing: ['sync', 'Syncing'],
    offline: ['cloudOff', `Offline. ${n} ${n === 1 ? 'case' : 'cases'} will sync when you're back online.`],
    error: ['cloudErr', "Some cases couldn't sync. Tap to retry."],
    pending: ['cloudUp', `${n} ${n === 1 ? 'case' : 'cases'} waiting to sync`],
  };
  const [ic, label] = map[v];
  return h('button', { type: 'button', class: `syncbadge ${v}`, 'aria-label': label, title: label, onclick: onTap, dataset: { sync: v } },
    icon(ic, 20), n > 0 ? h('span', { class: 'num' }, String(n)) : null);
}

// ---------------------------------------------------------------------------
// Navigation. Screens opened from inside the app go back with history.back(), so
// the phone's back button and Cancel do the same thing. A screen opened directly
// (e.g. the home-screen "Log case" shortcut) returns to the case list instead.
// ---------------------------------------------------------------------------

let openedFromApp = false;

export function navigate(hash) {
  openedFromApp = true;
  location.hash = hash;
}

/** Called by the router on every route that is not a sub-screen. */
export function resetNavigation() { openedFromApp = false; }

/** Leaves the current sub-screen. Resolves once the previous route is showing. */
export function leave(fallback = '#/cases') {
  return new Promise((resolve) => {
    window.addEventListener('hashchange', () => setTimeout(resolve, 0), { once: true });
    if (openedFromApp) { openedFromApp = false; history.back(); } else location.replace(fallback);
  });
}
