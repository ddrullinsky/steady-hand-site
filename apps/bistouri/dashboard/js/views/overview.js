// Overview: cohort headline numbers, PGY breakdowns, monthly volume.
import { state } from '../api.js';
import {
  h, today, addDays, addMonths, academicYearStart, academicYearLabel, monthRange, monthKey, fmtMonth,
  median, fmtNum, pct, pgyLabel, emptyState, byOrder,
} from '../util.js';
import { residents, casesByResident, inRange, roleOrder, roleColors, roleName, pgyGroups } from '../stats.js';
import { barChart, stackedChart } from '../charts.js';

let period = 'ay';

const PERIODS = {
  ay: { label: 'This academic year', from: () => academicYearStart() },
  last12: { label: 'Last 12 months', from: () => addMonths(today(), -12) },
  all: { label: 'All time', from: () => null },
};

function tile(label, value, note, accent) {
  return h('div', { class: `tile${accent ? ' accent' : ''}` },
    h('div', { class: 'tile-label' }, label),
    h('div', { class: 'tile-value' }, value),
    note ? h('div', { class: 'tile-note' }, note) : null);
}

export function render(main, { rerender }) {
  const p = state.program;
  const ayStart = academicYearStart();
  const t = today();
  const res = residents();
  const resIds = new Set(res.map((r) => r.user_id));
  const all = state.cases;
  const byRes = casesByResident(all);

  const loggedRecently = res.filter((r) => r.last_case_date && r.last_case_date >= addDays(t, -14)).length;
  const recentPct = pct(loggedRecently, res.length);

  main.append(
    h('div', { class: 'page-head' },
      h('div', null,
        h('h1', null, 'Overview'),
        h('div', { class: 'sub' }, `${p.name} · academic year ${academicYearLabel(ayStart)} (from July 1)`))),
    h('div', { class: 'tiles' },
      tile('Active residents', fmtNum(res.length),
        `${fmtNum(state.members.filter((m) => m.role === 'resident' && !m.active).length)} inactive`),
      tile('Cases this academic year', fmtNum(inRange(all, ayStart).length), `since ${ayStart.slice(0, 4)}-07-01`),
      tile('Cases in the last 30 days', fmtNum(inRange(all, addDays(t, -30)).length)),
      tile('Logged a case, last 14 days', recentPct === null ? '—' : `${recentPct}%`,
        res.length ? `${loggedRecently} of ${res.length} residents` : 'no residents yet', true)),
  );

  if (!res.length) {
    main.append(emptyState('No residents in this program yet',
      'Residents join from the Bistouri iPhone app with their McGill email, or you can invite them (and pre-assign their PGY) under People.',
      h('a', { class: 'btn btn-primary', href: '#/people' }, 'Invite residents')));
    return;
  }

  const from = PERIODS[period].from();
  const periodCases = inRange(all, from).filter((c) => resIds.has(c.resident_id));

  main.append(h('div', { class: 'row-between', style: { marginBottom: '12px' } },
    h('h2', { style: { fontSize: '17px' } }, 'Cohort by PGY'),
    h('label', { class: 'check' }, 'Period ',
      h('select', {
        onchange: (e) => { period = e.target.value; rerender(); },
      }, Object.entries(PERIODS).map(([k, v]) => h('option', { value: k, selected: k === period }, v.label))))));

  const groups = pgyGroups(res);
  const resByPgy = new Map(groups.map((g) => [g, res.filter((r) => (r.pgy_year || 0) === g)]));
  const casesOf = (r) => inRange(byRes.get(r.user_id) || [], from);

  // --- PGY summary table
  const summary = h('table', { class: 'table compact nowrap' },
    h('thead', null, h('tr', null,
      h('th', null, 'PGY'), h('th', { class: 'num' }, 'Residents'), h('th', { class: 'num' }, 'Cases'),
      h('th', { class: 'num', title: 'Median cases per resident' }, 'Median'), h('th', { class: 'num' }, 'Range'),
      h('th', { class: 'num', title: 'Residents who logged a case in the last 14 days' }, 'Active 14 d'))),
    h('tbody', null, groups.map((g) => {
      const list = resByPgy.get(g);
      const counts = list.map((r) => casesOf(r).length);
      const recent = list.filter((r) => r.last_case_date && r.last_case_date >= addDays(t, -14)).length;
      return h('tr', null,
        h('td', { class: 'cell-name' }, g ? pgyLabel(g) : 'PGY not set'),
        h('td', { class: 'num' }, list.length),
        h('td', { class: 'num' }, fmtNum(counts.reduce((a, b) => a + b, 0))),
        h('td', { class: 'num' }, fmtNum(median(counts), 1)),
        h('td', { class: 'num' }, counts.length ? `${Math.min(...counts)}–${Math.max(...counts)}` : '—'),
        h('td', { class: 'num' }, `${recent} / ${list.length}`));
    })));

  // --- role distribution
  const rolePanel = h('div', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', null, 'Role distribution'),
      h('span', { class: 'hint' }, 'Share of cases by the resident’s role')));
  if (!periodCases.length) {
    rolePanel.append(emptyState('No cases in this period', 'Try “All time”, or check Compliance to see who has not logged yet.'));
  } else {
    const roles = roleOrder(periodCases);
    const colors = roleColors(roles);
    const datasets = roles.map((rid, i) => {
      const counts = groups.map((g) => resByPgy.get(g).flatMap(casesOf).filter((c) => (c.role_id || null) === rid).length);
      const totals = groups.map((g) => resByPgy.get(g).flatMap(casesOf).length);
      return {
        label: rid ? roleName(rid) : 'Not recorded', color: colors[i], counts,
        data: counts.map((n, j) => (totals[j] ? Math.round((n / totals[j]) * 100) : 0)),
      };
    }).filter((d) => d.counts.some((n) => n > 0));
    stackedChart(rolePanel, {
      labels: groups.map((g) => (g ? pgyLabel(g) : 'PGY not set')), datasets, horizontal: true, percent: true,
      height: Math.max(150, groups.length * 46 + 70), ariaLabel: 'Share of cases by role for each PGY',
    });
  }

  main.append(h('div', { class: 'grid-2' },
    h('div', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('h2', null, 'Residents and volume'),
        h('span', { class: 'hint' }, PERIODS[period].label)),
      h('div', { class: 'table-wrap' }, summary)),
    rolePanel));

  // --- category x PGY heatmap
  const heatPanel = h('div', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', null, 'Cases per category by PGY'),
      h('span', { class: 'hint' }, 'Average cases per resident · darker = more')));
  const cats = [...state.config.categories].sort(byOrder)
    .filter((c) => c.active || periodCases.some((k) => k.categoryIds.includes(c.id)));
  if (!periodCases.length) {
    heatPanel.append(emptyState('No cases in this period', null));
  } else {
    const cell = new Map();
    let max = 0;
    for (const c of cats) {
      for (const g of groups) {
        const list = resByPgy.get(g);
        const n = list.flatMap(casesOf).filter((k) => k.categoryIds.includes(c.id)).length;
        const avg = list.length ? n / list.length : 0;
        cell.set(`${c.id}|${g}`, { n, avg });
        max = Math.max(max, avg);
      }
    }
    heatPanel.append(h('div', { class: 'table-wrap' }, h('table', { class: 'table heat compact' },
      h('thead', null, h('tr', null, h('th', null, 'Category'),
        groups.map((g) => h('th', { class: 'num', style: { textAlign: 'center' } }, g ? pgyLabel(g) : 'PGY not set')),
        h('th', { class: 'num' }, 'All residents'))),
      h('tbody', null, cats.map((c) => {
        const total = periodCases.filter((k) => k.categoryIds.includes(c.id)).length;
        return h('tr', null,
          h('td', null, c.name, c.active ? null : h('span', { class: 'badge', style: { marginLeft: '6px' } }, 'inactive')),
          groups.map((g) => {
            const { n, avg } = cell.get(`${c.id}|${g}`);
            const a = max ? avg / max : 0;
            return h('td', {
              class: 'heat-cell',
              title: `${fmtNum(n)} cases across ${resByPgy.get(g).length} resident(s)`,
              style: {
                background: n ? `color-mix(in srgb, var(--chart-1) ${Math.round(12 + a * 78)}%, var(--surface))` : 'transparent',
                color: a > 0.55 ? '#fff' : 'var(--ink)',
              },
            }, n ? fmtNum(avg, 1) : '·');
          }),
          h('td', { class: 'num' }, fmtNum(total)));
      })))));
  }
  main.append(heatPanel);

  // --- monthly volume (always the last 12 months)
  const months = monthRange(addMonths(t, -11).slice(0, 8) + '01', t);
  const perMonth = new Map(months.map((m) => [m, 0]));
  for (const c of all) {
    const k = monthKey(c.case_date);
    if (perMonth.has(k)) perMonth.set(k, perMonth.get(k) + 1);
  }
  const volPanel = h('div', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', null, 'Monthly case volume'),
      h('span', { class: 'hint' }, 'All residents · last 12 months')));
  barChart(volPanel, {
    labels: months.map((m) => fmtMonth(m)), values: months.map((m) => perMonth.get(m)), label: 'Cases',
    ariaLabel: 'Cases logged per month over the last 12 months',
  });
  main.append(volPanel);
}
