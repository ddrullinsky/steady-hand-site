// Residents: sortable roster with logging activity. Click a row for detail.
import { state } from '../api.js';
import { h, clear, fmtDate, relDays, fmtNum, personName, pgyLabel, emptyState, icon, toast, today, addDays } from '../util.js';
import { exportCasesCSV } from '../export.js';

const view = { sort: 'name', dir: 1, pgy: 'all', q: '', inactive: false, pds: false };

const COLS = [
  { key: 'name', label: 'Resident', get: (m) => personName(m).toLowerCase() },
  { key: 'pgy', label: 'PGY', get: (m) => m.pgy_year || 99, num: true },
  { key: 'cases', label: 'Cases', get: (m) => Number(m.case_count), num: true },
  { key: 'last30', label: 'Last 30 days', get: (m) => Number(m.cases_last_30d), num: true },
  { key: 'last', label: 'Last case', get: (m) => m.last_case_date || '0000' },
];

export function render(main, { rerender }) {
  const all = state.members.filter((m) => view.pds || m.role === 'resident');
  const pgys = [...new Set(state.members.filter((m) => m.role === 'resident').map((m) => m.pgy_year || 0))].sort((a, b) => (a || 99) - (b || 99));

  main.append(h('div', { class: 'page-head' },
    h('div', null, h('h1', null, 'Residents'),
      h('div', { class: 'sub' }, 'Click a resident for progress against targets, case list, CSV and printable report.')),
    h('div', { class: 'toolbar' },
      h('button', {
        class: 'btn', disabled: !state.cases.length,
        onclick: () => { const n = exportCasesCSV(state.cases, `${state.program.slug}-all-cases`); toast(`Exported ${n} cases`); },
      }, icon('download'), 'Export all cases (CSV)'))));

  if (!state.members.some((m) => m.role === 'resident')) {
    main.append(emptyState('No residents yet',
      'Residents appear here once they join your program in the Bistouri app, or when you invite them under People.',
      h('a', { class: 'btn btn-primary', href: '#/people' }, 'Go to People')));
    return;
  }

  const tableHost = h('div', { class: 'table-wrap' });
  const search = h('input', {
    type: 'search', placeholder: 'Search name or email', value: view.q, 'aria-label': 'Search residents',
    oninput: (e) => { view.q = e.target.value; draw(); },
  });

  main.append(h('div', { class: 'panel' },
    h('div', { class: 'editor-toolbar' },
      h('div', { class: 'toolbar' },
        h('span', { class: 'search' }, icon('search'), search),
        h('select', {
          'aria-label': 'Filter by PGY',
          onchange: (e) => { view.pgy = e.target.value; draw(); },
        }, h('option', { value: 'all' }, 'All PGY levels'),
        pgys.map((g) => h('option', { value: String(g), selected: String(g) === view.pgy }, g ? pgyLabel(g) : 'PGY not set')))),
      h('div', { class: 'toolbar' },
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: view.inactive, onchange: (e) => { view.inactive = e.target.checked; draw(); } }), 'Show inactive'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: view.pds, onchange: (e) => { view.pds = e.target.checked; rerender(); } }), 'Include program directors'))),
    tableHost));

  function draw() {
    const q = view.q.trim().toLowerCase();
    const rows = all.filter((m) =>
      (view.inactive || m.active) &&
      (view.pgy === 'all' || String(m.pgy_year || 0) === view.pgy) &&
      (!q || personName(m).toLowerCase().includes(q) || (m.email || '').toLowerCase().includes(q)));
    const col = COLS.find((c) => c.key === view.sort);
    rows.sort((a, b) => {
      const x = col.get(a), y = col.get(b);
      return (x < y ? -1 : x > y ? 1 : 0) * view.dir || personName(a).localeCompare(personName(b));
    });
    const stale = addDays(today(), -14);
    clear(tableHost).append(rows.length ? h('table', { class: 'table' },
      h('thead', null, h('tr', null, COLS.map((c) => h('th', {
        class: `sortable${c.num ? ' num' : ''}`, tabindex: '0', 'aria-sort': view.sort === c.key ? (view.dir > 0 ? 'ascending' : 'descending') : 'none',
        onclick: () => sortBy(c.key), onkeydown: (e) => { if (e.key === 'Enter') sortBy(c.key); },
      }, c.label, view.sort === c.key ? h('span', { class: 'arrow' }, view.dir > 0 ? '▲' : '▼') : null)),
      h('th', null, 'Status'))),
      h('tbody', null, rows.map((m) => h('tr', {
        class: `click${m.active ? '' : ' inactive'}`, tabindex: '0',
        onclick: () => { location.hash = `#/resident/${m.user_id}`; },
        onkeydown: (e) => { if (e.key === 'Enter') location.hash = `#/resident/${m.user_id}`; },
      },
      h('td', null, h('div', { class: 'cell-name' }, personName(m)), h('div', { class: 'cell-sub' }, m.email)),
      h('td', { class: 'num' }, m.role === 'program_director' ? h('span', { class: 'badge brand' }, 'PD') : (m.pgy_year || '—')),
      h('td', { class: 'num' }, fmtNum(m.case_count)),
      h('td', { class: 'num' }, fmtNum(m.cases_last_30d)),
      h('td', null, m.last_case_date ? fmtDate(m.last_case_date) : '—',
        h('div', { class: 'cell-sub' }, m.last_case_date ? relDays(m.last_case_date) : 'no cases yet')),
      h('td', null, !m.active ? h('span', { class: 'badge' }, 'inactive')
        : m.role === 'program_director' ? h('span', { class: 'muted' }, '—')
        : !m.last_case_date ? h('span', { class: 'badge warn' }, 'never logged')
          : m.last_case_date < stale ? h('span', { class: 'badge warn' }, 'quiet')
            : h('span', { class: 'badge good' }, 'active')))))) :
      emptyState('No residents match these filters', null));
  }

  function sortBy(key) {
    if (view.sort === key) view.dir *= -1;
    else { view.sort = key; view.dir = key === 'name' ? 1 : -1; }
    draw();
  }

  draw();
}
