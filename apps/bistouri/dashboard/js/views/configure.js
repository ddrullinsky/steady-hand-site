// Configure: PDs own their program's lists. Every change is saved immediately
// and reaches the app on its next refresh.
import { state, loadConfig, insertRow, updateRow, CONFIG_TABLES } from '../api.js';
import { h, clear, icon, toast, dialog, errorText, byOrder, plural, slugify, fmtNum } from '../util.js';
import { listEditor, inlineInput, rowActions, deleteFlow, offerDeactivate } from '../listEditor.js';
import { residents, casesByResident, targetCount, targetTitle, targetDetail, targetKind } from '../stats.js';

const TABS = [
  { id: 'procedures', label: 'Categories & procedures', count: () => state.config.procedures.filter((r) => r.active).length },
  { id: 'tasks', label: 'Procedural tasks', count: () => state.config.tasks.filter((r) => r.active).length },
  { id: 'approaches', label: 'Approaches', count: () => state.config.approaches.filter((r) => r.active).length },
  { id: 'roles', label: 'Case roles', count: () => state.config.roles.filter((r) => r.active).length },
  { id: 'attendings', label: 'Attendings', count: () => state.config.attendings.filter((r) => r.active).length },
  { id: 'fields', label: 'Extra fields', count: () => state.config.fields.filter((r) => r.active).length },
  { id: 'targets', label: 'Targets', count: () => state.config.targets.filter((r) => r.active).length },
  { id: 'epas', label: 'EPAs', count: () => state.config.epas.filter((r) => r.active).length },
];

const ui = { q: '', open: new Set() };
let rerenderView = null;

// ---------------------------------------------------------------------------
// Usage counts from the program's cases (PDs can read all of them).
// ---------------------------------------------------------------------------
function usageMaps() {
  const m = { procedures: new Map(), categories: new Map(), tasks: new Map(), approaches: new Map(), roles: new Map(), attendings: new Map(), attendingNames: new Map(), fields: new Map() };
  const inc = (map, k) => k && map.set(k, (map.get(k) || 0) + 1);
  for (const c of state.cases) {
    c.procedureIds.forEach((id) => inc(m.procedures, id));
    c.categoryIds.forEach((id) => inc(m.categories, id));
    c.tasks.forEach((t) => inc(m.tasks, t.task_id));
    inc(m.approaches, c.approach_id);
    inc(m.roles, c.role_id);
    inc(m.attendings, c.attending_id);
    if (!c.attending_id && c.attending_name) inc(m.attendingNames, c.attending_name.trim().toLowerCase());
    Object.keys(c.field_values).forEach((k) => inc(m.fields, k));
  }
  return m;
}

function targetsUsing(key, id) {
  return state.config.targets.filter((t) => t[key] === id).length;
}

async function changed(info = {}) {
  try {
    await loadConfig();
  } catch (err) {
    toast(errorText(err), 'error');
  }
  rerenderView?.();
  if (info.focusAdd) {
    document.querySelector(`[data-add-key="${CSS.escape(info.focusAdd)}"]`)?.closest('form')?.querySelector('input')?.focus();
  }
}

export function render(main, { args, rerender }) {
  rerenderView = rerender;
  const tab = TABS.find((t) => t.id === args[0]) ? args[0] : 'procedures';
  main.append(
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, `Configure ${state.program.name}`),
        h('div', { class: 'sub' }, 'Your program’s lists, fields and targets. No app update needed.'))),
    h('div', { class: 'notice' }, icon('info', 18),
      h('div', null, h('strong', null, 'Changes save immediately'),
        ' and reach residents’ phones the next time the Bistouri app refreshes its lists. ',
        'Deactivate anything residents have already used instead of deleting it: it leaves the pick lists, and past cases keep their history.')),
    h('nav', { class: 'tabs', 'aria-label': 'Configuration sections' }, TABS.map((t) => h('a', {
      href: `#/configure/${t.id}`, class: t.id === tab ? 'active' : '', 'aria-current': t.id === tab ? 'page' : null,
    }, t.label, h('span', { class: 'count' }, t.count())))),
  );
  const usage = usageMaps();
  const panel = h('div', { class: 'panel' });
  main.append(panel);
  ({
    procedures: () => renderProcedures(panel, usage),
    tasks: () => renderTasks(panel, usage),
    approaches: () => renderSimple(panel, usage, { key: 'approaches', noun: 'approach', title: 'Approaches', hint: 'How the case was done (open, minimally invasive, robotic…). One per case.' }),
    roles: () => renderSimple(panel, usage, { key: 'roles', noun: 'role', title: 'Case roles', hint: 'The resident’s role, picked with one tap per case. Put the most responsible role first: the dashboard reports it as the headline role.', targetKey: 'role_id' }),
    attendings: () => renderSimple(panel, usage, { key: 'attendings', noun: 'attending', title: 'Attendings', hint: 'Staff surgeons residents pick from. Residents can still type a name that is not on the list.' }),
    fields: () => renderFields(panel, usage),
    targets: () => renderTargets(panel),
    epas: () => renderEPAs(panel),
  })[tab]();
}

function searchBox(placeholder) {
  const input = h('input', { type: 'search', placeholder, value: ui.q, 'aria-label': placeholder });
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      ui.q = input.value;
      const pos = input.selectionStart;
      rerenderView();
      const again = document.querySelector('.editor-toolbar input[type=search]');
      if (again) { again.focus(); again.setSelectionRange(pos, pos); }
    }, 150);
  });
  return h('span', { class: 'search' }, icon('search'), input);
}

