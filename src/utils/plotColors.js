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
