import React, { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  TextInput,
  ScrollView,
  Platform,
  Modal,
  Linking,
  useWindowDimensions,
  Alert,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Share from 'react-native-share';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import RNFS from 'react-native-fs';
import ExcelJS from 'exceljs';
import { Buffer } from 'buffer';
import { useOnAppForeground } from '../hooks/useOnAppForeground';
import api from '../services/api';
import socket from '../services/socket';
import { useTheme } from '../context/ThemeContext';
import { useAlert } from '../context/AlertContext';
import { AuthContext } from '../context/AuthContext';
import { sendActivitySummaryMessage } from '../services/cometchatActivitySummary';
import {
  buildNoteActivitySummaryText,
  formatActivitySummaryTimestamp,
} from '../utils/activitySummaryMessages';
import { formatDateTime as formatDateTimeUtil, nameOnly } from '../utils/formatting';
import {
  getRemarkEntries,
  formatRemarkEntryAuditLines,
  formatRemarkLogForExport,
  remarkEntriesSearchBlob,
} from '../utils/remarkLog';
import { idForApiPath } from '../utils/mongoId';
import UserAvatar from '../components/UserAvatar';
import RemarkLogSection from '../components/RemarkLogSection';
import { labelForCustomerCategory, normalizeCustomerCategory } from '../utils/customerCategory';
import Orientation from 'react-native-orientation-locker';
import RecordPaymentMarkCompleteModal from '../components/RecordPaymentMarkCompleteModal';
import {
  balanceListRowFromBookedPlot,
  buildBalanceClearedRemark,
  buildBookingPatchBodyFromRow,
  formatRupeesInr,
  validateRecordPaymentPartial,
  validateRecordPaymentCompleteAdvance,
} from '../utils/bookingRecordPayment';

const normalizeDigits = (s) => String(s || '').replace(/\D/g, '');

function primaryMobileDigitsBooking(bd) {
  for (const m of bd?.customerMobiles || []) {
    const d = normalizeDigits(m);
    if (d) return d;
  }
  return '';
}

function tieBreakPlot(a, b) {
  return String(a.plotNumber).localeCompare(String(b.plotNumber), undefined, { numeric: true });
}

function rowMatchesSearch(row, qRaw) {
  const q = qRaw.trim();
  if (!q) return true;
  const qLower = q.toLowerCase();
  const plotNo = String(row.plotNumber || '').toLowerCase();
  if (plotNo.includes(qLower)) return true;
  const bd = row.bd;
  const name = (bd.customerName || '').toLowerCase();
  if (name.includes(qLower)) return true;
  const qDigits = normalizeDigits(q);
  const mobiles = bd.customerMobiles || [];
  for (const m of mobiles) {
    const raw = String(m).toLowerCase();
    if (raw.includes(qLower)) return true;
    if (qDigits.length >= 2 && normalizeDigits(m).includes(qDigits)) return true;
  }
  if (remarkEntriesSearchBlob(bd).includes(qLower)) return true;
  const catLabel = labelForCustomerCategory(bd.customerCategory).toLowerCase();
  if (catLabel.includes(qLower)) return true;
  // Only consider amount columns when the query actually contains digits.
  // Otherwise `String(amount).includes('')` (which is always true for a
  // non-numeric query like "ahmad") would match every booked row.
  if (qDigits.length >= 2) {
    const exp = row.expectedAmount;
    const paid = row.amountPaid;
    const bal = row.balanceAmount;
    if (exp != null && String(exp).includes(qDigits)) return true;
    if (paid != null && String(paid).includes(qDigits)) return true;
    if (bal != null && String(bal).includes(qDigits)) return true;
  }
  return false;
}

function customerGroupKeyFromBooking(bd) {
  const digits = (bd.customerMobiles || [])
    .map((m) => normalizeDigits(m))
    .filter(Boolean)
    .sort();
  if (digits.length) return `m:${digits.join('|')}`;
  return `n:${(bd.customerName || '').trim().toLowerCase()}`;
}

const TABLE_COL = {
  sr: 46,
  plot: 64,
  name: 176,
  mobile: 176,
  type: 92,
  address: 168,
  expected: 108,
  paid: 108,
  balance: 168,
  remarks: 236,
  added: 120,
  by: 112,
};

const DEFAULT_SORT_BY = 'plot';
const DEFAULT_SORT_DIR = 'asc';

const SORT_PRESETS = [
  { id: 'plot_asc', sortBy: 'plot', sortDir: 'asc', title: 'Plot number (low → high)', hint: 'Smaller plot numbers first.' },
  { id: 'plot_desc', sortBy: 'plot', sortDir: 'desc', title: 'Plot number (high → low)', hint: 'Larger plot numbers first.' },
  { id: 'name_asc', sortBy: 'name', sortDir: 'asc', title: 'Customer name (A → Z)', hint: 'Alphabetical by name.' },
  { id: 'name_desc', sortBy: 'name', sortDir: 'desc', title: 'Customer name (Z → A)', hint: 'Reverse alphabetical.' },
  { id: 'mobile_asc', sortBy: 'mobile', sortDir: 'asc', title: 'Contact (low → high)', hint: 'By first mobile digits. No number last.' },
  { id: 'mobile_desc', sortBy: 'mobile', sortDir: 'desc', title: 'Contact (high → low)', hint: 'By first mobile digits. No number last.' },
  { id: 'date_newest', sortBy: 'date', sortDir: 'desc', title: 'Booking newest first', hint: 'By booking record date.' },
  { id: 'date_oldest', sortBy: 'date', sortDir: 'asc', title: 'Booking oldest first', hint: 'By booking record date.' },
  { id: 'owner_asc', sortBy: 'owner', sortDir: 'asc', title: 'Booked by (A → Z)', hint: 'By who recorded the booking.' },
  { id: 'owner_desc', sortBy: 'owner', sortDir: 'desc', title: 'Booked by (Z → A)', hint: 'By who recorded the booking.' },
  { id: 'expected_asc', sortBy: 'expected', sortDir: 'asc', title: 'Expected advance (low → high)', hint: 'From pricing for customer type.' },
  { id: 'expected_desc', sortBy: 'expected', sortDir: 'desc', title: 'Expected advance (high → low)', hint: 'From pricing for customer type.' },
  { id: 'paid_asc', sortBy: 'paid', sortDir: 'asc', title: 'Amount paid (low → high)', hint: 'Booking advance received.' },
  { id: 'paid_desc', sortBy: 'paid', sortDir: 'desc', title: 'Amount paid (high → low)', hint: 'Booking advance received.' },
  { id: 'balance_asc', sortBy: 'balance', sortDir: 'asc', title: 'Balance due (low → high)', hint: 'Expected minus paid (positive = still due).' },
  { id: 'balance_desc', sortBy: 'balance', sortDir: 'desc', title: 'Balance due (high → low)', hint: 'Expected minus paid.' },
];

function presetIdFromSort(sortBy, sortDir) {
  const p = SORT_PRESETS.find((x) => x.sortBy === sortBy && x.sortDir === sortDir);
  return p?.id ?? 'plot_asc';
}

function sortSummaryLabel(sortBy, sortDir) {
  const p = SORT_PRESETS.find((x) => x.sortBy === sortBy && x.sortDir === sortDir);
  return p?.title ?? 'Plot number (low → high)';
}

const formatRupees = formatRupeesInr;

/** Same label as booking flow (BookingModal). */
const COMPLETE_ADVANCE_RECEIVED_LABEL = 'Complete Advance Received';

function exportBalanceDisplay(item) {
  if (
    item.bd.isFullAdvanceReceived ||
    (item.balanceAmount === 0 && item.expectedAmount != null && item.amountPaid != null)
  ) {
    return 'Complete';
  }
  if (item.balanceAmount != null) return item.balanceAmount;
  return '-';
}

const BalanceListScreen = () => {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => getStyles(colors, isDark), [colors, isDark]);
  const { showAlert } = useAlert();
  const { userInfo } = useContext(AuthContext);

  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isLandscape = windowWidth > windowHeight;
  const isLandscapeRef = useRef(isLandscape);
  isLandscapeRef.current = isLandscape;
  const manualFullscreenRef = useRef(false);

  const landscapeTableMinHeight = Math.max(280, windowHeight - insets.top - insets.bottom);

  const defaultTabBarStyle = useMemo(
    () => ({
      paddingBottom: 2,
      paddingTop: 2,
      height: 74,
      backgroundColor: colors.surface,
      borderTopColor: colors.border,
    }),
    [colors.surface, colors.border],
  );

  const tableWidth = useMemo(() => {
    const sum = Object.values(TABLE_COL).reduce((a, w) => a + w, 0);
    return Math.max(sum, windowWidth + 160);
  }, [windowWidth]);

  const [plots, setPlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  /** Row keys with expanded content (tap row to toggle). */
  const [expandedByRowId, setExpandedByRowId] = useState({});
  const [sortBy, setSortBy] = useState(DEFAULT_SORT_BY);
  const [sortDir, setSortDir] = useState(DEFAULT_SORT_DIR);
  const [sortModalVisible, setSortModalVisible] = useState(false);
  const [pendingPresetId, setPendingPresetId] = useState(() => presetIdFromSort(DEFAULT_SORT_BY, DEFAULT_SORT_DIR));
  const [sharing, setSharing] = useState(false);
  const [markingAdvancePlotId, setMarkingAdvancePlotId] = useState(null);
  const [markingAdvanceAction, setMarkingAdvanceAction] = useState(null);
  const [markAdvanceModalVisible, setMarkAdvanceModalVisible] = useState(false);
  const [markAdvanceRow, setMarkAdvanceRow] = useState(null);

  const notifyBookingNoteToCometchat = useCallback(
    ({ isUpdate, plotNumber, customerName, preview }) => {
      const actor = String(userInfo?.name || userInfo?.mobileNumber || 'User').trim();
      const at = formatActivitySummaryTimestamp();
      sendActivitySummaryMessage(
        buildNoteActivitySummaryText({
          kind: 'booking',
          isUpdate,
          plotNumber,
          customerName,
          preview,
          actor,
          at,
        }),
      ).catch(() => {});
    },
    [userInfo?.mobileNumber, userInfo?.name],
  );

  const toggleRowExpanded = useCallback((id) => {
    setExpandedByRowId((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = true;
      return next;
    });
  }, []);

  const openSortModal = useCallback(() => {
    setPendingPresetId(presetIdFromSort(sortBy, sortDir));
    setSortModalVisible(true);
  }, [sortBy, sortDir]);

  const closeSortModal = useCallback(() => setSortModalVisible(false), []);

  const applySortModal = useCallback(() => {
    const p = SORT_PRESETS.find((x) => x.id === pendingPresetId) || SORT_PRESETS[0];
    setSortBy(p.sortBy);
    setSortDir(p.sortDir);
    setSortModalVisible(false);
  }, [pendingPresetId]);

  const clearSortFilter = useCallback(() => {
    setSortBy(DEFAULT_SORT_BY);
    setSortDir(DEFAULT_SORT_DIR);
    setPendingPresetId(presetIdFromSort(DEFAULT_SORT_BY, DEFAULT_SORT_DIR));
    setSortModalVisible(false);
  }, []);

  const bookedRows = useMemo(() => {
    const rows = [];
    for (const plot of plots) {
      if (plot.status !== 'booked' || !plot.bookingDetails) continue;
      rows.push(balanceListRowFromBookedPlot(plot));
    }

    const dir = sortDir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      if (sortBy === 'plot') {
        const cmp = tieBreakPlot(a, b);
        return cmp * dir;
      }
      if (sortBy === 'name') {
        const na = (a.bd.customerName || '').trim();
        const nb = (b.bd.customerName || '').trim();
        const cmp = na.localeCompare(nb, undefined, { sensitivity: 'base' });
        if (cmp !== 0) return cmp * dir;
        return tieBreakPlot(a, b);
      }
      if (sortBy === 'mobile') {
        const ma = primaryMobileDigitsBooking(a.bd);
        const mb = primaryMobileDigitsBooking(b.bd);
        const aEmpty = !ma;
        const bEmpty = !mb;
        if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
        const cmp = ma.localeCompare(mb, undefined, { numeric: true });
        if (cmp !== 0) return cmp * dir;
        return tieBreakPlot(a, b);
      }
      if (sortBy === 'date') {
        const da = new Date(a.bd.createdAt || 0).getTime();
        const db = new Date(b.bd.createdAt || 0).getTime();
        const cmp = da - db;
        if (cmp !== 0) return cmp * dir;
        return tieBreakPlot(a, b);
      }
      if (sortBy === 'owner') {
        const aa = (a.bd.createdBy || '').toLowerCase();
        const ab = (b.bd.createdBy || '').toLowerCase();
        const cmp = aa.localeCompare(ab);
        if (cmp !== 0) return cmp * dir;
        return tieBreakPlot(a, b);
      }
      if (sortBy === 'expected') {
        const va = a.expectedAmount;
        const vb = b.expectedAmount;
        if (va == null && vb == null) return tieBreakPlot(a, b);
        if (va == null) return 1;
        if (vb == null) return -1;
        const cmp = va - vb;
        if (cmp !== 0) return cmp * dir;
        return tieBreakPlot(a, b);
      }
      if (sortBy === 'paid') {
        const va = a.amountPaid;
        const vb = b.amountPaid;
        if (va == null && vb == null) return tieBreakPlot(a, b);
        if (va == null) return 1;
        if (vb == null) return -1;
        const cmp = va - vb;
        if (cmp !== 0) return cmp * dir;
        return tieBreakPlot(a, b);
      }
      if (sortBy === 'balance') {
        const va = a.balanceAmount;
        const vb = b.balanceAmount;
        if (va == null && vb == null) return tieBreakPlot(a, b);
        if (va == null) return 1;
        if (vb == null) return -1;
        const cmp = va - vb;
        if (cmp !== 0) return cmp * dir;
        return tieBreakPlot(a, b);
      }
      return tieBreakPlot(a, b);
    });
    return rows;
  }, [plots, sortBy, sortDir]);

  const listSections = useMemo(() => {
    const q = searchQuery.trim();
    const filtered = q ? bookedRows.filter((row) => rowMatchesSearch(row, q)) : bookedRows;

    let sections;
    if (!q) {
      sections = [{ key: 'all', customerName: null, data: filtered }];
    } else {
      const map = new Map();
      for (const row of filtered) {
        const k = customerGroupKeyFromBooking(row.bd);
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(row);
      }
      const out = Array.from(map.entries()).map(([key, data]) => ({
        key,
        customerName: data[0]?.bd?.customerName || '-',
        data: data.slice().sort((a, b) => tieBreakPlot(a, b)),
      }));
      out.sort((a, b) =>
        String(a.customerName).localeCompare(String(b.customerName), undefined, { sensitivity: 'base' }),
      );
      sections = out.length === 0 ? [{ key: 'nomatch', customerName: null, data: [] }] : out;
    }

    let globalSr = 0;
    return sections.map((section) => ({
      ...section,
      data: section.data.map((row) => ({ ...row, globalSr: ++globalSr })),
    }));
  }, [bookedRows, searchQuery]);

  const listItemCount = useMemo(() => listSections.reduce((n, s) => n + s.data.length, 0), [listSections]);

  const displaySections = useMemo(() => {
    if (!isLandscape) return listSections;
    let globalSr = 0;
    const data = bookedRows.map((row) => ({ ...row, globalSr: ++globalSr }));
    return [{ key: 'all', customerName: null, data }];
  }, [isLandscape, listSections, bookedRows]);

  const displayItemCount = useMemo(
    () => displaySections.reduce((n, s) => n + s.data.length, 0),
    [displaySections],
  );

  const displayRows = useMemo(() => displaySections.flatMap((s) => s.data), [displaySections]);

  /** API returns `{ plot }` or a bare plot — normalize before merging into list state. */
  const mergePlotFromApi = useCallback((payload) => {
    const plot = payload?.plot ?? payload;
    if (!plot?._id) return;
    setPlots((prev) => prev.map((p) => (String(p._id) === String(plot._id) ? plot : p)));
  }, []);

  const closeMarkAdvanceModal = useCallback(() => {
    setMarkAdvanceModalVisible(false);
    setMarkAdvanceRow(null);
    setMarkingAdvanceAction(null);
  }, []);

  const openMarkAdvanceModal = useCallback(
    (row) => {
      const bd = row.bd;
      if (!bd || bd.isFullAdvanceReceived) return;
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
      setMarkAdvanceRow(row);
      setMarkAdvanceModalVisible(true);
    },
    [showAlert],
  );

  const submitMarkAdvanceFromModal = useCallback(
    async (form) => {
      const row = markAdvanceRow;
      if (!row) return;
      const action = form.action;
      if (action !== 'partial' && action !== 'complete') return;
      const v =
        action === 'partial'
          ? validateRecordPaymentPartial(row, form, showAlert)
          : validateRecordPaymentCompleteAdvance(row, form, showAlert);
      if (!v) return;

      const actorLabel = String(userInfo?.name || userInfo?.mobileNumber || 'User').trim();
      const recordedAt = formatDateTimeUtil(new Date());
      const bookedAt = row.bd?.createdAt ? new Date(row.bd.createdAt) : null;
      const bookingRecordedAtLabel =
        bookedAt && !Number.isNaN(bookedAt.getTime()) ? formatDateTimeUtil(bookedAt) : '—';
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

      const plotId = idForApiPath(row.plotId);
      setMarkingAdvancePlotId(String(row.plotId));
      setMarkingAdvanceAction(action);
      try {
        const patchBody = buildBookingPatchBodyFromRow(row, {
          isFullAdvanceReceived: action === 'complete',
          advanceAmount: v.newAdvance,
          paymentMode: v.paymentMode,
          paymentTo: v.paymentTo,
        });
        const patchRes = await api.patch(`/${plotId}/booking`, patchBody);
        const plotAfterPatch = patchRes.data?.plot ?? patchRes.data;
        if (!plotAfterPatch?._id) {
          showAlert('Error', 'Unexpected response from server.');
          return;
        }
        mergePlotFromApi(plotAfterPatch);

        try {
          const remarkRes = await api.post(`/${plotId}/booking/remarks`, { text: remarkText });
          mergePlotFromApi(remarkRes.data);
          notifyBookingNoteToCometchat({
            isUpdate: false,
            plotNumber: row.plotNumber,
            customerName: row.bd.customerName,
            preview: remarkText.slice(0, 220),
          });
        } catch (re) {
          showAlert(
            'Booking updated',
            `${action === 'complete' ? 'Advance marked complete' : 'Payment recorded'}, but the automatic note could not be saved: ${re.response?.data?.message || re.message || 'Unknown error'}. Add a remark manually if needed.`,
          );
        }
        closeMarkAdvanceModal();
      } catch (e) {
        showAlert('Error', e.response?.data?.message || 'Could not update booking.');
      } finally {
        setMarkingAdvancePlotId(null);
        setMarkingAdvanceAction(null);
      }
    },
    [
      markAdvanceRow,
      userInfo?.mobileNumber,
      userInfo?.name,
      showAlert,
      mergePlotFromApi,
      notifyBookingNoteToCometchat,
      closeMarkAdvanceModal,
    ],
  );

  const fetchPlots = useCallback(
    async (silent = false) => {
      try {
        if (!silent) setLoading(true);
        const res = await api.get('/');
        setPlots(Array.isArray(res.data) ? res.data : []);
      } catch (error) {
        showAlert('Error', error.response?.data?.message || 'Failed to load plots.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [showAlert],
  );

  useEffect(() => {
    socket.connect();
    const onPlotUpdated = (updatedPlot) => {
      if (!updatedPlot?._id) return;
      setPlots((prev) => prev.map((p) => (String(p._id) === String(updatedPlot._id) ? updatedPlot : p)));
    };
    socket.on('plotUpdated', onPlotUpdated);
    return () => socket.off('plotUpdated', onPlotUpdated);
  }, []);

  const tabBarHiddenStyle = useMemo(
    () =>
      Platform.select({
        android: {
          display: 'none',
          height: 0,
          minHeight: 0,
          borderTopWidth: 0,
          elevation: 0,
          opacity: 0,
          overflow: 'hidden',
        },
        default: {
          display: 'none',
          height: 0,
          borderTopWidth: 0,
          opacity: 0,
          overflow: 'hidden',
        },
      }),
    [],
  );

  const applyBalanceChrome = useCallback(() => {
    if (!navigation.isFocused()) return;
    if (isLandscapeRef.current) {
      navigation.setOptions({
        tabBarStyle: tabBarHiddenStyle,
        headerShown: false,
      });
    } else {
      navigation.setOptions({
        tabBarStyle: defaultTabBarStyle,
        headerShown: true,
      });
    }
  }, [navigation, defaultTabBarStyle, tabBarHiddenStyle]);

  useLayoutEffect(() => {
    applyBalanceChrome();
  }, [isLandscape, applyBalanceChrome]);

  useFocusEffect(
    useCallback(() => {
      fetchPlots(true);
      applyBalanceChrome();
      return () => {
        if (manualFullscreenRef.current) {
          manualFullscreenRef.current = false;
          Orientation.lockToPortrait();
        }
        navigation.setOptions({
          tabBarStyle: defaultTabBarStyle,
          headerShown: true,
        });
      };
    }, [fetchPlots, navigation, defaultTabBarStyle, applyBalanceChrome]),
  );

  useOnAppForeground(
    useCallback(() => {
      if (!socket.connected) socket.connect();
      fetchPlots(true);
    }, [fetchPlots]),
  );

  const toggleFullscreen = useCallback(() => {
    if (isLandscape) {
      manualFullscreenRef.current = false;
      Orientation.lockToPortrait();
      return;
    }
    manualFullscreenRef.current = true;
    Orientation.lockToLandscapeLeft();
  }, [isLandscape]);

  const isDefaultSort = sortBy === DEFAULT_SORT_BY && sortDir === DEFAULT_SORT_DIR;

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

  const toExportRows = useCallback(() => {
    return displayRows.map((item) => ({
      'Sr No': item.globalSr,
      'Plot No': item.plotNumber,
      Name: item.bd.customerName || '-',
      Type: labelForCustomerCategory(item.bd.customerCategory),
      Address: (item.bd.customerAddress || '').trim() || '-',
      Contact: (item.bd.customerMobiles || []).filter((m) => String(m).trim()).join(', ') || '-',
      'Expected advance': item.expectedAmount != null ? item.expectedAmount : '-',
      'Amount paid': item.amountPaid != null ? item.amountPaid : '-',
      Balance: exportBalanceDisplay(item),
      'Full advance marked': item.bd.isFullAdvanceReceived ? 'Yes' : 'No',
      Remarks: formatRemarkLogForExport(item.bd),
      Added: item.bd.createdAt ? formatDateTimeUtil(item.bd.createdAt) : '-',
      By: nameOnly(item.bd.createdBy),
    }));
  }, [displayRows]);

  const safePdfText = useCallback((input) => {
    return String(input ?? '')
      .replace(/\u202f/g, ' ')
      .replace(/\u00a0/g, ' ')
      .replace(/[^\x20-\x7E]/g, '?');
  }, []);

  const shareExcel = useCallback(async () => {
    const rows = toExportRows();
    if (rows.length === 0) {
      showAlert('Nothing to share', 'There are no booked plots in the current view.');
      return;
    }
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Balance List');
    sheet.columns = [
      { header: 'Sr No', key: 'Sr No', width: 8 },
      { header: 'Plot No', key: 'Plot No', width: 10 },
      { header: 'Name', key: 'Name', width: 24 },
      { header: 'Type', key: 'Type', width: 14 },
      { header: 'Address', key: 'Address', width: 28 },
      { header: 'Contact', key: 'Contact', width: 22 },
      { header: 'Expected advance', key: 'Expected advance', width: 16 },
      { header: 'Amount paid', key: 'Amount paid', width: 14 },
      { header: 'Balance', key: 'Balance', width: 14 },
      { header: 'Full advance marked', key: 'Full advance marked', width: 12 },
      { header: 'Remarks', key: 'Remarks', width: 32 },
      { header: 'Added', key: 'Added', width: 22 },
      { header: 'By', key: 'By', width: 18 },
    ];
    rows.forEach((row) => sheet.addRow(row));
    sheet.getRow(1).height = 24;
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF047857' } };
    const borderStyle = {
      top: { style: 'thin', color: { argb: 'FF7A7A7A' } },
      left: { style: 'thin', color: { argb: 'FF7A7A7A' } },
      bottom: { style: 'thin', color: { argb: 'FF7A7A7A' } },
      right: { style: 'thin', color: { argb: 'FF7A7A7A' } },
    };
    sheet.eachRow((row, rowNumber) => {
      row.height = rowNumber === 1 ? 24 : 20;
      row.eachCell((cell) => {
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = borderStyle;
        if (rowNumber !== 1) {
          cell.font = { size: 10, name: 'Calibri', color: { argb: 'FF111111' } };
        }
      });
    });
    const buffer = await workbook.xlsx.writeBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = RNFS.CachesDirectoryPath || RNFS.TemporaryDirectoryPath;
    const path = `${dir}/balance-list-${ts}.xlsx`;
    await RNFS.writeFile(path, base64, 'base64');
    await Share.open({
      title: 'Share Balance List (Excel)',
      filename: `balance-list-${ts}`,
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      url: `file://${path}`,
      failOnCancel: false,
    });
  }, [showAlert, toExportRows]);

  const sharePdf = useCallback(async () => {
    const rows = toExportRows();
    if (rows.length === 0) {
      showAlert('Nothing to share', 'There are no booked plots in the current view.');
      return;
    }
    const pdf = await PDFDocument.create();
    const pageSize = [842, 595];
    const marginX = 16;
    const marginTop = 16;
    const marginBottom = 16;
    const headerBandHeight = 36;
    const tableHeaderHeight = 20;
    const rowHeight = 18;
    const fontSize = 7;
    const titleSize = 11;
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const columns = [
      { key: 'Sr No', label: 'Sr', width: 28 },
      { key: 'Plot No', label: 'Plot', width: 36 },
      { key: 'Name', label: 'Name', width: 64 },
      { key: 'Type', label: 'Type', width: 40 },
      { key: 'Address', label: 'Addr', width: 56 },
      { key: 'Contact', label: 'Contact', width: 56 },
      { key: 'Expected advance', label: 'Exp', width: 52 },
      { key: 'Amount paid', label: 'Paid', width: 48 },
      { key: 'Balance', label: 'Bal', width: 48 },
      { key: 'By', label: 'By', width: 56 },
    ];
    const totalTableWidth = columns.reduce((n, c) => n + c.width, 0);
    const tableX = Math.max(marginX, (pageSize[0] - totalTableWidth) / 2);
    const truncateToWidth = (text, maxWidth, usedFont = font, usedSize = fontSize) => {
      let value = safePdfText(text);
      if (!value) return '-';
      if (usedFont.widthOfTextAtSize(value, usedSize) <= maxWidth) return value;
      while (value.length > 1 && usedFont.widthOfTextAtSize(`${value}...`, usedSize) > maxWidth) {
        value = value.slice(0, -1);
      }
      return `${value}...`;
    };
    const drawCell = (pg, x, y, width, height, text, opts = {}) => {
      const isHeader = !!opts.isHeader;
      pg.drawRectangle({
        x,
        y,
        width,
        height,
        borderWidth: 0.6,
        borderColor: rgb(0.5, 0.55, 0.5),
        color: isHeader ? rgb(0.9, 0.96, 0.92) : undefined,
      });
      const usedFont = isHeader ? fontBold : font;
      const usedSize = isHeader ? 7.5 : fontSize;
      const rendered = truncateToWidth(text, width - 4, usedFont, usedSize);
      pg.drawText(rendered, {
        x: x + 2,
        y: y + (height - usedSize) / 2,
        size: usedSize,
        font: usedFont,
        color: rgb(0.06, 0.09, 0.08),
      });
    };
    let page = pdf.addPage(pageSize);
    let cursorY = pageSize[1] - marginTop;
    const drawPageHeader = (pg) => {
      pg.drawText(`Balance List — Booked plots (${rows.length})`, {
        x: tableX,
        y: pageSize[1] - marginTop,
        size: titleSize,
        font: fontBold,
        color: rgb(0.02, 0.2, 0.12),
      });
    };
    const drawTableHeader = (pg, yTop) => {
      let x = tableX;
      const y = yTop - tableHeaderHeight;
      columns.forEach((col) => {
        drawCell(pg, x, y, col.width, tableHeaderHeight, col.label, { isHeader: true });
        x += col.width;
      });
      return y;
    };
    drawPageHeader(page);
    cursorY -= headerBandHeight;
    cursorY = drawTableHeader(page, cursorY);
    rows.forEach((r) => {
      if (cursorY - rowHeight < marginBottom) {
        page = pdf.addPage(pageSize);
        cursorY = pageSize[1] - marginTop;
        drawPageHeader(page);
        cursorY -= headerBandHeight;
        cursorY = drawTableHeader(page, cursorY);
      }
      const rowY = cursorY - rowHeight;
      let x = tableX;
      columns.forEach((col) => {
        const value = r[col.key] ?? '-';
        drawCell(page, x, rowY, col.width, rowHeight, String(value));
        x += col.width;
      });
      cursorY = rowY;
    });
    const base64 = await pdf.saveAsBase64({ dataUri: false });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const pdfDir = RNFS.CachesDirectoryPath || RNFS.TemporaryDirectoryPath;
    const pdfPath = `${pdfDir}/balance-list-${ts}.pdf`;
    await RNFS.writeFile(pdfPath, base64, 'base64');
    await Share.open({
      title: 'Share Balance List (PDF)',
      filename: `balance-list-${ts}`,
      type: 'application/pdf',
      url: `file://${pdfPath}`,
      failOnCancel: false,
    });
  }, [safePdfText, showAlert, toExportRows]);

  const onSharePress = useCallback(() => {
    if (sharing) return;
    Alert.alert('Share Balance List', 'Choose export format', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Share as PDF',
        onPress: async () => {
          try {
            setSharing(true);
            await sharePdf();
          } catch (error) {
            showAlert('Share failed', error?.message || 'Could not create PDF.');
          } finally {
            setSharing(false);
          }
        },
      },
      {
        text: 'Share as Excel',
        onPress: async () => {
          try {
            setSharing(true);
            await shareExcel();
          } catch (error) {
            showAlert('Share failed', error?.message || 'Could not create Excel file.');
          } finally {
            setSharing(false);
          }
        },
      },
    ]);
  }, [shareExcel, sharePdf, sharing, showAlert]);

  const balanceTextStyle = (bal) => {
    if (bal == null || Number.isNaN(bal)) return styles.balanceMuted;
    if (bal > 0) return styles.balanceDue;
    if (bal < 0) return styles.balanceCredit;
    return styles.balanceSettled;
  };

  const renderTableHeader = () => (
    <View style={[styles.headerRow, { width: tableWidth }]}>
      <View style={[styles.headerGridCell, { width: TABLE_COL.sr }]}>
        <Text style={styles.headerCell}>{'Sr.\nNo.'}</Text>
      </View>
      <View style={[styles.headerGridCell, { width: TABLE_COL.plot }]}>
        <Text style={styles.headerCell}>{'Plot\nNo.'}</Text>
      </View>
      <View style={[styles.headerGridCell, { width: TABLE_COL.name }]}>
        <Text style={styles.headerCell}>Name</Text>
      </View>
      <View style={[styles.headerGridCell, { width: TABLE_COL.type }]}>
        <Text style={styles.headerCell}>Type</Text>
      </View>
      <View style={[styles.headerGridCell, { width: TABLE_COL.address }]}>
        <Text style={styles.headerCell}>Address</Text>
      </View>
      <View style={[styles.headerGridCell, { width: TABLE_COL.mobile }]}>
        <Text style={styles.headerCell}>Contact</Text>
      </View>
      <View style={[styles.headerGridCell, { width: TABLE_COL.expected }]}>
        <Text style={styles.headerCell}>{'Expected\nadvance'}</Text>
      </View>
      <View style={[styles.headerGridCell, { width: TABLE_COL.paid }]}>
        <Text style={styles.headerCell}>{'Amount\npaid'}</Text>
      </View>
      <View style={[styles.headerGridCell, { width: TABLE_COL.balance }]}>
        <Text style={styles.headerCell}>Balance</Text>
      </View>
      <View style={[styles.headerGridCell, { width: TABLE_COL.remarks }]}>
        <Text style={styles.headerCell}>Remarks</Text>
      </View>
      <View style={[styles.headerGridCell, { width: TABLE_COL.added }]}>
        <Text style={styles.headerCell}>Booked</Text>
      </View>
      <View style={[styles.headerGridCell, styles.gridCellLast, { width: TABLE_COL.by }]}>
        <Text style={styles.headerCell}>By</Text>
      </View>
    </View>
  );

  const renderTableRow = ({ item }) => {
    const bd = item.bd;
    const mobiles = (bd.customerMobiles || []).filter((m) => String(m).trim());
    const addr = (bd.customerAddress || '').trim();
    const typeLabel = labelForCustomerCategory(bd.customerCategory);
    const remarkEntries = getRemarkEntries(bd);
    const added = bd.createdAt ? formatDateTimeUtil(bd.createdAt) : '-';
    const by = nameOnly(bd.createdBy);
    const rowId = String(item.plotId);
    const isExpanded = !!expandedByRowId[rowId];
    const isEven = (item.globalSr - 1) % 2 === 0;
    const nl = isExpanded ? undefined : 1;

    return (
      <Pressable
        onPress={() => toggleRowExpanded(rowId)}
        style={[
          styles.dataRow,
          { width: tableWidth },
          isEven ? styles.rowEven : styles.rowOdd,
          isExpanded && styles.rowExpanded,
          !isExpanded && styles.dataRowCollapsed,
        ]}
      >
        <View style={[styles.gridCell, { width: TABLE_COL.sr }]}>
          <Text style={[styles.cellText, styles.cellTextCenter]}>{item.globalSr}</Text>
        </View>
        <View style={[styles.gridCell, { width: TABLE_COL.plot }]}>
          <Text style={[styles.cellTextStrong, styles.cellTextCenter]}>{item.plotNumber}</Text>
        </View>
        <View style={[styles.gridCell, styles.tableCellCenteredCol, { width: TABLE_COL.name }]}>
          <Text style={[styles.cellText, styles.cellTextCenter]} numberOfLines={nl} ellipsizeMode="tail">
            {bd.customerName || '-'}
          </Text>
        </View>
        <View style={[styles.gridCell, styles.tableCellCenteredCol, { width: TABLE_COL.type }]}>
          <Text style={[styles.cellTextSmall, styles.cellTextCenter]} numberOfLines={2}>
            {typeLabel}
          </Text>
        </View>
        <View style={[styles.gridCell, styles.tableCellCenteredCol, { width: TABLE_COL.address }]}>
          <Text
            style={[addr ? styles.cellText : styles.cellTextMuted, styles.cellTextCenter]}
            numberOfLines={nl}
            ellipsizeMode="tail"
          >
            {addr || '—'}
          </Text>
        </View>
        <View style={[styles.gridCell, styles.tableCellCenteredCol, { width: TABLE_COL.mobile }]}>
          {mobiles.length === 0 ? (
            <Text style={[styles.cellTextMuted, styles.cellTextCenter]}>-</Text>
          ) : (
            mobiles.map((m, mi) => (
              <View key={mi} style={styles.mobileLine}>
                <Text
                  style={[styles.cellText, styles.mobileLineText, styles.cellTextCenter]}
                  numberOfLines={nl}
                  ellipsizeMode="tail"
                >
                  {m}
                </Text>
                <TouchableOpacity
                  onPress={() => dialPhone(m)}
                  style={styles.tableCallMini}
                  accessibilityLabel={`Call ${m}`}
                >
                  <Icon name="call" size={18} color={isDark ? '#a7f3d0' : '#047857'} />
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>
        <View style={[styles.gridCell, styles.tableCellCenteredCol, { width: TABLE_COL.expected }]}>
          <Text style={[styles.cellTextMono, styles.cellTextCenter]} numberOfLines={nl}>
            {formatRupees(item.expectedAmount)}
          </Text>
          {item.expectedAmount != null ? (
            <Text style={[styles.rateHint, styles.cellTextCenter]} numberOfLines={isExpanded ? undefined : 1}>
              {item.expectedRateLabel}
            </Text>
          ) : null}
        </View>
        <View style={[styles.gridCell, styles.tableCellCenteredCol, { width: TABLE_COL.paid }]}>
          <Text style={[styles.cellTextMono, styles.cellTextCenter]} numberOfLines={nl}>
            {formatRupees(item.amountPaid)}
          </Text>
        </View>
        <View style={[styles.gridCell, styles.tableCellCenteredCol, { width: TABLE_COL.balance }]}>
          {(() => {
            const flagged = !!bd.isFullAdvanceReceived;
            const computedSettled =
              item.balanceAmount != null &&
              item.balanceAmount === 0 &&
              item.expectedAmount != null &&
              item.amountPaid != null;
            const showComplete = flagged || computedSettled;
            const busy = markingAdvancePlotId === String(item.plotId);
            const auditBits = [
              bd.fullAdvanceReceivedAt ? formatDateTimeUtil(bd.fullAdvanceReceivedAt) : null,
              bd.fullAdvanceReceivedBy ? nameOnly(bd.fullAdvanceReceivedBy) : null,
            ].filter(Boolean);
            return (
              <View style={styles.balanceCellCol}>
                {showComplete ? (
                  <View style={styles.advanceCompleteWrap}>
                    <Icon name="check-circle" size={isExpanded ? 20 : 20} color="#059669" />
                    <Text
                      style={[styles.advanceCompleteLabel, styles.cellTextCenter]}
                      numberOfLines={isExpanded ? undefined : 1}
                    >
                      {COMPLETE_ADVANCE_RECEIVED_LABEL}
                    </Text>
                    {flagged && auditBits.length > 0 ? (
                      <Text
                        style={[styles.advanceCompleteMeta, styles.cellTextCenter]}
                        numberOfLines={isExpanded ? undefined : 1}
                      >
                        {auditBits.join(' · ')}
                      </Text>
                    ) : null}
                  </View>
                ) : (
                  <Text
                    style={[styles.cellTextMono, styles.cellTextCenter, balanceTextStyle(item.balanceAmount)]}
                    numberOfLines={nl}
                  >
                    {item.balanceAmount != null ? formatRupees(item.balanceAmount) : '—'}
                  </Text>
                )}
                {!flagged ? (
                  <TouchableOpacity
                    style={[
                      styles.markAdvanceBtn,
                      !isExpanded && styles.markAdvanceBtnCompact,
                      busy && styles.markAdvanceBtnDisabled,
                    ]}
                    onPress={() => openMarkAdvanceModal(item)}
                    disabled={busy}
                    activeOpacity={0.85}
                    accessibilityLabel="Mark complete advance received"
                  >
                    {busy ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={[styles.markAdvanceBtnText, !isExpanded && styles.markAdvanceBtnTextCollapsed]}>
                        {isExpanded ? 'Mark received' : 'Mark Received'}
                      </Text>
                    )}
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          })()}
        </View>
        <View style={[styles.gridCell, styles.remarksCellWithAdd, { width: TABLE_COL.remarks }]}>
          <View style={styles.remarksCellTextCol}>
            {remarkEntries.length === 0 ? (
              <Text style={[styles.cellTextMuted, styles.cellTextCenter]}>—</Text>
            ) : !isExpanded ? (
              <Text style={[styles.cellText, styles.cellTextCenter]} numberOfLines={1} ellipsizeMode="tail">
                {remarkEntries[0]?.text || '—'}
              </Text>
            ) : (
              remarkEntries.map((e, ei) => (
                <View key={e._id != null ? String(e._id) : `e-${ei}`} style={styles.remarksTableBlock}>
                  <Text style={[styles.cellText, styles.cellTextCenter]}>{e.text}</Text>
                  {formatRemarkEntryAuditLines(e).map((line, li) => (
                    <Text key={li} style={[styles.cellTextSmall, styles.cellTextCenter, styles.remarksUpdatedMuted]}>
                      {line}
                    </Text>
                  ))}
                </View>
              ))
            )}
          </View>
          {isExpanded ? (
            <RemarkLogSection
              listDisplay="addButtonOnly"
              entries={remarkEntries}
              readOnly={false}
              disabled={false}
              onAdd={async (text) => {
                const res = await api.post(`/${idForApiPath(item.plotId)}/booking/remarks`, { text });
                mergePlotFromApi(res.data);
                notifyBookingNoteToCometchat({
                  isUpdate: false,
                  plotNumber: item.plotNumber,
                  customerName: bd.customerName,
                  preview: text,
                });
              }}
              onPatch={async (rid, text) => {
                const res = await api.patch(`/${idForApiPath(item.plotId)}/booking/remarks/${rid}`, { text });
                mergePlotFromApi(res.data);
                notifyBookingNoteToCometchat({
                  isUpdate: true,
                  plotNumber: item.plotNumber,
                  customerName: bd.customerName,
                  preview: text,
                });
              }}
            />
          ) : null}
        </View>
        <View style={[styles.gridCell, styles.tableCellCenteredCol, { width: TABLE_COL.added }]}>
          <Text style={[styles.cellTextSmall, styles.cellTextCenter]} numberOfLines={nl}>
            {added}
          </Text>
        </View>
        <View style={[styles.gridCell, styles.gridCellLast, styles.byCell, { width: TABLE_COL.by }]}>
          <UserAvatar name={bd.createdBy} imageUrl={bd.createdByAvatarUrl} size={24} style={styles.byAvatar} />
          <Text
            style={[styles.cellTextSmall, styles.byName, styles.cellTextCenter]}
            numberOfLines={nl}
            ellipsizeMode="tail"
          >
            {by}
          </Text>
        </View>
      </Pressable>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#059669" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {!isLandscape ? (
        <>
          <View style={[styles.searchRow, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Icon name="search" size={22} color={colors.textSecondary} style={styles.searchIcon} />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              placeholder="Search name, mobile, plot, amounts…"
              placeholderTextColor={colors.placeholder}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="never"
            />
            <View style={styles.countPill}>
              <Text style={styles.countPillText}>
                {searchQuery.trim() ? listItemCount : bookedRows.length}
              </Text>
            </View>
            {searchQuery.length > 0 ? (
              <TouchableOpacity
                onPress={() => setSearchQuery('')}
                style={styles.searchClear}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Icon name="close" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            ) : null}
          </View>

          <View style={styles.sortRow}>
            <View style={styles.sortOpenBtnOuter}>
              <TouchableOpacity
                style={[styles.sortOpenBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
                onPress={openSortModal}
                activeOpacity={0.85}
              >
                <Icon name="sort" size={20} color="#059669" />
                <View style={styles.sortOpenBtnTextWrap}>
                  <Text style={[styles.sortOpenBtnLabel, { color: colors.textSecondary }]}>Sort list</Text>
                  <Text style={[styles.sortOpenBtnValue, { color: colors.text }]} numberOfLines={2}>
                    {sortSummaryLabel(sortBy, sortDir)}
                  </Text>
                </View>
                <Icon name="chevron-right" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[
                styles.sortRemoveFilterBtn,
                { borderColor: colors.border, backgroundColor: colors.surface },
                isDefaultSort && styles.sortRemoveFilterBtnDisabled,
              ]}
              onPress={clearSortFilter}
              disabled={isDefaultSort}
              activeOpacity={0.85}
            >
              <Icon name="undo" size={18} color={isDefaultSort ? colors.textSecondary : '#059669'} />
              <Text
                style={[
                  styles.sortRemoveFilterBtnText,
                  { color: isDefaultSort ? colors.textSecondary : colors.text },
                ]}
                numberOfLines={2}
              >
                Remove filter
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.shareIconBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
              onPress={onSharePress}
              disabled={sharing}
              activeOpacity={0.85}
            >
              {sharing ? (
                <ActivityIndicator size="small" color="#059669" />
              ) : (
                <Icon name="share" size={19} color="#059669" />
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.shareIconBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
              onPress={toggleFullscreen}
              activeOpacity={0.85}
            >
              <Icon name={isLandscape ? 'fullscreen-exit' : 'fullscreen'} size={19} color="#059669" />
            </TouchableOpacity>
          </View>
        </>
      ) : null}

      {isLandscape ? (
        <SafeAreaView style={[styles.landscapeTableSafe, { backgroundColor: colors.background }]} edges={['top', 'left', 'right', 'bottom']}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator
            nestedScrollEnabled
            style={[styles.horizontalTableHost, styles.horizontalTableHostLandscape]}
            contentContainerStyle={styles.horizontalTableContent}
          >
            <View
              style={[
                styles.tableWrapper,
                styles.tableWrapperLandscape,
                { width: tableWidth, minHeight: landscapeTableMinHeight },
              ]}
            >
              <SectionList
                sections={displaySections}
                keyExtractor={(item) => String(item.plotId)}
                extraData={{ expandedByRowId, markingAdvancePlotId }}
                renderItem={({ item }) => renderTableRow({ item })}
                renderSectionHeader={() => renderTableHeader()}
                stickySectionHeadersEnabled
                style={{ flex: 1, width: tableWidth }}
                contentContainerStyle={[styles.listContent, styles.listContentLandscape]}
                onRefresh={() => {
                  setRefreshing(true);
                  fetchPlots(true);
                }}
                refreshing={refreshing}
                ListEmptyComponent={
                  displayItemCount === 0 ? (
                    <View style={[styles.empty, { width: Math.min(windowWidth - 8, tableWidth) }]}>
                      <Text style={styles.emptyText}>No booked plots.</Text>
                      <Text style={styles.emptySubText}>Final bookings appear here with balance at a glance.</Text>
                    </View>
                  ) : null
                }
              />
            </View>
          </ScrollView>
        </SafeAreaView>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator
          nestedScrollEnabled
          style={styles.horizontalTableHost}
          contentContainerStyle={styles.horizontalTableContent}
        >
          <View style={[styles.tableWrapper, { width: tableWidth }]}>
            <SectionList
              sections={displaySections}
              keyExtractor={(item) => String(item.plotId)}
              extraData={{ expandedByRowId, markingAdvancePlotId }}
              renderItem={({ item }) => renderTableRow({ item })}
              renderSectionHeader={({ section }) => {
                if (!section.customerName || !searchQuery.trim()) {
                  return renderTableHeader();
                }
                const n = section.data.length;
                return (
                  <View
                    style={[
                      styles.searchSectionHeader,
                      { borderBottomColor: colors.border, backgroundColor: colors.background, width: tableWidth },
                    ]}
                  >
                    <Text style={[styles.searchSectionName, { color: colors.text }]}>{section.customerName}</Text>
                    <Text style={[styles.searchSectionMeta, { color: colors.textSecondary }]}>
                      Booked on {n} plot{n !== 1 ? 's' : ''}
                    </Text>
                    {renderTableHeader()}
                  </View>
                );
              }}
              stickySectionHeadersEnabled
              style={{ flex: 1, width: tableWidth }}
              contentContainerStyle={styles.listContent}
              onRefresh={() => {
                setRefreshing(true);
                fetchPlots(true);
              }}
              refreshing={refreshing}
              ListEmptyComponent={
                displayItemCount === 0 ? (
                  <View style={[styles.empty, { width: Math.min(windowWidth - 28, tableWidth) }]}>
                    <Text style={styles.emptyText}>
                      {searchQuery.trim()
                        ? `No matches for "${searchQuery.trim()}"`
                        : 'No booked plots in the list.'}
                    </Text>
                    <Text style={styles.emptySubText}>
                      {searchQuery.trim()
                        ? 'Try another spelling or part of a mobile number.'
                        : 'Plots move here when status is booked.'}
                    </Text>
                  </View>
                ) : null
              }
            />
          </View>
        </ScrollView>
      )}

      {isLandscape ? (
        <TouchableOpacity
          style={[styles.fullscreenFab, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={toggleFullscreen}
          activeOpacity={0.9}
        >
          <Icon name={isLandscape ? 'fullscreen-exit' : 'fullscreen'} size={20} color="#059669" />
        </TouchableOpacity>
      ) : null}

      <RecordPaymentMarkCompleteModal
        visible={markAdvanceModalVisible}
        onRequestClose={closeMarkAdvanceModal}
        summaryRow={markAdvanceRow}
        submitting={!!markingAdvancePlotId}
        submittingAction={markingAdvanceAction}
        onConfirm={submitMarkAdvanceFromModal}
      />

      <Modal visible={sortModalVisible} transparent animationType="fade" onRequestClose={closeSortModal}>
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeSortModal} />
          <View style={[styles.sortModalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sortModalTitle, { color: colors.text }]}>Sort balance list</Text>
            <Text style={[styles.sortModalSubtitle, { color: colors.textSecondary }]}>
              Choose order, then Apply. Remove filter resets to plot number (low → high).
            </Text>
            <ScrollView style={styles.sortModalScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator>
              {SORT_PRESETS.map((opt) => {
                const selected = pendingPresetId === opt.id;
                return (
                  <Pressable
                    key={opt.id}
                    onPress={() => setPendingPresetId(opt.id)}
                    style={[
                      styles.sortOptionRow,
                      {
                        borderColor: selected ? '#059669' : colors.border,
                        backgroundColor: selected
                          ? isDark
                            ? 'rgba(5, 150, 105, 0.2)'
                            : '#ecfdf5'
                          : isDark
                            ? colors.background
                            : '#f8fafc',
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.sortOptionRadio,
                        {
                          borderColor: selected ? '#059669' : colors.textSecondary,
                          backgroundColor: selected ? '#059669' : 'transparent',
                        },
                      ]}
                    >
                      {selected ? <Icon name="check" size={14} color="#fff" /> : null}
                    </View>
                    <View style={styles.sortOptionTextCol}>
                      <Text style={[styles.sortOptionTitle, { color: colors.text }]}>{opt.title}</Text>
                      <Text style={[styles.sortOptionHint, { color: colors.textSecondary }]}>{opt.hint}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={styles.sortModalActions}>
              <TouchableOpacity
                style={[styles.sortModalSecondaryBtn, { borderColor: colors.border }]}
                onPress={clearSortFilter}
              >
                <Text style={[styles.sortModalSecondaryBtnText, { color: colors.textSecondary }]}>Remove filter</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.sortModalPrimaryBtn} onPress={applySortModal}>
                <Text style={styles.sortModalPrimaryBtnText}>Apply</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const getStyles = (colors, isDark) => {
  const borderGrid = isDark ? '#166534' : '#bbf7d0';
  const headerBg = isDark ? '#064e3b' : '#047857';
  const headerBorder = isDark ? '#34d399' : '#065f46';
  const rowEven = isDark ? '#052e16' : '#f0fdf4';
  const rowOdd = isDark ? '#064e3b' : '#ecfdf5';
  const accent = '#059669';
  /** Table sits on deep green rows — use high-contrast light text in dark mode (not theme gray). */
  const tableText = isDark ? '#f8fafc' : '#0f172a';
  const tableTextStrong = isDark ? '#ffffff' : '#064e3b';
  const tableTextSecondary = isDark ? '#e2e8f0' : '#1e293b';
  const tableTextMuted = isDark ? '#cbd5e1' : '#64748b';

  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

    countPill: {
      minWidth: 34,
      height: 28,
      borderRadius: 14,
      backgroundColor: accent,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 8,
      marginLeft: 6,
    },
    countPillText: { color: '#fff', fontWeight: '900', fontSize: isDark ? 14 : 13 },

    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: 14,
      marginTop: 10,
      marginBottom: 8,
      borderRadius: 14,
      borderWidth: 1.5,
      paddingHorizontal: 10,
      minHeight: 48,
    },
    searchIcon: { marginRight: 4 },
    searchInput: {
      flex: 1,
      fontSize: isDark ? 17 : 16,
      paddingVertical: Platform.OS === 'ios' ? 12 : 10,
      fontWeight: '500',
    },
    searchClear: { padding: 6 },

    sortRow: {
      flexDirection: 'row',
      alignItems: 'stretch',
      gap: 10,
      paddingHorizontal: 14,
      marginBottom: 10,
    },
    shareIconBtn: {
      width: 50,
      borderRadius: 14,
      borderWidth: 1.5,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sortOpenBtnOuter: { flex: 3, minWidth: 0 },
    sortOpenBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: 14,
      borderWidth: 1.5,
      paddingVertical: 10,
      paddingHorizontal: 12,
      gap: 10,
    },
    sortRemoveFilterBtn: {
      flex: 1,
      minWidth: 0,
      borderRadius: 14,
      borderWidth: 1.5,
      paddingVertical: 8,
      paddingHorizontal: 6,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
    },
    sortRemoveFilterBtnDisabled: { opacity: 0.5 },
    sortRemoveFilterBtnText: {
      fontSize: 11,
      fontWeight: '800',
      textAlign: 'center',
      lineHeight: 14,
      textTransform: 'uppercase',
      letterSpacing: 0.35,
    },
    sortOpenBtnTextWrap: { flex: 1 },
    sortOpenBtnLabel: {
      fontSize: 11,
      fontWeight: '800',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginBottom: 2,
    },
    sortOpenBtnValue: { fontSize: 15, fontWeight: '700', lineHeight: 20 },

    horizontalTableHost: { flex: 1, marginHorizontal: 14 },
    horizontalTableHostLandscape: { flex: 1, marginHorizontal: 0 },
    horizontalTableContent: { flexGrow: 1 },
    tableWrapper: { flex: 1, minHeight: 200 },
    tableWrapperLandscape: { flex: 1 },
    listContent: { paddingVertical: 4, paddingBottom: 28 },
    listContentLandscape: { paddingVertical: 2, paddingBottom: 8, flexGrow: 1 },
    landscapeTableSafe: { flex: 1 },

    headerRow: {
      flexDirection: 'row',
      alignItems: 'stretch',
      backgroundColor: headerBg,
      minHeight: isDark ? 88 : 80,
      borderBottomWidth: 2,
      borderBottomColor: headerBorder,
    },
    headerGridCell: {
      justifyContent: 'center',
      alignItems: 'center',
      borderRightWidth: 1,
      borderRightColor: isDark ? '#047857' : '#065f46',
      paddingVertical: 6,
      paddingHorizontal: 2,
    },
    headerCell: {
      fontSize: isDark ? 13 : 12,
      fontWeight: '800',
      color: '#f0fdf4',
      textAlign: 'center',
      textTransform: 'uppercase',
      letterSpacing: 0.45,
      lineHeight: isDark ? 17 : 15,
    },

    dataRow: {
      flexDirection: 'row',
      alignItems: 'stretch',
      borderBottomWidth: 1,
      borderBottomColor: borderGrid,
    },
    dataRowCollapsed: {
      height: 60,
      maxHeight: 60,
      overflow: 'hidden',
    },
    rowExpanded: {
      minHeight: isDark ? 78 : 72,
      backgroundColor: isDark ? 'rgba(16, 185, 129, 0.1)' : 'rgba(16, 185, 129, 0.07)',
    },
    rowEven: { backgroundColor: rowEven },
    rowOdd: { backgroundColor: rowOdd },

    gridCell: {
      justifyContent: 'center',
      alignItems: 'center',
      borderRightWidth: 1,
      borderRightColor: borderGrid,
      paddingVertical: 8,
      paddingHorizontal: 4,
    },
    gridCellLast: { borderRightWidth: 0 },

    cellText: {
      color: tableText,
      fontSize: isDark ? 17 : 16,
      fontWeight: '600',
      lineHeight: isDark ? 24 : 22,
    },
    cellTextStrong: {
      color: tableTextStrong,
      fontSize: isDark ? 19 : 17,
      fontWeight: '800',
    },
    cellTextSmall: {
      color: tableTextSecondary,
      fontSize: isDark ? 15 : 14,
      fontWeight: '600',
      lineHeight: isDark ? 21 : 19,
    },
    cellTextMuted: {
      color: tableTextMuted,
      fontSize: isDark ? 16 : 15,
      fontWeight: '600',
    },
    cellTextMono: {
      color: tableText,
      fontSize: isDark ? 17 : 16,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
    },
    cellTextCenter: { textAlign: 'center', alignSelf: 'stretch' },
    rateHint: {
      fontSize: isDark ? 12 : 11,
      fontWeight: '700',
      color: isDark ? '#a7f3d0' : '#047857',
      marginTop: 2,
    },
    balanceDue: { color: isDark ? '#fed7aa' : '#c2410c' },
    balanceSettled: { color: isDark ? '#a7f3d0' : '#047857' },
    balanceCredit: { color: isDark ? '#bfdbfe' : '#1d4ed8' },
    balanceMuted: { color: tableTextMuted },

    balanceCellCol: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 4,
      gap: 6,
      width: '100%',
    },
    advanceCompleteWrap: { alignItems: 'center', gap: 4, paddingHorizontal: 2 },
    advanceCompleteLabel: {
      color: tableText,
      fontSize: isDark ? 12 : 11,
      fontWeight: '800',
      textAlign: 'center',
      lineHeight: isDark ? 16 : 15,
    },
    advanceCompleteMeta: {
      color: tableTextMuted,
      fontSize: isDark ? 11 : 10,
      fontWeight: '600',
      textAlign: 'center',
    },
    markAdvanceBtn: {
      marginTop: 2,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 10,
      backgroundColor: accent,
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 108,
    },
    markAdvanceBtnDisabled: { opacity: 0.65 },
    markAdvanceBtnText: { color: '#fff', fontWeight: '800', fontSize: 12 },
    markAdvanceBtnCompact: {
      marginTop: 0,
      paddingVertical: 6,
      paddingHorizontal: 12,
      minWidth: 132,
    },
    /** Collapsed row: full label, slightly tighter than expanded default button. */
    markAdvanceBtnTextCollapsed: { fontSize: 11, letterSpacing: 0.2 },

    tableCellCenteredCol: { alignItems: 'center', justifyContent: 'center' },
    mobileLine: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      flexWrap: 'wrap',
      gap: 5,
      marginBottom: 3,
      width: '100%',
    },
    mobileLineText: { flexShrink: 1, maxWidth: '78%' },
    tableCallMini: {
      width: 32,
      height: 32,
      borderRadius: 9,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? 'rgba(5, 150, 105, 0.25)' : '#d1fae5',
      flexShrink: 0,
    },
    remarksCellWithAdd: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingVertical: 4 },
    remarksCellTextCol: { flex: 1, minWidth: 0 },
    remarksTableBlock: { marginBottom: 8, width: '100%' },
    remarksUpdatedMuted: {
      color: tableTextMuted,
      marginTop: 4,
      fontStyle: 'italic',
      fontSize: isDark ? 13 : 12,
      lineHeight: isDark ? 18 : 16,
    },
    byCell: { flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 },
    byAvatar: { flexShrink: 0 },
    byName: { width: '100%' },

    searchSectionHeader: {
      paddingVertical: 10,
      paddingHorizontal: 4,
      marginBottom: 6,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    searchSectionName: { fontSize: isDark ? 18 : 16, fontWeight: '800' },
    searchSectionMeta: { marginTop: 2, fontSize: isDark ? 14 : 12, fontWeight: '700' },

    empty: { paddingTop: 80, alignItems: 'center', paddingHorizontal: 20 },
    emptyText: { fontSize: isDark ? 19 : 17, color: colors.text, fontWeight: '800' },
    emptySubText: {
      marginTop: 8,
      textAlign: 'center',
      fontSize: isDark ? 16 : 14,
      color: isDark ? '#cbd5e1' : colors.textSecondary,
      lineHeight: isDark ? 22 : 20,
    },

    fullscreenFab: {
      position: 'absolute',
      top: 10,
      right: 10,
      width: 42,
      height: 42,
      borderRadius: 12,
      borderWidth: 1.5,
      alignItems: 'center',
      justifyContent: 'center',
      ...Platform.select({
        android: { elevation: 4 },
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 3 },
          shadowOpacity: 0.16,
          shadowRadius: 6,
        },
      }),
    },

    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      justifyContent: 'center',
      paddingHorizontal: 22,
    },
    sortModalCard: {
      borderRadius: 16,
      borderWidth: 1,
      padding: 18,
      maxWidth: 440,
      width: '100%',
      alignSelf: 'center',
      maxHeight: '82%',
    },
    sortModalTitle: { fontSize: 18, fontWeight: '800', marginBottom: 6 },
    sortModalSubtitle: { fontSize: 13, lineHeight: 19, marginBottom: 14 },
    sortModalScroll: { maxHeight: 360 },
    sortOptionRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderRadius: 12,
      borderWidth: 1.5,
      marginBottom: 10,
      gap: 12,
    },
    sortOptionRadio: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 2,
      marginTop: 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sortOptionTextCol: { flex: 1 },
    sortOptionTitle: { fontSize: 15, fontWeight: '800', lineHeight: 21 },
    sortOptionHint: { fontSize: 12, fontWeight: '600', lineHeight: 17, marginTop: 4 },
    sortModalActions: { flexDirection: 'row', gap: 10, marginTop: 6 },
    sortModalSecondaryBtn: {
      flex: 1,
      borderRadius: 12,
      borderWidth: 1.5,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 13,
      backgroundColor: 'transparent',
    },
    sortModalSecondaryBtnText: { fontWeight: '800', fontSize: 14 },
    sortModalPrimaryBtn: {
      flex: 1,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 13,
      backgroundColor: accent,
    },
    sortModalPrimaryBtnText: { color: '#fff', fontWeight: '900', fontSize: 15 },
  });
};

export default BalanceListScreen;
