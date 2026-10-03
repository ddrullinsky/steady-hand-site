// Reusable editor for a sortable list of named rows (tasks, approaches, roles,
// attendings, procedures, sites): add, rename inline, reorder, deactivate,
// delete-if-unused.
import { insertRow, updateRow, deleteRow, saveOrder } from './api.js';
import { h, icon, toast, dialog, errorText, byOrder, plural } from './util.js';

/**
 * opts:
 *   table        Supabase table name
 *   rows         rows in this list (any order; sorted by sort_order here)
 *   noun         'task', 'approach', ...
 *   usage(row)   number of cases using the row (for display)
 *   extra        optional [{ key, label, width }] extra inline text columns (e.g. sites.short_name)
 *   defaults     fields added to every insert (e.g. { program_id, category_id })
 *   filter       search text; reorder is disabled while filtering
 *   deleteNote(row)  extra warning text for the delete confirmation
 *   rowExtra(row)    optional element shown next to the usage badge (e.g. a "move to" select)
 *   onChanged()  async; reloads data and re-renders
 *   addPlaceholder
 */
export function listEditor(opts) {
  const ordered = [...opts.rows].sort(byOrder);
  const q = (opts.filter || '').trim().toLowerCase();
  const visible = q ? ordered.filter((r) => r.name.toLowerCase().includes(q)) : ordered;
  const wrap = h('div', { class: 'list-editor' });

  if (visible.length) {
    wrap.append(h('ul', { class: 'items' }, visible.map((row) => itemRow(row, ordered, opts, !!q))));
  } else if (q) {
    wrap.append(h('p', { class: 'muted small', style: { padding: '8px 2px' } }, `No ${opts.noun}s match “${opts.filter}”.`));
  } else {
    wrap.append(h('p', { class: 'muted small', style: { padding: '8px 2px' } }, `No ${opts.noun}s yet. Add the first one below.`));
  }
  if (opts.showAdd !== false) wrap.append(addForm(ordered, opts));
  return wrap;
}

function itemRow(row, ordered, opts, filtering) {
  const idx = ordered.findIndex((r) => r.id === row.id);
  const used = opts.usage ? opts.usage(row) : null;
  const li = h('li', { class: `item${row.active === false ? ' inactive' : ''}` });

  const nameIn = inlineInput(row, 'name', opts, li, `Name of ${opts.noun}`);
  const extras = (opts.extra || []).map((x) => inlineInput(row, x.key, opts, li, x.label, x.width, x.label));

  li.append(
    h('span', { class: 'pos' }, idx + 1),
    extras.length ? h('div', { style: { display: 'flex', gap: '6px' } }, nameIn, extras) : nameIn,
    h('div', { class: 'meta' },
      opts.rowExtra ? opts.rowExtra(row) : null,
      used !== null ? h('span', { class: `badge outline plain`, title: 'Logged cases that use this' }, used ? plural(used, 'case') : 'unused') : null,
      row.active === false ? h('span', { class: 'badge warn' }, 'inactive') : null),
    rowActions(row, ordered, opts, filtering),
  );
  return li;
}

export function inlineInput(row, key, opts, li, label, width, placeholder) {
  const input = h('input', {
    type: 'text', class: 'inline-edit', value: row[key] ?? '', 'aria-label': label, placeholder: placeholder || '',
    style: width ? { width, flex: 'none' } : null,
  });
  const original = () => row[key] ?? '';
  const save = async () => {
    const v = input.value.trim();
    if (v === original()) return;
    if (!v && key === 'name') { input.value = original(); toast('A name is required.', 'error'); return; }
    li.classList.add('saving');
    const { error } = await updateRow(opts.table, row.id, { [key]: v || null });
    li.classList.remove('saving');
    if (error) { toast(errorText(error), 'error'); input.value = original(); return; }
    row[key] = v || null;
    li.classList.remove('flash'); void li.offsetWidth; li.classList.add('flash');
    toast('Saved');
    opts.onRenamed?.();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = original(); input.blur(); }
  });
  input.addEventListener('blur', save);
  return input;
}

