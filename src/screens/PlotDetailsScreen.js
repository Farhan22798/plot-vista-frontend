import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useOnAppForeground } from '../hooks/useOnAppForeground';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialIcons';
import api from '../services/api';
import socket from '../services/socket';
import { useTheme } from '../context/ThemeContext';
import { useAlert } from '../context/AlertContext';
import { formatRupee, formatDateTime, nameOnly } from '../utils/formatting';
import { getRemarkEntries, formatRemarkEntryAuditLines } from '../utils/remarkLog';
import { labelForCustomerCategory } from '../utils/customerCategory';
import UserAvatar from '../components/UserAvatar';
import { resolveScholarPricing, resolveRegularPricing } from '../utils/pricingHelpers';
import { STATUS_LABELS } from '../constants/statusColors';
import { usePermissions } from '../hooks/usePermissions';
import {
  EMI_INSTALLMENTS_LABEL,
  PlotDetailsEmiSchedule,
  PricingStatRow,
  PricingStatTextRow,
  createPlotDetailsPricingStyles,
} from '../components/plotDetailsPricingUi';

function CustomerDetailRow({ icon, label, value, styles, colors, avatarFor, avatarImageUrl }) {
  if (!value) return null;
  return (
    <View style={styles.customerRow}>
      <Icon name={icon} size={16} color={colors.textSecondary} style={styles.customerRowIcon} />
      <Text style={styles.customerRowLabel}>{label}: </Text>
      <View style={styles.customerRowValueWrap}>
        {avatarFor ? (
          <UserAvatar name={avatarFor} imageUrl={avatarImageUrl} size={20} style={styles.customerRowAvatar} />
        ) : null}
        <Text style={styles.customerRowValue}>{value}</Text>
      </View>
    </View>
  );
}

