import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';

/** Rich activity-log detail cards (snapshots, diffs, phone actions) — shared by BookingModal & SummaryScreen. */
export default function ActivityLogDetailPanels({ blocks, colors, isDark, dialPhone, itemKey }) {
  const historyChangeColor = isDark ? '#fca5a5' : '#b91c1c';
  const styles = useMemo(() => getPanelStyles(isDark), [isDark]);
  const prefix = itemKey != null ? String(itemKey) : 'log';

  if (!blocks || !blocks.length) return null;

  return (
    <>
      {blocks.map((block, bi) => (
        <View
          key={`${prefix}-d-${bi}`}
          style={[
            styles.panel,
            { borderColor: colors.border, backgroundColor: isDark ? '#1e293b' : '#f8fafc' },
          ]}
        >
          {block.title ? (
            <Text style={[styles.blockTitle, { color: colors.textSecondary }]}>{block.title}</Text>
          ) : null}
          {block.lines.map((line, li) => (
            <View key={li} style={styles.row}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>{line.label}</Text>
              <View style={styles.valueRow}>
                {line.changed ? (
                  <Icon name="edit" size={16} color={historyChangeColor} style={styles.changeIcon} />
                ) : null}
                <View style={styles.valueBody}>
                  <Text
                    style={[
                      styles.value,
                      {
                        color: line.changed ? historyChangeColor : colors.text,
                        fontWeight: line.changed ? '700' : '600',
                      },
                    ]}
                    selectable
                  >
                    {line.value}
                  </Text>
                  {line.phones && line.phones.length > 0 ? (
                    <View style={styles.phoneRow}>
                      {line.phones.map((tel) => (
                        <TouchableOpacity
                          key={tel}
                          onPress={() => dialPhone(tel)}
                          style={styles.phoneBtn}
                          accessibilityRole="button"
                          accessibilityLabel={`Call ${tel}`}
                        >
                          <Icon name="phone" size={22} color="#1565c0" />
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : null}
                </View>
              </View>
            </View>
          ))}
        </View>
      ))}
    </>
  );
}

const getPanelStyles = (isDark) =>
  StyleSheet.create({
    panel: {
      marginTop: 10,
      padding: 12,
      borderRadius: 10,
      borderWidth: 1,
    },
    blockTitle: {
      fontSize: 11,
      fontWeight: '800',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 8,
    },
    row: {
      marginBottom: 8,
    },
    label: {
      fontSize: 11,
      fontWeight: '700',
      marginBottom: 2,
    },
    valueRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 6,
    },
    changeIcon: {
      marginTop: 2,
    },
    valueBody: {
      flex: 1,
      minWidth: 0,
    },
    value: {
      fontSize: 13,
      lineHeight: 19,
    },
    phoneRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 6,
      marginTop: 6,
    },
    phoneBtn: {
      padding: 4,
      borderRadius: 8,
      backgroundColor: isDark ? 'rgba(21,101,192,0.2)' : 'rgba(21,101,192,0.12)',
    },
  });
