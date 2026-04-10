import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { authApi } from '../services/api';
import { keyboardAvoidingBehavior } from '../utils/keyboardAvoiding';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ForgotPasswordModal = ({ visible, onClose, initialEmail = '' }) => {
  const { colors, isDark } = useTheme();
  const styles = React.useMemo(() => getStyles(colors, isDark), [colors, isDark]);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    if (visible) {
      setEmail((initialEmail || '').trim());
      setFeedback('');
    }
  }, [visible, initialEmail]);

  const submit = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !EMAIL_RE.test(trimmed)) {
      setFeedback('Enter a valid email address.');
      return;
    }
    setBusy(true);
    setFeedback('');
    try {
      const { data } = await authApi.post('/forgot-password', { email: trimmed });
      setFeedback(data?.message || 'Check your inbox.');
    } catch (e) {
      setFeedback(e.response?.data?.message || 'Could not send. Try again later.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={keyboardAvoidingBehavior()}
        style={styles.overlay}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 40 : 0}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View style={styles.backdrop}>
            <TouchableWithoutFeedback>
              <View style={styles.card}>
                <Text style={styles.title}>Forgot password</Text>
                <Text style={styles.hint}>
                  Enter the email on your account. You will receive a message with your registered mobile number
                  and a 5-digit code — sign in with that mobile number and use the code as your password.
                </Text>
                <Text style={styles.label}>Email</Text>
                <TextInput
                  placeholderTextColor={colors.placeholder}
                  style={styles.input}
                  placeholder="you@example.com"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                />
                {feedback ? (
                  <Text style={[styles.feedback, feedback.toLowerCase().includes('inbox') && styles.feedbackOk]}>
                    {feedback}
                  </Text>
                ) : null}
                {busy ? (
                  <ActivityIndicator size="small" color={colors.primary} style={styles.spinner} />
                ) : (
                  <TouchableOpacity style={styles.primaryBtn} onPress={submit} accessibilityRole="button">
                    <Text style={styles.primaryBtnText}>Email sign-in code</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.secondaryBtn} onPress={onClose} accessibilityRole="button">
                  <Text style={styles.secondaryBtnText}>Close</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const getStyles = (colors, isDark) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
    },
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      paddingHorizontal: 24,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 20,
      borderWidth: 1,
      borderColor: colors.border,
    },
    title: {
      fontSize: 18,
      fontWeight: '800',
      color: colors.text,
      marginBottom: 8,
    },
    hint: {
      fontSize: 13,
      lineHeight: 19,
      color: colors.textSecondary,
      marginBottom: 16,
    },
    label: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textSecondary,
      marginBottom: 6,
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
    feedback: {
      marginTop: 10,
      fontSize: 13,
      color: colors.danger,
      lineHeight: 18,
    },
    feedbackOk: {
      color: colors.textSecondary,
    },
    spinner: {
      marginTop: 16,
    },
    primaryBtn: {
      backgroundColor: colors.primary,
      paddingVertical: 14,
      borderRadius: 12,
      alignItems: 'center',
      marginTop: 16,
    },
    primaryBtnText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '800',
    },
    secondaryBtn: {
      marginTop: 12,
      paddingVertical: 10,
      alignItems: 'center',
    },
    secondaryBtnText: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.primary,
    },
  });

export default ForgotPasswordModal;
