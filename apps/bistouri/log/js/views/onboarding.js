// First run: name, program and PGY year (ios/Bistouri/ProgramPickerView.swift).
// Also "Join another program" from Settings.
import { h, clear, logo, FELLOW } from '../../shared/util.js';
import { state, activeMemberships, activeMembership, joinProgram, refreshAccount, signOut, isConnectivityError } from '../data.js';
import { card } from '../ui.js';

export function renderProgramPicker(root, { mode = 'onboarding', onDone } = {}) {
  let selected = null;
  let pgy = activeMembership()?.pgy_year || 1;
  const nameInput = h('input', { class: 'field', type: 'text', autocomplete: 'name', autocapitalize: 'words', placeholder: 'First Last', value: state.profileName, 'aria-label': 'Your name' });
  const errorEl = h('p', { class: 'err', role: 'alert' });
  const programsBox = h('div', { class: 'stack', style: { gap: '10px' } });
  const pgyBox = h('div', { class: 'pgy-row', role: 'group', 'aria-label': 'PGY year' });
  const go = h('button', { class: 'btn btn-primary btn-block', type: 'button', disabled: true }, mode === 'onboarding' ? 'Start logging' : 'Join program');

  const isOpen = (p) => p.status !== 'planned';
  function drawPrograms() {
    const joined = new Set(activeMemberships().map((m) => m.program_id));
    const list = state.programs.filter((p) => !joined.has(p.id))
      .sort((a, b) => (isOpen(a) ? 0 : 1) - (isOpen(b) ? 0 : 1) || a.sort_order - b.sort_order);
    clear(programsBox);
    if (!state.programs.length) programsBox.append(h('p', { class: 'muted' }, 'Loading programs…'));
    for (const p of list) {
      programsBox.append(h('button', {
        type: 'button', class: 'program-row', disabled: !isOpen(p), 'aria-pressed': selected === p.id ? 'true' : 'false',
        dataset: { slug: p.slug },
        onclick: () => { selected = p.id; go.disabled = false; drawPrograms(); },
      },
      h('span', { class: `tickmark ${selected === p.id ? 'on' : ''}` }),
      h('span', null, h('div', { style: { fontWeight: 650 } }, p.name),
        p.status === 'pilot' ? h('div', { class: 'tiny', style: { color: 'var(--accent-ink)' } }, 'Pilot program') : null),
      isOpen(p) ? null : h('span', { class: 'soon' }, 'Coming soon')));
    }
  }
  function drawPgy() {
    const choice = (y, label, cls) => h('button', {
      type: 'button', class: cls, 'aria-pressed': pgy === y ? 'true' : 'false', 'aria-label': y === FELLOW ? 'Fellow' : `PGY ${y}`,
      onclick: () => { pgy = y; drawPgy(); },
    }, label);
    clear(pgyBox).append(...[1, 2, 3, 4, 5, 6, 7, 8].map((y) => choice(y, String(y))), choice(FELLOW, 'Fellow', 'pgy-fellow'));
  }

  go.addEventListener('click', async () => {
    if (!selected) return;
    go.disabled = true;
    go.textContent = 'Joining…';
    errorEl.textContent = '';
    try {
      await joinProgram(selected, pgy, nameInput.value);
      onDone?.();
    } catch (err) {
      errorEl.textContent = isConnectivityError(err)
        ? "You're offline. Connect to join a program."
        : "Couldn't join this program. Try again or contact your program director.";
      go.disabled = false;
    }
    go.textContent = mode === 'onboarding' ? 'Start logging' : 'Join program';
  });

  clear(root).append(h('div', { class: 'content stack', style: { paddingBottom: '40px' } },
    mode === 'onboarding' ? h('div', { class: 'stack', style: { gap: '8px', paddingTop: '20px' } },
      logo(56), h('h1', { style: { fontSize: '30px', fontWeight: 800 } }, 'Welcome to Bistouri'),
      h('p', { class: 'muted' }, "Pick your program to get its procedure list, roles and targets.")) : null,
    card('Your name', 'person', nameInput, h('p', { class: 'hint' }, 'Shown to your program director only. Optional.')),
    card('Program', 'case', programsBox),
    card('PGY year', 'medal', pgyBox),
    errorEl, go,
    mode === 'onboarding' ? h('button', { type: 'button', class: 'link danger', onclick: signOut }, 'Sign out') : null));
  drawPrograms();
  drawPgy();
  if (!state.programs.length) refreshAccount().then(drawPrograms);
  return { redraw: drawPrograms };
}