// ---------------------------------------------------------------------------
// Simple lists
// ---------------------------------------------------------------------------
function renderSimple(panel, usage, cfg) {
  const rows = state.config[cfg.key];
  const u = cfg.key === 'attendings'
    ? (r) => (usage.attendings.get(r.id) || 0) + (usage.attendingNames.get(r.name.trim().toLowerCase()) || 0)
    : (r) => usage[cfg.key].get(r.id) || 0;
  panel.append(
    h('div', { class: 'editor-toolbar' },
      h('div', null, h('h2', { style: { fontSize: '16px' } }, cfg.title), h('div', { class: 'hint' }, cfg.hint)),
      rows.length > 8 ? searchBox(`Search ${cfg.title.toLowerCase()}`) : null),
    listEditor({
      table: CONFIG_TABLES[cfg.key], rows, noun: cfg.noun, usage: u, filter: ui.q,
      defaults: { program_id: state.program.id }, onChanged: changed,
      deleteNote: cfg.targetKey ? (r) => {
        const n = targetsUsing(cfg.targetKey, r.id);
        return n ? `${plural(n, 'target')} that use${n === 1 ? 's' : ''} it will also be deleted.` : null;
      } : null,
    }),
  );
  if (cfg.key === 'attendings' && !rows.length) {
    panel.append(h('p', { class: 'hint', style: { marginTop: '10px' } },
      'Tip: until you add attendings, residents type the name for each case. Adding the list makes logging faster and keeps names consistent.'));
  }
  if (cfg.key === 'attendings') panel.append(offListAttendings(rows));
}

/** Names residents typed under "Other…" that are not on the list, with one-click add. */
function offListAttendings(rows) {
  const listed = new Set(rows.map((r) => r.name.trim().toLowerCase()));
  const typed = new Map(); // lowercased name -> { name, n }
  for (const c of state.cases) {
    const name = !c.attending_id && c.attending_name?.trim();
    if (!name || listed.has(name.toLowerCase())) continue;
    const key = name.toLowerCase();
    const entry = typed.get(key) || { name, n: 0 };
    entry.n += 1;
    typed.set(key, entry);
  }
  const names = [...typed.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  if (!names.length) return null;
  const nextOrder = rows.reduce((m, r) => Math.max(m, r.sort_order || 0), 0);
  return h('div', { class: 'offlist' },
    h('h3', null, 'Typed by residents, not on your list'),
    h('p', { class: 'hint' }, 'Names residents entered under “Other…”. Add one to make it a choice in the app. Cases already logged under that name count toward it.'),
    h('ul', { class: 'items' }, names.map((x, i) => h('li', { class: 'item' },
      h('span', { class: 'item-name' }, x.name),
      h('span', { class: 'muted small' }, plural(x.n, 'case')),
      h('button', {
        class: 'btn btn-sm',
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          const { error } = await insertRow(CONFIG_TABLES.attendings,
            { program_id: state.program.id, name: x.name, sort_order: nextOrder + i + 1 });
          if (error) { e.currentTarget.disabled = false; return toast(errorText(error), 'error'); }
          toast(`Added ${x.name}`);
          await changed();
        },
      }, icon('plus'), 'Add to list')))));
}

