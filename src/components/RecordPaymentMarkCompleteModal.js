import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import {
  PAYMENT_MODES,
  paymentToLabel,
  formatRupeesInr,
  getRecordPaymentActionsAvailability,
} from '../utils/bookingRecordPayment';
import { keyboardAvoidingBehavior } from '../utils/keyboardAvoiding';

/**
 * Bottom-sheet style modal: payment fields + amount + note. Keyboard-safe scroll.
 * Parent owns API; calls onConfirm with validated payload or modal validates before call.
 */
export default function RecordPaymentMarkCompleteModal({
  visible,
  onRequestClose,
  summaryRow,
  submitting,
  /** 'partial' | 'complete' | null — which action is in flight (for button spinners). */
  submittingAction = null,
  onConfirm,
}) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const styles = useMemo(() => getStyles(colors, isDark), [colors, isDark]);

  const [paymentMode, setPaymentMode] = useState('');
  const [paymentTo, setPaymentTo] = useState('');
  const [amountThisPayment, setAmountThisPayment] = useState('');
  const [extraNote, setExtraNote] = useState('');

  useEffect(() => {
    if (!visible || !summaryRow) return;
    const bd = summaryRow.bd;
    const existingMode = String(bd?.paymentMode || '').trim();
    setPaymentMode(PAYMENT_MODES.includes(existingMode) ? existingMode : '');
    setPaymentTo(String(bd?.paymentTo || '').trim());
    const bal = summaryRow.balanceAmount;
    setAmountThisPayment(bal != null && bal > 0 ? String(bal) : '');
    setExtraNote('');
  }, [visible, summaryRow]);

  const sheetMaxH = Math.min(Math.round(windowHeight * 0.92), windowHeight - insets.top - 8);
  /** Keep actions outside the scroll region so they stay reachable while fields scroll / keyboard is open. */
  const sheetChromeH = 20 + 16;
  const footerActionsH = 212;
  const scrollMaxH = Math.max(140, sheetMaxH - sheetChromeH - footerActionsH);

  const { canPartial, canComplete } = useMemo(
    () =>
      getRecordPaymentActionsAvailability(summaryRow, {
        paymentMode,
        paymentTo,
        amountThisPaymentStr: amountThisPayment,
      }),
    [summaryRow, paymentMode, paymentTo, amountThisPayment],
  );

  const emit = (action) => {
    void onConfirm?.({
      paymentMode,
      paymentTo,
      amountThisPaymentStr: amountThisPayment,
      extraNote,
      action,
    });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onRequestClose}>
      <View style={styles.root} pointerEvents="box-none">
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => {
            if (!submitting) onRequestClose?.();
          }}
        />
        <KeyboardAvoidingView
          behavior={keyboardAvoidingBehavior()}
          style={[styles.kav, { paddingBottom: Math.max(insets.bottom, 10) }]}
          keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
        >
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                maxHeight: sheetMaxH,
              },
            ]}
          >
            <View style={styles.sheetHandle} />
            <ScrollView
              style={{ maxHeight: scrollMaxH }}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator
              contentContainerStyle={styles.scrollContent}
              nestedScrollEnabled
            >
              <Text style={[styles.title, { color: colors.text }]}>Record payment</Text>
              <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                Add Partial Payment updates the booking advance and saves a note — it does not mark full advance
                received. Use Complete Advance Received only when the amount covers the remaining balance (or there is
                no balance left to verify).
              </Text>

              {summaryRow ? (
                <View style={[styles.summary, { borderColor: colors.border, backgroundColor: colors.background }]}>
                  <Text style={[styles.summaryTitle, { color: colors.text }]}>
                    Plot {summaryRow.plotNumber} · {String(summaryRow.bd.customerName || '').trim() || '—'}
                  </Text>
                  <Text style={[styles.summaryMeta, { color: colors.textSecondary }]}>
                    {summaryRow.expectedAmount != null
                      ? `Expected (${summaryRow.expectedRateLabel}): ${formatRupeesInr(summaryRow.expectedAmount)}`
                      : `Expected: — (${summaryRow.expectedRateLabel})`}
                    {'\n'}
                    Paid on booking: {formatRupeesInr(summaryRow.amountPaid)}
                    {'\n'}
                    Balance: {summaryRow.balanceAmount != null ? formatRupeesInr(summaryRow.balanceAmount) : '—'}
                  </Text>
                </View>
              ) : null}

              <Text style={[styles.fieldLabel, { color: colors.text }]}>
                Payment mode <Text style={styles.req}>*</Text>
              </Text>
              <View style={styles.pillRow}>
                {PAYMENT_MODES.map((m) => {
                  const on = paymentMode === m;
                  return (
                    <TouchableOpacity
                      key={m}
                      style={[
                        styles.pill,
                        {
                          borderColor: on ? '#059669' : colors.border,
                          backgroundColor: on
                            ? isDark
                              ? 'rgba(5, 150, 105, 0.22)'
                              : '#d1fae5'
                            : 'transparent',
                        },
                      ]}
                      onPress={() => {
                        if (m !== paymentMode) setPaymentTo('');
                        setPaymentMode(m);
                      }}
                      activeOpacity={0.85}
                      disabled={submitting}
                    >
                      <Text style={[styles.pillText, { color: on ? '#059669' : colors.text }]}>{m}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {paymentMode ? (
                <>
                  <Text style={[styles.fieldLabel, { color: colors.text, marginTop: 12 }]}>
                    {paymentToLabel(paymentMode)} <Text style={styles.req}>*</Text>
                  </Text>
                  <View style={[styles.inputWrap, { borderColor: colors.border }]}>
                    <Icon name="account-arrow-right" size={18} color={colors.textSecondary} style={styles.inputIcon} />
                    <TextInput
                      style={[styles.input, { color: colors.text }]}
                      placeholder={paymentToLabel(paymentMode)}
                      placeholderTextColor={colors.placeholder}
                      value={paymentTo}
                      onChangeText={setPaymentTo}
                      editable={!submitting}
                    />
                  </View>
                </>
              ) : null}

              <Text style={[styles.fieldLabel, { color: colors.text, marginTop: 12 }]}>
                Amount received (this payment) <Text style={styles.req}>*</Text>
              </Text>
              <Text style={[styles.hint, { color: colors.textSecondary }]}>
                Added to the current booking advance. Pre-filled with balance due when applicable; use 0 only if the
                total was already updated elsewhere.
              </Text>
              <View style={[styles.inputWrap, { borderColor: colors.border }]}>
                <Icon name="payments" size={18} color={colors.textSecondary} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { color: colors.text }]}
                  placeholder="e.g. 50000"
                  placeholderTextColor={colors.placeholder}
                  value={amountThisPayment}
                  onChangeText={setAmountThisPayment}
                  keyboardType={Platform.OS === 'ios' ? 'decimal-pad' : 'numeric'}
                  editable={!submitting}
                />
              </View>

              <Text style={[styles.fieldLabel, { color: colors.text, marginTop: 12 }]}>
                Extra note <Text style={{ color: colors.textSecondary, fontWeight: '600' }}>(optional)</Text>
              </Text>
              <TextInput
                style={[styles.noteInput, { borderColor: colors.border, color: colors.text }]}
                placeholder="Anything else to store with this receipt…"
                placeholderTextColor={colors.placeholder}
                value={extraNote}
                onChangeText={setExtraNote}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                editable={!submitting}
              />
            </ScrollView>

            <View
              style={[
                styles.actionsFooter,
                {
                  borderTopColor: colors.border,
                  backgroundColor: colors.surface,
                },
              ]}
            >
              <View style={styles.actionStack}>
                <TouchableOpacity
                  style={[
                    styles.btnPartial,
                    { borderColor: colors.primary, opacity: !canPartial || submitting ? 0.45 : 1 },
                  ]}
                  onPress={() => emit('partial')}
                  disabled={!canPartial || submitting}
                  accessibilityRole="button"
                  accessibilityLabel="Add partial payment"
                >
                  {submitting && submittingAction === 'partial' ? (
                    <ActivityIndicator color={colors.primary} style={{ alignSelf: 'center' }} />
                  ) : (
                    <Text style={[styles.btnPartialText, { color: colors.primary }]}>Add Partial Payment</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btnComplete, { opacity: !canComplete || submitting ? 0.45 : 1 }]}
                  onPress={() => emit('complete')}
                  disabled={!canComplete || submitting}
                  accessibilityRole="button"
                  accessibilityLabel="Complete advance received"
                >
                  {submitting && submittingAction === 'complete' ? (
                    <ActivityIndicator color="#fff" style={{ alignSelf: 'center' }} />
                  ) : (
                    <Text style={styles.btnCompleteText}>Complete Advance Received</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btnCancelWide, { borderColor: colors.border }]}
                  onPress={onRequestClose}
                  disabled={submitting}
                  accessibilityRole="button"
                >
                  <Text style={[styles.btnCancelWideText, { color: colors.textSecondary }]}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const getStyles = (colors, isDark) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      justifyContent: 'flex-end',
    },
    kav: {
      width: '100%',
      maxWidth: 520,
      alignSelf: 'center',
    },
    sheet: {
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      borderWidth: 1,
      borderBottomWidth: 0,
      overflow: 'hidden',
      marginHorizontal: 12,
    },
    sheetHandle: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: isDark ? '#475569' : '#cbd5e1',
      marginTop: 10,
      marginBottom: 6,
    },
    scrollContent: {
      paddingHorizontal: 18,
      paddingTop: 4,
      paddingBottom: 20,
    },
    actionsFooter: {
      paddingHorizontal: 18,
      paddingTop: 12,
      paddingBottom: 6,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    title: { fontSize: 18, fontWeight: '800', marginBottom: 6 },
    subtitle: { fontSize: 13, lineHeight: 19, marginBottom: 14 },
    summary: {
      borderWidth: 1,
      borderRadius: 12,
      padding: 12,
      marginBottom: 14,
    },
    summaryTitle: { fontSize: 15, fontWeight: '800' },
    summaryMeta: { marginTop: 6, fontSize: 13, lineHeight: 19, fontWeight: '600' },
    fieldLabel: { fontSize: 13, fontWeight: '800', marginBottom: 8 },
    req: { color: '#dc2626' },
    pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    pill: {
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 999,
      borderWidth: 1.5,
    },
    pillText: { fontSize: 13, fontWeight: '800' },
    inputWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1.5,
      borderRadius: 12,
      paddingHorizontal: 10,
      minHeight: 48,
    },
    inputIcon: { marginRight: 8 },
    input: {
      flex: 1,
      fontSize: 16,
      paddingVertical: Platform.OS === 'ios' ? 12 : 10,
      fontWeight: '600',
    },
    hint: { fontSize: 12, lineHeight: 17, marginBottom: 8, fontWeight: '600' },
    noteInput: {
      borderWidth: 1.5,
      borderRadius: 12,
      padding: 12,
      minHeight: 88,
      fontSize: 15,
      fontWeight: '600',
      marginTop: 6,
    },
    actionStack: {
      width: '100%',
      gap: 10,
    },
    btnPartial: {
      width: '100%',
      borderRadius: 12,
      borderWidth: 2,
      alignItems: 'stretch',
      justifyContent: 'center',
      paddingVertical: 12,
      paddingHorizontal: 10,
      minHeight: 52,
      backgroundColor: 'transparent',
    },
    btnPartialText: {
      width: '100%',
      fontWeight: '800',
      fontSize: 14,
      lineHeight: 19,
      textAlign: 'center',
    },
    btnComplete: {
      width: '100%',
      borderRadius: 12,
      alignItems: 'stretch',
      justifyContent: 'center',
      paddingVertical: 12,
      paddingHorizontal: 10,
      minHeight: 52,
      backgroundColor: '#059669',
    },
    btnCompleteText: {
      width: '100%',
      color: '#fff',
      fontWeight: '900',
      fontSize: 14,
      lineHeight: 19,
      textAlign: 'center',
    },
    btnCancelWide: {
      width: '100%',
      borderRadius: 12,
      borderWidth: 1.5,
      alignItems: 'stretch',
      justifyContent: 'center',
      paddingVertical: 12,
      paddingHorizontal: 10,
      minHeight: 48,
      backgroundColor: 'transparent',
    },
    btnCancelWideText: { width: '100%', fontWeight: '800', fontSize: 15, textAlign: 'center' },
  });
