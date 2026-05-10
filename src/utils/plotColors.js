/**
 * Shared fill rules for layout polygons (map + exported share image).
 */
export function getPlotFillColor(plot) {
  const { status } = plot;
  if (status === 'vacant') return 'transparent';
  if (status === 'waiting') {
    return plot.waitingList && plot.waitingList.length > 1 ? '#f97316' : '#ffeb3b';
  }
  if (status === 'booked') return '#2e7d32';
  if (status === 'BM') return '#0ea5e9';
  return 'transparent';
}

/**
 * Layout legend filter: which plots stay highlighted on the map.
 * `open` = no map dimming (counts only); null = normal view.
 */
export function matchesLayoutStatusFilter(plot, filter) {
  if (filter == null || filter === 'open') return true;
  if (filter === 'booked') return plot.status === 'booked';
  if (filter === 'waiting') return plot.status === 'waiting';
  if (filter === 'waiting_multi') {
    return plot.status === 'waiting' && (plot.waitingList?.length || 0) > 1;
  }
  if (filter === 'BM') return plot.status === 'BM';
  if (filter === 'full_advance') {
    return plot.status === 'booked' && Boolean(plot.bookingDetails?.isFullAdvanceReceived);
  }
  return true;
}
