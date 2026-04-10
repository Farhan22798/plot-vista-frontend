import React, { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  Modal,
  ScrollView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '../services/api';
import socket from '../services/socket';
import { useTheme } from '../context/ThemeContext';
import { useOnAppForeground } from '../hooks/useOnAppForeground';
import { useAlert } from '../context/AlertContext';
import Orientation from 'react-native-orientation-locker';

const COL_PLOT = 52;
const COL_AREA = 80;
const COL_NUM = 140;
const COL_ADV = 115;
const COL_EMI = 110;
const COL_SCHOLAR = 46;
const ROW_WIDTH = COL_PLOT + COL_AREA + COL_NUM + COL_ADV + COL_NUM + COL_EMI + COL_NUM + COL_SCHOLAR;

const REGULAR_EMI_RATE = 513.3333333333333;
const REGULAR_CASH_RATE = 433.33333333333333;
const SCHOLAR_EMI_RATE = 462;
const SCHOLAR_CASH_RATE = 390;
const EMI_MONTHS = 36;

function computePricing(areaSqFt) {
  if (!areaSqFt) return null;
  const regTotal = Math.round(areaSqFt * REGULAR_EMI_RATE);
  const regAdv = areaSqFt <= 900 ? 20000 : 40000;
  const regEmi = Math.round((regTotal - regAdv) / EMI_MONTHS);
  const regCash = Math.round(areaSqFt * REGULAR_CASH_RATE);

  const schTotal = Math.round(areaSqFt * SCHOLAR_EMI_RATE);
  const schAdv = areaSqFt <= 900 ? 18000 : 36000;
  const schEmi = Math.round((schTotal - schAdv) / EMI_MONTHS);
  const schCash = Math.round(areaSqFt * SCHOLAR_CASH_RATE);

  return {
    regular: { total: regTotal, advance: regAdv, balance: regTotal - regAdv, emi: regEmi, cash: regCash },
    scholar: { total: schTotal, advance: schAdv, balance: schTotal - schAdv, emi: schEmi, cash: schCash },
  };
}

function fmt(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString('en-IN');
}

function fmtRs(n) {
  if (n == null) return '—';
  return `₹${Number(n).toLocaleString('en-IN')}/-`;
}

const AreaStatementScreen = () => {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isLandscape = windowWidth > windowHeight;
  const isLandscapeRef = useRef(isLandscape);
  isLandscapeRef.current = isLandscape;

  const { colors, isDark } = useTheme();
  const styles = React.useMemo(() => getStyles(colors, isDark), [colors, isDark]);
  const { showAlert } = useAlert();

  const landscapeTableMinHeight = Math.max(280, windowHeight - insets.top - insets.bottom);

  const defaultTabBarStyle = useMemo(
    () => ({
      paddingBottom: 2,
      paddingTop: 2,
      height: 74,
      backgroundColor: colors.surface,
      borderTopColor: colors.border,
    }),
    [colors.surface, colors.border]
  );

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

  const enterFullscreen = useCallback(() => {
    manualFullscreenRef.current = true;
    Orientation.lockToLandscapeLeft();
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

  const applyAreaStatementChrome = useCallback(() => {
    if (!navigation.isFocused()) return;
    if (isLandscapeRef.current) {
      navigation.setOptions({
        tabBarStyle: tabBarHiddenStyle,
        headerShown: false,
        headerRight: undefined,
      });
    } else {
      navigation.setOptions({
        tabBarStyle: defaultTabBarStyle,
        headerShown: true,
        headerRight: () => (
          <TouchableOpacity
            style={styles.headerFullscreenBtn}
            onPress={enterFullscreen}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Enter fullscreen"
          >
            <Icon name="fullscreen" size={20} color={colors.primary} />
          </TouchableOpacity>
        ),
      });
    }
  }, [navigation, defaultTabBarStyle, tabBarHiddenStyle, styles.headerFullscreenBtn, enterFullscreen, colors.primary]);

  useLayoutEffect(() => {
    applyAreaStatementChrome();
  }, [isLandscape, applyAreaStatementChrome]);

  const [plots, setPlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scholarPlot, setScholarPlot] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const manualFullscreenRef = useRef(false);

  const fetchPlots = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const res = await api.get('/');
      const sorted = (res.data || [])
        .map((p) => ({ ...p, _numPlot: parseInt(p.plotNumber, 10) || 0 }))
        .sort((a, b) => a._numPlot - b._numPlot);
      setPlots(sorted);
    } catch (err) {
      if (!silent) showAlert('Error', 'Could not load plot data.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [showAlert]);

  useEffect(() => {
    fetchPlots();
  }, [fetchPlots]);

  useFocusEffect(
    useCallback(() => {
      fetchPlots(true);
      applyAreaStatementChrome();
      return () => {
        // Only unlock when screen is actually losing focus/unmounting.
        if (!navigation.isFocused() && manualFullscreenRef.current) {
          manualFullscreenRef.current = false;
          Orientation.lockToPortrait();
        }
        navigation.setOptions({
          tabBarStyle: defaultTabBarStyle,
          headerShown: true,
        });
      };
    }, [fetchPlots, navigation, defaultTabBarStyle, applyAreaStatementChrome])
  );

  useOnAppForeground(
    useCallback(() => {
      if (!socket.connected) socket.connect();
      fetchPlots(true);
    }, [fetchPlots])
  );

  useEffect(() => {
    socket.connect();
    const onPlotUpdated = (updatedPlot) => {
      if (!updatedPlot?._id) return;
      setPlots((prev) => {
        const idx = prev.findIndex((p) => String(p._id) === String(updatedPlot._id));
        if (idx === -1) return prev;
        const row = {
          ...updatedPlot,
          _numPlot: parseInt(updatedPlot.plotNumber, 10) || 0,
        };
        const next = [...prev];
        next[idx] = row;
        next.sort((a, b) => a._numPlot - b._numPlot);
        return next;
      });
    };
    socket.on('plotUpdated', onPlotUpdated);
    return () => socket.off('plotUpdated', onPlotUpdated);
  }, []);

  const toggleSelect = useCallback((id) => {
    setSelectedId((prev) => (prev === id ? null : id));
  }, []);

  const renderRow = ({ item, index }) => {
    const area = item.areaSqFt || item.categoryPricing?.regular?.totalPlotCost / REGULAR_EMI_RATE;
    const pricing = computePricing(area);
    if (!pricing) return null;
    const r = pricing.regular;
    const isEven = index % 2 === 0;
    const rowId = item._id || item.plotNumber;
    const isSelected = selectedId === rowId;

    return (
      <Pressable
        onPress={() => toggleSelect(rowId)}
        style={[
          styles.row,
          isEven ? styles.rowEven : styles.rowOdd,
          isSelected && styles.rowSelected,
        ]}
      >
        <View style={[styles.gridCell, styles.cellPlotW]}>
          <Text style={[styles.cell, styles.cellPlotTxt]} numberOfLines={1}>{item.plotNumber}</Text>
        </View>
        <View style={[styles.gridCell, styles.cellAreaW]}>
          <Text style={[styles.cell, styles.cellAreaTxt]} numberOfLines={1}>{fmt(area)}</Text>
        </View>
        <View style={[styles.gridCell, styles.cellNumW]}>
          <Text style={[styles.cell, styles.cellNumTxt]} numberOfLines={1}>{fmtRs(r.total)}</Text>
        </View>
        <View style={[styles.gridCell, styles.cellAdvW]}>
          <Text style={[styles.cell, styles.cellNumTxt]} numberOfLines={1}>{fmtRs(r.advance)}</Text>
        </View>
        <View style={[styles.gridCell, styles.cellNumW]}>
          <Text style={[styles.cell, styles.cellNumTxt]} numberOfLines={1}>{fmtRs(r.balance)}</Text>
        </View>
        <View style={[styles.gridCell, styles.cellEmiW]}>
          <Text style={[styles.cell, styles.cellNumTxt]} numberOfLines={1}>{fmtRs(r.emi)}</Text>
        </View>
        <View style={[styles.gridCell, styles.cellNumW, styles.gridCellLast]}>
          <Text style={[styles.cell, styles.cellNumTxt]} numberOfLines={1}>{fmtRs(r.cash)}</Text>
        </View>
        <TouchableOpacity
          style={styles.scholarBtn}
          onPress={() => setScholarPlot({ plotNumber: item.plotNumber, area, pricing })}
        >
          <Icon name="auto-stories" size={20} color="#7c3aed" />
        </TouchableOpacity>
      </Pressable>
    );
  };

  const header = (
    <View style={styles.headerRow}>
      <View style={[styles.headerGridCell, styles.cellPlotW]}>
        <Text style={styles.headerCell}>{'Plot\nNo.'}</Text>
      </View>
      <View style={[styles.headerGridCell, styles.cellAreaW]}>
        <Text style={styles.headerCell}>{'Area\n(in Sq. Ft.)'}</Text>
      </View>
      <View style={[styles.headerGridCell, styles.cellNumW]}>
        <Text style={styles.headerCell}>Price</Text>
      </View>
      <View style={[styles.headerGridCell, styles.cellAdvW]}>
        <Text style={styles.headerCell}>Advance</Text>
      </View>
      <View style={[styles.headerGridCell, styles.cellNumW]}>
        <Text style={styles.headerCell}>{'Balance\nFor EMI'}</Text>
      </View>
      <View style={[styles.headerGridCell, styles.cellEmiW]}>
        <Text style={styles.headerCell}>EMI</Text>
      </View>
      <View style={[styles.headerGridCell, styles.cellNumW, styles.gridCellLast]}>
        <Text style={styles.headerCell}>Cash</Text>
      </View>
      <View style={styles.scholarBtnHeader} />
    </View>
  );

  const scholarData = scholarPlot?.pricing?.scholar;

  const mainTable = (compact) => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator
      style={[styles.horizontalTableHost, compact && styles.horizontalTableHostLandscape]}
      contentContainerStyle={styles.horizontalTableContent}
    >
      <View
        style={[
          styles.tableWrapper,
          compact && styles.tableWrapperLandscape,
          compact && { minHeight: landscapeTableMinHeight },
        ]}
      >
        {header}
        <FlatList
          data={plots}
          keyExtractor={(item) => item._id || item.plotNumber}
          renderItem={renderRow}
          extraData={selectedId}
          nestedScrollEnabled
          initialNumToRender={30}
          maxToRenderPerBatch={40}
          windowSize={10}
          style={compact ? styles.flatListFill : undefined}
          contentContainerStyle={compact ? styles.flatListContentLandscape : undefined}
          getItemLayout={(_, index) => ({ length: 48, offset: 48 * index, index })}
        />
      </View>
    </ScrollView>
  );

  return (
    <View style={styles.container}>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : isLandscape ? (
        <SafeAreaView
          style={[styles.landscapeTableSafe, { backgroundColor: colors.background }]}
          edges={['top', 'left', 'right', 'bottom']}
        >
          <View style={styles.landscapeActionBar}>
            <TouchableOpacity
              style={[styles.landscapeActionBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onPress={toggleFullscreen}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Exit fullscreen"
            >
              <Icon name="fullscreen-exit" size={18} color={colors.primary} />
              <Text style={styles.landscapeActionText}>Exit fullscreen</Text>
            </TouchableOpacity>
          </View>
          {mainTable(true)}
        </SafeAreaView>
      ) : (
        mainTable(false)
      )}

      <Modal
        visible={Boolean(scholarPlot)}
        transparent
        animationType="fade"
        onRequestClose={() => setScholarPlot(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setScholarPlot(null)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHeader}>
              <Icon name="auto-stories" size={26} color="#7c3aed" />
              <Text style={styles.modalTitle}>Aalim / Hafiz Discount</Text>
            </View>
            <Text style={styles.modalPlot}>
              Plot No. {scholarPlot?.plotNumber} · {fmt(scholarPlot?.area)} sq ft
            </Text>

            <View style={styles.compareTable}>
              <View style={styles.compareHeaderRow}>
                <View style={[styles.compareCellWrap, styles.compareLabelWrap]}>
                  <Text style={[styles.compareHeaderCell, styles.compareLabelTxt]} />
                </View>
                <View style={styles.compareCellWrap}>
                  <Text style={styles.compareHeaderCell}>Regular</Text>
                </View>
                <View style={styles.compareCellWrap}>
                  <Text style={[styles.compareHeaderCell, styles.compareScholar]}>Scholar</Text>
                </View>
              </View>

              {[
                ['Total Price', scholarPlot?.pricing?.regular?.total, scholarData?.total],
                ['Advance', scholarPlot?.pricing?.regular?.advance, scholarData?.advance],
                ['Balance For EMI', scholarPlot?.pricing?.regular?.balance, scholarData?.balance],
                [`EMI (${EMI_MONTHS}m)`, scholarPlot?.pricing?.regular?.emi, scholarData?.emi],
              ].map(([label, reg, sch]) => (
                <View key={label} style={styles.compareRow}>
                  <View style={[styles.compareCellWrap, styles.compareLabelWrap]}>
                    <Text style={[styles.compareCell, styles.compareLabelTxt]}>{label}</Text>
                  </View>
                  <View style={styles.compareCellWrap}>
                    <Text style={styles.compareCell}>{fmtRs(reg)}</Text>
                  </View>
                  <View style={styles.compareCellWrap}>
                    <Text style={[styles.compareCell, styles.compareScholar]}>{fmtRs(sch)}</Text>
                  </View>
                </View>
              ))}

              <View style={styles.savingsRow}>
                <View style={[styles.compareCellWrap, styles.compareLabelWrap]}>
                  <Text style={[styles.savingsCell, styles.savingsLabel]}>You Save on EMI</Text>
                </View>
                <View style={styles.compareCellWrap}>
                  <Text style={styles.savingsCell}>—</Text>
                </View>
                <View style={styles.compareCellWrap}>
                  <Text style={[styles.savingsCell, styles.savingsValue]}>
                    {fmtRs((scholarPlot?.pricing?.regular?.total || 0) - (scholarData?.total || 0))}
                  </Text>
                </View>
              </View>

              <View style={styles.compareDivider} />

              <View style={styles.compareRow}>
                <View style={[styles.compareCellWrap, styles.compareLabelWrap]}>
                  <Text style={[styles.compareCell, styles.compareLabelTxt]}>Cash Price</Text>
                </View>
                <View style={styles.compareCellWrap}>
                  <Text style={styles.compareCell}>{fmtRs(scholarPlot?.pricing?.regular?.cash)}</Text>
                </View>
                <View style={styles.compareCellWrap}>
                  <Text style={[styles.compareCell, styles.compareScholar]}>{fmtRs(scholarData?.cash)}</Text>
                </View>
              </View>

              <View style={styles.savingsRow}>
                <View style={[styles.compareCellWrap, styles.compareLabelWrap]}>
                  <Text style={[styles.savingsCell, styles.savingsLabel]}>You Save on Cash</Text>
                </View>
                <View style={styles.compareCellWrap}>
                  <Text style={[styles.savingsCell, styles.savingsValue]}>
                    {fmtRs((scholarPlot?.pricing?.regular?.total || 0) - (scholarPlot?.pricing?.regular?.cash || 0))}
                  </Text>
                </View>
                <View style={styles.compareCellWrap}>
                  <Text style={[styles.savingsCell, styles.savingsValue]}>
                    {fmtRs((scholarPlot?.pricing?.regular?.total || 0) - (scholarData?.cash || 0))}
                  </Text>
                </View>
              </View>
            </View>

            <TouchableOpacity style={styles.modalClose} onPress={() => setScholarPlot(null)}>
              <Text style={styles.modalCloseText}>Close</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

function getStyles(colors, isDark) {
  const tableHeaderBg = isDark ? '#312e81' : '#1e3a8a';
  const modalHeaderBg = isDark ? '#1e293b' : '#0f172a';
  const borderColor = isDark ? '#334155' : '#e2e8f0';

  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

    landscapeTableSafe: { flex: 1 },
    horizontalTableHost: { flex: 1 },
    horizontalTableHostLandscape: { flex: 1, marginHorizontal: 0 },
    horizontalTableContent: { flexGrow: 1 },
    flatListFill: { flex: 1 },
    flatListContentLandscape: { flexGrow: 1, paddingBottom: 8 },

    titleBar: {
      paddingHorizontal: 12,
      paddingTop: Platform.OS === 'ios' ? 8 : 4,
      paddingBottom: 8,
    },
    title: {
      fontSize: 20,
      fontWeight: '800',
      color: colors.text,
      letterSpacing: 0.3,
    },
    subtitle: {
      fontSize: 12,
      color: colors.textSecondary,
      fontWeight: '600',
      marginTop: 2,
    },
    headerFullscreenBtn: {
      width: 36,
      height: 36,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 4,
    },
    landscapeActionBar: {
      paddingHorizontal: 12,
      paddingTop: 6,
      paddingBottom: 6,
      alignItems: 'flex-end',
    },
    landscapeActionBtn: {
      minHeight: 34,
      paddingHorizontal: 10,
      borderRadius: 10,
      borderWidth: 1.5,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    landscapeActionText: {
      fontSize: 12,
      fontWeight: '800',
      color: colors.text,
    },

    // ── Horizontal scroll wrapper ──
    tableWrapper: {
      width: ROW_WIDTH,
      flex: 1,
    },
    tableWrapperLandscape: {
      flex: 1,
    },

    // ── Table header ──
    headerRow: {
      flexDirection: 'row',
      alignItems: 'stretch',
      backgroundColor: tableHeaderBg,
      width: ROW_WIDTH,
      minHeight: 48,
      borderBottomWidth: 2,
      borderBottomColor: isDark ? '#6366f1' : '#3b82f6',
    },
    headerGridCell: {
      justifyContent: 'center',
      alignItems: 'center',
      borderRightWidth: 1,
      borderRightColor: isDark ? '#4f46e5' : '#2563eb',
      paddingVertical: 6,
      paddingHorizontal: 2,
    },
    headerCell: {
      fontSize: 13,
      fontWeight: '800',
      color: '#f8fafc',
      textAlign: 'center',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },

    // ── Table rows ──
    row: {
      flexDirection: 'row',
      alignItems: 'stretch',
      height: 48,
      width: ROW_WIDTH,
      borderBottomWidth: 1,
      borderBottomColor: borderColor,
    },
    rowEven: { backgroundColor: isDark ? '#0f172a' : '#f8fafc' },
    rowOdd: { backgroundColor: isDark ? '#1e293b' : '#ffffff' },
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

    // ── Grid cell wrapper (vertical borders, centered content) ──
    gridCell: {
      justifyContent: 'center',
      alignItems: 'center',
      borderRightWidth: 1,
      borderRightColor: borderColor,
      paddingHorizontal: 4,
    },
    gridCellLast: {
      borderRightWidth: 0,
    },

    // ── Column widths ──
    cellPlotW: { width: COL_PLOT },
    cellAreaW: { width: COL_AREA },
    cellNumW: { width: COL_NUM },
    cellAdvW: { width: COL_ADV },
    cellEmiW: { width: COL_EMI },

    // ── Cell text styles ──
    cellPlotTxt: { textAlign: 'center', fontWeight: '900' },
    cellAreaTxt: { textAlign: 'center' },
    cellNumTxt: { textAlign: 'center' },

    cell: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
      textAlign: 'center',
    },

    // ── Scholar button ──
    scholarBtn: {
      width: COL_SCHOLAR - 4,
      height: 38,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? '#2e1065' : '#f3e8ff',
      marginLeft: 2,
    },
    scholarBtnHeader: { width: COL_SCHOLAR },

    // ── Scholar modal ──
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      justifyContent: 'center',
      paddingHorizontal: 20,
    },
    modalSheet: {
      backgroundColor: colors.surface,
      borderRadius: 20,
      padding: 22,
      maxWidth: 440,
      alignSelf: 'center',
      width: '100%',
      borderWidth: 1,
      borderColor,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginBottom: 6,
    },
    modalTitle: {
      fontSize: 19,
      fontWeight: '800',
      color: colors.text,
    },
    modalPlot: {
      fontSize: 15,
      color: colors.textSecondary,
      fontWeight: '600',
      marginBottom: 14,
      textAlign: 'center',
    },

    // ── Compare table ──
    compareTable: {
      borderWidth: 1.5,
      borderColor,
      borderRadius: 14,
      overflow: 'hidden',
    },
    compareHeaderRow: {
      flexDirection: 'row',
      backgroundColor: modalHeaderBg,
    },
    compareCellWrap: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: 12,
      paddingHorizontal: 4,
    },
    compareLabelWrap: {
      alignItems: 'flex-start',
      paddingLeft: 12,
    },
    compareHeaderCell: {
      fontSize: 13,
      fontWeight: '800',
      color: '#f8fafc',
      textAlign: 'center',
    },
    compareRow: {
      flexDirection: 'row',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: borderColor,
    },
    compareCell: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
      textAlign: 'center',
    },
    compareLabelTxt: {
      textAlign: 'left',
      fontWeight: '700',
      color: colors.textSecondary,
      fontSize: 13,
    },
    compareScholar: {
      color: '#7c3aed',
      fontWeight: '800',
    },
    compareDivider: {
      height: 2,
      backgroundColor: isDark ? '#334155' : '#e2e8f0',
    },
    savingsRow: {
      flexDirection: 'row',
      backgroundColor: isDark ? '#052e16' : '#f0fdf4',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: borderColor,
    },
    savingsCell: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textSecondary,
      textAlign: 'center',
    },
    savingsLabel: {
      textAlign: 'left',
      fontWeight: '800',
      color: '#16a34a',
      fontSize: 13,
    },
    savingsValue: {
      color: '#16a34a',
      fontWeight: '900',
      fontSize: 15,
    },

    modalClose: {
      marginTop: 16,
      paddingVertical: 14,
      borderRadius: 14,
      alignItems: 'center',
      backgroundColor: isDark ? '#334155' : '#f1f5f9',
    },
    modalCloseText: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textSecondary,
    },
  });
}

export default AreaStatementScreen;
