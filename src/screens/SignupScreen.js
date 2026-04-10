import React, { useContext, useRef, useState } from 'react';
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
  Image,
  Alert,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialIcons';
import MobileBoxInput from '../components/MobileBoxInput';
import { pickProfilePhotoCamera, pickProfilePhotoLibrary } from '../utils/profileImagePicker';
import { CometChat } from '@cometchat/chat-sdk-react-native';
import { CometChatUIKit } from '@cometchat/chat-uikit-react-native';
import { AuthContext } from '../context/AuthContext';
import { useAlert } from '../context/AlertContext';
import { useTheme } from '../context/ThemeContext';
import { initCometChatOnce } from '../services/cometchatLifecycle';
import { cometChatUidFromMobile } from '../utils/cometchatUid';
import { SITE_NAME, SITE_TAGLINE } from '../constants/siteBranding.js';
import { keyboardAvoidingBehavior } from '../utils/keyboardAvoiding';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Fire-and-forget: create the CometChat user profile immediately after backend
 * registration so the UID exists before the user's first login.
 * Group membership is handled by CometChatSession on first login.
 */
async function provisionCometChatUser(mobileNumber, displayName) {
  try {
    const isInitialized = await initCometChatOnce();
    if (!isInitialized) return;
    const uid = cometChatUidFromMobile(mobileNumber);
    if (!uid) return;
    const user = new CometChat.User(uid);
    user.setName(String(displayName || '').trim() || uid);
    await CometChatUIKit.createUser(user);
  } catch (_) {
    // Non-blocking; already-exists errors are fine — CometChatSession handles the rest on login.
  }
}

