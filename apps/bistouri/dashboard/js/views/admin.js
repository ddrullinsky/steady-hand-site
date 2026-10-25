// Admin (profiles.is_admin only; the server enforces it too): program requests,
// program status and the global list of sites.
import { sb, state, loadSites, loadConfig, loadIdentity } from '../api.js';
import { h, clear, icon, toast, errorText, fmtDate, isoDate, confirmDialog, emptyState } from '../util.js';
import { listEditor } from '../listEditor.js';
import { showDashboard } from '../app.js';

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

  const requests = h('div', { class: 'panel', id: 'program-requests' },
    h('div', { class: 'panel-head' }, h('h2', null, 'Program requests'),
      h('span', { class: 'hint' }, 'Sent from “Request it for your program” on the sign-in page')),
    h('p', { class: 'hint' }, 'Loading…'));
  loadRequests(requests, rerender);

  main.append(requests, programs, sites, h('p', { class: 'hint' }, icon('info', 14), ' Admins act as program director for every program, so the program switcher lists them all.'));
}

// ---------------------------------------------------------------------------
// Program requests
// ---------------------------------------------------------------------------

/** Lowercase letters, digits and single hyphens, as programs.slug expects. */
function programSlug(text) {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

async function loadRequests(panel, rerender) {
  const { data, error } = await sb.from('program_requests').select('*').order('created_at', { ascending: false }).limit(200);
  const head = panel.firstChild;
  clear(panel).append(head);
  if (error) { panel.append(h('p', { class: 'form-msg error' }, errorText(error))); return; }
  const pending = data.filter((r) => r.status === 'pending');
  const decided = data.filter((r) => r.status !== 'pending');
  panel.append(pending.length
    ? h('div', { class: 'stack' }, pending.map((r) => requestCard(r, rerender)))
    : emptyState('No requests waiting', 'New requests appear here.'));
  if (decided.length) {
    const program = (id) => state.allPrograms.find((p) => p.id === id)?.name || '';
    panel.append(h('details', { style: { marginTop: '14px' } },
      h('summary', null, `Decided (${decided.length})`),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table compact' },
        h('thead', null, h('tr', null, ['Received', 'From', 'Program', 'Decision'].map((x) => h('th', null, x)))),
        h('tbody', null, decided.map((r) => h('tr', null,
          h('td', null, fmtDate(isoDate(new Date(r.created_at)))),
          h('td', null, r.full_name, h('div', { class: 'cell-sub' }, r.email)),
          h('td', null, r.program_name, h('div', { class: 'cell-sub' }, r.institution)),
          h('td', null, r.status === 'approved' ? `Approved${program(r.program_id) ? `: ${program(r.program_id)}` : ''}` : 'Declined'))))))));
  }
}

