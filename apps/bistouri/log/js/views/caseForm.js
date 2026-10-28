// New / edit / duplicate a case. A port of ios/Bistouri/CaseFormView.swift:
// the same cards in the same order, the same defaults (site and attending from
// the last case), suggested tasks, the live "EPAs to request" card and the
// same-day duplicate warning. The iPhone's encrypted private note is left out:
// it never leaves the phone, and a web page can't promise that.
import { h, clear, today, fmtDate, dialog, confirmDialog } from '../../shared/util.js';
import {
  state, programCases, activeMembership, saveLocalCase, softDeleteCase, announce, uuid,
} from '../data.js';
import {
  procedure, procedureName, procedureLabels, procedureSearchMatch, DETAIL_LIMIT, nameIn, categoryOf, siteShort, URGENCIES,
  proceduresByCategory, categoryChipName, epasForCase, STAGE_NAMES, newlyEarned,
} from '../ref.js';
import { card, chip, icon, tickmark, openSheet, leave } from '../ui.js';
import { prefs } from '../store.js';

/**
 * mode: { kind: 'new' } | { kind: 'edit', id } | { kind: 'prefill', id }
 * onSaved({ savedCase, epas, attending, earned }) runs after the form has closed.
 */
export function renderCaseForm(root, mode, { onSaved } = {}) {
  const ref = state.ref;
  const cases = programCases();
  let editing = mode.kind === 'edit' ? state.cases.find((c) => c.id === mode.id) : null;
  const source = mode.kind === 'prefill' ? state.cases.find((c) => c.id === mode.id) : editing;
  if (mode.kind !== 'new' && !source) return leave();

  // ----- Form state -----
  const f = {
    caseDate: today(), siteId: null, attendingText: '', otherAttending: false, roleId: null, procedureIds: [], procedureDetails: {},
    approachId: null, urgency: 'elective', taskCounts: new Map(), fieldValues: {}, numberText: {},
    attempted: false, sectionOpen: {}, showOtherEPAs: false,
  };
  const attendingOf = (c) => nameIn(ref.attendings, c.attending_id) ?? c.attending_name ?? '';
  function fill(c) {
    Object.assign(f, {
      siteId: c.site_id, attendingText: attendingOf(c), roleId: c.role_id, procedureIds: [...c.procedure_ids],
      procedureDetails: { ...(c.procedure_details || {}) },
      approachId: c.approach_id, urgency: c.urgency || null,
      taskCounts: new Map(c.tasks.map((t) => [t.task_id, t.count])),
      fieldValues: { ...(c.field_values || {}) }, numberText: {},
    });
    for (const fd of ref.fields) {
      const v = c.field_values?.[fd.key];
      if (fd.type === 'number' && typeof v === 'number') f.numberText[fd.key] = String(v);
    }
  }
  if (mode.kind === 'new') {
    const last = cases[0];
    if (last) { f.siteId = last.site_id; f.attendingText = attendingOf(last); }
  } else {
    fill(source);
    if (editing) f.caseDate = editing.case_date;
  }

  const favKey = `favourites.${state.user.id}.${state.activeProgramId}`;
  const favourites = () => prefs.get(favKey, []).filter((id) => procedure(ref, id));
  const toggleFavourite = (id) => {
    const favs = prefs.get(favKey, []);
    prefs.set(favKey, favs.includes(id) ? favs.filter((x) => x !== id) : [...favs, id]);
  };

  // ----- Derived lists -----
  const listedAttending = () => {
    const name = f.attendingText.trim().toLowerCase();
    return name ? ref.attendings.find((a) => a.name.toLowerCase() === name) || null : null;
  };
  const showOtherAttending = () => f.otherAttending || (f.attendingText.trim() !== '' && !listedAttending());

  /** Up to three listed attendings from the latest cases, once the list is long. */
  function recentAttendings() {
    if (ref.attendings.length <= 10) return [];
    const out = [];
    for (const c of cases.slice(0, 30)) {
      const a = ref.attendings.find((x) => x.id === c.attending_id);
      if (a && !out.includes(a)) out.push(a);
      if (out.length === 3) break;
    }
    return out;
  }

  function recentProcedureIds() {
    const seen = [];
    for (const c of cases) {
      for (const p of c.procedure_ids) {
        if (!seen.includes(p) && procedure(ref, p)) { seen.push(p); if (seen.length >= 8) return seen; }
      }
    }
    return seen;
  }

  function quickPicks() {
    const out = [];
    for (const id of favourites()) if (!f.procedureIds.includes(id)) out.push({ id, fav: true });
    for (const id of recentProcedureIds()) {
      if (!f.procedureIds.includes(id) && !out.some((x) => x.id === id)) out.push({ id, fav: false });
    }
    return out.slice(0, 8);
  }

  /** Tasks ordered by how often the resident has logged them, then program order. */
  function orderedTasks() {
    const usage = new Map();
    for (const c of cases) for (const t of c.tasks) usage.set(t.task_id, (usage.get(t.task_id) || 0) + 1);
    return ref.tasks.map((t, i) => ({ t, i })).sort((a, b) => (usage.get(b.t.id) || 0) - (usage.get(a.t.id) || 0) || a.i - b.i).map((x) => x.t);
  }

  const count = (id) => f.taskCounts.get(id) || 0;

  /** The program's typical tasks for the chosen procedures, plus tasks this resident logs in
   *  at least 40% of their own cases with the same procedure (once there are 3). Operative order. */
  function suggestedTasks() {
    if (!f.procedureIds.length) return [];
    const chosen = new Set(f.procedureIds);
    const ids = new Set(f.procedureIds.flatMap((p) => procedure(ref, p)?.typical_task_ids || []));
    const past = cases.filter((c) => c.id !== editing?.id && c.procedure_ids.some((p) => chosen.has(p))).slice(0, 20);
    if (past.length >= 3) {
      const seen = new Map();
      for (const c of past) for (const t of new Set(c.tasks.map((k) => k.task_id))) seen.set(t, (seen.get(t) || 0) + 1);
      for (const [t, n] of seen) if (n >= past.length * 0.4) ids.add(t);
    }
    const sectionOrder = new Map(ref.taskSections.map((s) => [s.id, s.sort_order]));
    const so = (t) => (t.section_id && sectionOrder.has(t.section_id) ? sectionOrder.get(t.section_id) : Infinity);
    return ref.tasks.filter((t) => ids.has(t.id)).sort((a, b) => (so(a) !== so(b) ? so(a) - so(b) : a.sort_order - b.sort_order));
  }

  function suggestedTitle() {
    const names = f.procedureIds.map((p) => procedureName(ref, p)).filter(Boolean);
    const shown = names.slice(0, 2).join(' + ');
    return names.length > 2 ? `Suggested for ${shown} +${names.length - 2}` : `Suggested for ${shown}`;
  }

  /** Sections in operative order; tasks without a section go last. */
  function taskGroups() {
    const groups = ref.taskSections.map((s) => ({
      id: s.id, title: s.name, tasks: ref.tasks.filter((t) => t.section_id === s.id), categoryIds: new Set(s.category_ids || []),
    })).filter((g) => g.tasks.length);
    const known = new Set(ref.taskSections.map((s) => s.id));
    const rest = ref.tasks.filter((t) => !t.section_id || !known.has(t.section_id));
    if (rest.length) groups.push({ id: 'other', title: 'Other tasks', tasks: rest, categoryIds: new Set() });
    return groups;
  }

  const caseEPAs = () => epasForCase(ref, activeMembership()?.pgy_year, {
    roleId: f.roleId, procedureIds: f.procedureIds, approachId: f.approachId,
    taskIds: [...f.taskCounts].filter(([, n]) => n > 0).map(([id]) => id),
  });

  // ----- Validation -----
  const parsedNumber = (fd) => {
    const raw = (f.numberText[fd.key] || '').trim();
    if (!raw) return null;
    const n = Number(raw.replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
  };
  function numberError(fd) {
    const raw = (f.numberText[fd.key] || '').trim();
    if (!raw) return f.attempted && fd.required ? 'Required' : null;
    const v = parsedNumber(fd);
    if (Number.isNaN(v)) return 'Enter a number.';
    if (fd.min_value != null && v < fd.min_value) return `Must be at least ${fd.min_value}.`;
    if (fd.max_value != null && v > fd.max_value) return `Must be at most ${fd.max_value}.`;
    return null;
  }
  function isMissing(fd) {
    const v = f.fieldValues[fd.key];
    if (fd.type === 'number') return parsedNumber(fd) === null || Number.isNaN(parsedNumber(fd));
    if (fd.type === 'choice') return typeof v !== 'string';
    if (fd.type === 'multichoice') return !Array.isArray(v) || !v.length;
    return false;
  }
  /** An "Other ..." procedure, or one already described before the program changed it. */
  const showsDetail = (id) => !!procedure(ref, id)?.asks_detail || !!(f.procedureDetails[id] || '').trim();
  const missingDetail = (id) => !!procedure(ref, id)?.asks_detail && !(f.procedureDetails[id] || '').trim();
  function isValid() {
    if (!f.procedureIds.length) return false;
    if (f.procedureIds.some(missingDetail)) return false;
    for (const fd of ref.fields) {
      if (fd.type === 'number' && numberError(fd) && (f.numberText[fd.key] || '') !== '') return false;
      if (fd.required && isMissing(fd)) return false;
    }
    return true;
  }

  // ----- Cards (each can be redrawn on its own so typing never loses focus) -----
  const slots = {};
  const slot = (name) => (slots[name] = h('div', { class: 'slot', dataset: { card: name } }));
  function redraw(...names) {
    for (const n of names) if (slots[n]) clear(slots[n]).append(...[CARDS[n]()].flat().filter(Boolean));
  }

  const CARDS = {
    when() {
      const date = h('input', {
        class: 'field', type: 'date', value: f.caseDate, max: today(), 'aria-label': 'Date', id: 'case-date',
        onchange: (e) => { f.caseDate = e.target.value || today(); },
      });
      return card('When & where', 'calendar', date,
        ref.sites.length ? h('div', { class: 'chips', role: 'group', 'aria-label': 'Site' }, ref.sites.map((s) =>
          chip(siteShort(s), f.siteId === s.id, () => { f.siteId = f.siteId === s.id ? null : s.id; redraw('when'); }, { cls: 'site' }))) : null);
    },

    attending() {
      if (!ref.attendings.length) {
        // The program has no list yet: type the name, with suggestions from past cases.
        const sugg = h('div', { class: 'chips' });
        const drawSugg = () => {
          const names = [];
          const add = (n) => { n = (n || '').trim(); if (n && !names.some((x) => x.toLowerCase() === n.toLowerCase())) names.push(n); };
          for (const c of cases.slice(0, 40)) add(attendingOf(c));
          const q = f.attendingText.trim().toLowerCase();
          const shown = (q ? names.filter((n) => n.toLowerCase().includes(q) && n.toLowerCase() !== q) : names).slice(0, 6);
          clear(sugg).append(...shown.map((n) => chip(n, false, () => { f.attendingText = n; redraw('attending', 'epa'); })));
        };
        const input = attendingInput('Attending surgeon', drawSugg);
        drawSugg();
        return card('Attending', 'person', input, sugg);
      }
      const listed = listedAttending();
      const other = showOtherAttending();
      const recent = recentAttendings();
      const opt = (a) => h('option', { value: a.id, selected: listed?.id === a.id }, a.name);
      const select = h('select', {
        class: `field ${!listed && !other ? 'placeholder' : ''}`, id: 'attending-select', 'aria-label': 'Attending',
        onchange: (e) => {
          const v = e.target.value;
          if (v === '__other') {
            f.otherAttending = true;
            if (listed) f.attendingText = '';
          } else if (v === '') {
            f.attendingText = '';
            f.otherAttending = false;
          } else {
            f.attendingText = ref.attendings.find((a) => a.id === v)?.name || '';
            f.otherAttending = false;
          }
          redraw('attending', 'epa');
          if (v === '__other') slots.attending.querySelector('input')?.focus();
        },
      },
      h('option', { value: '', selected: !listed && !other }, f.attendingText || f.otherAttending ? 'No attending' : 'Choose attending'),
      recent.length ? h('optgroup', { label: 'Recent' }, recent.map((a) => h('option', { value: a.id }, a.name))) : null,
      h('optgroup', { label: 'Attendings' }, ref.attendings.map(opt)),
      h('option', { value: '__other', selected: !listed && other }, 'Other…'));
      return card('Attending', 'person', select,
        other ? attendingInput("Attending's name") : null,
        other ? h('p', { class: 'hint' }, "Not on your program's list. Your program director can add them.") : null);
    },

    role() {
      return card('My role', 'shield',
        ref.roles.length ? null : h('p', { class: 'hint' }, "Roles will appear once your program's lists have synced."),
        h('div', { class: 'chips', role: 'group', 'aria-label': 'My role' }, ref.roles.map((r) =>
          chip(r.name, f.roleId === r.id, () => { f.roleId = f.roleId === r.id ? null : r.id; redraw('role', 'epa'); }, { large: true }))));
    },

    procedures() {
      const picks = quickPicks();
      return card('Procedures', 'case',
        f.procedureIds.length
          ? h('div', { class: 'chips', 'aria-label': 'Selected procedures' }, f.procedureIds.map((id) =>
            h('span', { class: 'token' }, procedureName(ref, id) ?? 'Unknown procedure',
              h('button', { type: 'button', 'aria-label': `Remove ${procedureName(ref, id) ?? 'procedure'}`, onclick: () => {
                f.procedureIds = f.procedureIds.filter((x) => x !== id); redraw('procedures', 'tasks', 'epa');
              } }, icon('x', 16)))))
          : h('p', { class: f.attempted ? 'err' : 'hint' }, f.attempted ? 'Pick at least one procedure.' : 'Tap a quick pick or browse the full list.'),
        ...f.procedureIds.filter(showsDetail).map(detailField),
        picks.length ? h('div', { class: 'sub-head' }, 'Quick picks') : null,
        picks.length ? h('div', { class: 'chips' }, picks.map((p) => chip(procedureName(ref, p.id), false, () => {
          if (!f.procedureIds.includes(p.id)) f.procedureIds.push(p.id);
          redraw('procedures', 'tasks', 'epa');
        }, { iconName: p.fav ? 'star' : 'clock', cls: p.fav ? 'fav' : '' }))) : null,
        h('button', { type: 'button', class: 'btn btn-secondary btn-block', id: 'browse-procedures', onclick: openProcedurePicker },
          icon('search'), 'Browse all procedures'));
    },

    approach() {
      if (!ref.approaches.length) return null;
      return card('Approach', 'branch', h('div', { class: 'chips', role: 'group', 'aria-label': 'Approach' }, ref.approaches.map((a) =>
        chip(a.name, f.approachId === a.id, () => { f.approachId = f.approachId === a.id ? null : a.id; redraw('approach', 'epa'); }))));
    },

    urgency() {
      return card('Urgency', 'clock', h('div', { class: 'chips', role: 'group', 'aria-label': 'Urgency' }, URGENCIES.map((u) =>
        chip(u.label, f.urgency === u.id, () => { f.urgency = f.urgency === u.id ? null : u.id; redraw('urgency'); }, { tint: u.id === 'emergent' ? 'coral' : '' }))));
    },

    tasks() {
      if (!ref.tasks.length) return null;
      const onChange = () => redraw('tasks', 'epa');
      if (!ref.taskSections.length) {
        // Programs without sections: selected tasks plus up to five frequent ones, and the full list.
        const ordered = orderedTasks();
        const selected = ordered.filter((t) => count(t.id) > 0);
        const extra = ordered.filter((t) => count(t.id) === 0).slice(0, Math.max(0, 5 - Math.min(selected.length, 5)));
        return card('Tasks I performed', 'checklist',
          h('div', { class: 'tasklist' }, [...selected, ...extra].map((t) => taskRow(t, f.taskCounts, onChange))),
          h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: openTaskPicker }, icon('list'), `All tasks (${ref.tasks.length})`));
      }
      const suggested = suggestedTasks();
      const selectedCats = new Set(f.procedureIds.map((p) => categoryOf(ref, p)).filter(Boolean));
      const groups = taskGroups();
      return card('Tasks I performed', 'checklist',
        suggested.length ? h('div', { class: 'suggested-head', id: 'suggested-tasks' }, icon('sparkles', 16), suggestedTitle()) : null,
        suggested.length ? h('div', { class: 'tasklist' }, suggested.map((t) => taskRow(t, f.taskCounts, onChange))) : null,
        suggested.length ? h('div', { class: 'sub-head', style: { paddingTop: '8px' } }, 'All tasks') : null,
        h('div', null, groups.map((g) => {
          // Sections for the chosen procedures open by themselves (unless suggestions already cover the case).
          const open = f.sectionOpen[g.id] ?? (!suggested.length && [...g.categoryIds].some((c) => selectedCats.has(c)));
          const chosen = g.tasks.filter((t) => count(t.id) > 0);
          return h('div', { class: 'task-group' },
            h('button', {
              type: 'button', class: 'section-toggle', 'aria-expanded': open ? 'true' : 'false', dataset: { section: g.title },
              onclick: () => { f.sectionOpen[g.id] = !open; redraw('tasks'); },
            }, h('span', { class: 'chev' }, icon('chevron', 16)), g.title,
            chosen.length ? h('span', { class: 'count' }, String(chosen.length)) : null),
            open
              ? h('div', { class: 'tasklist section-body' }, g.tasks.map((t) => taskRow(t, f.taskCounts, onChange)))
              : (chosen.length ? h('div', { class: 'section-summary' }, chosen.map((t) => (count(t.id) > 1 ? `${t.name} ×${count(t.id)}` : t.name)).join(' · ')) : null));
        })));
    },

    epa() {
      const { mine, others } = caseEPAs();
      if (!mine.length) return null;
      return epaCard(mine, others, f.attendingText.trim(), ref.epaUrl, f.showOtherEPAs, (v) => { f.showOtherEPAs = v; redraw('epa'); });
    },

    fields() {
      if (!ref.fields.length) return null;
      return card('Details', 'sliders', h('div', { class: 'stack' }, ref.fields.map(fieldInput)));
    },

    actions() {
      if (!editing) return null;
      return h('div', { class: 'stack', style: { gap: '10px', paddingTop: '6px' } },
        h('button', { type: 'button', class: 'btn btn-secondary btn-block', id: 'duplicate-case', onclick: duplicate }, icon('copy'), 'Duplicate as new case'),
        h('button', { type: 'button', class: 'btn btn-danger btn-block', id: 'delete-case', onclick: deleteCase }, icon('trash'), 'Delete case'));
    },
  };

  function attendingInput(placeholder, onType) {
    return h('input', {
      class: 'field', type: 'text', value: f.attendingText, placeholder, autocapitalize: 'words', autocomplete: 'off',
      spellcheck: 'false', 'aria-label': placeholder, id: 'attending-name',
      oninput: (e) => { f.attendingText = e.target.value; redraw('epa'); onType?.(); },
    });
  }

  function fieldLabel(fd) {
    return h('span', { class: 'lbl' }, fd.label, fd.required ? h('span', { style: { color: 'var(--accent)' } }, ' *') : null);
  }

  function fieldInput(fd) {
    const required = () => (f.attempted && fd.required && isMissing(fd) ? h('p', { class: 'err' }, 'Required') : null);
    if (fd.type === 'number') {
      const err = h('p', { class: 'err', role: 'alert' }, numberError(fd) || '');
      return h('div', null,
        h('div', { class: 'row' }, h('span', { class: 'grow' }, fieldLabel(fd)),
          h('input', {
            class: 'field num-input', type: 'text', inputmode: 'decimal', placeholder: '—', value: f.numberText[fd.key] || '',
            'aria-label': fd.label, dataset: { field: fd.key },
            oninput: (e) => { f.numberText[fd.key] = e.target.value; err.textContent = numberError(fd) || ''; },
          }),
          fd.unit ? h('span', { class: 'muted', style: { minWidth: '30px' } }, fd.unit) : null),
        err);
    }
    if (fd.type === 'choice') {
      return h('div', { class: 'stack', style: { gap: '8px' } }, fieldLabel(fd),
        h('div', { class: 'chips' }, fd.options.map((o) => chip(o, f.fieldValues[fd.key] === o, () => {
          if (f.fieldValues[fd.key] === o) delete f.fieldValues[fd.key]; else f.fieldValues[fd.key] = o;
          redraw('fields');
        }))), required());
    }
    if (fd.type === 'multichoice') {
      const chosen = Array.isArray(f.fieldValues[fd.key]) ? f.fieldValues[fd.key] : [];
      return h('div', { class: 'stack', style: { gap: '8px' } }, fieldLabel(fd),
        h('div', { class: 'chips' }, fd.options.map((o) => chip(o, chosen.includes(o), () => {
          const next = chosen.includes(o) ? chosen.filter((x) => x !== o) : [...chosen, o];
          if (next.length) f.fieldValues[fd.key] = next; else delete f.fieldValues[fd.key];
          redraw('fields');
        }))), required());
    }
    // boolean: a yes/no switch; "no" is stored as no value, like the app.
    return h('div', { class: 'row-between' }, fieldLabel(fd),
      h('label', { class: 'switch' },
        h('input', {
          type: 'checkbox', role: 'switch', checked: f.fieldValues[fd.key] === true, 'aria-label': fd.label, dataset: { field: fd.key },
          onchange: (e) => { if (e.target.checked) f.fieldValues[fd.key] = true; else delete f.fieldValues[fd.key]; },
        }), h('span')));
  }

  // ----- Pickers -----
  function openProcedurePicker() {
    openSheet((close) => {
      let query = '';
      let catId = null; // category chip; null is All
      const list = h('div', { class: 'stack', style: { gap: '0' } });
      // Built once so the row keeps its scroll position; draw() only moves the highlight.
      const catChips = [{ id: null, label: 'All' },
        ...proceduresByCategory(ref).map((g) => ({ id: g.category.id, label: categoryChipName(g.category.name) }))]
        .map((c) => ({ id: c.id, el: chip(c.label, false, () => { catId = catId === c.id ? null : c.id; draw(); }) }));
      const chipRow = h('div', { class: 'chips scroll', role: 'group', 'aria-label': 'Category' }, catChips.map((c) => c.el));
      const doneBtn = h('button', { type: 'button', class: 'btn btn-primary btn-block', id: 'procedures-done', onclick: close });
      // `alias` is the search term that found the procedure, so "PFO" -> "ASD closure" makes sense.
      const row = (p, showCategory, alias) => {
        const sel = f.procedureIds.includes(p.id);
        const fav = prefs.get(favKey, []).includes(p.id);
        return h('div', { class: 'pick-row' },
          h('button', {
            type: 'button', class: 'tick', 'aria-pressed': sel ? 'true' : 'false', dataset: { procedure: p.name },
            onclick: () => {
              f.procedureIds = sel ? f.procedureIds.filter((x) => x !== p.id) : [...f.procedureIds, p.id];
              draw();
            },
          }, tickmark(sel), h('span', null, p.name, subtitle(alias ? `Also called ${alias}` : null,
            showCategory ? nameIn(ref.categories, p.category_id) : null))),
          h('button', {
            type: 'button', class: 'star', 'aria-pressed': fav ? 'true' : 'false',
            'aria-label': fav ? 'Remove from favourites' : 'Add to favourites',
            onclick: () => { toggleFavourite(p.id); draw(); },
          }, icon('star', 20)));
      };
      const subtitle = (...parts) => {
        const text = parts.filter(Boolean).join(' · ');
        return text ? h('div', { class: 'tiny muted' }, text) : null;
      };
      const group = (title, iconName, rows) => [
        h('div', { class: 'list-head' }, iconName ? icon(iconName, 14) : null, title),
        h('div', { class: 'list-group' }, rows)];
      function draw() {
        clear(list);
        for (const c of catChips) c.el.setAttribute('aria-pressed', c.id === catId ? 'true' : 'false');
        const q = query.trim().toLowerCase();
        if (!q && catId) {
          const g = proceduresByCategory(ref).find((x) => x.category.id === catId);
          if (g) list.append(...group(g.category.name, null, g.procedures.map((p) => row(p))));
        } else if (!q) {
          const favs = favourites().map((id) => procedure(ref, id));
          if (favs.length) list.append(...group('Favourites', 'star', favs.map((p) => row(p))));
          const recents = recentProcedureIds().map((id) => procedure(ref, id));
          if (recents.length) list.append(...group('Recent', 'clock', recents.map((p) => row(p))));
          for (const g of proceduresByCategory(ref)) list.append(...group(g.category.name, null, g.procedures.map((p) => row(p))));
        } else {
          const matches = ref.procedures.filter((p) => !catId || p.category_id === catId)
            .map((p) => ({ p, alias: procedureSearchMatch(ref, p, q) })).filter((m) => m.alias !== undefined);
          if (!matches.length) list.append(h('div', { class: 'empty' }, h('p', { class: 'muted' }, `No results for “${query.trim()}”`)));
          else list.append(h('div', { class: 'list-group', style: { marginTop: '12px' } }, matches.map((m) => row(m.p, !catId, m.alias))));
        }
        doneBtn.textContent = f.procedureIds.length ? `Done · ${f.procedureIds.length} selected` : 'Done';
      }
      const search = h('input', {
        class: 'field', type: 'search', placeholder: 'Search procedures', 'aria-label': 'Search procedures', autofocus: true,
        oninput: (e) => { query = e.target.value; draw(); },
      });
      draw();
      return [
        h('header', { class: 'topbar' }, h('div', { class: 'left' }), h('h1', null, 'Procedures'),
          h('div', { class: 'right' }, h('button', { type: 'button', class: 'toplink strong', onclick: close }, 'Done'))),
        h('div', { class: 'picker-bar' }, h('div', { class: 'search' }, icon('search'), search), chipRow),
        h('div', { class: 'content' }, list),
        h('div', { class: 'savebar' }, h('div', { class: 'inner' }, doneBtn))];
    }, { onClose: () => redraw('procedures', 'tasks', 'epa') });
  }

  function openTaskPicker() {
    openSheet((close) => {
      let query = '';
      const ordered = orderedTasks();
      const list = h('div', { class: 'list-group', style: { marginTop: '12px', padding: '0 14px' } });
      const doneBtn = h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: close });
      function draw() {
        const q = query.trim().toLowerCase();
        const shown = q ? ordered.filter((t) => t.name.toLowerCase().includes(q)) : ordered;
        clear(list).append(...(shown.length ? shown.map((t) => taskRow(t, f.taskCounts, draw))
          : [h('p', { class: 'muted', style: { padding: '16px 0' } }, `No results for “${query.trim()}”`)]));
        const n = [...f.taskCounts.values()].filter((v) => v > 0).length;
        doneBtn.textContent = n ? `Done · ${n} selected` : 'Done';
      }
      const search = h('input', { class: 'field', type: 'search', placeholder: 'Search tasks', 'aria-label': 'Search tasks', autofocus: true, oninput: (e) => { query = e.target.value; draw(); } });
      draw();
      return [
        h('header', { class: 'topbar' }, h('div', { class: 'left' }), h('h1', null, 'Tasks'),
          h('div', { class: 'right' }, h('button', { type: 'button', class: 'toplink strong', onclick: close }, 'Done'))),
        h('div', { class: 'content' }, h('div', { class: 'search' }, icon('search'), search), list),
        h('div', { class: 'savebar' }, h('div', { class: 'inner' }, doneBtn))];
    }, { onClose: () => redraw('tasks', 'epa') });
  }

  // ----- Actions -----
  function duplicate() {
    mode = { kind: 'prefill', id: editing.id };
    editing = null;
    f.caseDate = today();
    draw();
    window.scrollTo(0, 0);
  }

  async function deleteCase() {
    const ok = await confirmDialog('Delete this case?', "It will be removed from your log and from your program's records.", 'Delete case', 'danger');
    if (!ok) return;
    await softDeleteCase(editing);
    leave();
  }

  /** Cases already logged on the same day with one of the same procedures (new cases only). */
  function sameDayMatches() {
    if (editing) return [];
    const chosen = new Set(f.procedureIds);
    return cases.filter((c) => c.case_date === f.caseDate && c.procedure_ids.some((p) => chosen.has(p)));
  }

  function detailField(id) {
    const name = procedureName(ref, id) ?? 'Unknown procedure';
    const missing = f.attempted && missingDetail(id);
    return h('div', { class: 'stack', style: { gap: '4px' } },
      h('div', { class: 'sub-head' }, name),
      h('input', {
        class: `field${missing ? ' invalid' : ''}`, type: 'text', value: f.procedureDetails[id] || '', maxlength: DETAIL_LIMIT,
        placeholder: 'What was done, e.g. Damus-Kaye-Stansel', autocomplete: 'off', 'aria-label': `Describe ${name}`,
        dataset: { procedureDetail: name },
        oninput: (e) => { f.procedureDetails[id] = e.target.value; },
      }),
      h('p', { class: missing ? 'err' : 'hint' }, missing ? 'Say in a few words what was done.' : 'Procedure only. No patient details.'));
  }

  async function save() {
    f.attempted = true;
    document.activeElement?.blur?.();
    if (!isValid()) {
      redraw('procedures', 'fields');
      const firstError = root.querySelector('.err:not(:empty)');
      firstError?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    const matches = sameDayMatches();
    if (matches.length) {
      const lines = matches.slice(0, 3).map((c) => {
        const procs = procedureLabels(ref, c).join(' + ');
        const a = attendingOf(c);
        return a ? `${procs} with ${a}` : procs;
      });
      const go = await dialog({
        title: 'Already logged?',
        body: [`On ${fmtDate(f.caseDate)} you already logged:`, ...lines].join('\n'),
        buttons: [{ label: 'Keep editing', value: false, kind: 'ghost' }, { label: 'Log it anyway', value: true, kind: 'primary' }],
      });
      if (!go) return;
    }
    await commit();
  }

  async function commit() {
    const before = programCases();
    const now = new Date().toISOString();
    const target = editing
      ? { ...editing }
      : { id: uuid(), owner_id: state.user.id, program_id: state.activeProgramId, created_at: now };
    target.case_date = f.caseDate > today() ? today() : f.caseDate;
    target.site_id = f.siteId;
    const name = f.attendingText.trim();
    const match = ref.attendings.find((a) => a.name.toLowerCase() === name.toLowerCase());
    target.attending_id = match ? match.id : null;
    target.attending_name = match || !name ? null : name;
    target.role_id = f.roleId;
    target.procedure_ids = [...f.procedureIds];
    target.procedure_details = Object.fromEntries(f.procedureIds
      .map((id) => [id, (f.procedureDetails[id] || '').trim()]).filter(([, text]) => text));
    target.approach_id = f.approachId;
    target.urgency = f.urgency;
    const known = new Set(ref.tasks.map((t) => t.id));
    target.tasks = [
      ...ref.tasks.filter((t) => count(t.id) > 0).map((t) => ({ task_id: t.id, count: count(t.id) })),
      ...[...f.taskCounts].filter(([id, n]) => n > 0 && !known.has(id)).map(([id, n]) => ({ task_id: id, count: n })),
    ];
    const values = { ...f.fieldValues };
    for (const fd of ref.fields) {
      if (fd.type !== 'number') continue;
      const n = parsedNumber(fd);
      if (n === null || Number.isNaN(n)) delete values[fd.key]; else values[fd.key] = n;
    }
    target.field_values = values;
    target.deleted = false;

    await saveLocalCase(target);

    const after = [...before.filter((c) => c.id !== target.id), target];
    const earned = newlyEarned(ref, before, after);
    const majors = earned.filter((a) => a.isMajor).map((a) => a.id);
    if (majors.length) announce(majors, target.program_id);
    const { mine, others } = caseEPAs();
    await leave();
    onSaved?.({ savedCase: target, epas: { mine, others }, attending: name, earned, edited: !!editing });
  }

  // ----- Page -----
  const body = h('div', { class: 'content form stack' });
  function draw() {
    const isEditing = !!editing;
    clear(root).append(h('div', { class: 'screen' },
      h('header', { class: 'topbar' },
        h('div', { class: 'left' }, h('button', { type: 'button', class: 'toplink', onclick: () => leave() }, 'Cancel')),
        h('h1', null, isEditing ? 'Edit case' : 'New case'),
        h('div', { class: 'right' }, h('button', { type: 'button', class: 'toplink strong', onclick: save }, 'Save'))),
      body,
      h('div', { class: 'savebar' }, h('div', { class: 'inner' },
        h('button', { type: 'button', class: 'btn btn-primary btn-block', id: 'save-case', onclick: save }, icon('check', 20), isEditing ? 'Save changes' : 'Save case')))));
    clear(body).append(...['when', 'attending', 'role', 'procedures', 'approach', 'urgency', 'tasks', 'epa', 'fields', 'actions'].map(slot));
    redraw(...Object.keys(CARDS));
  }
  draw();
}

