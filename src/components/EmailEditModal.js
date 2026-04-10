import React, { useState, useEffect, useContext } from 'react';
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
  Alert,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { AuthContext } from '../context/AuthContext';
import { keyboardAvoidingBehavior } from '../utils/keyboardAvoiding';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const EmailEditModal = ({ visible, onClose, initialEmail = '' }) => {
  const { colors, isDark } = useTheme();
  const { updateEmail } = useContext(AuthContext);
  const styles = React.useMemo(() => getStyles(colors, isDark), [colors, isDark]);
  const [emailDraft, setEmailDraft] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');

  const hadEmail = !!(initialEmail && String(initialEmail).trim());

  useEffect(() => {
    if (visible) {
      setEmailDraft((initialEmail || '').trim());
      setCurrentPassword('');
      setFeedback('');
    }
  }, [visible, initialEmail]);

  const handleSave = async () => {
    const trimmed = emailDraft.trim().toLowerCase();
    if (!trimmed) {
      setFeedback('Enter an email address, or use Remove email if you want to clear it.');
      return;
    }
    if (!EMAIL_RE.test(trimmed)) {
      setFeedback('Enter a valid email address.');
      return;
    }
    if (!currentPassword) {
      setFeedback('Enter your current password.');
      return;
    }
    setBusy(true);
    setFeedback('');
    try {
      await updateEmail(trimmed, currentPassword);
      onClose();
    } catch (e) {
      setFeedback(e.response?.data?.message || 'Could not update email.');
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = () => {
    if (!hadEmail) return;
    Alert.alert(
      'Remove email',
      'You will not be able to use forgot-password by email until you add one again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            if (!currentPassword) {
              setFeedback('Enter your current password to remove email.');
              return;
            }
            setBusy(true);
            setFeedback('');
            try {
              await updateEmail('', currentPassword);
              onClose();
            } catch (e) {
              setFeedback(e.response?.data?.message || 'Could not remove email.');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
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
                <Text style={styles.title}>{hadEmail ? 'Update email' : 'Add email'}</Text>
                <Text style={styles.hint}>
                  For security, enter your current password. This email is used for password recovery.
                </Text>
                <Text style={styles.label}>Email</Text>
                <TextInput
                  placeholderTextColor={colors.placeholder}
                  style={styles.input}
                  placeholder="you@example.com"
                  value={emailDraft}
                  onChangeText={setEmailDraft}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                />
                <Text style={styles.label}>Current password</Text>
                <TextInput
                  placeholderTextColor={colors.placeholder}
                  style={styles.input}
                  placeholder="Your password"
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {feedback ? <Text style={styles.feedback}>{feedback}</Text> : null}
                {busy ? (
                  <ActivityIndicator size="small" color={colors.primary} style={styles.spinner} />
                ) : (
                  <>
                    <TouchableOpacity style={styles.primaryBtn} onPress={handleSave} accessibilityRole="button">
                      <Text style={styles.primaryBtnText}>Save email</Text>
                    </TouchableOpacity>
                    {hadEmail ? (
                      <TouchableOpacity
                        style={styles.dangerBtn}
                        onPress={handleRemove}
                        accessibilityRole="button"
                      >
                        <Text style={styles.dangerBtnText}>Remove email</Text>
                      </TouchableOpacity>
                    ) : null}
                  </>
                )}
                <TouchableOpacity style={styles.secondaryBtn} onPress={onClose} accessibilityRole="button">
                  <Text style={styles.secondaryBtnText}>Cancel</Text>
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
      marginBottom: 12,
    },
    feedback: {
      marginBottom: 10,
      fontSize: 13,
      color: colors.danger,
      lineHeight: 18,
    },
    spinner: {
      marginTop: 8,
      marginBottom: 8,
    },
    primaryBtn: {
      backgroundColor: colors.primary,
      paddingVertical: 14,
      borderRadius: 12,
      alignItems: 'center',
      marginTop: 4,
    },
    primaryBtnText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '800',
    },
    dangerBtn: {
      marginTop: 10,
      paddingVertical: 12,
      borderRadius: 12,
      alignItems: 'center',
      borderWidth: 1.5,
      borderColor: colors.danger,
    },
    dangerBtnText: {
      color: colors.danger,
      fontSize: 15,
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

export default EmailEditModal;