// ---------------------------------------------------------------------------
// Procedural tasks, grouped in sections (tree)
// ---------------------------------------------------------------------------
function renderTasks(panel, usage) {
  const sections = [...state.config.taskSections].sort(byOrder);
  const tasks = state.config.tasks;
  const q = ui.q.trim().toLowerCase();
  const known = new Set(sections.map((s) => s.id));
  const tasksOf = (sid) => tasks.filter((t) => (sid ? t.section_id === sid : !known.has(t.section_id)));
  const catName = (id) => state.config.byId.categories.get(id)?.name;

  panel.append(h('div', { class: 'editor-toolbar' },
    h('div', null, h('h2', { style: { fontSize: '16px' } }, 'Procedural tasks'),
      h('div', { class: 'hint' }, 'Steps a resident ticks for a case. Tick “Count” for steps done more than once per case (e.g. distal anastomosis ×3); the others are a plain tick. ',
        'Sections group them in operative order; a section linked to procedure categories opens by itself in the app for those procedures.')),
    h('div', { class: 'toolbar' },
      searchBox('Search tasks'),
      h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { sections.forEach((s) => ui.open.add(s.id)); ui.open.add('none'); rerenderView(); } }, 'Expand all'),
      h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { ui.open.clear(); rerenderView(); } }, 'Collapse all'))));

  // Move a task to another section.
  const moveSelect = (t) => h('select', {
    class: 'small-select', 'aria-label': `Section of ${t.name}`, title: 'Move to section',
    onchange: async (e) => {
      const { error } = await updateRow('procedural_tasks', t.id, { section_id: e.target.value || null });
      if (error) return toast(errorText(error), 'error');
      toast('Moved');
      await changed();
    },
  }, sections.map((s) => h('option', { value: s.id, selected: s.id === t.section_id }, s.name)),
  h('option', { value: '', selected: !known.has(t.section_id) }, 'No section'));

  // Countable tasks get a − n + stepper in the app; the rest are a plain tick.
  const countToggle = (t) => h('label', { class: 'check small', title: 'Residents log how many times (e.g. distal anastomosis ×3)' },
    h('input', {
      type: 'checkbox', checked: !!t.countable, 'aria-label': `Count ${t.name}`,
      onchange: async (e) => {
        const { error } = await updateRow('procedural_tasks', t.id, { countable: e.target.checked });
        if (error) { e.target.checked = !e.target.checked; return toast(errorText(error), 'error'); }
        t.countable = e.target.checked;
        toast(t.countable ? 'Residents can now log a count' : 'Now a plain tick');
      },
    }), 'Count');

  const taskEditor = (sid, list) => listEditor({
    table: 'procedural_tasks', rows: list, noun: 'task', filter: ui.q,
    usage: (t) => usage.tasks.get(t.id) || 0,
    defaults: { program_id: state.program.id, section_id: sid },
    addKey: `tasks:${sid || 'none'}`, onChanged: changed,
    rowExtra: (t) => [countToggle(t), sections.length ? moveSelect(t) : null],
    deleteNote: (t) => { const n = targetsUsing('task_id', t.id); return n ? `${plural(n, 'target')} that use${n === 1 ? 's' : ''} it will also be deleted.` : null; },
  });

  const secOpts = { table: 'task_sections', noun: 'section', onChanged: changed,
    deleteNote: (s) => { const n = tasksOf(s.id).length; return n ? `Its ${plural(n, 'task')} move to “No section”; nothing is deleted from them.` : null; } };

  const editCategories = async (s) => {
    const chosen = new Set(s.category_ids || []);
    const boxes = [...state.config.categories].sort(byOrder).filter((c) => c.active).map((c) =>
      h('label', { class: 'check', style: { display: 'flex', margin: '4px 0' } },
        h('input', { type: 'checkbox', checked: chosen.has(c.id), onchange: (e) => (e.target.checked ? chosen.add(c.id) : chosen.delete(c.id)) }),
        ' ', c.name));
    const ok = await dialog({
      title: `When should “${s.name}” open by itself?`,
      body: [h('p', null, 'In the app, this section opens automatically when the case has a procedure in one of these categories. Leave all unticked for sections residents open themselves (e.g. prep, closing).'),
        h('div', null, boxes)],
      buttons: [{ label: 'Cancel', value: false, kind: 'ghost' }, { label: 'Save', value: true, kind: 'primary' }],
    });
    if (!ok) return;
    const { error } = await updateRow('task_sections', s.id, { category_ids: [...chosen] });
    if (error) return toast(errorText(error), 'error');
    toast('Saved');
    await changed();
  };

  let shown = 0;
  const groups = sections.map((s) => ({ s, list: tasksOf(s.id) }));
  const loose = tasksOf(null);
  if (loose.length || !sections.length) groups.push({ s: null, list: loose });
  for (const { s, list } of groups) {
    if (!s && !sections.length) {
      // No sections yet: a plain list, as before.
      panel.append(taskEditor(null, list));
      shown++;
      continue;
    }
    const matches = q ? list.filter((t) => t.name.toLowerCase().includes(q)) : list;
    if (q && !matches.length && !(s && s.name.toLowerCase().includes(q))) continue;
    shown++;
    const key = s ? s.id : 'none';
    const open = q ? true : ui.open.has(key);
    const head = h('div', { class: 'cat-head' });
    const box = h('div', { class: `cat${s && !s.active ? ' inactive' : ''}` }, head);
    const cats = s ? (s.category_ids || []).map(catName).filter(Boolean) : [];
    head.append(
      h('button', {
        class: 'btn btn-ghost btn-icon', 'aria-expanded': String(open), 'aria-label': `${open ? 'Collapse' : 'Expand'} ${s ? s.name : 'tasks without a section'}`,
        onclick: () => { open ? ui.open.delete(key) : ui.open.add(key); rerenderView(); },
      }, h('span', { class: 'chev', style: { display: 'inline-flex', transform: open ? 'rotate(90deg)' : 'none' } }, icon('chevron'))),
      h('span', { class: 'pos muted small', style: { textAlign: 'right' } }, s ? sections.indexOf(s) + 1 : ''),
      s ? inlineInput(s, 'name', secOpts, box, 'Section name') : h('span', { class: 'muted', style: { padding: '5px 8px' } }, 'No section'),
      h('div', { class: 'meta', style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
        h('span', { class: 'badge outline plain' }, plural(list.filter((t) => t.active).length, 'task')),
        s ? h('button', {
          class: 'btn btn-ghost btn-sm', title: 'Procedure categories that open this section in the app', onclick: () => editCategories(s),
        }, cats.length ? `Opens for: ${cats.join(', ')}` : 'Opens manually') : null,
        s && !s.active ? h('span', { class: 'badge warn' }, 'inactive') : null),
      s ? rowActions(s, sections, secOpts, !!q) : h('span'),
    );
    if (open) box.append(h('div', { class: 'cat-body' }, taskEditor(s ? s.id : null, list)));
    panel.append(box);
  }
  if (q && !shown) panel.append(h('p', { class: 'muted' }, `Nothing matches “${ui.q}”.`));

  // add section
  const input = h('input', { type: 'text', placeholder: 'New section (e.g. Tricuspid valve)', 'aria-label': 'New section name' });
  panel.append(h('form', {
    class: 'add-row', style: { marginTop: '14px' },
    onsubmit: async (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      const { data, error } = await insertRow('task_sections', {
        program_id: state.program.id, name, sort_order: sections.reduce((m, x) => Math.max(m, x.sort_order || 0), 0) + 1,
      });
      if (error) return toast(error.code === '23505' ? `“${name}” already exists.` : errorText(error), 'error');
      ui.open.add(data.id);
      toast(`Added section “${name}”. Add tasks, or move existing ones into it.`);
      await changed({ focusAdd: `tasks:${data.id}` });
    },
  }, input, h('button', { class: 'btn', type: 'submit' }, icon('plus'), 'Add section')));
}

/** Button + dialog to pick the tasks the app suggests first for a procedure. */
function typicalTasksButton(proc) {
  const n = (proc.typical_task_ids || []).length;
  return h('button', {
    class: 'btn btn-ghost btn-sm', title: 'Tasks the app suggests first when residents pick this procedure',
    onclick: () => editTypicalTasks(proc),
  }, n ? `Suggests ${plural(n, 'task')}` : 'No suggested tasks');
}