export function rowActions(row, ordered, opts, filtering, extraButtons = []) {
  const idx = ordered.findIndex((r) => r.id === row.id);
  const move = async (delta) => {
    const next = [...ordered];
    const j = idx + delta;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    const { error } = await saveOrder(opts.table, next);
    if (error) toast(errorText(error), 'error');
    await opts.onChanged();
  };
  const toggle = async () => {
    const { error } = await updateRow(opts.table, row.id, { active: !row.active });
    if (error) return toast(errorText(error), 'error');
    toast(row.active ? `Deactivated. It no longer appears in the app’s pick lists.` : 'Reactivated');
    await opts.onChanged();
  };
  const label = row.name || row.label || 'this item';
  return h('div', { class: 'actions' },
    extraButtons,
    h('button', { class: 'btn btn-ghost', title: 'Move up', 'aria-label': `Move ${label} up`, disabled: filtering || idx === 0, onclick: () => move(-1) }, icon('up')),
    h('button', { class: 'btn btn-ghost', title: 'Move down', 'aria-label': `Move ${label} down`, disabled: filtering || idx === ordered.length - 1, onclick: () => move(1) }, icon('down')),
    h('button', {
      class: 'btn btn-ghost', title: row.active ? 'Deactivate (hide from the app)' : 'Reactivate',
      'aria-label': `${row.active ? 'Deactivate' : 'Reactivate'} ${label}`, onclick: toggle,
    }, icon(row.active ? 'eyeOff' : 'eye')),
    h('button', { class: 'btn btn-ghost', title: 'Delete', 'aria-label': `Delete ${label}`, onclick: () => deleteFlow(row, opts) }, icon('trash')),
  );
}

/** Try the delete; if logged cases still reference it, explain and offer to deactivate. */
export async function deleteFlow(row, opts) {
  const label = row.name || row.label;
  const note = opts.deleteNote ? opts.deleteNote(row) : null;
  const ok = await dialog({
    title: `Delete “${label}”?`,
    body: [h('p', null, 'This cannot be undone. Anything residents have already logged with it is protected: if it is in use, nothing will be deleted.'),
      note ? h('p', null, h('strong', null, note)) : null],
    buttons: [{ label: 'Cancel', value: false, kind: 'ghost' }, { label: 'Delete', value: true, kind: 'danger' }],
  });
  if (!ok) return;
  const { error } = await deleteRow(opts.table, row.id);
  if (error && error.code === '23503') {
    await offerDeactivate(row, opts, `“${label}” is used by logged cases, so it can’t be deleted without breaking residents’ records.`);
    return;
  }
  if (error) { toast(errorText(error), 'error'); return; }
  toast(`Deleted “${label}”`);
  await opts.onChanged();
}

export async function offerDeactivate(row, opts, reason) {
  if (row.active === false) {
    await dialog({ title: 'Can’t delete', body: h('p', null, reason + ' It is already inactive, so residents no longer see it.'), buttons: [{ label: 'OK', value: true, kind: 'primary' }] });
    return;
  }
  const choice = await dialog({
    title: 'Deactivate instead?',
    body: [h('p', null, reason),
      h('p', null, 'Deactivating hides it from the app’s pick lists for new cases. Past cases keep showing it, and you can reactivate it at any time.')],
    buttons: [{ label: 'Keep as is', value: false, kind: 'ghost' }, { label: 'Deactivate', value: true, kind: 'primary' }],
  });
  if (!choice) return;
  const { error } = await updateRow(opts.table, row.id, { active: false });
  if (error) return toast(errorText(error), 'error');
  toast('Deactivated');
  await opts.onChanged();
}

function addForm(ordered, opts) {
  const input = h('input', { type: 'text', placeholder: opts.addPlaceholder || `New ${opts.noun}`, 'aria-label': `New ${opts.noun} name`, maxlength: '200' });
  const extraIns = (opts.extra || []).map((x) => h('input', { type: 'text', placeholder: x.label, 'aria-label': x.label, style: { width: x.width || '120px' } }));
  const btn = h('button', { class: 'btn', type: 'submit' }, icon('plus'), `Add ${opts.noun}`);
  return h('form', {
    class: 'add-row', style: { marginTop: '10px' },
    onsubmit: async (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return input.focus();
      btn.disabled = true;
      const row = { ...opts.defaults, name, sort_order: ordered.reduce((m, r) => Math.max(m, r.sort_order || 0), 0) + 1 };
      (opts.extra || []).forEach((x, i) => { if (extraIns[i].value.trim()) row[x.key] = extraIns[i].value.trim(); });
      const { error } = await insertRow(opts.table, row);
      btn.disabled = false;
      if (error) return toast(error.code === '23505' ? `“${name}” already exists in this list.` : errorText(error), 'error');
      toast(`Added “${name}”`);
      await opts.onChanged({ focusAdd: opts.addKey || opts.table });
    },
  }, input, extraIns, btn, h('span', { class: 'hidden-key', dataset: { addKey: opts.addKey || opts.table } }));
}
