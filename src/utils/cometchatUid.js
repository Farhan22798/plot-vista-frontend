/**
 * CometChat UID must match between createUser and login. Uses the same mobile
 * the user registered with (digits only so +91 / spaces still match).
 */
export function cometChatUidFromMobile(mobileNumber) {
  if (mobileNumber == null || mobileNumber === '') return null;
  const digits = String(mobileNumber).replace(/\D/g, '');
  if (digits.length > 0) return digits;
  const t = String(mobileNumber).trim();
  return t.length ? t : null;
}