async function editTypicalTasks(proc) {
  const chosen = new Set(proc.typical_task_ids || []);
  const sections = [...state.config.taskSections].sort(byOrder);
  const known = new Set(sections.map((s) => s.id));
  const groups = sections.map((s) => ({ name: s.name, tasks: state.config.tasks.filter((t) => t.section_id === s.id) }));
  groups.push({ name: sections.length ? 'No section' : 'Tasks', tasks: state.config.tasks.filter((t) => !known.has(t.section_id)) });
  const body = groups.filter((g) => g.tasks.some((t) => t.active)).map((g) => h('fieldset', { class: 'task-group' },
    h('legend', null, g.name),
    [...g.tasks].sort(byOrder).filter((t) => t.active).map((t) => h('label', { class: 'check', style: { display: 'flex', margin: '3px 0' } },
      h('input', { type: 'checkbox', checked: chosen.has(t.id), onchange: (e) => (e.target.checked ? chosen.add(t.id) : chosen.delete(t.id)) }),
      ' ', t.name))));
  const ok = await dialog({
    title: `Suggested tasks for “${proc.name}”`,
    body: [h('p', null, 'When a resident picks this procedure, these tasks are listed first in the app, ready to tick. ',
      'Nothing is ticked automatically. The app also adds tasks the resident usually logs with it.'),
      h('div', { class: 'task-groups' }, body)],
    buttons: [{ label: 'Cancel', value: false, kind: 'ghost' }, { label: 'Save', value: true, kind: 'primary' }],
  });
  if (!ok) return;
  const order = new Map(state.config.tasks.map((t) => [t.id, t.sort_order || 0]));
  const ids = [...chosen].sort((a, b) => (order.get(a) || 0) - (order.get(b) || 0));
  const { error } = await updateRow('procedures', proc.id, { typical_task_ids: ids });
  if (error) return toast(errorText(error), 'error');
  toast('Saved');
  await changed();
}

// ---------------------------------------------------------------------------
// Categories & procedures (tree)
// ---------------------------------------------------------------------------
function renderProcedures(panel, usage) {
  const cats = [...state.config.categories].sort(byOrder);
  const q = ui.q.trim().toLowerCase();
  const procsOf = (cid) => state.config.procedures.filter((p) => p.category_id === cid);

  panel.append(h('div', { class: 'editor-toolbar' },
    h('div', null, h('h2', { style: { fontSize: '16px' } }, 'Categories & procedures'),
      h('div', { class: 'hint' }, 'Residents pick one or more procedures per case; each procedure counts toward its category.')),
    h('div', { class: 'toolbar' },
      searchBox('Search procedures'),
      h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { cats.forEach((c) => ui.open.add(c.id)); rerenderView(); } }, 'Expand all'),
      h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { ui.open.clear(); rerenderView(); } }, 'Collapse all'))));

  const catOpts = { table: 'procedure_categories', noun: 'category', onChanged: changed,
    deleteNote: (c) => {
      const n = procsOf(c.id).length;
      const t = targetsUsing('category_id', c.id) + procsOf(c.id).reduce((s, p) => s + targetsUsing('procedure_id', p.id), 0);
      return [n ? `This also deletes its ${plural(n, 'procedure')}.` : null, t ? `${plural(t, 'target')} using it will also be deleted.` : null].filter(Boolean).join(' ') || null;
    } };

  let shown = 0;
  for (const cat of cats) {
    const procs = procsOf(cat.id);
    const catMatch = !q || cat.name.toLowerCase().includes(q);
    const procMatches = q ? procs.filter((p) => p.name.toLowerCase().includes(q)) : procs;
    if (q && !catMatch && !procMatches.length) continue;
    shown++;
    const open = q ? true : ui.open.has(cat.id);
    const head = h('div', { class: 'cat-head' });
    const box = h('div', { class: `cat${cat.active ? '' : ' inactive'}` }, head);
    const used = usage.categories.get(cat.id) || 0;
    head.append(
      h('button', {
        class: 'btn btn-ghost btn-icon', 'aria-expanded': String(open), 'aria-label': `${open ? 'Collapse' : 'Expand'} ${cat.name}`,
        onclick: () => { open ? ui.open.delete(cat.id) : ui.open.add(cat.id); rerenderView(); },
      }, h('span', { class: 'chev', style: { display: 'inline-flex', transform: open ? 'rotate(90deg)' : 'none' } }, icon('chevron'))),
      h('span', { class: 'pos muted small', style: { textAlign: 'right' } }, cats.indexOf(cat) + 1),
      inlineInput(cat, 'name', catOpts, box, 'Category name'),
      h('div', { class: 'meta', style: { display: 'flex', gap: '6px', alignItems: 'center' } },
        h('span', { class: 'badge outline plain' }, `${procs.filter((p) => p.active).length} procedures`),
        h('span', { class: 'badge outline plain', title: 'Logged cases in this category' }, used ? plural(used, 'case') : 'unused'),
        cat.active ? null : h('span', { class: 'badge warn' }, 'inactive')),
      rowActions(cat, cats, catOpts, !!q),
    );
    if (open) {
      box.append(h('div', { class: 'cat-body' },
        listEditor({
          table: 'procedures', rows: procs, noun: 'procedure', filter: catMatch && q ? '' : ui.q,
          usage: (p) => usage.procedures.get(p.id) || 0,
          defaults: { program_id: state.program.id, category_id: cat.id },
          addKey: `procedures:${cat.id}`, onChanged: changed,
          rowExtra: typicalTasksButton,
          deleteNote: (p) => { const n = targetsUsing('procedure_id', p.id); return n ? `${plural(n, 'target')} using it will also be deleted.` : null; },
        })));
    }
    panel.append(box);
  }
  if (q && !shown) panel.append(h('p', { class: 'muted' }, `Nothing matches “${ui.q}”.`));

  // add category
  const input = h('input', { type: 'text', placeholder: 'New category', 'aria-label': 'New category name' });
  panel.append(h('form', {
    class: 'add-row', style: { marginTop: '14px' },
    onsubmit: async (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      const { data, error } = await insertRow('procedure_categories', {
        program_id: state.program.id, name, sort_order: cats.reduce((m, c) => Math.max(m, c.sort_order || 0), 0) + 1,
      });
      if (error) return toast(error.code === '23505' ? `“${name}” already exists.` : errorText(error), 'error');
      ui.open.add(data.id);
      toast(`Added category “${name}”. Now add its procedures.`);
      await changed({ focusAdd: `procedures:${data.id}` });
    },
  }, input, h('button', { class: 'btn', type: 'submit' }, icon('plus'), 'Add category')));
}

