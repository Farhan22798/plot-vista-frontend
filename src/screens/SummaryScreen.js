import { useTheme } from '../context/ThemeContext';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Modal,
  Pressable,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialIcons';
import DateTimePicker from '@react-native-community/datetimepicker';
import dayjs from 'dayjs';
import api from '../services/api';
import socket from '../services/socket';
import { displayActivityAction } from '../utils/activityLabels';
import { formatDateTime, nameOnly } from '../utils/formatting';
import { getStatusSwatchColor } from '../constants/statusColors';
import { useAlert } from '../context/AlertContext';
import UserAvatar from '../components/UserAvatar';
import { keyboardAvoidingBehavior } from '../utils/keyboardAvoiding';

const SUMMARY_FETCH_LIMIT = 1500;

const DATE_PRESETS = [
  { id: 'all', label: 'All dates' },
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'pick', label: 'Pick day' },
];

const SORT_MODES = [
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'plot_asc', label: 'Plot no. (low → high)' },
  { id: 'plot_desc', label: 'Plot no. (high → low)' },
  { id: 'owner_asc', label: 'By owner (A → Z)' },
];

function normalizeDigits(s) {
  return String(s || '').replace(/\D/g, '');
}

function sameLocalDay(iso, dayRef) {
  if (!iso) return false;
  return dayjs(iso).format('YYYY-MM-DD') === dayjs(dayRef).format('YYYY-MM-DD');
}

