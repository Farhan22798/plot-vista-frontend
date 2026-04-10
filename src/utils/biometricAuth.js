import ReactNativeBiometrics from 'react-native-biometrics';
import AsyncStorage from '@react-native-async-storage/async-storage';

const rnBiometrics = new ReactNativeBiometrics({ allowDeviceCredentials: true });

const KEYS = {
  enabled: 'biometric_enabled',
  mobile: 'biometric_mobile',
  password: 'biometric_password',
};

/**
 * Check if the device supports biometrics (fingerprint, face, iris).
 * Returns { available: boolean, biometryType: string | undefined }
 */
export async function isBiometricAvailable() {
  try {
    const { available, biometryType } = await rnBiometrics.isSensorAvailable();
    if (__DEV__) console.log('[Biometric] sensor available:', available, 'type:', biometryType);
    return { available, biometryType };
  } catch (err) {
    if (__DEV__) console.log('[Biometric] sensor check error:', err?.message);
    return { available: false, biometryType: undefined };
  }
}

/**
 * Prompt the device biometric (fingerprint/face).
 * Returns true if authentication succeeded.
 */
export async function promptBiometric(promptMessage = 'Log in with biometrics') {
  try {
    const { success } = await rnBiometrics.simplePrompt({ promptMessage });
    if (__DEV__) console.log('[Biometric] prompt result:', success);
    return success;
  } catch (err) {
    if (__DEV__) console.log('[Biometric] prompt error:', err?.message);
    return false;
  }
}

/** Store login credentials for biometric quick-login. */
export async function saveBiometricCredentials(mobileNumber, password) {
  if (__DEV__) console.log('[Biometric] saving credentials for', mobileNumber);
  await AsyncStorage.setItem(KEYS.enabled, 'true');
  await AsyncStorage.setItem(KEYS.mobile, mobileNumber);
  await AsyncStorage.setItem(KEYS.password, password);
  if (__DEV__) console.log('[Biometric] credentials saved successfully');
}

/** Retrieve stored credentials. Returns { mobile, password } or null. */
export async function getBiometricCredentials() {
  const enabled = await AsyncStorage.getItem(KEYS.enabled);
  if (enabled !== 'true') return null;
  const mobile = await AsyncStorage.getItem(KEYS.mobile);
  const password = await AsyncStorage.getItem(KEYS.password);
  if (mobile && password) return { mobile, password };
  return null;
}

/** Check if biometric login was previously enabled by the user. */
export async function isBiometricEnabled() {
  const val = await AsyncStorage.getItem(KEYS.enabled);
  return val === 'true';
}

/** Clear stored biometric credentials (e.g. on explicit disable). */
export async function clearBiometricCredentials() {
  await AsyncStorage.removeItem(KEYS.enabled);
  await AsyncStorage.removeItem(KEYS.mobile);
  await AsyncStorage.removeItem(KEYS.password);
}
