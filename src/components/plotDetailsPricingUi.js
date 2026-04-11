/**
 * Shared pricing UI used by Plot Details and Multi-plot summary so both stay visually aligned.
 */
import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';

/** Same ₹…/- formatting as Area Statement / Plot Details (`fmtRs`). */
export function fmtRsInr(n) {
  if (n == null || n === '' || Number.isNaN(Number(n))) return '—';
  return `₹${Number(n).toLocaleString('en-IN')}\u202F/\u2060-`;
}

export const EMI_INSTALLMENTS_LABEL = '36 Months';

/** Single-line rupee fragment for EMI rows (matches Area Statement `RupeeText`). */
export function EmiRupeeText({ style, children, ...rest }) {
  return (
    <Text
      style={style}
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.62}
      maxFontSizeMultiplier={1.25}
      {...rest}
    >
      {children}
    </Text>
  );
}

/**
 * EMI schedule: ₹…/- ×35 + ₹…/- ×1, or ₹…/- ×36 (Area Statement pattern).
 */
export function PlotDetailsEmiSchedule({ emi, lastEmi, styles, isScholar }) {
  const multStyle = [styles.detailsEmiMult, isScholar ? styles.detailsEmiMultScholar : null];
  const plusStyle = [styles.detailsEmiPlusRow, isScholar ? styles.detailsEmiPlusScholar : null];

  if (emi == null) {
    return (
      <View style={[styles.detailsEmiLineBox, styles.detailsEmiLineBoxLast]}>
        <Text style={styles.detailsEmiDash}>—</Text>
      </View>
    );
  }

  const Line = ({ amount, suffix, isLast }) => (
    <View style={[styles.detailsEmiLineBox, isLast ? styles.detailsEmiLineBoxLast : null]}>
      <View style={styles.detailsEmiAmtRow}>
        <EmiRupeeText style={[styles.detailsEmiRupee, styles.detailsEmiRupeeShrink]}>{fmtRsInr(amount)}</EmiRupeeText>
        <Text style={multStyle}>{suffix}</Text>
      </View>
    </View>
  );

  if (lastEmi != null) {
    return (
      <View style={styles.detailsEmiColInner}>
        <Line amount={emi} suffix="×35" />
        <Text style={plusStyle}>+</Text>
        <Line amount={lastEmi} suffix="×1" isLast />
      </View>
    );
  }

  return (
    <View style={styles.detailsEmiColInner}>
      <Line amount={emi} suffix="×36" isLast />
    </View>
  );
}

/** Standard pricing row: label left, ₹ value right (banking / wallet style). */
export function PricingStatRow({ label, amount, styles, isLast }) {
  const ok = amount != null && amount !== '' && !Number.isNaN(Number(amount));
  return (
    <View style={[styles.statRow, isLast && styles.statRowLast]}>
      <Text style={styles.statRowLabel} numberOfLines={2}>
        {label}
      </Text>
      <View style={styles.statRowValueCol}>
        {ok ? (
          <EmiRupeeText style={styles.statRowValue} maxFontSizeMultiplier={1.28}>
            {fmtRsInr(amount)}
          </EmiRupeeText>
        ) : (
          <Text style={styles.statRowValueMuted}>—</Text>
        )}
      </View>
    </View>
  );
}

export function PricingStatTextRow({ label, value, styles, isLast }) {
  return (
    <View style={[styles.statRow, isLast && styles.statRowLast]}>
      <Text style={styles.statRowLabel} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.statRowValueCol}>
        <Text style={styles.statRowValuePlain} numberOfLines={1}>
          {value}
        </Text>
      </View>
    </View>
  );
}

