import { normalizeCustomerCategory } from './customerCategory';
import { resolveRegularPricing, resolveScholarPricing } from './pricingHelpers';

/** Match BookingModal — backend allows only these modes on PATCH /booking. */
export const PAYMENT_MODES = ['Cash', 'Cheque', 'UPI', 'Bank Transfer'];

export function paymentToLabel(mode) {
  if (mode === 'Cash') return 'Owner Name (Received By)';
  if (mode === 'UPI') return 'UPI ID / Recipient Name';
  if (mode === 'Cheque') return 'In Favour Of / Bank Name';
  if (mode === 'Bank Transfer') return 'Bank Name & Account';
  return 'Received By';
}

export function parseRecordPaymentAmount(raw) {
  const t = String(raw ?? '').trim().replace(/,/g, '');
  if (!t) return 0;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

export function formatRupeesInr(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return `\u20B9${Number(n).toLocaleString('en-IN')}`;
}

/** Expected advance from category pricing for this plot + booking customer type. */
export function expectedAdvanceForPlot(plot, bd) {
  const cat = normalizeCustomerCategory(bd?.customerCategory);
  if (cat === 'scholar') {
    const sch = resolveScholarPricing(plot?.categoryPricing);
    const adv = sch?.advance;
    if (adv != null && `${adv}`.trim() !== '' && Number.isFinite(Number(adv))) {
      return { amount: Number(adv), rateLabel: 'Alim / Hafiz' };
    }
  }
  const reg = resolveRegularPricing(plot?.categoryPricing);
  const adv = reg?.advance;
  if (adv != null && `${adv}`.trim() !== '' && Number.isFinite(Number(adv))) {
    return { amount: Number(adv), rateLabel: 'Regular' };
  }
  return { amount: null, rateLabel: cat === 'scholar' ? 'Alim / Hafiz' : 'Regular' };
}

export function amountPaidFromBooking(bd) {
  const raw = bd?.advanceAmount;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Row shape used by Balance List and Record payment modal. */
export function balanceListRowFromBookedPlot(plot) {
  const bd = plot.bookingDetails;
  const exp = expectedAdvanceForPlot(plot, bd);
  const paid = amountPaidFromBooking(bd);
  let balanceAmount = null;
  if (exp.amount != null && paid != null) balanceAmount = exp.amount - paid;
  return {
    plotId: plot._id,
    plotNumber: plot.plotNumber,
    plot,
    bd,
    expectedAmount: exp.amount,
    expectedRateLabel: exp.rateLabel,
    amountPaid: paid,
    balanceAmount,
  };
}

/** PATCH /booking body: existing subdoc fields + optional overrides (e.g. isFullAdvanceReceived). */
export function buildBookingPatchBodyFromRow(row, overrides = {}) {
  const bd = row.bd;
  return {
    customerName: (bd.customerName || '').trim(),
    customerMobiles: Array.isArray(bd.customerMobiles)
      ? bd.customerMobiles.map((m) => String(m).trim()).filter(Boolean)
      : [],
    customerAddress: String(bd.customerAddress || '').trim(),
    customerCategory: normalizeCustomerCategory(bd.customerCategory),
    advanceAmount: Number(bd.advanceAmount ?? 0),
    paymentMode: String(bd.paymentMode || 'Cash').trim() || 'Cash',
    paymentTo: String(bd.paymentTo || '').trim(),
    isFullAdvanceReceived: !!bd.isFullAdvanceReceived,
    ...overrides,
  };
}

/** Advance recorded when the plot was first booked (`initialAdvanceAmount` only — never the pre-edit running total). */
export function firstAmountPaidAtBooking(bd) {
  const initial = bd?.initialAdvanceAmount;
  if (initial != null && Number.isFinite(Number(initial))) return Number(initial);
  return null;
}

export function buildBalanceClearedRemark({
  row,
  actorLabel,
  recordedAt,
  paymentMode,
  paymentTo,
  thisPaymentAmount,
  newAdvanceAmount,
  /** Formatted `bookingDetails.createdAt` (first booking date/time). */
  bookingRecordedAtLabel,
  extraNote,
  headline,
}) {
  const name = String(row.bd.customerName || '').trim();
  const atBooking = String(bookingRecordedAtLabel || '').trim() || '—';
  const firstAmt = firstAmountPaidAtBooking(row.bd);
  const lines = [];
  const h = String(headline || '').trim();
  if (h) lines.push(h);
  lines.push(
    `Plot No. ${row.plotNumber}`,
    name ? `Customer Name : ${name}` : null,
    `Recorded By : ${actorLabel}`,
    `Recorded at: ${recordedAt}`,
    `Payment Mode: ${paymentMode}`,
    `Received By: ${paymentTo}`,
    `Amount Received : ${formatRupeesInr(thisPaymentAmount)}`,
    `First Amount Paid : ${firstAmt != null ? formatRupeesInr(firstAmt) : '—'} on ${atBooking}`,
    `Total Amount Received Till Now : ${formatRupeesInr(newAdvanceAmount)}`,
  );
  const note = String(extraNote || '').trim();
  if (note) lines.push(`Note: ${note}`);
  return lines.filter(Boolean).join('\n');
}

/**
 * Shared validation: mode, payee details, amount. If balance due > 0, amount must be > 0.
 * @returns {{ paymentMode: string, paymentTo: string, thisPay: number, newAdvance: number } | null}
 */
export function validateRecordPaymentFormBase(row, form, showAlert) {
  const mode = String(form.paymentMode || '').trim();
  if (!mode || !PAYMENT_MODES.includes(mode)) {
    showAlert('Payment mode required', 'Select how the payment was received (same options as booking).');
    return null;
  }
  const payTo = String(form.paymentTo || '').trim();
  if (!payTo) {
    showAlert('Details required', `Enter ${paymentToLabel(mode)}.`);
    return null;
  }
  const thisPay = parseRecordPaymentAmount(form.amountThisPaymentStr);
  if (Number.isNaN(thisPay)) {
    showAlert('Invalid amount', 'Enter a valid non-negative amount for this receipt.');
    return null;
  }
  const prevPaid = row.amountPaid ?? 0;
  if (row.balanceAmount != null && row.balanceAmount > 0 && thisPay <= 0) {
    showAlert(
      'Amount needed',
      `Balance due is ${formatRupeesInr(row.balanceAmount)}. Enter the amount received now (it will be added to the booking advance).`,
    );
    return null;
  }
  return { paymentMode: mode, paymentTo: payTo, thisPay, newAdvance: prevPaid + thisPay };
}

/**
 * Partial receipt: updates advance only; does not set full advance received.
 * Not allowed when the amount clears the remaining balance (use complete action).
 */
export function validateRecordPaymentPartial(row, form, showAlert) {
  const v = validateRecordPaymentFormBase(row, form, showAlert);
  if (!v) return null;
  const bal = row.balanceAmount;
  if (v.thisPay <= 0) {
    showAlert('Amount required', 'Enter an amount greater than zero for a partial payment.');
    return null;
  }
  if (bal != null && bal > 0 && v.thisPay >= bal) {
    showAlert(
      'Use complete',
      `This amount covers the full balance (${formatRupeesInr(bal)}). Use “Complete Advance Received” instead.`,
    );
    return null;
  }
  return v;
}

/**
 * Full close: sets full advance received when balance is known and amount covers balance,
 * or when no balance remains (marks flag; amount may be zero).
 */
export function validateRecordPaymentCompleteAdvance(row, form, showAlert) {
  const v = validateRecordPaymentFormBase(row, form, showAlert);
  if (!v) return null;
  const bal = row.balanceAmount;
  if (bal == null) {
    showAlert(
      'Cannot complete',
      'Expected advance is not set for this plot, so the balance cannot be verified. Use Add Partial Payment to record a receipt, or set pricing on the layout.',
    );
    return null;
  }
  if (bal > 0 && v.thisPay < bal) {
    showAlert(
      'Amount too low',
      `Balance due is ${formatRupeesInr(bal)}. Enter at least that amount to complete, or use “Add Partial Payment” for a smaller receipt.`,
    );
    return null;
  }
  return v;
}

/** @deprecated Use validateRecordPaymentCompleteAdvance */
export function validateRecordPaymentBalanceClose(row, form, showAlert) {
  return validateRecordPaymentCompleteAdvance(row, form, showAlert);
}

/**
 * Which primary actions are enabled (no alerts). Keeps modal buttons in sync with validators.
 */
export function getRecordPaymentActionsAvailability(row, fields) {
  const mode = String(fields?.paymentMode || '').trim();
  const payTo = String(fields?.paymentTo || '').trim();
  const thisPay = parseRecordPaymentAmount(fields?.amountThisPaymentStr);
  const bal = row?.balanceAmount;

  const baseOk =
    Boolean(row) &&
    Boolean(mode) &&
    PAYMENT_MODES.includes(mode) &&
    Boolean(payTo) &&
    !Number.isNaN(thisPay) &&
    !(bal != null && bal > 0 && thisPay <= 0);

  let canPartial = false;
  let canComplete = false;
  if (baseOk) {
    canPartial = thisPay > 0 && !(bal != null && bal > 0 && thisPay >= bal);
    canComplete = bal != null && ((bal > 0 && thisPay >= bal) || bal <= 0);
  }
  return { canPartial, canComplete };
}
