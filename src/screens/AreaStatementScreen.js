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
const COL_NUM = 168;
const COL_ADV = 122;
const COL_EMI = 132;
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
    regular: {
      total: regTotal,
      advance: regAdv,
      balance: regTotal - regAdv,
      emi: regEmi,
      lastEmi: null,
      cash: regCash,
    },
    scholar: {
      total: schTotal,
      advance: schAdv,
      balance: schTotal - schAdv,
      emi: schEmi,
      lastEmi: null,
      cash: schCash,
    },
  };
}

/** Prefer Mongo-backed pricing (plot details / seed); fall back to area formula. */
function pricingFromServerPlot(item) {
  const reg = item.categoryPricing?.regular;
  if (reg == null || reg.totalPlotCost == null) return null;
  const total = Number(reg.totalPlotCost);
  const advance = Number(reg.advance);
  if (!Number.isFinite(total) || !Number.isFinite(advance)) return null;
  const balance = total - advance;
  const emi = Number(reg.emiAmount);
  const lastEmi =
    reg.lastEmiAmount != null && !Number.isNaN(Number(reg.lastEmiAmount))
      ? Number(reg.lastEmiAmount)
      : null;
  const cash = Number(reg.cashOneTimePrice);
  const sch = item.categoryPricing?.scholar;
  let scholar = null;
  if (sch && sch.totalPlotCost != null) {
    const st = Number(sch.totalPlotCost);
    const sa = Number(sch.advance);
    if (Number.isFinite(st) && Number.isFinite(sa)) {
      scholar = {
        total: st,
        advance: sa,
        balance: st - sa,
        emi: Number(sch.emiAmount),
        lastEmi:
          sch.lastEmiAmount != null && !Number.isNaN(Number(sch.lastEmiAmount))
            ? Number(sch.lastEmiAmount)
            : null,
        cash: Number(sch.cashOneTimePrice),
      };
    }
  }
  const out = {
    regular: {
      total,
      advance,
      balance,
      emi,
      lastEmi,
      cash,
    },
    scholar,
  };
  if (!out.scholar && item.areaSqFt) {
    const fb = computePricing(item.areaSqFt);
    if (fb) out.scholar = fb.scholar;
  }
  return out;
}

function fmt(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString('en-IN');
}

/**
 * Thin space + word joiner so `/-` stays attached to digits in layout engines
 * that ignore adjustsFontSizeToFit.
 */
function fmtRs(n) {
  if (n == null) return '—';
  return `₹${Number(n).toLocaleString('en-IN')}\u202F/\u2060-`;
}

/** Single-line rupee: shrinks font if needed so `₹…/-` does not break. */
function RupeeText({ style, children, ...rest }) {
  return (
    <Text
      style={style}
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.62}
      maxFontSizeMultiplier={1.2}
      {...rest}
    >
      {children}
    </Text>
  );
}