// ---------------------------------------------------------------------------
// Extra fields (program_fields)
// ---------------------------------------------------------------------------
const TYPE_LABELS = { number: 'Number', choice: 'Single choice', multichoice: 'Multiple choice', boolean: 'Yes / no' };

function renderFields(panel, usage) {
  const rows = [...state.config.fields].sort(byOrder);
  const opts = { table: 'program_fields', noun: 'field', onChanged: changed };
  panel.append(h('div', { class: 'editor-toolbar' },
    h('div', null, h('h2', { style: { fontSize: '16px' } }, 'Extra fields'),
      h('div', { class: 'hint' }, 'Optional per-case details specific to your program (e.g. side, fluoroscopy time, blood loss). Never patient identifiers.')),
    h('button', { class: 'btn btn-primary', onclick: () => fieldDialog(null) }, icon('plus'), 'Add field')));

  if (!rows.length) {
    panel.append(h('div', { class: 'empty' }, h('div', { class: 'empty-title' }, 'No extra fields'),
      h('p', null, 'Add one if your program tracks something beyond procedures, tasks and role.')));
    return;
  }
  panel.append(h('ul', { class: 'items' }, rows.map((f, i) => {
    const used = usage.fields.get(f.key) || 0;
    const li = h('li', { class: `item${f.active ? '' : ' inactive'}` });
    const desc = [TYPE_LABELS[f.type]];
    if (f.unit) desc.push(f.unit);
    if (f.type === 'number' && (f.min_value !== null || f.max_value !== null)) desc.push(`${f.min_value ?? '…'}–${f.max_value ?? '…'}`);
    if (f.type === 'choice' || f.type === 'multichoice') desc.push((f.options || []).join(' / ') || 'no options yet');
    li.append(
      h('span', { class: 'pos' }, i + 1),
      h('div', null,
        h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, inlineInput(f, 'label', opts, li, 'Field label'),
          h('span', { class: 'mono muted', title: 'Storage key (fixed)' }, f.key)),
        h('div', { class: 'cell-sub', style: { paddingLeft: '9px' } }, desc.join(' · '))),
      h('div', { class: 'meta' },
        f.required ? h('span', { class: 'badge brand' }, 'required') : null,
        h('span', { class: 'badge outline plain' }, used ? plural(used, 'case') : 'unused'),
        f.active ? null : h('span', { class: 'badge warn' }, 'inactive')),
      rowActions(f, rows, { ...opts, table: 'program_fields' }, false,
        [h('button', { class: 'btn btn-ghost', title: 'Edit', 'aria-label': `Edit ${f.label}`, onclick: () => fieldDialog(f) }, icon('edit'))]),
    );
    // fields have no foreign key from cases (values live in JSON), so guard here
    const del = li.querySelector('.actions button:last-child');
    del.replaceWith(h('button', {
      class: 'btn btn-ghost', title: 'Delete', 'aria-label': `Delete ${f.label}`,
      onclick: () => (used
        ? offerDeactivate(f, opts, `${plural(used, 'logged case')} ${used === 1 ? 'has' : 'have'} a value for “${f.label}”. Deleting the field would hide those values.`)
        : deleteFlow({ ...f, name: f.label }, opts)),
    }, icon('trash')));
    return li;
  })));
}

