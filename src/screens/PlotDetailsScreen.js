import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useOnAppForeground } from '../hooks/useOnAppForeground';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialIcons';
import api from '../services/api';
import socket from '../services/socket';
import { useTheme } from '../context/ThemeContext';
import { useAlert } from '../context/AlertContext';
import { formatRupee, formatDateTime, nameOnly } from '../utils/formatting';
import UserAvatar from '../components/UserAvatar';
import { resolveScholarPricing, resolveRegularPricing } from '../utils/pricingHelpers';
import { STATUS_LABELS } from '../constants/statusColors';

const AREA_STATEMENT_EMI_MONTHS = 36;

function Row({ label, value, styles }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

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
  const navigation = useNavigation();
  const route = useRoute();
  const { plotId } = route.params || {};
  const { colors, isDark } = useTheme();
  const { showAlert } = useAlert();
  const insets = useSafeAreaInsets();
  const styles = React.useMemo(() => getStyles(colors, isDark), [colors, isDark]);

  const [plot, setPlot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showScholarRates, setShowScholarRates] = useState(false);

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

  const onRefresh = useCallback(async () => {
    if (!plotId) return;
    try {
      setRefreshing(true);
      await load();
    } catch (e) {
      showAlert('Error', e.response?.data?.message || 'Could not refresh.');
    } finally {
      setRefreshing(false);
    }
  }, [plotId, load, showAlert]);

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

  const openManage = () => {
    if (!plot?._id) return;
    navigation.navigate('LayoutMap', { openBookingForPlotId: plot._id });
  };

  const pricing = plot?.categoryPricing || {};
  const cat = showScholarRates ? resolveScholarPricing(pricing) : resolveRegularPricing(pricing);
  const totalCost = Number(cat?.totalPlotCost);
  const advance = Number(cat?.advance);
  const balanceForEmi =
    Number.isFinite(totalCost) && Number.isFinite(advance) ? Math.max(0, totalCost - advance) : null;
  const emiForDisplay =
    balanceForEmi != null ? Math.round(balanceForEmi / AREA_STATEMENT_EMI_MONTHS) : cat?.emiAmount;
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

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.topPanel}>
        <View style={[styles.hero, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.heroTop}>
            <Text style={styles.plotNumber}>Plot {plot.plotNumber}</Text>
            <View style={[styles.statusPill, statusPill.container]}>
              <Text style={[styles.statusPillText, { color: statusPill.textColor }]}>
                {STATUS_LABELS[plot.status] || plot.status}
              </Text>
            </View>
          </View>
          <Text style={styles.areaLine}>
            Area:{' '}
            {plot.areaSqFt != null && !Number.isNaN(Number(plot.areaSqFt))
              ? `${Number(plot.areaSqFt).toLocaleString()} sq ft`
              : '—'}
          </Text>
        </View>

        <View style={styles.rateBandRow}>
          <TouchableOpacity
            style={[
              styles.compactBandBtn,
              !showScholarRates ? styles.compactBandBtnActiveRegular : styles.compactBandBtnInactive,
            ]}
            onPress={() => setShowScholarRates(false)}
            activeOpacity={0.9}
          >
            <Icon
              name="person-outline"
              size={16}
              color={!showScholarRates ? '#0f172a' : colors.textSecondary}
            />
            <Text style={[styles.compactBandText, !showScholarRates && styles.compactBandTextActiveOnBright]}>
              Regular
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.compactBandBtn,
              showScholarRates ? styles.compactBandBtnActiveScholar : styles.compactBandBtnInactive,
            ]}
            onPress={() => setShowScholarRates(true)}
            activeOpacity={0.9}
          >
            <Icon
              name="menu-book"
              size={16}
              color={showScholarRates ? '#052e16' : colors.textSecondary}
            />
            <Text style={[styles.compactBandText, showScholarRates && styles.compactBandTextActiveOnBright]}>
              Aalim / Hafiz / Imam
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.pricingGrid}>
          <View style={[styles.compactCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.compactCardHeader}>
              <Icon name="calendar-view-month" size={17} color={colors.primary} />
              <Text style={styles.compactCardTitle}> EMI Plan</Text>
            </View>
            <Row label="Total" value={formatRupee(cat.totalPlotCost)} styles={styles} />
            <Row label="Advance" value={formatRupee(cat.advance)} styles={styles} />
            <Row label="Balance for EMI" value={formatRupee(balanceForEmi)} styles={styles} />
            <Row label="EMI" value={formatRupee(emiForDisplay)} styles={styles} />
            <Row
              label="Period"
              value={`${AREA_STATEMENT_EMI_MONTHS} months`}
              styles={styles}
            />
          </View>

          <View style={[styles.compactCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.compactCardHeader}>
              <Icon name="payments" size={17} color={colors.primary} />
              <Text style={styles.compactCardTitle}> One-time Cash</Text>
            </View>
            <Row label="Cash rate" value={formatRupee(cat.cashOneTimePrice)} styles={styles} />
            <Row label="Discount" value={formatRupee(cat.cashDiscount)} styles={styles} />
          </View>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.detailsScrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
        }
        showsVerticalScrollIndicator={false}
      >
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
              icon="notes"
              label="Remarks"
              value={plot.bookingDetails.remarks}
              styles={styles}
              colors={colors}
            />
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
                  icon="notes"
                  label="Remarks"
                  value={w.remarks}
                  styles={styles}
                  colors={colors}
                />
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

        <View style={{ height: 110 + insets.bottom }} />
      </ScrollView>

      <View
        style={[
          styles.footer,
          {
            paddingBottom: Math.max(insets.bottom, 14),
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
          },
        ]}
      >
        <TouchableOpacity style={styles.manageBtn} onPress={openManage} activeOpacity={0.9}>
          <Icon name="edit-calendar" size={22} color="#fff" />
          <Text style={styles.manageBtnText}> Manage plot</Text>
        </TouchableOpacity>
      </View>
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
    topPanel: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 },
    detailsScrollContent: { paddingHorizontal: 16, paddingTop: 4 },
    hero: {
      borderRadius: 16,
      padding: 14,
      borderWidth: 1,
      marginBottom: 10,
    },
    heroTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 10,
    },
    plotNumber: { fontSize: 21, fontWeight: '900', color: colors.text },
    statusPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
    statusPillText: { fontSize: 12, fontWeight: '800', color: '#0f172a' },
    areaLine: { fontSize: 16, fontWeight: '700', color: colors.textSecondary },
    rateBandRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
    compactBandBtn: {
      flex: 1,
      borderRadius: 12,
      borderWidth: 1.5,
      minHeight: 42,
      paddingHorizontal: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
    },
    compactBandBtnInactive: {
      backgroundColor: isDark ? '#111827' : '#f8fafc',
      borderColor: isDark ? '#374151' : '#cbd5e1',
    },
    compactBandBtnActiveRegular: {
      backgroundColor: '#facc15',
      borderColor: '#ca8a04',
      borderWidth: 2,
    },
    compactBandBtnActiveScholar: {
      backgroundColor: '#34d399',
      borderColor: '#059669',
      borderWidth: 2,
    },
    compactBandText: {
      fontSize: 13,
      fontWeight: '800',
      color: colors.textSecondary,
    },
    compactBandTextActiveOnBright: {
      color: '#0f172a',
      fontWeight: '900',
    },
    pricingGrid: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 6,
    },
    compactCard: {
      flex: 1,
      borderRadius: 12,
      padding: 12,
      borderWidth: 1,
    },
    compactCardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
    compactCardTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
    sectionTitle: {
      fontSize: 14,
      fontWeight: '800',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 1.2,
      marginBottom: 8,
    },
    detailsCard: {
      borderRadius: 16,
      padding: 14,
      borderWidth: 1,
      marginBottom: 10,
    },
    detailsCardHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
    detailsCardTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: isDark ? '#3f3f46' : '#e5e7eb',
    },
    rowLabel: { flex: 1, fontSize: 14, color: colors.textSecondary, fontWeight: '600' },
    rowValue: {
      flex: 1,
      fontSize: 14,
      fontWeight: '800',
      color: colors.text,
      textAlign: 'right',
    },
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
    footer: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: 18,
      paddingTop: 12,
      borderTopWidth: 1,
    },
    manageBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.primary,
      paddingVertical: 16,
      borderRadius: 14,
    },
    manageBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  });

export default PlotDetailsScreen;