function requestCard(r, rerender) {
  // Outside McGill, name the program with its university so pickers stay unambiguous.
  const suggested = /mcgill/i.test(r.institution) ? r.program_name : `${r.program_name} (${r.institution})`;
  const nameIn = h('input', { type: 'text', value: suggested, 'aria-label': 'Program name' });
  const slugIn = h('input', { type: 'text', value: programSlug(suggested), 'aria-label': 'Short name', class: 'mono' });
  nameIn.addEventListener('input', () => { if (!slugIn.dataset.edited) slugIn.value = programSlug(nameIn.value); });
  slugIn.addEventListener('input', () => { slugIn.dataset.edited = '1'; });
  // Start from the program whose name looks most like the request, else empty lists.
  const guess = state.allPrograms.find((p) => {
    const a = p.name.toLowerCase(); const b = r.program_name.toLowerCase();
    return b.includes(a.split(/[\s&–-]+/)[0]) || a.includes(b.split(/[\s&–-]+/)[0]);
  });
  const source = h('select', { 'aria-label': 'Start from' },
    h('option', { value: '' }, 'Empty lists'),
    state.allPrograms.map((p) => h('option', { value: p.id, selected: guess?.id === p.id }, `Copy of ${p.name}`)));
  const msg = h('p', { class: 'form-msg' });
  const approve = h('button', { class: 'btn btn-primary' }, icon('check'), 'Approve and invite');
  const decline = h('button', { class: 'btn btn-ghost' }, 'Decline');

  approve.addEventListener('click', async () => {
    approve.disabled = true; decline.disabled = true; msg.textContent = '';
    const { error } = await sb.rpc('approve_program_request', {
      p_request: r.id, p_slug: slugIn.value.trim(), p_name: nameIn.value.trim(), p_source: source.value || null,
    });
    if (error) {
      approve.disabled = false; decline.disabled = false;
      msg.className = 'form-msg error';
      msg.textContent = error.code === '23505' ? 'A program with that short name already exists.' : errorText(error);
      return;
    }
    toast(`${nameIn.value.trim()} created. ${r.email} is invited as its program director.`);
    await loadIdentity();
    showDashboard();
    showWelcomeDraft(r, nameIn.value.trim());
  });

  decline.addEventListener('click', async () => {
    if (!await confirmDialog('Decline this request?', `${r.full_name} (${r.email}) will not be told automatically.`, 'Decline', 'danger')) return;
    const { error } = await sb.from('program_requests')
      .update({ status: 'declined', decided_at: new Date().toISOString(), decided_by: state.session.user.id }).eq('id', r.id);
    if (error) return toast(errorText(error), 'error');
    toast('Request declined');
    rerender();
  });

  return h('div', { class: 'card-request', style: { border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '14px 16px' } },
    h('div', { class: 'row-between' },
      h('div', null,
        h('strong', null, r.program_name), ' · ', r.institution,
        h('div', { class: 'cell-sub' }, `${r.full_name} · `, h('a', { href: `mailto:${r.email}` }, r.email),
          r.resident_count ? ` · ${r.resident_count} residents` : '', ` · ${fmtDate(isoDate(new Date(r.created_at)))}`)),
      h('span', { class: 'badge warn' }, 'waiting')),
    r.message ? h('p', { style: { whiteSpace: 'pre-wrap', margin: '8px 0' } }, r.message) : null,
    h('div', { class: 'range-bar', style: { marginTop: '10px' } },
      h('div', { class: 'field' }, h('label', null, 'Program name'), nameIn),
      h('div', { class: 'field' }, h('label', null, 'Short name'), slugIn),
      h('div', { class: 'field' }, h('label', null, 'Start from'), source)),
    h('p', { class: 'hint' }, 'Copies the procedures, tasks, approaches, roles, extra fields, targets and EPAs (not attendings). The new director adjusts them under Configure.'),
    h('div', { class: 'toolbar' }, approve, decline), msg);
}

/** A welcome email for the admin to send from their own mail app (nothing is sent automatically). */
function showWelcomeDraft(r, programName) {
  const url = location.origin + location.pathname;
  const first = r.full_name.split(/\s+/)[0];
  const subject = `Bistouri is ready for ${programName}`;
  const body = `Hi ${first},

Thanks for your interest in Bistouri. ${programName} is now set up, and you are its program director.

1. Sign in to the dashboard with ${r.email}: ${url}
2. Under Configure, review the starting procedure list, roles, approaches and targets, and add your attendings.
3. Under People, invite your residents (they can also join from the app with their university email once invited).

Residents log cases with the iPhone app (search "Bistouri" on the App Store) or, on Android, the web app: https://steadyhandsoftware.com/apps/bistouri/log/

No patient identifiers are stored. Reply to this email with any questions.

David`;
  const href = `mailto:${encodeURIComponent(r.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const text = h('textarea', { rows: '14', readonly: true }, body);
  const dlg = h('dialog', { class: 'modal', 'aria-labelledby': 'welcome-title', style: { width: 'min(640px, 94vw)' } });
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.append(
    h('h2', { id: 'welcome-title' }, 'Let them know'),
    h('div', { class: 'modal-body' },
      h('p', null, 'Nothing has been emailed. Open this as a draft in your mail app, or copy it.'), text),
    h('div', { class: 'modal-actions' },
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: close }, 'Close'),
      h('button', { type: 'button', class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(body); toast('Copied'); } catch { text.select(); } } }, 'Copy'),
      h('a', { class: 'btn btn-primary', href, style: { textDecoration: 'none' } }, 'Open draft in mail')));
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  document.body.append(dlg);
  dlg.showModal();
}
