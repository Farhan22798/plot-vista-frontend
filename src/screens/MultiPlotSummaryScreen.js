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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useOnAppForeground } from '../hooks/useOnAppForeground';
import api from '../services/api';
import socket from '../services/socket';
import { useTheme } from '../context/ThemeContext';
import { useAlert } from '../context/AlertContext';
import { numOrZero } from '../utils/formatting';
import { resolveScholarPricing, resolveRegularPricing } from '../utils/pricingHelpers';
import { STATUS_LABELS } from '../constants/statusColors';
import {
  EMI_INSTALLMENTS_LABEL,
  PlotDetailsEmiSchedule,
  PricingStatRow,
  PricingStatTextRow,
  EmiRupeeText,
  fmtRsInr,
  createPlotDetailsPricingStyles,
} from '../components/plotDetailsPricingUi';

const COL = {
  sr: 48,
  plot: 72,
  status: 86,
  area: 86,
  totalCost: 116,
  advance: 104,
  balance: 120,
  emi: 136,
  cash: 116,
};

const TABLE_MIN_CONTENT_WIDTH = Object.values(COL).reduce((a, w) => a + w, 0);

const MultiPlotSummaryScreen = () => {
  const route = useRoute();
  const { selectedPlotIds = [] } = route.params || {};
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => {
    const shared = createPlotDetailsPricingStyles(colors, isDark);
    const local = getExtraStyles(colors, isDark);
    return { ...shared, ...local };
  }, [colors, isDark]);
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
    } else if (selectedPlots.length === 1) {
      setScholarPlotId(selectedPlots[0]._id);
    } else {
      setShowPicker(true);
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
        const total = numOrZero(cat.totalPlotCost);
        const adv = numOrZero(cat.advance);
        const emiRaw = cat.emiAmount;
        const emiNum =
          emiRaw != null && !Number.isNaN(Number(emiRaw)) ? Number(emiRaw) : null;
        const lastRaw = cat.lastEmiAmount;
        const lastNum =
          lastRaw != null && !Number.isNaN(Number(lastRaw)) ? Number(lastRaw) : null;
        return {
          id: p._id,
          plotNumber: p.plotNumber,
          areaSqFt: p.areaSqFt,
          totalPlotCost: cat.totalPlotCost,
          advance: cat.advance,
          emiAmount: emiNum,
          lastEmiAmount: lastNum,
          balanceForEmiRow: Number.isFinite(total) && Number.isFinite(adv) ? Math.max(0, total - adv) : null,
          cashOneTimePrice: cat.cashOneTimePrice,
          cashDiscount: cat.cashDiscount,
          status: p.status,
          isScholar: useScholar,
        };
      }),
    [selectedPlots, scholarPlotId]
  );

  const plotNumbersJoined = useMemo(
    () => tableRows.map((r) => String(r.plotNumber)).join(', '),
    [tableRows]
  );

  /** Combined month 1–35 = sum(emi); month 36 = sum(lastEmi ?? emi). ×36-only plots use emi every month. */
  const combinedEmiSchedule = useMemo(() => {
    if (tableRows.length === 0) {
      return { sumEmi: null, sumMonth36: null, allEqual36: true };
    }
    let sumEmi = 0;
    let sumMonth36 = 0;
    let hasEmi = false;
    let allEqual36 = true;
    for (const r of tableRows) {
      const emi = r.emiAmount != null ? Number(r.emiAmount) : NaN;
      if (Number.isFinite(emi)) {
        hasEmi = true;
        sumEmi += emi;
      }
      if (r.lastEmiAmount != null && Number.isFinite(Number(r.lastEmiAmount))) {
        allEqual36 = false;
        sumMonth36 += Number(r.lastEmiAmount);
      } else if (Number.isFinite(emi)) {
        sumMonth36 += emi;
      }
    }
    return {
      sumEmi: hasEmi ? sumEmi : null,
      sumMonth36: hasEmi ? sumMonth36 : null,
      allEqual36,
    };
  }, [tableRows]);

  const totals = useMemo(() => {
    return tableRows.reduce(
      (acc, r) => ({
        areaSqFt: acc.areaSqFt + numOrZero(r.areaSqFt),
        totalPlotCost: acc.totalPlotCost + numOrZero(r.totalPlotCost),
        advance: acc.advance + numOrZero(r.advance),
        emiAmount: acc.emiAmount + numOrZero(r.emiAmount),
        cashOneTimePrice: acc.cashOneTimePrice + numOrZero(r.cashOneTimePrice),
        cashDiscount: acc.cashDiscount + numOrZero(r.cashDiscount),
      }),
      {
        areaSqFt: 0,
        totalPlotCost: 0,
        advance: 0,
        emiAmount: 0,
        cashOneTimePrice: 0,
        cashDiscount: 0,
      }
    );
  }, [tableRows]);

  const balanceForEmi =
    Number.isFinite(totals.totalPlotCost) && Number.isFinite(totals.advance)
      ? Math.max(0, totals.totalPlotCost - totals.advance)
      : null;

  const { width: windowWidth } = useWindowDimensions();
  const tableWidth = useMemo(
    () => Math.max(TABLE_MIN_CONTENT_WIDTH, windowWidth + 120),
    [windowWidth]
  );

  const pricingCardBandStyle = isScholarMode
    ? styles.pricingCardBandScholar
    : styles.pricingCardBandRegular;
  const pricingIconColor = isScholarMode
    ? isDark
      ? '#6ee7b7'
      : '#047857'
    : isDark
      ? '#fcd34d'
      : '#b45309';

  const countPillStyle = useMemo(
    () => ({
      backgroundColor: isDark ? '#1e293b' : '#f1f5f9',
      borderWidth: 1,
      borderColor: isDark ? '#94a3b8' : '#64748b',
    }),
    [isDark]
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const scholarPlot = isScholarMode ? selectedPlots.find((p) => p._id === scholarPlotId) : null;

  return (
    <View style={[styles.screenRoot, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.fixedPlotHeader,
          {
            paddingTop: Math.max(insets.top, 10),
            backgroundColor: colors.background,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <View style={styles.summaryRow}>
          <View style={[styles.summaryCard, styles.summaryCardPlot, styles.summaryCardPlotNumbersWrap]}>
            <Text style={styles.summaryCardLabelPlot}>Plot numbers</Text>
            <Text
              style={styles.summaryCardValuePlotNumbers}
              numberOfLines={4}
              ellipsizeMode="tail"
              adjustsFontSizeToFit
              minimumFontScale={0.42}
              maxFontSizeMultiplier={1.12}
            >
              {plotNumbersJoined || '—'}
            </Text>
          </View>
          <View style={[styles.summaryCard, styles.summaryCardArea]}>
            <Text style={styles.summaryCardLabelArea}>Total area (Sq. Ft.)</Text>
            <Text style={styles.summaryCardValueArea} numberOfLines={1}>
              {totals.areaSqFt > 0 ? totals.areaSqFt.toLocaleString('en-IN') : '—'}
            </Text>
          </View>
        </View>

        <View style={styles.rateBandRow}>
          <TouchableOpacity
            style={[
              styles.compactBandBtn,
              styles.compactBandBtn40,
              !isScholarMode ? styles.compactBandBtnActiveRegular : styles.compactBandBtnInactive,
            ]}
            onPress={() => setScholarPlotId(null)}
            activeOpacity={0.9}
          >
            <Icon
              name="person-outline"
              size={17}
              color={!isScholarMode ? '#0f172a' : colors.textSecondary}
            />
            <Text
              style={[styles.compactBandLabel, !isScholarMode && styles.compactBandTextActiveOnBright]}
              numberOfLines={1}
            >
              Regular
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.compactBandBtn,
              styles.compactBandBtn40,
              isScholarMode ? styles.compactBandBtnActiveScholar : styles.compactBandBtnInactive,
            ]}
            onPress={handleScholarToggle}
            activeOpacity={0.9}
            accessibilityLabel="Aalim, Hafiz, and Imam rates"
          >
            <Icon
              name="menu-book"
              size={17}
              color={isScholarMode ? '#052e16' : colors.textSecondary}
            />
            <Text
              style={[styles.compactBandLabel, isScholarMode && styles.compactBandTextActiveOnBright]}
              numberOfLines={1}
            >
              Aalim / Hafiz
            </Text>
          </TouchableOpacity>
          <View style={[styles.statusPillInline, countPillStyle]}>
            <Text
              style={[styles.statusPillInlineText, { color: colors.text }]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {tableRows.length === 1 ? '1 plot' : `${tableRows.length} plots`}
            </Text>
          </View>
        </View>

        {isScholarMode && scholarPlot ? (
          <View style={[styles.scholarBanner, { borderColor: isDark ? '#059669' : '#a7f3d0' }]}>
            <Icon name="auto-stories" size={18} color={isDark ? '#6ee7b7' : '#047857'} />
            <Text style={[styles.scholarBannerText, { color: isDark ? '#a7f3d0' : '#065f46' }]}>
              Scholar rate on Plot No. {scholarPlot.plotNumber} only
            </Text>
            <TouchableOpacity onPress={() => setShowPicker(true)} style={styles.scholarChangeBtn}>
              <Text style={styles.scholarChangeBtnText}>Change</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      <ScrollView
        style={styles.detailsScroll}
        contentContainerStyle={[
          styles.detailsScrollContent,
          { paddingBottom: Math.max(insets.bottom, 28) },
        ]}
        showsVerticalScrollIndicator
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
        }
        nestedScrollEnabled
      >
        {tableRows.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.emptyCardText, { color: colors.textSecondary }]}>
              No matching plots for this selection.
            </Text>
          </View>
        ) : (
          <>
            <View style={[styles.pricingCardModern, pricingCardBandStyle]}>
              <View style={styles.pricingCardModernHeader}>
                <View
                  style={[
                    styles.pricingCardIconWrap,
                    isScholarMode ? styles.pricingCardIconWrapScholar : styles.pricingCardIconWrapRegular,
                  ]}
                >
                  <Icon name="calendar-view-month" size={26} color={pricingIconColor} />
                </View>
                <Text style={styles.pricingCardModernTitle}>EMI Plan (combined)</Text>
              </View>
              <PricingStatRow label="Total" amount={totals.totalPlotCost} styles={styles} />
              <PricingStatRow label="Advance" amount={totals.advance} styles={styles} />
              <PricingStatRow label="Balance for EMI" amount={balanceForEmi} styles={styles} />
              <View style={styles.emiScheduleSection}>
                <Text style={styles.emiScheduleSectionLabel}>EMI schedule (combined)</Text>
                <View
                  style={[
                    styles.detailsEmiOuterBox,
                    isScholarMode ? styles.detailsEmiOuterBoxScholar : styles.detailsEmiOuterBoxRegular,
                  ]}
                >
                  <PlotDetailsEmiSchedule
                    emi={combinedEmiSchedule.sumEmi}
                    lastEmi={combinedEmiSchedule.allEqual36 ? null : combinedEmiSchedule.sumMonth36}
                    styles={styles}
                    isScholar={isScholarMode}
                  />
                </View>
              </View>
              <PricingStatTextRow label="Installments" value={EMI_INSTALLMENTS_LABEL} styles={styles} isLast />
            </View>

            <View style={[styles.pricingCardModern, pricingCardBandStyle, styles.pricingCardModernSpacing]}>
              <View style={styles.pricingCardModernHeader}>
                <View
                  style={[
                    styles.pricingCardIconWrap,
                    isScholarMode ? styles.pricingCardIconWrapScholar : styles.pricingCardIconWrapRegular,
                  ]}
                >
                  <Icon name="payments" size={26} color={pricingIconColor} />
                </View>
                <Text style={styles.pricingCardModernTitle}>One-time Cash (combined)</Text>
              </View>
              <PricingStatRow label="Cash rate" amount={totals.cashOneTimePrice} styles={styles} />
              <PricingStatRow label="Discount" amount={totals.cashDiscount} styles={styles} isLast />
            </View>

            <Text style={styles.sectionTitle}>Per-plot breakdown</Text>

            <View style={[styles.tableOuter, { borderColor: colors.border, backgroundColor: colors.surface }]}>
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
                    <Cell text={'Balance\nfor EMI'} width={COL.balance} header styles={styles} />
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
                      <View style={[styles.cell, styles.cellPlotInner, { width: COL.plot }]}>
                        <Text style={styles.cellText}>{String(r.plotNumber)}</Text>
                        {r.isScholar ? (
                          <Icon name="auto-stories" size={13} color={isDark ? '#6ee7b7' : '#047857'} />
                        ) : null}
                      </View>
                      <Cell
                        text={STATUS_LABELS[r.status] || r.status || '—'}
                        width={COL.status}
                        styles={styles}
                      />
                      <Cell
                        text={
                          r.areaSqFt != null && !Number.isNaN(Number(r.areaSqFt))
                            ? `${Number(r.areaSqFt).toLocaleString('en-IN')}`
                            : '—'
                        }
                        width={COL.area}
                        styles={styles}
                      />
                      <Cell text={fmtRsInr(r.totalPlotCost)} width={COL.totalCost} styles={styles} />
                      <Cell text={fmtRsInr(r.advance)} width={COL.advance} styles={styles} />
                      <Cell text={fmtRsInr(r.balanceForEmiRow)} width={COL.balance} styles={styles} />
                      <MultiPlotEmiCell
                        emi={r.emiAmount}
                        lastEmi={r.lastEmiAmount}
                        width={COL.emi}
                        styles={styles}
                        colors={colors}
                      />
                      <Cell text={fmtRsInr(r.cashOneTimePrice)} width={COL.cash} styles={styles} />
                    </View>
                  ))}
                </View>
              </ScrollView>
            </View>
          </>
        )}

        <View style={styles.scrollEndSpacer} />
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
                        {p.areaSqFt ? `${Number(p.areaSqFt).toLocaleString('en-IN')} sq ft` : '—'}
                      </Text>
                    </View>
                    {isActive ? <Icon name="check-circle" size={24} color="#059669" /> : null}
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

