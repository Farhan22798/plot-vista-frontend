/**
 * Single source of truth for plot status colors used in legends, swatches,
 * status badges, and pill indicators across the app.
 */

export const STATUS_COLORS = {
  vacant: '#ffffff',
  waiting: '#ffeb3b',
  waitingMultiple: '#f97316',
  booked: '#2e7d32',
  BM: '#0ea5e9',
  removed: '#c62828',
};

export const STATUS_TEXT_COLORS = {
  vacant: '#0f172a',
  waiting: '#0f172a',
  booked: '#ffffff',
  BM: '#ffffff',
};

export const STATUS_LABELS = {
  vacant: 'OPEN',
  waiting: 'Waiting',
  booked: 'Booked',
  BM: 'Reserved BM',
};

export function getStatusSwatchColor(action, newStatus, waiterCount) {
  if (action === 'Marked Vacant' || newStatus === 'vacant') return STATUS_COLORS.vacant;
  if (action === 'Reserved BM' || newStatus === 'BM') return STATUS_COLORS.BM;
  if (action === 'Booked' || newStatus === 'booked') return STATUS_COLORS.booked;
  if (action === 'Updated Booking') return STATUS_COLORS.booked;
  if (action === 'Updated Waiter') return STATUS_COLORS.waiting;
  if (action === 'Added to Waiting List' || newStatus === 'waiting') {
    return waiterCount > 1 ? STATUS_COLORS.waitingMultiple : STATUS_COLORS.waiting;
  }
  if (action === 'Removed Waiting' || action === 'Removed Waiter') return STATUS_COLORS.removed;
  if (action === 'Transferred To' || action === 'Transferred From') return '#7c3aed';
  return null;
}
