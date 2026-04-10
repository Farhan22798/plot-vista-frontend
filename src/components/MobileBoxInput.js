import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from 'react-native';

/**
 * 10-box mobile number input.
 * Each box matches the height of a standard text input (padding:14 each side).
 * Width is distributed evenly via flex. Uses a hidden TextInput for keyboard,
 * paste, and autofill. Enforces digits-only, max 10.
 */
export default function MobileBoxInput({
  value = '',
  onChange,
  colors,
  isDark,
  containerStyle,
  autoFocus = false,
  editable = true,
}) {
  const hiddenRef = useRef(null);
  const blinkAnim = useRef(new Animated.Value(1)).current;
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(blinkAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
        Animated.timing(blinkAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => { blinkAnim.setValue(1); loop.stop(); };
  }, [blinkAnim, isFocused]);

  const handleChange = useCallback(
    (text) => {
      if (!editable) return;
      const clean = text.replace(/\D/g, '').slice(0, 10);
      onChange(clean);
    },
    [onChange, editable],
  );

  const focus = useCallback(() => {
    if (editable) hiddenRef.current?.focus();
  }, [editable]);

  const digits = Array.from({ length: 10 }, (_, i) => value[i] || '');
  const cursorPos = Math.min(value.length, 9);
  const isComplete = value.length === 10;

  return (
    <TouchableOpacity
      onPress={focus}
      activeOpacity={1}
      style={[styles.row, containerStyle]}
      accessibilityRole="none"
      accessibilityLabel="Mobile number input"
    >
      {digits.map((digit, i) => {
        const isFilled = Boolean(digit);
        const isCursor = !isComplete && i === cursorPos && editable && isFocused;

        return (
          <View
            key={i}
            style={[
              styles.box,
              {
                borderColor: isFilled || isCursor ? colors.primary : colors.border,
                borderWidth: isFilled || isCursor ? 1.5 : 1,
                backgroundColor: isFilled
                  ? (isDark ? '#1e3a5f' : '#eff6ff')
                  : (isDark ? colors.inputBackground : '#f8fafc'),
                marginRight: i < 9 ? 3 : 0,
              },
            ]}
          >
            {isFilled ? (
              <Text style={[styles.digit, { color: colors.text }]}>{digit}</Text>
            ) : isCursor ? (
              <Animated.View
                style={[styles.cursor, { backgroundColor: colors.primary, opacity: blinkAnim }]}
              />
            ) : (
              <View style={[styles.dot, { backgroundColor: colors.border }]} />
            )}
          </View>
        );
      })}

      <TextInput
        ref={hiddenRef}
        style={styles.hidden}
        value={value}
        onChangeText={handleChange}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        keyboardType="number-pad"
        maxLength={10}
        caretHidden
        autoCorrect={false}
        autoComplete="tel"
        textContentType="telephoneNumber"
        autoFocus={autoFocus}
        editable={editable}
        importantForAccessibility="no"
      />
    </TouchableOpacity>
  );
}

const BOX_HEIGHT = 48; // matches padding:14 top+bottom + fontSize:16 of regular inputs

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  box: {
    flex: 1,
    height: BOX_HEIGHT,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  digit: {
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
    includeFontPadding: false,
  },
  cursor: {
    width: 2,
    height: 20,
    borderRadius: 1,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    opacity: 0.3,
  },
  hidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    left: -9999,
  },
});
