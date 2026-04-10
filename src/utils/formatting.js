/**
 * Shared formatting helpers used across screens.
 */

export function toOrdinal(n) {
  const j = n % 10;
  const k = n % 100;
  if (j === 1 && k !== 11) return `${n}st`;
  if (j === 2 && k !== 12) return `${n}nd`;
  if (j === 3 && k !== 13) return `${n}rd`;
  return `${n}th`;
}

export function formatRupee(n) {
  if (n == null || n === '' || Number.isNaN(Number(n))) return '—';
  return `Rs. ${Number(n).toLocaleString()}`;
}

export function numOrZero(n) {
  if (n == null || n === '' || Number.isNaN(Number(n))) return 0;
  return Number(n);
}

export function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Date + time for booking modal queue / booking cards: seconds + 12h am/pm (e.g. … 03:45:07 pm).
 */
export function formatDateTimeCard(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

/** Strip trailing " (mobileNumber)" from actor labels stored in DB. */
export function nameOnly(actor) {
  if (!actor) return '-';
  return String(actor).replace(/\s*\(\d[\d\s\-+]*\)\s*$/, '').trim() || actor;
}

/**
 * Normalized key for matching actor strings (createdBy / changedBy) to User.name in the avatar map.
 */
export function avatarLookupKey(actor) {
  const display = nameOnly(actor || '');
  let s = String(display || '').trim().toLowerCase();
  if (!s || s === '-') return '';
  try {
    s = s.normalize('NFC');
  } catch (_) {
    /* ignore */
  }
  return s.replace(/\s+/g, ' ');
}

/** Last 10 digits for mobile fallback keys (prefix m: in avatar map). */
export function avatarMobileKey(actorOrMobile) {
  const digits = String(actorOrMobile || '').replace(/\D/g, '');
  if (digits.length < 10) return '';
  return digits.slice(-10);
}