/** Scholar modal: EMI as bordered lines — amount and ×N clearly separated. */
function ScholarModalEmiColumn({ band, isScholar, styles }) {
  const amountStyle = [
    styles.compareCellAmount,
    isScholar ? styles.compareScholar : null,
  ];
  const pillTextStyle = [
    styles.modalEmiSuffixPillText,
    isScholar ? styles.compareScholar : null,
  ];
  if (!band || band.emi == null) {
    return <RupeeText style={amountStyle}>—</RupeeText>;
  }
  const Line = ({ amount, suffix, isLast }) => (
    <View style={[styles.modalEmiLineBox, isLast ? styles.modalEmiLineBoxLast : null]}>
      <RupeeText style={[amountStyle, styles.modalEmiAmountBlock]}>{fmtRs(amount)}</RupeeText>
      <View style={[styles.modalEmiSuffixPill, isScholar ? styles.modalEmiSuffixPillScholar : null]}>
        <Text style={pillTextStyle}>{suffix}</Text>
      </View>
    </View>
  );
  if (band.lastEmi != null) {
    return (
      <View style={styles.modalEmiColInner}>
        <Line amount={band.emi} suffix="×35" />
        <Text style={[styles.modalEmiPlus, isScholar ? styles.compareScholar : null]}>+</Text>
        <Line amount={band.lastEmi} suffix="×1" isLast />
      </View>
    );
  }
  return (
    <View style={styles.modalEmiColInner}>
      <Line amount={band.emi} suffix="×36" isLast />
    </View>
  );
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

  const manualFullscreenRef = useRef(false);

  const [plots, setPlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scholarPlot, setScholarPlot] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  /** One-tap: table shows only vacant (OPEN) plots. */
  const [openPlotsOnly, setOpenPlotsOnly] = useState(false);

  const openPlotCount = useMemo(
    () => plots.filter((p) => p.status === 'vacant').length,
    [plots],
  );

  const tablePlots = useMemo(
    () => (openPlotsOnly ? plots.filter((p) => p.status === 'vacant') : plots),
    [plots, openPlotsOnly],
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

  const toggleOpenPlotsOnly = useCallback(() => {
    setOpenPlotsOnly((v) => !v);
  }, []);

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
          <View style={styles.headerActionsRow}>
            <TouchableOpacity
              style={[
                styles.openFilterChipHeader,
                { borderColor: colors.border, backgroundColor: colors.surface },
                openPlotsOnly && [
                  styles.openFilterChipHeaderActive,
                  { borderColor: colors.primary },
                ],
              ]}
              onPress={toggleOpenPlotsOnly}
              activeOpacity={0.88}
              accessibilityRole="button"
              accessibilityState={{ selected: openPlotsOnly }}
              accessibilityLabel={
                openPlotsOnly
                  ? `Showing open plots only, ${tablePlots.length} plots. Tap to show all.`
                  : `Show open plots only. ${openPlotCount} open of ${plots.length} total.`
              }
            >
              <Icon
                name={openPlotsOnly ? 'filter-alt' : 'filter-alt-off'}
                size={17}
                color={openPlotsOnly ? colors.primary : colors.textSecondary}
              />
              <Text
                style={[
                  styles.openFilterChipHeaderText,
                  { color: openPlotsOnly ? colors.primary : colors.text },
                ]}
                numberOfLines={1}
              >
                {openPlotsOnly
                  ? `Open · ${tablePlots.length}`
                  : `Open (${openPlotCount})`}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.headerFullscreenBtn}
              onPress={enterFullscreen}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Enter fullscreen"
            >
              <Icon name="fullscreen" size={20} color={colors.primary} />
            </TouchableOpacity>
          </View>
        ),
      });
    }
  }, [
    navigation,
    defaultTabBarStyle,
    tabBarHiddenStyle,
    styles.headerActionsRow,
    styles.headerFullscreenBtn,
    styles.openFilterChipHeader,
    styles.openFilterChipHeaderActive,
    styles.openFilterChipHeaderText,
    enterFullscreen,
    toggleOpenPlotsOnly,
    colors.primary,
    colors.border,
    colors.surface,
    colors.text,
    colors.textSecondary,
    openPlotsOnly,
    openPlotCount,
    tablePlots.length,
    plots.length,
  ]);

  useLayoutEffect(() => {
    applyAreaStatementChrome();
  }, [isLandscape, applyAreaStatementChrome]);

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
    const fromServer = pricingFromServerPlot(item);
    const area =
      item.areaSqFt != null
        ? item.areaSqFt
        : item.categoryPricing?.regular?.totalPlotCost != null
          ? item.categoryPricing.regular.totalPlotCost / REGULAR_EMI_RATE
          : null;
    const pricing = fromServer || (area != null ? computePricing(area) : null);
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
          <Text style={[styles.cell, styles.cellPlotTxt]}>{item.plotNumber}</Text>
        </View>
        <View style={[styles.gridCell, styles.cellAreaW]}>
          <Text style={[styles.cell, styles.cellAreaTxt]}>{fmt(area)}</Text>
        </View>
        <View style={[styles.gridCell, styles.cellNumW]}>
          <RupeeText style={[styles.cell, styles.cellNumTxt, styles.cellMoneyText]}>{fmtRs(r.total)}</RupeeText>
        </View>
        <View style={[styles.gridCell, styles.cellAdvW]}>
          <RupeeText style={[styles.cell, styles.cellNumTxt, styles.cellMoneyText]}>{fmtRs(r.advance)}</RupeeText>
        </View>
        <View style={[styles.gridCell, styles.cellNumW]}>
          <RupeeText style={[styles.cell, styles.cellNumTxt, styles.cellMoneyText]}>{fmtRs(r.balance)}</RupeeText>
        </View>
        <View style={[styles.gridCell, styles.cellEmiW]}>
          <View style={styles.cellEmiStack}>
            {r.emi == null ? (
              <Text style={styles.cellEmiLine}>—</Text>
            ) : r.lastEmi != null ? (
              <>
                <View style={styles.cellEmiAmtRow}>
                  <RupeeText style={[styles.cellEmiAmt, styles.cellEmiRupeeInRow]}>{fmtRs(r.emi)}</RupeeText>
                  <Text style={styles.cellEmiMult}>×35</Text>
                </View>
                <Text style={styles.cellEmiTablePlus}>+</Text>
                <View style={styles.cellEmiAmtRow}>
                  <RupeeText style={[styles.cellEmiAmt, styles.cellEmiRupeeInRow]}>{fmtRs(r.lastEmi)}</RupeeText>
                  <Text style={styles.cellEmiMult}>×1</Text>
                </View>
              </>
            ) : (
              <View style={styles.cellEmiAmtRow}>
                <RupeeText style={[styles.cellEmiAmt, styles.cellEmiRupeeInRow]}>{fmtRs(r.emi)}</RupeeText>
                <Text style={styles.cellEmiMult}>×36</Text>
              </View>
            )}
          </View>
        </View>
        <View style={[styles.gridCell, styles.cellNumW, styles.gridCellLast]}>
          <RupeeText style={[styles.cell, styles.cellNumTxt, styles.cellMoneyText]}>{fmtRs(r.cash)}</RupeeText>
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
        <Text style={styles.headerCell}>{'AREA\n(in Sq. Ft.)'}</Text>
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
          data={tablePlots}
          keyExtractor={(item) => item._id || item.plotNumber}
          renderItem={renderRow}
          extraData={`${selectedId}-${openPlotsOnly}-${tablePlots.length}`}
          nestedScrollEnabled
          initialNumToRender={30}
          maxToRenderPerBatch={40}
          windowSize={10}
          style={compact ? styles.flatListFill : undefined}
          contentContainerStyle={compact ? styles.flatListContentLandscape : undefined}
          ListEmptyComponent={
            openPlotsOnly ? (
              <View style={styles.tableEmptyHint}>
                <Text style={[styles.tableEmptyHintText, { color: colors.textSecondary }]}>
                  No open plots right now.
                </Text>
              </View>
            ) : null
          }
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
              style={[
                styles.openFilterChipLandscape,
                { borderColor: colors.border, backgroundColor: colors.surface },
                openPlotsOnly && [
                  styles.openFilterChipLandscapeActive,
                  { borderColor: colors.primary },
                ],
              ]}
              onPress={toggleOpenPlotsOnly}
              activeOpacity={0.88}
              accessibilityRole="button"
              accessibilityState={{ selected: openPlotsOnly }}
              accessibilityLabel={
                openPlotsOnly
                  ? `Showing open plots only, ${tablePlots.length} plots. Tap to show all.`
                  : `Show open plots only. ${openPlotCount} open of ${plots.length} total.`
              }
            >
              <Icon
                name={openPlotsOnly ? 'filter-alt' : 'filter-alt-off'}
                size={17}
                color={openPlotsOnly ? colors.primary : colors.textSecondary}
              />
              <Text
                style={[
                  styles.openFilterChipLandscapeText,
                  { color: openPlotsOnly ? colors.primary : colors.text },
                ]}
                numberOfLines={1}
              >
                {openPlotsOnly
                  ? `Open · ${tablePlots.length}`
                  : `Open (${openPlotCount})`}
              </Text>
            </TouchableOpacity>
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
          <Pressable
            style={[
              styles.modalSheet,
              {
                maxHeight: Math.min(
                  windowHeight - insets.top - insets.bottom - 20,
                  680
                ),
              },
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalScrollContent}
              showsVerticalScrollIndicator
              bounces={false}
              nestedScrollEnabled
            >
            <View style={styles.modalHeader}>
              <Icon name="auto-stories" size={26} color="#7c3aed" />
              <Text style={styles.modalTitle}>Aalim / Hafiz Discount</Text>
            </View>

            <View style={styles.modalPlotHighlightRow}>
              <View style={[styles.modalPlotBadge, styles.modalPlotBadgePlot]}>
                <Text style={styles.modalPlotBadgeLabelPlot}>Plot number</Text>
                <Text style={styles.modalPlotBadgeValuePlot} numberOfLines={1}>
                  {scholarPlot?.plotNumber ?? '—'}
                </Text>
              </View>
              <View style={[styles.modalPlotBadge, styles.modalPlotBadgeAreaCard]}>
                <Text style={styles.modalPlotBadgeLabelArea}>AREA (in Sq. Ft.)</Text>
                <Text style={styles.modalPlotBadgeValueArea} numberOfLines={1}>
                  {scholarPlot?.area != null ? fmt(scholarPlot.area) : '—'}
                </Text>
              </View>
            </View>

            <View style={styles.compareTable}>
              <View style={styles.compareHeaderRow}>
                <View style={[styles.compareCellWrap, styles.compareLabelWrap]}>
                  <Text style={[styles.compareHeaderCell, styles.compareLabelTxt]} />
                </View>
                <View style={[styles.compareCellWrap, styles.compareHeaderColBorder]}>
                  <Text style={styles.compareHeaderCell}>Regular</Text>
                </View>
                <View style={[styles.compareCellWrap, styles.compareHeaderColBorder]}>
                  <Text style={[styles.compareHeaderCell, styles.compareScholar]}>Scholar</Text>
                </View>
              </View>

              {[
                ['Total Price', scholarPlot?.pricing?.regular?.total, scholarData?.total],
                ['Advance', scholarPlot?.pricing?.regular?.advance, scholarData?.advance],
                ['Balance For EMI', scholarPlot?.pricing?.regular?.balance, scholarData?.balance],
              ].map(([label, reg, sch]) => (
                <View key={label} style={styles.compareRow}>
                  <View style={[styles.compareCellWrap, styles.compareLabelWrap]}>
                    <Text style={[styles.compareCell, styles.compareLabelTxt]}>{label}</Text>
                  </View>
                  <View style={[styles.compareCellWrap, styles.compareColBorder]}>
                    <RupeeText style={styles.compareCellAmount}>{fmtRs(reg)}</RupeeText>
                  </View>
                  <View style={[styles.compareCellWrap, styles.compareColBorder]}>
                    <RupeeText style={[styles.compareCellAmount, styles.compareScholar]}>{fmtRs(sch)}</RupeeText>
                  </View>
                </View>
              ))}

              <View style={[styles.compareRow, styles.compareRowEmi]}>
                <View style={[styles.compareCellWrap, styles.compareLabelWrap]}>
                  <Text style={[styles.compareCell, styles.compareLabelTxt]}>EMI</Text>
                </View>
                <View style={[styles.compareCellWrap, styles.compareColBorder, styles.compareCellEmiPad]}>
                  <View style={styles.modalEmiColumnBox}>
                    <ScholarModalEmiColumn band={scholarPlot?.pricing?.regular} isScholar={false} styles={styles} />
                  </View>
                </View>
                <View style={[styles.compareCellWrap, styles.compareColBorder, styles.compareCellEmiPad]}>
                  <View style={[styles.modalEmiColumnBox, styles.modalEmiColumnBoxScholar]}>
                    <ScholarModalEmiColumn band={scholarData} isScholar styles={styles} />
                  </View>
                </View>
              </View>

              <View style={styles.savingsRow}>
                <View style={[styles.compareCellWrap, styles.compareLabelWrap]}>
                  <Text style={[styles.savingsCell, styles.savingsLabel]}>You Save on EMI</Text>
                </View>
                <View style={[styles.compareCellWrap, styles.compareColBorder]}>
                  <Text style={styles.savingsCell}>—</Text>
                </View>
                <View style={[styles.compareCellWrap, styles.compareColBorder]}>
                  <RupeeText style={[styles.compareCellAmount, styles.savingsValue]}>
                    {fmtRs((scholarPlot?.pricing?.regular?.total || 0) - (scholarData?.total || 0))}
                  </RupeeText>
                </View>
              </View>

              <View style={styles.compareDivider} />

              <View style={styles.compareRow}>
                <View style={[styles.compareCellWrap, styles.compareLabelWrap]}>
                  <Text style={[styles.compareCell, styles.compareLabelTxt]}>Cash Price</Text>
                </View>
                <View style={[styles.compareCellWrap, styles.compareColBorder]}>
                  <RupeeText style={styles.compareCellAmount}>{fmtRs(scholarPlot?.pricing?.regular?.cash)}</RupeeText>
                </View>
                <View style={[styles.compareCellWrap, styles.compareColBorder]}>
                  <RupeeText style={[styles.compareCellAmount, styles.compareScholar]}>
                    {fmtRs(scholarData?.cash)}
                  </RupeeText>
                </View>
              </View>

              <View style={styles.savingsRow}>
                <View style={[styles.compareCellWrap, styles.compareLabelWrap]}>
                  <Text style={[styles.savingsCell, styles.savingsLabel]}>You Save on Cash</Text>
                </View>
                <View style={[styles.compareCellWrap, styles.compareColBorder]}>
                  <RupeeText style={[styles.compareCellAmount, styles.savingsValue]}>
                    {fmtRs((scholarPlot?.pricing?.regular?.total || 0) - (scholarPlot?.pricing?.regular?.cash || 0))}
                  </RupeeText>
                </View>
                <View style={[styles.compareCellWrap, styles.compareColBorder]}>
                  <RupeeText style={[styles.compareCellAmount, styles.savingsValue]}>
                    {fmtRs((scholarPlot?.pricing?.regular?.total || 0) - (scholarData?.cash || 0))}
                  </RupeeText>
                </View>
              </View>
            </View>

            <TouchableOpacity style={styles.modalClose} onPress={() => setScholarPlot(null)}>
              <Text style={styles.modalCloseText}>Close</Text>
            </TouchableOpacity>
            </ScrollView>
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

    headerActionsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginRight: 2,
      maxWidth: '88%',
    },
    openFilterChipHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 10,
      borderWidth: 1.5,
      flexShrink: 1,
      minHeight: 36,
      maxWidth: 200,
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: isDark ? 0.2 : 0.06,
          shadowRadius: 2,
        },
        android: { elevation: 1 },
      }),
    },
    openFilterChipHeaderActive: {
      backgroundColor: isDark ? 'rgba(59,130,246,0.18)' : 'rgba(59,130,246,0.1)',
    },
    openFilterChipHeaderText: {
      fontSize: 12,
      fontWeight: '800',
      flexShrink: 1,
    },
    openFilterChipLandscape: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minHeight: 34,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 10,
      borderWidth: 1.5,
      flexShrink: 1,
      maxWidth: '48%',
    },
    openFilterChipLandscapeActive: {
      backgroundColor: isDark ? 'rgba(59,130,246,0.18)' : 'rgba(59,130,246,0.1)',
    },
    openFilterChipLandscapeText: {
      fontSize: 12,
      fontWeight: '800',
      flexShrink: 1,
    },
    tableEmptyHint: {
      paddingVertical: 28,
      paddingHorizontal: 16,
      alignItems: 'center',
    },
    tableEmptyHintText: {
      fontSize: 14,
      fontWeight: '600',
      textAlign: 'center',
    },

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
    },
    landscapeActionBar: {
      paddingHorizontal: 12,
      paddingTop: 6,
      paddingBottom: 6,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      flexWrap: 'nowrap',
      gap: 8,
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
      minHeight: 78,
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
      minHeight: 78,
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
    cellEmiW: { width: COL_EMI, paddingHorizontal: 2 },
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
      fontSize: 15,
      lineHeight: 19,
      fontWeight: '800',
      color: colors.text,
      textAlign: 'center',
    },
    cellEmiMult: {
      fontSize: 15,
      lineHeight: 19,
      fontWeight: '900',
      color: colors.textSecondary,
      flexShrink: 0,
    },
    cellEmiTablePlus: {
      width: '100%',
      textAlign: 'center',
      fontSize: 17,
      fontWeight: '900',
      lineHeight: 19,
      color: colors.textSecondary,
      paddingVertical: 0,
    },
    cellEmiLine: {
      fontSize: 14,
      lineHeight: 18,
      fontWeight: '800',
      color: colors.text,
      textAlign: 'center',
      width: '100%',
    },

    // ── Cell text styles ──
    cellPlotTxt: { textAlign: 'center', fontWeight: '900' },
    cellAreaTxt: { textAlign: 'center' },
    cellNumTxt: { textAlign: 'center' },
    cellMoneyText: {
      width: '100%',
      textAlign: 'center',
      fontSize: 15,
    },

    cell: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
      textAlign: 'center',
    },

    // ── Scholar button ──
    scholarBtn: {
      width: COL_SCHOLAR - 4,
      minHeight: 56,
      alignSelf: 'stretch',
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
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    modalSheet: {
      backgroundColor: colors.surface,
      borderRadius: 18,
      paddingVertical: 0,
      paddingHorizontal: 0,
      maxWidth: 520,
      alignSelf: 'center',
      width: '100%',
      borderWidth: 1,
      borderColor,
    },
    modalScroll: {
      flexGrow: 0,
    },
    modalScrollContent: {
      paddingHorizontal: 14,
      paddingTop: 12,
      paddingBottom: 10,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 4,
    },
    modalTitle: {
      fontSize: 19,
      fontWeight: '800',
      color: colors.text,
    },
    modalPlotHighlightRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: 8,
      marginBottom: 10,
    },
    modalPlotBadge: {
      flexGrow: 1,
      flexBasis: '42%',
      minWidth: 132,
      maxWidth: 200,
      paddingVertical: 9,
      paddingHorizontal: 12,
      borderRadius: 14,
      borderWidth: 2,
    },
    /** Plot number — warm amber / gold */
    modalPlotBadgePlot: {
      borderColor: isDark ? '#fbbf24' : '#d97706',
      backgroundColor: isDark ? '#422006' : '#fffbeb',
    },
    modalPlotBadgeLabelPlot: {
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 1,
      color: isDark ? '#fcd34d' : '#b45309',
      textTransform: 'uppercase',
      marginBottom: 4,
      textAlign: 'center',
    },
    modalPlotBadgeValuePlot: {
      fontSize: 30,
      fontWeight: '900',
      color: isDark ? '#fef3c7' : '#78350f',
      textAlign: 'center',
    },
    /** Area — cool cyan / teal */
    modalPlotBadgeAreaCard: {
      borderColor: isDark ? '#22d3ee' : '#0891b2',
      backgroundColor: isDark ? '#083344' : '#ecfeff',
    },
    modalPlotBadgeLabelArea: {
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 0.4,
      color: isDark ? '#a5f3fc' : '#0e7490',
      marginBottom: 4,
      textAlign: 'center',
    },
    modalPlotBadgeValueArea: {
      fontSize: 30,
      fontWeight: '900',
      color: isDark ? '#ecfeff' : '#155e75',
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
    compareHeaderColBorder: {
      borderLeftWidth: 1,
      borderLeftColor: isDark ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.35)',
    },
    compareColBorder: {
      borderLeftWidth: 1,
      borderLeftColor: borderColor,
    },
    compareCellWrap: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: 8,
      paddingHorizontal: 4,
    },
    compareCellEmiPad: {
      paddingVertical: 6,
      paddingHorizontal: 5,
      alignItems: 'stretch',
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
      alignItems: 'center',
    },
    compareRowEmi: {
      alignItems: 'stretch',
    },
    compareCell: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
      textAlign: 'center',
    },
    compareCellAmount: {
      fontSize: 16,
      fontWeight: '800',
      color: colors.text,
      textAlign: 'center',
      width: '100%',
      flexShrink: 1,
    },
    modalEmiColumnBox: {
      width: '100%',
      borderWidth: 1,
      borderColor,
      borderRadius: 10,
      backgroundColor: isDark ? '#0f172a' : '#f1f5f9',
      overflow: 'hidden',
    },
    modalEmiColumnBoxScholar: {
      borderColor: isDark ? '#7c3aed' : '#a78bfa',
      backgroundColor: isDark ? '#1e1033' : '#f5f3ff',
    },
    modalEmiColInner: {
      width: '100%',
    },
    modalEmiPlus: {
      width: '100%',
      textAlign: 'center',
      fontSize: 18,
      fontWeight: '900',
      lineHeight: 20,
      color: colors.text,
      paddingVertical: 0,
    },
    modalEmiLineBox: {
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      paddingVertical: 7,
      paddingHorizontal: 8,
      gap: 6,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: borderColor,
    },
    modalEmiLineBoxLast: {
      borderBottomWidth: 0,
    },
    modalEmiAmountBlock: {
      width: '100%',
      textAlign: 'center',
    },
    modalEmiSuffixPill: {
      borderWidth: 1,
      borderColor,
      borderRadius: 8,
      paddingVertical: 4,
      paddingHorizontal: 12,
      backgroundColor: isDark ? '#1e293b' : '#fff',
      flexShrink: 0,
    },
    modalEmiSuffixPillScholar: {
      borderColor: isDark ? '#a78bfa' : '#7c3aed',
      backgroundColor: isDark ? '#2e1065' : '#ede9fe',
    },
    modalEmiSuffixPillText: {
      fontSize: 15,
      fontWeight: '900',
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
    },

    modalClose: {
      marginTop: 10,
      paddingVertical: 11,
      borderRadius: 12,
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
