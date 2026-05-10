/** Maps backend log action strings to user-facing copy (API values unchanged). */
export function displayActivityAction(action, newStatus) {
  if (action === 'Marked Vacant') return 'OPEN';
  if (action === 'Updated Waiter') return 'Updated Waiting Details';
  if (action === 'Updated Booking') return 'Updated Booking Details';
  if (action === 'Marked Full Advance Received') return 'Full Advance Received';
  if (action === 'Unmarked Full Advance Received') return 'Full Advance Unmarked';
  if (action === 'Added Waiting Note') return 'Waiting — note added';
  if (action === 'Updated Waiting Note') return 'Waiting — note updated';
  if (action === 'Added Booking Note') return 'Booking — note added';
  if (action === 'Updated Booking Note') return 'Booking — note updated';
  if (action === 'Removed Waiter' || action === 'Removed Waiting') return 'Removed Waiting';
  if (action === 'Transferred To') return 'Transferred to another plot';
  if (action === 'Transferred From') return 'Transferred from another plot';
  if (action === 'Bulk Status Update') {
    if (newStatus === 'booked') return 'Booked';
    if (newStatus === 'waiting') return 'Added to Waiting List';
    if (newStatus === 'BM') return 'Reserved BM';
    if (newStatus === 'vacant') return 'OPEN';
  }
  return action;
}