function Cell({ text, width, header = false, styles }) {
  return (
    <View style={[styles.cell, { width }]}>
      <Text style={header ? styles.cellTextHeader : styles.cellText} numberOfLines={header ? 3 : 4}>
        {text}
      </Text>
    </View>
  );
}

function MultiPlotEmiCell({ emi, lastEmi, width, styles, colors }) {
  if (emi == null || Number.isNaN(Number(emi))) {
    return (
      <View style={[styles.cell, styles.tableEmiCell, { width }]}>
        <Text style={[styles.cellEmiLine, { color: colors.text }]}>—</Text>
      </View>
    );
  }
  const hasSplit = lastEmi != null && Number.isFinite(Number(lastEmi));
  return (
    <View style={[styles.cell, styles.tableEmiCell, { width }]}>
      <View style={styles.cellEmiStack}>
        {hasSplit ? (
          <>
            <View style={styles.cellEmiAmtRow}>
              <EmiRupeeText style={[styles.cellEmiAmt, styles.cellEmiRupeeInRow]}>{fmtRsInr(emi)}</EmiRupeeText>
              <Text style={styles.cellEmiMult}>×35</Text>
            </View>
            <Text style={[styles.cellEmiTablePlus, { color: colors.textSecondary }]}>+</Text>
            <View style={styles.cellEmiAmtRow}>
              <EmiRupeeText style={[styles.cellEmiAmt, styles.cellEmiRupeeInRow]}>
                {fmtRsInr(lastEmi)}
              </EmiRupeeText>
              <Text style={styles.cellEmiMult}>×1</Text>
            </View>
          </>
        ) : (
          <View style={styles.cellEmiAmtRow}>
            <EmiRupeeText style={[styles.cellEmiAmt, styles.cellEmiRupeeInRow]}>{fmtRsInr(emi)}</EmiRupeeText>
            <Text style={styles.cellEmiMult}>×36</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function getExtraStyles(colors, isDark) {
  return StyleSheet.create({
    screenRoot: { flex: 1 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
    summaryCardPlotNumbersWrap: {
      minWidth: 0,
      flex: 1,
    },
    summaryCardValuePlotNumbers: {
      marginTop: 4,
      minWidth: 0,
      alignSelf: 'stretch',
      fontSize: 22,
      lineHeight: 26,
      fontWeight: '900',
      textAlign: 'center',
      color: isDark ? '#fef3c7' : '#78350f',
    },
    scholarBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: isDark ? '#052e16' : '#ecfdf5',
      borderWidth: 1.5,
      borderRadius: 12,
      paddingVertical: 10,
      paddingHorizontal: 12,
      marginTop: 8,
      gap: 8,
    },
    scholarBannerText: {
      flex: 1,
      fontSize: 13,
      fontWeight: '700',
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
    emptyCard: {
      borderRadius: 16,
      borderWidth: 1,
      padding: 20,
      alignItems: 'center',
    },
    emptyCardText: {
      fontSize: 15,
      fontWeight: '600',
      textAlign: 'center',
    },
    tableOuter: {
      borderWidth: 2,
      borderRadius: 18,
      overflow: 'hidden',
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: isDark ? 0.35 : 0.1,
          shadowRadius: 8,
        },
        android: { elevation: 3 },
      }),
    },
    tableHorizontalScroll: {},
    tableHorizontalContent: { flexGrow: 0 },
    tableRow: {
      flexDirection: 'row',
      alignItems: 'stretch',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: isDark ? '#334155' : '#e2e8f0',
      minHeight: 78,
    },
    tableHeader: {
      backgroundColor: isDark ? '#312e81' : '#1e3a8a',
      borderBottomWidth: 1.5,
      borderBottomColor: isDark ? '#6366f1' : '#3b82f6',
    },
    scholarRow: {
      backgroundColor: isDark ? 'rgba(52,211,153,0.12)' : '#f0fdf4',
    },
    cell: {
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 6,
      paddingVertical: 8,
    },
    cellPlotInner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
    },
    tableEmiCell: {
      paddingHorizontal: 2,
      justifyContent: 'center',
    },
    cellEmiStack: {
      width: '100%',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
    },
    cellEmiAmtRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      alignItems: 'center',
      alignContent: 'center',
      width: '100%',
      gap: 4,
    },
    cellEmiRupeeInRow: {
      flexShrink: 1,
      minWidth: 0,
      textAlign: 'center',
    },
    cellEmiAmt: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '800',
      color: colors.text,
      textAlign: 'center',
    },
    cellEmiMult: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '900',
      color: colors.textSecondary,
      flexShrink: 0,
    },
    cellEmiTablePlus: {
      width: '100%',
      textAlign: 'center',
      fontSize: 15,
      fontWeight: '900',
      lineHeight: 17,
      paddingVertical: 0,
    },
    cellEmiLine: {
      fontSize: 13,
      lineHeight: 17,
      fontWeight: '800',
      textAlign: 'center',
      width: '100%',
    },
    cellTextHeader: {
      fontSize: 11,
      fontWeight: '800',
      color: '#f8fafc',
      textTransform: 'uppercase',
      letterSpacing: 0.3,
      textAlign: 'center',
    },
    cellText: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.text,
      textAlign: 'center',
    },
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
}

export default MultiPlotSummaryScreen;
