import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Pressable,
  StyleSheet,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { useTheme } from '../context/ThemeContext';
import {
  CUSTOMER_CATEGORY_OPTIONS,
  labelForCustomerCategory,
  normalizeCustomerCategory,
} from '../utils/customerCategory';

export default function CustomerCategoryField({
  value,
  onChange,
  disabled = false,
  label = 'Customer type',
}) {
  const { colors, isDark } = useTheme();
  const [open, setOpen] = useState(false);
  const v = normalizeCustomerCategory(value);

  return (
    <View style={styles.wrap}>
      <Text style={[styles.lab, { color: colors.textSecondary }]}>{label}</Text>
      <TouchableOpacity
        onPress={() => !disabled && setOpen(true)}
        disabled={disabled}
        activeOpacity={0.85}
        style={[
          styles.btn,
          {
            borderColor: colors.border,
            backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : colors.background,
            opacity: disabled ? 0.55 : 1,
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${labelForCustomerCategory(v)}. Tap to change.`}
      >
        <Text style={[styles.btnText, { color: colors.text }]}>{labelForCustomerCategory(v)}</Text>
        <Icon name="arrow-drop-down" size={26} color={colors.textSecondary} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
          <View
            style={[
              styles.sheet,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.sheetTitle, { color: colors.text }]}>{label}</Text>
            {CUSTOMER_CATEGORY_OPTIONS.map((opt) => (
              <Pressable
                key={opt.value}
                onPress={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                style={({ pressed }) => [
                  styles.opt,
                  pressed && { opacity: 0.88 },
                  v === opt.value && {
                    backgroundColor: isDark ? 'rgba(59,130,246,0.18)' : '#e3f2fd',
                  },
                ]}
              >
                <Text style={[styles.optText, { color: colors.text }]}>{opt.label}</Text>
                {v === opt.value ? (
                  <Icon name="check" size={22} color={colors.primary} />
                ) : null}
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 4 },
  lab: { fontSize: 13, fontWeight: '600', marginBottom: 6, marginLeft: 2 },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    minHeight: 48,
  },
  btnText: { fontSize: 16, fontWeight: '600' },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'stretch',
    paddingHorizontal: 28,
  },
  sheet: {
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  sheetTitle: { fontSize: 16, fontWeight: '700', paddingHorizontal: 14, paddingVertical: 10 },
  opt: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  optText: { fontSize: 16, fontWeight: '500' },
});
