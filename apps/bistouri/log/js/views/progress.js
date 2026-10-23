// Progress tab (ios/Bistouri/ProgressTab.swift): totals, target rings, counts by
// category, role and task, achievements and the program's announcements.
import { h, clear } from '../../shared/util.js';
import { state, programCases, activeProgram } from '../data.js';
import { caseStats, achievements } from '../ref.js';
import { card, icon, openSheet } from '../ui.js';
import { achievementGrid, showAchievementDetail, announcementRow, showAnnouncementDetail } from './achievements.js';

const RING_COLORS = ['var(--ring-1)', 'var(--ring-2)', 'var(--ring-3)', 'var(--ring-4)'];
const NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/** Concentric activity rings, outermost first; a second lap shows past 100%. */
function rings(items, size, lineWidth = null) {
  const root = svg('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, role: 'img' });
  root.setAttribute('aria-label', items.map((t) => `${t.title}: ${t.count} of ${t.goal}`).join(', '));
  const line = lineWidth ?? size / Math.max(items.length, 1) / 2.6;
  items.forEach((t, i) => {
    const r = size / 2 - line / 2 - i * (line + 2);
    const c = 2 * Math.PI * r;
    const color = t.color || RING_COLORS[i % RING_COLORS.length];
    const base = { cx: size / 2, cy: size / 2, r, fill: 'none', 'stroke-width': line, 'stroke-linecap': 'round', transform: `rotate(-90 ${size / 2} ${size / 2})` };
    root.append(svg('circle', { ...base, stroke: color, 'stroke-opacity': 0.18 }));
    const f = Math.min(t.fraction, 1);
    if (f > 0) root.append(svg('circle', { ...base, stroke: color, 'stroke-dasharray': `${f * c} ${c}` }));
    if (t.fraction > 1) root.append(svg('circle', { ...base, stroke: color, 'stroke-opacity': 0.75, 'stroke-dasharray': `${Math.min(t.fraction - 1, 1) * c} ${c}` }));
  });
  return root;
}

function bars(title, iconName, rows, color) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return card(title, iconName, h('div', { class: 'bars' }, rows.map((r) => h('div', { class: 'bar-row' },
    h('div', { class: 'row-between' }, h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.name), h('b', { class: 'num' }, String(r.count))),
    h('div', { class: 'bar', style: `--bar-c: ${color}` }, h('i', { style: { width: `${(r.count / max) * 100}%` } }))))));
}

