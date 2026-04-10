import React, { useContext, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Linking,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import Icon from 'react-native-vector-icons/MaterialIcons';
import Share from 'react-native-share';
import { pickProfilePhotoCamera, pickProfilePhotoLibrary } from '../utils/profileImagePicker';
import { AuthContext } from '../context/AuthContext';
import { UserAvatarContext } from '../context/UserAvatarContext';
import { useTheme } from '../context/ThemeContext';
import { usePermissions } from '../hooks/usePermissions';
import { backupApi, authApi } from '../services/api';
import UserAvatar from '../components/UserAvatar';
import ForgotPasswordModal from '../components/ForgotPasswordModal';
import EmailEditModal from '../components/EmailEditModal';
import { mapCaptureRegistry } from '../utils/mapCaptureRef';
import {
  isBiometricAvailable,
  isBiometricEnabled,
  clearBiometricCredentials,
} from '../utils/biometricAuth';

const ROLE_LABELS = {
  super_admin: 'Super Admin',
  owner: 'Owner',
  guest: 'Guest',
};

const SCROLL_BOTTOM_GAP = 12;

const ProfileScreen = () => {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { colors, isDark, themeMode, setThemeMode } = useTheme();
  const styles = React.useMemo(() => getStyles(colors, isDark), [colors, isDark]);
  const scrollBottomPad = Math.max(insets.bottom, 8) + tabBarHeight + SCROLL_BOTTOM_GAP;
  const { userInfo, logout, refreshUserData, updatePassword } = useContext(AuthContext);
  const { refreshAvatars } = useContext(UserAvatarContext);
  const { canEdit } = usePermissions();

  const [exporting, setExporting]       = useState(false);
  const [picBusy, setPicBusy]           = useState(false);
  const [lastBackup, setLastBackup]     = useState(null);
  const [backupError, setBackupError]   = useState('');
  const [biometricAvail, setBiometricAvail] = useState(false);
  const [biometricOn, setBiometricOn]       = useState(false);
  const [forgotPwdOpen, setForgotPwdOpen]   = useState(false);
  const [emailEditOpen, setEmailEditOpen]   = useState(false);
  const [pwdExpanded, setPwdExpanded]       = useState(false);
  const [curPwd, setCurPwd]                 = useState('');
  const [newPwd, setNewPwd]                 = useState('');
  const [confirmPwd, setConfirmPwd]         = useState('');
  const [pwdBusy, setPwdBusy]               = useState(false);

  const user = userInfo || { name: 'Loading...', mobileNumber: '', role: '' };

  const uploadProfilePic = async (base64) => {
    setPicBusy(true);
    try {
      await authApi.put('/profile-pic', { profilePicBase64: base64 });
      await refreshUserData();
      await refreshAvatars();
    } catch (err) {
      throw err;
    } finally {
      setPicBusy(false);
    }
  };

  const pickAndUpload = () => {
    Alert.alert(
      'Profile photo',
      'After you choose a photo, adjust the crop (circle guide) and confirm.',
      [
        {
          text: 'Camera',
          onPress: async () => {
            try {
              const result = await pickProfilePhotoCamera();
              if (!result?.base64) return;
              await uploadProfilePic(result.base64);
            } catch (e) {
              Alert.alert('Error', e.response?.data?.message || e.message || 'Upload failed');
            }
          },
        },
        {
          text: 'Gallery',
          onPress: async () => {
            try {
              const result = await pickProfilePhotoLibrary();
              if (!result?.base64) return;
              await uploadProfilePic(result.base64);
            } catch (e) {
              Alert.alert('Error', e.response?.data?.message || e.message || 'Upload failed');
            }
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };

  const removeProfilePic = () => {
    Alert.alert('Remove photo', 'Clear your profile picture?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            setPicBusy(true);
            await authApi.put('/profile-pic', {});
            await refreshUserData();
            await refreshAvatars();
          } catch (e) {
            Alert.alert('Error', e.response?.data?.message || e.message || 'Could not remove photo');
          } finally {
            setPicBusy(false);
          }
        },
      },
    ]);
  };

  const fetchLastBackup = useCallback(async () => {
    try {
      const res = await backupApi.get('/history');
      if (res.data && res.data.length > 0) setLastBackup(res.data[0]);
    } catch (_) {
      // silently ignore — not critical
    }
  }, []);

  useEffect(() => {
    if (canEdit) fetchLastBackup();
  }, [canEdit, fetchLastBackup]);

  useEffect(() => {
    (async () => {
      const { available } = await isBiometricAvailable();
      setBiometricAvail(available);
      if (available) {
        const on = await isBiometricEnabled();
        setBiometricOn(on);
      }
    })();
  }, []);

  const handleDisableBiometric = async () => {
    await clearBiometricCredentials();
    setBiometricOn(false);
  };

  const togglePasswordSection = () => {
    setPwdExpanded((prev) => {
      if (prev) {
        setCurPwd('');
        setNewPwd('');
        setConfirmPwd('');
      }
      return !prev;
    });
  };

  const handleUpdatePassword = async () => {
    if (!curPwd || !newPwd || !confirmPwd) {
      Alert.alert('Error', 'Please fill in all password fields.');
      return;
    }
    if (newPwd.length < 6) {
      Alert.alert('Error', 'New password must be at least 6 characters.');
      return;
    }
    if (newPwd !== confirmPwd) {
      Alert.alert('Error', 'New password and confirmation do not match.');
      return;
    }
    setPwdBusy(true);
    try {
      await updatePassword(curPwd, newPwd);
      await clearBiometricCredentials();
      setBiometricOn(false);
      setCurPwd('');
      setNewPwd('');
      setConfirmPwd('');
      setPwdExpanded(false);
      Alert.alert(
        'Password updated',
        'Your password was changed. If you used biometric login, sign in with your new password once to enable it again.',
      );
    } catch (e) {
      Alert.alert('Error', e.response?.data?.message || 'Could not update password.');
    } finally {
      setPwdBusy(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    setBackupError('');
    try {
      // Silently capture the map layout image from LayoutScreen (always mounted as a tab).
      let mapImageBase64 = null;
      try {
        mapImageBase64 = await mapCaptureRegistry.capture?.();
      } catch (_) {
        // Map capture failure must never block the Excel/JSON backup.
      }

      const res = await backupApi.post('/trigger', mapImageBase64 ? { mapImageBase64 } : {});
      setLastBackup({ xlsxUrl: res.data.xlsxUrl, jsonUrl: res.data.jsonUrl, createdAt: new Date().toISOString() });
    } catch (err) {
      setBackupError(err.response?.data?.message ?? 'Backup failed. Check Drive setup.');
    } finally {
      setExporting(false);
    }
  };

  const handleOpenBackup = () => {
    if (lastBackup?.xlsxUrl) Linking.openURL(lastBackup.xlsxUrl);
  };

  const handleShare = async () => {
    if (!lastBackup?.xlsxUrl) return;
    try {
      await Share.open({
        title:   'Golden City Excel Backup',
        message: `Golden City plot data export — open in Google Sheets or Excel:\n${lastBackup.xlsxUrl}`,
        url:     lastBackup.xlsxUrl,
      });
    } catch (err) {
      if (err?.message !== 'User did not share') {
        setBackupError('Could not open share sheet.');
      }
    }
  };

  const formatBackupTime = (iso) => {
    if (!iso) return '';
    const diff = Math.floor((Date.now() - new Date(iso)) / 60000);
    if (diff < 1)   return 'Just Now';
    if (diff < 60)  return `${diff} Min Ago`;
    const hrs = Math.floor(diff / 60);
    if (hrs < 24)   return hrs === 1 ? '1 Hour Ago' : `${hrs} Hours Ago`;
    const days = Math.floor(hrs / 24);
    return days === 1 ? '1 Day Ago' : `${days} Days Ago`;
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: scrollBottomPad }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              {picBusy ? (
                <ActivityIndicator size="small" color={colors.primary} style={styles.avatarSpinner} />
              ) : (
                <UserAvatar name={user.name} imageUrl={user.profilePicUrl} size={64} style={styles.avatarRing} />
              )}
            </View>
            <View style={styles.headerRight}>
              <Text style={styles.name} numberOfLines={2}>
                {user.name}
              </Text>
              <Text style={styles.role}>{ROLE_LABELS[user.role] ?? user.role}</Text>
              <View style={styles.picActions}>
                <TouchableOpacity style={styles.picBtn} onPress={pickAndUpload} disabled={picBusy}>
                  <Icon name="photo-camera" size={16} color={colors.primary} />
                  <Text style={[styles.picBtnText, { color: colors.primary }]}>Change</Text>
                </TouchableOpacity>
                {user.profilePicUrl ? (
                  <TouchableOpacity style={styles.picBtn} onPress={removeProfilePic} disabled={picBusy}>
                    <Icon name="delete-outline" size={16} color="#dc2626" />
                    <Text style={styles.picBtnTextDanger}>Remove</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          </View>
        </View>

        <View style={styles.detailsContainer}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Mobile</Text>
            <Text style={styles.detailValue} numberOfLines={1}>
              {user.mobileNumber}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Email</Text>
            <View style={styles.detailEmailRight}>
              <Text style={styles.detailValue} numberOfLines={1}>
                {user.email || '—'}
              </Text>
              <TouchableOpacity
                onPress={() => setEmailEditOpen(true)}
                style={styles.detailIconBtn}
                accessibilityRole="button"
                accessibilityLabel={user.email ? 'Edit email' : 'Add email'}
              >
                <Icon name={user.email ? 'edit' : 'add'} size={20} color={colors.primary} />
              </TouchableOpacity>
            </View>
          </View>
          <View style={[styles.detailRow, styles.detailRowLast]}>
            <Text style={styles.detailLabel}>Status</Text>
            <Text style={styles.detailValue}>{user.isApproved ? 'Approved' : 'Pending'}</Text>
          </View>
        </View>

        <View style={styles.passwordSection}>
          <TouchableOpacity
            style={[styles.passwordSectionHeader, pwdExpanded && styles.passwordSectionHeaderOpen]}
            onPress={togglePasswordSection}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={pwdExpanded ? 'Hide change password' : 'Show change password'}
          >
            <Text style={styles.passwordTitle}>Change password</Text>
            <Icon
              name={pwdExpanded ? 'expand-less' : 'expand-more'}
              size={26}
              color={colors.textSecondary}
            />
          </TouchableOpacity>
          {pwdExpanded ? (
            <>
              <Text style={styles.pwdFieldLabel}>Current password</Text>
              <TextInput
                placeholderTextColor={colors.placeholder}
                style={styles.pwdInput}
                placeholder="Current password"
                value={curPwd}
                onChangeText={setCurPwd}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={styles.pwdFieldLabel}>New password</Text>
              <TextInput
                placeholderTextColor={colors.placeholder}
                style={styles.pwdInput}
                placeholder="At least 6 characters"
                value={newPwd}
                onChangeText={setNewPwd}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={styles.pwdFieldLabel}>Confirm new password</Text>
              <TextInput
                placeholderTextColor={colors.placeholder}
                style={styles.pwdInput}
                placeholder="Re-enter new password"
                value={confirmPwd}
                onChangeText={setConfirmPwd}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                onPress={() => setForgotPwdOpen(true)}
                style={styles.pwdForgotWrap}
                accessibilityRole="button"
                accessibilityLabel="Forgot password"
              >
                <Text style={styles.pwdForgotText}>Forgot password?</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.pwdSaveBtn, pwdBusy && styles.pwdSaveBtnDisabled]}
                onPress={handleUpdatePassword}
                disabled={pwdBusy}
                accessibilityRole="button"
              >
                {pwdBusy ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.pwdSaveBtnText}>Update password</Text>
                )}
              </TouchableOpacity>
            </>
          ) : null}
        </View>

        {biometricAvail && (
          <View style={styles.biometricRow}>
            <View style={styles.biometricInfo}>
              <Icon name="fingerprint" size={20} color={colors.primary} />
              <View style={styles.biometricTextBlock}>
                <Text style={styles.biometricTitle}>Biometric login</Text>
                <Text style={styles.biometricDesc} numberOfLines={2}>
                  {biometricOn ? 'Enabled — tap Disable' : 'Use password login once to enable'}
                </Text>
              </View>
            </View>
            {biometricOn && (
              <TouchableOpacity style={styles.biometricDisableBtn} onPress={handleDisableBiometric}>
                <Text style={styles.biometricDisableText}>Disable</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        <View style={styles.themeRow}>
          <View style={styles.biometricInfo}>
            <Icon name="palette" size={20} color={colors.primary} />
            <View style={styles.biometricTextBlock}>
              <Text style={styles.biometricTitle}>App Theme</Text>
              <Text style={styles.biometricDesc} numberOfLines={2}>
                Choose System, Light, or Dark mode manually.
              </Text>
            </View>
          </View>
          <View style={styles.themeModeButtons}>
            {[
              { id: 'system', label: 'System' },
              { id: 'light', label: 'Light' },
              { id: 'dark', label: 'Dark' },
            ].map((mode) => {
              const active = themeMode === mode.id;
              return (
                <TouchableOpacity
                  key={mode.id}
                  style={[
                    styles.themeModeBtn,
                    active && { backgroundColor: colors.primary, borderColor: colors.primary },
                  ]}
                  onPress={() => setThemeMode(mode.id)}
                >
                  <Text
                    style={[
                      styles.themeModeBtnText,
                      active && { color: '#fff' },
                    ]}
                  >
                    {mode.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {canEdit && (
          <View style={styles.exportSection}>
            <TouchableOpacity
              style={[styles.exportButton, exporting && styles.exportButtonDisabled]}
              onPress={handleExport}
              disabled={exporting}
              accessibilityRole="button"
              accessibilityLabel="Backup all plot data to Google Drive now"
            >
              {exporting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Icon name="cloud-upload" size={18} color="#fff" />
              )}
              <Text style={styles.exportButtonText}>{exporting ? 'Backing up…' : 'Backup Now'}</Text>
            </TouchableOpacity>

            {lastBackup?.xlsxUrl ? (
              <View style={styles.backupActions}>
                <TouchableOpacity
                  style={[styles.backupActionBtn, { borderColor: colors.primary }]}
                  onPress={handleShare}
                  accessibilityRole="button"
                  accessibilityLabel="Share the Excel backup link"
                >
                  <Icon name="share" size={15} color={colors.primary} />
                  <Text style={[styles.backupActionText, { color: colors.primary }]}>Share</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.backupActionBtn, { borderColor: colors.primary }]}
                  onPress={handleOpenBackup}
                  accessibilityRole="button"
                  accessibilityLabel="Open backup file in Google Drive"
                >
                  <Icon name="open-in-new" size={15} color={colors.primary} />
                  <Text style={[styles.backupActionText, { color: colors.primary }]}>Open</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {lastBackup ? (
              <Text style={[styles.lastBackupText, { color: colors.textSecondary }]}>
                Last backup: {formatBackupTime(lastBackup.createdAt)}
              </Text>
            ) : null}

            {backupError ? <Text style={styles.backupErrorText}>{backupError}</Text> : null}
          </View>
        )}

        <TouchableOpacity style={styles.logoutButton} onPress={logout} accessibilityRole="button">
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>
      </ScrollView>
      <ForgotPasswordModal
        visible={forgotPwdOpen}
        onClose={() => setForgotPwdOpen(false)}
        initialEmail={user.email || ''}
      />
      <EmailEditModal
        visible={emailEditOpen}
        onClose={() => setEmailEditOpen(false)}
        initialEmail={user.email || ''}
      />
    </SafeAreaView>
  );
};

const getStyles = (colors, isDark) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  header: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerLeft: {
    marginRight: 14,
  },
  headerRight: {
    flex: 1,
    minWidth: 0,
  },
  avatarRing: {
    borderWidth: 2,
    borderColor: colors.border,
  },
  avatarSpinner: {
    width: 64,
    height: 64,
    justifyContent: 'center',
    alignItems: 'center',
  },
  picActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginTop: 8,
  },
  picBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingRight: 14,
    marginRight: 4,
  },
  picBtnText: {
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 4,
  },
  picBtnTextDanger: {
    fontSize: 13,
    fontWeight: '700',
    color: '#dc2626',
    marginLeft: 4,
  },
  name: {
    fontSize: 19,
    fontWeight: '800',
    color: colors.text,
    lineHeight: 24,
  },
  role: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 2,
    fontWeight: '600',
  },
  detailsContainer: {
    marginHorizontal: 12,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 4,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 12,
  },
  detailRowLast: {
    borderBottomWidth: 0,
  },
  detailLabel: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '600',
    flexShrink: 0,
  },
  detailValue: {
    fontSize: 14,
    color: colors.text,
    fontWeight: '600',
    flex: 1,
    textAlign: 'right',
  },
  detailEmailRight: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    minWidth: 0,
    gap: 6,
  },
  detailIconBtn: {
    padding: 6,
    marginRight: -4,
  },
  passwordSection: {
    marginHorizontal: 12,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  passwordSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  passwordSectionHeaderOpen: {
    marginBottom: 12,
  },
  passwordTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
    flex: 1,
  },
  pwdFieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  pwdInput: {
    backgroundColor: isDark ? colors.inputBackground : '#f8fafc',
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    borderRadius: 10,
    fontSize: 15,
    color: colors.text,
    marginBottom: 12,
  },
  pwdForgotWrap: {
    alignSelf: 'flex-end',
    marginBottom: 12,
    paddingVertical: 4,
  },
  pwdForgotText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
  },
  pwdSaveBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  pwdSaveBtnDisabled: {
    opacity: 0.65,
  },
  pwdSaveBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
  biometricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 12,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  biometricInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
    marginRight: 8,
  },
  biometricTextBlock: {
    flex: 1,
    marginLeft: 10,
  },
  biometricTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  biometricDesc: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
    lineHeight: 15,
  },
  biometricDisableBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    flexShrink: 0,
  },
  biometricDisableText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#dc2626',
  },
  themeRow: {
    marginHorizontal: 12,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  themeModeButtons: {
    flexDirection: 'row',
    marginTop: 10,
    gap: 8,
  },
  themeModeBtn: {
    flex: 1,
    minHeight: 34,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: isDark ? '#0f172a' : '#f8fafc',
  },
  themeModeBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.text,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  exportSection: {
    marginHorizontal: 12,
    marginTop: 10,
  },
  exportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  exportButtonDisabled: {
    opacity: 0.6,
  },
  backupActions: {
    flexDirection: 'row',
    marginTop: 8,
  },
  backupActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1.5,
    marginHorizontal: 4,
  },
  backupActionText: {
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  exportButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    marginLeft: 8,
  },
  lastBackupText: {
    textAlign: 'center',
    fontSize: 11,
    marginTop: 6,
  },
  backupErrorText: {
    textAlign: 'center',
    fontSize: 11,
    marginTop: 4,
    color: colors.danger,
  },
  logoutButton: {
    marginHorizontal: 12,
    marginTop: 14,
    backgroundColor: colors.danger,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  logoutText: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: '800',
  },
});

export default ProfileScreen;
