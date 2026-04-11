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
  KeyboardAvoidingView,
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
import { keyboardAvoidingBehavior } from '../utils/keyboardAvoiding';
import { sendActivitySummaryMessage } from '../services/cometchatActivitySummary';
import {
  buildNoteActivitySummaryText,
  formatActivitySummaryTimestamp,
} from '../utils/activitySummaryMessages';

import { toOrdinal, formatDateTime as formatDateTimeUtil, nameOnly } from '../utils/formatting';
import {
  getRemarkEntries,
  formatRemarkEntryAuditLines,
  formatRemarkLogForExport,
  remarkEntriesSearchBlob,
} from '../utils/remarkLog';
import { idForApiPath } from '../utils/mongoId';
import UserAvatar from '../components/UserAvatar';
import RemarkLogSection from '../components/RemarkLogSection';
import CustomerCategoryField from '../components/CustomerCategoryField';
import { labelForCustomerCategory, normalizeCustomerCategory } from '../utils/customerCategory';
import Orientation from 'react-native-orientation-locker';

const normalizeDigits = (s) => String(s || '').replace(/\D/g, '');

function rowMatchesSearch(row, qRaw) {
  const q = qRaw.trim();
  if (!q) return true;
  const qLower = q.toLowerCase();
  const plotNo = String(row.plotNumber || '').toLowerCase();
  if (plotNo.includes(qLower)) return true;
  const name = (row.waiter.customerName || '').toLowerCase();
  if (name.includes(qLower)) return true;
  const qDigits = normalizeDigits(q);
  const mobiles = row.waiter.customerMobiles || [];
  for (const m of mobiles) {
    const raw = String(m).toLowerCase();
    if (raw.includes(qLower)) return true;
    if (qDigits.length >= 2 && normalizeDigits(m).includes(qDigits)) return true;
  }
  if (remarkEntriesSearchBlob(row.waiter).includes(qLower)) return true;
  const catLabel = labelForCustomerCategory(row.waiter.customerCategory).toLowerCase();
  if (catLabel.includes(qLower)) return true;
  if (qLower === 'scholar' || qLower === 'regular' || qLower === 'alim' || qLower === 'hafiz') {
    const n = normalizeCustomerCategory(row.waiter.customerCategory);
    if (qLower === 'scholar' || qLower === 'alim' || qLower === 'hafiz') return n === 'scholar';
    if (qLower === 'regular') return n === 'regular';
  }
  return false;
}

/** Group the same person across plots (prefer matching on normalized mobiles). */
function customerGroupKey(waiter) {
  const digits = (waiter.customerMobiles || [])
    .map((m) => normalizeDigits(m))
    .filter(Boolean)
    .sort();
  if (digits.length) return `m:${digits.join('|')}`;
  return `n:${(waiter.customerName || '').trim().toLowerCase()}`;
}

/** Fixed column widths; table scrolls horizontally so nothing is truncated. */
const TABLE_COL = {
  sr: 46,
  plot: 64,
  wait: 76,
  name: 200,
  mobile: 200,
  type: 96,
  address: 200,
  remarks: 252,
  added: 132,
  by: 128,
  actions: 112,
};

const DEFAULT_SORT_BY = 'date';
const DEFAULT_SORT_DIR = 'asc';

/** Preset sorts: each option states exactly how rows will be ordered. */
const SORT_PRESETS = [
  {
    id: 'plot_asc',
    sortBy: 'plot',
    sortDir: 'asc',
    title: 'Plot number (low → high)',
    hint: 'Smaller plot numbers first. Same plot: 1st waiting, then 2nd, etc.',
  },
  {
    id: 'plot_desc',
    sortBy: 'plot',
    sortDir: 'desc',
    title: 'Plot number (high → low)',
    hint: 'Larger plot numbers first. Same plot: queue order preserved.',
  },
  {
    id: 'date_newest',
    sortBy: 'date',
    sortDir: 'desc',
    title: 'Newest first',
    hint: 'Most recently added waiting entries at the top.',
  },
  {
    id: 'date_oldest',
    sortBy: 'date',
    sortDir: 'asc',
    title: 'Oldest first',
    hint: 'Earliest added waiting entries at the top.',
  },
  {
    id: 'owner_asc',
    sortBy: 'owner',
    sortDir: 'asc',
    title: 'Added by (A → Z)',
    hint: 'Sort by owner name alphabetically.',
  },
  {
    id: 'owner_desc',
    sortBy: 'owner',
    sortDir: 'desc',
    title: 'Added by (Z → A)',
    hint: 'Sort by owner name reverse alphabetically.',
  },
];

function presetIdFromSort(sortBy, sortDir) {
  const p = SORT_PRESETS.find((x) => x.sortBy === sortBy && x.sortDir === sortDir);
  return p?.id ?? 'plot_asc';
}

function sortSummaryLabel(sortBy, sortDir) {
  const p = SORT_PRESETS.find((x) => x.sortBy === sortBy && x.sortDir === sortDir);
  return p?.title ?? 'Plot number (low → high)';
}