const PlotDetailsScreen = () => {
  const route = useRoute();
  const { plotId } = route.params || {};
  const { colors, isDark } = useTheme();
  const { showAlert } = useAlert();
  const { isGuest } = usePermissions();
  const insets = useSafeAreaInsets();
  const styles = React.useMemo(() => {
    const shared = createPlotDetailsPricingStyles(colors, isDark);
    const local = getStyles(colors, isDark);
    return { ...shared, ...local };
  }, [colors, isDark]);

  const [plot, setPlot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showScholarRates, setShowScholarRates] = useState(false);
  const scrollViewportHRef = React.useRef(0);
  const scrollContentHRef = React.useRef(0);
  const [scrollMoreHintVisible, setScrollMoreHintVisible] = useState(false);
  const [scrollHintDismissed, setScrollHintDismissed] = useState(false);

  const recalcScrollHint = useCallback(() => {
    const vh = scrollViewportHRef.current;
    const ch = scrollContentHRef.current;
    setScrollMoreHintVisible(vh > 0 && ch > vh + 24);
  }, []);

  const load = useCallback(async () => {
    if (!plotId) return;
    const res = await api.get(`/${plotId}`);
    setPlot(res.data);
  }, [plotId]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!plotId) {
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        await load();
      } catch (e) {
        if (!cancelled) {
          showAlert('Error', e.response?.data?.message || 'Could not load plot.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [plotId, load, showAlert]);

  useEffect(() => {
    setScrollHintDismissed(false);
  }, [plotId]);

  useOnAppForeground(
    useCallback(() => {
      if (!plotId) return;
      if (!socket.connected) socket.connect();
      load().catch(() => {});
    }, [plotId, load])
  );

  useEffect(() => {
    if (!plotId) return undefined;
    const idStr = String(plotId);
    socket.connect();
    const onPlotUpdated = (updatedPlot) => {
      if (!updatedPlot?._id || String(updatedPlot._id) !== idStr) return;
      setPlot(updatedPlot);
    };
    socket.on('plotUpdated', onPlotUpdated);
    return () => {
      socket.off('plotUpdated', onPlotUpdated);
    };
  }, [plotId]);

  const pricing = plot?.categoryPricing || {};
  const cat = showScholarRates ? resolveScholarPricing(pricing) : resolveRegularPricing(pricing);
  const totalCost = Number(cat?.totalPlotCost);
  const advance = Number(cat?.advance);
  const balanceForEmi =
    Number.isFinite(totalCost) && Number.isFinite(advance) ? Math.max(0, totalCost - advance) : null;
  const storedEmi = cat?.emiAmount != null && !Number.isNaN(Number(cat.emiAmount)) ? Number(cat.emiAmount) : null;
  const lastEmiAmount =
    cat?.lastEmiAmount != null && !Number.isNaN(Number(cat.lastEmiAmount))
      ? Number(cat.lastEmiAmount)
      : null;
  const emiForDisplay = storedEmi;
  const statusPill = plot ? statusPillVariant(plot.status, isDark, colors) : null;

  if (!plotId) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={styles.muted}>Missing plot.</Text>
      </View>
    );
  }

  if (loading && !plot) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!plot) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={styles.muted}>Plot not found.</Text>
      </View>
    );
  }

  const pricingCardBandStyle = showScholarRates
    ? styles.pricingCardBandScholar
    : styles.pricingCardBandRegular;
  const pricingIconColor = showScholarRates ? (isDark ? '#6ee7b7' : '#047857') : isDark ? '#fcd34d' : '#b45309';

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
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
          <View style={[styles.summaryCard, styles.summaryCardPlot]}>
            <Text style={styles.summaryCardLabelPlot}>Plot number</Text>
            <Text style={styles.summaryCardValuePlot} numberOfLines={1}>
              {plot.plotNumber}
            </Text>
          </View>
          <View style={[styles.summaryCard, styles.summaryCardArea]}>
            <Text style={styles.summaryCardLabelArea}>AREA (in Sq. Ft.)</Text>
            <Text style={styles.summaryCardValueArea} numberOfLines={1}>
              {plot.areaSqFt != null && !Number.isNaN(Number(plot.areaSqFt))
                ? Number(plot.areaSqFt).toLocaleString('en-IN')
                : '—'}
            </Text>
          </View>
        </View>

        <View style={styles.rateBandRow}>
          <TouchableOpacity
            style={[
              styles.compactBandBtn,
              styles.compactBandBtn40,
              !showScholarRates ? styles.compactBandBtnActiveRegular : styles.compactBandBtnInactive,
            ]}
            onPress={() => setShowScholarRates(false)}
            activeOpacity={0.9}
          >
            <Icon
              name="person-outline"
              size={17}
              color={!showScholarRates ? '#0f172a' : colors.textSecondary}
            />
            <Text
              style={[styles.compactBandLabel, !showScholarRates && styles.compactBandTextActiveOnBright]}
              numberOfLines={1}
            >
              Regular
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.compactBandBtn,
              styles.compactBandBtn40,
              showScholarRates ? styles.compactBandBtnActiveScholar : styles.compactBandBtnInactive,
            ]}
            onPress={() => setShowScholarRates(true)}
            activeOpacity={0.9}
            accessibilityLabel="Aalim, Hafiz, and Imam rates"
          >
            <Icon
              name="menu-book"
              size={17}
              color={showScholarRates ? '#052e16' : colors.textSecondary}
            />
            <Text
              style={[styles.compactBandLabel, showScholarRates && styles.compactBandTextActiveOnBright]}
              numberOfLines={1}
            >
              Aalim / Hafiz
            </Text>
          </TouchableOpacity>
          <View style={[styles.statusPillInline, statusPill.container]}>
            <Text
              style={[styles.statusPillInlineText, { color: statusPill.textColor }]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {STATUS_LABELS[plot.status] || plot.status}
            </Text>
          </View>
        </View>
      </View>

      <ScrollView
        style={styles.detailsScroll}
        contentContainerStyle={[
          styles.detailsScrollContent,
          { paddingBottom: Math.max(insets.bottom, 28) },
        ]}
        showsVerticalScrollIndicator
        bounces
        overScrollMode="always"
        onLayout={(e) => {
          scrollViewportHRef.current = e.nativeEvent.layout.height;
          recalcScrollHint();
        }}
        onContentSizeChange={(_, h) => {
          scrollContentHRef.current = h;
          recalcScrollHint();
        }}
        onScroll={(e) => {
          if (e.nativeEvent.contentOffset.y > 20) setScrollHintDismissed(true);
        }}
        scrollEventThrottle={16}
      >
        <View style={[styles.pricingCardModern, pricingCardBandStyle]}>
          <View style={styles.pricingCardModernHeader}>
            <View style={[styles.pricingCardIconWrap, showScholarRates ? styles.pricingCardIconWrapScholar : styles.pricingCardIconWrapRegular]}>
              <Icon name="calendar-view-month" size={26} color={pricingIconColor} />
            </View>
            <Text style={styles.pricingCardModernTitle}>EMI Plan</Text>
          </View>
          <PricingStatRow label="Total" amount={cat.totalPlotCost} styles={styles} />
          <PricingStatRow label="Advance" amount={cat.advance} styles={styles} />
          <PricingStatRow label="Balance for EMI" amount={balanceForEmi} styles={styles} />
          <View style={styles.emiScheduleSection}>
            <Text style={styles.emiScheduleSectionLabel}>EMI schedule</Text>
            <View
              style={[
                styles.detailsEmiOuterBox,
                showScholarRates ? styles.detailsEmiOuterBoxScholar : styles.detailsEmiOuterBoxRegular,
              ]}
            >
              <PlotDetailsEmiSchedule
                emi={emiForDisplay}
                lastEmi={lastEmiAmount}
                styles={styles}
                isScholar={showScholarRates}
              />
            </View>
          </View>
          <PricingStatTextRow label="Installments" value={EMI_INSTALLMENTS_LABEL} styles={styles} isLast />
        </View>

        <View style={[styles.pricingCardModern, pricingCardBandStyle, styles.pricingCardModernSpacing]}>
          <View style={styles.pricingCardModernHeader}>
            <View style={[styles.pricingCardIconWrap, showScholarRates ? styles.pricingCardIconWrapScholar : styles.pricingCardIconWrapRegular]}>
              <Icon name="payments" size={26} color={pricingIconColor} />
            </View>
            <Text style={styles.pricingCardModernTitle}>One-time Cash</Text>
          </View>
          <PricingStatRow label="Cash rate" amount={cat.cashOneTimePrice} styles={styles} />
          <PricingStatRow label="Discount" amount={cat.cashDiscount} styles={styles} isLast />
        </View>

        {scrollMoreHintVisible && !scrollHintDismissed ? (
          <View
            style={[
              styles.scrollMoreHint,
              {
                backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
              },
            ]}
          >
            <Icon name="expand_more" size={22} color={colors.primary} style={styles.scrollMoreHintIcon} />
            <Text style={[styles.scrollMoreHintText, { color: colors.textSecondary }]}>
              {isGuest
                ? 'Scroll to see EMI and cash pricing.'
                : 'Scroll for more: cash summary and customer / waiting-list details.'}
            </Text>
          </View>
        ) : null}

        {!isGuest ? (
          <>
        <Text style={styles.sectionTitle}>Customer Details</Text>

        {plot.status === 'booked' && plot.bookingDetails ? (
          <View style={[styles.detailsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.detailsCardHead}>
              <Icon name="person" size={18} color={colors.primary} />
              <Text style={styles.detailsCardTitle}> Booked Customer</Text>
            </View>
            <CustomerDetailRow
              icon="badge"
              label="Name"
              value={plot.bookingDetails.customerName}
              styles={styles}
              colors={colors}
            />
            {(plot.bookingDetails.customerMobiles || []).map((m, i) => (
              <CustomerDetailRow
                key={i}
                icon="phone"
                label={i === 0 ? 'Mobile' : `Mobile ${i + 1}`}
                value={m}
                styles={styles}
                colors={colors}
              />
            ))}
            <CustomerDetailRow
              icon="place"
              label="Address"
              value={plot.bookingDetails.customerAddress}
              styles={styles}
              colors={colors}
            />
            <CustomerDetailRow
              icon="category"
              label="Customer type"
              value={labelForCustomerCategory(plot.bookingDetails.customerCategory)}
              styles={styles}
              colors={colors}
            />
            {getRemarkEntries(plot.bookingDetails).length > 0 ? (
              <View style={styles.notesBlock}>
                <View style={styles.customerRow}>
                  <Icon name="notes" size={16} color={colors.textSecondary} style={styles.customerRowIcon} />
                  <Text style={styles.customerRowLabel}>Notes </Text>
                </View>
                {getRemarkEntries(plot.bookingDetails).map((entry, ni) => (
                  <View key={entry._id != null ? String(entry._id) : `b-${ni}`} style={styles.noteEntry}>
                    <Text style={[styles.customerRowValue, { marginLeft: 0 }]}>{entry.text}</Text>
                    {formatRemarkEntryAuditLines(entry).map((line, li) => (
                      <Text key={li} style={[styles.remarksUpdatedHint, { color: colors.textSecondary }]}>
                        {line}
                      </Text>
                    ))}
                  </View>
                ))}
              </View>
            ) : null}
            <CustomerDetailRow
              icon="currency-rupee"
              label="Advance"
              value={formatRupee(plot.bookingDetails.advanceAmount)}
              styles={styles}
              colors={colors}
            />
            <CustomerDetailRow
              icon="payments"
              label="Payment mode"
              value={plot.bookingDetails.paymentMode}
              styles={styles}
              colors={colors}
            />
            <CustomerDetailRow
              icon="person-pin"
              label="Paid to"
              value={plot.bookingDetails.paymentTo}
              styles={styles}
              colors={colors}
            />
            <CustomerDetailRow
              icon="event"
              label="Created"
              value={formatDateTime(plot.bookingDetails.createdAt)}
              styles={styles}
              colors={colors}
            />
            <CustomerDetailRow
              icon="manage-accounts"
              label="By"
              value={nameOnly(plot.bookingDetails.createdBy)}
              avatarFor={plot.bookingDetails.createdBy}
              avatarImageUrl={plot.bookingDetails.createdByAvatarUrl}
              styles={styles}
              colors={colors}
            />
          </View>
        ) : null}

        {plot.waitingList?.length > 0 ? (
          <View style={[styles.detailsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.detailsCardHead}>
              <Icon name="hourglass-top" size={18} color={colors.primary} />
              <Text style={styles.detailsCardTitle}> Waiting List ({plot.waitingList.length})</Text>
            </View>
            {plot.waitingList.map((w, i) => (
              <View
                key={w._id || i}
                style={[
                  styles.waiterBlock,
                  {
                    borderBottomColor: isDark ? '#334155' : '#e5e7eb',
                    borderBottomWidth: i < plot.waitingList.length - 1 ? 1 : 0,
                  },
                ]}
              >
                <Text style={styles.waiterTitle}>{i + 1}. {w.customerName || '—'}</Text>
                {(w.customerMobiles || []).map((m, mi) => (
                  <CustomerDetailRow
                    key={mi}
                    icon="phone"
                    label={mi === 0 ? 'Mobile' : `Mobile ${mi + 1}`}
                    value={m}
                    styles={styles}
                    colors={colors}
                  />
                ))}
                <CustomerDetailRow
                  icon="place"
                  label="Address"
                  value={w.customerAddress}
                  styles={styles}
                  colors={colors}
                />
                <CustomerDetailRow
                  icon="category"
                  label="Customer type"
                  value={labelForCustomerCategory(w.customerCategory)}
                  styles={styles}
                  colors={colors}
                />
                {getRemarkEntries(w).length > 0 ? (
                  <View style={styles.notesBlock}>
                    <View style={styles.customerRow}>
                      <Icon name="notes" size={16} color={colors.textSecondary} style={styles.customerRowIcon} />
                      <Text style={styles.customerRowLabel}>Notes </Text>
                    </View>
                    {getRemarkEntries(w).map((entry, ni) => (
                      <View key={entry._id != null ? String(entry._id) : `w-${ni}`} style={styles.noteEntry}>
                        <Text style={[styles.customerRowValue, { marginLeft: 0 }]}>{entry.text}</Text>
                        {formatRemarkEntryAuditLines(entry).map((line, li) => (
                          <Text key={li} style={[styles.remarksUpdatedHint, { color: colors.textSecondary }]}>
                            {line}
                          </Text>
                        ))}
                      </View>
                    ))}
                  </View>
                ) : null}
                <CustomerDetailRow
                  icon="event"
                  label="Created"
                  value={formatDateTime(w.createdAt)}
                  styles={styles}
                  colors={colors}
                />
                <CustomerDetailRow
                  icon="manage-accounts"
                  label="By"
                  value={nameOnly(w.createdBy)}
                  avatarFor={w.createdBy}
                  avatarImageUrl={w.createdByAvatarUrl}
                  styles={styles}
                  colors={colors}
                />
              </View>
            ))}
          </View>
        ) : null}

        {plot.status !== 'booked' && (!plot.waitingList || plot.waitingList.length === 0) ? (
          <View style={[styles.detailsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={styles.muted}>No waiting/booked customer details for this plot.</Text>
          </View>
        ) : null}
          </>
        ) : null}

        <View style={styles.scrollEndSpacer} />
      </ScrollView>
    </View>
  );
};

function statusPillVariant(status, isDark, colors) {
  switch (status) {
    case 'vacant':
      return {
        container: {
          backgroundColor: isDark ? '#1e293b' : '#f1f5f9',
          borderWidth: 1,
          borderColor: isDark ? '#94a3b8' : '#64748b',
        },
        textColor: colors.text,
      };
    case 'waiting':
      return { container: { backgroundColor: '#ffeb3b' }, textColor: '#0f172a' };
    case 'booked':
      return { container: { backgroundColor: '#2e7d32' }, textColor: '#ffffff' };
    case 'BM':
      return { container: { backgroundColor: '#0ea5e9' }, textColor: '#ffffff' };
    default:
      return { container: { backgroundColor: '#888' }, textColor: '#ffffff' };
  }
}

const getStyles = (colors, isDark) =>
  StyleSheet.create({
    screen: { flex: 1 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    muted: { color: colors.textSecondary, fontSize: 15 },
    scrollMoreHint: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginBottom: 14,
      marginTop: 2,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: 12,
      borderWidth: 1,
    },
    scrollMoreHintIcon: { marginTop: 2 },
    scrollMoreHintText: {
      flex: 1,
      fontSize: 13,
      fontWeight: '600',
      lineHeight: 19,
    },
    detailsCard: {
      borderRadius: 16,
      padding: 14,
      borderWidth: 1,
      marginBottom: 10,
    },
    detailsCardHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
    detailsCardTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
    customerRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginBottom: 5,
    },
    customerRowIcon: { marginTop: 2, marginRight: 6 },
    customerRowLabel: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
    customerRowValueWrap: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
    },
    customerRowAvatar: { marginRight: 8 },
    customerRowValue: { flex: 1, flexShrink: 1, fontSize: 15, fontWeight: '600', color: colors.text },
    waiterBlock: {
      paddingVertical: 8,
      marginBottom: 2,
    },
    waiterTitle: {
      fontSize: 16,
      fontWeight: '800',
      color: colors.text,
      marginBottom: 6,
    },
    remarksUpdatedHint: {
      fontSize: 12,
      fontWeight: '600',
      fontStyle: 'italic',
      marginTop: 4,
      marginBottom: 2,
      marginLeft: 0,
      lineHeight: 17,
    },
    notesBlock: { marginBottom: 8 },
    noteEntry: { marginBottom: 12, marginLeft: 22 },
  });

export default PlotDetailsScreen;
