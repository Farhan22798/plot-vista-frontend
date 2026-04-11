/**
 * Waiting / booking notes: each entry is stored in DB with its own timestamp + author.
 * Legacy single `remarks` string is merged for display until migrated on next write.
 */

import { formatWaitingRemarksUpdatedAt, nameOnly } from './formatting';

/** @param {object | null | undefined} person — waiter or bookingDetails */
export function getRemarkEntries(person) {
  const log = person?.remarkLog;
  if (Array.isArray(log) && log.length > 0) {
    return log.map((e) => ({
      _id: e._id,
      text: String(e.text || '').trim(),
      createdAt: e.createdAt,
      createdBy: e.createdBy,
      updatedAt: e.updatedAt,
      updatedBy: e.updatedBy,
    }));
  }
  const leg = String(person?.remarks || '').trim();
  if (!leg) return [];
  return [
    {
      _id: null,
      text: leg,
      createdAt: person?.createdAt,
      createdBy: person?.createdBy,
      updatedAt: null,
      updatedBy: '',
      isLegacy: true,
    },
  ];
}

/** Join all note texts (e.g. pre-fill booking form from first waiting). */
export function joinRemarkTexts(person) {
  return getRemarkEntries(person)
    .map((e) => e.text)
    .filter(Boolean)
    .join('\n\n');
}

/** Search: all note bodies for one waiter. */
export function remarkEntriesSearchBlob(person) {
  return getRemarkEntries(person)
    .map((e) => e.text)
    .join(' ')
    .toLowerCase();
}

/** One line under each note: added … (+ edited … if applicable). */
export function formatRemarkEntryAuditLines(entry) {
  const when = entry.createdAt ? formatWaitingRemarksUpdatedAt(entry.createdAt) : '';
  const who = nameOnly(String(entry.createdBy || '').trim());
  let primary = '';
  if (when && who && who !== '-') {
    primary = `(added on ${when} by ${who})`;
  } else if (when) {
    primary = `(added on ${when})`;
  }
  const lines = primary ? [primary] : [];
  if (entry.updatedAt) {
    const ew = formatWaitingRemarksUpdatedAt(entry.updatedAt);
    const eu = nameOnly(String(entry.updatedBy || '').trim());
    if (ew && eu && eu !== '-') {
      lines.push(`(edited on ${ew} by ${eu})`);
    } else if (ew) {
      lines.push(`(edited on ${ew})`);
    }
  }
  return lines;
}

/** Plain string for Excel / PDF export. */
export function formatRemarkLogForExport(person) {
  const entries = getRemarkEntries(person);
  if (!entries.length) return '-';
  return entries
    .map((e, i) => {
      const audits = formatRemarkEntryAuditLines(e).join(' ');
      return `${i + 1}. ${e.text}${audits ? `\n   ${audits}` : ''}`;
    })
    .join('\n\n');
}
