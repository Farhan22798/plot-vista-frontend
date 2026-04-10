/** Maps backend log action strings to user-facing copy (API values unchanged). */
export function displayActivityAction(action, newStatus) {
  if (action === 'Marked Vacant') return 'OPEN';
  if (action === 'Updated Waiter') return 'Updated Waiting Details';
  if (action === 'Removed Waiter' || action === 'Removed Waiting') return 'Removed Waiting';
  if (action === 'Bulk Status Update') {
    if (newStatus === 'booked') return 'Booked';
    if (newStatus === 'waiting') return 'Added to Waiting List';
    if (newStatus === 'BM') return 'Reserved BM';
    if (newStatus === 'vacant') return 'OPEN';
  }
  return action;
}