// ---------------------------------------------------------------------------
// Pieces also used after saving
// ---------------------------------------------------------------------------

/** One task: a tick, and − n + for countable tasks (or any count already above 1). */
export function taskRow(task, counts, onChange) {
  const n = counts.get(task.id) || 0;
  const set = (v) => { if (v > 0) counts.set(task.id, v); else counts.delete(task.id); onChange(); };
  return h('div', { class: 'taskrow' },
    h('button', { type: 'button', class: 'tick', 'aria-pressed': n > 0 ? 'true' : 'false', dataset: { task: task.name }, onclick: () => set(n > 0 ? 0 : 1) },
      tickmark(n > 0), h('span', null, task.name)),
    n > 0 && (task.countable || n > 1)
      ? h('div', { class: 'stepper' },
        h('button', { type: 'button', 'aria-label': 'Decrease count', onclick: () => set(n > 1 ? n - 1 : 0) }, '−'),
        h('output', { 'aria-live': 'polite' }, String(n)),
        h('button', { type: 'button', 'aria-label': 'Increase count', onclick: () => set(Math.min(50, n + 1)) }, '+'))
      : null);
}

/** "EPAs to request": the resident's likely stages, other stages folded, and the one45 link. */
export function epaCard(mine, others, attending, epaUrl, showOthers, setShowOthers) {
  const epaRow = (e, showStage) => h('div', { class: 'epa', dataset: { epa: e.code } },
    h('span', { class: 'epa-code' }, e.code),
    h('div', null, h('div', null, e.title),
      (showStage || e.requirement) ? h('div', { class: 'epa-detail' }, [showStage ? STAGE_NAMES[e.stage] || STAGE_NAMES[4] : null, e.requirement].filter(Boolean).join(' · ')) : null));
  return card('EPAs to request', 'seal',
    h('p', { class: 'hint' }, attending
      ? `This case could count toward these EPAs. Ask ${attending} to assess them.`
      : 'This case could count toward these EPAs. Ask your attending to assess them.'),
    h('div', null, mine.map((e) => epaRow(e, false))),
    others.length ? h('button', {
      type: 'button', class: 'fold', 'aria-expanded': showOthers ? 'true' : 'false', onclick: () => setShowOthers(!showOthers),
    }, icon('chevron', 14), `Other stages (${others.length})`) : null,
    others.length && showOthers ? h('div', null, others.map((e) => epaRow(e, true))) : null,
    epaUrl ? h('a', { class: 'btn btn-secondary btn-block', href: epaUrl, target: '_blank', rel: 'noopener' }, icon('external'), 'Open one45') : null,
    epaUrl ? h('p', { class: 'tiny muted' }, 'Pick each form under “EPA forms to send” on your To Do page.') : null);
}