const WaitingListScreen = () => {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => getStyles(colors, isDark), [colors, isDark]);
  const { showAlert } = useAlert();
  const { userInfo } = useContext(AuthContext);

  const notifyWaitingNoteToCometchat = useCallback(
    ({ isUpdate, plotNumber, customerName, preview }) => {
      const actor = String(userInfo?.name || userInfo?.mobileNumber || 'User').trim();
      const at = formatActivitySummaryTimestamp();
      sendActivitySummaryMessage(
        buildNoteActivitySummaryText({
          kind: 'waiting',
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
  const [removing, setRemoving] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [removeReason, setRemoveReason] = useState('');
  const [editTarget, setEditTarget] = useState(null);
  const [editName, setEditName] = useState('');
  const [editMobiles, setEditMobiles] = useState(['']);
  const [editAddress, setEditAddress] = useState('');
  const [editCategory, setEditCategory] = useState('regular');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [sortBy, setSortBy] = useState(DEFAULT_SORT_BY);
  const [sortDir, setSortDir] = useState(DEFAULT_SORT_DIR);
  const [sortModalVisible, setSortModalVisible] = useState(false);
  const [pendingPresetId, setPendingPresetId] = useState('plot_asc');
  const [sharing, setSharing] = useState(false);

  const toggleSelect = useCallback((id) => {
    setSelectedId((prev) => (prev === id ? null : id));
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
    setPendingPresetId('plot_asc');
    setSortModalVisible(false);
  }, []);

  const waitingRows = useMemo(() => {
    const rows = [];
    plots.forEach((plot) => {
      const wl = Array.isArray(plot.waitingList) ? plot.waitingList : [];
      wl.forEach((waiter, idx) => {
        rows.push({
          plotId: plot._id,
          plotNumber: plot.plotNumber,
          queuePosition: idx + 1,
          plotQueueCount: wl.length,
          waiter,
        });
      });
    });

    const dir = sortDir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      if (sortBy === 'plot') {
        const cmp = String(a.plotNumber).localeCompare(String(b.plotNumber), undefined, { numeric: true });
        if (cmp !== 0) return cmp * dir;
        return a.queuePosition - b.queuePosition;
      }
      if (sortBy === 'date') {
        const da = new Date(a.waiter.createdAt || 0).getTime();
        const db = new Date(b.waiter.createdAt || 0).getTime();
        return (da - db) * dir;
      }
      if (sortBy === 'owner') {
        const aa = (a.waiter.createdBy || '').toLowerCase();
        const ab = (b.waiter.createdBy || '').toLowerCase();
        return aa.localeCompare(ab) * dir;
      }
      return 0;
    });
    return rows;
  }, [plots, sortBy, sortDir]);

  const listSections = useMemo(() => {
    const q = searchQuery.trim();
    const filtered = q ? waitingRows.filter((row) => rowMatchesSearch(row, q)) : waitingRows;

    let sections;
    if (!q) {
      sections = [{ key: 'all', customerName: null, data: filtered }];
    } else {
      const map = new Map();
      for (const row of filtered) {
        const k = customerGroupKey(row.waiter);
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(row);
      }

      const out = Array.from(map.entries()).map(([key, rows]) => {
        const sorted = rows.slice().sort((a, b) =>
          String(a.plotNumber).localeCompare(String(b.plotNumber), undefined, { numeric: true })
        );
        return {
          key,
          customerName: sorted[0]?.waiter?.customerName || '-',
          data: sorted,
        };
      });
      out.sort((a, b) =>
        String(a.customerName).localeCompare(String(b.customerName), undefined, { sensitivity: 'base' })
      );
      sections = out.length === 0 ? [{ key: 'nomatch', customerName: null, data: [] }] : out;
    }

    // Attach a global serial number to each row so the Sr column is always
    // sequential across all sections (SectionList's `index` resets per-section).
    let globalSr = 0;
    return sections.map((section) => ({
      ...section,
      data: section.data.map((row) => ({ ...row, globalSr: ++globalSr })),
    }));
  }, [waitingRows, searchQuery]);

  const listItemCount = useMemo(
    () => listSections.reduce((n, s) => n + s.data.length, 0),
    [listSections]
  );

  /** Landscape: single section, full list (no search UI / grouping). Portrait: normal. */
  const displaySections = useMemo(() => {
    if (!isLandscape) return listSections;
    let globalSr = 0;
    const data = waitingRows.map((row) => ({ ...row, globalSr: ++globalSr }));
    return [{ key: 'all', customerName: null, data }];
  }, [isLandscape, listSections, waitingRows]);

  const displayItemCount = useMemo(
    () => displaySections.reduce((n, s) => n + s.data.length, 0),
    [displaySections]
  );

  const displayRows = useMemo(
    () => displaySections.flatMap((section) => section.data),
    [displaySections],
  );

  const toExportRows = useCallback(() => {
    return displayRows.map((item) => ({
      'Sr No': item.globalSr,
      'Plot No': item.plotNumber,
      Waiting: toOrdinal(item.queuePosition),
      Name: item.waiter.customerName || '-',
      Contact: (item.waiter.customerMobiles || []).filter((m) => String(m).trim()).join(', ') || '-',
      Type: labelForCustomerCategory(item.waiter.customerCategory),
      Address: (item.waiter.customerAddress || '').trim() || '-',
      Remarks: formatRemarkLogForExport(item.waiter),
      Added: item.waiter.createdAt ? formatDateTimeUtil(item.waiter.createdAt) : '-',
      By: nameOnly(item.waiter.createdBy),
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
      showAlert('Nothing to share', 'There are no waiting entries in the current view.');
      return;
    }

    const headers = [
      'Sr No',
      'Plot No',
      'Waiting',
      'Name',
      'Contact',
      'Customer type',
      'Address',
      'Remarks',
      'Added',
      'By',
    ];
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Waiting List');

    sheet.columns = [
      { header: 'Sr No', key: 'Sr No', width: 8 },
      { header: 'Plot No', key: 'Plot No', width: 10 },
      { header: 'Waiting', key: 'Waiting', width: 13 },
      { header: 'Name', key: 'Name', width: 25 },
      { header: 'Contact', key: 'Contact', width: 25 },
      { header: 'Customer type', key: 'Type', width: 14 },
      { header: 'Address', key: 'Address', width: 30 },
      { header: 'Remarks', key: 'Remarks', width: 32 },
      { header: 'Added', key: 'Added', width: 24 },
      { header: 'By', key: 'By', width: 20 },
    ];
    rows.forEach((row) => {
      sheet.addRow(row);
    });

    sheet.getRow(1).height = 24;
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };

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
    const path = `${dir}/waiting-list-${ts}.xlsx`;
    await RNFS.writeFile(path, base64, 'base64');

    await Share.open({
      title: 'Share Waiting List (Excel)',
      filename: `waiting-list-${ts}`,
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      url: `file://${path}`,
      failOnCancel: false,
    });
  }, [showAlert, toExportRows]);

  const sharePdf = useCallback(async () => {
    const rows = toExportRows();
    if (rows.length === 0) {
      showAlert('Nothing to share', 'There are no waiting entries in the current view.');
      return;
    }

    const pdf = await PDFDocument.create();
    const pageSize = [842, 595]; // A4 landscape
    const marginX = 20;
    const marginTop = 18;
    const marginBottom = 18;
    const headerBandHeight = 42;
    const tableHeaderHeight = 22;
    const rowHeight = 20;
    const fontSize = 8;
    const titleSize = 12;
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const columns = [
      { key: 'Sr No', label: 'Sr', width: 34 },
      { key: 'Plot No', label: 'Plot', width: 42 },
      { key: 'Waiting', label: 'Waiting', width: 56 },
      { key: 'Name', label: 'Name', width: 108 },
      { key: 'Contact', label: 'Contact', width: 108 },
      { key: 'Type', label: 'Type', width: 52 },
      { key: 'Address', label: 'Address', width: 124 },
      { key: 'Remarks', label: 'Remarks', width: 138 },
      { key: 'By', label: 'By', width: 78 },
      { key: 'Added', label: 'Added', width: 84 },
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
        borderWidth: 0.8,
        borderColor: rgb(0.55, 0.55, 0.55),
        color: isHeader ? rgb(0.92, 0.95, 0.99) : undefined,
      });
      const usedFont = isHeader ? fontBold : font;
      const usedSize = isHeader ? 8.2 : fontSize;
      const rendered = truncateToWidth(text, width - 6, usedFont, usedSize);
      pg.drawText(rendered, {
        x: x + 3,
        y: y + (height - usedSize) / 2 + 1,
        size: usedSize,
        font: usedFont,
        color: rgb(0.08, 0.08, 0.08),
      });
    };

    let page = pdf.addPage(pageSize);
    let cursorY = pageSize[1] - marginTop;

    const drawPageHeader = (pg) => {
      pg.drawText(`Waiting List Export (${rows.length} rows)`, {
        x: tableX,
        y: pageSize[1] - marginTop - 2,
        size: titleSize,
        font: fontBold,
        color: rgb(0.05, 0.05, 0.05),
      });
      pg.drawText(`Generated: ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`, {
        x: tableX,
        y: pageSize[1] - marginTop - 16,
        size: 9,
        font,
        color: rgb(0.25, 0.25, 0.25),
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
    const dir = RNFS.CachesDirectoryPath || RNFS.TemporaryDirectoryPath;
    const path = `${dir}/waiting-list-${ts}.pdf`;
    await RNFS.writeFile(path, base64, 'base64');

    await Share.open({
      title: 'Share Waiting List (PDF)',
      filename: `waiting-list-${ts}`,
      type: 'application/pdf',
      url: `file://${path}`,
      failOnCancel: false,
    });
  }, [safePdfText, showAlert, toExportRows]);

  const onSharePress = useCallback(() => {
    if (sharing) return;
    Alert.alert('Share Waiting List', 'Choose export format', [
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

  const fetchPlots = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const res = await api.get('/');
      setPlots(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      showAlert('Error', error.response?.data?.message || 'Failed to load waiting list.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [showAlert]);

  useEffect(() => {
    socket.connect();
    const onPlotUpdated = (updatedPlot) => {
      setPlots((prev) => prev.map((p) => (p._id === updatedPlot._id ? updatedPlot : p)));
    };
    socket.on('plotUpdated', onPlotUpdated);
    return () => {
      socket.off('plotUpdated', onPlotUpdated);
    };
  }, []);

  /** Tab bar lives on this screen's navigator — not on `getParent()` (that is the outer Stack). */
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
    []
  );

  const applyWaitingListChrome = useCallback(() => {
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
    applyWaitingListChrome();
  }, [isLandscape, applyWaitingListChrome]);

  useFocusEffect(
    useCallback(() => {
      fetchPlots(true);
      applyWaitingListChrome();
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
    }, [fetchPlots, navigation, defaultTabBarStyle, applyWaitingListChrome])
  );

  useOnAppForeground(
    useCallback(() => {
      if (!socket.connected) socket.connect();
      fetchPlots(true);
    }, [fetchPlots])
  );

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

  const openRemove = (plotId, waitingId, customerName) => {
    setRemoveTarget({ plotId, waitingId, customerName });
    setRemoveReason('');
  };

  const closeRemove = () => {
    if (removing) return;
    setRemoveTarget(null);
    setRemoveReason('');
  };

  const openEdit = (item) => {
    const mobiles = (item.waiter.customerMobiles || []).filter((m) => String(m).trim());
    setEditTarget(item);
    setEditName(item.waiter.customerName || '');
    setEditMobiles(mobiles.length ? mobiles : ['']);
    setEditAddress(item.waiter.customerAddress || '');
    setEditCategory(normalizeCustomerCategory(item.waiter.customerCategory));
  };

  const closeEdit = () => {
    if (savingEdit) return;
    setEditTarget(null);
    setEditName('');
    setEditMobiles(['']);
    setEditAddress('');
    setEditCategory('regular');
  };

  const addEditMobile = () => {
    if (editMobiles.length < 5) setEditMobiles((prev) => [...prev, '']);
  };

  const removeEditMobile = (index) => {
    const next = editMobiles.filter((_, i) => i !== index);
    setEditMobiles(next.length ? next : ['']);
  };

  const updateEditMobile = (text, index) => {
    const next = [...editMobiles];
    next[index] = text;
    setEditMobiles(next);
  };

  const saveEdit = async () => {
    const name = editName.trim();
    const mobiles = editMobiles.map((m) => String(m).trim()).filter(Boolean);
    if (!name) {
      showAlert('Required', 'Customer name is required.');
      return;
    }
    if (!mobiles.length) {
      showAlert('Required', 'At least one mobile number is required.');
      return;
    }
    if (!editTarget?.plotId || !editTarget?.waiter?._id) return;
    try {
      setSavingEdit(true);
      const res = await api.patch(`/${editTarget.plotId}/waiting/${editTarget.waiter._id}`, {
        customerName: name,
        customerMobiles: mobiles,
        customerAddress: editAddress.trim(),
        customerCategory: normalizeCustomerCategory(editCategory),
      });
      if (res?.data?._id) {
        setPlots((prev) => prev.map((p) => (p._id === res.data._id ? res.data : p)));
      }
      closeEdit();
    } catch (error) {
      showAlert('Error', error.response?.data?.message || 'Failed to update waiting person.');
    } finally {
      setSavingEdit(false);
    }
  };

  const confirmRemove = async () => {
    const reason = removeReason.trim();
    if (!reason) {
      showAlert('Required', 'Please enter a reason for removing this person.');
      return;
    }
    if (!removeTarget?.plotId || !removeTarget?.waitingId) return;
    try {
      setRemoving(true);
      const res = await api.delete(`/${removeTarget.plotId}/waiting/${removeTarget.waitingId}`, {
        data: { removalRemarks: reason },
      });
      if (res?.data?._id) {
        setPlots((prev) => prev.map((p) => (p._id === res.data._id ? res.data : p)));
      }
      closeRemove();
    } catch (error) {
      showAlert('Error', error.response?.data?.message || 'Failed to remove waiter.');
    } finally {
      setRemoving(false);
    }
  };

  const formatDateTime = formatDateTimeUtil;

  const mergePlotFromRemarkResponse = useCallback((plotPayload) => {
    if (!plotPayload?._id) return;
    setPlots((prev) => prev.map((p) => (String(p._id) === String(plotPayload._id) ? plotPayload : p)));
  }, []);

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

  const renderTableHeader = () => (
    <View
      style={[
        styles.tableRow,
        styles.tableHeaderRow,
        { borderColor: colors.border, width: tableWidth },
      ]}
    >
      <Text style={[styles.tableCell, styles.tableHeaderText, styles.tableCellCenter, { width: TABLE_COL.sr }]}>
        {'Sr.\nNo.'}
      </Text>
      <Text style={[styles.tableCell, styles.tableHeaderText, styles.tableCellCenter, { width: TABLE_COL.plot }]}>
        {'Plot\nNo.'}
      </Text>
      <Text style={[styles.tableCell, styles.tableHeaderText, styles.tableCellCenter, { width: TABLE_COL.wait }]}>
        Waiting
      </Text>
      <Text style={[styles.tableCell, styles.tableHeaderText, styles.tableCellCenter, { width: TABLE_COL.name }]}>
        Name
      </Text>
      <Text style={[styles.tableCell, styles.tableHeaderText, styles.tableCellCenter, { width: TABLE_COL.mobile }]}>
        Contact
      </Text>
      <Text style={[styles.tableCell, styles.tableHeaderText, styles.tableCellCenter, { width: TABLE_COL.type }]}>
        Type
      </Text>
      <Text style={[styles.tableCell, styles.tableHeaderText, styles.tableCellCenter, { width: TABLE_COL.address }]}>
        Address
      </Text>
      <Text style={[styles.tableCell, styles.tableHeaderText, styles.tableCellCenter, { width: TABLE_COL.remarks }]}>
        Remarks
      </Text>
      <Text style={[styles.tableCell, styles.tableHeaderText, styles.tableCellCenter, { width: TABLE_COL.added }]}>
        Added
      </Text>
      <Text style={[styles.tableCell, styles.tableHeaderText, styles.tableCellCenter, { width: TABLE_COL.by }]}>
        By
      </Text>
      <Text style={[styles.tableCell, styles.tableHeaderText, styles.tableCellCenter, { width: TABLE_COL.actions }]}>
        Actions
      </Text>
    </View>
  );

  const renderTableRow = ({ item }) => {
    const mobiles = (item.waiter.customerMobiles || []).filter((m) => String(m).trim());
    const addr = (item.waiter.customerAddress || '').trim();
    const typeLabel = labelForCustomerCategory(item.waiter.customerCategory);
    const remarkEntries = getRemarkEntries(item.waiter);
    const added = item.waiter.createdAt ? formatDateTime(item.waiter.createdAt) : '-';
    const by = nameOnly(item.waiter.createdBy);
    const rowId = `${item.plotId}:${item.waiter._id}`;
    const isSelected = selectedId === rowId;
    return (
      <Pressable
        onPress={() => toggleSelect(rowId)}
        style={[
          styles.tableRow,
          styles.tableDataRow,
          { borderColor: colors.border, width: tableWidth },
          isSelected && styles.rowSelected,
        ]}
      >
        <Text style={[styles.tableCell, styles.tableText, styles.tableCellCenter, { width: TABLE_COL.sr }]}>
          {item.globalSr}
        </Text>
        <Text style={[styles.tableCell, styles.tableText, styles.tableCellCenter, { width: TABLE_COL.plot }]}>
          {item.plotNumber}
        </Text>
        <Text style={[styles.tableCell, styles.tableText, styles.tableCellCenter, { width: TABLE_COL.wait }]}>
          {toOrdinal(item.queuePosition)}
        </Text>
        <View style={[styles.tableCell, styles.tableCellCenteredCol, { width: TABLE_COL.name }]}>
          <Text style={[styles.tableText, styles.tableTextCenter]}>{item.waiter.customerName || '-'}</Text>
        </View>
        <View style={[styles.tableCell, styles.tableCellCenteredCol, { width: TABLE_COL.mobile }]}>
          {mobiles.length === 0 ? (
            <Text style={[styles.tableTextMuted, styles.tableTextCenter]}>-</Text>
          ) : (
            mobiles.map((m, mi) => (
              <View key={mi} style={styles.mobileLine}>
                <Text style={[styles.tableText, styles.mobileLineText, styles.tableTextCenter]}>{m}</Text>
                <TouchableOpacity
                  onPress={() => dialPhone(m)}
                  style={styles.tableCallMini}
                  accessibilityLabel={`Call ${m}`}
                >
                  <Icon name="call" size={17} color="#1565c0" />
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>
        <View style={[styles.tableCell, styles.tableCellCenteredCol, { width: TABLE_COL.type }]}>
          <Text style={[styles.tableTextSmall, styles.tableTextCenter]} numberOfLines={2}>
            {typeLabel}
          </Text>
        </View>
        <View style={[styles.tableCell, styles.tableCellCenteredCol, { width: TABLE_COL.address }]}>
          <Text style={[addr ? styles.tableText : styles.tableTextMuted, styles.tableTextCenter]}>
            {addr || '—'}
          </Text>
        </View>
        <View style={[styles.tableCell, styles.remarksCellWithAdd, { width: TABLE_COL.remarks }]}>
          <View style={styles.remarksCellTextCol}>
            {remarkEntries.length === 0 ? (
              <Text style={[styles.tableTextMuted, styles.tableTextCenter]}>—</Text>
            ) : (
              remarkEntries.map((e, ei) => (
                <View key={e._id != null ? String(e._id) : `e-${ei}`} style={styles.remarksTableBlock}>
                  <Text style={[styles.tableText, styles.tableTextCenter]}>{e.text}</Text>
                  {formatRemarkEntryAuditLines(e).map((line, li) => (
                    <Text
                      key={li}
                      style={[styles.tableTextSmall, styles.tableTextCenter, styles.remarksUpdatedMuted]}
                    >
                      {line}
                    </Text>
                  ))}
                </View>
              ))
            )}
          </View>
          <RemarkLogSection
            listDisplay="addButtonOnly"
            entries={remarkEntries}
            readOnly={false}
            disabled={false}
            onAdd={async (text) => {
              const res = await api.post(
                `/${idForApiPath(item.plotId)}/waiting/${idForApiPath(item.waiter._id)}/remarks`,
                { text },
              );
              mergePlotFromRemarkResponse(res.data);
              notifyWaitingNoteToCometchat({
                isUpdate: false,
                plotNumber: item.plotNumber,
                customerName: item.waiter.customerName,
                preview: text,
              });
            }}
            onPatch={async (rid, text) => {
              const res = await api.patch(
                `/${idForApiPath(item.plotId)}/waiting/${idForApiPath(item.waiter._id)}/remarks/${rid}`,
                { text },
              );
              mergePlotFromRemarkResponse(res.data);
              notifyWaitingNoteToCometchat({
                isUpdate: true,
                plotNumber: item.plotNumber,
                customerName: item.waiter.customerName,
                preview: text,
              });
            }}
          />
        </View>
        <View style={[styles.tableCell, styles.tableCellCenteredCol, { width: TABLE_COL.added }]}>
          <Text style={[styles.tableTextSmall, styles.tableTextCenter]}>{added}</Text>
        </View>
        <View style={[styles.tableCell, styles.byCell, { width: TABLE_COL.by }]}>
          <UserAvatar
            name={item.waiter.createdBy}
            imageUrl={item.waiter.createdByAvatarUrl}
            size={24}
            style={styles.byAvatar}
          />
          <Text style={[styles.tableTextSmall, styles.byName, styles.tableTextCenter]}>{by}</Text>
        </View>
        <View style={[styles.tableCell, styles.actionRow, { width: TABLE_COL.actions }]}>
          <TouchableOpacity
            style={styles.tableIconBtn}
            onPress={() => openEdit(item)}
            accessibilityLabel="Edit waiting"
          >
            <Icon name="edit" size={18} color={colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.tableIconBtn}
            onPress={() => openRemove(item.plotId, item.waiter._id, item.waiter.customerName)}
            accessibilityLabel="Remove waiting"
          >
            <Icon name="delete-outline" size={19} color="#c62828" />
          </TouchableOpacity>
        </View>
      </Pressable>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
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
              placeholder="Search by name, mobile, or plot no…"
              placeholderTextColor={colors.placeholder}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="never"
            />
            <View style={styles.countPill}>
              <Text style={styles.countPillText}>
                {searchQuery.trim() ? listItemCount : waitingRows.length}
              </Text>
            </View>
            {searchQuery.length > 0 ? (
              <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.searchClear} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
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
                <Icon name="sort" size={20} color={colors.primary} />
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
              accessibilityLabel="Remove sort filter, reset to default order"
            >
              <Icon
                name="undo"
                size={18}
                color={isDefaultSort ? colors.textSecondary : colors.primary}
              />
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
              activeOpacity={0.85}
              accessibilityLabel="Share waiting list as PDF or Excel"
              disabled={sharing}
            >
              {sharing ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Icon name="share" size={19} color={colors.primary} />
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.shareIconBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
              onPress={toggleFullscreen}
              activeOpacity={0.85}
              accessibilityLabel={isLandscape ? 'Exit fullscreen mode' : 'Enter fullscreen mode'}
            >
              <Icon name={isLandscape ? 'fullscreen-exit' : 'fullscreen'} size={19} color={colors.primary} />
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
                styles.tableInner,
                styles.tableInnerLandscape,
                { width: tableWidth, minHeight: landscapeTableMinHeight },
              ]}
            >
              <SectionList
                sections={displaySections}
                keyExtractor={(item) => `${item.plotId}:${item.waiter._id}`}
                extraData={selectedId}
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
                      <Text style={styles.emptyText}>No waiting entries right now.</Text>
                      <Text style={styles.emptySubText}>New waiting persons will show here in real time.</Text>
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
          <View style={[styles.tableInner, { width: tableWidth }]}>
            <SectionList
              sections={displaySections}
              keyExtractor={(item) => `${item.plotId}:${item.waiter._id}`}
              extraData={selectedId}
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
                      Waiting on {n} plot{n !== 1 ? 's' : ''}
                    </Text>
                    {renderTableHeader()}
                  </View>
                );
              }}
              stickySectionHeadersEnabled={false}
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
                        : 'No waiting entries right now.'}
                    </Text>
                    <Text style={styles.emptySubText}>
                      {searchQuery.trim()
                        ? 'Try another spelling, or search by part of a mobile number.'
                        : 'New waiting persons will show here in real time.'}
                    </Text>
                  </View>
                ) : null
              }
            />
          </View>
        </ScrollView>
      )}

      {isLandscape && (
        <TouchableOpacity
          style={[styles.fullscreenFab, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={toggleFullscreen}
          activeOpacity={0.9}
          accessibilityRole="button"
          accessibilityLabel={isLandscape ? 'Exit fullscreen mode' : 'Enter fullscreen mode'}
        >
          <Icon name={isLandscape ? 'fullscreen-exit' : 'fullscreen'} size={20} color={colors.primary} />
        </TouchableOpacity>
      )}

      <Modal visible={sortModalVisible} transparent animationType="fade" onRequestClose={closeSortModal}>
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeSortModal} accessibilityLabel="Close sort dialog" />
          <View style={[styles.sortModalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sortModalTitle, { color: colors.text }]}>Sort waiting list</Text>
            <Text style={[styles.sortModalSubtitle, { color: colors.textSecondary }]}>
              Choose how rows are ordered. Tap an option, then Apply. Remove filter resets to plot number (low → high).
            </Text>
            <ScrollView
              style={styles.sortModalScroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {SORT_PRESETS.map((opt) => {
                const selected = pendingPresetId === opt.id;
                return (
                  <Pressable
                    key={opt.id}
                    onPress={() => setPendingPresetId(opt.id)}
                    style={[
                      styles.sortOptionRow,
                      {
                        borderColor: selected ? colors.primary : colors.border,
                        backgroundColor: selected
                          ? isDark
                            ? 'rgba(59, 130, 246, 0.18)'
                            : '#eff6ff'
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
                          borderColor: selected ? colors.primary : colors.textSecondary,
                          backgroundColor: selected ? colors.primary : 'transparent',
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
                <Text style={[styles.sortModalSecondaryBtnText, { color: colors.textSecondary }]}>
                  Remove filter
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.sortModalPrimaryBtn, { backgroundColor: colors.primary }]}
                onPress={applySortModal}
              >
                <Text style={styles.sortModalPrimaryBtnText}>Apply</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={Boolean(removeTarget)} transparent animationType="fade" onRequestClose={closeRemove}>
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView behavior={keyboardAvoidingBehavior()} style={styles.modalKav}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Remove from waiting list</Text>
              <Text style={styles.modalSubtitle}>
                {removeTarget?.customerName ? `${removeTarget.customerName}: ` : ''}
                Enter reason for cancellation/removal.
              </Text>
              <TextInput
                style={styles.modalInput}
                placeholder="e.g. already booked, not interested, duplicate..."
                placeholderTextColor={colors.placeholder}
                value={removeReason}
                onChangeText={setRemoveReason}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                editable={!removing}
              />
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={closeRemove} disabled={removing}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.removeBtn} onPress={confirmRemove} disabled={removing}>
                  {removing ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.removeBtnText}>Remove</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <Modal visible={Boolean(editTarget)} transparent animationType="fade" onRequestClose={closeEdit}>
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView behavior={keyboardAvoidingBehavior()} style={styles.modalKav}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Edit Waiting Details</Text>
              <Text style={styles.modalSubtitle}>
                Update customer info. Use Notes below to add or fix spelling — each note keeps date and author.
              </Text>

              <ScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                style={styles.editScroll}
              >
                <Text style={styles.inputLabel}>Customer name</Text>
                <TextInput
                  style={styles.modalInputSingle}
                  placeholder="Full Name"
                  placeholderTextColor={colors.placeholder}
                  value={editName}
                  onChangeText={setEditName}
                  editable={!savingEdit}
                />
                <Text style={styles.inputLabel}>Contact numbers</Text>
                {editMobiles.map((m, i) => (
                  <View key={i} style={styles.mobileRow}>
                    <Icon
                      name="phone"
                      size={18}
                      color={colors.textSecondary}
                      style={styles.mobileRowIcon}
                    />
                    <TextInput
                      style={[styles.mobileInput, { color: colors.text }]}
                      placeholder={`Mobile ${i + 1}`}
                      placeholderTextColor={colors.placeholder}
                      value={m}
                      onChangeText={(t) => updateEditMobile(t, i)}
                      keyboardType="phone-pad"
                      editable={!savingEdit}
                    />
                    {editMobiles.length > 1 ? (
                      <TouchableOpacity
                        onPress={() => removeEditMobile(i)}
                        style={styles.mobileActionBtn}
                        disabled={savingEdit}
                      >
                        <Icon name="remove" size={18} color="#c62828" />
                      </TouchableOpacity>
                    ) : null}
                    {i === editMobiles.length - 1 && editMobiles.length < 5 ? (
                      <TouchableOpacity
                        onPress={addEditMobile}
                        style={[styles.mobileActionBtn, styles.mobileAddBtn]}
                        disabled={savingEdit}
                      >
                        <Icon name="add" size={18} color="#fff" />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ))}
                <Text style={styles.inputLabel}>Area / locality</Text>
                <TextInput
                  style={styles.modalInputSingle}
                  placeholder="e.g. Block B, Sector 4"
                  placeholderTextColor={colors.placeholder}
                  value={editAddress}
                  onChangeText={setEditAddress}
                  editable={!savingEdit}
                />
                <CustomerCategoryField
                  value={editCategory}
                  onChange={setEditCategory}
                  disabled={savingEdit}
                />
                {editTarget ? (
                  <RemarkLogSection
                    entries={getRemarkEntries(editTarget.waiter)}
                    readOnly={false}
                    disabled={savingEdit}
                    onAdd={async (text) => {
                      const res = await api.post(
                        `/${idForApiPath(editTarget.plotId)}/waiting/${idForApiPath(editTarget.waiter._id)}/remarks`,
                        { text },
                      );
                      mergePlotFromRemarkResponse(res.data);
                      notifyWaitingNoteToCometchat({
                        isUpdate: false,
                        plotNumber: editTarget.plotNumber,
                        customerName: editTarget.waiter.customerName,
                        preview: text,
                      });
                    }}
                    onPatch={async (rid, text) => {
                      const res = await api.patch(
                        `/${idForApiPath(editTarget.plotId)}/waiting/${idForApiPath(editTarget.waiter._id)}/remarks/${rid}`,
                        { text },
                      );
                      mergePlotFromRemarkResponse(res.data);
                      notifyWaitingNoteToCometchat({
                        isUpdate: true,
                        plotNumber: editTarget.plotNumber,
                        customerName: editTarget.waiter.customerName,
                        preview: text,
                      });
                    }}
                  />
                ) : null}
              </ScrollView>

              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={closeEdit} disabled={savingEdit}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.saveBtn} onPress={saveEdit} disabled={savingEdit}>
                  {savingEdit ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.removeBtnText}>Save</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
};

const getStyles = (colors, isDark) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    countPill: {
      minWidth: 34,
      height: 28,
      borderRadius: 14,
      backgroundColor: '#f59e0b',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 8,
      marginLeft: 6,
    },
    countPillText: { color: '#0f172a', fontWeight: '900', fontSize: 13 },
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: 14,
      marginTop: 8,
      marginBottom: 8,
      borderRadius: 14,
      borderWidth: 1.5,
      paddingHorizontal: 10,
      minHeight: 48,
    },
    searchIcon: { marginRight: 4 },
    searchInput: { flex: 1, fontSize: 16, paddingVertical: Platform.OS === 'ios' ? 12 : 10, fontWeight: '500' },
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
    sortOpenBtnOuter: {
      flex: 3,
      minWidth: 0,
    },
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
    sortRemoveFilterBtnDisabled: {
      opacity: 0.5,
    },
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
    sortOpenBtnValue: {
      fontSize: 15,
      fontWeight: '700',
      lineHeight: 20,
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
    sortModalScroll: { maxHeight: 340 },
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
    },
    sortModalPrimaryBtnText: { color: '#fff', fontWeight: '900', fontSize: 15 },
    searchSectionHeader: {
      paddingVertical: 10,
      paddingHorizontal: 4,
      marginBottom: 6,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    searchSectionName: { fontSize: 16, fontWeight: '800' },
    searchSectionMeta: { marginTop: 2, fontSize: 12, fontWeight: '700' },
    listContent: { paddingVertical: 4, paddingHorizontal: 0, paddingBottom: 28 },
    listContentLandscape: { paddingVertical: 2, paddingHorizontal: 0, paddingBottom: 8, flexGrow: 1 },
    landscapeTableSafe: { flex: 1 },
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
    horizontalTableHost: { flex: 1, marginHorizontal: 14 },
    horizontalTableHostLandscape: { flex: 1, marginHorizontal: 0 },
    horizontalTableContent: { flexGrow: 1 },
    tableInner: { flex: 1, minHeight: 200 },
    tableInnerLandscape: { flex: 1 },
    tableRow: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderTopWidth: 0,
      backgroundColor: colors.surface,
    },
    tableHeaderRow: {
      borderTopWidth: 2,
      borderBottomWidth: 2,
      backgroundColor: isDark ? '#312e81' : '#1e3a8a',
      borderColor: isDark ? '#6366f1' : '#3b82f6',
      borderTopLeftRadius: 10,
      borderTopRightRadius: 10,
    },
    tableDataRow: {
      minHeight: 52,
    },
    rowSelected: {
      backgroundColor: isDark ? '#172554' : '#eff6ff',
      borderWidth: 2.5,
      borderColor: '#3b82f6',
      borderRadius: 4,
      ...Platform.select({
        android: { elevation: 6 },
        ios: {
          shadowColor: '#3b82f6',
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.45,
          shadowRadius: 8,
        },
      }),
    },
    tableCell: {
      paddingVertical: 7,
      paddingHorizontal: 5,
      justifyContent: 'center',
      borderRightWidth: 1,
      borderRightColor: isDark ? '#334155' : '#e2e8f0',
    },
    tableCellCenteredCol: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    byCell: {
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    byAvatar: {
      flexShrink: 0,
    },
    byName: {
      width: '100%',
    },
    tableHeaderText: {
      color: '#f8fafc',
      fontSize: 14,
      fontWeight: '800',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    tableCellCenter: { textAlign: 'center', alignItems: 'center' },
    tableTextCenter: { textAlign: 'center', alignSelf: 'stretch' },
    tableText: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
      lineHeight: 22,
    },
    tableTextSmall: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
      lineHeight: 20,
    },
    tableTextMuted: {
      color: colors.textSecondary,
      fontSize: 16,
      fontWeight: '600',
    },
    remarksUpdatedMuted: {
      color: colors.textSecondary,
      marginTop: 4,
      fontStyle: 'italic',
      fontSize: 12,
      lineHeight: 16,
    },
    remarksTableBlock: { marginBottom: 8, width: '100%' },
    remarksCellWithAdd: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 6,
      paddingVertical: 4,
    },
    remarksCellTextCol: {
      flex: 1,
      minWidth: 0,
    },
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
      backgroundColor: isDark ? 'rgba(21,101,192,0.2)' : '#e3f2fd',
      flexShrink: 0,
    },
    actionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      flexWrap: 'wrap',
      gap: 6,
      paddingTop: 0,
    },
    tableIconBtn: {
      width: 34,
      height: 34,
      borderRadius: 9,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? '#0f172a' : '#f1f5f9',
    },
    empty: { paddingTop: 80, alignItems: 'center', paddingHorizontal: 20 },
    emptyText: { fontSize: 16, color: colors.text, fontWeight: '700' },
    emptySubText: { marginTop: 8, textAlign: 'center', fontSize: 13, color: colors.textSecondary },

    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      justifyContent: 'center',
      paddingHorizontal: 22,
    },
    modalKav: { width: '100%' },
    modalCard: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 18,
      maxWidth: 420,
      width: '100%',
      alignSelf: 'center',
    },
    modalTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginBottom: 6 },
    modalSubtitle: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: 12 },
    editScroll: { maxHeight: Platform.OS === 'ios' ? 420 : 400 },
    inputLabel: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '700',
      marginBottom: 6,
      marginLeft: 2,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    modalInput: {
      borderWidth: 1.5,
      borderColor: colors.border,
      borderRadius: 12,
      minHeight: 100,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: colors.text,
      fontSize: 15,
      marginBottom: 14,
    },
    modalInputSingle: {
      borderWidth: 1.5,
      borderColor: colors.border,
      borderRadius: 12,
      minHeight: 48,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: colors.text,
      fontSize: 15,
      marginBottom: 14,
    },
    modalInputMultiline: {
      borderWidth: 1.5,
      borderColor: colors.border,
      borderRadius: 12,
      minHeight: 100,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: colors.text,
      fontSize: 15,
      marginBottom: 6,
    },
    modalActions: { flexDirection: 'row', gap: 10 },
    cancelBtn: {
      flex: 1,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 12,
      backgroundColor: colors.surface,
    },
    cancelBtnText: { color: colors.textSecondary, fontWeight: '800', fontSize: 15 },
    removeBtn: {
      flex: 1,
      borderRadius: 12,
      backgroundColor: '#c62828',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 12,
    },
    saveBtn: {
      flex: 1,
      borderRadius: 12,
      backgroundColor: '#1565c0',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 12,
    },
    removeBtnText: { color: '#fff', fontWeight: '900', fontSize: 15 },
    mobileRow: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1.5,
      borderColor: colors.border,
      borderRadius: 12,
      marginBottom: 10,
      backgroundColor: colors.surface,
    },
    mobileRowIcon: { marginHorizontal: 12 },
    mobileInput: {
      flex: 1,
      fontSize: 15,
      paddingVertical: 11,
      fontWeight: '500',
    },
    mobileActionBtn: {
      width: 40,
      height: 40,
      margin: 4,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: isDark ? '#5c2a30' : '#ffebee',
      backgroundColor: isDark ? '#2d1518' : '#fff5f5',
      justifyContent: 'center',
      alignItems: 'center',
    },
    mobileAddBtn: {
      borderColor: '#1a1a2e',
      backgroundColor: '#1a1a2e',
    },
  });

export default WaitingListScreen;
