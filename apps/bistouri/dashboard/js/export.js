// CSV export: one row per case with human-readable names.
import { state } from './api.js';
import { toCSV, downloadText, personName, today } from './util.js';
import {
  siteName, attendingName, roleName, approachName, categoryName, proceduresText, tasksText,
  displayFields, fieldValueText, urgencyLabel,
} from './stats.js';

export function exportCasesCSV(cases, filenameStem, { dated = true } = {}) {
  const fields = displayFields(cases);
  const members = new Map(state.members.map((m) => [m.user_id, m]));
  const header = ['Date', 'Resident', 'Email', 'PGY', 'Program', 'Site', 'Attending', 'Urgency', 'Role',
    'Approach', 'Categories', 'Procedures', 'Procedural tasks',
    ...fields.map((f) => (f.unit ? `${f.label} (${f.unit})` : f.label))];
  const rows = [...cases].sort((a, b) => a.case_date.localeCompare(b.case_date)).map((c) => {
    const m = members.get(c.resident_id) || {};
    return [
      c.case_date, personName(m), m.email || '', m.pgy_year || '', state.program.name,
      siteName(c.site_id), attendingName(c), urgencyLabel(c.urgency),
      c.role_id ? roleName(c.role_id) : '', approachName(c.approach_id),
      c.categoryIds.map(categoryName).join('; '), proceduresText(c), tasksText(c),
      // numbers stay bare in the CSV so spreadsheets can sum them
      ...fields.map((f) => {
        const v = c.field_values[f.key];
        return f.type === 'number' ? (v ?? '') : fieldValueText({ ...f, unit: null }, v);
      }),
    ];
  });
  const stem = (filenameStem || 'bistouri-cases').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  downloadText(`${stem}${dated ? '-' + today() : ''}.csv`, toCSV([header, ...rows]));
  return rows.length;
}
