/**
 * Client-side rules for plot transfer destination (mirror backend transferPlot).
 * @returns {string|null} Error message, or null if valid.
 */
export function getTransferTargetValidationError(sourcePlot, targetPlot, kind) {
  if (!sourcePlot?._id || !targetPlot?._id) {
    return 'Select a plot.';
  }
  if (String(targetPlot._id) === String(sourcePlot._id)) {
    return 'Choose a different plot than the current one.';
  }
  if (kind === 'booking') {
    if (targetPlot.status !== 'vacant') {
      return 'This plot is not open. Transfer booking only to a fully open plot.';
    }
    if (targetPlot.bookingDetails) {
      return 'This plot has a booking. Transfer not allowed.';
    }
    if ((targetPlot.waitingList || []).length > 0) {
      return 'This plot has waiting entries. Transfer not allowed.';
    }
    return null;
  }
  if (kind === 'waiting') {
    if (targetPlot.status === 'booked' || targetPlot.bookingDetails) {
      return 'This plot has a booking. Transfer not allowed.';
    }
    if (targetPlot.status === 'BM') {
      return 'Cannot transfer to a BM-reserved plot.';
    }
    if (targetPlot.status === 'vacant' && (targetPlot.waitingList || []).length > 0) {
      return 'Target plot data is inconsistent (OPEN with waiting list). Choose another plot.';
    }
    if (targetPlot.status !== 'vacant' && targetPlot.status !== 'waiting') {
      return 'Invalid target plot for transfer.';
    }
    return null;
  }
  return 'Invalid transfer type.';
}
