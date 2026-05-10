import React, { useState, useEffect, useRef, useCallback, useContext } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Image, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
  PermissionsAndroid, Linking, Pressable, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { launchCamera } from 'react-native-image-picker';
import Icon from '@react-native-vector-icons/material-design-icons';
import api from '../services/api';
import { displayActivityAction } from '../utils/activityLabels';
import { getActivityHistoryDetailBlocks } from '../utils/activityHistoryDetails';
import ActivityLogDetailPanels from './ActivityLogDetailPanels';
import {
  toOrdinal,
  formatDateTime as formatDateTimeShared,
  formatDateTimeCard,
  nameOnly,
} from '../utils/formatting';
import { STATUS_COLORS, STATUS_TEXT_COLORS, getStatusSwatchColor } from '../constants/statusColors';
import MobileBoxInput from './MobileBoxInput';
import UserAvatar from './UserAvatar';
import RemarkLogSection from './RemarkLogSection';
import CustomerCategoryField from './CustomerCategoryField';
import { getRemarkEntries, joinRemarkTexts } from '../utils/remarkLog';
import { normalizeCustomerCategory, labelForCustomerCategory } from '../utils/customerCategory';
import { idForApiPath } from '../utils/mongoId';
import { getTransferTargetValidationError } from '../utils/transferTargetValidation';
import { useAlert } from '../context/AlertContext';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import RecordPaymentMarkCompleteModal from './RecordPaymentMarkCompleteModal';
import {
  balanceListRowFromBookedPlot,
  buildBalanceClearedRemark,
  buildBookingPatchBodyFromRow,
  expectedAdvanceForPlot,
  validateRecordPaymentPartial,
  validateRecordPaymentCompleteAdvance,
} from '../utils/bookingRecordPayment';
import { keyboardAvoidingBehavior } from '../utils/keyboardAvoiding';
import Clipboard from '@react-native-clipboard/clipboard';
import { Buffer } from 'buffer';
import { resolveRegularPricing, resolveScholarPricing } from '../utils/pricingHelpers';

const PAYMENT_MODES = ['Cash', 'Cheque', 'UPI', 'Bank Transfer'];
const REFUND_MODES = PAYMENT_MODES;
const ADMIN_PASSWORD = '8811';

/** Split total rupees across plots using paise so the parts sum exactly to the total. */
function splitAdvanceTotalEvenly(totalRaw, plots) {
  const total = Number(String(totalRaw ?? '').replace(/,/g, ''));
  if (Number.isNaN(total) || total < 0 || !Array.isArray(plots) || plots.length === 0) return null;
  const n = plots.length;
  const totalPaise = Math.round(total * 100);
  const base = Math.floor(totalPaise / n);
  const rem = totalPaise - base * n;
  return plots.map((p, i) => {
    const paise = base + (i < rem ? 1 : 0);
    return {
      plotId: String(p._id),
      plotNumber: String(p?.plotNumber ?? '').trim() || '—',
      advanceAmount: paise / 100,
    };
  });
}

function buildBulkEqualSplitRemarkLines(totalRaw, splits, formatRupee) {
  const total = Number(String(totalRaw ?? '').replace(/,/g, ''));
  if (Number.isNaN(total) || !splits?.length) return '';
  let out = `Total advance received: ${formatRupee(total)}\nAdvance for\n`;
  splits.forEach((s) => {
    out += `Plot No. ${s.plotNumber} = ${formatRupee(s.advanceAmount)}\n`;
  });
  return out.trimEnd();
}

/** Checkbox label: booking / edit booking — full advance flag. */
const COMPLETE_ADVANCE_RECEIVED_LABEL = 'Complete Advance Received';

const paymentToLabel = (mode) => {
  if (mode === 'Cash') return 'Owner Name (Received By)';
  if (mode === 'UPI') return 'UPI ID / Recipient Name';
  if (mode === 'Cheque') return 'In Favour Of / Bank Name';
  if (mode === 'Bank Transfer') return 'Bank Name & Account';
  return 'Received By';
};

const CLIPBOARD_CUSTOMER_KIND = 'plotvista-customer';
const CLIPBOARD_CUSTOMER_VERSION = 1;

function buildClipboardPayloadFromWaiter(waiter) {
  const mobiles = Array.isArray(waiter?.customerMobiles)
    ? waiter.customerMobiles.map((m) => String(m).trim()).filter(Boolean)
    : [];
  return {
    v: CLIPBOARD_CUSTOMER_VERSION,
    kind: CLIPBOARD_CUSTOMER_KIND,
    source: 'waiting',
    customerName: String(waiter?.customerName || '').trim(),
    customerMobiles: mobiles,
    customerAddress: String(waiter?.customerAddress || '').trim(),
    customerCategory: normalizeCustomerCategory(waiter?.customerCategory),
    customerPhoto: String(waiter?.customerPhoto || '').trim(),
    remarks: joinRemarkTexts(waiter).trim(),
    booking: null,
  };
}

function buildClipboardPayloadFromBooking(bd) {
  const mobiles = Array.isArray(bd?.customerMobiles)
    ? bd.customerMobiles.map((m) => String(m).trim()).filter(Boolean)
    : [];
  return {
    v: CLIPBOARD_CUSTOMER_VERSION,
    kind: CLIPBOARD_CUSTOMER_KIND,
    source: 'booked',
    customerName: String(bd?.customerName || '').trim(),
    customerMobiles: mobiles,
    customerAddress: String(bd?.customerAddress || '').trim(),
    customerCategory: normalizeCustomerCategory(bd?.customerCategory),
    customerPhoto: String(bd?.customerPhoto || '').trim(),
    remarks: joinRemarkTexts(bd).trim(),
    /** Never copy advance / payment / mode — those are always plot-specific and must be entered fresh. */
    booking: null,
  };
}

function parsePlotVistaCustomerClipboard(text) {
  if (!text || typeof text !== 'string') return null;
  let data;
  try {
    data = JSON.parse(text.trim());
  } catch {
    return null;
  }
  if (data?.kind !== CLIPBOARD_CUSTOMER_KIND || data.v !== CLIPBOARD_CUSTOMER_VERSION) {
    return null;
  }
  return data;
}

/** Keep embedded image small so the clipboard JSON stays within typical OS limits. */
const CLIPBOARD_PHOTO_MAX_BYTES = 650_000;
const CLIPBOARD_JSON_MAX_CHARS = 1_600_000;

async function tryFetchImageAsBase64(url) {
  const u = String(url || '').trim();
  if (!u || !/^https?:\/\//i.test(u)) return null;
  try {
    const res = await fetch(u);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (!buf || buf.byteLength > CLIPBOARD_PHOTO_MAX_BYTES) return null;
    const b64 = Buffer.from(new Uint8Array(buf)).toString('base64');
    const ct = res.headers.get('content-type') || '';
    const mimeMatch = /^image\/[\w.+-]+/i.exec(ct || '');
    const mime = mimeMatch ? mimeMatch[0].toLowerCase() : 'image/jpeg';
    return { base64: b64, mime };
  } catch {
    return null;
  }
}

function stripEmbeddedPhotoFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const next = { ...payload };
  delete next.photoBase64;
  delete next.photoMime;
  return next;
}

async function attachPhotoBase64ToPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  if (String(payload.photoBase64 || '').trim()) return payload;
  const url = String(payload.customerPhoto || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) return payload;
  const got = await tryFetchImageAsBase64(url);
  if (!got) return payload;
  return { ...payload, photoBase64: got.base64, photoMime: got.mime };
}

/**
 * @returns {Promise<{ json: string; embeddedPhoto: boolean; photoDroppedForSize: boolean; hadPhotoUrl: boolean }>}
 */
async function writeCustomerPayloadToClipboard(basePayload) {
  const hadPhotoUrl = /^https?:\/\//i.test(String(basePayload.customerPhoto || '').trim());
  let p = await attachPhotoBase64ToPayload({ ...basePayload });
  let embeddedPhoto = Boolean(p.photoBase64);
  let json = JSON.stringify(p);
  let photoDroppedForSize = false;
  if (json.length > CLIPBOARD_JSON_MAX_CHARS && p.photoBase64) {
    p = stripEmbeddedPhotoFromPayload(p);
    json = JSON.stringify(p);
    embeddedPhoto = false;
    photoDroppedForSize = true;
  }
  return { json, embeddedPhoto, photoDroppedForSize, hadPhotoUrl };
}

function buildCopySuccessMessage(meta) {
  const base =
    'Customer details are on the clipboard (not advance or payment — enter those manually for each plot). Open Add Waiting, booking, or Edit, then tap “Paste customer details.” You can change any field before saving.';
  if (meta.embeddedPhoto) {
    return `${base} The photo is included and will upload when you save this entry.`;
  }
  if (meta.photoDroppedForSize && meta.hadPhotoUrl) {
    return `${base} The photo file was too large to embed. The link is still included. If the image does not appear, add the photo again.`;
  }
  if (meta.hadPhotoUrl) {
    return `${base} A link to the photo is included. If the image does not appear after pasting, add the photo again.`;
  }
  return base;
}

/** Same source as Plot Details / Multi-plot summary: `categoryPricing.regular.advance`. */
function getRegularCategoryAdvance(plot) {
  if (!plot) return null;
  const cat = resolveRegularPricing(plot.categoryPricing);
  const adv = cat?.advance;
  if (adv == null || adv === '') return null;
  const n = Number(adv);
  return Number.isFinite(n) ? n : null;
}

/** `categoryPricing.scholar` (or legacy aalim/hafiz/imam). */
function getScholarCategoryAdvance(plot) {
  if (!plot) return null;
  const cat = resolveScholarPricing(plot.categoryPricing);
  const adv = cat?.advance;
  if (adv == null || adv === '') return null;
  const n = Number(adv);
  return Number.isFinite(n) ? n : null;
}

/**
 * One row for “expected advance” copy: Alim/Hafiz uses scholar advance on exactly one plot in bulk;
 * all other plots use regular. Same as MultiPlotSummaryScreen scholar toggle.
 */
function getExpectedBookingAdvanceRow(plot, { isScholarCustomer, scholarDiscountPlotId }) {
  const plotNumber = String(plot?.plotNumber ?? '').trim() || '—';
  const pid = String(plot?._id ?? '');
  const useScholar =
    isScholarCustomer && scholarDiscountPlotId && pid === String(scholarDiscountPlotId);
  if (useScholar) {
    const s = getScholarCategoryAdvance(plot);
    if (s != null) return { plotNumber, expected: s, rateLabel: 'Alim / Hafiz' };
  }
  const r = getRegularCategoryAdvance(plot);
  return {
    plotNumber,
    expected: r,
    rateLabel: 'Regular',
  };
}

const StatusBadge = ({ status, waiterCount, styles, colors, isDark }) => {
  const isVacant = status === 'vacant';
  const bg = status === 'waiting' && waiterCount > 1
    ? STATUS_COLORS.waitingMultiple
    : STATUS_COLORS[status] || '#888';
  const borderVacant = isDark ? '#94a3b8' : colors.text;
  return (
    <View style={[
      styles.statusBadge,
      { backgroundColor: bg },
      isVacant && { borderWidth: 1, borderColor: borderVacant },
    ]}>
      <Text style={[styles.statusBadgeText, { color: STATUS_TEXT_COLORS[status] || (isVacant ? '#0f172a' : '#fff') }]}>
        {status === 'vacant' ? 'OPEN' : status === 'waiting' ? 'Waiting' : status === 'booked' ? 'Booked' : status === 'BM' ? 'Reserved BM' : status}
      </Text>
    </View>
  );
};

