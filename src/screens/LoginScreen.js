import React, { useContext, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialIcons';
import MobileBoxInput from '../components/MobileBoxInput';
import ForgotPasswordModal from '../components/ForgotPasswordModal';
import { AuthContext } from '../context/AuthContext';
import { useAlert } from '../context/AlertContext';
import { useTheme } from '../context/ThemeContext';
import { SITE_NAME, SITE_TAGLINE } from '../constants/siteBranding.js';
import { keyboardAvoidingBehavior } from '../utils/keyboardAvoiding';
import {
  isBiometricAvailable,
  promptBiometric,
  saveBiometricCredentials,
  getBiometricCredentials,
  isBiometricEnabled,
} from '../utils/biometricAuth';
const BIOMETRY_ICONS = {
  FaceID: 'face',
  TouchID: 'fingerprint',
  Biometrics: 'fingerprint',
};

const LoginScreen = ({ navigation }) => {
  const { isDark, colors } = useTheme();
  const styles = React.useMemo(() => getStyles(colors, isDark), [colors, isDark]);
  const [mobileNumber, setMobileNumber] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const { login, verifyLoginOtp, resendLoginOtp, isLoading } = useContext(AuthContext);
  const { showAlert } = useAlert();

  const [biometricReady, setBiometricReady] = useState(false);
  const [biometryType, setBiometryType] = useState(null);

  /**
   * OTP step state — populated when /auth/login responds with otpRequired:true.
   * Holding `password` here lets us save biometric credentials only AFTER the
   * OTP step completes successfully (so a leaked password that never clears
   * OTP can't get cached for fingerprint use).
   */
  const [otpStep, setOtpStep] = useState(null); // { loginChallengeId, emailHint, mobileNumber, password, expiresInSec }
  const [otpCode, setOtpCode] = useState('');
  const [otpSubmitting, setOtpSubmitting] = useState(false);
  const [otpResending, setOtpResending] = useState(false);
  const [otpResendCooldown, setOtpResendCooldown] = useState(0);
  // Local in-flight flag for the password login (and biometric login) button.
  // We can't use AuthContext.isLoading anymore — toggling that mid-action
  // would unmount the screen (NavigationWrapper renders only a spinner when
  // it's true) and lose `otpStep`. Local state keeps the screen mounted.
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const { available, biometryType: type } = await isBiometricAvailable();
      if (!available) return;
      const enabled = await isBiometricEnabled();
      const creds = await getBiometricCredentials();
      if (enabled && creds) {
        setBiometricReady(true);
        setBiometryType(type);
        setMobileNumber(creds.mobile);
      }
    })();
  }, []);

  // Tick down the resend-cooldown each second so the user sees when they can retry.
  useEffect(() => {
    if (otpResendCooldown <= 0) return undefined;
    const t = setTimeout(() => setOtpResendCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [otpResendCooldown]);

  /**
   * Saves biometric credentials only after a fully successful login (post-OTP
   * if needed). Wrapping in a try/catch + microtask so this never blocks the
   * UI or surfaces errors — the screen is unmounting at this point.
   */
  const tryPersistBiometric = useCallback(async (mobile, plainPassword) => {
    try {
      const { available } = await isBiometricAvailable();
      if (!available) return;
      saveBiometricCredentials(mobile, plainPassword).catch(() => {});
    } catch (_) {}
  }, []);

  const handleBiometricLogin = useCallback(async () => {
    if (submitting) return;
    try {
      const creds = await getBiometricCredentials();
      if (!creds) {
        showAlert('Biometric Login', 'No saved credentials. Please log in with your password first.');
        return;
      }
      const ok = await promptBiometric('Log in to Plot Vista');
      if (!ok) return;
      setSubmitting(true);
      // Biometric uses saved credentials. The `login()` helper attaches the
      // device trust token automatically, so the server skips OTP. If for any
      // reason the trust token is missing (e.g. cleared storage), the user
      // will be taken through the OTP step — which is the correct conservative
      // fallback.
      const result = await login(creds.mobile, creds.password);
      if (result?.otpRequired) {
        setOtpStep({
          loginChallengeId: result.loginChallengeId,
          emailHint: result.emailHint,
          mobileNumber: result.mobileNumber,
          password: result.password,
          expiresInSec: result.expiresInSec,
        });
        setOtpResendCooldown(60);
      }
    } catch (e) {
      showAlert('Login failed', e.response?.data?.message || 'Biometric login failed. Try password.');
    } finally {
      setSubmitting(false);
    }
  }, [login, showAlert, submitting]);

  const handleLogin = async () => {
    if (submitting) return;
    if (!mobileNumber || !password) {
      showAlert('Error', 'Please fill in all fields');
      return;
    }
    if (mobileNumber.length !== 10) {
      showAlert('Error', 'Please enter a valid 10-digit mobile number');
      return;
    }
    try {
      setSubmitting(true);
      const result = await login(mobileNumber.trim(), password);

      if (result?.otpRequired) {
        // Move to OTP step. Don't save biometric creds yet — only after OTP success.
        setOtpStep({
          loginChallengeId: result.loginChallengeId,
          emailHint: result.emailHint,
          mobileNumber: result.mobileNumber,
          password: result.password,
          expiresInSec: result.expiresInSec,
        });
        setOtpCode('');
        setOtpResendCooldown(60);
        return;
      }

      // Direct login (trusted device or legacy no-email account) — safe to
      // persist biometric credentials immediately.
      tryPersistBiometric(mobileNumber.trim(), password);
    } catch (e) {
      showAlert('Login failed', e.response?.data?.message || 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otpStep?.loginChallengeId) return;
    const code = otpCode.trim();
    if (!/^\d{6}$/.test(code)) {
      showAlert('Code required', 'Enter the 6-digit code sent to your email.');
      return;
    }
    try {
      setOtpSubmitting(true);
      await verifyLoginOtp(otpStep.loginChallengeId, code, otpStep.mobileNumber);
      // OTP cleared — now it's safe to save biometric creds (this device is trusted).
      tryPersistBiometric(otpStep.mobileNumber, otpStep.password);
    } catch (e) {
      showAlert(
        'Verification failed',
        e.response?.data?.message || 'Could not verify the code. Try again.',
      );
    } finally {
      setOtpSubmitting(false);
    }
  };

  const handleResendOtp = async () => {
    if (!otpStep?.loginChallengeId || otpResendCooldown > 0) return;
    try {
      setOtpResending(true);
      const data = await resendLoginOtp(otpStep.loginChallengeId);
      setOtpResendCooldown(60);
      showAlert(
        'Code sent',
        `A new 6-digit code was sent to ${data?.emailHint || otpStep.emailHint || 'your email'}.`,
      );
    } catch (e) {
      const msg = e.response?.data?.message || 'Could not resend the code.';
      showAlert('Resend failed', msg);
    } finally {
      setOtpResending(false);
    }
  };

  const cancelOtpStep = () => {
    setOtpStep(null);
    setOtpCode('');
    setOtpSubmitting(false);
    setOtpResending(false);
    setOtpResendCooldown(0);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={keyboardAvoidingBehavior()}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hero}>
            <Text style={styles.tagline}>{SITE_TAGLINE}</Text>
            <Text style={styles.brand}>{SITE_NAME}</Text>
            <View style={styles.rule} />
            <Text style={styles.screenTitle}>{otpStep ? 'Verify it\u2019s you' : 'Sign in'}</Text>
            <Text style={styles.subtitle}>
              {otpStep
                ? `For your security, enter the 6-digit code we sent to ${otpStep.emailHint || 'your email'}.`
                : 'Use your registered mobile number and password.'}
            </Text>
          </View>

          {!otpStep ? (
            <View style={styles.card}>
              <View style={styles.inputContainer}>
                <Text style={styles.label}>Mobile number</Text>
                <MobileBoxInput
                  value={mobileNumber}
                  onChange={setMobileNumber}
                  colors={colors}
                  isDark={isDark}
                />
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.label}>Password</Text>
                <View style={styles.passwordRow}>
                  <TextInput
                    placeholderTextColor={colors.placeholder}
                    style={styles.passwordInput}
                    placeholder="Enter password"
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPassword}
                  />
                  <TouchableOpacity
                    style={styles.eyeButton}
                    onPress={() => setShowPassword((v) => !v)}
                    accessibilityRole="button"
                    accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                  >
                    <Icon
                      name={showPassword ? 'visibility-off' : 'visibility'}
                      size={22}
                      color={colors.textSecondary}
                    />
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  onPress={() => setForgotOpen(true)}
                  style={styles.forgotLinkWrap}
                  accessibilityRole="button"
                  accessibilityLabel="Forgot password"
                >
                  <Text style={styles.forgotLink}>Forgot password?</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[styles.button, submitting && styles.buttonDisabled]}
                onPress={handleLogin}
                disabled={submitting}
                accessibilityState={{ busy: submitting, disabled: submitting }}
              >
                {submitting ? (
                  <View style={styles.buttonContentRow}>
                    <ActivityIndicator size="small" color="#fff" />
                    <Text style={[styles.buttonText, styles.buttonTextWithSpinner]}>
                      Signing in…
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.buttonText}>Log in</Text>
                )}
              </TouchableOpacity>

              {biometricReady && (
                <TouchableOpacity
                  style={[styles.biometricBtn, submitting && styles.buttonDisabled]}
                  onPress={handleBiometricLogin}
                  disabled={submitting}
                  accessibilityRole="button"
                  accessibilityLabel="Log in with biometrics"
                >
                  <Icon
                    name={BIOMETRY_ICONS[biometryType] || 'fingerprint'}
                    size={28}
                    color={colors.primary}
                  />
                  <Text style={styles.biometricText}>Use Biometrics</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <View style={styles.card}>
              <View style={styles.otpHintBox}>
                <Icon name="mark-email-read" size={20} color={colors.primary} />
                <Text style={styles.otpHintText}>
                  Code sent to <Text style={styles.otpHintEmail}>{otpStep.emailHint || 'your email'}</Text>.
                  This step happens only on a new device.
                </Text>
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.label}>6-digit code</Text>
                <TextInput
                  placeholderTextColor={colors.placeholder}
                  style={styles.otpInput}
                  placeholder="••••••"
                  value={otpCode}
                  onChangeText={(t) => setOtpCode(t.replace(/\D/g, '').slice(0, 6))}
                  keyboardType="number-pad"
                  autoFocus
                  maxLength={6}
                  textAlign="center"
                />
              </View>

              {otpSubmitting || isLoading ? (
                <ActivityIndicator size="large" color={colors.primary} style={styles.spinner} />
              ) : (
                <TouchableOpacity
                  style={[styles.button, otpCode.length !== 6 && styles.buttonDisabled]}
                  onPress={handleVerifyOtp}
                  disabled={otpCode.length !== 6}
                >
                  <Text style={styles.buttonText}>Verify & sign in</Text>
                </TouchableOpacity>
              )}

              <View style={styles.otpFooterRow}>
                <TouchableOpacity onPress={cancelOtpStep} style={styles.otpFooterBtn}>
                  <Text style={styles.otpFooterMuted}>Use another account</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleResendOtp}
                  disabled={otpResendCooldown > 0 || otpResending}
                  style={styles.otpFooterBtn}
                  accessibilityRole="button"
                >
                  {otpResending ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Text
                      style={[
                        styles.otpFooterLink,
                        otpResendCooldown > 0 && styles.otpFooterLinkDisabled,
                      ]}
                    >
                      {otpResendCooldown > 0 ? `Resend in ${otpResendCooldown}s` : 'Resend code'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}

          {!otpStep && (
            <View style={styles.footer}>
              <Text style={styles.footerText}>No account yet? </Text>
              <TouchableOpacity onPress={() => navigation.navigate('Signup')}>
                <Text style={styles.linkText}>Create one</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      <ForgotPasswordModal visible={forgotOpen} onClose={() => setForgotOpen(false)} initialEmail="" />
    </SafeAreaView>
  );
};

const getStyles = (colors, isDark) => {
  const gold = isDark ? '#E4C76B' : '#9A7209';
  const goldRule = isDark ? '#C4A84A' : '#B8860B';

  return StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: colors.background,
    },
    flex: {
      flex: 1,
    },
    scrollContent: {
      flexGrow: 1,
      justifyContent: 'center',
      paddingHorizontal: 22,
      paddingVertical: 24,
    },
    hero: {
      marginBottom: 28,
    },
    tagline: {
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 1.4,
      textTransform: 'uppercase',
      color: colors.textSecondary,
      marginBottom: 6,
    },
    brand: {
      fontSize: 30,
      fontWeight: '800',
      letterSpacing: 2,
      color: gold,
    },
    rule: {
      width: 48,
      height: 3,
      backgroundColor: goldRule,
      borderRadius: 2,
      marginTop: 12,
      marginBottom: 22,
    },
    screenTitle: {
      fontSize: 22,
      fontWeight: '800',
      color: colors.text,
      marginBottom: 8,
    },
    subtitle: {
      fontSize: 15,
      lineHeight: 22,
      color: colors.textSecondary,
      fontWeight: '500',
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 20,
      borderWidth: 1,
      borderColor: isDark ? '#334155' : colors.border,
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: isDark ? 0.25 : 0.08,
          shadowRadius: 16,
        },
        android: { elevation: 3 },
      }),
    },
    inputContainer: {
      marginBottom: 18,
    },
    label: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textSecondary,
      marginBottom: 8,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    input: {
      backgroundColor: isDark ? colors.inputBackground : '#f8fafc',
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
      borderRadius: 12,
      fontSize: 16,
      color: colors.text,
    },
    passwordRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: isDark ? colors.inputBackground : '#f8fafc',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
    },
    passwordInput: {
      flex: 1,
      padding: 14,
      fontSize: 16,
      color: colors.text,
    },
    eyeButton: {
      paddingHorizontal: 14,
      paddingVertical: 14,
    },
    forgotLinkWrap: {
      alignSelf: 'flex-end',
      marginTop: 8,
      paddingVertical: 4,
    },
    forgotLink: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.primary,
    },
    spinner: {
      marginTop: 12,
    },
    button: {
      backgroundColor: colors.primary,
      paddingVertical: 16,
      borderRadius: 12,
      alignItems: 'center',
      marginTop: 8,
    },
    buttonDisabled: {
      opacity: 0.5,
    },
    buttonText: {
      color: '#fff',
      fontSize: 17,
      fontWeight: '800',
      letterSpacing: 0.3,
    },
    buttonContentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
    },
    buttonTextWithSpinner: {
      marginLeft: 4,
    },
    otpHintBox: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      padding: 12,
      borderRadius: 10,
      backgroundColor: isDark ? '#1e293b' : '#f1f5f9',
      borderWidth: 1,
      borderColor: isDark ? '#334155' : colors.border,
      marginBottom: 16,
    },
    otpHintText: {
      flex: 1,
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSecondary,
      fontWeight: '600',
    },
    otpHintEmail: {
      color: colors.text,
      fontWeight: '800',
    },
    otpInput: {
      backgroundColor: isDark ? colors.inputBackground : '#f8fafc',
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: 14,
      borderRadius: 12,
      fontSize: 26,
      fontWeight: '800',
      letterSpacing: 12,
      color: colors.text,
    },
    otpFooterRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: 14,
    },
    otpFooterBtn: {
      paddingVertical: 6,
      paddingHorizontal: 4,
    },
    otpFooterMuted: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textSecondary,
    },
    otpFooterLink: {
      fontSize: 13,
      fontWeight: '800',
      color: colors.primary,
    },
    otpFooterLinkDisabled: {
      opacity: 0.5,
    },
    biometricBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      marginTop: 14,
      paddingVertical: 14,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: isDark ? '#334155' : colors.border,
      backgroundColor: isDark ? '#1e293b' : '#f8fafc',
    },
    biometricText: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.primary,
    },
    footer: {
      flexDirection: 'row',
      justifyContent: 'center',
      marginTop: 28,
      flexWrap: 'wrap',
    },
    footerText: {
      fontSize: 15,
      color: colors.textSecondary,
    },
    linkText: {
      fontSize: 15,
      color: colors.primary,
      fontWeight: '800',
    },
  });
};

export default LoginScreen;
