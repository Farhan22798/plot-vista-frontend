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
  const { login, isLoading } = useContext(AuthContext);
  const { showAlert } = useAlert();

  const [biometricReady, setBiometricReady] = useState(false);
  const [biometryType, setBiometryType] = useState(null);

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

  const handleBiometricLogin = useCallback(async () => {
    try {
      const creds = await getBiometricCredentials();
      if (!creds) {
        showAlert('Biometric Login', 'No saved credentials. Please log in with your password first.');
        return;
      }
      const ok = await promptBiometric('Log in to Plot Vista');
      if (!ok) return;
      await login(creds.mobile, creds.password);
    } catch (e) {
      showAlert('Login failed', e.response?.data?.message || 'Biometric login failed. Try password.');
    }
  }, [login, showAlert]);

  const handleLogin = async () => {
    if (!mobileNumber || !password) {
      showAlert('Error', 'Please fill in all fields');
      return;
    }
    if (mobileNumber.length !== 10) {
      showAlert('Error', 'Please enter a valid 10-digit mobile number');
      return;
    }
    try {
      // Check biometric support BEFORE login — login() sets the token which
      // unmounts this screen, so any code after it won't run.
      const { available: bioAvail } = await isBiometricAvailable();

      await login(mobileNumber.trim(), password);

      // login() succeeded — if biometrics are available, silently save
      // credentials so the fingerprint button appears next time.
      // This runs in a microtask; even if the component unmounts, the
      // AsyncStorage write still completes.
      if (bioAvail) {
        saveBiometricCredentials(mobileNumber.trim(), password).catch(() => {});
      }
    } catch (e) {
      showAlert('Login failed', e.response?.data?.message || 'Something went wrong');
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
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hero}>
            <Text style={styles.tagline}>{SITE_TAGLINE}</Text>
            <Text style={styles.brand}>{SITE_NAME}</Text>
            <View style={styles.rule} />
            <Text style={styles.screenTitle}>Sign in</Text>
            <Text style={styles.subtitle}>
              Use your registered mobile number and password.
            </Text>
          </View>

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

            {isLoading ? (
              <ActivityIndicator
                size="large"
                color={colors.primary}
                style={styles.spinner}
              />
            ) : (
              <>
                <TouchableOpacity style={styles.button} onPress={handleLogin}>
                  <Text style={styles.buttonText}>Log in</Text>
                </TouchableOpacity>

                {biometricReady && (
                  <TouchableOpacity
                    style={styles.biometricBtn}
                    onPress={handleBiometricLogin}
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
              </>
            )}
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>No account yet? </Text>
            <TouchableOpacity onPress={() => navigation.navigate('Signup')}>
              <Text style={styles.linkText}>Create one</Text>
            </TouchableOpacity>
          </View>
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
    buttonText: {
      color: '#fff',
      fontSize: 17,
      fontWeight: '800',
      letterSpacing: 0.3,
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