function fieldDialog(existing) {
  const f = existing || { label: '', key: '', type: 'number', options: [], unit: '', min_value: null, max_value: null, required: false };
  let keyTouched = !!existing;
  const label = h('input', { type: 'text', value: f.label, required: true, maxlength: '80' });
  const key = h('input', { type: 'text', value: f.key, class: 'mono', readonly: !!existing, pattern: '[a-z][a-z0-9_]*' });
  const type = h('select', null, Object.entries(TYPE_LABELS).map(([k, v]) => h('option', { value: k, selected: f.type === k }, v)));
  const options = h('textarea', { rows: '4', placeholder: 'One option per line' }, (f.options || []).join('\n'));
  const unit = h('input', { type: 'text', value: f.unit || '', placeholder: 'e.g. min, mL' });
  const min = h('input', { type: 'number', value: f.min_value ?? '', step: 'any' });
  const max = h('input', { type: 'number', value: f.max_value ?? '', step: 'any' });
  const required = h('input', { type: 'checkbox', checked: f.required });
  const msg = h('p', { class: 'form-msg error' });
  const optBox = h('div', { class: 'field' }, h('label', null, 'Options'), options,
    h('span', { class: 'hint' }, 'Residents pick from these. Renaming an option later does not change past cases.'));
  const numBox = h('div', { class: 'field-row' },
    h('div', { class: 'field grow' }, h('label', null, 'Unit'), unit),
    h('div', { class: 'field', style: { width: '110px' } }, h('label', null, 'Min'), min),
    h('div', { class: 'field', style: { width: '110px' } }, h('label', null, 'Max'), max));
  const sync = () => {
    optBox.style.display = type.value === 'choice' || type.value === 'multichoice' ? '' : 'none';
    numBox.style.display = type.value === 'number' ? '' : 'none';
  };
  type.addEventListener('change', sync);
  label.addEventListener('input', () => { if (!keyTouched) key.value = slugify(label.value); });
  key.addEventListener('input', () => { keyTouched = true; });
  sync();

  const dlg = h('dialog', { class: 'modal' });
  const close = () => { dlg.close(); dlg.remove(); };
  const form = h('form', {
    class: 'modal-form',
    onsubmit: async (e) => {
      e.preventDefault();
      const opts = options.value.split('\n').map((s) => s.trim()).filter(Boolean);
      const row = {
        label: label.value.trim(), type: type.value, required: required.checked,
        options: type.value === 'choice' || type.value === 'multichoice' ? [...new Set(opts)] : [],
        unit: type.value === 'number' ? (unit.value.trim() || null) : null,
        min_value: type.value === 'number' && min.value !== '' ? Number(min.value) : null,
        max_value: type.value === 'number' && max.value !== '' ? Number(max.value) : null,
      };
      if (!row.label) return (msg.textContent = 'Give the field a label.');
      if ((row.type === 'choice' || row.type === 'multichoice') && row.options.length < 2) return (msg.textContent = 'Add at least two options, one per line.');
      if (row.min_value !== null && row.max_value !== null && row.min_value > row.max_value) return (msg.textContent = 'Min must be less than max.');
      let res;
      if (existing) {
        res = await updateRow('program_fields', existing.id, row);
      } else {
        const k = key.value.trim();
        if (!/^[a-z][a-z0-9_]*$/.test(k)) return (msg.textContent = 'The key must start with a letter and use only lowercase letters, digits and _.');
        res = await insertRow('program_fields', {
          ...row, key: k, program_id: state.program.id,
          sort_order: state.config.fields.reduce((m, x) => Math.max(m, x.sort_order || 0), 0) + 1,
        });
      }
      if (res.error) return (msg.textContent = res.error.code === '23505' ? 'That key is already used by another field.' : errorText(res.error));
      close();
      toast(existing ? 'Field saved' : `Added field “${row.label}”`);
      await changed();
    },
  },
  h('h2', null, existing ? `Edit “${existing.label}”` : 'Add a field'),
  h('div', { class: 'field' }, h('label', null, 'Label'), label, h('span', { class: 'hint' }, 'What residents see, e.g. “Fluoroscopy time”.')),
  h('div', { class: 'field' }, h('label', null, 'Key'), key,
    h('span', { class: 'hint' }, existing ? 'The key is fixed once created, so past values stay linked.' : 'Generated from the label. Used to store values; it can’t change later.')),
  h('div', { class: 'field' }, h('label', null, 'Type'), type,
    existing ? h('span', { class: 'hint' }, 'Changing the type can make past values display oddly.') : null),
  optBox, numBox,
  h('label', { class: 'check' }, required, 'Required for every case'),
  msg,
  h('div', { class: 'modal-actions' },
    h('button', { type: 'button', class: 'btn btn-ghost', onclick: close }, 'Cancel'),
    h('button', { type: 'submit', class: 'btn btn-primary' }, existing ? 'Save' : 'Add field')));
  dlg.append(form);
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  document.body.appendChild(dlg);
  dlg.showModal();
  label.focus();
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------
function renderTargets(panel) {
  const cfg = state.config;
  const rows = [...cfg.targets].sort(byOrder);
  const opts = { table: 'targets', noun: 'target', onChanged: changed };
  const res = residents();
  const byRes = casesByResident();

  panel.append(h('div', { class: 'editor-toolbar' },
    h('div', null, h('h2', { style: { fontSize: '16px' } }, 'Targets'),
      h('div', { class: 'hint' }, 'Program minimums. Count cases in a category or of a procedure, or times a task was performed, optionally only in one role.'))));

  // --- add form
  const kind = h('select', { 'aria-label': 'Target type' },
    h('option', { value: 'category' }, 'Category'), h('option', { value: 'procedure' }, 'Procedure'), h('option', { value: 'task' }, 'Procedural task'));
  const subject = h('select', { 'aria-label': 'What counts', required: true });
  const role = h('select', { 'aria-label': 'Role' }, h('option', { value: '' }, 'Any role'),
    [...cfg.roles].sort(byOrder).filter((r) => r.active).map((r) => h('option', { value: r.id }, r.name)));
  const count = h('input', { type: 'number', min: '1', max: '10000', required: true, placeholder: 'e.g. 50', 'aria-label': 'Minimum count' });
  const label = h('input', { type: 'text', placeholder: 'Optional, e.g. “CABG as primary”', 'aria-label': 'Label', maxlength: '120' });
  const fillSubjects = () => {
    clear(subject);
    subject.append(h('option', { value: '' }, 'Choose…'));
    const active = (list) => [...list].sort(byOrder).filter((x) => x.active);
    if (kind.value === 'category') subject.append(active(cfg.categories).map((c) => h('option', { value: c.id }, c.name)));
    if (kind.value === 'task') subject.append(active(cfg.tasks).map((t) => h('option', { value: t.id }, t.name)));
    if (kind.value === 'procedure') {
      for (const c of active(cfg.categories)) {
        const ps = active(cfg.procedures.filter((p) => p.category_id === c.id));
        if (ps.length) subject.append(h('optgroup', { label: c.name }, ps.map((p) => h('option', { value: p.id }, p.name))));
      }
    }
  };
  kind.addEventListener('change', fillSubjects);
  fillSubjects();
  panel.append(h('form', {
    class: 'target-form', style: { marginBottom: '18px', padding: '14px', background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)' },
    onsubmit: async (e) => {
      e.preventDefault();
      if (!subject.value) return toast('Choose what counts toward the target.', 'error');
      const n = Number(count.value);
      if (!Number.isInteger(n) || n < 1) return toast('The count must be a whole number of at least 1.', 'error');
      const row = {
        program_id: state.program.id, target_count: n, label: label.value.trim() || null, role_id: role.value || null,
        category_id: kind.value === 'category' ? subject.value : null,
        procedure_id: kind.value === 'procedure' ? subject.value : null,
        task_id: kind.value === 'task' ? subject.value : null,
        sort_order: rows.reduce((m, t) => Math.max(m, t.sort_order || 0), 0) + 1,
      };
      const { error } = await insertRow('targets', row);
      if (error) return toast(errorText(error), 'error');
      toast('Target added');
      await changed();
    },
  },
  h('div', { class: 'field' }, h('label', null, 'Type'), kind),
  h('div', { class: 'field' }, h('label', null, 'What counts'), subject),
  h('div', { class: 'field' }, h('label', null, 'Role'), role),
  h('div', { class: 'field' }, h('label', null, 'Minimum'), count),
  h('div', { class: 'field' }, h('label', null, 'Label'), label),
  h('button', { class: 'btn btn-primary', type: 'submit' }, icon('plus'), 'Add target')));

  if (!rows.length) {
    panel.append(h('div', { class: 'empty' }, h('div', { class: 'empty-title' }, 'No targets yet'),
      h('p', null, 'Add your program’s minimums above. Residents see their progress rings in the app, and you see progress on each resident’s page.')));
    return;
  }

  panel.append(h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
    h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'Target'), h('th', { class: 'num' }, 'Minimum'),
      h('th', null, 'Label'), h('th', null, 'Residents meeting it'), h('th', null, ''))),
    h('tbody', null, rows.map((t, i) => {
      const tr = h('tr', { class: t.active ? '' : 'inactive' });
      const met = res.filter((r) => targetCount(t, byRes.get(r.user_id) || []) >= t.target_count).length;
      const countIn = h('input', { type: 'number', min: '1', value: t.target_count, style: { width: '84px', textAlign: 'right' }, 'aria-label': 'Minimum count' });
      countIn.addEventListener('change', async () => {
        const n = Number(countIn.value);
        if (!Number.isInteger(n) || n < 1) { countIn.value = t.target_count; return toast('Whole number of at least 1, please.', 'error'); }
        const { error } = await updateRow('targets', t.id, { target_count: n });
        if (error) { countIn.value = t.target_count; return toast(errorText(error), 'error'); }
        toast('Saved'); await changed();
      });
      tr.append(
        h('td', { class: 'muted' }, i + 1),
        h('td', null, h('div', { class: 'cell-name' }, targetTitle(t)),
          h('div', { class: 'cell-sub' }, targetDetail(t)),
          t.active ? null : h('span', { class: 'badge warn' }, 'inactive')),
        h('td', { class: 'num' }, countIn),
        h('td', null, inlineInput(t, 'label', { ...opts, onRenamed: () => changed() }, tr, 'Label', null, 'Automatic')),
        h('td', null, res.length ? `${met} of ${res.length}` : '—'),
        h('td', { class: 'actions-cell' }, rowActions({ ...t, name: targetTitle(t) }, rows, opts, false)),
      );
      return tr;
    })))));
  panel.append(h('p', { class: 'hint', style: { marginTop: '10px' } },
    `Kinds: ${['category', 'procedure', 'task'].map((k) => `${fmtNum(rows.filter((t) => targetKind(t) === k).length)} ${k}`).join(', ')}. Task targets add up the counts residents enter (e.g. ×3 distal anastomoses).`));
}

