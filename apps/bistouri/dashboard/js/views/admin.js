// Admin (profiles.is_admin only; the server enforces it too): program status
// and the global list of sites.
import { sb, state, loadSites, loadConfig } from '../api.js';
import { h, icon, toast, errorText } from '../util.js';
import { listEditor } from '../listEditor.js';

const STATUS_HELP = {
  pilot: 'Pilot: live with residents now.',
  ready: 'Ready: configured and waiting for its PD.',
  planned: 'Planned: starter lists only.',
};

export function render(main, { rerender }) {
  if (!state.profile.is_admin) return;
  main.append(h('div', { class: 'page-head' },
    h('div', null, h('h1', null, 'Admin'), h('div', { class: 'sub' }, 'Settings shared by every program. Only Bistouri admins see this page.'))));

  const programs = h('div', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', null, 'Programs'), h('span', { class: 'hint' }, Object.values(STATUS_HELP).join(' '))),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, h('th', null, 'Program'), h('th', null, 'Slug'), h('th', null, 'Status'))),
      h('tbody', null, state.allPrograms.map((p) => h('tr', null,
        h('td', { class: 'cell-name' }, p.name, p.name_fr ? h('div', { class: 'cell-sub' }, p.name_fr) : null),
        h('td', { class: 'mono' }, p.slug),
        h('td', null, h('select', {
          'aria-label': `Status of ${p.name}`,
          onchange: async (e) => {
            const { data, error } = await sb.from('programs').update({ status: e.target.value }).eq('id', p.id).select();
            if (error || !data?.length) { e.target.value = p.status; return toast(error ? errorText(error) : 'Not allowed.', 'error'); }
            p.status = e.target.value;
            toast(`${p.name} is now ${p.status}`);
          },
        }, ['pilot', 'ready', 'planned'].map((s) => h('option', { value: s, selected: p.status === s }, s[0].toUpperCase() + s.slice(1)))))))))));

  const sites = h('div', { class: 'panel' },
    h('div', { class: 'panel-head' },
      h('div', null, h('h2', null, 'Sites'), h('div', { class: 'hint' }, 'Hospitals residents pick from, shared by all programs. The short name is what the app shows.'))),
    listEditor({
      table: 'sites', rows: state.sites, noun: 'site', extra: [{ key: 'short_name', label: 'Short name', width: '120px' }],
      usage: null, defaults: {},
      onChanged: async () => { await loadSites(); await loadConfig(); rerender(); },
    }));

  main.append(programs, sites, h('p', { class: 'hint' }, icon('info', 14), ' Admins act as program director for every program, so the program switcher lists them all.'));
}
