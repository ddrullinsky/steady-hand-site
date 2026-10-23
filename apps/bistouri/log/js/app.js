// Bistouri web logger: sign-in, first run, tabs and routing (ios/Bistouri/BistouriApp.swift).
// Routes: #/cases  #/progress  #/settings  #/case/new  #/case/<id>  #/case/<id>/copy
//         #/join  #/privacy  #/delete-account
import { h, clear } from '../shared/util.js';
import {
  sb, state, onChange, phase, didSignIn, didSignOut, storedUser, refreshAll, refreshAccount, pushPending,
  activeProgram, signOut,
} from './data.js';
import { icon, syncBadge, closeAllSheets, resetNavigation, leave } from './ui.js';
import { renderSignIn } from './views/signin.js';
import { renderProgramPicker } from './views/onboarding.js';
import { renderCases, showSavedSheet } from './views/cases.js';
import { renderCaseForm } from './views/caseForm.js';
import { renderProgress } from './views/progress.js';
import { renderSettings, renderDeleteAccount, renderPrivacy } from './views/settings.js';
import { showCelebration, showAnnouncementQueue } from './views/achievements.js';

const root = document.getElementById('app');

const TABS = [
  { id: 'cases', label: 'Cases', icon: 'list', title: 'Cases', render: renderCases },
  { id: 'progress', label: 'Progress', icon: 'target', title: 'Progress', render: renderProgress },
  { id: 'settings', label: 'Settings', icon: 'gear', title: 'Settings', render: renderSettings },
];

let current = null;      // { name, args }
let mainEl = null;       // the tab's content area, re-drawn on data changes
let badgeHost = null;
let authResolved = false;

// ---------------------------------------------------------------------------
// Auth lifecycle
// ---------------------------------------------------------------------------

// supabase-js asks callers not to await other calls inside this callback.
sb.auth.onAuthStateChange((event, session) => setTimeout(() => onAuth(event, session), 0));

async function onAuth(event, session) {
  authResolved = true;
  if (session?.user) {
    if (state.user?.id === session.user.id) {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') pushPending();
      return;
    }
    await didSignIn(session.user);
    route();
    return;
  }
  if (event === 'INITIAL_SESSION') {
    // An expired session can't be refreshed without signal. Open with the stored
    // account; supabase-js refreshes the token once the connection is back.
    const stored = storedUser();
    if (stored) {
      await didSignIn(stored);
      route();
      return;
    }
  }
  if (state.user) didSignOut();
  route();
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  return { name: parts[0] || 'cases', args: parts.slice(1) };
}

function route() {
  if (!authResolved) return;
  closeAllSheets();
  const p = phase();
  if (p === 'signedOut') { current = null; mainEl = null; return renderSignIn(root); }
  if (p === 'loadingAccount') { current = null; mainEl = null; return renderLoading(); }
  if (p === 'needsProgram') {
    current = { name: 'onboarding' };
    mainEl = null;
    return renderProgramPicker(root, { mode: 'onboarding' });
  }

  current = parseRoute();
  const { name, args } = current;
  if (name === 'case') {
    const id = args[0];
    const mode = id === 'new' ? { kind: 'new' } : args[1] === 'copy' ? { kind: 'prefill', id } : { kind: 'edit', id };
    mainEl = null;
    return renderCaseForm(root, mode, { onSaved: afterSave });
  }
  if (name === 'join') {
    mainEl = null;
    clear(root);
    const screen = h('div', { class: 'screen' },
      h('header', { class: 'topbar' },
        h('div', { class: 'left' }, h('button', { type: 'button', class: 'toplink', onclick: () => leave('#/settings') }, icon('back'), 'Settings')),
        h('h1', null, 'Join a program'), h('div', { class: 'right' })));
    const body = h('div');
    screen.append(body);
    root.append(screen);
    return renderProgramPicker(body, { mode: 'join', onDone: () => leave('#/settings') });
  }
  if (name === 'privacy') { mainEl = null; return renderPrivacy(root); }
  if (name === 'delete-account') { mainEl = null; return renderDeleteAccount(root); }

  resetNavigation();
  const tab = TABS.find((t) => t.id === name) || TABS[0];
  current = { name: tab.id, args: [] };
  renderTabShell(tab);
  showPendingOverlays();
}