/** Styles for pricing cards, EMI block, summary header band, and plot badge cards — shared with Plot Details. */
export function createPlotDetailsPricingStyles(colors, isDark) {
  return StyleSheet.create({
    fixedPlotHeader: {
      flexShrink: 0,
      paddingHorizontal: 16,
      paddingBottom: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    detailsScroll: { flex: 1 },
    detailsScrollContent: {
      paddingHorizontal: 16,
      paddingTop: 12,
    },
    scrollEndSpacer: { height: 16 },
    summaryRow: {
      flexDirection: 'row',
      gap: 10,
      marginBottom: 6,
    },
    summaryCard: {
      flex: 1,
      minWidth: 0,
      borderRadius: 16,
      borderWidth: 2,
      paddingVertical: 10,
      paddingHorizontal: 11,
    },
    summaryCardPlot: {
      borderColor: isDark ? '#fbbf24' : '#d97706',
      backgroundColor: isDark ? '#422006' : '#fffbeb',
    },
    summaryCardArea: {
      borderColor: isDark ? '#22d3ee' : '#0891b2',
      backgroundColor: isDark ? '#083344' : '#ecfeff',
    },
    summaryCardLabelPlot: {
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 1,
      color: isDark ? '#fcd34d' : '#b45309',
      textTransform: 'uppercase',
      marginBottom: 6,
      textAlign: 'center',
    },
    summaryCardLabelArea: {
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 0.35,
      color: isDark ? '#a5f3fc' : '#0e7490',
      marginBottom: 6,
      textAlign: 'center',
    },
    summaryCardValuePlot: {
      fontSize: 28,
      fontWeight: '900',
      textAlign: 'center',
      color: isDark ? '#fef3c7' : '#78350f',
    },
    summaryCardValueArea: {
      fontSize: 28,
      fontWeight: '900',
      textAlign: 'center',
      color: isDark ? '#ecfeff' : '#155e75',
    },
    rateBandRow: {
      flexDirection: 'row',
      alignItems: 'stretch',
      gap: 6,
      marginBottom: 0,
    },
    compactBandBtn: {
      borderRadius: 12,
      borderWidth: 1.5,
      minHeight: 40,
      paddingHorizontal: 5,
      paddingVertical: 6,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
      minWidth: 0,
    },
    compactBandBtn40: {
      flex: 4,
    },
    statusPillInline: {
      flex: 2,
      minWidth: 0,
      minHeight: 40,
      borderRadius: 12,
      paddingHorizontal: 5,
      paddingVertical: 4,
      alignItems: 'center',
      justifyContent: 'center',
    },
    statusPillInlineText: {
      fontSize: 13,
      lineHeight: 16,
      fontWeight: '800',
      textAlign: 'center',
      width: '100%',
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
    compactBandLabel: {
      fontSize: 12,
      fontWeight: '800',
      color: colors.textSecondary,
      textAlign: 'center',
      flexShrink: 1,
      lineHeight: 15,
    },
    compactBandTextActiveOnBright: {
      color: '#0f172a',
      fontWeight: '900',
    },
    pricingCardModern: {
      width: '100%',
      alignSelf: 'stretch',
      borderRadius: 18,
      borderWidth: 2,
      paddingHorizontal: 16,
      paddingVertical: 16,
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 3 },
          shadowOpacity: isDark ? 0.4 : 0.14,
          shadowRadius: 10,
        },
        android: { elevation: 5 },
      }),
    },
    pricingCardModernSpacing: {
      marginTop: 16,
    },
    pricingCardModernHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginBottom: 4,
      paddingBottom: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: isDark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.1)',
    },
    pricingCardIconWrap: {
      width: 50,
      height: 50,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pricingCardIconWrapRegular: {
      backgroundColor: isDark ? 'rgba(251,191,36,0.22)' : 'rgba(245,158,11,0.28)',
    },
    pricingCardIconWrapScholar: {
      backgroundColor: isDark ? 'rgba(52,211,153,0.22)' : 'rgba(16,185,129,0.28)',
    },
    pricingCardModernTitle: {
      fontSize: 22,
      fontWeight: '800',
      color: colors.text,
      letterSpacing: 0.15,
      flex: 1,
    },
    statRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 14,
      minHeight: 54,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.09)',
      gap: 12,
    },
    statRowLast: {
      borderBottomWidth: 0,
      paddingBottom: 6,
      minHeight: 48,
    },
    statRowLabel: {
      flex: 1,
      fontSize: 17,
      fontWeight: '600',
      color: colors.textSecondary,
      lineHeight: 22,
    },
    statRowValueCol: {
      maxWidth: '58%',
      alignItems: 'flex-end',
      justifyContent: 'center',
      minWidth: 0,
    },
    statRowValue: {
      fontSize: 20,
      fontWeight: '800',
      color: colors.text,
      textAlign: 'right',
    },
    statRowValueMuted: {
      fontSize: 20,
      fontWeight: '700',
      color: colors.textSecondary,
    },
    statRowValuePlain: {
      fontSize: 20,
      fontWeight: '800',
      color: colors.text,
      textAlign: 'right',
    },
    emiScheduleSection: {
      paddingTop: 8,
      paddingBottom: 6,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.09)',
    },
    emiScheduleSectionLabel: {
      fontSize: 13,
      fontWeight: '800',
      letterSpacing: 1,
      color: colors.textSecondary,
      textTransform: 'uppercase',
      marginBottom: 6,
    },
    detailsEmiOuterBox: {
      width: '100%',
      borderWidth: 0,
      borderRadius: 0,
      overflow: 'visible',
    },
    detailsEmiOuterBoxRegular: {
      backgroundColor: 'transparent',
    },
    detailsEmiOuterBoxScholar: {
      backgroundColor: 'transparent',
    },
    detailsEmiColInner: {
      width: '100%',
    },
    detailsEmiLineBox: {
      width: '100%',
      paddingVertical: 1,
      paddingHorizontal: 0,
      borderBottomWidth: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    detailsEmiLineBoxLast: {
      borderBottomWidth: 0,
    },
    detailsEmiAmtRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      alignItems: 'center',
      alignContent: 'center',
      width: '100%',
      gap: 6,
    },
    detailsEmiRupee: {
      fontSize: 19,
      lineHeight: 24,
      fontWeight: '900',
      color: colors.text,
      textAlign: 'center',
    },
    detailsEmiRupeeShrink: {
      flexShrink: 1,
      minWidth: 0,
      textAlign: 'center',
    },
    detailsEmiMult: {
      fontSize: 18,
      lineHeight: 24,
      fontWeight: '900',
      color: colors.textSecondary,
      flexShrink: 0,
    },
    detailsEmiMultScholar: {
      color: '#7c3aed',
    },
    detailsEmiPlusRow: {
      width: '100%',
      textAlign: 'center',
      fontSize: 17,
      fontWeight: '900',
      lineHeight: 18,
      color: colors.text,
      paddingVertical: 0,
      marginVertical: 0,
      includeFontPadding: false,
    },
    detailsEmiPlusScholar: {
      color: '#7c3aed',
    },
    detailsEmiDash: {
      fontSize: 20,
      fontWeight: '800',
      color: colors.textSecondary,
      textAlign: 'center',
      width: '100%',
    },
    pricingCardBandRegular: {
      borderColor: isDark ? '#fbbf24' : '#ca8a04',
      backgroundColor: isDark ? '#292524' : '#fffbeb',
    },
    pricingCardBandScholar: {
      borderColor: isDark ? '#34d399' : '#059669',
      backgroundColor: isDark ? '#052e16' : '#ecfdf5',
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: '800',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 1.2,
      marginBottom: 10,
      marginTop: 4,
    },
  });
}