const SignupScreen = ({ navigation }) => {
  const { isDark, colors } = useTheme();
  const styles = React.useMemo(() => getStyles(colors, isDark), [colors, isDark]);
  const [name, setName] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [email, setEmail] = useState('');
  const [emailOtp, setEmailOtp] = useState('');
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [otpHint, setOtpHint] = useState('');
  const [otpHintTone, setOtpHintTone] = useState('success');
  const [fieldErrors, setFieldErrors] = useState({});
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [photoUri, setPhotoUri] = useState(null);
  const [photoBase64, setPhotoBase64] = useState(null);
  const [highlightedField, setHighlightedField] = useState(null);
  const { register, sendSignupOtp, verifySignupOtp, isLoading } = useContext(AuthContext);
  const { showAlert } = useAlert();
  const scrollRef = useRef(null);
  const fieldOffsetsRef = useRef({});
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const pulseScale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.02],
  });

  const FIELD_ORDER = ['photo', 'name', 'mobile', 'email', 'emailOtp', 'password', 'confirmPassword'];

  const registerFieldOffset = (fieldKey) => (event) => {
    fieldOffsetsRef.current[fieldKey] = event?.nativeEvent?.layout?.y ?? 0;
  };

  const focusField = (fieldKey, message, popupTitle = 'Please fix this') => {
    const y = fieldOffsetsRef.current[fieldKey];
    if (typeof y === 'number') {
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 24), animated: true });
    }
    setHighlightedField(fieldKey);
    pulseAnim.setValue(0);
    Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 0, duration: 140, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 0, duration: 140, useNativeDriver: true }),
    ]).start(() => setHighlightedField(null));
    if (message) showAlert(popupTitle, message);
  };

  const applyPickedResult = (result) => {
    if (!result?.base64) {
      showAlert('Error', 'Could not read the photo. Try another image.');
      return;
    }
    setPhotoUri(result.uri || null);
    setPhotoBase64(result.base64);
    setFieldErrors((prev) => ({ ...prev, photo: '' }));
  };

  const pickCamera = async () => {
    try {
      const result = await pickProfilePhotoCamera();
      if (result) applyPickedResult(result);
    } catch (e) {
      showAlert('Camera', e?.message || 'Could not open camera or crop photo.');
    }
  };

  const pickLibrary = async () => {
    try {
      const result = await pickProfilePhotoLibrary();
      if (result) applyPickedResult(result);
    } catch (e) {
      showAlert('Gallery', e?.message || 'Could not open gallery or crop photo.');
    }
  };

  const openPhotoPicker = () => {
    Alert.alert(
      'Profile photo',
      'Choose a photo, then drag and pinch to adjust the crop (circle guide). Confirm when done.',
      [
        { text: 'Camera', onPress: pickCamera },
        { text: 'Gallery', onPress: pickLibrary },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };

  const onEmailChange = (text) => {
    setEmail(text);
    setEmailOtp('');
    setOtpSent(false);
    setEmailVerified(false);
    setOtpHint('');
    setOtpHintTone('success');
    setFieldErrors((prev) => ({ ...prev, email: '', emailOtp: '' }));
  };

  const handleSendSignupOtp = async () => {
    const emailTrim = email.trim().toLowerCase();
    if (!EMAIL_RE.test(emailTrim)) {
      const msg = 'Please enter a valid email address first.';
      setFieldErrors((prev) => ({ ...prev, email: msg }));
      focusField('email', msg);
      return;
    }
    setOtpSending(true);
    setOtpHint('');
    setOtpHintTone('success');
    try {
      await sendSignupOtp(emailTrim);
      setOtpSent(true);
      setEmailVerified(false);
      setOtpHint('Code sent - check your inbox (expires in 10 min).');
      setOtpHintTone('success');
      setFieldErrors((prev) => ({ ...prev, email: '', emailOtp: '' }));
    } catch (e) {
      showAlert('Could not send code', e.response?.data?.message || 'Try again later.');
    } finally {
      setOtpSending(false);
    }
  };

  const handleVerifySignupOtp = async () => {
    const emailTrim = email.trim().toLowerCase();
    if (!EMAIL_RE.test(emailTrim)) {
      const msg = 'Please enter a valid email address first.';
      setFieldErrors((prev) => ({ ...prev, email: msg }));
      focusField('email', msg);
      return;
    }
    if (!otpSent) {
      const msg = 'Please send verification code first.';
      setFieldErrors((prev) => ({ ...prev, emailOtp: msg }));
      focusField('emailOtp', msg);
      return;
    }
    const otpDigits = emailOtp.replace(/\D/g, '');
    if (otpDigits.length !== 6) {
      const msg = 'Please enter the 6-digit verification code.';
      setFieldErrors((prev) => ({ ...prev, emailOtp: msg }));
      focusField('emailOtp', msg);
      return;
    }
    setOtpVerifying(true);
    try {
      await verifySignupOtp(emailTrim, otpDigits);
      setEmailVerified(true);
      setOtpHint('Email verified successfully. You can continue.');
      setOtpHintTone('success');
      setFieldErrors((prev) => ({ ...prev, email: '', emailOtp: '' }));
    } catch (e) {
      setEmailVerified(false);
      setOtpHint(e.response?.data?.message || 'Verification failed. Please check the code and try again.');
      setOtpHintTone('error');
      setFieldErrors((prev) => ({
        ...prev,
        emailOtp: 'Verification failed. Please enter the correct code.',
      }));
    } finally {
      setOtpVerifying(false);
    }
  };

  const getSignupValidationErrors = () => {
    const errors = {};
    const nameTrim = String(name || '').trim();
    const mobileTrim = String(mobileNumber || '').trim();
    const emailTrim = String(email || '').trim().toLowerCase();
    const otpDigits = String(emailOtp || '').replace(/\D/g, '');
    if (!photoBase64) errors.photo = 'Please add a profile photo. Without it, you cannot register.';
    if (!nameTrim) errors.name = 'Please enter your full name.';
    if (mobileTrim.length !== 10) errors.mobile = 'Please enter a valid 10-digit mobile number.';
    if (!emailTrim || !EMAIL_RE.test(emailTrim)) errors.email = 'Please enter a valid email address.';
    if (!otpSent) errors.emailOtp = 'Please send the email verification code.';
    if (!emailVerified) {
      if (otpDigits.length !== 6) errors.emailOtp = 'Please enter the 6-digit verification code.';
      if (!errors.emailOtp) errors.emailOtp = 'Please verify your email to continue.';
    }
    if (!password) errors.password = 'Please enter a password.';
    if (password && password.length < 6) errors.password = 'Please enter a password with at least 6 characters.';
    if (!confirmPassword) errors.confirmPassword = 'Please confirm your password.';
    if (password && confirmPassword && password !== confirmPassword) {
      errors.confirmPassword = 'Passwords do not match. Please check and try again.';
    }
    return errors;
  };

  const handleSignup = async () => {
    const errors = getSignupValidationErrors();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      const firstInvalid = FIELD_ORDER.find((k) => errors[k]);
      if (firstInvalid) {
        focusField(firstInvalid, errors[firstInvalid], 'Registration incomplete');
      }
      return;
    }
    const emailTrim = email.trim().toLowerCase();
    const otpDigits = emailOtp.replace(/\D/g, '');
    try {
      const trimmedMobile = mobileNumber.trim();
      const trimmedName = name.trim();
      await register(trimmedName, trimmedMobile, emailTrim, otpDigits, password, photoBase64);
      // Pre-create the CometChat user profile in the background so the UID is
      // ready before first login. Group join happens in CometChatSession on login.
      provisionCometChatUser(trimmedMobile, trimmedName);
      showAlert(
        'Registration successful',
        'Your account is pending admin approval. You can sign in later to check status.',
        [{ text: 'OK', onPress: () => navigation.navigate('Login') }]
      );
    } catch (e) {
      showAlert('Signup failed', e.response?.data?.message || 'Something went wrong');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={keyboardAvoidingBehavior()}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hero}>
            <Text style={styles.tagline}>{SITE_TAGLINE}</Text>
            <Text style={styles.brand}>{SITE_NAME}</Text>
            <View style={styles.rule} />
            <Text style={styles.screenTitle}>Create account</Text>
            <Text style={styles.subtitle}>
              An administrator will approve access after you register.
            </Text>
          </View>

          <View style={styles.card}>
            <Animated.View
              onLayout={registerFieldOffset('photo')}
              style={[
                styles.inputContainer,
                highlightedField === 'photo' && styles.inputContainerFocus,
                highlightedField === 'photo' && { transform: [{ scale: pulseScale }] },
              ]}
            >
              <Text style={styles.label}>Profile photo (required)</Text>
              <TouchableOpacity
                style={styles.avatarPick}
                onPress={openPhotoPicker}
                accessibilityRole="button"
                accessibilityLabel="Choose profile photo"
              >
                {photoUri ? (
                  <Image source={{ uri: photoUri }} style={styles.avatarPreview} />
                ) : (
                  <View style={styles.avatarEmpty}>
                    <Icon name="add-a-photo" size={36} color={colors.textSecondary} />
                    <Text style={styles.avatarHint}>Tap to add and crop</Text>
                  </View>
                )}
              </TouchableOpacity>
              {fieldErrors.photo ? <Text style={styles.fieldError}>{fieldErrors.photo}</Text> : null}
            </Animated.View>

            <Animated.View
              onLayout={registerFieldOffset('name')}
              style={[
                styles.inputContainer,
                highlightedField === 'name' && styles.inputContainerFocus,
                highlightedField === 'name' && { transform: [{ scale: pulseScale }] },
              ]}
            >
              <Text style={styles.label}>Full name</Text>
              <TextInput
                placeholderTextColor={colors.placeholder}
                style={[styles.input, fieldErrors.name && styles.inputError]}
                placeholder="Your name"
                value={name}
                onChangeText={(text) => {
                  setName(text);
                  setFieldErrors((prev) => ({ ...prev, name: '' }));
                }}
                autoCapitalize="words"
              />
              {fieldErrors.name ? <Text style={styles.fieldError}>{fieldErrors.name}</Text> : null}
            </Animated.View>

            <Animated.View
              onLayout={registerFieldOffset('mobile')}
              style={[
                styles.inputContainer,
                highlightedField === 'mobile' && styles.inputContainerFocus,
                highlightedField === 'mobile' && { transform: [{ scale: pulseScale }] },
              ]}
            >
              <Text style={styles.label}>Mobile number</Text>
              <MobileBoxInput
                value={mobileNumber}
                onChange={(value) => {
                  setMobileNumber(value);
                  setFieldErrors((prev) => ({ ...prev, mobile: '' }));
                }}
                colors={colors}
                isDark={isDark}
              />
              {fieldErrors.mobile ? <Text style={styles.fieldError}>{fieldErrors.mobile}</Text> : null}
            </Animated.View>

            <Animated.View
              onLayout={registerFieldOffset('email')}
              style={[
                styles.inputContainer,
                highlightedField === 'email' && styles.inputContainerFocus,
                highlightedField === 'email' && { transform: [{ scale: pulseScale }] },
              ]}
            >
              <View style={styles.labelRow}>
                <Text style={styles.label}>Email</Text>
                {emailVerified ? (
                  <View style={styles.verifiedChip}>
                    <Icon name="verified" size={14} color="#fff" />
                    <Text style={styles.verifiedChipText}>Verified</Text>
                  </View>
                ) : null}
              </View>
              <View style={[styles.inputShell, emailVerified && styles.inputVerified, fieldErrors.email && styles.inputError]}>
                <TextInput
                  placeholderTextColor={colors.placeholder}
                  style={styles.inputInner}
                  placeholder="your.email@gmail.com"
                  value={email}
                  onChangeText={onEmailChange}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  editable={!emailVerified}
                />
                {emailVerified ? <Icon name="check-circle" size={20} color={isDark ? '#86efac' : '#15803d'} /> : null}
              </View>
              <Text style={styles.emailHint}>
                Used for login recovery — we will send a code to verify it is correct.
              </Text>
              {fieldErrors.email ? <Text style={styles.fieldError}>{fieldErrors.email}</Text> : null}
              {!emailVerified && (
                <TouchableOpacity
                  style={[styles.otpButton, otpSending && styles.otpButtonDisabled]}
                  onPress={handleSendSignupOtp}
                  disabled={otpSending}
                  accessibilityRole="button"
                  accessibilityLabel="Send email verification code"
                >
                  {otpSending ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Text style={[styles.otpButtonText, { color: colors.primary }]}>
                      {otpSent ? 'Resend verification code' : 'Send verification code'}
                    </Text>
                  )}
                </TouchableOpacity>
              )}
            </Animated.View>

            {!emailVerified && (
              <Animated.View
                onLayout={registerFieldOffset('emailOtp')}
                style={[
                  styles.inputContainer,
                  highlightedField === 'emailOtp' && styles.inputContainerFocus,
                  highlightedField === 'emailOtp' && { transform: [{ scale: pulseScale }] },
                ]}
              >
                <Text style={styles.label}>Email verification code</Text>
                <TextInput
                  placeholderTextColor={colors.placeholder}
                  style={[styles.input, styles.otpInput, fieldErrors.emailOtp && styles.inputError]}
                  placeholder="Enter 6-digit code"
                  value={emailOtp}
                  onChangeText={(t) => {
                    setEmailOtp(t.replace(/\D/g, '').slice(0, 6));
                    setFieldErrors((prev) => ({ ...prev, emailOtp: '' }));
                  }}
                  keyboardType="number-pad"
                  maxLength={6}
                />
                <TouchableOpacity
                  style={[styles.otpButton, otpVerifying && styles.otpButtonDisabled]}
                  onPress={handleVerifySignupOtp}
                  disabled={otpVerifying}
                  accessibilityRole="button"
                  accessibilityLabel="Verify email code"
                >
                  {otpVerifying ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Text style={[styles.otpButtonText, { color: colors.primary }]}>Verify email</Text>
                  )}
                </TouchableOpacity>
                {fieldErrors.emailOtp ? <Text style={styles.fieldError}>{fieldErrors.emailOtp}</Text> : null}
                {otpHint ? <Text style={otpHintTone === 'error' ? styles.otpHintError : styles.otpHintOk}>{otpHint}</Text> : null}
              </Animated.View>
            )}

            <Animated.View
              onLayout={registerFieldOffset('password')}
              style={[
                styles.inputContainer,
                highlightedField === 'password' && styles.inputContainerFocus,
                highlightedField === 'password' && { transform: [{ scale: pulseScale }] },
              ]}
            >
              <Text style={styles.label}>Password</Text>
              <View style={[styles.passwordRow, fieldErrors.password && styles.inputError]}>
                <TextInput
                  placeholderTextColor={colors.placeholder}
                  style={styles.passwordInput}
                  placeholder="At least 6 characters"
                  value={password}
                  onChangeText={(text) => {
                    setPassword(text);
                    setFieldErrors((prev) => ({ ...prev, password: '' }));
                  }}
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
              {fieldErrors.password ? <Text style={styles.fieldError}>{fieldErrors.password}</Text> : null}
            </Animated.View>

            <Animated.View
              onLayout={registerFieldOffset('confirmPassword')}
              style={[
                styles.inputContainer,
                highlightedField === 'confirmPassword' && styles.inputContainerFocus,
                highlightedField === 'confirmPassword' && { transform: [{ scale: pulseScale }] },
              ]}
            >
              <Text style={styles.label}>Confirm password</Text>
              <View style={[styles.passwordRow, fieldErrors.confirmPassword && styles.inputError]}>
                <TextInput
                  placeholderTextColor={colors.placeholder}
                  style={styles.passwordInput}
                  placeholder="Re-enter password"
                  value={confirmPassword}
                  onChangeText={(text) => {
                    setConfirmPassword(text);
                    setFieldErrors((prev) => ({ ...prev, confirmPassword: '' }));
                  }}
                  secureTextEntry={!showConfirmPassword}
                />
                <TouchableOpacity
                  style={styles.eyeButton}
                  onPress={() => setShowConfirmPassword((v) => !v)}
                  accessibilityRole="button"
                  accessibilityLabel={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                >
                  <Icon
                    name={showConfirmPassword ? 'visibility-off' : 'visibility'}
                    size={22}
                    color={colors.textSecondary}
                  />
                </TouchableOpacity>
              </View>
              {fieldErrors.confirmPassword ? <Text style={styles.fieldError}>{fieldErrors.confirmPassword}</Text> : null}
            </Animated.View>

            {isLoading ? (
              <ActivityIndicator
                size="large"
                color={colors.primary}
                style={styles.spinner}
              />
            ) : (
              <TouchableOpacity
                style={styles.button}
                onPress={handleSignup}
                disabled={isLoading}
              >
                <Text style={styles.buttonText}>Register</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Already registered? </Text>
            <TouchableOpacity onPress={() => navigation.navigate('Login')}>
              <Text style={styles.linkText}>Sign in</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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
    inputContainerFocus: {
      borderRadius: 12,
      marginHorizontal: -8,
      paddingHorizontal: 8,
      backgroundColor: isDark ? 'rgba(59,130,246,0.14)' : 'rgba(59,130,246,0.10)',
    },
    label: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textSecondary,
      marginBottom: 8,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    labelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    verifiedChip: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: isDark ? '#166534' : '#16a34a',
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 4,
      gap: 4,
    },
    verifiedChipText: {
      color: '#fff',
      fontSize: 11,
      fontWeight: '800',
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
    inputShell: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: isDark ? colors.inputBackground : '#f8fafc',
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 14,
      minHeight: 52,
      borderRadius: 12,
    },
    inputInner: {
      flex: 1,
      fontSize: 16,
      color: colors.text,
    },
    inputVerified: {
      borderColor: isDark ? '#86efac' : '#22c55e',
    },
    inputError: {
      borderColor: isDark ? '#fca5a5' : '#dc2626',
    },
    fieldError: {
      marginTop: 6,
      fontSize: 12,
      fontWeight: '600',
      color: isDark ? '#fca5a5' : '#b91c1c',
    },
    emailHint: {
      marginTop: 6,
      fontSize: 12,
      color: colors.textSecondary,
      fontWeight: '500',
    },
    otpButton: {
      marginTop: 12,
      paddingVertical: 12,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 46,
    },
    otpButtonDisabled: {
      opacity: 0.55,
    },
    otpButtonText: {
      fontSize: 15,
      fontWeight: '800',
    },
    otpHintOk: {
      marginTop: 8,
      fontSize: 12,
      fontWeight: '600',
      color: isDark ? '#86efac' : '#15803d',
    },
    otpHintError: {
      marginTop: 8,
      fontSize: 12,
      fontWeight: '600',
      color: isDark ? '#fca5a5' : '#b91c1c',
    },
    otpInput: {
      letterSpacing: 2,
      fontWeight: '700',
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
    spinner: {
      marginTop: 12,
    },
    avatarPick: {
      alignSelf: 'center',
      marginBottom: 4,
    },
    avatarPreview: {
      width: 112,
      height: 112,
      borderRadius: 56,
      borderWidth: 2,
      borderColor: isDark ? '#475569' : colors.border,
    },
    avatarEmpty: {
      width: 112,
      height: 112,
      borderRadius: 56,
      borderWidth: 2,
      borderStyle: 'dashed',
      borderColor: isDark ? '#475569' : '#cbd5e1',
      backgroundColor: isDark ? colors.inputBackground : '#f1f5f9',
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 12,
    },
    avatarHint: {
      marginTop: 6,
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSecondary,
      textAlign: 'center',
    },
    button: {
      backgroundColor: colors.primary,
      paddingVertical: 16,
      borderRadius: 12,
      alignItems: 'center',
      marginTop: 8,
    },
    buttonText: {
      color: '#fff',
      fontSize: 17,
      fontWeight: '800',
      letterSpacing: 0.3,
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

export default SignupScreen;