// ---------------------------------------------------------------------------
// EPAs: which cases the app suggests each one for
// ---------------------------------------------------------------------------
const STAGES = { 1: 'Transition to Discipline', 2: 'Foundations', 3: 'Core', 4: 'Transition to Practice' };

/** One line on when the app suggests an EPA, or null when it never does. */
function epaRule(epa) {
  const cfg = state.config;
  const names = (ids, map) => ids.map((id) => map.get(id)?.name).filter(Boolean);
  const tasks = names(epa.task_ids || [], cfg.byId.tasks);
  const procs = names(epa.procedure_ids || [], cfg.byId.procedures);
  const roles = names(epa.role_ids || [], cfg.byId.roles);
  const list = (xs) => (xs.length > 3 ? `${xs.slice(0, 3).join(', ')} +${xs.length - 3}` : xs.join(', '));
  const parts = [];
  if (tasks.length) parts.push(`task: ${list(tasks)}`);
  if (procs.length) parts.push(`${list(procs)}${roles.length ? ` as ${roles.join(' or ')}` : ''}`);
  else if (roles.length) parts.push(`any case as ${roles.join(' or ')}`);
  return parts.length ? parts.join('; or ') : null;
}

function renderEPAs(panel) {
  const rows = [...state.config.epas].sort(byOrder);
  const q = ui.q.trim().toLowerCase();
  const shown = q ? rows.filter((e) => `${e.code} ${e.title} ${e.description || ''}`.toLowerCase().includes(q)) : rows;

  panel.append(h('div', { class: 'editor-toolbar' },
    h('div', null, h('h2', { style: { fontSize: '16px' } }, 'EPAs'),
      h('div', { class: 'hint' }, 'After a case, the app lists the EPAs it could count toward, so the resident can ask the attending to assess them. ',
        'An EPA is suggested when the resident ticks one of its tasks (any role), or logs one of its procedures in one of its roles. ',
        'The app shows the EPAs of the resident’s stage, judged from their PGY year.')),
    h('div', { class: 'toolbar' }, searchBox('Search EPAs'))));

  if (!rows.length) {
    panel.append(h('p', { class: 'muted' }, 'No EPAs for this program yet.'));
    return;
  }
  const body = h('tbody');
  for (const stage of [1, 2, 3, 4]) {
    const list = shown.filter((e) => e.stage === stage);
    if (!list.length) continue;
    body.append(h('tr', null, h('th', { colspan: 4, scope: 'colgroup', style: { paddingTop: '14px' } }, STAGES[stage])));
    for (const e of list) {
      const rule = epaRule(e);
      body.append(h('tr', { class: e.active ? '' : 'inactive' },
        h('td', { style: { fontVariantNumeric: 'tabular-nums', fontWeight: 600, whiteSpace: 'nowrap' } }, e.code),
        h('td', null, h('div', { class: 'cell-name' }, e.title),
          h('div', { class: 'cell-sub' }, [e.description, e.requirement].filter(Boolean).join(' · ')),
          e.active ? null : h('span', { class: 'badge warn' }, 'hidden')),
        h('td', { class: rule ? 'small' : 'small muted' }, rule || 'Not suggested from cases'),
        h('td', { class: 'actions-cell' }, h('button', { class: 'btn btn-ghost btn-sm', onclick: () => editEPA(e) }, 'Edit'))));
    }
  }
  panel.append(h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
    h('thead', null, h('tr', null, h('th', null, 'EPA'), h('th', null, 'Name'), h('th', null, 'Suggested when'), h('th', null, ''))),
    body)));
  if (q && !shown.length) panel.append(h('p', { class: 'muted' }, `Nothing matches “${ui.q}”.`));
}

