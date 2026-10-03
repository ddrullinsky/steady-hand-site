// Small DOM, date and formatting helpers. No framework: views build DOM with h().

/**
 * h('div', {class: 'x', onclick: fn}, child, 'text', [more children])
 * Strings become text nodes (never parsed as HTML), null/false are skipped.
 */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'selected' || k === 'disabled' || k === 'open') el[k] = !!v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

// Inline SVG icons (stroke icons, 24px grid). Kept tiny and dependency free.
const ICONS = {
  up: 'M12 19V5M5 12l7-7 7 7',
  down: 'M12 5v14M19 12l-7 7-7-7',
  trash: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14',
  eye: 'M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M3 3l18 18M10.6 5.1A11 11 0 0 1 12 5c7 0 11 7 11 7a18 18 0 0 1-3.2 4M6.6 6.6A18 18 0 0 0 1 12s4 7 11 7a10 10 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  plus: 'M12 5v14M5 12h14',
  download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  print: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z',
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6',
  back: 'M19 12H5M12 19l-7-7 7-7',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  chevron: 'M9 18l6-6-6-6',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  check: 'M20 6L9 17l-5-5',
  x: 'M18 6L6 18M6 6l12 12',
  refresh: 'M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15',
};

export function icon(name, size = 16) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', ICONS[name] || '');
  svg.appendChild(path);
  return svg;
}

// The Bistouri mark: a scalpel on a rounded tile.
export function logo(size = 28) {
  const wrap = document.createElement('span');
  wrap.className = 'logo';
  wrap.style.width = wrap.style.height = size + 'px';
  wrap.innerHTML = `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true">
    <rect width="32" height="32" rx="8" fill="var(--brand)"/>
    <path d="M7 24.5 L18.5 13 C20.5 11 23.5 9.5 25.5 9 C25 11 23.5 14 21.5 16 L10 27.5 Z" fill="#fff"/>
    <path d="M7 24.5 L10 27.5 L8 29.5 L5 26.5 Z" fill="var(--accent)"/>
  </svg>`;
  return wrap;
}

// ---------------------------------------------------------------------------
// Dates. case_date values are plain 'YYYY-MM-DD' strings; we keep them as
// strings so comparisons never shift across time zones.
// ---------------------------------------------------------------------------

export function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function today() {
  return isoDate(new Date());
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return isoDate(new Date(y, m - 1, d + n));
}

export function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return isoDate(new Date(y, m - 1 + n, d));
}

export function daysBetween(a, b) {
  const pa = a.split('-').map(Number), pb = b.split('-').map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
}

/** Academic year starts July 1. Returns the 'YYYY-07-01' start containing iso. */
export function academicYearStart(iso = today()) {
  const [y, m] = iso.split('-').map(Number);
  return `${m >= 7 ? y : y - 1}-07-01`;
}

export function academicYearLabel(startIso) {
  const y = Number(startIso.slice(0, 4));
  return `${y}–${String(y + 1).slice(2)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export function monthKey(iso) {
  return iso.slice(0, 7);
}

export function fmtMonth(key, withYear = true) {
  const [y, m] = key.split('-').map(Number);
  return withYear ? `${MONTHS[m - 1]} ${String(y).slice(2)}` : MONTHS[m - 1];
}

/** Month keys from start to end inclusive ('YYYY-MM'). */
export function monthRange(startIso, endIso) {
  const out = [];
  let [y, m] = startIso.split('-').map(Number);
  const [ey, em] = endIso.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

export function relDays(iso) {
  if (!iso) return 'never';
  const n = daysBetween(iso, today());
  if (n <= 0) return 'today';
  if (n === 1) return 'yesterday';
  if (n < 60) return `${n} days ago`;
  return `${Math.round(n / 30)} months ago`;
}

// ---------------------------------------------------------------------------
// Numbers and text
// ---------------------------------------------------------------------------

export function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function fmtNum(n, digits = 0) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString('en-CA', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function pct(n, d) {
  if (!d) return null;
  return Math.round((n / d) * 100);
}

export function plural(n, one, many = one + 's') {
  return `${fmtNum(n)} ${n === 1 ? one : many}`;
}

export function slugify(label) {
  let s = label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!/^[a-z]/.test(s)) s = 'f_' + s;
  return s.slice(0, 48) || 'field';
}

export function personName(m) {
  return m.full_name || (m.email ? m.email.split('@')[0] : 'Unnamed');
}

export function pgyLabel(p) {
  return p ? `PGY-${p}` : 'PGY —';
}

export function byOrder(a, b) {
  return (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.name ?? a.label).localeCompare(String(b.name ?? b.label));
}

// ---------------------------------------------------------------------------
// CSV + downloads
// ---------------------------------------------------------------------------

export function toCSV(rows) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(esc).join(',')).join('\r\n');
}

export function downloadText(filename, text, type = 'text/csv;charset=utf-8') {
  // BOM so Excel opens UTF-8 (accents in names) correctly.
  const blob = new Blob(['﻿' + text], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// Toasts and dialogs
// ---------------------------------------------------------------------------

export function toast(message, kind = 'ok') {
  let host = document.getElementById('toasts');
  if (!host) {
    host = h('div', { id: 'toasts', 'aria-live': 'polite', role: 'status' });
    document.body.appendChild(host);
  }
  const t = h('div', { class: `toast toast-${kind}` }, message);
  host.appendChild(t);
  setTimeout(() => t.classList.add('out'), kind === 'error' ? 6000 : 3000);
  setTimeout(() => t.remove(), kind === 'error' ? 6500 : 3500);
}

/**
 * Modal dialog. buttons: [{label, value, kind: 'primary'|'danger'|'ghost'}].
 * Resolves with the chosen button's value (or null when dismissed).
 */
export function dialog({ title, body, buttons }) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'modal', 'aria-labelledby': 'dlg-title' });
    const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.append(
      h('h2', { id: 'dlg-title' }, title),
      h('div', { class: 'modal-body' }, body),
      h('div', { class: 'modal-actions' },
        buttons.map((b) => h('button', {
          type: 'button', class: `btn ${b.kind ? 'btn-' + b.kind : ''}`, onclick: () => done(b.value),
        }, b.label))),
    );
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
    document.body.appendChild(dlg);
    dlg.showModal();
  });
}

export function confirmDialog(title, body, confirmLabel = 'Confirm', kind = 'primary') {
  return dialog({
    title, body,
    buttons: [{ label: 'Cancel', value: false, kind: 'ghost' }, { label: confirmLabel, value: true, kind }],
  });
}

/** Friendly text for a Supabase/PostgREST error. */
export function errorText(err) {
  if (!err) return 'Something went wrong.';
  if (err.code === '23505') return 'That name is already in use in this list.';
  if (err.code === '23503') return 'It is still used by logged cases.';
  if (err.code === '42501') return 'You do not have permission to change this.';
  if (err.code === '23514') return 'That value is not allowed.';
  return err.message || String(err);
}

export function emptyState(title, text, action) {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty-title' }, title),
    text ? h('p', null, text) : null,
    action || null);
}
