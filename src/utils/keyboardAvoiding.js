import { Platform } from 'react-native';

/**
 * KeyboardAvoidingView `behavior` that works across iOS and Android versions.
 * On Android, rely on native window resize to avoid duplicate bottom spacing
 * artifacts above the keyboard.
 */
export function keyboardAvoidingBehavior() {
  if (Platform.OS === 'ios') {
    return 'padding';
  }
  return undefined;
}
