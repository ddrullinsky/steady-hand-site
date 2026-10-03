// Bistouri program director dashboard: sign-in, program switcher, routing.
import { sb, state, loadIdentity, loadProgram } from './api.js';
import { h, clear, logo, icon, toast, errorText } from './util.js';
import { destroyCharts } from './charts.js';
import { renderSignIn, renderNotDirector } from './views/signin.js';
import * as overview from './views/overview.js';
import * as residents from './views/residents.js';
import * as resident from './views/resident.js';
import * as compliance from './views/compliance.js';
import * as configure from './views/configure.js';
import * as people from './views/people.js';
import * as admin from './views/admin.js';
import * as achievements from './views/achievements.js';

const root = document.getElementById('app');
const PROGRAM_KEY = 'bistouri.dashboard.program';

const NAV = [
  { id: 'overview', label: 'Overview' },
  { id: 'residents', label: 'Residents' },
  { id: 'compliance', label: 'Compliance' },
  { id: 'achievements', label: 'Achievements' },
  { id: 'configure', label: 'Configure' },
  { id: 'people', label: 'People' },
];

const VIEWS = { overview, residents, resident, compliance, achievements, configure, people, admin };

let mainEl = null;
let navEl = null;
let booting = false;

// ---------------------------------------------------------------------------
// Auth lifecycle
// ---------------------------------------------------------------------------

// Supabase recommends not awaiting other calls inside the auth callback, so
// the work is deferred to the next tick.
sb.auth.onAuthStateChange((event, session) => {
  setTimeout(() => onAuth(event, session), 0);
});

async function onAuth(event, session) {
  if (!session) {
    state.session = null;
    destroyCharts();
    renderSignIn(root, authErrorFromUrl());
    return;
  }
  const sameUser = state.session?.user?.id === session.user.id;
  state.session = session;
  if (sameUser && state.program) return; // token refresh etc.
  await boot();
}

function authErrorFromUrl() {
  const params = new URLSearchParams(location.hash.slice(1) || location.search.slice(1));
  const msg = params.get('error_description');
  if (msg) history.replaceState(null, '', location.pathname);
  return msg ? msg.replace(/\+/g, ' ') : null;
}

async function boot() {
  if (booting) return;
  booting = true;
  clear(root).append(h('div', { class: 'boot', role: 'status' }, 'Loading your programs…'));
  try {
    await loadIdentity();
    if (!state.programs.length) {
      renderNotDirector(root);
      return;
    }
    const saved = localStorage.getItem(PROGRAM_KEY);
    const program = state.programs.find((p) => p.id === saved)
      || state.programs.find((p) => p.status === 'pilot') || state.programs[0];
    await loadProgram(program);
    showDashboard();
  } catch (err) {
    console.error(err);
    clear(root).append(h('div', { class: 'boot' },
      h('p', null, 'Could not load the dashboard: ', errorText(err)),
      h('button', { class: 'btn', onclick: () => location.reload() }, 'Try again')));
  } finally {
    booting = false;
  }
}

/** Draw the header and the current route from whatever is in `state`. */
export function showDashboard() {
  renderShell();
  if (!parseRoute().view || location.hash.includes('access_token')) location.replace('#/overview');
  route();
}

export async function switchProgram(id) {
  const program = state.programs.find((p) => p.id === id);
  if (!program) return;
  localStorage.setItem(PROGRAM_KEY, id);
  mainEl && clear(mainEl).append(h('div', { class: 'boot' }, `Loading ${program.name}…`));
  try {
    await loadProgram(program);
  } catch (err) {
    toast('Could not load the program: ' + errorText(err), 'error');
  }
  renderShell();
  const { view } = parseRoute();
  if (view === 'resident') location.hash = '#/residents';
  else route();
}

export async function refreshData() {
  await switchProgram(state.program.id);
  toast('Data refreshed');
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

function renderShell() {
  destroyCharts();
  const p = state.program;
  const switcher = state.programs.length > 1
    ? h('label', { class: 'program-switch' },
        h('span', { class: 'sr-only' }, 'Program'),
        h('select', { onchange: (e) => switchProgram(e.target.value), 'aria-label': 'Program' },
          state.programs.map((x) => h('option', { value: x.id, selected: x.id === p.id }, x.name))))
    : h('span', { class: 'program-name' }, p.name);

  navEl = h('nav', { class: 'main-nav', 'aria-label': 'Sections' },
    NAV.concat(state.profile.is_admin ? [{ id: 'admin', label: 'Admin' }] : [])
      .map((n) => h('a', { href: `#/${n.id}`, dataset: { view: n.id } }, n.label)));

  const header = h('header', { class: 'app-header no-print' },
    h('div', { class: 'brand' }, logo(30),
      h('div', null, h('div', { class: 'brand-name' }, 'Bistouri'), h('div', { class: 'brand-sub' }, 'Program dashboard'))),
    h('div', { class: 'header-program' }, switcher,
      h('span', { class: `badge status-${p.status}`, title: 'Program status' }, p.status)),
    navEl,
    h('div', { class: 'header-user' },
      h('button', { class: 'btn btn-ghost btn-icon', title: 'Refresh data', 'aria-label': 'Refresh data', onclick: refreshData }, icon('refresh')),
      h('span', { class: 'user-email', title: state.profile.email }, state.profile.email),
      h('button', { class: 'btn btn-ghost btn-sm', onclick: signOut }, 'Sign out')),
  );
  mainEl = h('main', { id: 'view', tabindex: '-1' });
  clear(root).append(header, mainEl,
    h('footer', { class: 'app-footer no-print' },
      'Bistouri · McGill surgical case log · No patient identifiers are stored.'));
}

async function signOut() {
  await sb.auth.signOut();
  state.program = null;
  location.hash = '';
}

// ---------------------------------------------------------------------------
// Routing: #/view/arg
// ---------------------------------------------------------------------------

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const view = VIEWS[parts[0]] ? parts[0] : null;
  return { view, args: parts.slice(1).map(decodeURIComponent) };
}

export function route() {
  if (!state.program || !mainEl) return;
  let { view, args } = parseRoute();
  if (!view || (view === 'admin' && !state.profile.is_admin)) view = 'overview';
  destroyCharts();
  const active = view === 'resident' ? 'residents' : view;
  navEl.querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.dataset.view === active));
  clear(mainEl);
  try {
    VIEWS[view].render(mainEl, { args, rerender: route });
  } catch (err) {
    console.error(err);
    mainEl.append(h('div', { class: 'panel' }, 'This view failed to load: ', errorText(err)));
  }
}

window.addEventListener('hashchange', () => {
  if (location.hash.includes('access_token')) return;
  route();
  window.scrollTo(0, 0);
});

// Re-draw charts when the OS switches light/dark.
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => route());