async function editEPA(epa) {
  const cfg = state.config;
  const chosen = { task_ids: new Set(epa.task_ids || []), procedure_ids: new Set(epa.procedure_ids || []), role_ids: new Set(epa.role_ids || []) };
  const box = (key, item) => h('label', { class: 'check', style: { display: 'flex', margin: '3px 0' } },
    h('input', { type: 'checkbox', checked: chosen[key].has(item.id), onchange: (e) => (e.target.checked ? chosen[key].add(item.id) : chosen[key].delete(item.id)) }),
    ' ', item.name);
  const active = (list) => [...list].sort(byOrder).filter((x) => x.active);

  const sections = active(cfg.taskSections);
  const known = new Set(sections.map((s) => s.id));
  const taskGroups = sections.map((s) => ({ name: s.name, items: active(cfg.tasks).filter((t) => t.section_id === s.id) }));
  taskGroups.push({ name: sections.length ? 'No section' : 'Tasks', items: active(cfg.tasks).filter((t) => !known.has(t.section_id)) });
  const procGroups = active(cfg.categories).map((c) => ({ name: c.name, items: active(cfg.procedures).filter((p) => p.category_id === c.id) }));

  const groupList = (key, groups) => groups.filter((g) => g.items.length).map((g) => {
    const picked = g.items.filter((x) => chosen[key].has(x.id)).length;
    return h('details', { class: 'task-group', open: picked > 0 },
      h('summary', { style: { cursor: 'pointer', fontWeight: 600, fontSize: '13px', color: 'var(--ink-2)' } }, g.name, picked ? ` (${picked})` : ''),
      h('div', { style: { paddingLeft: '14px' } }, g.items.map((x) => box(key, x))));
  });
  const visible = h('input', { type: 'checkbox', checked: epa.active });

  const ok = await dialog({
    title: `${epa.code} ${epa.title}`,
    body: [
      epa.description ? h('p', { class: 'muted small' }, epa.description) : null,
      h('div', { class: 'task-groups' },
        h('h3', { style: { fontSize: '14px', margin: '4px 0' } }, 'Tasks'),
        h('p', { class: 'hint' }, 'Suggested when the resident ticks any of these, whatever their role.'),
        groupList('task_ids', taskGroups),
        h('h3', { style: { fontSize: '14px', margin: '14px 0 4px' } }, 'Procedures'),
        h('p', { class: 'hint' }, 'Suggested when the case includes any of these and the resident’s role is one ticked below.'),
        groupList('procedure_ids', procGroups),
        h('h3', { style: { fontSize: '14px', margin: '14px 0 4px' } }, 'Roles'),
        h('p', { class: 'hint' }, 'For the procedures above; none ticked means any role. With no procedures, the role alone suggests it (e.g. teaching assistant).'),
        active(cfg.roles).map((r) => box('role_ids', r))),
      h('label', { class: 'check', style: { display: 'flex', marginTop: '12px' } }, visible, ' Show this EPA in the app'),
    ],
    buttons: [{ label: 'Cancel', value: false, kind: 'ghost' }, { label: 'Save', value: true, kind: 'primary' }],
  });
  if (!ok) return;
  const ordered = (set, list) => list.filter((x) => set.has(x.id)).sort(byOrder).map((x) => x.id);
  const { error } = await updateRow('epas', epa.id, {
    task_ids: ordered(chosen.task_ids, cfg.tasks),
    procedure_ids: ordered(chosen.procedure_ids, cfg.procedures),
    role_ids: ordered(chosen.role_ids, cfg.roles),
    active: visible.checked,
  });
  if (error) return toast(errorText(error), 'error');
  toast('Saved');
  await changed();
}