const SummaryScreen = () => {
  const { colors, isDark } = useTheme();
  const styles = React.useMemo(() => getStyles(colors, isDark), [colors, isDark]);
  const { showAlert } = useAlert();
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [datePreset, setDatePreset] = useState('all');
  const [pickDate, setPickDate] = useState(() => new Date());
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const [plotFilter, setPlotFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');

  const [sortMode, setSortMode] = useState('newest');
  const [filterModalVisible, setFilterModalVisible] = useState(false);

  const fetchActivities = useCallback(
    async ({ silent = false } = {}) => {
      try {
        const response = await api.get('summary', { params: { limit: SUMMARY_FETCH_LIMIT } });
        setActivities(Array.isArray(response.data) ? response.data : []);
      } catch (error) {
        if (!silent) {
          showAlert('Error', 'Could not load activity summary. Pull down to try again.');
        }
        if (__DEV__) console.error('[SummaryScreen] Fetch Error:', error.message);
      } finally {
        if (!silent) setLoading(false);
        setRefreshing(false);
      }
    },
    [showAlert]
  );

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  useEffect(() => {
    socket.connect();
    const onPlotUpdated = () => {
      fetchActivities({ silent: true });
    };
    socket.on('plotUpdated', onPlotUpdated);
    return () => socket.off('plotUpdated', onPlotUpdated);
  }, [fetchActivities]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchActivities();
  };

  const hasTextFilters =
    plotFilter.trim().length > 0 ||
    ownerFilter.trim().length > 0 ||
    customerFilter.trim().length > 0;
  const hasDateFilter = datePreset !== 'all';
  const hasActiveFilters = hasTextFilters || hasDateFilter || sortMode !== 'newest';
  const hasBadgeOnFunnel = hasActiveFilters;

  const clearFilters = useCallback(() => {
    setDatePreset('all');
    setPickDate(new Date());
    setPlotFilter('');
    setOwnerFilter('');
    setCustomerFilter('');
    setSortMode('newest');
    setDatePickerOpen(false);
    setFilterModalVisible(false);
  }, []);

  const filteredSorted = useMemo(() => {
    let list = activities.slice();

    if (datePreset === 'today') {
      const ref = new Date();
      list = list.filter((a) => sameLocalDay(a.createdAt, ref));
    } else if (datePreset === 'yesterday') {
      const ref = dayjs().subtract(1, 'day').toDate();
      list = list.filter((a) => sameLocalDay(a.createdAt, ref));
    } else if (datePreset === 'pick') {
      list = list.filter((a) => sameLocalDay(a.createdAt, pickDate));
    }

    const p = plotFilter.trim().toLowerCase();
    if (p) {
      list = list.filter((a) => String(a.plotNumber || '').toLowerCase().includes(p));
    }

    const owner = ownerFilter.trim().toLowerCase();
    if (owner) {
      list = list.filter((a) => {
        const raw = String(a.changedBy || '').toLowerCase();
        const short = nameOnly(a.changedBy).toLowerCase();
        return raw.includes(owner) || short.includes(owner);
      });
    }

    const c = customerFilter.trim().toLowerCase();
    const cDigits = normalizeDigits(customerFilter);
    if (c || cDigits.length >= 2) {
      list = list.filter((a) => {
        const name = String(a.customerName || '').toLowerCase();
        if (c && name.includes(c)) return true;
        if (cDigits.length >= 2) {
          const mob = normalizeDigits(a.customerMobile || '');
          if (mob.includes(cDigits)) return true;
        }
        return false;
      });
    }

    list.sort((a, b) => {
      if (sortMode === 'newest' || sortMode === 'oldest') {
        const ta = new Date(a.createdAt || 0).getTime();
        const tb = new Date(b.createdAt || 0).getTime();
        return (ta - tb) * (sortMode === 'oldest' ? 1 : -1);
      }
      if (sortMode === 'plot_asc' || sortMode === 'plot_desc') {
        const cmp = String(a.plotNumber).localeCompare(String(b.plotNumber), undefined, {
          numeric: true,
        });
        return sortMode === 'plot_asc' ? cmp : -cmp;
      }
      if (sortMode === 'owner_asc') {
        const aa = nameOnly(a.changedBy).toLowerCase();
        const ab = nameOnly(b.changedBy).toLowerCase();
        return aa.localeCompare(ab);
      }
      return 0;
    });

    return list;
  }, [
    activities,
    datePreset,
    pickDate,
    plotFilter,
    ownerFilter,
    customerFilter,
    sortMode,
  ]);

  /** From header chips only — opens native picker, stays on summary (no filter modal). */
  const onPickDateChip = () => {
    setDatePreset('pick');
    setDatePickerOpen(true);
  };

  const onDatePickerChange = (event, date) => {
    if (event?.type === 'dismissed') {
      setDatePickerOpen(false);
      return;
    }
    if (date) {
      setPickDate(date);
      setDatePreset('pick');
    }
    if (Platform.OS === 'android') {
      setDatePickerOpen(false);
    }
  };

  const renderItem = useCallback(
    ({ item }) => {
      const swatchColor = getStatusSwatchColor(item.action, item.newStatus, item.waiterCount);
      const isVacant = item.action === 'Marked Vacant' || item.newStatus === 'vacant';
      const isRemoved = item.action === 'Removed Waiting' || item.action === 'Removed Waiter';
      const refundAmount = Number(item?.refundDetails?.amount);

      return (
        <View style={styles.activityRow}>
          <View style={styles.activityDotRail}>
            <View
              style={[
                styles.swatch,
                { backgroundColor: swatchColor ?? colors.border },
                isVacant && { borderWidth: 1, borderColor: colors.text },
                isRemoved && { borderRadius: 2 },
              ]}
            />
          </View>
          <View style={styles.activityContent}>
            <View style={styles.activityHeadRow}>
              <Text style={styles.activityTitle}>{displayActivityAction(item.action, item.newStatus)}</Text>
              <Text style={styles.activityTime}>{formatDateTime(item.createdAt)}</Text>
            </View>
            <Text style={styles.activityMetaPrimary}>Plot {item.plotNumber}</Text>
            <Text style={styles.activityMetaSecondary}>Customer: {item.customerName || '-'}</Text>
            <View style={styles.activityByRow}>
              <UserAvatar
                name={item.changedBy}
                imageUrl={item.changedByAvatarUrl}
                size={22}
                style={styles.avatarInRow}
              />
              <Text style={styles.activityMetaSecondary}>By: {nameOnly(item.changedBy)}</Text>
            </View>
            {item.refundDetails && item.refundDetails.mode ? (
              <View style={styles.detailBlock}>
                <Text style={styles.detailLine}>
                  Refund: Rs. {Number.isFinite(refundAmount) ? refundAmount.toLocaleString() : '-'} via {item.refundDetails.mode}
                </Text>
                <View style={styles.activityByRow}>
                  <Text style={styles.detailLine}>Owner: </Text>
                  <UserAvatar
                    name={item.refundDetails.processedBy}
                    imageUrl={item.refundDetails.processedByAvatarUrl}
                    size={18}
                    style={styles.avatarInRow}
                  />
                  <Text style={styles.detailLine}>{nameOnly(item.refundDetails.processedBy)}</Text>
                </View>
                {item.refundDetails.remarks ? (
                  <Text style={styles.detailLine}>Notes: {item.refundDetails.remarks}</Text>
                ) : null}
              </View>
            ) : null}
            {(item.action === 'Removed Waiting' || item.action === 'Removed Waiter') && item.removalRemarks ? (
              <View style={styles.detailBlock}>
                <Text style={styles.detailLine}>Removal reason: {item.removalRemarks}</Text>
              </View>
            ) : null}
          </View>
        </View>
      );
    },
    [styles, colors.text, colors.border]
  );

  const closeFilterModal = useCallback(() => {
    setFilterModalVisible(false);
    setDatePickerOpen(false);
  }, []);

  const renderDateChips = ({ forListHeader = false } = {}) => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.chipScroll, !forListHeader && styles.chipScrollModal]}
    >
      {DATE_PRESETS.map((opt) => {
        const active = opt.id === 'pick' ? datePreset === 'pick' : datePreset === opt.id;
        const label =
          opt.id === 'pick' && datePreset === 'pick'
            ? dayjs(pickDate).format('D MMM YYYY')
            : opt.label;
        return (
          <TouchableOpacity
            key={opt.id}
            style={[
              styles.chip,
              { borderColor: colors.border, backgroundColor: colors.surface },
              active && {
                borderColor: colors.primary,
                backgroundColor: isDark ? 'rgba(59,130,246,0.2)' : '#eff6ff',
              },
            ]}
            onPress={() => {
              if (opt.id === 'pick') {
                if (forListHeader) {
                  onPickDateChip();
                } else {
                  setDatePreset('pick');
                  setDatePickerOpen(true);
                }
              } else {
                setDatePickerOpen(false);
                setDatePreset(opt.id);
              }
            }}
            activeOpacity={0.85}
          >
            {opt.id === 'pick' ? (
              <Icon
                name="event"
                size={16}
                color={active ? colors.primary : colors.textSecondary}
                style={styles.chipIcon}
              />
            ) : null}
            <Text style={[styles.chipText, { color: active ? colors.primary : colors.text }]} numberOfLines={1}>
              {label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );

  const listHeader = (
    <View style={[styles.compactBar, { borderBottomColor: colors.border }]}>
      <TouchableOpacity
        style={[styles.funnelBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => setFilterModalVisible(true)}
        accessibilityLabel="Open filters and sort"
        activeOpacity={0.85}
      >
        <Icon name="filter-list" size={22} color={colors.primary} />
        {hasBadgeOnFunnel ? <View style={styles.funnelBadge} /> : null}
      </TouchableOpacity>
      <View style={styles.chipRowFill}>{renderDateChips({ forListHeader: true })}</View>
      <Text style={[styles.compactCount, { color: colors.textSecondary }]}>
        {filteredSorted.length}/{activities.length}
      </Text>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <>
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <FlatList
        data={filteredSorted}
        keyExtractor={(item) => String(item._id)}
        renderItem={renderItem}
        ListHeaderComponent={listHeader}
        contentContainerStyle={styles.listContainer}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>
              {hasActiveFilters ? 'No activities match your filters or sort.' : 'No activities found.'}
            </Text>
            <Text style={styles.emptySubText}>
              {hasActiveFilters
                ? 'Try clearing filters or widening the date range.'
                : 'New actions on plots will appear here.'}
            </Text>
          </View>
        }
      />

      <Modal
        visible={filterModalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeFilterModal}
      >
        <KeyboardAvoidingView behavior={keyboardAvoidingBehavior()} style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeFilterModal} accessibilityLabel="Close filters" />
          <View style={[styles.filterModalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.filterModalTitle, { color: colors.text }]}>Filters & sort</Text>
            <ScrollView
              style={styles.filterModalScroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={[styles.modalSectionLabel, { color: colors.textSecondary }]}>Date</Text>
              {renderDateChips({ forListHeader: false })}
              <Text style={[styles.modalSectionHint, { color: colors.textSecondary }]}>
                Tap “Pick day” to open the date picker.
              </Text>

              <Text style={[styles.modalSectionLabel, styles.modalSectionLabelSpaced, { color: colors.textSecondary }]}>
                Sort order
              </Text>
              {SORT_MODES.map((opt) => {
                const selected = sortMode === opt.id;
                return (
                  <Pressable
                    key={opt.id}
                    onPress={() => setSortMode(opt.id)}
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
                        styles.sortRadio,
                        {
                          borderColor: selected ? colors.primary : colors.textSecondary,
                          backgroundColor: selected ? colors.primary : 'transparent',
                        },
                      ]}
                    >
                      {selected ? <Icon name="check" size={14} color="#fff" /> : null}
                    </View>
                    <Text style={[styles.sortOptionTitle, { color: colors.text }]}>{opt.label}</Text>
                  </Pressable>
                );
              })}

              <Text style={[styles.modalSectionLabel, styles.modalSectionLabelSpaced, { color: colors.textSecondary }]}>
                Plot number
              </Text>
              <View style={[styles.fieldRow, { borderColor: colors.border, backgroundColor: colors.background }]}>
                <Icon name="tag" size={20} color={colors.textSecondary} style={styles.fieldIcon} />
                <TextInput
                  style={[styles.fieldInput, { color: colors.text }]}
                  placeholder="Contains…"
                  placeholderTextColor={colors.placeholder}
                  value={plotFilter}
                  onChangeText={setPlotFilter}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <Text style={[styles.modalSectionLabel, { color: colors.textSecondary }]}>Owner (who acted)</Text>
              <View style={[styles.fieldRow, { borderColor: colors.border, backgroundColor: colors.background }]}>
                <Icon name="person" size={20} color={colors.textSecondary} style={styles.fieldIcon} />
                <TextInput
                  style={[styles.fieldInput, { color: colors.text }]}
                  placeholder="Name contains…"
                  placeholderTextColor={colors.placeholder}
                  value={ownerFilter}
                  onChangeText={setOwnerFilter}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <Text style={[styles.modalSectionLabel, { color: colors.textSecondary }]}>Customer</Text>
              <View style={[styles.fieldRow, { borderColor: colors.border, backgroundColor: colors.background }]}>
                <Icon name="group" size={20} color={colors.textSecondary} style={styles.fieldIcon} />
                <TextInput
                  style={[styles.fieldInput, { color: colors.text }]}
                  placeholder="Name or mobile…"
                  placeholderTextColor={colors.placeholder}
                  value={customerFilter}
                  onChangeText={setCustomerFilter}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              <Text style={[styles.modalHint, { color: colors.textSecondary }]}>
                Showing {filteredSorted.length} of {activities.length} loaded
                {activities.length >= SUMMARY_FETCH_LIMIT ? ' — oldest may be omitted' : ''}
              </Text>

              <TouchableOpacity
                style={[styles.clearAllBtn, { borderColor: colors.border, backgroundColor: colors.background }]}
                onPress={clearFilters}
                activeOpacity={0.85}
              >
                <Icon name="filter-alt-off" size={20} color={colors.primary} />
                <Text style={[styles.clearAllBtnText, { color: colors.text }]}>Clear all filters & sort</Text>
              </TouchableOpacity>
            </ScrollView>
            <TouchableOpacity style={styles.filterModalDone} onPress={closeFilterModal} activeOpacity={0.85}>
              <Text style={[styles.filterModalDoneText, { color: colors.primary }]}>Done</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>

    {datePickerOpen && Platform.OS === 'android' ? (
      <DateTimePicker
        value={pickDate}
        mode="date"
        display="default"
        onChange={onDatePickerChange}
      />
    ) : null}

    {datePickerOpen && Platform.OS === 'ios' ? (
      <Modal
        visible
        transparent
        animationType="slide"
        onRequestClose={() => setDatePickerOpen(false)}
      >
        <View style={styles.datePickerIosRoot}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setDatePickerOpen(false)} />
          <View style={[styles.datePickerIosSheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <DateTimePicker
              value={pickDate}
              mode="date"
              display="spinner"
              onChange={onDatePickerChange}
              themeVariant={isDark ? 'dark' : 'light'}
            />
            <TouchableOpacity
              style={[styles.datePickerIosDone, { borderTopColor: colors.border }]}
              onPress={() => setDatePickerOpen(false)}
            >
              <Text style={[styles.iosDateDoneText, { color: colors.primary }]}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    ) : null}
    </>
  );
};

const getStyles = (colors, isDark) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    listContainer: {
      paddingHorizontal: 16,
      paddingBottom: 24,
    },
    compactBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 6,
      paddingHorizontal: 2,
      marginBottom: 4,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    funnelBtn: {
      width: 44,
      height: 44,
      borderRadius: 12,
      borderWidth: 1.5,
      alignItems: 'center',
      justifyContent: 'center',
    },
    funnelBadge: {
      position: 'absolute',
      top: 7,
      right: 7,
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: '#e53935',
    },
    chipRowFill: {
      flex: 1,
      minWidth: 0,
    },
    compactCount: {
      fontSize: 11,
      fontWeight: '800',
      minWidth: 40,
      textAlign: 'right',
    },
    chipScroll: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 2,
      paddingRight: 4,
    },
    chipScrollModal: {
      paddingBottom: 6,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 20,
      borderWidth: 1.5,
    },
    chipIcon: { marginRight: 4 },
    chipText: {
      fontSize: 13,
      fontWeight: '700',
    },
    iosDateDoneText: {
      fontSize: 16,
      fontWeight: '800',
    },
    fieldRow: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: 12,
      borderWidth: 1.5,
      paddingHorizontal: 10,
      marginBottom: 8,
      minHeight: 46,
    },
    fieldIcon: { marginRight: 8 },
    fieldInput: {
      flex: 1,
      fontSize: 15,
      paddingVertical: Platform.OS === 'ios' ? 10 : 8,
      fontWeight: '500',
    },
    modalSectionLabel: {
      fontSize: 11,
      fontWeight: '800',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginBottom: 8,
      marginTop: 4,
    },
    modalSectionHint: {
      fontSize: 12,
      fontWeight: '600',
      lineHeight: 17,
      marginBottom: 4,
      marginTop: -2,
    },
    modalSectionLabelSpaced: {
      marginTop: 16,
    },
    datePickerIosRoot: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(0,0,0,0.45)',
    },
    datePickerIosSheet: {
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      overflow: 'hidden',
    },
    datePickerIosDone: {
      paddingVertical: 14,
      alignItems: 'center',
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    modalHint: {
      fontSize: 12,
      fontWeight: '600',
      marginTop: 16,
      marginBottom: 8,
    },
    clearAllBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderRadius: 12,
      borderWidth: 1.5,
      paddingVertical: 14,
      marginBottom: 8,
    },
    clearAllBtnText: {
      fontSize: 14,
      fontWeight: '800',
    },
    activityRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    activityDotRail: {
      width: 22,
      alignItems: 'center',
      paddingTop: 3,
      marginRight: 6,
    },
    swatch: {
      width: 12,
      height: 12,
    },
    activityContent: {
      flex: 1,
      minWidth: 0,
    },
    activityHeadRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: 8,
    },
    activityTitle: {
      flex: 1,
      fontSize: 15,
      fontWeight: '800',
      color: colors.text,
    },
    activityTime: {
      fontSize: 12,
      color: colors.textSecondary,
      fontWeight: '600',
    },
    activityMetaPrimary: {
      fontSize: 15,
      fontWeight: '800',
      color: colors.primary,
      marginTop: 2,
    },
    activityMetaSecondary: {
      fontSize: 13,
      color: colors.textSecondary,
      marginTop: 2,
    },
    activityByRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 4,
    },
    avatarInRow: {
      marginRight: 6,
    },
    detailBlock: {
      marginTop: 8,
      paddingTop: 6,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    detailLine: {
      fontSize: 12,
      color: colors.text,
      fontWeight: '600',
      lineHeight: 17,
    },
    center: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.background,
    },
    emptyContainer: {
      padding: 40,
      alignItems: 'center',
    },
    emptyText: {
      textAlign: 'center',
      color: colors.textSecondary,
      marginTop: 20,
      fontWeight: '600',
    },
    emptySubText: {
      fontSize: 13,
      color: colors.textSecondary,
      marginTop: 8,
      textAlign: 'center',
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'center',
      paddingHorizontal: 16,
    },
    filterModalCard: {
      borderRadius: 16,
      borderWidth: 1,
      padding: 16,
      maxWidth: 440,
      width: '100%',
      alignSelf: 'center',
      maxHeight: '88%',
    },
    filterModalTitle: {
      fontSize: 18,
      fontWeight: '800',
      marginBottom: 10,
    },
    filterModalScroll: {
      maxHeight: 480,
    },
    sortOptionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderRadius: 12,
      borderWidth: 1.5,
      marginBottom: 8,
      gap: 12,
    },
    sortRadio: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sortOptionTitle: {
      fontSize: 15,
      fontWeight: '700',
      flex: 1,
    },
    filterModalDone: {
      marginTop: 4,
      paddingVertical: 14,
      alignItems: 'center',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    filterModalDoneText: {
      fontSize: 16,
      fontWeight: '800',
    },
  });

export default SummaryScreen;
