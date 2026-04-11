import dayjs from 'dayjs';

export function formatActivitySummaryTimestamp(date = new Date()) {
  return dayjs(date).format('DD/MM/YYYY hh:mm A');
}

/**
 * Single-line copy for the CometChat notification group (e.g. golden-city-noti).
 */
export function buildNoteActivitySummaryText({
  kind,
  isUpdate,
  plotNumber,
  customerName,
  preview,
  actor,
  at,
}) {
  const plotLabel = `Plot No. ${plotNumber ?? '-'}`;
  const customer = String(customerName || '').trim() || '-';
  const when = at || formatActivitySummaryTimestamp();
  const actorLabel = String(actor || '').trim() || 'User';
  const ctx = kind === 'booking' ? 'Booking' : 'Waiting';
  const verb = isUpdate ? 'note updated' : 'note added';
  const p = String(preview || '').trim();
  const previewPart =
    p.length > 0 ? ` — "${p.slice(0, 100)}${p.length > 100 ? '…' : ''}"` : '';
  return `${plotLabel}, ${customer}, ${ctx} ${verb}${previewPart}, by ${actorLabel} on ${when}.`;
}