const BookingModal = ({
  visible,
  plot,
  isBulk,
  bulkCount,
  selectedPlots = [],
  onClose,
  onUpdate,
  onPressPlotDetails,
  onActivitySummary,
  /** Hide history + quick actions; skip history API (e.g. guest / read-only). */
  readOnlyGuest = false,
  /** LayoutScreen: plot user tapped as transfer destination (consumed when applied). */
  pendingTransferTarget = null,
  onConsumedPendingTransferTarget,
  /**
   * LayoutScreen (vacate-transfer multi-pick): array of plots picked from the map
   * to be appended as destinations. Single-pick also routes here as a 1-element array.
   */
  pendingTransferTargetPlots = null,
  onConsumedPendingTransferTargetPlots,
  /** Ask parent to hide sheet and enter “tap plot on map” mode. */
  onRequestTransferTargetByMap,
}) => {
  const { isDark, colors } = useTheme();
  const styles = React.useMemo(() => getStyles(colors, isDark), [colors, isDark]);
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Cap sheet/scroll height but do not force a fixed sheet height — flex:1 on ScrollView
  // was stretching empty space between header and quick actions for sparse plots.
  const sheetMaxHeight = Math.round(windowHeight * 0.92);
  const scrollMaxHeight = Math.round(
    Math.max(200, sheetMaxHeight - 108 - 128 - Math.max(insets.bottom, 0)),
  );
  const { showAlert } = useAlert();
  const { userInfo } = useContext(AuthContext);
  const [activeAction, setActiveAction] = useState(null);
  /** When booking while waiters exist: set after "Book as …" or per-row "Make final" so submit is allowed. */
  const bookedFlowSourceRef = useRef(null);

  const [customerName, setCustomerName] = useState('');
  const [customerMobiles, setCustomerMobiles] = useState(['']);
  const [customerAddress, setCustomerAddress] = useState('');
  const [customerCategory, setCustomerCategory] = useState('regular');
  const [customerPhoto, setCustomerPhoto] = useState('');
  const [photoLocalUri, setPhotoLocalUri] = useState('');
  const [photoBase64, setPhotoBase64] = useState('');

  const [advanceAmount, setAdvanceAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState('');
  const [paymentTo, setPaymentTo] = useState('');
  const [remarks, setRemarks] = useState('');

  const [refundMode, setRefundMode] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundBy, setRefundBy] = useState('');
  const [refundRemarks, setRefundRemarks] = useState('');
  const [openWaitingRemarks, setOpenWaitingRemarks] = useState('');

  const [showAdminOverride, setShowAdminOverride] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [adminOverrideGranted, setAdminOverrideGranted] = useState(false);

  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [removeWaiterId, setRemoveWaiterId] = useState(null);
  const [removeWaiterReason, setRemoveWaiterReason] = useState('');
  const [isEditingWaiter, setIsEditingWaiter] = useState(false);
  const [isSavingBookingEdit, setIsSavingBookingEdit] = useState(false);
  const [editBookingOpen, setEditBookingOpen] = useState(false);
  const [editBookingAdvanceAmount, setEditBookingAdvanceAmount] = useState('');
  const [editBookingPaymentMode, setEditBookingPaymentMode] = useState('');
  const [editBookingPaymentTo, setEditBookingPaymentTo] = useState('');
  const [fullAdvanceReceived, setFullAdvanceReceived] = useState(false);
  const [recordPaymentModalVisible, setRecordPaymentModalVisible] = useState(false);
  const [recordPaymentSummaryRow, setRecordPaymentSummaryRow] = useState(null);
  const [recordPaymentSubmitting, setRecordPaymentSubmitting] = useState(false);
  const [recordPaymentSubmittingAction, setRecordPaymentSubmittingAction] = useState(null);
  const [editWaiterId, setEditWaiterId] = useState(null);
  const [editWaiterName, setEditWaiterName] = useState('');
  const [editWaiterMobiles, setEditWaiterMobiles] = useState(['']);
  const [editWaiterAddress, setEditWaiterAddress] = useState('');
  const [editCustomerCategory, setEditCustomerCategory] = useState('regular');

  // History states
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [queueImagePreviewUri, setQueueImagePreviewUri] = useState(null);

  /** Plot transfer: 'target' = pick destination on layout, 'confirm' = review & submit */
  const [transferStep, setTransferStep] = useState(null);
  const [transferKind, setTransferKind] = useState(null);
  const [transferWaitingId, setTransferWaitingId] = useState(null);
  const [transferTargetPlot, setTransferTargetPlot] = useState(null);
  const [transferExtraRemarks, setTransferExtraRemarks] = useState('');

  /**
   * Mark-Open + (optional) refund + (optional) transfer destinations.
   * Each destination: { tempId, plotId, plot, customerForm? }.
   * `customerForm` is populated only for vacant destinations.
   * Slices are derived (equal split of `transferableTotal`); not stored in state.
   */
  const [vacateTransferDestinations, setVacateTransferDestinations] = useState([]);
  /** True while the user is on the map picking destinations for the vacate-transfer flow. */
  const [awaitingVacateTransferPick, setAwaitingVacateTransferPick] = useState(false);
  const [isSubmittingTransferAndVacate, setIsSubmittingTransferAndVacate] = useState(false);

  /**
   * Mark-Open mode picker. Shown when the user starts the OPEN flow on a booked plot
   * (i.e. money needs to be accounted for). Forces an explicit choice between:
   *   - 'refund'   : refund only, no transfer (existing standard refund flow).
   *   - 'transfer' : full received amount transferred, no refund.
   *   - 'both'     : partial refund + remainder transferred.
   * Empty string = nothing picked yet → submit is blocked.
   */
  const [vacateMode, setVacateMode] = useState('');
  /** Y position of the refund/transfer section inside the body ScrollView (set via onLayout). */
  const [refundSectionY, setRefundSectionY] = useState(null);
  /** Ref to the body ScrollView so we can scroll the refund/transfer section into view. */
  const bodyScrollRef = useRef(null);

  /** Bulk book + Alim/Hafiz: scholar pricing applies to this plot id only (same rule as Multi Plot Summary). */
  const [scholarDiscountPlotId, setScholarDiscountPlotId] = useState(null);
  const [scholarPlotPickerVisible, setScholarPlotPickerVisible] = useState(false);

  // Reset only when the target plot or bulk mode changes — not when the modal is hidden
  // to view Plot details (so back returns to the same step: quick actions, forms, history).
  useEffect(() => {
    setCustomerName('');
    setCustomerMobiles(['']);
    setCustomerAddress('');
    setCustomerCategory('regular');
    setCustomerPhoto('');
    setPhotoLocalUri('');
    setPhotoBase64('');
    setAdvanceAmount('');
    setPaymentMode('');
    setPaymentTo('');
    setRemarks('');
    setRefundMode('');
    setRefundAmount('');
    setRefundBy('');
    setRefundRemarks('');
    setOpenWaitingRemarks('');

    setActiveAction(null);
    setAdminOverrideGranted(false);
    setAdminPassword('');
    setShowAdminOverride(false);

    setIsUploading(false);
    setIsSubmitting(false);
    setIsRemoving(false);
    setRemoveWaiterId(null);
    setRemoveWaiterReason('');
    setIsEditingWaiter(false);
    setIsSavingBookingEdit(false);
    setEditBookingOpen(false);
    setEditBookingAdvanceAmount('');
    setEditBookingPaymentMode('');
    setEditBookingPaymentTo('');
    setFullAdvanceReceived(false);
    setRecordPaymentModalVisible(false);
    setRecordPaymentSummaryRow(null);
    setRecordPaymentSubmitting(false);
    setRecordPaymentSubmittingAction(null);
    setEditWaiterId(null);
    setEditWaiterName('');
    setEditWaiterMobiles(['']);
    setEditWaiterAddress('');
    setEditCustomerCategory('regular');
    setShowHistory(false);
    setHistory([]);
    setQueueImagePreviewUri(null);
    bookedFlowSourceRef.current = null;

    setTransferStep(null);
    setTransferKind(null);
    setTransferWaitingId(null);
    setTransferTargetPlot(null);
    setTransferExtraRemarks('');
    setVacateTransferDestinations([]);
    setAwaitingVacateTransferPick(false);
    setIsSubmittingTransferAndVacate(false);
    setVacateMode('');
    setRefundSectionY(null);
    setScholarDiscountPlotId(null);
    setScholarPlotPickerVisible(false);
  }, [plot?._id, isBulk]);

  useEffect(() => {
    if (activeAction !== 'booked' || !isBulk) {
      setScholarDiscountPlotId(null);
      setScholarPlotPickerVisible(false);
      return;
    }
    if (normalizeCustomerCategory(customerCategory) !== 'scholar') {
      setScholarDiscountPlotId(null);
      return;
    }
    if (!selectedPlots.length) return;
    if (selectedPlots.length === 1) {
      setScholarDiscountPlotId(String(selectedPlots[0]._id));
      return;
    }
    setScholarDiscountPlotId((prev) => {
      const idSet = new Set(selectedPlots.map((p) => String(p._id)));
      const p = prev && idSet.has(String(prev)) ? String(prev) : null;
      if (p) return p;
      const sorted = [...selectedPlots].sort((a, b) =>
        String(a.plotNumber).localeCompare(String(b.plotNumber), undefined, { numeric: true }),
      );
      return String(sorted[0]._id);
    });
  }, [activeAction, isBulk, selectedPlots, customerCategory]);

  useEffect(() => {
    if (activeAction !== 'booked') {
      bookedFlowSourceRef.current = null;
    }
  }, [activeAction]);

  // When the OPEN-with-refund step appears, scroll the body so the section
  // header (and the new mode picker right under it) is visible. Without this
  // the user lands at the bottom of the prior actions and can't see the new
  // refund/transfer fields without manually scrolling.
  useEffect(() => {
    if (activeAction !== 'refundOpen') return;
    if (refundSectionY == null) return;
    const ref = bodyScrollRef.current;
    if (!ref || typeof ref.scrollTo !== 'function') return;
    ref.scrollTo({ y: Math.max(0, refundSectionY - 8), animated: true });
  }, [activeAction, refundSectionY]);

  // Reset the section position whenever we leave the OPEN-with-refund step,
  // so the next entry re-measures (modal contents above can change height).
  useEffect(() => {
    if (activeAction !== 'refundOpen') {
      setRefundSectionY(null);
      setVacateMode('');
    }
  }, [activeAction]);

  useEffect(() => {
    if (!visible) setQueueImagePreviewUri(null);
  }, [visible]);

  // Re-fetch ActivityLog when the modal is open and this plot changes on the server.
  // Use updatedAt so we still refresh when historySummary is capped at 100 entries (length unchanged).
  const plotSyncKey =
    plot?.updatedAt != null ? String(plot.updatedAt) : `${plot?._id ?? ''}-${plot?.historySummary?.length ?? 0}`;
  useEffect(() => {
    if (visible && plot && !isBulk && !readOnlyGuest) {
      fetchHistory();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, plot?._id, isBulk, plotSyncKey, readOnlyGuest]);

  const fetchHistory = async () => {
    try {
      setIsLoadingHistory(true);
      const res = await api.get(`${plot._id}/history`);
      setHistory(res.data);
    } catch (e) {
      console.error('[BookingModal] Fetch History Error:', e.message);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const emitNoteActivity = useCallback(
    (kind, isUpdate, customerName, preview) => {
      onActivitySummary?.({
        type: 'note_activity',
        kind,
        isUpdate,
        plotNumber: plot?.plotNumber,
        customerName,
        preview,
      });
    },
    [onActivitySummary, plot?.plotNumber],
  );

  const closeRecordPaymentModal = useCallback(() => {
    setRecordPaymentModalVisible(false);
    setRecordPaymentSummaryRow(null);
    setRecordPaymentSubmittingAction(null);
  }, []);

  const openRecordPaymentFromSummary = useCallback(() => {
    if (!plot?._id || !plot.bookingDetails || readOnlyGuest) return;
    const row = balanceListRowFromBookedPlot(plot);
    const bd = row.bd;
    if (bd.isFullAdvanceReceived) return;
    const name = (bd.customerName || '').trim();
    if (!name) {
      showAlert('Cannot mark', 'This booking has no customer name. Update booking details first.');
      return;
    }
    const mobiles = (bd.customerMobiles || []).map((m) => String(m).trim()).filter(Boolean);
    if (!mobiles.length) {
      showAlert('Cannot mark', 'Add at least one mobile number in booking details first.');
      return;
    }
    if (row.amountPaid == null) {
      showAlert('Cannot mark', 'No amount paid is recorded. Enter the advance received in booking details first.');
      return;
    }
    setRecordPaymentSummaryRow(row);
    setRecordPaymentModalVisible(true);
  }, [plot, readOnlyGuest, showAlert]);

  const submitRecordPaymentFromModal = useCallback(
    async (form) => {
      if (!plot?._id || !plot.bookingDetails || !recordPaymentSummaryRow) return;
      const row = recordPaymentSummaryRow;
      const action = form.action;
      if (action !== 'partial' && action !== 'complete') return;
      const v =
        action === 'partial'
          ? validateRecordPaymentPartial(row, form, showAlert)
          : validateRecordPaymentCompleteAdvance(row, form, showAlert);
      if (!v) return;

      const actorLabel = String(userInfo?.name || userInfo?.mobileNumber || 'User').trim();
      const recordedAt = formatDateTimeShared(new Date());
      const bookedAt = row.bd?.createdAt ? new Date(row.bd.createdAt) : null;
      const bookingRecordedAtLabel =
        bookedAt && !Number.isNaN(bookedAt.getTime()) ? formatDateTimeShared(bookedAt) : '—';
      const remarkText = buildBalanceClearedRemark({
        row,
        actorLabel,
        recordedAt,
        paymentMode: v.paymentMode,
        paymentTo: v.paymentTo,
        thisPaymentAmount: v.thisPay,
        newAdvanceAmount: v.newAdvance,
        bookingRecordedAtLabel,
        extraNote: form.extraNote,
        headline: action === 'partial' ? 'Partial payment' : undefined,
      });

      const pid = idForApiPath(plot._id);
      setRecordPaymentSubmitting(true);
      setRecordPaymentSubmittingAction(action);
      try {
        const patchBody = buildBookingPatchBodyFromRow(row, {
          isFullAdvanceReceived: action === 'complete',
          advanceAmount: v.newAdvance,
          paymentMode: v.paymentMode,
          paymentTo: v.paymentTo,
        });
        const patchRes = await api.patch(`/${pid}/booking`, patchBody);
        const plotAfter = patchRes.data?.plot ?? patchRes.data;
        if (!plotAfter?._id) {
          showAlert('Error', 'Unexpected response from server.');
          return;
        }
        try {
          await api.post(`/${pid}/booking/remarks`, { text: remarkText });
          emitNoteActivity('booking', false, row.bd.customerName, remarkText.slice(0, 220));
        } catch (re) {
          showAlert(
            'Booking updated',
            `${action === 'complete' ? 'Advance marked complete' : 'Payment recorded'}, but the automatic note could not be saved: ${re.response?.data?.message || re.message || 'Unknown error'}. Add a remark manually if needed.`,
          );
        }
        onActivitySummary?.({
          type: 'update_booking',
          plotNumber: plot?.plotNumber,
          customerName: row.bd.customerName || '',
        });
        closeRecordPaymentModal();
      } catch (e) {
        showAlert('Error', e.response?.data?.message || 'Could not update booking.');
      } finally {
        setRecordPaymentSubmitting(false);
        setRecordPaymentSubmittingAction(null);
      }
    },
    [
      plot,
      recordPaymentSummaryRow,
      showAlert,
      userInfo?.mobileNumber,
      userInfo?.name,
      emitNoteActivity,
      onActivitySummary,
      closeRecordPaymentModal,
    ],
  );

  const cancelPlotTransfer = useCallback(() => {
    setTransferStep(null);
    setTransferKind(null);
    setTransferWaitingId(null);
    setTransferTargetPlot(null);
    setTransferExtraRemarks('');
  }, []);

  const populateTransferFormFromBooking = useCallback((bd) => {
    if (!bd) return;
    setCustomerName(String(bd.customerName || '').trim());
    const mobiles = (bd.customerMobiles || []).map((m) => String(m).trim()).filter(Boolean);
    setCustomerMobiles(mobiles.length ? mobiles : ['']);
    setCustomerAddress(String(bd.customerAddress || '').trim());
    setCustomerCategory(normalizeCustomerCategory(bd.customerCategory));
    const photoUrl = String(bd.customerPhoto || '').trim();
    setCustomerPhoto(photoUrl);
    setPhotoLocalUri(photoUrl && /^https?:\/\//i.test(photoUrl) ? photoUrl : '');
    setPhotoBase64('');
    setAdvanceAmount(
      bd.advanceAmount != null && !Number.isNaN(Number(bd.advanceAmount))
        ? String(bd.advanceAmount)
        : '',
    );
    setPaymentMode(String(bd.paymentMode || '').trim());
    setPaymentTo(String(bd.paymentTo || '').trim());
    setRemarks('');
    setTransferExtraRemarks('');
    setAdminOverrideGranted(false);
    setShowAdminOverride(false);
    setAdminPassword('');
  }, []);

  const populateTransferFormFromWaiter = useCallback((w) => {
    if (!w) return;
    setCustomerName(String(w.customerName || '').trim());
    const mobiles = (w.customerMobiles || []).map((m) => String(m).trim()).filter(Boolean);
    setCustomerMobiles(mobiles.length ? mobiles : ['']);
    setCustomerAddress(String(w.customerAddress || '').trim());
    setCustomerCategory(normalizeCustomerCategory(w.customerCategory));
    const photoUrl = String(w.customerPhoto || '').trim();
    setCustomerPhoto(photoUrl);
    setPhotoLocalUri(photoUrl && /^https?:\/\//i.test(photoUrl) ? photoUrl : '');
    setPhotoBase64('');
    setAdvanceAmount('');
    setPaymentMode('');
    setPaymentTo('');
    setRemarks('');
    setTransferExtraRemarks('');
    setAdminOverrideGranted(false);
    setShowAdminOverride(false);
    setAdminPassword('');
  }, []);

  const beginTransferBooking = useCallback(() => {
    if (!plot?.bookingDetails) return;
    setActiveAction(null);
    setTransferKind('booking');
    setTransferWaitingId(null);
    setTransferTargetPlot(null);
    setTransferStep('target');
  }, [plot?.bookingDetails]);

  const beginTransferWaiter = useCallback((waitingId) => {
    setActiveAction(null);
    setTransferKind('waiting');
    setTransferWaitingId(waitingId);
    setTransferTargetPlot(null);
    setTransferStep('target');
  }, []);

  const requestTransferTargetOnMap = useCallback(() => {
    if (!transferKind || !onRequestTransferTargetByMap) return;
    onRequestTransferTargetByMap({
      kind: transferKind,
      waitingId: transferKind === 'waiting' ? transferWaitingId : null,
    });
  }, [onRequestTransferTargetByMap, transferKind, transferWaitingId]);

  useEffect(() => {
    if (!visible || !pendingTransferTarget || !plot?._id || !transferKind) return;
    if (transferStep !== 'target') return;
    if (String(pendingTransferTarget._id) === String(plot._id)) {
      showAlert('Invalid', 'Choose a different plot than the current one.');
      onConsumedPendingTransferTarget?.();
      return;
    }
    const err = getTransferTargetValidationError(plot, pendingTransferTarget, transferKind);
    if (err) {
      showAlert('Not allowed', err);
      onConsumedPendingTransferTarget?.();
      return;
    }
    setTransferTargetPlot(pendingTransferTarget);
    if (transferKind === 'booking') {
      populateTransferFormFromBooking(plot.bookingDetails);
    } else {
      const w = (plot.waitingList || []).find((x) => String(x._id) === String(transferWaitingId));
      if (!w) {
        showAlert('Error', 'Waiting entry not found.');
        onConsumedPendingTransferTarget?.();
        return;
      }
      populateTransferFormFromWaiter(w);
    }
    setTransferStep('confirm');
    onConsumedPendingTransferTarget?.();
  }, [
    visible,
    pendingTransferTarget,
    plot,
    transferKind,
    transferWaitingId,
    transferStep,
    populateTransferFormFromBooking,
    populateTransferFormFromWaiter,
    showAlert,
    onConsumedPendingTransferTarget,
  ]);

  const submitPlotTransfer = useCallback(async () => {
    if (!plot?._id || !transferTargetPlot?._id || !transferKind) return;
    if (!customerName.trim()) {
      showAlert('Required', 'Customer name is required.');
      return;
    }
    const validMobiles = customerMobiles.filter((m) => m.trim());
    if (!validMobiles.length) {
      showAlert('Required', 'At least one mobile number is required.');
      return;
    }
    const badMobile = validMobiles.find((m) => m.replace(/\D/g, '').length !== 10);
    if (badMobile) {
      showAlert('Invalid Number', `"${badMobile}" is not a valid 10-digit mobile number.`);
      return;
    }
    if (transferKind === 'booking') {
      if (!advanceAmount && !adminOverrideGranted) {
        showAlert(
          'Advance Amount Required',
          'Booking requires an advance amount. Enter it or use admin override.',
          [
            { text: 'Enter Amount', style: 'cancel' },
            { text: 'Admin Override', onPress: () => setShowAdminOverride(true) },
          ],
        );
        return;
      }
      if (!paymentMode) {
        showAlert('Required', 'Please select a payment mode.');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      let finalPhotoUrl = await uploadPhoto();
      const existingPhoto = String(customerPhoto || '').trim();
      if (!finalPhotoUrl && existingPhoto && /^https?:\/\//i.test(existingPhoto)) {
        finalPhotoUrl = existingPhoto;
      }
      const overrides = {
        customerName: customerName.trim(),
        customerMobiles: validMobiles,
        customerAddress: customerAddress.trim(),
        customerCategory: normalizeCustomerCategory(customerCategory),
        customerPhoto: finalPhotoUrl || '',
        remarks: transferExtraRemarks.trim(),
      };
      if (transferKind === 'booking') {
        overrides.advanceAmount = advanceAmount
          ? parseFloat(String(advanceAmount).replace(/,/g, ''))
          : null;
        overrides.paymentMode = paymentMode;
        overrides.paymentTo = paymentTo.trim();
      }
      await api.post(`/${idForApiPath(plot._id)}/transfer`, {
        targetPlotId: idForApiPath(transferTargetPlot._id),
        kind: transferKind,
        ...(transferKind === 'waiting' ? { waitingId: idForApiPath(transferWaitingId) } : {}),
        overrides,
      });
      onActivitySummary?.({
        type: 'plot_transfer',
        sourcePlotNumber: plot.plotNumber,
        targetPlotNumber: transferTargetPlot.plotNumber,
        customerName: customerName.trim(),
        kind: transferKind,
      });
      cancelPlotTransfer();
      onClose();
    } catch (e) {
      showAlert('Transfer failed', e.response?.data?.message || e.message || 'Try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [
    plot,
    transferTargetPlot,
    transferKind,
    transferWaitingId,
    customerName,
    customerMobiles,
    customerAddress,
    customerCategory,
    customerPhoto,
    advanceAmount,
    paymentMode,
    paymentTo,
    transferExtraRemarks,
    adminOverrideGranted,
    uploadPhoto,
    showAlert,
    onActivitySummary,
    onClose,
    cancelPlotTransfer,
  ]);

  const addMobile = () => {
    if (customerMobiles.length < 5) setCustomerMobiles([...customerMobiles, '']);
  };

  const removeMobile = (index) => {
    const updated = customerMobiles.filter((_, i) => i !== index);
    setCustomerMobiles(updated.length ? updated : ['']);
  };

  const updateMobile = (text, index) => {
    const updated = [...customerMobiles];
    updated[index] = text;
    setCustomerMobiles(updated);
  };

  const handleCamera = async () => {
    try {
      // Android 6+ requires runtime permission even if declared in AndroidManifest.xml
      if (Platform.OS === 'android') {
        const status = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.CAMERA,
          {
            title: 'Camera Permission',
            message: 'PlotSync needs camera access to capture customer photos for booking records.',
            buttonPositive: 'Allow',
            buttonNegative: 'Deny',
            buttonNeutral: 'Ask Later',
          },
        );
        if (status !== PermissionsAndroid.RESULTS.GRANTED) {
          showAlert(
            'Camera Permission Denied',
            'Please allow camera access in Settings to capture customer photos.',
          );
          return;
        }
      }

      const response = await launchCamera({ mediaType: 'photo', quality: 0.6, includeBase64: true });
      if (response.didCancel || response.errorCode) return;
      const asset = response.assets?.[0];
      if (asset) {
        setPhotoLocalUri(asset.uri);
        setPhotoBase64(asset.base64);
      }
    } catch (err) {
      if (__DEV__) console.error('[BookingModal] launchCamera error:', err?.message);
    }
  };

  const uploadPhoto = async () => {
    if (!photoBase64) return '';
    try {
      setIsUploading(true);
      if (__DEV__) console.log('[BookingModal] Uploading photo, base64 length:', photoBase64.length);
      const res = await api.post('/upload-photo', { base64Image: photoBase64 });
      if (__DEV__) console.log('[BookingModal] Photo uploaded successfully:', res.data.url);
      return res.data.url;
    } catch (e) {
      const errDetail = e.response?.data?.detail || e.response?.data?.message || e.message;
      if (__DEV__) console.error('[BookingModal] Photo upload failed:', JSON.stringify(e.response?.data || e.message));
      showAlert('Photo Upload Failed', `Error: ${errDetail}\n\nProceeding without photo.`);
      return '';
    } finally {
      setIsUploading(false);
    }
  };

  const applyWaiterToBookingForm = useCallback(
    (waiter) => {
      if (!waiter) return;
      bookedFlowSourceRef.current = { waiterId: waiter._id };
      setCustomerName(String(waiter.customerName || '').trim());
      const mobiles = (waiter.customerMobiles || []).map((m) => String(m).trim()).filter(Boolean);
      setCustomerMobiles(mobiles.length ? mobiles : ['']);
      setCustomerAddress(String(waiter.customerAddress || '').trim());
      setCustomerCategory(normalizeCustomerCategory(waiter.customerCategory));
      setRemarks(joinRemarkTexts(waiter));
      const photoUrl = String(waiter.customerPhoto || '').trim();
      setCustomerPhoto(photoUrl);
      setPhotoLocalUri(photoUrl && /^https?:\/\//i.test(photoUrl) ? photoUrl : '');
      setPhotoBase64('');
      setAdvanceAmount('');
      setPaymentMode('');
      setPaymentTo('');
      setFullAdvanceReceived(false);
      setAdminOverrideGranted(false);
      setShowAdminOverride(false);
      setAdminPassword('');
      setActiveAction('booked');
    },
    []
  );

  const openFreshBookedForm = useCallback(() => {
    bookedFlowSourceRef.current = null;
    setCustomerName('');
    setCustomerMobiles(['']);
    setCustomerAddress('');
    setCustomerCategory('regular');
    setRemarks('');
    setCustomerPhoto('');
    setPhotoLocalUri('');
    setPhotoBase64('');
    setAdvanceAmount('');
    setPaymentMode('');
    setPaymentTo('');
    setFullAdvanceReceived(false);
    setAdminOverrideGranted(false);
    setShowAdminOverride(false);
    setAdminPassword('');
    setActiveAction('booked');
  }, []);

  const onPressFinal = useCallback(() => {
    if (isBulk) {
      if (selectedPlots.some((p) => p.status === 'waiting')) {
        showAlert(
          'Final booking unavailable',
          'One or more selected plots already have waiting entries. Remove waiting or update plots separately — bulk final booking is not available.',
        );
        return;
      }
      openFreshBookedForm();
      return;
    }
    const wl = plot?.waitingList || [];
    if (wl.length === 0) {
      openFreshBookedForm();
      return;
    }
    const first = wl[0];
    const nm = String(first.customerName || 'Waiting').trim() || 'Waiting';
    const shortBtn = nm.length > 22 ? `${nm.slice(0, 21)}…` : nm;
    const body =
      wl.length === 1
        ? 'This plot has waiting,\nBook as that person, or remove them if the buyer is different.'
        : `This plot has ${wl.length} people waiting,\nBook as the first person, or remove them if the buyer is different.`;
    showAlert(
      'Final Booking',
      body,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: `Book as ${shortBtn}`, onPress: () => applyWaiterToBookingForm(first) },
      ],
      { verticalButtons: true }
    );
  }, [isBulk, plot?.waitingList, selectedPlots, showAlert, applyWaiterToBookingForm, openFreshBookedForm]);

  const checkAdminOverride = () => {
    if (adminPassword === ADMIN_PASSWORD) {
      setAdminOverrideGranted(true);
      setShowAdminOverride(false);
      showAlert('Override Granted', 'You can now book without an advance amount.');
    } else {
      showAlert('Wrong Password', 'Admin password is incorrect.');
    }
  };

  const copyWaiterCustomerToClipboard = async (waiter) => {
    try {
      const { json, embeddedPhoto, photoDroppedForSize, hadPhotoUrl } =
        await writeCustomerPayloadToClipboard(buildClipboardPayloadFromWaiter(waiter));
      await Clipboard.setString(json);
      showAlert(
        'Copied to clipboard',
        buildCopySuccessMessage({ embeddedPhoto, photoDroppedForSize, hadPhotoUrl }),
      );
    } catch {
      showAlert('Could not copy', 'Something went wrong while copying. Please try again.');
    }
  };

  const copyBookingCustomerToClipboard = async (bd) => {
    try {
      const { json, embeddedPhoto, photoDroppedForSize, hadPhotoUrl } =
        await writeCustomerPayloadToClipboard(buildClipboardPayloadFromBooking(bd));
      await Clipboard.setString(json);
      showAlert(
        'Copied to clipboard',
        buildCopySuccessMessage({ embeddedPhoto, photoDroppedForSize, hadPhotoUrl }),
      );
    } catch {
      showAlert('Could not copy', 'Something went wrong while copying. Please try again.');
    }
  };

  const pasteCustomerIntoAddForm = async () => {
    if (readOnlyGuest || (activeAction !== 'waiting' && activeAction !== 'booked')) return;
    try {
      const raw = await Clipboard.getString();
      const payload = parsePlotVistaCustomerClipboard(raw);
      if (!payload) {
        showAlert(
          'Nothing to paste',
          'The clipboard does not contain PlotVista customer details. Use Copy on a waiting or booked entry first.',
        );
        return;
      }
      const pastedRemarks = String(payload.remarks || '').trim();
      const mobiles = Array.isArray(payload.customerMobiles)
        ? payload.customerMobiles.map((m) => String(m).trim()).filter(Boolean)
        : [];
      setCustomerName(String(payload.customerName || '').trim());
      setCustomerMobiles(mobiles.length ? mobiles : ['']);
      setCustomerAddress(String(payload.customerAddress || '').trim());
      setCustomerCategory(normalizeCustomerCategory(payload.customerCategory));

      const b64 = String(payload.photoBase64 || '').trim();
      const mime = String(payload.photoMime || 'image/jpeg').trim();
      if (b64) {
        setPhotoBase64(b64);
        setPhotoLocalUri(`data:${mime};base64,${b64}`);
        setCustomerPhoto('');
      } else {
        const photo = String(payload.customerPhoto || '').trim();
        setCustomerPhoto(photo);
        setPhotoLocalUri(photo && /^https?:\/\//i.test(photo) ? photo : '');
        setPhotoBase64('');
      }

      setShowAdminOverride(false);
      setAdminPassword('');
      setAdminOverrideGranted(false);

      setAdvanceAmount('');
      setPaymentMode('');
      setPaymentTo('');
      setFullAdvanceReceived(false);

      setRemarks('');

      if (pastedRemarks) {
        const preview =
          pastedRemarks.length > 900 ? `${pastedRemarks.slice(0, 900).trim()}…` : pastedRemarks;
        showAlert(
          'Notes from the other plot',
          `The entry you copied had these notes on the original plot:\n\n“${preview}”\n\nThose notes belong to that plot only. Should we copy the same text into the notes field for this plot, or leave notes empty?`,
          [
            {
              text: 'Copy notes to this plot',
              onPress: () => setRemarks(pastedRemarks),
            },
            {
              text: 'Leave notes blank',
              style: 'cancel',
              onPress: () => setRemarks(''),
            },
          ],
          { verticalButtons: true },
        );
      } else {
        showAlert(
          'Details pasted',
          'Customer details have been added to this form. Review everything, then save when you are ready.',
        );
      }
    } catch {
      showAlert('Unable to paste', 'We could not read the clipboard. Please try again.');
    }
  };

  const pasteCustomerIntoEditSheet = async () => {
    if (readOnlyGuest || isEditingWaiter || isSavingBookingEdit) return;
    try {
      const raw = await Clipboard.getString();
      const payload = parsePlotVistaCustomerClipboard(raw);
      if (!payload) {
        showAlert(
          'Nothing to paste',
          'The clipboard does not contain PlotVista customer details. Use Copy on a waiting or booked entry first.',
        );
        return;
      }
      const mobiles = Array.isArray(payload.customerMobiles)
        ? payload.customerMobiles.map((m) => String(m).trim()).filter(Boolean)
        : [];
      setEditWaiterName(String(payload.customerName || '').trim());
      setEditWaiterMobiles(mobiles.length ? mobiles : ['']);
      setEditWaiterAddress(String(payload.customerAddress || '').trim());
      setEditCustomerCategory(normalizeCustomerCategory(payload.customerCategory));

      showAlert(
        'Details pasted',
        editBookingOpen
          ? 'Customer details have been added. Advance and payment were not changed — update those on this booking only, then tap Save.'
          : 'Customer details have been added to this form. Review everything, then tap Save.',
      );
    } catch {
      showAlert('Unable to paste', 'We could not read the clipboard. Please try again.');
    }
  };

  const needsRefundToOpen = React.useMemo(() => {
    if (isBulk && selectedPlots.length > 0) {
      return selectedPlots.some((p) => p.status === 'booked');
    }
    if (!isBulk && plot) return plot.status === 'booked';
    return false;
  }, [isBulk, selectedPlots, plot]);

  const needsWaitingReasonToOpen = React.useMemo(() => {
    if (isBulk && selectedPlots.length > 0) {
      return selectedPlots.some((p) => p.status === 'waiting');
    }
    if (!isBulk && plot) return plot.status === 'waiting';
    return false;
  }, [isBulk, selectedPlots, plot]);

  const editingWaiterForNotes = React.useMemo(() => {
    if (!editWaiterId || !plot?.waitingList) return null;
    return plot.waitingList.find((w) => String(w._id) === String(editWaiterId)) || null;
  }, [editWaiterId, plot?.waitingList]);

  const validateRefundClient = () => {
    if (!refundMode.trim()) return 'Select refund mode.';
    if (!refundBy.trim()) return 'Enter owner name (processed by).';
    if (!refundRemarks.trim()) return 'Enter refund remarks.';
    const raw = String(refundAmount).trim().replace(/,/g, '');
    if (raw === '' || Number.isNaN(Number(raw))) return 'Enter a valid refund amount.';
    if (Number(raw) < 0) return 'Refund amount cannot be negative.';
    return null;
  };

  // ────────────────────────────────────────────────────────────────────────────
  // Mark-Open + Transfer (vacate-and-transfer) derivations
  // ────────────────────────────────────────────────────────────────────────────

  /** Source plots whose advance is being moved/refunded. Empty when no booked sources. */
  const transferSourcePlots = React.useMemo(() => {
    if (isBulk) {
      return Array.isArray(selectedPlots)
        ? selectedPlots.filter((p) => p?.status === 'booked')
        : [];
    }
    return plot?.status === 'booked' ? [plot] : [];
  }, [isBulk, selectedPlots, plot]);

  /** Total advance currently on the source plot(s) — denominated in rupees (whole units). */
  const totalReceivedFromSources = React.useMemo(() => {
    return transferSourcePlots.reduce((sum, p) => {
      const v = Number(p?.bookingDetails?.advanceAmount);
      return sum + (Number.isFinite(v) ? v : 0);
    }, 0);
  }, [transferSourcePlots]);

  /** Refund amount as a number, validated lightly (>=0). */
  const parsedRefundAmountForTransfer = React.useMemo(() => {
    const n = Number(String(refundAmount).replace(/,/g, ''));
    if (!Number.isFinite(n) || n < 0) return 0;
    return n;
  }, [refundAmount]);

  /** Money left after subtracting refund — what gets distributed to destinations. */
  const transferableTotalRupees = React.useMemo(() => {
    return Math.max(0, totalReceivedFromSources - parsedRefundAmountForTransfer);
  }, [totalReceivedFromSources, parsedRefundAmountForTransfer]);

  /**
   * Even split (paise-correct) across N destinations.
   * Mirrors the server-side splitter so client previews match what the server stores.
   * Returns an array of rupee amounts (number, may have ≤ 2 decimals).
   */
  const computeEvenSliceRupees = useCallback((totalRupees, n) => {
    if (!n || n <= 0) return [];
    const totalPaise = Math.round(Number(totalRupees) * 100);
    const base = Math.floor(totalPaise / n);
    const rem = totalPaise - base * n;
    return Array.from({ length: n }, (_, i) => {
      const p = base + (i < rem ? 1 : 0);
      return p / 100;
    });
  }, []);

  const destinationSliceRupees = React.useMemo(
    () => computeEvenSliceRupees(transferableTotalRupees, vacateTransferDestinations.length),
    [computeEvenSliceRupees, transferableTotalRupees, vacateTransferDestinations.length],
  );

  const hasTransferDestinations = vacateTransferDestinations.length > 0;

  /**
   * UI gates derived from the OPEN-with-refund mode picker. They control which
   * cards are rendered inside the `activeAction === 'refundOpen'` step so the
   * user only sees fields relevant to the option they picked.
   *
   *   showRefundFields  → refund mode/amount/by/remarks inputs
   *   showTransferCard  → "Transfer to other plots" card with destinations
   *   showPaymentCard   → wrapper card around refund inputs and/or waiting reason
   *                       (waiting cancellation reason is shown regardless of
   *                       the mode picker because it covers a separate concern)
   */
  const showRefundFields =
    needsRefundToOpen && (vacateMode === 'refund' || vacateMode === 'both');
  const showTransferCard =
    needsRefundToOpen &&
    !readOnlyGuest &&
    (vacateMode === 'transfer' || vacateMode === 'both');
  const showPaymentCard = showRefundFields || needsWaitingReasonToOpen;

  /**
   * Switch the OPEN-mode picker. Cleans up state that no longer applies so
   * stale inputs from a previously chosen mode can't sneak into the payload.
   */
  const handlePickVacateMode = useCallback(
    (mode) => {
      if (mode === vacateMode) return;
      setVacateMode(mode);
      if (mode === 'refund') {
        // Refund-only flow takes the standard /status endpoint — destinations
        // would otherwise re-route to /transfer-and-vacate and confuse the user.
        setVacateTransferDestinations([]);
      }
      if (mode === 'transfer') {
        // Transfer-only hides the refund inputs; clear them so an old value
        // can't slip in if the user toggles back later.
        setRefundMode('');
        setRefundAmount('');
        setRefundBy('');
        setRefundRemarks('');
      }
    },
    [vacateMode],
  );

  /** Validates the destination list before submit. Returns first error string or null. */
  const validateTransferDestinations = useCallback(() => {
    if (!hasTransferDestinations) return null;
    if (transferSourcePlots.length === 0) {
      return 'Add a destination only when at least one booked source plot is being opened.';
    }
    if (transferableTotalRupees <= 0) {
      return 'Nothing left to transfer after refund. Lower the refund or remove destinations.';
    }
    const sourceIdSet = new Set(transferSourcePlots.map((p) => String(p._id)));
    const seen = new Set();
    for (const d of vacateTransferDestinations) {
      if (!d.plotId) return 'Pick a destination plot for every destination row.';
      if (sourceIdSet.has(String(d.plotId))) {
        return `Plot No. ${d.plot?.plotNumber ?? '?'} is being opened — it cannot also be a destination.`;
      }
      if (seen.has(String(d.plotId))) {
        return `Plot No. ${d.plot?.plotNumber ?? '?'} is selected more than once as a destination.`;
      }
      seen.add(String(d.plotId));
      if (d.plot?.status === 'BM') {
        return `Plot No. ${d.plot?.plotNumber ?? '?'} is BM and cannot receive a transfer.`;
      }
      if (d.plot?.status === 'vacant') {
        const cf = d.customerForm || {};
        if (!String(cf.customerName || '').trim()) {
          return `Enter customer name for vacant Plot No. ${d.plot?.plotNumber ?? '?'}.`;
        }
        const mobiles = Array.isArray(cf.customerMobiles) ? cf.customerMobiles : [];
        const firstMobile = String(mobiles[0] || '').trim();
        if (!firstMobile) {
          return `Enter a contact number for vacant Plot No. ${d.plot?.plotNumber ?? '?'}.`;
        }
        if (!String(cf.paymentMode || '').trim()) {
          return `Select payment mode for vacant Plot No. ${d.plot?.plotNumber ?? '?'}.`;
        }
        if (!String(cf.paymentTo || '').trim()) {
          return `Enter "payment to" for vacant Plot No. ${d.plot?.plotNumber ?? '?'}.`;
        }
      }
      if (d.plot?.status === 'waiting') {
        const hasFirstWaiter = Array.isArray(d.plot?.waitingList) && d.plot.waitingList.length > 0;
        if (!hasFirstWaiter) {
          return `Plot No. ${d.plot?.plotNumber ?? '?'} has no waiting customer to finalise.`;
        }
      }
    }
    return null;
  }, [
    hasTransferDestinations,
    transferSourcePlots,
    transferableTotalRupees,
    vacateTransferDestinations,
  ]);

  /** Begin the on-map picker for one or more destinations. */
  const addTransferDestinationRow = useCallback(() => {
    if (!onRequestTransferTargetByMap) {
      showAlert('Cannot pick on map', 'Map picker is unavailable in this context.');
      return;
    }
    if (transferSourcePlots.length === 0) {
      showAlert(
        'No booked source plot',
        'Transfer is only available when at least one booked plot is being marked OPEN.',
      );
      return;
    }
    setAwaitingVacateTransferPick(true);
    onRequestTransferTargetByMap({ kind: 'vacate-transfer', waitingId: null });
  }, [onRequestTransferTargetByMap, showAlert, transferSourcePlots.length]);

  const removeTransferDestinationRow = useCallback((tempId) => {
    setVacateTransferDestinations((prev) => prev.filter((d) => d.tempId !== tempId));
  }, []);

  const updateTransferDestinationCustomer = useCallback((tempId, patch) => {
    setVacateTransferDestinations((prev) =>
      prev.map((d) =>
        d.tempId === tempId
          ? { ...d, customerForm: { ...(d.customerForm || {}), ...patch } }
          : d,
      ),
    );
  }, []);

  /**
   * When the source is a single booked plot, copy its booking customer details into
   * the destination's customer form so a vacant→new-booking transfer doesn't force
   * the user to retype name / mobile / address / category / payment fields. The
   * user can still freely edit any field. Returns null when the rule doesn't apply
   * (bulk source, source not booked, etc.) so the form starts empty.
   */
  const buildVacantDestinationPrefill = useCallback(() => {
    const empty = {
      customerName: '',
      customerMobiles: [''],
      customerAddress: '',
      customerCategory: 'regular',
      paymentMode: '',
      paymentTo: '',
      remarks: '',
    };
    if (isBulk) return empty;
    if (transferSourcePlots.length !== 1) return empty;
    const src = transferSourcePlots[0];
    const sbd = src?.bookingDetails;
    if (!sbd) return empty;
    const mobiles = Array.isArray(sbd.customerMobiles)
      ? sbd.customerMobiles.map((m) => String(m || '').trim()).filter(Boolean)
      : [];
    return {
      customerName: String(sbd.customerName || '').trim(),
      customerMobiles: mobiles.length > 0 ? mobiles : [''],
      customerAddress: String(sbd.customerAddress || '').trim(),
      customerCategory: normalizeCustomerCategory(sbd.customerCategory || 'regular'),
      paymentMode: String(sbd.paymentMode || '').trim(),
      paymentTo: String(sbd.paymentTo || '').trim(),
      remarks: '',
    };
  }, [isBulk, transferSourcePlots]);

  /**
   * Consume `pendingTransferTargetPlots` (array) for the vacate-transfer flow.
   * Single-pick and multi-pick both use this channel: LayoutScreen passes a
   * 1-element array for single tap and an N-element array for the long-press
   * multi-select flow. The existing booking/waiting transfer flow uses the
   * separate `pendingTransferTarget` (singular) channel and is untouched.
   */
  useEffect(() => {
    if (!visible) return;
    if (!awaitingVacateTransferPick) return;
    if (!Array.isArray(pendingTransferTargetPlots) || pendingTransferTargetPlots.length === 0) return;

    const sourceIdSet = new Set(transferSourcePlots.map((p) => String(p._id)));
    const existingDestIds = new Set(
      vacateTransferDestinations.map((d) => String(d.plotId)),
    );

    const accepted = [];
    const skipped = []; // { plotNumber, reason }
    for (const picked of pendingTransferTargetPlots) {
      if (!picked || !picked._id) continue;
      const id = String(picked._id);
      if (sourceIdSet.has(id)) {
        skipped.push({
          plotNumber: picked.plotNumber,
          reason: 'is being opened — cannot also be a destination',
        });
        continue;
      }
      if (picked.status === 'BM') {
        skipped.push({ plotNumber: picked.plotNumber, reason: 'is BM (reserved)' });
        continue;
      }
      if (existingDestIds.has(id)) {
        skipped.push({
          plotNumber: picked.plotNumber,
          reason: 'is already in the destination list',
        });
        continue;
      }
      existingDestIds.add(id);
      accepted.push(picked);
    }

    if (accepted.length > 0) {
      setVacateTransferDestinations((prev) => [
        ...prev,
        ...accepted.map((picked, idx) => ({
          tempId: `dest-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
          plotId: picked._id,
          plot: picked,
          customerForm:
            picked.status === 'vacant' ? buildVacantDestinationPrefill() : null,
        })),
      ]);
    }

    if (skipped.length > 0) {
      const lines = skipped
        .map((s) => `• Plot No. ${s.plotNumber} ${s.reason}`)
        .join('\n');
      showAlert(
        accepted.length > 0 ? 'Some plots skipped' : 'No destinations added',
        lines,
      );
    }

    setAwaitingVacateTransferPick(false);
    onConsumedPendingTransferTargetPlots?.();
  }, [
    visible,
    awaitingVacateTransferPick,
    pendingTransferTargetPlots,
    vacateTransferDestinations,
    transferSourcePlots,
    showAlert,
    onConsumedPendingTransferTargetPlots,
    buildVacantDestinationPrefill,
  ]);

  const parseAdvanceValue = useCallback((value) => {
    const txt = String(value ?? '').trim().replace(/,/g, '');
    if (!txt) return null;
    const n = Number(txt);
    return Number.isNaN(n) ? null : n;
  }, []);

  const formatRupees = useCallback((value) => `Rs. ${Number(value).toLocaleString()}`, []);

  const confirmFullAdvanceToggle = useCallback((nextChecked, opts = {}) => {
    const { advanceInput = '', categoryForPricing = 'regular' } = opts;
    const enteredFallback = parseAdvanceValue(advanceInput);

    if (!nextChecked) {
      showAlert(
        'Remove full advance mark?',
        'This clears the “full advance received” flag. It does not change the advance amount stored on the booking.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove mark',
            style: 'destructive',
            onPress: () => {
              setFullAdvanceReceived(false);
            },
          },
        ],
      );
      return;
    }

    const plotsForPricing =
      isBulk && selectedPlots.length > 0
        ? selectedPlots
        : plot
          ? [plot]
          : [];

    const confirmYes = () => {
      setFullAdvanceReceived(true);
    };

    const isScholarCustomer = normalizeCustomerCategory(categoryForPricing) === 'scholar';

    let scholarIdForPricing = null;
    if (isScholarCustomer && plotsForPricing.length > 0) {
      if (plotsForPricing.length === 1) {
        scholarIdForPricing = String(plotsForPricing[0]._id);
      } else if (isBulk) {
        scholarIdForPricing = scholarDiscountPlotId;
      } else {
        scholarIdForPricing = String(plotsForPricing[0]._id);
      }
    }

    if (
      isScholarCustomer &&
      isBulk &&
      plotsForPricing.length > 1 &&
      !scholarIdForPricing
    ) {
      setScholarPlotPickerVisible(true);
      return;
    }

    if (plotsForPricing.length === 0) {
      if (enteredFallback == null) {
        showAlert(
          'Advance amount required',
          'Enter the booking advance amount before marking full advance as received.',
        );
        return;
      }
      showAlert(
        'Confirm full advance received',
        `You entered ${formatRupees(enteredFallback)}. Confirm that this full amount has been received?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Yes', onPress: confirmYes },
        ],
        { detailedMessage: true },
      );
      return;
    }

    const rowArgs = { isScholarCustomer, scholarDiscountPlotId: scholarIdForPricing };
    const rows = plotsForPricing.map((p) => {
      const row = getExpectedBookingAdvanceRow(p, rowArgs);
      return row;
    });

    const pricedRows = rows.filter((r) => r.expected != null);
    const pricedTotal = pricedRows.reduce((s, r) => s + r.expected, 0);
    const allHavePricing = rows.length > 0 && pricedRows.length === rows.length;
    const noneHavePricing = pricedRows.length === 0;

    if (rows.length === 1) {
      const r = rows[0];
      let msg;
      if (r.expected != null) {
        msg = `Expected advance for Plot No. ${r.plotNumber} (${r.rateLabel} pricing) is ${formatRupees(
          r.expected,
        )}.\n\nConfirm that this full amount has been received?`;
      } else if (enteredFallback != null) {
        msg = `This plot has no advance in pricing data for the ${r.rateLabel} rate. You entered ${formatRupees(
          enteredFallback,
        )} as the booking advance.\n\nConfirm that the full advance has been received?`;
      } else {
        showAlert(
          'Cannot confirm',
          'This plot has no advance in pricing for the selected customer type. Enter the booking advance amount first.',
        );
        return;
      }
      showAlert('Confirm full advance received', msg, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Yes', onPress: confirmYes },
      ], { detailedMessage: true });
      return;
    }

    if (noneHavePricing) {
      if (enteredFallback == null) {
        showAlert(
          'Pricing data missing',
          'None of the selected plots have an advance in pricing for the rates used (regular / Alim-Hafiz). Enter booking advances or update plot pricing, then try again.',
        );
        return;
      }
      if (isBulk && rows.length > 1) {
        showAlert(
          'Confirm full advance received',
          `No per-plot advance is listed in pricing for these rates. You entered ${formatRupees(
            enteredFallback,
          )} as the combined booking advance for ${rows.length} plots.\n\nWhen you book, choose whether to split that total equally across plots so each record shows its share.\n\nConfirm that this combined amount has been fully received?`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Yes', onPress: confirmYes },
          ],
          { detailedMessage: true },
        );
        return;
      }
      const equation = rows
        .map((x) => `Plot No. ${x.plotNumber}: ${formatRupees(enteredFallback)}`)
        .join('\n');
      const total = enteredFallback * rows.length;
      showAlert(
        'Confirm full advance received',
        `Pricing does not list an expected advance for these plots. Using your entered amount for each plot:\n\n${equation}\n\nTotal: ${formatRupees(
          total,
        )}\n\nConfirm that the full combined amount has been received?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Yes', onPress: confirmYes },
        ],
        { detailedMessage: true },
      );
      return;
    }

    const scholarPlotMeta =
      isScholarCustomer && scholarIdForPricing && rows.length > 1
        ? plotsForPricing.find((p) => String(p._id) === String(scholarIdForPricing))
        : null;

    const lineText = rows
      .map((r) =>
        r.expected != null
          ? `Plot No. ${r.plotNumber}: ${formatRupees(r.expected)} (${r.rateLabel})`
          : `Plot No. ${r.plotNumber}: (no advance in pricing — ${r.rateLabel})`,
      )
      .join('\n');

    const typeLine = isScholarCustomer
      ? `Customer type: Alim / Hafiz — scholar advance applies to one plot only${
          scholarPlotMeta
            ? ` (currently Plot No. ${String(scholarPlotMeta.plotNumber ?? '').trim() || '—'}).`
            : '.'
        }`
      : 'Customer type: Regular — all plots use regular pricing.';

    let msg = `${typeLine}\n\nExpected advance per plot (same rule as Multi Plot Summary):\n\n${lineText}\n\n`;
    msg += `Combined expected advance: ${formatRupees(pricedTotal)}`;
    if (!allHavePricing) {
      msg += '\n\nThis total only includes plots where pricing lists an advance.';
    }
    msg += '\n\nConfirm that the full combined amount has been received for these plots?';

    showAlert('Confirm full advance received', msg, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Yes', onPress: confirmYes },
    ], { detailedMessage: true });
  }, [formatRupees, isBulk, parseAdvanceValue, plot, selectedPlots, showAlert, scholarDiscountPlotId]);

  /**
   * Mark-Open + Transfer flow.
   * Calls the dedicated /transfer-and-vacate endpoint which atomically opens all
   * source plots and lands the (post-refund) balance on the destination(s).
   * Returns true if the flow ran (success OR caught error); false if not applicable.
   */
  const submitTransferAndVacate = async () => {
    if (!hasTransferDestinations) return false;

    // Transfer-only mode: refund inputs are intentionally hidden, so don't
    // validate or include them in the payload — the entire received amount
    // is being moved to the destination(s).
    const isTransferOnly = vacateMode === 'transfer';
    const refundErr =
      !isTransferOnly && parsedRefundAmountForTransfer > 0
        ? validateRefundClient()
        : null;
    if (refundErr) {
      showAlert('Required', refundErr);
      return true;
    }
    const destErr = validateTransferDestinations();
    if (destErr) {
      showAlert('Required', destErr);
      return true;
    }
    if (needsWaitingReasonToOpen && !openWaitingRemarks.trim()) {
      // Source plot(s) with waiting entries still need a clearance reason —
      // we forward it as the source's removalRemarks-equivalent narrative line.
      showAlert('Required', 'Please enter cancellation reason for waiting entries.');
      return true;
    }

    try {
      setIsSubmittingTransferAndVacate(true);
      setIsSubmitting(true);

      const refundPayload =
        !isTransferOnly && parsedRefundAmountForTransfer > 0
          ? {
              amount: parsedRefundAmountForTransfer,
              mode: refundMode.trim(),
              by: refundBy.trim(),
              remarks: refundRemarks.trim(),
            }
          : null;

      const destinationsPayload = vacateTransferDestinations.map((d, idx) => {
        const slice = destinationSliceRupees[idx];
        const base = { plotId: d.plotId, slice };
        if (d.plot?.status === 'vacant' && d.customerForm) {
          const cf = d.customerForm;
          base.customerDetails = {
            customerName: String(cf.customerName || '').trim(),
            customerMobiles: (cf.customerMobiles || [])
              .map((m) => String(m || '').trim())
              .filter(Boolean),
            customerAddress: String(cf.customerAddress || '').trim(),
            customerCategory: normalizeCustomerCategory(cf.customerCategory || 'regular'),
            customerPhoto: '',
            paymentMode: String(cf.paymentMode || '').trim(),
            paymentTo: String(cf.paymentTo || '').trim(),
          };
        }
        if (d.plot?.status === 'waiting') {
          // Default to first waiter (matches existing make-final UX).
          const firstWaiter = Array.isArray(d.plot.waitingList) ? d.plot.waitingList[0] : null;
          if (firstWaiter?._id) base.waiterId = String(firstWaiter._id);
        }
        return base;
      });

      const body = {
        sourceIds: transferSourcePlots.map((p) => String(p._id)),
        refund: refundPayload,
        destinations: destinationsPayload,
      };

      const res = await api.post('/transfer-and-vacate', body);
      const data = res?.data || {};

      // Best-effort CometChat / activity feed narrative — server already wrote
      // a comprehensive narrative into every plot's history, but the realtime
      // activity stream still wants a one-liner per session.
      if (typeof onActivitySummary === 'function' && data?.narrative) {
        onActivitySummary(String(data.narrative));
      }

      // Socket events from the backend will refresh map state for all touched
      // plots, but we still close the modal so the user sees the result.
      onClose?.();
    } catch (e) {
      console.error('[BookingModal] transfer-and-vacate error:', e?.message);
      const apiMsg = e?.response?.data?.message;
      showAlert('Could not transfer', apiMsg || 'Something went wrong. Please try again.');
    } finally {
      setIsSubmittingTransferAndVacate(false);
      setIsSubmitting(false);
    }
    return true;
  };

  const handleSubmit = async (status) => {
    if (status === 'vacant') {
      // Mark-Open mode picker: when the source is a booked plot, the user must
      // explicitly choose Refund / Transfer / Both before we let them submit.
      if (needsRefundToOpen && !vacateMode) {
        showAlert(
          'Choose an option',
          'Pick how to handle the advance: Refund only, Transfer only, or Refund + Transfer.',
        );
        return;
      }
      // Transfer-only / Both both require at least one destination — guard
      // against an accidental tap before any destination has been added.
      if (
        needsRefundToOpen &&
        (vacateMode === 'transfer' || vacateMode === 'both') &&
        !hasTransferDestinations
      ) {
        showAlert(
          'Add destination',
          'Pick at least one destination plot to receive the transferred amount.',
        );
        return;
      }

      // Transfer-and-vacate intercept: when destinations are queued, route to
      // the dedicated endpoint instead of the standard mark-open path.
      if (hasTransferDestinations) {
        await submitTransferAndVacate();
        return;
      }

      if (needsRefundToOpen) {
        const err = validateRefundClient();
        if (err) {
          showAlert('Required', err);
          return;
        }
      }
      if (needsWaitingReasonToOpen && !openWaitingRemarks.trim()) {
        showAlert('Required', 'Please enter cancellation reason for waiting entries.');
        return;
      }
      try {
        setIsSubmitting(true);
        const payload = { status };
        if (needsRefundToOpen) {
          const raw = String(refundAmount).trim().replace(/,/g, '');
          payload.refundMode = refundMode.trim();
          payload.refundAmount = parseFloat(raw, 10);
          payload.refundBy = refundBy.trim();
          payload.refundRemarks = refundRemarks.trim();
        }
        if (needsWaitingReasonToOpen) {
          payload.removalRemarks = openWaitingRemarks.trim();
        }
        await onUpdate(payload);
      } catch (e) {
        console.error('[BookingModal] handleSubmit error:', e.message);
        showAlert('Error', 'Something went wrong. Please try again.');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (status === 'BM') {
      try {
        setIsSubmitting(true);
        await onUpdate({ status });
      } catch (e) {
        console.error('[BookingModal] handleSubmit error:', e.message);
        showAlert('Error', 'Something went wrong. Please try again.');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (!customerName.trim()) {
      showAlert('Required', 'Customer name is required.');
      return;
    }
    const validMobiles = customerMobiles.filter((m) => m.trim());
    if (!validMobiles.length) {
      showAlert('Required', 'At least one mobile number is required.');
      return;
    }
    const badMobile = validMobiles.find((m) => m.replace(/\D/g, '').length !== 10);
    if (badMobile) {
      showAlert('Invalid Number', `"${badMobile}" is not a valid 10-digit mobile number.`);
      return;
    }
    if (status === 'booked' && !isBulk && (plot?.waitingList?.length ?? 0) > 0) {
      if (!bookedFlowSourceRef.current) {
        showAlert(
          'Waiting list',
          'Use “Make final” on the correct waiting person, or tap Final and choose “Book as …” for the 1st waiting. If the buyer is not in the queue, remove all waiters first.',
        );
        return;
      }
    }

    if (status === 'booked' && isBulk && selectedPlots.some((p) => p.status === 'waiting')) {
      showAlert(
        'Final booking unavailable',
        'One or more selected plots have waiting entries. Bulk booking is only allowed when no selected plot is in waiting status.',
      );
      return;
    }

    if (status === 'booked') {
      if (!advanceAmount && !adminOverrideGranted) {
        showAlert(
          'Advance Amount Required',
          'Booking requires an advance amount. Enter it or use admin override.',
          [
            { text: 'Enter Amount', style: 'cancel' },
            { text: 'Admin Override', onPress: () => setShowAdminOverride(true) },
          ]
        );
        return;
      }
      if (!paymentMode) {
        showAlert('Required', 'Please select a payment mode.');
        return;
      }
    }

    const runUpdate = async (submitStatus, bulkBookAdvanceMode) => {
      try {
        setIsSubmitting(true);
        let finalPhotoUrl = await uploadPhoto();
        const existingPhoto = String(customerPhoto || '').trim();
        if (!finalPhotoUrl && existingPhoto && /^https?:\/\//i.test(existingPhoto)) {
          finalPhotoUrl = existingPhoto;
        }
        const mobiles = customerMobiles.filter((m) => m.trim());
        const userRemarks = remarks.trim();
        const bulkPlotNumbersLine =
          isBulk && selectedPlots.length > 0 && (submitStatus === 'booked' || submitStatus === 'waiting')
            ? (() => {
                const nums = selectedPlots
                  .map((p) => String(p?.plotNumber ?? '').trim())
                  .filter(Boolean);
                if (!nums.length) return '';
                return `Multiple plots: ${nums.map((n) => `Plot No. ${n}`).join(', ')}`;
              })()
            : '';

        const equalSplits =
          submitStatus === 'booked' &&
          bulkBookAdvanceMode === 'equal' &&
          isBulk &&
          selectedPlots.length > 1
            ? splitAdvanceTotalEvenly(advanceAmount, selectedPlots)
            : null;
        const splitRemark =
          equalSplits && equalSplits.length
            ? buildBulkEqualSplitRemarkLines(advanceAmount, equalSplits, formatRupees)
            : '';
        const mergedRemarks = [userRemarks, bulkPlotNumbersLine, splitRemark].filter(Boolean).join('\n\n');

        let advanceByPlotId;
        let bookingAdvanceNum =
          submitStatus === 'booked' && String(advanceAmount ?? '').trim()
            ? parseFloat(String(advanceAmount).replace(/,/g, ''))
            : null;
        if (bookingAdvanceNum != null && Number.isNaN(bookingAdvanceNum)) {
          bookingAdvanceNum = null;
        }
        if (submitStatus === 'booked' && equalSplits && equalSplits.length) {
          advanceByPlotId = {};
          equalSplits.forEach((s) => {
            advanceByPlotId[s.plotId] = s.advanceAmount;
          });
          bookingAdvanceNum = null;
        }

        const payload = {
          status: submitStatus,
          customerName: customerName.trim(),
          customerMobiles: mobiles,
          customerAddress: customerAddress.trim(),
          customerCategory: normalizeCustomerCategory(customerCategory),
          customerPhoto: finalPhotoUrl,
          ...(submitStatus === 'booked' && {
            ...(advanceByPlotId              ? { advanceByPlotId }
              : { advanceAmount: Number.isNaN(bookingAdvanceNum) ? null : bookingAdvanceNum }),
            paymentMode,
            paymentTo: paymentTo.trim(),
            remarks: mergedRemarks,
            isFullAdvanceReceived: !!fullAdvanceReceived,
          }),
          ...(submitStatus === 'waiting' && mergedRemarks ? { remarks: mergedRemarks } : {}),
        };
        await onUpdate(payload);
      } catch (e) {
        console.error('[BookingModal] handleSubmit error:', e.message);
        showAlert('Error', 'Something went wrong. Please try again.');
      } finally {
        setIsSubmitting(false);
      }
    };

    if (status === 'booked') {
      const advanceNum = parseAdvanceValue(advanceAmount);
      const needsBulkAdvanceChoice =
        isBulk &&
        selectedPlots.length > 1 &&
        !adminOverrideGranted &&
        advanceNum != null &&
        advanceNum > 0;

      if (needsBulkAdvanceChoice) {
        const splits = splitAdvanceTotalEvenly(advanceAmount, selectedPlots);
        const preview =
          splits?.map((s) => `Plot No. ${s.plotNumber}: ${formatRupees(s.advanceAmount)}`).join('\n') || '';
        showAlert(
          'Advance across plots',
          `You entered ${formatRupees(advanceNum)} as the total booking advance.\n\n` +
            `Should this amount be divided equally among the ${selectedPlots.length} selected plots?\n\n` +
            `If yes, each plot will record its share:\n${preview}\n\n` +
            `The total will be noted in remarks on every plot. ` +
            `If no, the full ${formatRupees(advanceNum)} will be stored on each plot (only if each plot truly received that much).`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Full amount each plot',
              style: 'destructive',
              onPress: () => {
                showAlert(
                  'Confirm',
                  `Each plot will show advance ${formatRupees(advanceNum)}. Summed across plots that is ${formatRupees(
                    advanceNum * selectedPlots.length,
                  )}.`,
                  [
                    { text: 'Back', style: 'cancel' },
                    { text: 'Continue', onPress: () => void runUpdate(status, 'repeat') },
                  ],
                );
              },
            },
            { text: 'Divide equally', onPress: () => void runUpdate(status, 'equal') },
          ],
        );
        return;
      }
    }

    await runUpdate(status, null);
  };

  const openRemoveWaiter = (waitingId) => {
    setRemoveWaiterReason('');
    setRemoveWaiterId(waitingId);
  };

  const openEditWaiter = (waiter) => {
    const mobiles = (waiter?.customerMobiles || []).filter((m) => String(m).trim());
    setEditBookingOpen(false);
    setEditBookingAdvanceAmount('');
    setEditBookingPaymentMode('');
    setEditBookingPaymentTo('');
    setEditWaiterId(waiter?._id || null);
    setEditWaiterName(waiter?.customerName || '');
    setEditWaiterMobiles(mobiles.length ? mobiles : ['']);
    setEditWaiterAddress(waiter?.customerAddress || '');
    setEditCustomerCategory(normalizeCustomerCategory(waiter?.customerCategory));
  };

  const openEditBooking = () => {
    const bd = plot?.bookingDetails;
    if (!bd) return;
    setEditWaiterId(null);
    setEditBookingOpen(true);
    const mobiles = (bd.customerMobiles || []).filter((m) => String(m).trim());
    setEditWaiterName(bd.customerName || '');
    setEditWaiterMobiles(mobiles.length ? mobiles : ['']);
    setEditWaiterAddress(bd.customerAddress || '');
    setEditCustomerCategory(normalizeCustomerCategory(bd.customerCategory));
    setEditBookingAdvanceAmount(
      bd.advanceAmount != null && !Number.isNaN(Number(bd.advanceAmount))
        ? String(bd.advanceAmount)
        : '0',
    );
    setEditBookingPaymentMode(String(bd.paymentMode || '').trim());
    setEditBookingPaymentTo(String(bd.paymentTo || '').trim());
  };

  const closeEditWaiter = () => {
    if (isEditingWaiter || isSavingBookingEdit) return;
    setEditWaiterId(null);
    setEditBookingOpen(false);
    setEditBookingAdvanceAmount('');
    setEditBookingPaymentMode('');
    setEditBookingPaymentTo('');
    setEditWaiterName('');
    setEditWaiterMobiles(['']);
    setEditWaiterAddress('');
    setEditCustomerCategory('regular');
  };

  const addEditWaiterMobile = () => {
    if (editWaiterMobiles.length < 5) {
      setEditWaiterMobiles((prev) => [...prev, '']);
    }
  };

  const removeEditWaiterMobile = (index) => {
    const next = editWaiterMobiles.filter((_, i) => i !== index);
    setEditWaiterMobiles(next.length ? next : ['']);
  };

  const updateEditWaiterMobile = (text, index) => {
    const next = [...editWaiterMobiles];
    next[index] = text;
    setEditWaiterMobiles(next);
  };

  const dialPhone = async (raw) => {
    const normalized = String(raw || '').replace(/[^\d+]/g, '');
    if (!normalized) {
      showAlert('No number', 'No phone number is saved for this contact.');
      return;
    }
    const url = `tel:${normalized}`;
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) await Linking.openURL(url);
      else showAlert('Cannot open dialer', 'This device cannot place calls from the app.');
    } catch (e) {
      showAlert('Call failed', e?.message || 'Could not open the phone app.');
    }
  };

  const confirmRemoveWaiter = async () => {
    const reason = removeWaiterReason.trim();
    if (!reason) {
      showAlert('Required', 'Please enter a reason for removing this person from the queue.');
      return;
    }
    try {
      setIsRemoving(true);
      const waiter = (plot?.waitingList || []).find((w) => String(w._id) === String(removeWaiterId));
      const waiterName = String(waiter?.customerName || 'Unknown').trim();
      const res = await api.delete(`/${plot._id}/waiting/${removeWaiterId}`, {
        data: { removalRemarks: reason },
      });
      onActivitySummary?.({
        type: 'remove_waiter',
        plotNumber: plot?.plotNumber,
        customerName: waiterName,
        reason,
      });
      setRemoveWaiterId(null);
      setRemoveWaiterReason('');
      const updatedPlot = res?.data?.plot || res?.data;
      if (
        updatedPlot &&
        Array.isArray(updatedPlot.waitingList) &&
        updatedPlot.waitingList.length === 0
      ) {
        // Same UX as marking OPEN: if no queue remains, close the sheet.
        onClose?.();
      }
    } catch (error) {
      const msg = error.response?.data?.message || 'Failed to remove waiter.';
      showAlert('Error', msg);
    } finally {
      setIsRemoving(false);
    }
  };

  const saveEditWaiter = async () => {
    const name = editWaiterName.trim();
    const mobiles = editWaiterMobiles.map((m) => String(m).trim()).filter(Boolean);
    if (!name) {
      showAlert('Required', 'Customer name is required.');
      return;
    }
    if (!mobiles.length) {
      showAlert('Required', 'At least one mobile number is required.');
      return;
    }
    const badMobile = mobiles.find((m) => m.replace(/\D/g, '').length !== 10);
    if (badMobile) {
      showAlert('Invalid Number', `"${badMobile}" is not a valid 10-digit mobile number.`);
      return;
    }
    if (!plot?._id || !editWaiterId) return;
    try {
      setIsEditingWaiter(true);
      await api.patch(`/${plot._id}/waiting/${editWaiterId}`, {
        customerName: name,
        customerMobiles: mobiles,
        customerAddress: editWaiterAddress.trim(),
        customerCategory: normalizeCustomerCategory(editCustomerCategory),
      });
      onActivitySummary?.({
        type: 'update_waiter',
        plotNumber: plot?.plotNumber,
        customerName: name,
      });
      closeEditWaiter();
    } catch (error) {
      const msg = error.response?.data?.message || 'Failed to update waiting details.';
      showAlert('Error', msg);
    } finally {
      setIsEditingWaiter(false);
    }
  };

  const saveEditBooking = async () => {
    const name = editWaiterName.trim();
    const mobiles = editWaiterMobiles.map((m) => String(m).trim()).filter(Boolean);
    if (!name) {
      showAlert('Required', 'Customer name is required.');
      return;
    }
    if (!mobiles.length) {
      showAlert('Required', 'At least one mobile number is required.');
      return;
    }
    const badMobile = mobiles.find((m) => m.replace(/\D/g, '').length !== 10);
    if (badMobile) {
      showAlert('Invalid Number', `"${badMobile}" is not a valid 10-digit mobile number.`);
      return;
    }
    if (!plot?._id || !plot.bookingDetails) return;

    const advStr = editBookingAdvanceAmount.trim();
    if (advStr === '') {
      showAlert('Required', 'Advance amount is required (use 0 if there was none).');
      return;
    }
    const advanceNum = parseFloat(advStr);
    if (Number.isNaN(advanceNum) || advanceNum < 0) {
      showAlert('Invalid', 'Advance must be a valid non-negative number.');
      return;
    }
    if (!editBookingPaymentMode.trim()) {
      showAlert('Required', 'Payment mode is required.');
      return;
    }

    try {
      setIsSavingBookingEdit(true);
      await api.patch(`/${plot._id}/booking`, {
        customerName: name,
        customerMobiles: mobiles,
        customerAddress: editWaiterAddress.trim(),
        customerCategory: normalizeCustomerCategory(editCustomerCategory),
        advanceAmount: advanceNum,
        paymentMode: editBookingPaymentMode.trim(),
        paymentTo: editBookingPaymentTo.trim(),
        isFullAdvanceReceived: Boolean(plot.bookingDetails?.isFullAdvanceReceived),
      });
      onActivitySummary?.({
        type: 'update_booking',
        plotNumber: plot?.plotNumber,
        customerName: name,
      });
      setEditBookingOpen(false);
      setEditBookingAdvanceAmount('');
      setEditBookingPaymentMode('');
      setEditBookingPaymentTo('');
      setEditWaiterId(null);
      setEditWaiterName('');
      setEditWaiterMobiles(['']);
      setEditWaiterAddress('');
      setEditCustomerCategory('regular');
    } catch (error) {
      const msg = error.response?.data?.message || 'Failed to update booking details.';
      showAlert('Error', msg);
    } finally {
      setIsSavingBookingEdit(false);
    }
  };

  const confirmOpen = () => {
    showAlert(
      'Mark as OPEN?',
      'Are you sure you want to mark this plot as OPEN? This will permanently clear all booking and waiting list data for this plot.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          style: 'destructive',
          onPress: () => handleSubmit('vacant'),
        },
      ]
    );
  };

  const handleOpenPress = () => {
    if (needsRefundToOpen || needsWaitingReasonToOpen) {
      setActiveAction('refundOpen');
      return;
    }
    confirmOpen();
  };

  const confirmBM = () => {
    showAlert(
      'Reserve Plot (BM)?',
      'Are you sure you want to reserve this plot as BM? This will lock it from bookings and clear current waitlists.',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Confirm', 
          style: 'destructive', 
          onPress: () => handleSubmit('BM') 
        }
      ]
    );
  };

  /** During transfer confirm, header reflects the destination plot (tap target), not the source. */
  const isTransferConfirm = Boolean(transferStep === 'confirm' && transferTargetPlot);
  const headerPlot = isTransferConfirm ? transferTargetPlot : plot;

  const plotTitle = isBulk
    ? `Bulk Update — ${bulkCount} Plots`
    : headerPlot
      ? `Plot No. ${headerPlot.plotNumber}`
      : '';

  const hasBulkSelection = isBulk && selectedPlots.length > 0;
  const showOpenButton = isBulk
    ? hasBulkSelection && !selectedPlots.every((p) => p.status === 'vacant')
    : Boolean(plot) && plot.status !== 'vacant';
  const showWaitlistAndBook = isBulk
    ? hasBulkSelection && !selectedPlots.some((p) => p.status === 'booked' || p.status === 'BM')
    : Boolean(plot) && plot.status !== 'booked' && plot.status !== 'BM';
  /** Bulk: hide Final booking if any selected plot already has waiting (cannot bulk “instant book” that set). */
  const showFinalBookingQuickAction =
    showWaitlistAndBook &&
    (!isBulk || !selectedPlots.some((p) => p.status === 'waiting'));
  const showBmButton = isBulk
    ? hasBulkSelection && !selectedPlots.some((p) => p.status === 'booked' || p.status === 'BM')
    : Boolean(plot) && plot.status !== 'booked' && plot.status !== 'BM';
  const nextWaitingOrdinal = toOrdinal((plot?.waitingList?.length || 0) + 1);

  const formatDateTime = formatDateTimeShared;

  return (
    <>
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <KeyboardAvoidingView
          behavior={keyboardAvoidingBehavior()}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
          style={styles.kav}
        >
          <View style={[styles.sheet, { maxHeight: sheetMaxHeight }]}>

            {/* Header */}
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <Text style={styles.plotTitle}>{plotTitle}</Text>
                {!isBulk && headerPlot && (
                  <View style={styles.statusRow}>
                    <StatusBadge
                      status={headerPlot.status}
                      waiterCount={headerPlot.waitingList ? headerPlot.waitingList.length : 0}
                      styles={styles}
                      colors={colors}
                      isDark={isDark}
                    />
                  </View>
                )}
                {isTransferConfirm && plot ? (
                  <Text style={styles.headerTransferFrom} numberOfLines={1}>
                    Transferring from Plot No. {plot.plotNumber}
                  </Text>
                ) : null}
              </View>
              <View style={styles.headerActions}>
                {!isBulk && plot && onPressPlotDetails && !isTransferConfirm && (
                  <TouchableOpacity
                    onPress={onPressPlotDetails}
                    style={styles.headerActionBtn}
                    accessibilityLabel="Plot details"
                  >
                    <Icon name="information-outline" size={22} color="#fff" />
                  </TouchableOpacity>
                )}
                {!isBulk && plot && !readOnlyGuest && !isTransferConfirm && (
                  <TouchableOpacity 
                    onPress={() => setShowHistory(!showHistory)} 
                    style={[styles.headerActionBtn, showHistory && styles.headerActionBtnActive]}
                  >
                    <Icon name={showHistory ? "form-select" : "history"} size={22} color="#fff" />
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={onClose} style={styles.closeX}>
                  <Icon name="close" size={20} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>

            {showHistory && !readOnlyGuest ? (
              <ScrollView
                style={[styles.bodyScroll, { maxHeight: scrollMaxHeight }]}
                contentContainerStyle={styles.bodyContent}
                showsVerticalScrollIndicator
                keyboardShouldPersistTaps="handled"
              >
              {!isBulk && (
                <View style={styles.historyContainer}>
                  <View style={styles.historyHeaderRow}>
                    <Text style={styles.historyTitle}>Activity History</Text>
                    {isLoadingHistory && <ActivityIndicator size="small" color={colors.primary} />}
                  </View>
                  
                  {history.length === 0 && !isLoadingHistory ? (
                    <Text style={styles.emptyHistory}>No history recorded for this plot yet.</Text>
                  ) : (
                    history.map((item, index) => {
                      const detailBlocks = getActivityHistoryDetailBlocks(item);
                      return (
                      <View key={item._id || index} style={styles.historyItem}>
                        <View style={styles.historyDotContainer}>
                          <View style={styles.historyDot} />
                          {index < history.length - 1 && <View style={styles.historyLine} />}
                        </View>
                        <View style={styles.historyContent}>
                          <View style={styles.historyItemHeader}>
                            <View style={{flexDirection: 'row', alignItems: 'center'}}>
                              {(() => {
                                const swColor = getStatusSwatchColor(item.action, item.newStatus, item.waiterCount);
                                const isVacant = item.action === 'Marked Vacant' || item.newStatus === 'vacant';
                                const isRemoved = item.action === 'Removed Waiting' || item.action === 'Removed Waiter';
                                return swColor != null ? (
                                  <View style={{
                                    width: 12, height: 12, backgroundColor: swColor, marginRight: 6,
                                    ...(isVacant ? { borderWidth: 1, borderColor: isDark ? '#94a3b8' : '#1a1a2e' } : {}),
                                    ...(isRemoved ? { borderRadius: 2 } : {}),
                                  }} />
                                ) : null;
                              })()}
                              <Text style={styles.historyAction}>{displayActivityAction(item.action, item.newStatus)}</Text>
                            </View>
                            <Text style={styles.historyTime}>{formatDateTime(item.createdAt)}</Text>
                          </View>
                          <View style={styles.historyByRow}>
                            <Text style={styles.historyDetails}>
                              Customer: {item.customerName} • By:{' '}
                            </Text>
                            <UserAvatar
                              name={item.changedBy}
                              imageUrl={item.changedByAvatarUrl}
                              size={18}
                              style={styles.historyAvatar}
                            />
                            <Text style={styles.historyDetails}>{nameOnly(item.changedBy)}</Text>
                          </View>
                          {item.refundDetails && item.refundDetails.mode ? (
                            <View style={styles.historyRefundBlock}>
                              <View style={styles.historyRefundRow}>
                                <Text style={styles.historyRefund}>
                                  Refund: Rs. {Number(item.refundDetails.amount).toLocaleString()} via{' '}
                                  {item.refundDetails.mode} • Owner:{' '}
                                </Text>
                                <UserAvatar
                                  name={item.refundDetails.processedBy}
                                  imageUrl={item.refundDetails.processedByAvatarUrl}
                                  size={16}
                                  style={styles.historyAvatar}
                                />
                                <Text style={styles.historyRefund}>{nameOnly(item.refundDetails.processedBy)}</Text>
                              </View>
                              {item.refundDetails.remarks ? (
                                <Text style={[styles.historyRefund, { marginTop: 6 }]}>
                                  Notes: {item.refundDetails.remarks}
                                </Text>
                              ) : null}
                            </View>
                          ) : null}
                          <ActivityLogDetailPanels
                            blocks={detailBlocks}
                            colors={colors}
                            isDark={isDark}
                            dialPhone={dialPhone}
                            itemKey={item._id != null ? String(item._id) : `h-${index}`}
                          />
                          {(item.action === 'Removed Waiting' || item.action === 'Removed Waiter') &&
                          item.removalRemarks &&
                          detailBlocks.length === 0 ? (
                            <Text style={styles.historyRefund}>Removal reason: {item.removalRemarks}</Text>
                          ) : null}
                        </View>
                      </View>
                      );
                    })
                  )}
                  <TouchableOpacity style={styles.historyBackBtn} onPress={() => setShowHistory(false)}>
                    <Text style={styles.historyBackBtnText}>Back to Plot Details</Text>
                  </TouchableOpacity>
                </View>
              )}
              </ScrollView>
            ) : (
              <>
              <ScrollView
                ref={bodyScrollRef}
                style={[styles.bodyScroll, { maxHeight: scrollMaxHeight }]}
                contentContainerStyle={styles.bodyContent}
                showsVerticalScrollIndicator
                keyboardShouldPersistTaps="handled"
              >
              {transferStep && !isBulk && !readOnlyGuest && !showHistory && (
                <View
                  style={[
                    styles.transferPanel,
                    { borderColor: colors.border, backgroundColor: isDark ? '#1e1033' : '#f5f3ff' },
                  ]}
                >
                  <Text style={[styles.transferTitle, { color: colors.text }]}>Plot transfer</Text>
                  <Text style={[styles.transferSubtitle, { color: colors.textSecondary }]}>
                    {transferKind === 'booking'
                      ? 'Move this booking to another plot.'
                      : 'Move this waiting entry to another plot.'}
                  </Text>
                  {transferStep === 'target' ? (
                    <>
                      <Text style={[styles.transferMapPickIntro, { color: colors.textSecondary }]}>
                        The sheet will close so you can tap the destination plot on the layout map.
                      </Text>
                      <TouchableOpacity
                        style={[
                          styles.transferMapPickBtn,
                          { borderColor: colors.border, backgroundColor: colors.surface },
                        ]}
                        onPress={requestTransferTargetOnMap}
                        disabled={!onRequestTransferTargetByMap}
                        accessibilityRole="button"
                        accessibilityLabel="Choose destination plot on the map"
                      >
                        <Icon name="map-outline" size={22} color="#7c3aed" />
                        <Text style={styles.transferMapPickBtnText}>Choose plot on layout</Text>
                      </TouchableOpacity>
                      {!onRequestTransferTargetByMap ? (
                        <Text style={[styles.transferMapPickMissing, { color: colors.textSecondary }]}>
                          Map selection is unavailable from this screen.
                        </Text>
                      ) : null}
                      <View style={styles.submitRow}>
                        <TouchableOpacity style={styles.backBtn} onPress={cancelPlotTransfer}>
                          <Icon name="arrow-left" size={16} color={colors.textSecondary} />
                          <Text style={styles.backBtnText}> Cancel</Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  ) : (
                    <>
                      <Text style={[styles.transferConfirmHint, { color: colors.textSecondary }]}>
                        To Plot No.{' '}
                        <Text style={{ fontWeight: '800', color: colors.text }}>
                          {transferTargetPlot?.plotNumber}
                        </Text>
                        {' · From '}
                        <Text style={{ fontWeight: '700', color: colors.text }}>{plot?.plotNumber}</Text>
                      </Text>

                      <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>
                          Customer Name <Text style={styles.required}>*</Text>
                        </Text>
                        <View style={styles.inputWrapper}>
                          <Icon
                            name="account-outline"
                            size={18}
                            color={colors.textSecondary}
                            style={styles.inputIcon}
                          />
                          <TextInput
                            placeholderTextColor={colors.placeholder}
                            style={styles.inputWithIcon}
                            value={customerName}
                            onChangeText={setCustomerName}
                            placeholder="Full Name"
                          />
                        </View>
                      </View>

                      <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>
                          Contact Numbers <Text style={styles.required}>*</Text>
                        </Text>
                        {customerMobiles.map((m, i) => (
                          <View key={i} style={styles.mobileNumberEntry}>
                            <View style={styles.mobileNumberHeader}>
                              <Text style={[styles.mobileNumberLabel, { color: colors.textSecondary }]}>
                                Mobile {i + 1}
                              </Text>
                              {customerMobiles.length > 1 && (
                                <TouchableOpacity onPress={() => removeMobile(i)} style={styles.mobileRemoveBtn}>
                                  <Icon name="minus" size={15} color="#e53935" />
                                </TouchableOpacity>
                              )}
                            </View>
                            <MobileBoxInput
                              value={m}
                              onChange={(t) => updateMobile(t, i)}
                              colors={colors}
                              isDark={isDark}
                            />
                          </View>
                        ))}
                        {customerMobiles.length < 5 && (
                          <TouchableOpacity onPress={addMobile} style={styles.addMobileBtn}>
                            <Icon name="plus" size={15} color={colors.primary} />
                            <Text style={[styles.addMobileBtnText, { color: colors.primary }]}>
                              Add number
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>

                      <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>
                          Area / Locality <Text style={styles.optional}>(Optional)</Text>
                        </Text>
                        <View style={styles.inputWrapper}>
                          <Icon
                            name="map-marker-outline"
                            size={18}
                            color={colors.textSecondary}
                            style={styles.inputIcon}
                          />
                          <TextInput
                            placeholderTextColor={colors.placeholder}
                            style={styles.inputWithIcon}
                            value={customerAddress}
                            onChangeText={setCustomerAddress}
                            placeholder="e.g. Block B, Sector 4"
                          />
                        </View>
                      </View>

                      <View style={styles.fieldGroup}>
                        <CustomerCategoryField value={customerCategory} onChange={setCustomerCategory} />
                      </View>

                      {activeAction === 'booked' &&
                      isBulk &&
                      selectedPlots.length > 1 &&
                      normalizeCustomerCategory(customerCategory) === 'scholar' ? (
                        <View
                          style={[
                            styles.scholarBulkBanner,
                            {
                              borderColor: isDark ? '#059669' : '#a7f3d0',
                              backgroundColor: isDark ? 'rgba(5, 150, 105, 0.14)' : '#ecfdf5',
                            },
                          ]}
                        >
                          <Icon name="school" size={22} color="#059669" />
                          <View style={styles.scholarBulkBannerTextCol}>
                            <Text
                              style={[styles.scholarBulkBannerTitle, { color: isDark ? '#a7f3d0' : '#065f46' }]}
                            >
                              Scholar rate on one plot only
                            </Text>
                            <Text style={[styles.scholarBulkBannerSub, { color: colors.textSecondary }]}>
                              Plot No.{' '}
                              <Text style={{ fontWeight: '800', color: colors.text }}>
                                {selectedPlots.find((p) => String(p._id) === String(scholarDiscountPlotId))
                                  ?.plotNumber ?? '—'}
                              </Text>{' '}
                              uses Alim / Hafiz advance in the confirmation; other plots use regular pricing.
                            </Text>
                          </View>
                          <TouchableOpacity
                            onPress={() => setScholarPlotPickerVisible(true)}
                            style={[
                              styles.scholarBulkChangeBtn,
                              { borderColor: isDark ? '#059669' : '#34d399' },
                            ]}
                            accessibilityLabel="Choose which plot gets Alim Hafiz pricing"
                          >
                            <Text
                              style={[styles.scholarBulkChangeBtnText, { color: isDark ? '#a7f3d0' : '#047857' }]}
                            >
                              Change
                            </Text>
                          </TouchableOpacity>
                        </View>
                      ) : null}

                      <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>
                          Customer Photo <Text style={styles.optional}>(Optional)</Text>
                        </Text>
                        <TouchableOpacity style={styles.cameraBtn} onPress={handleCamera}>
                          {photoLocalUri ? (
                            <Image source={{ uri: photoLocalUri }} style={styles.photoPreview} />
                          ) : (
                            <View style={styles.cameraPlaceholder}>
                              <Icon name="camera-outline" size={32} color={colors.placeholder} />
                              <Text style={styles.cameraText}>Tap to capture</Text>
                            </View>
                          )}
                        </TouchableOpacity>
                        {photoLocalUri ? (
                          <TouchableOpacity onPress={handleCamera} style={styles.retakeBtn}>
                            <Icon name="camera-retake-outline" size={14} color={colors.text} />
                            <Text style={styles.retakeBtnText}> Retake Photo</Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>

                      {transferKind === 'booking' ? (
                        <View style={styles.paymentCard}>
                          <View style={styles.paymentHeaderRow}>
                            <Icon name="cash-multiple" size={18} color={colors.text} />
                            <Text style={styles.paymentHeader}> Payment Details</Text>
                          </View>
                          <View style={styles.fieldGroup}>
                            <Text style={styles.fieldLabel}>
                              Advance / Booking Amount <Text style={styles.required}>*</Text>
                            </Text>
                            {isBulk && selectedPlots.length > 1 ? (
                              <Text style={[styles.fieldHint, { color: colors.textSecondary }]}>
                                Enter the total received for all {selectedPlots.length} plots. On submit, choose
                                whether to split it equally per plot or store the full amount on each.
                              </Text>
                            ) : null}
                            <View style={styles.inputWrapper}>
                              <Text style={styles.currencySymbol}>Rs.</Text>
                              <TextInput
                                placeholderTextColor={colors.placeholder}
                                style={[styles.inputWithIcon, { flex: 1 }]}
                                value={advanceAmount}
                                onChangeText={setAdvanceAmount}
                                placeholder="Enter amount"
                                keyboardType="numeric"
                              />
                            </View>
                            {!advanceAmount && !adminOverrideGranted && (
                              <TouchableOpacity
                                onPress={() => setShowAdminOverride(!showAdminOverride)}
                                style={styles.overrideLink}
                              >
                                <Icon name="shield-key-outline" size={14} color="#e53935" />
                                <Text style={styles.overrideLinkText}> No advance? Admin override</Text>
                              </TouchableOpacity>
                            )}
                            {adminOverrideGranted ? (
                              <View style={styles.overrideGrantedRow}>
                                <Icon name="check-circle" size={14} color="#388e3c" />
                                <Text style={styles.overrideGranted}> Override active</Text>
                              </View>
                            ) : null}
                            {showAdminOverride && !adminOverrideGranted ? (
                              <View style={styles.overrideBox}>
                                <Text style={styles.overrideLabel}>Admin Password</Text>
                                <View style={styles.mobileRow}>
                                  <TextInput
                                    placeholderTextColor={colors.placeholder}
                                    style={[styles.inputWithIcon, { flex: 1, marginLeft: 0 }]}
                                    value={adminPassword}
                                    onChangeText={setAdminPassword}
                                    placeholder="Enter password"
                                    secureTextEntry
                                  />
                                  <TouchableOpacity
                                    onPress={checkAdminOverride}
                                    style={[styles.mobileActionBtn, styles.mobileAddBtn]}
                                  >
                                    <Icon name="check" size={18} color="#fff" />
                                  </TouchableOpacity>
                                </View>
                              </View>
                            ) : null}
                          </View>
                          <View style={styles.fieldGroup}>
                            <Text style={styles.fieldLabel}>
                              Payment Mode <Text style={styles.required}>*</Text>
                            </Text>
                            <View style={styles.pillRow}>
                              {PAYMENT_MODES.map((mode) => (
                                <TouchableOpacity
                                  key={mode}
                                  style={[styles.pill, paymentMode === mode && styles.pillActive]}
                                  onPress={() => {
                                    setPaymentMode(mode);
                                    setPaymentTo('');
                                  }}
                                >
                                  <Text
                                    style={[styles.pillText, paymentMode === mode && styles.pillTextActive]}
                                  >
                                    {mode}
                                  </Text>
                                </TouchableOpacity>
                              ))}
                            </View>
                          </View>
                          {paymentMode ? (
                            <View style={styles.fieldGroup}>
                              <Text style={styles.fieldLabel}>{paymentToLabel(paymentMode)}</Text>
                              <View style={styles.inputWrapper}>
                                <Icon
                                  name="account-arrow-right-outline"
                                  size={18}
                                  color={colors.textSecondary}
                                  style={styles.inputIcon}
                                />
                                <TextInput
                                  placeholderTextColor={colors.placeholder}
                                  style={styles.inputWithIcon}
                                  value={paymentTo}
                                  onChangeText={setPaymentTo}
                                  placeholder={paymentToLabel(paymentMode)}
                                />
                              </View>
                            </View>
                          ) : null}
                        </View>
                      ) : null}

                      <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>
                          Extra note for destination log <Text style={styles.optional}>(Optional)</Text>
                        </Text>
                        <TextInput
                          placeholderTextColor={colors.placeholder}
                          style={[styles.inputWrapper, styles.multilineInput, { paddingHorizontal: 14 }]}
                          value={transferExtraRemarks}
                          onChangeText={setTransferExtraRemarks}
                          placeholder="Appended to the automatic transfer note on the destination plot"
                          multiline
                          numberOfLines={3}
                          textAlignVertical="top"
                        />
                      </View>

                      <View style={styles.submitRow}>
                        <TouchableOpacity
                          style={styles.backBtn}
                          onPress={() => {
                            setTransferStep('target');
                            setTransferTargetPlot(null);
                          }}
                        >
                          <Icon name="arrow-left" size={16} color={colors.textSecondary} />
                          <Text style={styles.backBtnText}> Back</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.submitBtn, styles.transferSubmitBtn]}
                          onPress={submitPlotTransfer}
                          disabled={isSubmitting || isUploading}
                        >
                          {isSubmitting || isUploading ? (
                            <ActivityIndicator color="#ffffff" />
                          ) : (
                            <Text style={styles.submitBtnText}>Confirm transfer</Text>
                          )}
                        </TouchableOpacity>
                      </View>
                    </>
                  )}
                </View>
              )}

              {/* BOOKED SUMMARY (same visual language as waiting-queue cards) */}
              {!isBulk &&
                plot &&
                plot.status === 'booked' &&
                plot.bookingDetails &&
                !transferStep &&
                (!activeAction || activeAction === 'refundOpen') &&
                (() => {
                const bd = plot.bookingDetails;
                const bookedMobiles = (bd.customerMobiles || []).filter((m) => String(m).trim());
                const hasPayment =
                  bd.advanceAmount != null ||
                  (bd.paymentMode && String(bd.paymentMode).trim()) ||
                  (bd.paymentTo && String(bd.paymentTo).trim());
                return (
                  <View style={styles.bookedSummaryOuter}>
                    <View style={styles.bookedDetailsCard}>
                      {bd.customerPhoto ? (
                        <Pressable
                          onPress={() => setQueueImagePreviewUri(bd.customerPhoto)}
                          style={({ pressed }) => [
                            styles.queuePhotoTouchable,
                            styles.bookedPhotoStrip,
                            pressed && styles.queuePhotoTouchablePressed,
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel="View customer photo full screen"
                        >
                          <Image source={{ uri: bd.customerPhoto }} style={styles.queuePhotoTop} />
                          <View style={styles.queuePhotoOverlay}>
                            <Icon name="fullscreen" size={22} color="#fff" />
                          </View>
                        </Pressable>
                      ) : null}

                      <View style={styles.queueCardInner}>
                        <View style={styles.queueTopBar}>
                          <Text style={[styles.queueSectionTitle, { marginBottom: 0, flex: 1 }]}>
                            Booked for
                          </Text>
                          {!readOnlyGuest ? (
                            <View style={styles.queueActionIcons}>
                              <TouchableOpacity
                                onPress={beginTransferBooking}
                                style={styles.queueIconBtn}
                                accessibilityRole="button"
                                accessibilityLabel="Transfer booking to another plot"
                              >
                                <Icon name="swap-horizontal" size={22} color="#7c3aed" />
                              </TouchableOpacity>
                              <TouchableOpacity
                                onPress={openEditBooking}
                                style={styles.queueIconBtn}
                                accessibilityRole="button"
                                accessibilityLabel="Edit booking details"
                              >
                                <Icon name="pencil-outline" size={22} color={colors.primary} />
                              </TouchableOpacity>
                              <TouchableOpacity
                                onPress={() => { void copyBookingCustomerToClipboard(bd); }}
                                style={styles.queueIconBtn}
                                accessibilityRole="button"
                                accessibilityLabel="Copy customer details to clipboard"
                              >
                                <Icon name="content-copy" size={22} color={colors.textSecondary} />
                              </TouchableOpacity>
                            </View>
                          ) : null}
                        </View>

                        <Text style={styles.queueFieldLabel}>Name</Text>
                        <Text style={styles.queueFieldValue} numberOfLines={4}>
                          {bd.customerName || '—'}
                        </Text>

                        {bookedMobiles.length > 0 ? (
                          <>
                            <Text style={[styles.queueFieldLabel, styles.queueFieldLabelSpaced]}>
                              Mobile number
                            </Text>
                            {bookedMobiles.map((m, mi) => (
                              <View key={mi} style={styles.queueMobileRow}>
                                <Text style={styles.queueFieldValueMono}>{m}</Text>
                                <TouchableOpacity
                                  onPress={() => dialPhone(m)}
                                  style={styles.queueInlineCall}
                                  accessibilityLabel={`Call ${m}`}
                                >
                                  <Icon name="phone" size={24} color="#1565c0" />
                                </TouchableOpacity>
                              </View>
                            ))}
                          </>
                        ) : null}

                        {bd.customerAddress ? (
                          <>
                            <Text style={[styles.queueFieldLabel, styles.queueFieldLabelSpaced]}>
                              Address
                            </Text>
                            <Text style={styles.queueFieldValue}>{bd.customerAddress}</Text>
                          </>
                        ) : null}

                        <Text style={[styles.queueFieldLabel, styles.queueFieldLabelSpaced]}>
                          Customer type
                        </Text>
                        <Text style={styles.queueFieldValue}>
                          {labelForCustomerCategory(bd.customerCategory)}
                        </Text>

                        <View style={[styles.queueFieldLabelSpaced, { marginTop: 8 }]}>
                          <RemarkLogSection
                            entries={getRemarkEntries(bd)}
                            readOnly={readOnlyGuest}
                            disabled={false}
                            onAdd={async (text) => {
                              await api.post(`/${idForApiPath(plot._id)}/booking/remarks`, { text });
                              emitNoteActivity('booking', false, bd.customerName, text);
                            }}
                            onPatch={async (rid, text) => {
                              await api.patch(`/${idForApiPath(plot._id)}/booking/remarks/${rid}`, {
                                text,
                              });
                              emitNoteActivity('booking', true, bd.customerName, text);
                            }}
                          />
                        </View>

                        {hasPayment ? (
                          <View style={styles.queuePaymentHint}>
                            <View style={styles.queuePaymentHeaderRow}>
                              <Text style={[styles.queueFieldLabel, { marginBottom: 0 }]}>Payment</Text>
                              {!readOnlyGuest && !bd.isFullAdvanceReceived ? (
                                <TouchableOpacity
                                  onPress={openRecordPaymentFromSummary}
                                  style={styles.queuePaymentMarkBtn}
                                  accessibilityRole="button"
                                  accessibilityLabel="Record final payment and mark complete advance received"
                                >
                                  <Icon name="cash-check" size={22} color="#059669" />
                                </TouchableOpacity>
                              ) : bd.isFullAdvanceReceived ? (
                                <Icon name="check-decagram" size={22} color="#059669" />
                              ) : null}
                            </View>
                            {bd.advanceAmount != null ? (
                              <Text style={styles.queuePaymentText}>
                                Advance: Rs. {Number(bd.advanceAmount).toLocaleString()}
                                {bd.paymentMode && String(bd.paymentMode).trim()
                                  ? ` • ${String(bd.paymentMode).trim()}`
                                  : ''}
                              </Text>
                            ) : bd.paymentMode && String(bd.paymentMode).trim() ? (
                              <Text style={styles.queuePaymentText}>
                                Mode: {String(bd.paymentMode).trim()}
                              </Text>
                            ) : null}
                            {bd.paymentTo && String(bd.paymentTo).trim() ? (
                              <Text style={styles.queuePaymentText} numberOfLines={4}>
                                Paid to: {String(bd.paymentTo).trim()}
                              </Text>
                            ) : null}
                          </View>
                        ) : null}

                        <View style={styles.queueMetaFooter}>
                          <Text style={styles.queueAddedWhen}>
                            Booked {formatDateTimeCard(bd.createdAt)}
                          </Text>
                          {bd.createdBy ? (
                            <View style={styles.queueAddedByRow}>
                              <Text style={styles.queueAddedByLabel}>Performed by</Text>
                              <UserAvatar
                                name={bd.createdBy}
                                imageUrl={bd.createdByAvatarUrl}
                                size={26}
                              />
                              <Text style={styles.queueAddedByName}>{nameOnly(bd.createdBy)}</Text>
                            </View>
                          ) : null}
                        </View>
                      </View>
                    </View>
                  </View>
                );
              })()}

              {/* WAITING LIST SUMMARY (QUEUE) */}
              {!isBulk &&
                plot &&
                plot.waitingList?.length > 0 &&
                !activeAction &&
                !transferStep && (
                <View style={styles.summaryCard}>
                  <Text style={styles.queueSectionTitle}>
                    Waiting list queue ({plot.waitingList.length})
                  </Text>

                  {plot.waitingList.map((waiter, index) => {
                    const mobiles = (waiter.customerMobiles || []).filter((m) => String(m).trim());
                    return (
                      <View key={waiter._id || index} style={styles.queueItem}>
                        <View style={styles.queueLevel}>
                          <View style={styles.queueBadge}>
                            <Text style={styles.queueBadgeText}>{index + 1}</Text>
                          </View>
                          {index < plot.waitingList.length - 1 ? <View style={styles.queueLine} /> : null}
                        </View>

                        <View style={styles.queueCard}>
                          {waiter.customerPhoto ? (
                            <Pressable
                              onPress={() => setQueueImagePreviewUri(waiter.customerPhoto)}
                              style={({ pressed }) => [
                                styles.queuePhotoTouchable,
                                pressed && styles.queuePhotoTouchablePressed,
                              ]}
                              accessibilityRole="button"
                              accessibilityLabel="View customer photo full screen"
                            >
                              <Image
                                source={{ uri: waiter.customerPhoto }}
                                style={styles.queuePhotoTop}
                              />
                              <View style={styles.queuePhotoOverlay}>
                                <Icon name="fullscreen" size={22} color="#fff" />
                              </View>
                            </Pressable>
                          ) : null}

                          <View style={styles.queueCardInner}>
                            <View style={styles.queueTopBar}>
                              <Text style={styles.queueOrderText}>
                                {toOrdinal(index + 1)} WAITING
                              </Text>
                              {!readOnlyGuest ? (
                                <View style={styles.queueActionIcons}>
                                  <TouchableOpacity
                                    onPress={() => beginTransferWaiter(waiter._id)}
                                    style={styles.queueIconBtn}
                                    accessibilityLabel="Transfer this waiting entry to another plot"
                                  >
                                    <Icon name="swap-horizontal" size={22} color="#7c3aed" />
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    onPress={() => openEditWaiter(waiter)}
                                    style={styles.queueIconBtn}
                                    accessibilityLabel="Edit waiting details"
                                  >
                                    <Icon name="pencil-outline" size={22} color={colors.primary} />
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    onPress={() => { void copyWaiterCustomerToClipboard(waiter); }}
                                    style={styles.queueIconBtn}
                                    accessibilityLabel="Copy customer details to clipboard"
                                  >
                                    <Icon name="content-copy" size={22} color={colors.textSecondary} />
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    onPress={() => openRemoveWaiter(waiter._id)}
                                    disabled={isRemoving}
                                    style={styles.queueIconBtn}
                                    accessibilityLabel="Remove from queue"
                                  >
                                    <Icon name="delete-outline" size={22} color="#e53935" />
                                  </TouchableOpacity>
                                </View>
                              ) : null}
                            </View>

                            <Text style={styles.queueFieldLabel}>Name</Text>
                            <Text style={styles.queueFieldValue} numberOfLines={3}>
                              {waiter.customerName || '—'}
                            </Text>

                            {mobiles.length > 0 ? (
                              <>
                                <Text style={[styles.queueFieldLabel, styles.queueFieldLabelSpaced]}>
                                  Mobile number
                                </Text>
                                {mobiles.map((m, mi) => (
                                  <View key={mi} style={styles.queueMobileRow}>
                                    <Text style={styles.queueFieldValueMono}>{m}</Text>
                                    <TouchableOpacity
                                      onPress={() => dialPhone(m)}
                                      style={styles.queueInlineCall}
                                      accessibilityLabel={`Call ${m}`}
                                    >
                                      <Icon name="phone" size={24} color="#1565c0" />
                                    </TouchableOpacity>
                                  </View>
                                ))}
                              </>
                            ) : null}

                            {waiter.customerAddress ? (
                              <>
                                <Text style={[styles.queueFieldLabel, styles.queueFieldLabelSpaced]}>
                                  Address
                                </Text>
                                <Text style={styles.queueFieldValue}>{waiter.customerAddress}</Text>
                              </>
                            ) : null}

                            <Text style={[styles.queueFieldLabel, styles.queueFieldLabelSpaced]}>
                              Customer type
                            </Text>
                            <Text style={styles.queueFieldValue}>
                              {labelForCustomerCategory(waiter.customerCategory)}
                            </Text>

                            <View style={[styles.queueFieldLabelSpaced, { marginTop: 8 }]}>
                              <RemarkLogSection
                                entries={getRemarkEntries(waiter)}
                                readOnly={readOnlyGuest}
                                disabled={false}
                                onAdd={async (text) => {
                                  await api.post(
                                    `/${idForApiPath(plot._id)}/waiting/${idForApiPath(waiter._id)}/remarks`,
                                    { text },
                                  );
                                  emitNoteActivity('waiting', false, waiter.customerName, text);
                                }}
                                onPatch={async (rid, text) => {
                                  await api.patch(
                                    `/${idForApiPath(plot._id)}/waiting/${idForApiPath(waiter._id)}/remarks/${rid}`,
                                    { text },
                                  );
                                  emitNoteActivity('waiting', true, waiter.customerName, text);
                                }}
                              />
                            </View>

                            {(waiter.advanceAmount != null && waiter.advanceAmount !== '') ||
                            (waiter.paymentMode && String(waiter.paymentMode).trim()) ? (
                              <View style={styles.queuePaymentHint}>
                                {waiter.advanceAmount != null && waiter.advanceAmount !== '' ? (
                                  <Text style={styles.queuePaymentText}>
                                    Advance: Rs. {Number(waiter.advanceAmount).toLocaleString()}
                                    {waiter.paymentMode ? ` • ${waiter.paymentMode}` : ''}
                                  </Text>
                                ) : waiter.paymentMode ? (
                                  <Text style={styles.queuePaymentText}>{waiter.paymentMode}</Text>
                                ) : null}
                                {waiter.paymentTo ? (
                                  <Text style={styles.queuePaymentText} numberOfLines={3}>
                                    To: {waiter.paymentTo}
                                  </Text>
                                ) : null}
                              </View>
                            ) : null}

                            <View style={styles.queueMetaFooter}>
                              <View style={styles.queueMetaFooterRow}>
                                <View style={styles.queueMetaLeft}>
                                  <Text style={styles.queueAddedWhen}>
                                    Added {formatDateTimeCard(waiter.createdAt)}
                                  </Text>
                                  {waiter.createdBy ? (
                                    <View style={styles.queueAddedByRow}>
                                      <Text style={styles.queueAddedByLabel}>Added by</Text>
                                      <UserAvatar
                                        name={waiter.createdBy}
                                        imageUrl={waiter.createdByAvatarUrl}
                                        size={26}
                                      />
                                      <Text style={styles.queueAddedByName}>
                                        {nameOnly(waiter.createdBy)}
                                      </Text>
                                    </View>
                                  ) : null}
                                </View>
                                {index === 0 ? (
                                  <TouchableOpacity
                                    style={styles.makeFinalBtnCompact}
                                    onPress={() => applyWaiterToBookingForm(waiter)}
                                    activeOpacity={0.88}
                                    accessibilityLabel="Mark as Final — use first waiting customer details"
                                  >
                                    <Icon name="check-circle-outline" size={17} color="#1b5e20" />
                                    <Text
                                      style={styles.makeFinalBtnCompactText}
                                      numberOfLines={2}
                                    >
                                      Mark as{'\n'}Final
                                    </Text>
                                  </TouchableOpacity>
                                ) : null}
                              </View>
                            </View>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Refund / waiting-clear reason required when opening certain plot states */}
              {activeAction === 'refundOpen' && (
                <View
                  onLayout={(e) => {
                    const y = e?.nativeEvent?.layout?.y;
                    if (typeof y === 'number') setRefundSectionY(y);
                  }}
                >
                  <Text style={styles.sectionLabel}>
                    {needsRefundToOpen ? 'Refund details' : 'Cancellation details'}
                  </Text>
                  {needsRefundToOpen && (
                    <Text style={styles.refundIntro}>
                      This plot is booked. Choose how to handle the advance, then fill in the details below.
                    </Text>
                  )}
                  {!needsRefundToOpen && needsWaitingReasonToOpen && (
                    <Text style={styles.refundIntro}>
                      This plot has waiting entries. Enter cancellation reason before marking it OPEN.
                    </Text>
                  )}
                  {!isBulk && plot?.bookingDetails?.advanceAmount != null && (
                    <Text style={styles.refundHint}>
                      Original advance: Rs.{' '}
                      {Number(plot.bookingDetails.advanceAmount).toLocaleString()}
                    </Text>
                  )}
                  {isBulk && needsRefundToOpen && (
                    <Text style={styles.refundHint}>
                      At least one selected plot is booked — the same refund details apply to each
                      booked plot in this update.
                    </Text>
                  )}

                  {/* ───────────── Mode picker ─────────────
                      Forces an explicit choice so the form stays short and the
                      user knows the cards below match what they picked. */}
                  {needsRefundToOpen && !readOnlyGuest && (
                    <View style={styles.vacateModeBox}>
                      <Text style={styles.vacateModeLabel}>
                        What do you want to do? <Text style={styles.required}>*</Text>
                      </Text>
                      <View style={styles.vacateModeRow}>
                        {[
                          {
                            key: 'refund',
                            label: 'Complete Refund',
                            variant: 'refund',
                          },
                          {
                            key: 'transfer',
                            label: 'Amount Transfer to other Plot',
                            variant: 'transfer',
                          },
                          {
                            key: 'both',
                            label: 'Partial Refund + Amount Transfer',
                            variant: 'both',
                          },
                        ].map((opt) => {
                          const active = vacateMode === opt.key;
                          const btnBase =
                            opt.variant === 'refund'
                              ? styles.vacateModeBtnRefund
                              : opt.variant === 'transfer'
                                ? styles.vacateModeBtnTransfer
                                : styles.vacateModeBtnBoth;
                          const btnActive =
                            opt.variant === 'refund'
                              ? styles.vacateModeBtnRefundActive
                              : opt.variant === 'transfer'
                                ? styles.vacateModeBtnTransferActive
                                : styles.vacateModeBtnBothActive;
                          const txtBase =
                            opt.variant === 'refund'
                              ? styles.vacateModeBtnTextRefund
                              : opt.variant === 'transfer'
                                ? styles.vacateModeBtnTextTransfer
                                : styles.vacateModeBtnTextBoth;
                          const txtActive =
                            opt.variant === 'refund'
                              ? styles.vacateModeBtnTextRefundActive
                              : opt.variant === 'transfer'
                                ? styles.vacateModeBtnTextTransferActive
                                : styles.vacateModeBtnTextBothActive;
                          return (
                            <TouchableOpacity
                              key={opt.key}
                              style={[styles.vacateModeBtn, btnBase, active && btnActive]}
                              onPress={() => handlePickVacateMode(opt.key)}
                              accessibilityRole="button"
                              accessibilityState={{ selected: active }}
                            >
                              <Text
                                style={[styles.vacateModeBtnLabel, txtBase, active && txtActive]}
                              >
                                {opt.label}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                      {!vacateMode && (
                        <Text style={styles.vacateModeHint}>
                          Pick one to reveal the inputs below.
                        </Text>
                      )}
                    </View>
                  )}

                  {showPaymentCard && (
                  <View style={styles.paymentCard}>
                    {showRefundFields && (
                      <View style={styles.paymentHeaderRow}>
                        <Icon name="cash-multiple" size={18} color={colors.text} />
                        <Text style={styles.paymentHeader}> Refund</Text>
                      </View>
                    )}

                    {showRefundFields && (
                      <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>
                          Refund mode <Text style={styles.required}>*</Text>
                        </Text>
                        <View style={styles.pillRow}>
                          {REFUND_MODES.map((mode) => (
                            <TouchableOpacity
                              key={mode}
                              style={[styles.pill, refundMode === mode && styles.pillActive]}
                              onPress={() => setRefundMode(mode)}
                            >
                              <Text
                                style={[styles.pillText, refundMode === mode && styles.pillTextActive]}
                              >
                                {mode}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>
                    )}

                    {showRefundFields && (
                      <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>
                          Refund amount (Rs.) <Text style={styles.required}>*</Text>
                        </Text>
                        <View style={styles.inputWrapper}>
                          <Text style={styles.currencySymbol}>Rs.</Text>
                          <TextInput
                            placeholderTextColor={colors.placeholder}
                            style={[styles.inputWithIcon, { flex: 1 }]}
                            value={refundAmount}
                            onChangeText={setRefundAmount}
                            placeholder="Amount refunded"
                            keyboardType="decimal-pad"
                          />
                        </View>
                      </View>
                    )}

                    {showRefundFields && (
                      <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>
                          Processed by (owner) <Text style={styles.required}>*</Text>
                        </Text>
                        <View style={styles.inputWrapper}>
                          <Icon name="account-outline" size={18} color={colors.textSecondary} style={styles.inputIcon} />
                          <TextInput
                            placeholderTextColor={colors.placeholder}
                            style={styles.inputWithIcon}
                            value={refundBy}
                            onChangeText={setRefundBy}
                            placeholder="Owner name"
                          />
                        </View>
                      </View>
                    )}

                    {showRefundFields && (
                      <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>
                          Refund remarks <Text style={styles.required}>*</Text>
                        </Text>
                        <TextInput
                          placeholderTextColor={colors.placeholder}
                          style={[styles.inputWrapper, styles.multilineInput, { paddingHorizontal: 14 }]}
                          value={refundRemarks}
                          onChangeText={setRefundRemarks}
                          placeholder="Refund notes, reference no., etc."
                          multiline
                          numberOfLines={3}
                          textAlignVertical="top"
                        />
                      </View>
                    )}

                    {needsWaitingReasonToOpen && (
                      <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>
                          Cancellation reason (waiting) <Text style={styles.required}>*</Text>
                        </Text>
                        <TextInput
                          placeholderTextColor={colors.placeholder}
                          style={[styles.inputWrapper, styles.multilineInput, { paddingHorizontal: 14 }]}
                          value={openWaitingRemarks}
                          onChangeText={setOpenWaitingRemarks}
                          placeholder="Reason for clearing waiting entries before OPEN"
                          multiline
                          numberOfLines={3}
                          textAlignVertical="top"
                        />
                      </View>
                    )}
                  </View>
                  )}

                  {/* ───────────── Transfer remaining advance to other plots ───────────── */}
                  {showTransferCard && (
                    <View style={styles.transferCard}>
                      <View style={styles.transferHeaderRow}>
                        <Icon name="swap-horizontal" size={18} color={colors.text} />
                        <Text style={styles.transferHeader}> Transfer to other plots</Text>
                        {hasTransferDestinations ? (
                          <View style={styles.transferActiveBadge}>
                            <Text style={styles.transferActiveBadgeText}>
                              {vacateTransferDestinations.length} dest.
                            </Text>
                          </View>
                        ) : null}
                      </View>

                      <Text style={styles.transferIntro}>
                        {vacateMode === 'transfer'
                          ? `No refund — the full received amount Rs. ${totalReceivedFromSources.toLocaleString()} will be transferred to the destination(s) below.`
                          : `Move part (or all) of the advance from ${
                              transferSourcePlots.length > 1
                                ? `the ${transferSourcePlots.length} booked plots being opened`
                                : 'this plot'
                            } onto another plot.`}
                      </Text>

                      <View style={styles.transferTotalsBox}>
                        <View style={styles.transferTotalsRow}>
                          <Text style={styles.transferTotalsLabel}>Total received</Text>
                          <Text style={styles.transferTotalsValue}>
                            Rs. {totalReceivedFromSources.toLocaleString()}
                          </Text>
                        </View>
                        {vacateMode === 'both' && (
                          <View style={styles.transferTotalsRow}>
                            <Text style={styles.transferTotalsLabel}>Refund (above)</Text>
                            <Text style={styles.transferTotalsValue}>
                              Rs. {parsedRefundAmountForTransfer.toLocaleString()}
                            </Text>
                          </View>
                        )}
                        <View style={[styles.transferTotalsRow, styles.transferTotalsRowEm]}>
                          <Text style={styles.transferTotalsLabelEm}>To transfer</Text>
                          <Text
                            style={[
                              styles.transferTotalsValueEm,
                              transferableTotalRupees <= 0 && { color: '#b91c1c' },
                            ]}
                          >
                            Rs. {transferableTotalRupees.toLocaleString()}
                          </Text>
                        </View>
                        {hasTransferDestinations && transferableTotalRupees > 0 ? (
                          <Text style={styles.transferSplitHint}>
                            {vacateTransferDestinations.length === 1
                              ? `Goes entirely to the destination below.`
                              : `Split equally across ${vacateTransferDestinations.length} destinations (~ Rs. ${
                                  destinationSliceRupees[0]?.toLocaleString() ?? '0'
                                } each).`}
                          </Text>
                        ) : null}
                      </View>

                      {vacateTransferDestinations.map((d, idx) => {
                        const dPlot = d.plot || {};
                        const slice = destinationSliceRupees[idx] ?? 0;
                        const expected = expectedAdvanceForPlot(dPlot, dPlot.bookingDetails || {});
                        const expectedAmt = expected?.amount;
                        let predictedAdvance = slice;
                        let actionLine = '';
                        if (dPlot.status === 'vacant') {
                          actionLine = `Will create a new booking with advance Rs. ${slice.toLocaleString()}.`;
                          predictedAdvance = slice;
                        } else if (dPlot.status === 'booked') {
                          const cur = Number(dPlot?.bookingDetails?.advanceAmount || 0);
                          predictedAdvance = cur + slice;
                          actionLine = `Adds Rs. ${slice.toLocaleString()} to existing advance Rs. ${cur.toLocaleString()} (new total Rs. ${predictedAdvance.toLocaleString()}).`;
                        } else if (dPlot.status === 'waiting') {
                          const w = Array.isArray(dPlot.waitingList) ? dPlot.waitingList[0] : null;
                          predictedAdvance = slice;
                          actionLine = w
                            ? `Will finalise 1st waiting (${w.customerName || '—'}) with advance Rs. ${slice.toLocaleString()}.`
                            : `Will finalise the first waiting customer with Rs. ${slice.toLocaleString()}.`;
                        }
                        const willBlueTick =
                          expectedAmt != null && Number(predictedAdvance) >= expectedAmt;
                        const cf = d.customerForm || {};
                        return (
                          <View key={d.tempId} style={styles.transferDestCard}>
                            <View style={styles.transferDestHeader}>
                              <View style={{ flex: 1 }}>
                                <View style={styles.transferDestTitleRow}>
                                  <Text style={styles.transferDestTitle}>
                                    Plot No. {dPlot.plotNumber ?? '?'}
                                  </Text>
                                  <View
                                    style={[
                                      styles.transferDestStatusPill,
                                      {
                                        backgroundColor:
                                          STATUS_COLORS[dPlot.status] || colors.border,
                                      },
                                    ]}
                                  >
                                    <Text
                                      style={[
                                        styles.transferDestStatusPillText,
                                        {
                                          color:
                                            STATUS_TEXT_COLORS[dPlot.status] || colors.text,
                                        },
                                      ]}
                                    >
                                      {String(dPlot.status || '').toUpperCase()}
                                    </Text>
                                  </View>
                                  {willBlueTick ? (
                                    <View style={styles.transferBluePredict}>
                                      <Icon name="check-decagram" size={14} color="#1565c0" />
                                      <Text style={styles.transferBluePredictText}>
                                        Will mark Full Advance
                                      </Text>
                                    </View>
                                  ) : null}
                                </View>
                                <Text style={styles.transferDestSlice}>
                                  Receives Rs. {slice.toLocaleString()}
                                </Text>
                                <Text style={styles.transferDestActionLine}>{actionLine}</Text>
                              </View>
                              <TouchableOpacity
                                onPress={() => removeTransferDestinationRow(d.tempId)}
                                style={styles.transferDestRemoveBtn}
                                accessibilityLabel={`Remove destination Plot No. ${dPlot.plotNumber}`}
                              >
                                <Icon name="close" size={18} color="#b91c1c" />
                              </TouchableOpacity>
                            </View>

                            {/* Inline customer form for vacant destinations */}
                            {dPlot.status === 'vacant' && (
                              <View style={styles.transferCustForm}>
                                <Text style={styles.transferCustFormHint}>
                                  Enter buyer details for this new booking.
                                </Text>

                                <View style={styles.fieldGroup}>
                                  <Text style={styles.fieldLabel}>
                                    Customer name <Text style={styles.required}>*</Text>
                                  </Text>
                                  <View style={styles.inputWrapper}>
                                    <Icon
                                      name="account-outline"
                                      size={18}
                                      color={colors.textSecondary}
                                      style={styles.inputIcon}
                                    />
                                    <TextInput
                                      placeholderTextColor={colors.placeholder}
                                      style={styles.inputWithIcon}
                                      value={cf.customerName || ''}
                                      onChangeText={(t) =>
                                        updateTransferDestinationCustomer(d.tempId, {
                                          customerName: t,
                                        })
                                      }
                                      placeholder="Full Name"
                                    />
                                  </View>
                                </View>

                                <View style={styles.fieldGroup}>
                                  <Text style={styles.fieldLabel}>
                                    Contact number <Text style={styles.required}>*</Text>
                                  </Text>
                                  <MobileBoxInput
                                    value={(cf.customerMobiles || [''])[0] || ''}
                                    onChange={(t) =>
                                      updateTransferDestinationCustomer(d.tempId, {
                                        customerMobiles: [t],
                                      })
                                    }
                                    colors={colors}
                                    isDark={isDark}
                                  />
                                </View>

                                <View style={styles.fieldGroup}>
                                  <Text style={styles.fieldLabel}>Address</Text>
                                  <TextInput
                                    placeholderTextColor={colors.placeholder}
                                    style={[
                                      styles.inputWrapper,
                                      styles.multilineInput,
                                      { paddingHorizontal: 14 },
                                    ]}
                                    value={cf.customerAddress || ''}
                                    onChangeText={(t) =>
                                      updateTransferDestinationCustomer(d.tempId, {
                                        customerAddress: t,
                                      })
                                    }
                                    placeholder="Address (optional)"
                                    multiline
                                    numberOfLines={2}
                                    textAlignVertical="top"
                                  />
                                </View>

                                <View style={styles.fieldGroup}>
                                  <CustomerCategoryField
                                    value={cf.customerCategory || 'regular'}
                                    onChange={(v) =>
                                      updateTransferDestinationCustomer(d.tempId, {
                                        customerCategory: v,
                                      })
                                    }
                                    label="Customer type"
                                  />
                                </View>

                                <View style={styles.fieldGroup}>
                                  <Text style={styles.fieldLabel}>
                                    Payment mode <Text style={styles.required}>*</Text>
                                  </Text>
                                  <View style={styles.pillRow}>
                                    {PAYMENT_MODES.map((mode) => {
                                      const sel = (cf.paymentMode || '') === mode;
                                      return (
                                        <TouchableOpacity
                                          key={mode}
                                          style={[styles.pill, sel && styles.pillActive]}
                                          onPress={() =>
                                            updateTransferDestinationCustomer(d.tempId, {
                                              paymentMode: mode,
                                            })
                                          }
                                        >
                                          <Text
                                            style={[
                                              styles.pillText,
                                              sel && styles.pillTextActive,
                                            ]}
                                          >
                                            {mode}
                                          </Text>
                                        </TouchableOpacity>
                                      );
                                    })}
                                  </View>
                                </View>

                                <View style={styles.fieldGroup}>
                                  <Text style={styles.fieldLabel}>
                                    Payment to <Text style={styles.required}>*</Text>
                                  </Text>
                                  <View style={styles.inputWrapper}>
                                    <Icon
                                      name="account-cash-outline"
                                      size={18}
                                      color={colors.textSecondary}
                                      style={styles.inputIcon}
                                    />
                                    <TextInput
                                      placeholderTextColor={colors.placeholder}
                                      style={styles.inputWithIcon}
                                      value={cf.paymentTo || ''}
                                      onChangeText={(t) =>
                                        updateTransferDestinationCustomer(d.tempId, {
                                          paymentTo: t,
                                        })
                                      }
                                      placeholder="Owner / receiver name"
                                    />
                                  </View>
                                </View>
                              </View>
                            )}
                          </View>
                        );
                      })}

                      <TouchableOpacity
                        style={styles.transferAddBtn}
                        onPress={addTransferDestinationRow}
                        disabled={isSubmitting}
                      >
                        <Icon name="map-marker-plus" size={18} color={colors.primary} />
                        <Text style={[styles.transferAddBtnText, { color: colors.primary }]}>
                          {hasTransferDestinations
                            ? 'Pick more destinations on map'
                            : 'Pick destination plot(s) on map'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  <View style={styles.submitRow}>
                    <TouchableOpacity style={styles.backBtn} onPress={() => setActiveAction(null)}>
                      <Icon name="arrow-left" size={16} color={colors.textSecondary} />
                      <Text style={styles.backBtnText}> Cancel</Text>
                    </TouchableOpacity>
                    {(() => {
                      // Compute button copy + disabled state from the picked
                      // mode, so users get clear next-step guidance instead of
                      // a generic "Confirm OPEN" that would just error out.
                      let label = 'Confirm OPEN';
                      let disabled = isSubmitting;
                      if (needsRefundToOpen && !vacateMode) {
                        label = 'Pick an option above';
                        disabled = true;
                      } else if (
                        needsRefundToOpen &&
                        (vacateMode === 'transfer' || vacateMode === 'both') &&
                        !hasTransferDestinations
                      ) {
                        label = 'Add destination plot(s)';
                        disabled = true;
                      } else if (hasTransferDestinations) {
                        label = `Confirm OPEN + Transfer (${vacateTransferDestinations.length})`;
                      }
                      return (
                        <TouchableOpacity
                          style={[
                            styles.submitBtn,
                            styles.openBtnSolid,
                            disabled && { opacity: 0.5 },
                          ]}
                          onPress={() => handleSubmit('vacant')}
                          disabled={disabled}
                        >
                          {isSubmitting ? (
                            <ActivityIndicator color="#0f172a" />
                          ) : (
                            <Text
                              style={[
                                styles.submitBtnText,
                                styles.submitBtnTextOnYellow,
                              ]}
                            >
                              {label}
                            </Text>
                          )}
                        </TouchableOpacity>
                      );
                    })()}
                  </View>
                </View>
              )}
              {/* Customer Form */}
              {activeAction &&
                activeAction !== 'vacant' &&
                activeAction !== 'refundOpen' &&
                (
                <>
                  <Text style={styles.sectionLabel}>
                    {activeAction === 'waiting' ? 'Add to Waiting List' : 'Instant Booking'}
                  </Text>
                  {!readOnlyGuest && (
                    <TouchableOpacity
                      style={[
                        styles.clipboardPasteBar,
                        { borderColor: colors.border, backgroundColor: isDark ? '#1e293b' : '#f1f5f9' },
                      ]}
                      onPress={() => { void pasteCustomerIntoAddForm(); }}
                      accessibilityRole="button"
                      accessibilityLabel="Paste customer details from clipboard"
                    >
                      <Icon name="content-paste" size={18} color={colors.primary} />
                      <Text style={[styles.clipboardPasteBarText, { color: colors.primary }]}>
                        Paste customer details
                      </Text>
                    </TouchableOpacity>
                  )}

                  {/* Name */}
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Customer Name <Text style={styles.required}>*</Text></Text>
                    <View style={styles.inputWrapper}>
                      <Icon name="account-outline" size={18} color={colors.textSecondary} style={styles.inputIcon} />
                      <TextInput
                        placeholderTextColor={colors.placeholder}
                        style={styles.inputWithIcon}
                        value={customerName}
                        onChangeText={setCustomerName}
                        placeholder="Full Name"
                      />
                    </View>
                  </View>

                  {/* Mobiles */}
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Contact Numbers <Text style={styles.required}>*</Text></Text>
                    {customerMobiles.map((m, i) => (
                      <View key={i} style={styles.mobileNumberEntry}>
                        <View style={styles.mobileNumberHeader}>
                          <Text style={[styles.mobileNumberLabel, { color: colors.textSecondary }]}>
                            Mobile {i + 1}
                          </Text>
                          {customerMobiles.length > 1 && (
                            <TouchableOpacity onPress={() => removeMobile(i)} style={styles.mobileRemoveBtn}>
                              <Icon name="minus" size={15} color="#e53935" />
                            </TouchableOpacity>
                          )}
                        </View>
                        <MobileBoxInput
                          value={m}
                          onChange={(t) => updateMobile(t, i)}
                          colors={colors}
                          isDark={isDark}
                        />
                      </View>
                    ))}
                    {customerMobiles.length < 5 && (
                      <TouchableOpacity onPress={addMobile} style={styles.addMobileBtn}>
                        <Icon name="plus" size={15} color={colors.primary} />
                        <Text style={[styles.addMobileBtnText, { color: colors.primary }]}>Add number</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* Address */}
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Area / Locality <Text style={styles.optional}>(Optional)</Text></Text>
                    <View style={styles.inputWrapper}>
                      <Icon name="map-marker-outline" size={18} color={colors.textSecondary} style={styles.inputIcon} />
                      <TextInput
                        placeholderTextColor={colors.placeholder}
                        style={styles.inputWithIcon}
                        value={customerAddress}
                        onChangeText={setCustomerAddress}
                        placeholder="e.g. Block B, Sector 4"
                      />
                    </View>
                  </View>

                  <View style={styles.fieldGroup}>
                    <CustomerCategoryField value={customerCategory} onChange={setCustomerCategory} />
                  </View>

                  {activeAction === 'booked' &&
                  isBulk &&
                  selectedPlots.length > 1 &&
                  normalizeCustomerCategory(customerCategory) === 'scholar' ? (
                    <View
                      style={[
                        styles.scholarBulkBanner,
                        {
                          borderColor: isDark ? '#059669' : '#a7f3d0',
                          backgroundColor: isDark ? 'rgba(5, 150, 105, 0.14)' : '#ecfdf5',
                        },
                      ]}
                    >
                      <Icon name="school" size={22} color="#059669" />
                      <View style={styles.scholarBulkBannerTextCol}>
                        <Text
                          style={[styles.scholarBulkBannerTitle, { color: isDark ? '#a7f3d0' : '#065f46' }]}
                        >
                          Scholar rate on one plot only
                        </Text>
                        <Text style={[styles.scholarBulkBannerSub, { color: colors.textSecondary }]}>
                          Plot No.{' '}
                          <Text style={{ fontWeight: '800', color: colors.text }}>
                            {selectedPlots.find((p) => String(p._id) === String(scholarDiscountPlotId))
                              ?.plotNumber ?? '—'}
                          </Text>{' '}
                          uses Alim / Hafiz advance in the confirmation; other plots use regular pricing.
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => setScholarPlotPickerVisible(true)}
                        style={[
                          styles.scholarBulkChangeBtn,
                          { borderColor: isDark ? '#059669' : '#34d399' },
                        ]}
                        accessibilityLabel="Choose which plot gets Alim Hafiz pricing"
                      >
                        <Text
                          style={[styles.scholarBulkChangeBtnText, { color: isDark ? '#a7f3d0' : '#047857' }]}
                        >
                          Change
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}

                  {/* Photo */}
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Customer Photo <Text style={styles.optional}>(Optional)</Text></Text>
                    <TouchableOpacity style={styles.cameraBtn} onPress={handleCamera}>
                      {photoLocalUri ? (
                        <Image source={{ uri: photoLocalUri }} style={styles.photoPreview} />
                      ) : (
                        <View style={styles.cameraPlaceholder}>
                          <Icon name="camera-outline" size={32} color={colors.placeholder} />
                          <Text style={styles.cameraText}>Tap to capture</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                    {photoLocalUri && (
                      <TouchableOpacity onPress={handleCamera} style={styles.retakeBtn}>
                        <Icon name="camera-retake-outline" size={14} color={colors.text} />
                        <Text style={styles.retakeBtnText}>  Retake Photo</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {activeAction === 'waiting' && (
                    <View style={styles.fieldGroup}>
                      <Text style={styles.fieldLabel}>Remarks <Text style={styles.optional}>(Optional)</Text></Text>
                      <TextInput
                        placeholderTextColor={colors.placeholder}
                        style={[styles.inputWrapper, styles.multilineInput, { paddingHorizontal: 14 }]}
                        value={remarks}
                        onChangeText={setRemarks}
                        placeholder="Notes about this waiting entry..."
                        multiline
                        numberOfLines={3}
                        textAlignVertical="top"
                      />
                    </View>
                  )}

                  {/* Payment — Booked only */}
                  {activeAction === 'booked' && (
                    <View style={styles.paymentCard}>
                      <View style={styles.paymentHeaderRow}>
                        <Icon name="cash-multiple" size={18} color={colors.text} />
                        <Text style={styles.paymentHeader}>  Payment Details</Text>
                      </View>

                      {/* Amount */}
                      <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>Advance / Booking Amount <Text style={styles.required}>*</Text></Text>
                        {isBulk && selectedPlots.length > 1 ? (
                          <Text style={[styles.fieldHint, { color: colors.textSecondary }]}>
                            Enter the total received for all {selectedPlots.length} plots. On submit, choose whether to
                            split it equally per plot or store the full amount on each.
                          </Text>
                        ) : null}
                        <View style={styles.inputWrapper}>
                          <Text style={styles.currencySymbol}>Rs.</Text>
                          <TextInput
                            placeholderTextColor={colors.placeholder}
                            style={[styles.inputWithIcon, { flex: 1 }]}
                            value={advanceAmount}
                            onChangeText={setAdvanceAmount}
                            placeholder="Enter amount"
                            keyboardType="numeric"
                          />
                        </View>
                        {!advanceAmount && !adminOverrideGranted && (
                          <TouchableOpacity onPress={() => setShowAdminOverride(!showAdminOverride)} style={styles.overrideLink}>
                            <Icon name="shield-key-outline" size={14} color="#e53935" />
                            <Text style={styles.overrideLinkText}>  No advance? Admin override</Text>
                          </TouchableOpacity>
                        )}
                        {adminOverrideGranted && (
                          <View style={styles.overrideGrantedRow}>
                            <Icon name="check-circle" size={14} color="#388e3c" />
                            <Text style={styles.overrideGranted}>  Override active</Text>
                          </View>
                        )}
                        {showAdminOverride && !adminOverrideGranted && (
                          <View style={styles.overrideBox}>
                            <Text style={styles.overrideLabel}>Admin Password</Text>
                            <View style={styles.mobileRow}>
                              <TextInput
                                placeholderTextColor={colors.placeholder}
                                style={[styles.inputWithIcon, { flex: 1, marginLeft: 0 }]}
                                value={adminPassword}
                                onChangeText={setAdminPassword}
                                placeholder="Enter password"
                                secureTextEntry
                              />
                              <TouchableOpacity onPress={checkAdminOverride} style={[styles.mobileActionBtn, styles.mobileAddBtn]}>
                                <Icon name="check" size={18} color="#fff" />
                              </TouchableOpacity>
                            </View>
                          </View>
                        )}
                      </View>

                      {/* Payment Mode */}
                      <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>Payment Mode <Text style={styles.required}>*</Text></Text>
                        <View style={styles.pillRow}>
                          {PAYMENT_MODES.map(mode => (
                            <TouchableOpacity
                              key={mode}
                              style={[styles.pill, paymentMode === mode && styles.pillActive]}
                              onPress={() => { setPaymentMode(mode); setPaymentTo(''); }}
                            >
                              <Text style={[styles.pillText, paymentMode === mode && styles.pillTextActive]}>{mode}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>

                      {/* Payment To */}
                      {paymentMode && (
                        <View style={styles.fieldGroup}>
                          <Text style={styles.fieldLabel}>{paymentToLabel(paymentMode)}</Text>
                          <View style={styles.inputWrapper}>
                            <Icon name="account-arrow-right-outline" size={18} color={colors.textSecondary} style={styles.inputIcon} />
                            <TextInput
                              placeholderTextColor={colors.placeholder}
                              style={styles.inputWithIcon}
                              value={paymentTo}
                              onChangeText={setPaymentTo}
                              placeholder={paymentToLabel(paymentMode)}
                            />
                          </View>
                        </View>
                      )}

                      <TouchableOpacity
                        style={styles.fullAdvanceRow}
                        onPress={() =>
                          confirmFullAdvanceToggle(!fullAdvanceReceived, {
                            advanceInput: advanceAmount,
                            categoryForPricing: customerCategory,
                          })
                        }
                        activeOpacity={0.85}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: fullAdvanceReceived }}
                        accessibilityLabel={COMPLETE_ADVANCE_RECEIVED_LABEL}
                      >
                        <Icon
                          name={fullAdvanceReceived ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'}
                          size={20}
                          color={fullAdvanceReceived ? '#2563eb' : colors.textSecondary}
                        />
                        <Text style={styles.fullAdvanceText}>{COMPLETE_ADVANCE_RECEIVED_LABEL}</Text>
                      </TouchableOpacity>

                      {/* Remarks */}
                      <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>Remarks <Text style={styles.optional}>(Optional)</Text></Text>
                        <TextInput
                          placeholderTextColor={colors.placeholder}
                          style={[styles.inputWrapper, styles.multilineInput, { paddingHorizontal: 14 }]}
                          value={remarks}
                          onChangeText={setRemarks}
                          placeholder="Comments..."
                          multiline
                          numberOfLines={3}
                          textAlignVertical="top"
                        />
                      </View>
                    </View>
                  )}

                  {/* Submit Row */}
                  <View style={styles.submitRow}>
                    <TouchableOpacity
                      style={styles.backBtn}
                      onPress={() => {
                        bookedFlowSourceRef.current = null;
                        setActiveAction(null);
                      }}
                    >
                      <Icon name="arrow-left" size={16} color={colors.textSecondary} />
                      <Text style={styles.backBtnText}>  Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.submitBtn, activeAction === 'booked' ? styles.bookedBtn : styles.waitingBtn]}
                      onPress={() => handleSubmit(activeAction)}
                      disabled={isSubmitting || isUploading}
                    >
                      {isSubmitting || isUploading ? (
                        <ActivityIndicator
                          color={activeAction === 'waiting' ? '#0f172a' : '#ffffff'}
                        />
                      ) : (
                        <Text
                          style={[
                            styles.submitBtnText,
                            activeAction === 'waiting' && styles.submitBtnTextOnYellow,
                          ]}
                        >
                          {activeAction === 'booked'
                            ? 'Confirm Booking'
                            : `Add ${nextWaitingOrdinal} waiting`}
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </>
              )}

              <View style={{ height: 8 }} />
            </ScrollView>
            {!activeAction && !readOnlyGuest && !transferStep && (
              <View
                style={[
                  styles.quickActionsFooter,
                  {
                    paddingBottom: Math.max(insets.bottom, 12),
                    borderTopColor: colors.border,
                    backgroundColor: isDark ? '#1a1a1a' : '#fafafa',
                  },
                ]}
              >
                <View style={[styles.actionRow, styles.quickActionsFooterInner]}>
                  <Text style={styles.sectionLabel}>Quick Actions</Text>
                  <View style={styles.actionButtons}>
                    {showOpenButton && (
                      <TouchableOpacity style={[styles.actionBtn, styles.openBtn]} onPress={handleOpenPress}>
                        <Icon name="home-outline" size={18} color="#0f172a" />
                        <Text style={styles.actionBtnTextDark}>OPEN</Text>
                      </TouchableOpacity>
                    )}
                    {showWaitlistAndBook && (
                      <TouchableOpacity style={[styles.actionBtn, styles.waitingBtn]} onPress={() => setActiveAction('waiting')}>
                        <Icon name="clock-outline" size={18} color="#0f172a" />
                        <Text style={styles.actionBtnTextDark} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
                          {isBulk ? 'Add Waiting' : `Add ${nextWaitingOrdinal} waiting`}
                        </Text>
                      </TouchableOpacity>
                    )}
                    {showFinalBookingQuickAction && (
                      <TouchableOpacity style={[styles.actionBtn, styles.bookedBtn]} onPress={onPressFinal}>
                        <Icon name="check-circle-outline" size={18} color="#fff" />
                        <Text style={styles.actionBtnText} numberOfLines={1}>Final</Text>
                      </TouchableOpacity>
                    )}
                    {showBmButton && (
                      <TouchableOpacity style={[styles.actionBtn, styles.bmBtn]} onPress={confirmBM}>
                        <Icon name="shield-lock-outline" size={18} color="#fff" />
                        <Text style={styles.actionBtnText} numberOfLines={1}>BM</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </View>
            )}
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>

    <Modal
      visible={Boolean(removeWaiterId && plot?._id)}
      transparent
      animationType="fade"
      onRequestClose={() => { if (!isRemoving) { setRemoveWaiterId(null); setRemoveWaiterReason(''); } }}
    >
      <View style={styles.removalOverlay}>
        <KeyboardAvoidingView behavior={keyboardAvoidingBehavior()} style={styles.removalKav}>
          <View style={[styles.removalSheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.removalTitle, { color: colors.text }]}>Remove from queue</Text>
            <Text style={[styles.removalSubtitle, { color: colors.textSecondary }]}>
              Enter why this person is being removed. This is stored in the activity log.
            </Text>
            <TextInput
              placeholderTextColor={colors.placeholder}
              style={[styles.removalInput, { borderColor: colors.border, color: colors.text }]}
              value={removeWaiterReason}
              onChangeText={setRemoveWaiterReason}
              placeholder="e.g. Booked elsewhere, not interested, duplicate entry…"
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              editable={!isRemoving}
            />
            <View style={styles.removalActions}>
              <TouchableOpacity
                style={[styles.removalBtnCancel, { borderColor: colors.border }]}
                onPress={() => { if (!isRemoving) { setRemoveWaiterId(null); setRemoveWaiterReason(''); } }}
                disabled={isRemoving}
              >
                <Text style={[styles.removalBtnCancelText, { color: colors.textSecondary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.removalBtnConfirm}
                onPress={confirmRemoveWaiter}
                disabled={isRemoving}
              >
                {isRemoving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.removalBtnConfirmText}>Remove</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>

    <Modal
      visible={Boolean(queueImagePreviewUri)}
      transparent
      animationType="fade"
      onRequestClose={() => setQueueImagePreviewUri(null)}
    >
      <Pressable
        style={styles.queueImagePreviewBackdrop}
        onPress={() => setQueueImagePreviewUri(null)}
        accessibilityRole="button"
        accessibilityLabel="Close full screen image"
      >
        <Image
          source={{ uri: queueImagePreviewUri || undefined }}
          style={styles.queueImagePreviewImage}
          resizeMode="contain"
        />
        <Text style={styles.queueImagePreviewHint}>Tap anywhere to close</Text>
      </Pressable>
    </Modal>

    <Modal
      visible={scholarPlotPickerVisible}
      transparent
      animationType="fade"
      onRequestClose={() => setScholarPlotPickerVisible(false)}
    >
      <Pressable style={styles.scholarPickerOverlay} onPress={() => setScholarPlotPickerVisible(false)}>
        <Pressable
          style={[styles.scholarPickerSheet, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.scholarPickerHeader}>
            <Icon name="school" size={24} color="#7c3aed" />
            <Text style={[styles.scholarPickerTitle, { color: colors.text }]}>Apply scholar rate</Text>
          </View>
          <Text style={[styles.scholarPickerSubtitle, { color: colors.textSecondary }]}>
            Discount applies to only 1 plot. Choose which plot should use Alim / Hafiz advance in confirmations:
          </Text>
          <ScrollView style={styles.scholarPickerList} keyboardShouldPersistTaps="handled">
            {selectedPlots.map((p) => {
              const isActive = String(scholarDiscountPlotId) === String(p._id);
              return (
                <TouchableOpacity
                  key={String(p._id)}
                  style={[
                    styles.scholarPickerItem,
                    { borderColor: colors.border, backgroundColor: isDark ? colors.background : '#f8fafc' },
                    isActive && {
                      borderColor: colors.primary,
                      backgroundColor: isDark ? 'rgba(59, 130, 246, 0.12)' : '#eff6ff',
                    },
                  ]}
                  onPress={() => {
                    setScholarDiscountPlotId(String(p._id));
                    setScholarPlotPickerVisible(false);
                  }}
                >
                  <View>
                    <Text style={[styles.scholarPickerPlotNo, { color: colors.text }]}>
                      Plot No. {p.plotNumber}
                    </Text>
                    <Text style={[styles.scholarPickerArea, { color: colors.textSecondary }]}>
                      {p.areaSqFt ? `${Number(p.areaSqFt).toLocaleString('en-IN')} sq ft` : '—'}
                    </Text>
                  </View>
                  {isActive ? <Icon name="check-circle" size={24} color="#059669" /> : null}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <TouchableOpacity
            style={styles.scholarPickerCancel}
            onPress={() => setScholarPlotPickerVisible(false)}
          >
            <Text style={[styles.scholarPickerCancelText, { color: colors.textSecondary }]}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>

    <Modal
      visible={Boolean(plot?._id && (editWaiterId || editBookingOpen))}
      transparent
      animationType="fade"
      onRequestClose={closeEditWaiter}
    >
      <View style={styles.removalOverlay}>
        <KeyboardAvoidingView behavior={keyboardAvoidingBehavior()} style={styles.removalKav}>
          <View style={[styles.removalSheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.removalTitle, { color: colors.text }]}>
              {editBookingOpen ? 'Edit Booking Details' : 'Edit Waiting Details'}
            </Text>
            <Text style={[styles.removalSubtitle, { color: colors.textSecondary }]}>
              {editBookingOpen
                ? 'Update customer, advance, payment, address, and notes for this booking.'
                : 'Same layout as Add Waiting — add/remove rows for extra numbers (up to 5).'}
            </Text>
            {!readOnlyGuest && (
              <TouchableOpacity
                style={[
                  styles.clipboardPasteBar,
                  { borderColor: colors.border, backgroundColor: isDark ? '#1e293b' : '#f1f5f9' },
                ]}
                onPress={() => { void pasteCustomerIntoEditSheet(); }}
                disabled={isEditingWaiter || isSavingBookingEdit}
                accessibilityRole="button"
                accessibilityLabel="Paste customer details from clipboard"
              >
                <Icon name="content-paste" size={18} color={colors.primary} />
                <Text style={[styles.clipboardPasteBarText, { color: colors.primary }]}>
                  Paste customer details
                </Text>
              </TouchableOpacity>
            )}

            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={styles.editWaiterScroll}
            >
              <Text style={[styles.fieldLabel, { marginLeft: 0 }]}>Customer Name</Text>
              <View style={[styles.inputWrapper, { marginBottom: 12 }]}>
                <Icon name="account-outline" size={18} color={colors.textSecondary} style={styles.inputIcon} />
                <TextInput
                  placeholderTextColor={colors.placeholder}
                  style={styles.inputWithIcon}
                  value={editWaiterName}
                  onChangeText={setEditWaiterName}
                  placeholder="Full Name"
                  editable={!isEditingWaiter && !isSavingBookingEdit}
                />
              </View>

              <Text style={[styles.fieldLabel, { marginLeft: 0 }]}>Contact Numbers</Text>
              {editWaiterMobiles.map((m, i) => (
                <View key={i} style={styles.mobileNumberEntry}>
                  <View style={styles.mobileNumberHeader}>
                    <Text style={[styles.mobileNumberLabel, { color: colors.textSecondary }]}>
                      Mobile {i + 1}
                    </Text>
                    {editWaiterMobiles.length > 1 && (
                      <TouchableOpacity
                        onPress={() => removeEditWaiterMobile(i)}
                        style={styles.mobileRemoveBtn}
                        disabled={isEditingWaiter || isSavingBookingEdit}
                      >
                        <Icon name="minus" size={15} color="#e53935" />
                      </TouchableOpacity>
                    )}
                  </View>
                  <MobileBoxInput
                    value={m}
                    onChange={(t) => updateEditWaiterMobile(t, i)}
                    colors={colors}
                    isDark={isDark}
                    editable={!isEditingWaiter && !isSavingBookingEdit}
                  />
                </View>
              ))}
              {editWaiterMobiles.length < 5 && (
                <TouchableOpacity
                  onPress={addEditWaiterMobile}
                  style={styles.addMobileBtn}
                  disabled={isEditingWaiter || isSavingBookingEdit}
                >
                  <Icon name="plus" size={15} color={colors.primary} />
                  <Text style={[styles.addMobileBtnText, { color: colors.primary }]}>Add number</Text>
                </TouchableOpacity>
              )}

              <Text style={[styles.fieldLabel, { marginLeft: 0 }]}>Area / Locality</Text>
              <View style={[styles.inputWrapper, { marginBottom: 12 }]}>
                <Icon name="map-marker-outline" size={18} color={colors.textSecondary} style={styles.inputIcon} />
                <TextInput
                  placeholderTextColor={colors.placeholder}
                  style={styles.inputWithIcon}
                  value={editWaiterAddress}
                  onChangeText={setEditWaiterAddress}
                  placeholder="e.g. Block B, Sector 4"
                  editable={!isEditingWaiter && !isSavingBookingEdit}
                />
              </View>

              <CustomerCategoryField
                value={editCustomerCategory}
                onChange={setEditCustomerCategory}
                disabled={isEditingWaiter || isSavingBookingEdit}
              />

              {plot?._id && editBookingOpen && plot.bookingDetails ? (
                <RemarkLogSection
                  entries={getRemarkEntries(plot.bookingDetails)}
                  readOnly={readOnlyGuest}
                  disabled={isSavingBookingEdit}
                  onAdd={async (text) => {
                    await api.post(`/${idForApiPath(plot._id)}/booking/remarks`, { text });
                    emitNoteActivity(
                      'booking',
                      false,
                      plot.bookingDetails.customerName,
                      text,
                    );
                  }}
                  onPatch={async (rid, text) => {
                    await api.patch(`/${idForApiPath(plot._id)}/booking/remarks/${rid}`, { text });
                    emitNoteActivity(
                      'booking',
                      true,
                      plot.bookingDetails.customerName,
                      text,
                    );
                  }}
                />
              ) : null}
              {plot?._id && editWaiterId && editingWaiterForNotes ? (
                <RemarkLogSection
                  entries={getRemarkEntries(editingWaiterForNotes)}
                  readOnly={readOnlyGuest}
                  disabled={isEditingWaiter}
                  onAdd={async (text) => {
                    await api.post(
                      `/${idForApiPath(plot._id)}/waiting/${idForApiPath(editWaiterId)}/remarks`,
                      { text },
                    );
                    emitNoteActivity(
                      'waiting',
                      false,
                      editingWaiterForNotes.customerName,
                      text,
                    );
                  }}
                  onPatch={async (rid, text) => {
                    await api.patch(
                      `/${idForApiPath(plot._id)}/waiting/${idForApiPath(editWaiterId)}/remarks/${rid}`,
                      { text },
                    );
                    emitNoteActivity(
                      'waiting',
                      true,
                      editingWaiterForNotes.customerName,
                      text,
                    );
                  }}
                />
              ) : null}

              {editBookingOpen ? (
                <View style={[styles.paymentCard, { marginTop: 8 }]}>
                  <View style={styles.paymentHeaderRow}>
                    <Icon name="cash-multiple" size={18} color={colors.text} />
                    <Text style={styles.paymentHeader}>  Payment Details</Text>
                  </View>
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>
                      Advance / Booking Amount <Text style={styles.required}>*</Text>
                    </Text>
                    <View style={styles.inputWrapper}>
                      <Text style={styles.currencySymbol}>Rs.</Text>
                      <TextInput
                        placeholderTextColor={colors.placeholder}
                        style={[styles.inputWithIcon, { flex: 1 }]}
                        value={editBookingAdvanceAmount}
                        onChangeText={setEditBookingAdvanceAmount}
                        placeholder="Enter amount (0 if none)"
                        keyboardType="numeric"
                        editable={!isSavingBookingEdit}
                      />
                    </View>
                  </View>
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>
                      Payment Mode <Text style={styles.required}>*</Text>
                    </Text>
                    <View style={styles.pillRow}>
                      {PAYMENT_MODES.map((mode) => (
                        <TouchableOpacity
                          key={mode}
                          style={[
                            styles.pill,
                            editBookingPaymentMode === mode && styles.pillActive,
                          ]}
                          onPress={() => {
                            setEditBookingPaymentMode(mode);
                            setEditBookingPaymentTo('');
                          }}
                          disabled={isSavingBookingEdit}
                        >
                          <Text
                            style={[
                              styles.pillText,
                              editBookingPaymentMode === mode && styles.pillTextActive,
                            ]}
                          >
                            {mode}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                  {editBookingPaymentMode ? (
                    <View style={styles.fieldGroup}>
                      <Text style={styles.fieldLabel}>{paymentToLabel(editBookingPaymentMode)}</Text>
                      <View style={styles.inputWrapper}>
                        <Icon
                          name="account-arrow-right-outline"
                          size={18}
                          color={colors.textSecondary}
                          style={styles.inputIcon}
                        />
                        <TextInput
                          placeholderTextColor={colors.placeholder}
                          style={styles.inputWithIcon}
                          value={editBookingPaymentTo}
                          onChangeText={setEditBookingPaymentTo}
                          placeholder={paymentToLabel(editBookingPaymentMode)}
                          editable={!isSavingBookingEdit}
                        />
                      </View>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </ScrollView>

            <View style={styles.removalActions}>
              <TouchableOpacity
                style={[styles.removalBtnCancel, { borderColor: colors.border }]}
                onPress={closeEditWaiter}
                disabled={isEditingWaiter || isSavingBookingEdit}
              >
                <Text style={[styles.removalBtnCancelText, { color: colors.textSecondary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.removalBtnSave}
                onPress={editBookingOpen ? saveEditBooking : saveEditWaiter}
                disabled={isEditingWaiter || isSavingBookingEdit}
              >
                {isEditingWaiter || isSavingBookingEdit ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.removalBtnConfirmText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>

    <RecordPaymentMarkCompleteModal
      visible={recordPaymentModalVisible}
      onRequestClose={closeRecordPaymentModal}
      summaryRow={recordPaymentSummaryRow}
      submitting={recordPaymentSubmitting}
      submittingAction={recordPaymentSubmittingAction}
      onConfirm={submitRecordPaymentFromModal}
    />
    </>
  );
};

const getStyles = (colors, isDark) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  kav: { width: '100%' },
  sheet: {
    backgroundColor: isDark ? '#1a1a1a' : '#fafafa',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    width: '100%',
    flexDirection: 'column',
    elevation: 20,
  },
  header: {
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingVertical: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  plotTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#f8fafc',
    letterSpacing: 0.3,
  },
  headerTransferFrom: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(248, 250, 252, 0.85)',
    letterSpacing: 0.2,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 3,
    borderRadius: 20,
  },
  statusRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusBadgeText: {
    fontWeight: '700',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  closeX: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bodyScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  bodyContent: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 8,
  },
  quickActionsFooter: {
    borderTopWidth: StyleSheet.hairlineWidth,
    flexShrink: 0,
  },
  quickActionsFooterInner: {
    marginBottom: 0,
    paddingTop: 4,
  },
  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
    elevation: 2,
  },
  bookedSummaryOuter: {
    marginBottom: 16,
  },
  /** Booked-plot customer card only: green tint so “booked” reads at a glance */
  bookedDetailsCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(74, 222, 128, 0.42)' : 'rgba(56, 142, 60, 0.4)',
    backgroundColor: isDark ? 'rgba(34, 197, 94, 0.14)' : 'rgba(76, 175, 80, 0.16)',
    overflow: 'hidden',
    marginBottom: 14,
  },
  bookedPhotoStrip: {
    backgroundColor: isDark ? 'rgba(34, 197, 94, 0.12)' : 'rgba(76, 175, 80, 0.22)',
  },
  summaryHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  summaryHeader: {
    fontWeight: '900',
    fontSize: 12,
    color: colors.text,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  metaText: { fontSize: 11, color: colors.textSecondary, fontWeight: '600' },
  summaryRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  summaryIcon: { marginTop: 2, marginRight: 8 },
  summaryValue: { fontSize: 15, color: colors.text, fontWeight: '600', flex: 1, lineHeight: 22 },
  divider: {
    height: 1.5,
    backgroundColor: isDark ? '#334155' : '#f0f0f0',
    marginVertical: 14,
  },
  existingPhoto: { width: 100, height: 100, borderRadius: 12, marginTop: 14, alignSelf: 'flex-start' },
  createdByText: {
    fontSize: 10,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  createdByRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    marginTop: 10,
    flexWrap: 'wrap',
  },
  
  // QUEUE STYLES (waiting list in modal)
  queueSectionTitle: {
    fontWeight: '900',
    fontSize: 15,
    color: colors.text,
    letterSpacing: 0.3,
    marginBottom: 14,
    textTransform: 'uppercase',
  },
  queueItem: { flexDirection: 'row', alignItems: 'stretch', gap: 10, marginBottom: 2 },
  queueLevel: { width: 36, alignItems: 'center', paddingTop: 6 },
  queueBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#f9a825',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  queueBadgeText: { color: '#0f172a', fontSize: 14, fontWeight: '900' },
  queueLine: {
    width: 3,
    flex: 1,
    minHeight: 16,
    backgroundColor: colors.border,
    marginVertical: 4,
    borderRadius: 2,
  },
  queueCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: isDark ? '#1e293b' : '#f8fafc',
    overflow: 'hidden',
    marginBottom: 14,
  },
  queuePhotoTouchable: {
    width: '100%',
    height: 120,
    backgroundColor: isDark ? '#0f172a' : '#e2e8f0',
  },
  queuePhotoTouchablePressed: { opacity: 0.9 },
  queuePhotoTop: { width: '100%', height: 120, resizeMode: 'cover' },
  queuePhotoOverlay: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 22,
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  queueCardInner: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14 },
  queueTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 8,
  },
  queueOrderText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.textSecondary,
    letterSpacing: 0.5,
    flex: 1,
  },
  queueFieldLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.65,
    marginTop: 2,
  },
  queueFieldLabelSpaced: { marginTop: 14 },
  queueFieldValue: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
    lineHeight: 24,
    marginTop: 5,
  },
  queueFieldValueMono: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: 0.4,
    flex: 1,
    lineHeight: 26,
  },
  queueMobileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    gap: 8,
  },
  queueActionIcons: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  queueIconBtn: { padding: 8, borderRadius: 12 },
  clipboardPasteBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    marginBottom: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  clipboardPasteBarText: {
    fontSize: 14,
    fontWeight: '700',
  },
  queueInlineCall: {
    minWidth: 48,
    minHeight: 48,
    paddingHorizontal: 10,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: isDark ? 'rgba(21,101,192,0.22)' : '#e3f2fd',
  },
  queuePaymentHint: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: 6,
  },
  queuePaymentHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 4,
  },
  queuePaymentMarkBtn: {
    padding: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(5, 150, 105, 0.45)' : '#a7f3d0',
    backgroundColor: isDark ? 'rgba(5, 150, 105, 0.12)' : '#ecfdf5',
  },
  queuePaymentText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    lineHeight: 21,
  },
  queueMetaFooter: {
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  queueMetaFooterRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    gap: 10,
  },
  queueMetaLeft: {
    flex: 1,
    minWidth: 0,
  },
  queueAddedWhen: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    lineHeight: 21,
  },
  queueAddedByRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 10,
    gap: 8,
  },
  queueAddedByLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  queueAddedByName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    flexShrink: 1,
  },
  makeFinalBtnCompact: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 8,
    width: 76,
    alignSelf: 'stretch',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#2e7d32',
    backgroundColor: isDark ? 'rgba(46, 125, 50, 0.18)' : '#e8f5e9',
    flexShrink: 0,
  },
  makeFinalBtnCompactText: {
    fontSize: 11,
    fontWeight: '800',
    color: isDark ? '#81c784' : '#1b5e20',
    letterSpacing: 0.2,
    textAlign: 'center',
    lineHeight: 14,
  },
  queueImagePreviewBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.94)',
    justifyContent: 'center',
    alignItems: 'stretch',
    paddingHorizontal: 8,
    paddingVertical: 36,
  },
  queueImagePreviewImage: {
    width: '100%',
    flex: 1,
    minHeight: 280,
  },
  queueImagePreviewHint: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 14,
    textAlign: 'center',
    paddingHorizontal: 16,
  },

  scholarBulkBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    marginBottom: 14,
  },
  scholarBulkBannerTextCol: { flex: 1, minWidth: 0 },
  scholarBulkBannerTitle: { fontSize: 13, fontWeight: '800' },
  scholarBulkBannerSub: { fontSize: 12, lineHeight: 17, marginTop: 3 },
  scholarBulkChangeBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    flexShrink: 0,
  },
  scholarBulkChangeBtnText: { fontSize: 12, fontWeight: '800' },

  scholarPickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  scholarPickerSheet: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    maxHeight: '78%',
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
  },
  scholarPickerHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  scholarPickerTitle: { fontSize: 17, fontWeight: '800' },
  scholarPickerSubtitle: { fontSize: 13, lineHeight: 19, marginBottom: 12 },
  scholarPickerList: { maxHeight: 340 },
  scholarPickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    marginBottom: 8,
  },
  scholarPickerPlotNo: { fontSize: 16, fontWeight: '800' },
  scholarPickerArea: { fontSize: 12, marginTop: 2 },
  scholarPickerCancel: { paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  scholarPickerCancelText: { fontSize: 15, fontWeight: '700' },

  transferPanel: {
    borderWidth: 1.5,
    borderRadius: 16,
    padding: 16,
    marginBottom: 18,
  },
  transferTitle: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 6,
  },
  transferSubtitle: {
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 16,
  },
  transferConfirmHint: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
    marginLeft: 2,
  },
  transferSubmitBtn: {
    backgroundColor: '#7c3aed',
  },
  transferMapPickIntro: {
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 14,
    marginLeft: 2,
  },
  transferMapPickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: 14,
    borderWidth: 1.5,
    marginBottom: 10,
  },
  transferMapPickBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#7c3aed',
  },
  transferMapPickMissing: {
    fontSize: 12,
    marginBottom: 8,
    marginLeft: 2,
  },

  removalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  removalKav: { width: '100%' },
  removalSheet: {
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    maxWidth: 400,
    alignSelf: 'center',
    width: '100%',
  },
  removalTitle: { fontSize: 18, fontWeight: '800', marginBottom: 6 },
  removalSubtitle: { fontSize: 13, lineHeight: 19, marginBottom: 14 },
  editWaiterScroll: { maxHeight: 420 },
  removalInput: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 100,
    fontSize: 15,
    marginBottom: 16,
  },
  removalActions: { flexDirection: 'row', gap: 12 },
  removalBtnCancel: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  removalBtnCancelText: { fontWeight: '800', fontSize: 15 },
  removalBtnConfirm: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#c62828',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removalBtnSave: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#1565c0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removalBtnConfirmText: { color: '#fff', fontWeight: '900', fontSize: 15 },

  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 16,
    marginLeft: 4,
  },
  actionRow: { marginBottom: 12 },
  actionButtons: { flexDirection: 'row', gap: 10 },
  actionBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    gap: 5,
    elevation: 2,
    shadowColor: colors.text,
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  actionBtnText: { fontWeight: '800', fontSize: 11, color: '#ffffff', textAlign: 'center', width: '100%' },
  actionBtnTextDark: { fontWeight: '800', fontSize: 11, color: '#0f172a', textAlign: 'center', width: '100%' },
  openBtn: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: isDark ? '#64748b' : '#1a1a2e',
  },
  openBtnSolid: {
    backgroundColor: '#ffeb3b',
    borderWidth: 0,
  },
  refundIntro: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 10,
    marginLeft: 4,
    lineHeight: 19,
  },
  refundHint: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: 12,
    marginLeft: 4,
  },
  // Mode picker shown when starting OPEN on a booked plot. Three stacked
  // actions with distinct colours before any inputs appear.
  vacateModeBox: {
    marginBottom: 14,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: isDark ? '#0f172a' : '#f8fafc',
  },
  vacateModeLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 10,
  },
  // Stacked full-width buttons so long labels wrap without truncation.
  vacateModeRow: {
    flexDirection: 'column',
    gap: 10,
  },
  vacateModeBtn: {
    width: '100%',
    alignSelf: 'stretch',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  /** Complete Refund — green */
  vacateModeBtnRefund: {
    borderColor: isDark ? '#047857' : '#34d399',
    backgroundColor: isDark ? '#064e3b' : '#ecfdf5',
  },
  vacateModeBtnRefundActive: {
    borderColor: isDark ? '#34d399' : '#059669',
    backgroundColor: isDark ? '#065f46' : '#d1fae5',
  },
  vacateModeBtnTextRefund: {
    color: isDark ? '#a7f3d0' : '#065f46',
  },
  vacateModeBtnTextRefundActive: {
    color: isDark ? '#ecfdf5' : '#064e3b',
  },
  /** Amount transfer — indigo */
  vacateModeBtnTransfer: {
    borderColor: isDark ? '#6366f1' : '#818cf8',
    backgroundColor: isDark ? '#1e1b4b' : '#eef2ff',
  },
  vacateModeBtnTransferActive: {
    borderColor: isDark ? '#a5b4fc' : '#4f46e5',
    backgroundColor: isDark ? '#312e81' : '#e0e7ff',
  },
  vacateModeBtnTextTransfer: {
    color: isDark ? '#c7d2fe' : '#3730a3',
  },
  vacateModeBtnTextTransferActive: {
    color: isDark ? '#eef2ff' : '#1e1b4b',
  },
  /** Partial refund + transfer — amber */
  vacateModeBtnBoth: {
    borderColor: isDark ? '#f59e0b' : '#fbbf24',
    backgroundColor: isDark ? '#78350f' : '#fffbeb',
  },
  vacateModeBtnBothActive: {
    borderColor: isDark ? '#fcd34d' : '#d97706',
    backgroundColor: isDark ? '#92400e' : '#fef3c7',
  },
  vacateModeBtnTextBoth: {
    color: isDark ? '#fde68a' : '#92400e',
  },
  vacateModeBtnTextBothActive: {
    color: isDark ? '#fffbeb' : '#78350f',
  },
  vacateModeBtnLabel: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 18,
    flexShrink: 1,
    width: '100%',
    alignSelf: 'stretch',
  },
  vacateModeHint: {
    marginTop: 8,
    fontSize: 12,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  waitingBtn: { backgroundColor: '#ffeb3b' },
  bookedBtn: { backgroundColor: '#2e7d32' },
  bmBtn: { backgroundColor: '#0ea5e9' },
  
  fieldGroup: { marginBottom: 18 },
  fieldLabel: { fontSize: 13, fontWeight: '800', color: colors.text, marginBottom: 8, marginLeft: 2 },
  fieldHint: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 8,
    marginLeft: 2,
    lineHeight: 17,
  },
  required: { color: '#d32f2f' },
  optional: { fontWeight: '400', color: colors.textSecondary, fontSize: 11 },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: isDark ? '#3f3f46' : '#eeeeee',
    borderRadius: 14,
    paddingHorizontal: 4,
  },
  inputIcon: { marginHorizontal: 12 },
  inputWithIcon: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
    paddingVertical: 12,
    fontWeight: '500',
  },
  currencySymbol: { fontSize: 14, fontWeight: '800', color: colors.textSecondary, marginHorizontal: 14 },
  mobileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 14,
    marginBottom: 10,
  },
  mobileActionBtn: {
    width: 44,
    height: 44,
    margin: 4,
    borderRadius: 12,
    backgroundColor: isDark ? '#2d1518' : '#fff5f5',
    borderWidth: 1,
    borderColor: isDark ? '#5c2a30' : '#ffebee',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mobileAddBtn: { backgroundColor: '#1a1a2e', borderColor: '#1a1a2e' },
  mobileNumberEntry: {
    marginBottom: 12,
  },
  mobileNumberHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  mobileNumberLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  mobileRemoveBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: isDark ? '#2d1518' : '#fff5f5',
    borderWidth: 1,
    borderColor: isDark ? '#5c2a30' : '#ffcdd2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addMobileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 2,
    marginTop: 2,
  },
  addMobileBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  cameraBtn: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderStyle: 'dashed',
    backgroundColor: isDark ? '#262626' : '#fdfdfd',
  },
  cameraPlaceholder: { height: 110, justifyContent: 'center', alignItems: 'center', gap: 10 },
  cameraText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  photoPreview: { width: '100%', height: 200, resizeMode: 'cover' },
  retakeBtn: { flexDirection: 'row', alignItems: 'center', marginTop: 10, alignSelf: 'flex-end' },
  retakeBtnText: { color: colors.primary, fontWeight: '800', fontSize: 13 },
  paymentCard: {
    backgroundColor: isDark ? '#1e293b' : '#f8faff',
    borderRadius: 18,
    padding: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: isDark ? '#334155' : '#e8efff',
  },
  transferCard: {
    backgroundColor: isDark ? '#1e1b4b' : '#f5f3ff',
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: isDark ? '#4338ca' : '#ddd6fe',
  },
  transferHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  transferHeader: {
    fontWeight: '900',
    fontSize: 16,
    color: colors.text,
    letterSpacing: 0.4,
    flex: 1,
  },
  transferActiveBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: isDark ? '#4338ca' : '#7c3aed',
  },
  transferActiveBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  transferIntro: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 10,
    lineHeight: 17,
  },
  transferTotalsBox: {
    backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#fff',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: isDark ? '#3730a3' : '#e9d5ff',
    marginBottom: 12,
  },
  transferTotalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 3,
  },
  transferTotalsRowEm: {
    borderTopWidth: 1,
    borderTopColor: isDark ? '#3730a3' : '#e9d5ff',
    marginTop: 4,
    paddingTop: 6,
  },
  transferTotalsLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  transferTotalsValue: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  transferTotalsLabelEm: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.text,
  },
  transferTotalsValueEm: {
    fontSize: 14,
    fontWeight: '900',
    color: '#7c3aed',
  },
  transferSplitHint: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: 6,
    fontStyle: 'italic',
  },
  transferDestCard: {
    borderWidth: 1,
    borderColor: isDark ? '#3730a3' : '#c4b5fd',
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    backgroundColor: isDark ? 'rgba(124,58,237,0.07)' : '#fff',
  },
  transferDestHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  transferDestTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 4,
  },
  transferDestTitle: {
    fontWeight: '900',
    fontSize: 15,
    color: colors.text,
  },
  transferDestStatusPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  transferDestStatusPillText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  transferBluePredict: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: isDark ? 'rgba(21,101,192,0.18)' : '#e3f2fd',
    gap: 3,
  },
  transferBluePredictText: {
    color: '#1565c0',
    fontWeight: '800',
    fontSize: 10,
  },
  transferDestSlice: {
    fontSize: 13,
    fontWeight: '800',
    color: '#7c3aed',
    marginTop: 2,
  },
  transferDestActionLine: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: 4,
    lineHeight: 16,
  },
  transferDestRemoveBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: isDark ? 'rgba(220,38,38,0.18)' : '#fee2e2',
    marginLeft: 6,
  },
  transferCustForm: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: isDark ? '#3730a3' : '#e9d5ff',
  },
  transferCustFormHint: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: 8,
    fontStyle: 'italic',
  },
  transferAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: isDark ? '#7c3aed' : '#a78bfa',
    backgroundColor: isDark ? 'rgba(124,58,237,0.10)' : 'rgba(124,58,237,0.06)',
  },
  transferAddBtnText: {
    fontWeight: '800',
    fontSize: 13,
  },
  paymentHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  paymentHeader: {
    fontWeight: '900',
    fontSize: 16,
    color: colors.text,
    letterSpacing: 0.5,
  },
  overrideLink: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  overrideLinkText: { color: '#d32f2f', fontSize: 12, fontWeight: '700' },
  overrideGrantedRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  overrideGranted: { color: '#43a047', fontWeight: '800', fontSize: 13 },
  overrideBox: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginTop: 12, borderWidth: 1, borderColor: '#ffe082' },
  overrideLabel: { fontWeight: '800', color: '#ff8f00', fontSize: 12, marginBottom: 10 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  pillActive: { borderColor: '#1a1a2e', backgroundColor: '#1a1a2e' },
  pillText: { fontSize: 13, color: colors.textSecondary, fontWeight: '700' },
  pillTextActive: { color: '#f8fafc' },
  fullAdvanceRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  fullAdvanceText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  multilineInput: {
    minHeight: 100,
    paddingTop: 14,
    paddingHorizontal: 16,
    color: colors.text,
  },
  submitRow: { flexDirection: 'row', gap: 12, marginTop: 12 },
  backBtn: { 
    flexDirection: 'row', alignItems: 'center', paddingVertical: 15, paddingHorizontal: 20,
    borderRadius: 16, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface
  },
  backBtnText: { color: colors.textSecondary, fontWeight: '800', fontSize: 14 },
  submitBtn: { flex: 1, paddingVertical: 15, borderRadius: 16, alignItems: 'center' },
  submitBtnText: { fontWeight: '900', fontSize: 15, color: '#ffffff' },
  submitBtnTextOnYellow: { color: '#0f172a' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerActionBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerActionBtnActive: {
    backgroundColor: '#2A9D8F',
  },
  historyContainer: {
    paddingBottom: 20,
  },
  historyHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  historyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
  emptyHistory: {
    textAlign: 'center',
    color: colors.textSecondary,
    marginVertical: 30,
    fontSize: 14,
  },
  historyItem: {
    flexDirection: 'row',
    gap: 15,
  },
  historyDotContainer: {
    width: 20,
    alignItems: 'center',
  },
  historyDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#2A9D8F',
    marginTop: 5,
  },
  historyLine: {
    width: 2,
    flex: 1,
    backgroundColor: colors.border,
    marginVertical: 5,
  },
  historyContent: {
    flex: 1,
    paddingBottom: 20,
  },
  historyItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  historyAction: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  historyTime: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  historyDetails: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 4,
  },
  historyByRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginTop: 4,
  },
  historyAvatar: { marginHorizontal: 4 },
  historyRefundBlock: { marginTop: 4 },
  historyRefundRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginTop: 8,
  },
  historyRefund: {
    fontSize: 12,
    color: colors.text,
    lineHeight: 17,
    fontWeight: '600',
  },
  historyBackBtn: {
    marginTop: 10,
    paddingVertical: 15,
    borderRadius: 12,
    backgroundColor: isDark ? '#334155' : '#f0f0f0',
    alignItems: 'center',
  },
  historyBackBtnText: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 14,
  },
});

export default BookingModal;
