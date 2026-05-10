import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Per-mobile device trust tokens.
 *
 * After a user clears the email-OTP login challenge on this device, the server
 * issues an opaque per-account trust token. We persist it here, scoped per
 * mobile number so multiple accounts on the same device each have their own
 * trust state. When the same user logs in again with a password (or via
 * biometric, which uses the saved password under the hood), we attach this
 * token to the /auth/login request and the server skips OTP.
 *
 * Tokens MUST survive `logout()` so a re-login on the same device doesn't
 * trigger OTP again. Clearing happens only on:
 *   - Explicit user action (e.g. "Forget this device" — not yet wired in UI).
 *   - App data wipe / uninstall.
 *   - Biometric disable also clears, since the user likely intends to re-verify.
 */

const KEY_PREFIX = 'deviceTrustToken:';

function normalizeMobile(mobile) {
  return String(mobile || '').replace(/\D/g, '').trim();
}

function keyFor(mobile) {
  const m = normalizeMobile(mobile);
  return m ? `${KEY_PREFIX}${m}` : null;
}

/** Returns the trust token for this mobile, or null. */
export async function getDeviceTrustToken(mobile) {
  const key = keyFor(mobile);
  if (!key) return null;
  try {
    const v = await AsyncStorage.getItem(key);
    return v && v.trim() ? v : null;
  } catch (_) {
    return null;
  }
}

/** Persist the trust token issued by the server after OTP success. */
export async function saveDeviceTrustToken(mobile, token) {
  const key = keyFor(mobile);
  const t = String(token || '').trim();
  if (!key || !t) return;
  try {
    await AsyncStorage.setItem(key, t);
  } catch (_) {
    // Non-fatal: a missing trust token just means an OTP next time.
  }
}

/** Forget this device for the given mobile — next password login will re-OTP. */
export async function clearDeviceTrustToken(mobile) {
  const key = keyFor(mobile);
  if (!key) return;
  try {
    await AsyncStorage.removeItem(key);
  } catch (_) {}
}
