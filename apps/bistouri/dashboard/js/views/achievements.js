// Achievements: the program's major achievement unlocks, the same feed residents
// see in the app. Minor achievements never leave residents' phones.
import { state } from '../api.js';
import { h, today, addDays, academicYearStart, isoDate, fmtDate, relDays, fmtNum, plural, emptyState } from '../util.js';
import { residents } from '../stats.js';
import { ACHIEVEMENTS } from '../achievementCatalogue.js';

// Texts are generated from the app (scripts/build_achievement_catalogue.py).
const MAJORS = ACHIEVEMENTS.filter((a) => a.tier === 'major').map((a) => ({ ...a, text: a.announcement }));
const BY_ID = new Map(MAJORS.map((m) => [m.id, m]));

let filter = '';
let shown = 50;
let catalogueTier = 'major';

function tile(label, value, note, accent) {
  return h('div', { class: `tile${accent ? ' accent' : ''}` },
    h('div', { class: 'tile-label' }, label),
    h('div', { class: 'tile-value' }, value),
    note ? h('div', { class: 'tile-note' }, note) : null);
}

/** Local calendar date of an unlock timestamp, as 'YYYY-MM-DD'. */
const dayOf = (u) => isoDate(new Date(u.unlocked_at));

function who(u) {
  if (!u.display_name) return [h('strong', null, 'A resident'), ' ', h('span', { class: 'badge', title: 'This resident announces anonymously' }, 'anonymous')];
  const member = state.members.some((m) => m.user_id === u.user_id);
  return [member ? h('a', { class: 'cell-name', href: `#/resident/${u.user_id}` }, u.display_name) : h('strong', null, u.display_name)];
}

export function render(main, { rerender }) {
  const p = state.program;
  const unlocks = state.achievements.filter((u) => BY_ID.has(u.achievement_id));
  const t = today();
  const res = residents();
  const resIds = new Set(res.map((r) => r.user_id));
  const withMajor = new Set(unlocks.map((u) => u.user_id).filter((id) => resIds.has(id)));

  main.append(
    h('div', { class: 'page-head' },
      h('div', null,
        h('h1', null, 'Achievements'),
        h('div', { class: 'sub' }, `Major achievements unlocked in ${p.name}. Residents see the same announcements in the app.`))),
    h('div', { class: 'tiles' },
      tile('Unlocks this academic year', fmtNum(unlocks.filter((u) => dayOf(u) >= academicYearStart()).length)),
      tile('Unlocks in the last 30 days', fmtNum(unlocks.filter((u) => dayOf(u) >= addDays(t, -30)).length)),
      tile('Residents with a major achievement', fmtNum(withMajor.size),
        res.length ? `of ${plural(res.length, 'active resident')}` : null, true)),
  );

  // --- feed
  const list = filter ? unlocks.filter((u) => u.achievement_id === filter) : unlocks;
  const feed = h('div', { class: 'panel' },
    h('div', { class: 'panel-head' },
      h('h2', null, 'Announcements'),
      h('label', { class: 'check' }, 'Show ',
        h('select', { onchange: (e) => { filter = e.target.value; shown = 50; rerender(); } },
          h('option', { value: '' }, 'All achievements'),
          MAJORS.map((m) => h('option', { value: m.id, selected: m.id === filter }, m.title))))));
  if (!list.length) {
    feed.append(emptyState(filter ? 'Nobody has unlocked this one yet' : 'No major achievements yet',
      'They appear here as residents log cases. Someone has to go first. The System is watching.'));
  } else {
    feed.append(h('ul', { class: 'feed' }, list.slice(0, shown).map((u) => {
      const m = BY_ID.get(u.achievement_id);
      return h('li', null,
        h('span', { class: 'feed-mark', 'aria-hidden': 'true' }, '★'),
        h('div', null,
          h('div', { class: 'feed-title' }, h('span', { class: 'system' }, 'Major achievement'), m.title),
          h('div', { class: 'feed-text' }, ...who(u), ' ', m.text),
          h('div', { class: 'feed-meta', title: new Date(u.unlocked_at).toLocaleString('en-CA') },
            `${fmtDate(dayOf(u))} · ${relDays(dayOf(u))}`)));
    })));
    if (list.length > shown) {
      feed.append(h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { shown += 50; rerender(); } },
        `Show more (${fmtNum(list.length - shown)} left)`));
    }
  }
  feed.append(h('p', { class: 'hint', style: { marginTop: '12px' } },
    'Minor achievements stay on residents’ phones and are not shown here. Residents who announce anonymously appear as “A resident”.'));

  // --- by achievement
  const table = h('div', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', null, 'By achievement'), h('span', { class: 'hint' }, 'All time')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table compact' },
      h('thead', null, h('tr', null,
        h('th', null, 'Achievement'), h('th', { class: 'num' }, 'Residents'), h('th', { class: 'num' }, 'Latest'))),
      h('tbody', null, MAJORS.map((m) => {
        const hits = unlocks.filter((u) => u.achievement_id === m.id);
        return h('tr', { class: 'click', onclick: () => { filter = m.id; shown = 50; rerender(); window.scrollTo(0, 0); } },
          h('td', null, h('div', { class: 'cell-name' }, m.title), h('div', { class: 'cell-sub' }, m.rule)),
          h('td', { class: 'num' }, hits.length ? fmtNum(hits.length) : '·'),
          h('td', { class: 'num nowrap' }, hits.length ? fmtDate(dayOf(hits[0])) : '—'));
      })))));

  main.append(h('div', { class: 'grid-2' }, feed, table));
  main.append(cataloguePanel(unlocks, rerender));
}

/** Every achievement with the notification residents see. */
function cataloguePanel(unlocks, rerender) {
  const list = ACHIEVEMENTS.filter((a) => a.tier === catalogueTier);
  const tab = (tier, label) => h('button', {
    class: `btn btn-sm${catalogueTier === tier ? ' btn-primary' : ' btn-ghost'}`, 'aria-pressed': String(catalogueTier === tier),
    onclick: () => { catalogueTier = tier; rerender(); },
  }, label);
  return h('div', { class: 'panel' },
    h('div', { class: 'panel-head' },
      h('div', null, h('h2', null, 'Every achievement'),
        h('div', { class: 'hint' }, catalogueTier === 'major'
          ? 'Announced to the program when unlocked. The resident sees the notification; everyone sees the announcement.'
          : 'Stay on the resident’s phone; never shown here when unlocked. Hidden ones show as “???” until earned.')),
      h('div', { class: 'toolbar' },
        tab('major', `Major (${ACHIEVEMENTS.filter((a) => a.tier === 'major').length})`),
        tab('minor', `Minor (${ACHIEVEMENTS.filter((a) => a.tier === 'minor').length})`))),
    h('div', { class: 'catalogue' }, list.map((a) => {
      const n = unlocks.filter((u) => u.achievement_id === a.id).length;
      return h('article', { class: 'ach' },
        h('div', { class: 'ach-head' },
          h('h3', null, a.title),
          a.hidden ? h('span', { class: 'badge' }, 'hidden') : null,
          a.tier === 'major' && n ? h('span', { class: 'badge brand' }, plural(n, 'resident')) : null),
        a.rule ? h('div', { class: 'ach-rule' }, a.rule) : null,
        h('p', { class: 'ach-message' }, a.message),
        h('p', { class: 'ach-reward' }, h('strong', null, 'Reward: '), a.reward),
        a.announcement ? h('p', { class: 'ach-announce' }, h('span', { class: 'system' }, 'Announcement'), h('em', null, 'Name'), ' ', a.announcement) : null);
    })));
}
