// "Export cases to Excel": the resident's own cases as a CSV with a UTF-8 BOM.
// Same columns and cell rules as the iPhone app (ios/Bistouri/CaseExport.swift),
// which match the dashboard's export, so a resident's file and their program
// director's file line up. Built from the cases on this device, so it works offline.
import { toCSV, downloadText, today } from '../shared/util.js';
import { state, activeProgram, activeMembership } from './data.js';
import { nameIn, procedureName, categoryOf, siteShort } from './ref.js';

/** Numbers stay bare so spreadsheets can sum them; yes/no and lists read as words. */
function cell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(cell).join(', ');
  return '';
}

/** Lowercase, accents dropped, runs of other characters become "-". */
function slug(s) {
  const out = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return out || 'bistouri-cases';
}

export function caseCSV() {
  const ref = state.ref;
  const program = activeProgram();
  const email = state.user.email;
  const resident = state.profileName || email.split('@')[0];
  const pgy = activeMembership()?.pgy_year;
  const cases = state.cases
    .filter((c) => c.program_id === state.activeProgramId && !c.deleted)
    .sort((a, b) => a.case_date.localeCompare(b.case_date) || String(a.created_at).localeCompare(String(b.created_at)));

  // Active program fields, then any older field keys still present in these cases.
  const fields = [...ref.fields].sort((a, b) => a.sort_order - b.sort_order);
  const known = new Set(fields.map((f) => f.key));
  const extraKeys = [...new Set(cases.flatMap((c) => Object.keys(c.field_values || {})))].filter((k) => !known.has(k)).sort();
  const taskOrder = new Map(ref.tasks.map((t) => [t.id, t.sort_order]));

  const header = ['Date', 'Resident', 'Email', 'PGY', 'Program', 'Site', 'Attending', 'Urgency', 'Role',
    'Approach', 'Categories', 'Procedures', 'Procedural tasks',
    ...fields.map((f) => (f.unit != null ? `${f.label} (${f.unit})` : f.label)), ...extraKeys];

  const rows = cases.map((c) => {
    const categories = [...new Set(c.procedure_ids.map((p) => categoryOf(ref, p)).filter(Boolean))];
    const tasks = [...c.tasks].sort((a, b) => (taskOrder.get(a.task_id) ?? 0) - (taskOrder.get(b.task_id) ?? 0)).map((t) => {
      const name = nameIn(ref.tasks, t.task_id) ?? 'Unknown task';
      return t.count > 1 ? `${name} ×${t.count}` : name;
    });
    const values = c.field_values || {};
    return [
      c.case_date, resident, email, pgy ? String(pgy) : '', program?.name ?? '',
      siteShort(ref.sites.find((s) => s.id === c.site_id)),
      nameIn(ref.attendings, c.attending_id) ?? c.attending_name ?? '',
      c.urgency ? c.urgency[0].toUpperCase() + c.urgency.slice(1) : '',
      c.role_id ? (nameIn(ref.roles, c.role_id) ?? 'Role not recorded') : '',
      nameIn(ref.approaches, c.approach_id) ?? '',
      categories.map((id) => nameIn(ref.categories, id)).filter(Boolean).join('; '),
      c.procedure_ids.map((p) => procedureName(ref, p) ?? 'Unknown procedure').join('; '),
      tasks.join('; '),
      ...fields.map((f) => cell(values[f.key])),
      ...extraKeys.map((k) => cell(values[k])),
    ];
  });
  const filename = `${slug(`${program?.slug ?? 'bistouri'}-${resident}-cases`)}-${today()}.csv`;
  return { filename, text: toCSV([header, ...rows]), count: rows.length };
}

/** Downloads the file (util.downloadText adds the BOM so Excel reads accents). */
export function exportCases() {
  const { filename, text, count } = caseCSV();
  downloadText(filename, text);
  return count;
}
