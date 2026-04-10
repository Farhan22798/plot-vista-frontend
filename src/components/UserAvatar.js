import React, { useContext, useState, useCallback, useEffect } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { UserAvatarContext } from '../context/UserAvatarContext';
import { nameOnly } from '../utils/formatting';

/**
 * Circular profile thumbnail for an actor (matched by display name).
 * Prefer imageUrl from API when provided (plots/summary payloads include avatar URLs).
 */
export default function UserAvatar({ name, size = 28, imageUrl, style }) {
  const { getAvatar } = useContext(UserAvatarContext);
  const direct = imageUrl && String(imageUrl).trim();
  const url = direct || getAvatar(name);
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => {
    setImgFailed(false);
  }, [url]);
  const onImgError = useCallback(() => setImgFailed(true), []);
  const label = nameOnly(name || '');
  const initialSource = label && label !== '-' ? label : '?';
  const initial = String(initialSource).charAt(0).toUpperCase();
  const dimension = { width: size, height: size, borderRadius: size / 2 };

  if (url && !imgFailed) {
    return (
      <Image
        source={{ uri: url }}
        style={[dimension, styles.img, style]}
        resizeMode="cover"
        onError={onImgError}
        accessibilityRole="image"
        accessibilityLabel={`Profile photo for ${label}`}
      />
    );
  }

  return (
    <View style={[dimension, styles.fallback, style]} accessibilityRole="image" accessibilityLabel={label}>
      <Text style={[styles.initial, { fontSize: Math.max(10, size * 0.4) }]}>{initial}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  img: {
    backgroundColor: '#e2e8f0',
  },
  fallback: {
    backgroundColor: '#6366f1',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  initial: {
    color: '#fff',
    fontWeight: '800',
  },
});