export function renderProgress(root) {
  const ref = state.ref;
  const cases = programCases();
  const stats = caseStats(ref, cases);
  const all = achievements(ref, cases);
  const program = activeProgram();

  const pill = (value, label, iconName, coral) => h('div', { class: `pill ${coral ? 'coral' : ''}` }, icon(iconName, 18), h('b', null, String(value)), h('span', { class: 'small muted' }, label));
  const summary = h('section', { class: 'summary' },
    h('div', null,
      h('div', { class: 'total', id: 'total-cases' }, String(stats.total)),
      h('div', { class: 'small muted', style: { fontWeight: 650 } }, stats.total === 1 ? 'case logged' : 'cases logged'),
      program ? h('div', { class: 'tiny muted' }, program.name) : null),
    h('div', { class: 'pills' },
      pill(stats.thisMonth, 'this month', 'calendar'),
      pill(stats.asPrimary, 'as primary', 'hand'),
      pill(stats.weekStreak, 'week streak', 'flame', true)));

  let targets;
  if (!stats.targets.length) {
    targets = card('Targets', 'target', h('div', { class: 'row', style: { alignItems: 'flex-start' } },
      h('span', { style: { opacity: 0.35 } }, rings([{ fraction: 0.66 }, { fraction: 0.4, color: 'var(--ring-2)' }], 64, 10)),
      h('div', null, h('div', { style: { fontWeight: 700 } }, 'No targets yet'),
        h('p', { class: 'small muted' }, "Your program director hasn't set targets for this program. Keep logging: your totals and achievements are below, and rings will appear here once targets are set."))));
  } else {
    const top = stats.targets.slice(0, 4);
    const done = stats.targets.filter((t) => t.done).length;
    targets = card('Targets', 'target', { accessory: `${done} of ${stats.targets.length} met` },
      h('div', { class: 'rings' }, rings(top, 140),
        h('div', { class: 'legend' }, top.map((t, i) => h('div', { class: 'item' },
          h('span', { class: 'dot', style: { background: RING_COLORS[i] } }),
          h('div', null, h('div', { style: { fontWeight: 650 } }, t.title), h('div', { class: 'muted num' }, `${t.count} / ${t.goal}`)))))),
      stats.targets.length > 4 ? h('div', { class: 'ring-grid' }, stats.targets.slice(4).map((t) => h('div', { class: 'ring-card' },
        h('div', { style: { position: 'relative', width: '64px', height: '64px' } },
          rings([{ ...t, color: t.done ? 'var(--ring-2)' : 'var(--ring-1)' }], 64, 9),
          h('span', { style: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: '13px' } },
            t.done ? icon('check', 18) : `${Math.round(t.fraction * 100)}%`)),
        h('div', { style: { fontWeight: 650 } }, t.title), h('div', { class: 'muted num tiny' }, `${t.count} / ${t.goal}`)))) : null);
  }

  // Latest milestones earned (majors first), then the next ones to chase. Secrets stay secret.
  const earned = all.filter((a) => a.earned);
  const perItem = (a) => a.id.startsWith('category-') || a.id.startsWith('target-');
  const topEarned = [...earned.filter((a) => a.isMajor).reverse(), ...earned.filter((a) => !a.isMajor && !perItem(a)).reverse(), ...earned.filter(perItem).reverse()].slice(0, 3);
  const nextUp = all.filter((a) => !a.earned && !a.hidden && !perItem(a));
  const achievementsCard = card('Achievements', 'medal', { accessory: `${earned.length} of ${all.length}` },
    achievementGrid([...topEarned, ...nextUp].slice(0, 6), showAchievementDetail),
    h('button', { type: 'button', class: 'btn btn-secondary btn-block', id: 'all-achievements', onclick: () => openAllAchievements(all) }, 'See all achievements'));

  const anns = state.announcements;
  const announcementsCard = card('Program announcements', 'megaphone',
    anns.length
      ? h('div', { class: 'stack' }, anns.slice(0, 4).map((a) => announcementRow(a, showAnnouncementDetail)))
      : h('p', { class: 'small muted' }, 'No major achievements announced in your program yet. Someone has to go first. The System is watching.'),
    anns.length > 4 ? h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: () => openAllAnnouncements(anns) }, 'See all announcements') : null);

  clear(root).append(h('div', { class: 'content stack' },
    summary, targets,
    stats.total ? bars('By category', 'list', stats.byCategory, 'var(--ring-1)') : null,
    stats.total ? bars('By role', 'people', stats.byRole, 'var(--ring-3)') : null,
    stats.total && stats.topTasks.length ? bars('Top tasks', 'checklist', stats.topTasks, 'var(--ring-2)') : null,
    achievementsCard, announcementsCard));
}

function sheetFrame(title, close, ...body) {
  return [
    h('header', { class: 'topbar' }, h('div', { class: 'left' }), h('h1', null, title),
      h('div', { class: 'right' }, h('button', { type: 'button', class: 'toplink strong', onclick: close }, 'Done'))),
    h('div', { class: 'content stack', style: { paddingBottom: '40px' } }, ...body)];
}

function openAllAchievements(all) {
  openSheet((close) => sheetFrame('Achievements', close,
    h('h2', { class: 'section-title' }, 'Major · announced to your program'),
    achievementGrid(all.filter((a) => a.isMajor), showAchievementDetail),
    h('h2', { class: 'section-title' }, 'Minor · stay on this device'),
    achievementGrid(all.filter((a) => !a.isMajor), showAchievementDetail)));
}

function openAllAnnouncements(list) {
  openSheet((close) => sheetFrame('Announcements', close,
    h('div', { class: 'card' }, list.map((a) => announcementRow(a, showAnnouncementDetail)))));
}