function renderTabShell(tab) {
  badgeHost = h('div', { class: 'left' });
  mainEl = h('main', { id: 'view' });
  clear(root).append(h('div', { class: 'screen' },
    h('header', { class: 'topbar' }, badgeHost, h('h1', null, tab.title),
      h('div', { class: 'right' }, tab.id === 'cases' && activeProgram()
        ? h('span', { class: 'tiny muted', style: { maxWidth: '110px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, activeProgram().name)
        : null)),
    mainEl,
    h('nav', { class: 'tabbar', 'aria-label': 'Sections' }, TABS.map((t) =>
      h('a', { href: `#/${t.id}`, class: t.id === tab.id ? 'active' : '', 'aria-current': t.id === tab.id ? 'page' : null },
        icon(t.icon, 24), t.label)))));
  drawBadge();
  drawTab();
}

function drawTab() {
  const tab = TABS.find((t) => t.id === current?.name);
  if (!tab || !mainEl) return;
  const y = window.scrollY;
  tab.render(mainEl);
  window.scrollTo(0, y);
}

function drawBadge() {
  if (!badgeHost) return;
  clear(badgeHost).append(syncBadge(() => { pushPending(); refreshAll(); }));
}

function renderLoading() {
  clear(root).append(h('div', { class: 'boot' },
    state.accountError
      ? [h('p', null, state.accountError),
        h('button', { class: 'btn btn-primary', onclick: () => { state.accountError = null; renderLoading(); refreshAccount(); } }, 'Try again'),
        h('button', { class: 'link danger', onclick: signOut }, 'Sign out')]
      : h('p', null, 'Setting up your case log…')));
}

window.addEventListener('hashchange', () => { route(); if (!current || TABS.some((t) => t.id === current.name)) window.scrollTo(0, 0); });

// ---------------------------------------------------------------------------
// Data changes: redraw what depends on them, never a screen being typed in.
// ---------------------------------------------------------------------------

let lastPhase = null;
onChange((what) => {
  const p = phase();
  if (p !== lastPhase) {
    lastPhase = p;
    if (authResolved) route();
    return;
  }
  if (what === 'sync') { drawBadge(); }
  if (!mainEl) {
    if (current?.name === 'onboarding' && what === 'account') route();
    return;
  }
  const typing = mainEl.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  if (typing) return;
  if (current.name === 'settings' && what === 'sync') {
    drawTab();
    return;
  }
  if (['cases', 'reference', 'account', 'program', 'announcements'].includes(what) || (what === 'sync' && current.name === 'cases')) drawTab();
  if (what === 'announcements') showPendingOverlays();
});

// ---------------------------------------------------------------------------
// After a save: EPAs to request, then any achievements just earned.
// ---------------------------------------------------------------------------

async function afterSave({ epas, attending, earned, edited }) {
  if (epas.mine.length) await showSavedSheet({ epas, attending, edited, offline: !navigator.onLine });
  state.celebration = earned;
  showPendingOverlays();
}

let overlayOpen = false;
function showPendingOverlays() {
  if (overlayOpen || phase() !== 'ready' || !mainEl) return;
  if (state.celebration.length) {
    overlayOpen = true;
    const list = state.celebration;
    state.celebration = [];
    showCelebration(list, {
      programName: activeProgram()?.name || 'your program',
      anonymous: state.announceAnonymously,
      onDone: () => { overlayOpen = false; showPendingOverlays(); },
    });
    return;
  }
  if (state.announcementQueue.length) {
    overlayOpen = true;
    const list = state.announcementQueue;
    state.announcementQueue = [];
    showAnnouncementQueue(list, () => { overlayOpen = false; });
  }
}

// ---------------------------------------------------------------------------
// Coming back to the app: upload anything waiting, refresh now and then.
// ---------------------------------------------------------------------------

let lastRefresh = Date.now();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !state.user) return;
  pushPending();
  if (Date.now() - lastRefresh > 5 * 60000) { lastRefresh = Date.now(); refreshAll(); }
});

// Re-draw rings and colours when the phone switches light/dark.
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => drawTab());

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker not registered', err)));
}
