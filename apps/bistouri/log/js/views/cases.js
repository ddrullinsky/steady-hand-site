// Cases tab (ios/Bistouri/CaseListView.swift): month groups, search and filters,
// the waiting-to-sync banner, and the Log case / Repeat bar. A row opens the case
// for editing; its ⋯ menu offers Edit, Duplicate and Delete (the app's swipes).
import { h, clear, logo, confirmDialog } from '../../shared/util.js';
import { state, programCases, pushPending, softDeleteCase } from '../data.js';
import { procedureName, nameIn, siteShort, urgencyLabel, attendingName, procedureIdsInCategory } from '../ref.js';
import { icon, actionSheet, navigate, openSheet, syncValue } from '../ui.js';
import { epaCard } from './caseForm.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Search and filters survive re-renders while the tab is open.
const view = { search: '', roleFilter: '', categoryFilter: '', showFilters: false };

export function renderCases(root) {
  const ref = state.ref;
  const all = programCases().sort((a, b) => b.case_date.localeCompare(a.case_date) || String(b.created_at).localeCompare(String(a.created_at)));
  const listBox = h('div');

  function filtered() {
    const q = view.search.trim().toLowerCase();
    const catProcs = view.categoryFilter ? procedureIdsInCategory(ref, view.categoryFilter) : null;
    return all.filter((c) => {
      if (view.roleFilter && c.role_id !== view.roleFilter) return false;
      if (catProcs && !c.procedure_ids.some((p) => catProcs.has(p))) return false;
      if (!q) return true;
      if (c.procedure_ids.some((p) => (procedureName(ref, p) || '').toLowerCase().includes(q))) return true;
      return attendingName(ref, c).toLowerCase().includes(q);
    });
  }

  function details(c) {
    const parts = [];
    const role = nameIn(ref.roles, c.role_id);
    if (role) parts.push(role);
    const site = ref.sites.find((s) => s.id === c.site_id);
    if (site) parts.push(siteShort(site));
    if (c.urgency && c.urgency !== 'elective') parts.push(urgencyLabel(c.urgency));
    const a = attendingName(ref, c);
    if (a) parts.push(a);
    return parts.join(' · ');
  }

  async function rowMenu(c) {
    const choice = await actionSheet([
      { label: 'Edit', value: 'edit' },
      { label: 'Duplicate', value: 'copy' },
      { label: 'Delete', value: 'delete', danger: true },
    ], 'Case actions');
    if (choice === 'edit') navigate(`#/case/${c.id}`);
    if (choice === 'copy') navigate(`#/case/${c.id}/copy`);
    if (choice === 'delete') {
      const ok = await confirmDialog('Delete this case?', "It will be removed from your log and from your program's records.", 'Delete case', 'danger');
      if (ok) softDeleteCase(c);
    }
  }

  function caseRow(c) {
    const [y, m, d] = c.case_date.split('-').map(Number);
    const names = c.procedure_ids.map((p) => procedureName(ref, p)).filter(Boolean);
    return h('div', { class: 'case-row', dataset: { caseId: c.id } },
      h('button', { type: 'button', class: 'case-main', onclick: () => navigate(`#/case/${c.id}`) },
        h('span', { class: 'daytile' }, h('b', null, String(d)), h('span', null, WEEKDAYS[new Date(y, m - 1, d).getDay()])),
        h('span', { class: 'grow' },
          h('div', { class: 'case-title' }, names.length ? names.join(' + ') : 'Case'),
          h('div', { class: 'case-detail' }, details(c)))),
      c.needs_sync ? h('span', {
        class: `case-sync ${c.last_sync_error ? 'err' : ''}`, title: 'Not synced yet', 'aria-label': 'Not synced yet', style: { paddingTop: '8px' },
      }, icon(c.last_sync_error ? 'cloudErr' : 'cloudUp', 16)) : null,
      h('button', { type: 'button', class: 'menu-btn', 'aria-label': 'Case actions', onclick: () => rowMenu(c) }, icon('more', 20)));
  }

  function drawList() {
    clear(listBox);
    const rows = filtered();
    if (view.roleFilter || view.categoryFilter) {
      listBox.append(h('div', { class: 'row-between small', style: { padding: '0 4px' } },
        h('span', null, icon('filter', 14), ' ', [nameIn(ref.roles, view.roleFilter), nameIn(ref.categories, view.categoryFilter)].filter(Boolean).join(' · ')),
        h('span', { class: 'muted num' }, String(rows.length))));
    }
    if (!all.length) {
      listBox.append(h('div', { class: 'empty' }, logo(72), h('h2', null, 'Log your first case'),
        h('p', { class: 'muted' }, "It takes under 30 seconds. Pick your role, the procedure and you're done.")));
      return;
    }
    if (!rows.length) {
      listBox.append(h('div', { class: 'empty' }, h('p', { class: 'muted' }, view.search ? `No results for “${view.search.trim()}”` : 'No cases match these filters.')));
      return;
    }
    const groups = [];
    for (const c of rows) {
      const key = c.case_date.slice(0, 7);
      if (groups[groups.length - 1]?.key !== key) groups.push({ key, cases: [] });
      groups[groups.length - 1].cases.push(c);
    }
    for (const g of groups) {
      const [y, m] = g.key.split('-').map(Number);
      listBox.append(
        h('div', { class: 'month-head' }, h('span', null, `${MONTHS[m - 1]} ${y}`), h('span', { class: 'num' }, String(g.cases.length))),
        h('div', { class: 'case-list' }, g.cases.map(caseRow)));
    }
  }

  const pending = state.sync.pending;
  const sv = syncValue();
  const banner = pending > 0 ? h('div', { class: 'banner', role: 'status' },
    icon(sv === 'offline' ? 'cloudOff' : 'cloudUp', 20),
    h('div', { class: 'grow' },
      h('div', { style: { fontWeight: 650 } }, `${pending} waiting to sync`),
      h('div', { class: 'small muted' }, sv === 'offline' ? "You're offline. Saved on this phone." : sv === 'error' ? "Some cases couldn't sync. We'll keep retrying." : 'Saved on this phone.')),
    sv !== 'syncing' ? h('button', { type: 'button', class: 'link', onclick: () => pushPending() }, 'Retry') : null) : null;

  const select = (label, value, options, onchange) => h('select', {
    class: `field ${value ? '' : 'placeholder'}`, 'aria-label': label, onchange: (e) => onchange(e.target.value),
  }, h('option', { value: '' }, label), options.map((o) => h('option', { value: o.id, selected: o.id === value }, o.name)));

  const filters = h('div', { class: 'filters', hidden: !view.showFilters },
    select('All roles', view.roleFilter, ref.roles, (v) => { view.roleFilter = v; drawList(); }),
    select('All categories', view.categoryFilter, ref.categories, (v) => { view.categoryFilter = v; drawList(); }));

  const search = h('div', { class: 'row' },
    h('div', { class: 'search grow' }, icon('search'),
      h('input', {
        class: 'field', type: 'search', placeholder: 'Search procedures, attendings', 'aria-label': 'Search cases', value: view.search,
        oninput: (e) => { view.search = e.target.value; drawList(); },
      })),
    h('button', {
      type: 'button', class: 'btn btn-icon', 'aria-label': 'Filter', 'aria-expanded': view.showFilters ? 'true' : 'false',
      style: view.roleFilter || view.categoryFilter ? { color: 'var(--brand-ink)', borderColor: 'var(--brand-ink)' } : null,
      onclick: (e) => { view.showFilters = !view.showFilters; filters.hidden = !view.showFilters; e.currentTarget.setAttribute('aria-expanded', String(view.showFilters)); },
    }, icon('filter')));

  const lastLogged = all.reduce((best, c) => (!best || String(c.created_at) > String(best.created_at) ? c : best), null);
  drawList();
  clear(root).append(
    h('div', { class: 'content stack' }, banner, search, filters, listBox),
    h('div', { class: 'actionbar' }, h('div', { class: 'inner' },
      h('button', { type: 'button', class: 'btn btn-primary btn-log', id: 'log-case', onclick: () => navigate('#/case/new') }, icon('plus', 22), 'Log case'),
      lastLogged ? h('button', {
        type: 'button', class: 'btn btn-repeat', id: 'repeat-last', 'aria-label': 'Repeat last case',
        onclick: () => navigate(`#/case/${lastLogged.id}/copy`),
      }, icon('repeat', 20), 'Repeat') : null)));
}

/**
 * After a save: "EPAs to request" for the case just logged, so the resident can ask
 * the attending straight away. Resolves when closed.
 */
export function showSavedSheet({ epas, attending, edited, offline }) {
  return new Promise((resolve) => {
    let showOthers = false;
    openSheet((close) => {
      const box = h('div');
      const draw = () => clear(box).append(epaCard(epas.mine, epas.others, attending, state.ref.epaUrl, showOthers, (v) => { showOthers = v; draw(); }));
      draw();
      return [
        h('header', { class: 'topbar' }, h('div', { class: 'left' }), h('h1', null, edited ? 'Case updated' : 'Case saved'),
          h('div', { class: 'right' }, h('button', { type: 'button', class: 'toplink strong', onclick: close }, 'Done'))),
        h('div', { class: 'content stack' },
          h('div', { class: 'notice', role: 'status' }, icon('check'),
            offline ? "Saved on this phone. It will sync when you're back online." : edited ? 'Your changes are saved.' : 'Your case is logged.'),
          box),
        h('div', { class: 'savebar' }, h('div', { class: 'inner' },
          h('button', { type: 'button', class: 'btn btn-primary btn-block', id: 'saved-done', onclick: close }, 'Done')))];
    }, { onClose: resolve });
  });
}
