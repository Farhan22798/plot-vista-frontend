import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  useWindowDimensions,
  Platform,
  Modal,
  Pressable,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { useRoute } from '@react-navigation/native';
import { useOnAppForeground } from '../hooks/useOnAppForeground';
import api from '../services/api';
import socket from '../services/socket';
import { useTheme } from '../context/ThemeContext';
import { useAlert } from '../context/AlertContext';
import { formatRupee, numOrZero } from '../utils/formatting';
import { resolveScholarPricing, resolveRegularPricing } from '../utils/pricingHelpers';

const COL = {
  sr: 48,
  plot: 76,
  status: 92,
  area: 100,
  totalCost: 124,
  advance: 112,
  emi: 108,
  cash: 128,
};

const TABLE_MIN_CONTENT_WIDTH = Object.values(COL).reduce((a, w) => a + w, 0);

const MultiPlotSummaryScreen = () => {
  const route = useRoute();
  const { selectedPlotIds = [] } = route.params || {};
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => getStyles(colors, isDark), [colors, isDark]);
  const { showAlert } = useAlert();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedPlots, setSelectedPlots] = useState([]);
  const [scholarPlotId, setScholarPlotId] = useState(null);
  const [showPicker, setShowPicker] = useState(false);

  const isScholarMode = scholarPlotId != null;

  const load = useCallback(async () => {
    const res = await api.get('/');
    const allPlots = Array.isArray(res.data) ? res.data : [];
    const idSet = new Set(selectedPlotIds);
    const filtered = allPlots.filter((p) => idSet.has(p._id));
    filtered.sort((a, b) =>
      String(a.plotNumber).localeCompare(String(b.plotNumber), undefined, {
        numeric: true,
      })
    );
    setSelectedPlots(filtered);
  }, [selectedPlotIds]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        await load();
      } catch (e) {
        if (!cancelled) {
          showAlert('Error', e.response?.data?.message || 'Could not load selected plots.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load, showAlert]);

  const onRefresh = useCallback(async () => {
    try {
      setRefreshing(true);
      await load();
    } catch (e) {
      showAlert('Error', e.response?.data?.message || 'Could not refresh.');
    } finally {
      setRefreshing(false);
    }
  }, [load, showAlert]);

  useOnAppForeground(
    useCallback(() => {
      if (!socket.connected) socket.connect();
      load().catch(() => {});
    }, [load])
  );

  useEffect(() => {
    if (!selectedPlotIds.length) return undefined;
    const idSet = new Set(selectedPlotIds.map((id) => String(id)));
    socket.connect();
    const onPlotUpdated = (updatedPlot) => {
      if (!updatedPlot?._id || !idSet.has(String(updatedPlot._id))) return;
      setSelectedPlots((prev) =>
        prev.map((p) => (String(p._id) === String(updatedPlot._id) ? updatedPlot : p))
      );
    };
    socket.on('plotUpdated', onPlotUpdated);
    return () => socket.off('plotUpdated', onPlotUpdated);
  }, [selectedPlotIds]);

  const handleScholarToggle = () => {
    if (isScholarMode) {
      setScholarPlotId(null);
    } else {
      if (selectedPlots.length === 1) {
        setScholarPlotId(selectedPlots[0]._id);
      } else {
        setShowPicker(true);
      }
    }
  };

  const confirmScholarPick = (plotId) => {
    setScholarPlotId(plotId);
    setShowPicker(false);
  };

  const tableRows = useMemo(
    () =>
      selectedPlots.map((p) => {
        const useScholar = scholarPlotId === p._id;
        const cat = useScholar
          ? resolveScholarPricing(p.categoryPricing)
          : resolveRegularPricing(p.categoryPricing);
        return {
          id: p._id,
          plotNumber: p.plotNumber,
          areaSqFt: p.areaSqFt,
          totalPlotCost: cat.totalPlotCost,
          advance: cat.advance,
          emiAmount: cat.emiAmount,
          cashOneTimePrice: cat.cashOneTimePrice,
          status: p.status,
          isScholar: useScholar,
        };
      }),
    [selectedPlots, scholarPlotId]
  );

  const totals = useMemo(() => {
    return tableRows.reduce(
      (acc, r) => ({
        areaSqFt: acc.areaSqFt + numOrZero(r.areaSqFt),
        totalPlotCost: acc.totalPlotCost + numOrZero(r.totalPlotCost),
        advance: acc.advance + numOrZero(r.advance),
        emiAmount: acc.emiAmount + numOrZero(r.emiAmount),
        cashOneTimePrice: acc.cashOneTimePrice + numOrZero(r.cashOneTimePrice),
      }),
      {
        areaSqFt: 0,
        totalPlotCost: 0,
        advance: 0,
        emiAmount: 0,
        cashOneTimePrice: 0,
      }
    );
  }, [tableRows]);

  const { width: windowWidth } = useWindowDimensions();
  const tableWidth = useMemo(
    () => Math.max(TABLE_MIN_CONTENT_WIDTH, windowWidth + 120),
    [windowWidth],
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const scholarPlot = isScholarMode
    ? selectedPlots.find((p) => p._id === scholarPlotId)
    : null;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
        }
        nestedScrollEnabled
      >
        <View style={styles.headRow}>
          <Text style={styles.title}>Multiple Plot Info</Text>
          <View style={styles.countPill}>
            <Text style={styles.countPillText}>{tableRows.length}</Text>
          </View>
        </View>

        <View style={styles.toggleRow}>
          <TouchableOpacity
            style={[
              styles.toggleBtn,
              !isScholarMode && styles.toggleBtnActiveRegular,
              isScholarMode && styles.toggleBtnInactive,
            ]}
            onPress={() => setScholarPlotId(null)}
          >
            <Text style={[styles.toggleText, !isScholarMode && styles.toggleTextActive]}>Regular</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.toggleBtn,
              isScholarMode && styles.toggleBtnActiveScholar,
              !isScholarMode && styles.toggleBtnInactive,
            ]}
            onPress={handleScholarToggle}
          >
            <Text style={[styles.toggleText, isScholarMode && styles.toggleTextActive]}>
              Aalim / Hafiz / Imam
            </Text>
          </TouchableOpacity>
        </View>

        {isScholarMode && scholarPlot && (
          <View style={styles.scholarBanner}>
            <Icon name="auto-stories" size={18} color="#059669" />
            <Text style={styles.scholarBannerText}>
              Scholar discount on Plot No. {scholarPlot.plotNumber} only
            </Text>
            <TouchableOpacity onPress={() => setShowPicker(true)} style={styles.scholarChangeBtn}>
              <Text style={styles.scholarChangeBtnText}>Change</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.summaryGrid}>
          <SummaryTile label="Total area" value={`${totals.areaSqFt.toLocaleString()} sq ft`} styles={styles} />
          <SummaryTile label="Total plot cost" value={formatRupee(totals.totalPlotCost)} styles={styles} />
          <SummaryTile label="Total advance" value={formatRupee(totals.advance)} styles={styles} />
          <SummaryTile label="Total EMI" value={formatRupee(totals.emiAmount)} styles={styles} />
          <SummaryTile
            label="Total cash rate"
            value={formatRupee(totals.cashOneTimePrice)}
            styles={styles}
          />
        </View>

        <View style={[styles.tableOuter, { borderColor: colors.border }]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator
            nestedScrollEnabled
            bounces
            directionalLockEnabled={Platform.OS === 'ios'}
            style={styles.tableHorizontalScroll}
            contentContainerStyle={styles.tableHorizontalContent}
          >
            <View style={{ width: tableWidth }}>
              <View style={[styles.tableRow, styles.tableHeader, { width: tableWidth }]}>
                <Cell text="Sr" width={COL.sr} header styles={styles} />
                <Cell text="Plot No." width={COL.plot} header styles={styles} />
                <Cell text="Status" width={COL.status} header styles={styles} />
                <Cell text="Area" width={COL.area} header styles={styles} />
                <Cell text="Total Cost" width={COL.totalCost} header styles={styles} />
                <Cell text="Advance" width={COL.advance} header styles={styles} />
                <Cell text="EMI" width={COL.emi} header styles={styles} />
                <Cell text="Cash Rate" width={COL.cash} header styles={styles} />
              </View>
              {tableRows.map((r, i) => (
                <View
                  key={r.id}
                  style={[
                    styles.tableRow,
                    { width: tableWidth },
                    r.isScholar && styles.scholarRow,
                  ]}
                >
                  <Cell text={String(i + 1)} width={COL.sr} styles={styles} />
                  <View style={[styles.cell, { width: COL.plot, flexDirection: 'row', gap: 3 }]}>  
                    <Text style={styles.cellText}>{String(r.plotNumber)}</Text>
                    {r.isScholar && <Icon name="auto-stories" size={13} color="#059669" />}
                  </View>
                  <Cell text={String(r.status || '-')} width={COL.status} styles={styles} />
                  <Cell
                    text={
                      r.areaSqFt != null && !Number.isNaN(Number(r.areaSqFt))
                        ? `${Number(r.areaSqFt).toLocaleString()}`
                        : '—'
                    }
                    width={COL.area}
                    styles={styles}
                  />
                  <Cell text={formatRupee(r.totalPlotCost)} width={COL.totalCost} styles={styles} />
                  <Cell text={formatRupee(r.advance)} width={COL.advance} styles={styles} />
                  <Cell text={formatRupee(r.emiAmount)} width={COL.emi} styles={styles} />
                  <Cell text={formatRupee(r.cashOneTimePrice)} width={COL.cash} styles={styles} />
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      </ScrollView>

      <Modal visible={showPicker} transparent animationType="fade" onRequestClose={() => setShowPicker(false)}>
        <Pressable style={styles.pickerOverlay} onPress={() => setShowPicker(false)}>
          <Pressable style={styles.pickerSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.pickerHeader}>
              <Icon name="auto-stories" size={24} color="#7c3aed" />
              <Text style={styles.pickerTitle}>Apply Scholar Discount</Text>
            </View>
            <Text style={styles.pickerSubtitle}>
              Discount applies to only 1 plot. Choose which plot should receive the Aalim / Hafiz rate:
            </Text>
            <ScrollView style={styles.pickerList}>
              {selectedPlots.map((p) => {
                const isActive = scholarPlotId === p._id;
                return (
                  <TouchableOpacity
                    key={p._id}
                    style={[styles.pickerItem, isActive && styles.pickerItemActive]}
                    onPress={() => confirmScholarPick(p._id)}
                  >
                    <View style={styles.pickerItemLeft}>
                      <Text style={[styles.pickerPlotNo, isActive && styles.pickerPlotNoActive]}>
                        Plot No. {p.plotNumber}
                      </Text>
                      <Text style={styles.pickerArea}>
                        {p.areaSqFt ? `${Number(p.areaSqFt).toLocaleString()} sq ft` : '—'}
                      </Text>
                    </View>
                    {isActive && <Icon name="check-circle" size={24} color="#059669" />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity style={styles.pickerCancel} onPress={() => setShowPicker(false)}>
              <Text style={styles.pickerCancelText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

function SummaryTile({ label, value, styles }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue}>{value}</Text>
    </View>
  );
}

function Cell({ text, width, header = false, styles }) {
  return (
    <View style={[styles.cell, { width }]}>
      <Text style={header ? styles.cellTextHeader : styles.cellText}>{text}</Text>
    </View>
  );
}

const getStyles = (colors, isDark) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
    scrollContent: { padding: 16, paddingBottom: 24 },
    headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
    title: { fontSize: 22, fontWeight: '900', color: colors.text },
    countPill: {
      minWidth: 36,
      height: 30,
      borderRadius: 15,
      backgroundColor: '#f59e0b',
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 10,
    },
    countPillText: { color: '#0f172a', fontWeight: '900', fontSize: 14 },
    toggleRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
    toggleBtn: {
      flex: 1,
      borderRadius: 12,
      minHeight: 40,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1.5,
      paddingHorizontal: 8,
    },
    toggleBtnInactive: {
      backgroundColor: isDark ? '#111827' : '#f8fafc',
      borderColor: isDark ? '#374151' : '#cbd5e1',
    },
    toggleBtnActiveRegular: {
      backgroundColor: '#facc15',
      borderColor: '#ca8a04',
      borderWidth: 2,
    },
    toggleBtnActiveScholar: {
      backgroundColor: '#34d399',
      borderColor: '#059669',
      borderWidth: 2,
    },
    toggleText: { color: colors.textSecondary, fontWeight: '800', fontSize: 12, textAlign: 'center' },
    toggleTextActive: { color: '#0f172a', fontWeight: '900' },

    // ── Scholar banner ──
    scholarBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: isDark ? '#052e16' : '#ecfdf5',
      borderWidth: 1.5,
      borderColor: isDark ? '#059669' : '#a7f3d0',
      borderRadius: 12,
      paddingVertical: 10,
      paddingHorizontal: 12,
      marginBottom: 10,
      gap: 8,
    },
    scholarBannerText: {
      flex: 1,
      fontSize: 13,
      fontWeight: '700',
      color: isDark ? '#a7f3d0' : '#065f46',
    },
    scholarChangeBtn: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 8,
      backgroundColor: isDark ? '#065f46' : '#d1fae5',
    },
    scholarChangeBtnText: {
      fontSize: 12,
      fontWeight: '800',
      color: isDark ? '#ecfdf5' : '#047857',
    },

    summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
    tile: {
      width: '48%',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      padding: 10,
    },
    tileLabel: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
    tileValue: { marginTop: 5, fontSize: 14, fontWeight: '900', color: colors.text },
    tableOuter: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderRadius: 12,
    },
    tableHorizontalScroll: {},
    tableHorizontalContent: { flexGrow: 0 },
    tableRow: {
      flexDirection: 'row',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: isDark ? '#334155' : '#e2e8f0',
      minHeight: 42,
    },
    tableHeader: {
      backgroundColor: isDark ? '#312e81' : '#1e3a8a',
      borderBottomWidth: 1.5,
      borderBottomColor: isDark ? '#6366f1' : '#3b82f6',
    },
    scholarRow: {
      backgroundColor: isDark ? '#052e16' : '#f0fdf4',
    },
    cell: {
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 6,
      paddingVertical: 8,
    },
    cellTextHeader: {
      fontSize: 11,
      fontWeight: '800',
      color: '#f8fafc',
      textTransform: 'uppercase',
      letterSpacing: 0.3,
    },
    cellText: { fontSize: 12, fontWeight: '700', color: colors.text, textAlign: 'center' },

    // ── Plot picker modal ──
    pickerOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      justifyContent: 'center',
      paddingHorizontal: 22,
    },
    pickerSheet: {
      backgroundColor: colors.surface,
      borderRadius: 20,
      padding: 22,
      maxWidth: 420,
      alignSelf: 'center',
      width: '100%',
      borderWidth: 1,
      borderColor: colors.border,
    },
    pickerHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginBottom: 6,
    },
    pickerTitle: {
      fontSize: 19,
      fontWeight: '800',
      color: colors.text,
    },
    pickerSubtitle: {
      fontSize: 13,
      color: colors.textSecondary,
      fontWeight: '600',
      lineHeight: 19,
      marginBottom: 16,
    },
    pickerList: { maxHeight: 320 },
    pickerItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 14,
      paddingHorizontal: 14,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: isDark ? '#334155' : '#e2e8f0',
      marginBottom: 8,
      backgroundColor: isDark ? '#1e293b' : '#f8fafc',
    },
    pickerItemActive: {
      borderColor: '#059669',
      borderWidth: 2,
      backgroundColor: isDark ? '#052e16' : '#ecfdf5',
    },
    pickerItemLeft: { flex: 1 },
    pickerPlotNo: {
      fontSize: 16,
      fontWeight: '800',
      color: colors.text,
    },
    pickerPlotNoActive: {
      color: '#059669',
    },
    pickerArea: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
      marginTop: 2,
    },
    pickerCancel: {
      marginTop: 12,
      paddingVertical: 14,
      borderRadius: 14,
      alignItems: 'center',
      backgroundColor: isDark ? '#334155' : '#f1f5f9',
    },
    pickerCancelText: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textSecondary,
    },
  });

export default MultiPlotSummaryScreen;
