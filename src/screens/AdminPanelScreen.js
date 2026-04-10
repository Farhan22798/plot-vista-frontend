import React, { useState, useEffect, useCallback, useContext } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, Platform, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { adminApi } from '../services/api';
import { useAlert } from '../context/AlertContext';
import { useTheme } from '../context/ThemeContext';
import { AuthContext } from '../context/AuthContext';
import UserAvatar from '../components/UserAvatar';

const ROLE_LABELS = { super_admin: 'Super Admin', owner: 'Owner', guest: 'Guest' };
const ROLE_CYCLE = ['guest', 'owner', 'super_admin'];
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
];

const AdminPanelScreen = () => {
  const { colors, isDark } = useTheme();
  const styles = React.useMemo(() => getStyles(colors, isDark), [colors, isDark]);
  const { showAlert } = useAlert();
  const { userInfo } = useContext(AuthContext);

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('all');
  const [busyIds, setBusyIds] = useState({});
  const [rolePickerUser, setRolePickerUser] = useState(null);

  const fetchUsers = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const query = filter === 'all' ? '' : `?status=${filter}`;
      const res = await adminApi.get(`/users${query}`);
      setUsers(res.data);
    } catch (err) {
      showAlert('Error', err.response?.data?.message || 'Could not fetch users.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter, showAlert]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const onRefresh = () => { setRefreshing(true); fetchUsers(true); };

  const markBusy = (id, busy) =>
    setBusyIds((prev) => ({ ...prev, [id]: busy }));

  const handleApprove = async (userId) => {
    markBusy(userId, true);
    try {
      const res = await adminApi.patch(`/users/${userId}/approve`);
      setUsers((prev) => prev.map((u) => (u._id === userId ? { ...u, ...res.data } : u)));
    } catch (err) {
      showAlert('Error', err.response?.data?.message || 'Approve failed.');
    } finally {
      markBusy(userId, false);
    }
  };

  const handleReject = async (userId) => {
    markBusy(userId, true);
    try {
      const res = await adminApi.patch(`/users/${userId}/reject`);
      setUsers((prev) => prev.map((u) => (u._id === userId ? { ...u, ...res.data } : u)));
    } catch (err) {
      showAlert('Error', err.response?.data?.message || 'Reject failed.');
    } finally {
      markBusy(userId, false);
    }
  };

  const openRolePicker = (user) => {
    if (user._id === userInfo?._id) {
      showAlert('Not allowed', 'You cannot change your own role.');
      return;
    }
    setRolePickerUser(user);
  };

  const confirmRoleChange = (newRole) => {
    const user = rolePickerUser;
    if (!user || newRole === user.role) {
      setRolePickerUser(null);
      return;
    }
    setRolePickerUser(null);
    showAlert(
      'Confirm Role Change',
      `Change ${user.name}'s role from ${ROLE_LABELS[user.role]} to ${ROLE_LABELS[newRole]}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Set ${ROLE_LABELS[newRole]}`,
          onPress: async () => {
            markBusy(user._id, true);
            try {
              const res = await adminApi.patch(`/users/${user._id}/role`, { role: newRole });
              setUsers((prev) => prev.map((u) => (u._id === user._id ? { ...u, ...res.data } : u)));
            } catch (err) {
              showAlert('Error', err.response?.data?.message || 'Role change failed.');
            } finally {
              markBusy(user._id, false);
            }
          },
        },
      ],
    );
  };

  const handleDelete = (user) => {
    if (user._id === userInfo?._id) {
      showAlert('Not allowed', 'You cannot delete yourself.');
      return;
    }
    showAlert(
      'Delete User',
      `Permanently delete ${user.name} (${user.mobileNumber})? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            markBusy(user._id, true);
            try {
              await adminApi.delete(`/users/${user._id}`);
              setUsers((prev) => prev.filter((u) => u._id !== user._id));
            } catch (err) {
              showAlert('Error', err.response?.data?.message || 'Delete failed.');
              markBusy(user._id, false);
            }
          },
        },
      ],
    );
  };

  const pendingCount = users.filter((u) => !u.isApproved).length;

  const renderUser = ({ item }) => {
    const isSelf = item._id === userInfo?._id;
    const busy = busyIds[item._id];
    const isPending = !item.isApproved;

    return (
      <View style={[styles.card, isPending && styles.cardPending]}>
        <View style={styles.cardHeader}>
          <UserAvatar name={item.name} imageUrl={item.profilePicUrl} size={48} style={styles.avatar} />
          <View style={styles.cardInfo}>
            <Text style={styles.userName} numberOfLines={1}>
              {item.name} {isSelf ? '(You)' : ''}
            </Text>
            <Text style={styles.userMobile}>{item.mobileNumber}</Text>
          </View>
          <View style={styles.badges}>
            <View style={[styles.roleBadge, styles[`role_${item.role}`]]}>
              <Text style={styles.roleBadgeText}>{ROLE_LABELS[item.role] || item.role}</Text>
            </View>
            <View style={[styles.statusDot, { backgroundColor: isPending ? '#f59e0b' : '#22c55e' }]} />
          </View>
        </View>

        {busy ? (
          <View style={styles.busyRow}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : (
          <View style={styles.actionRow}>
            {isPending ? (
              <TouchableOpacity style={styles.approveBtn} onPress={() => handleApprove(item._id)}>
                <Icon name="check-circle" size={16} color="#fff" />
                <Text style={styles.approveBtnText}>Approve</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.revokeBtn} onPress={() => handleReject(item._id)} disabled={isSelf}>
                <Icon name="block" size={14} color={isSelf ? colors.textSecondary : '#dc2626'} />
                <Text style={[styles.revokeBtnText, isSelf && { color: colors.textSecondary }]}>Revoke</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.roleBtn}
              onPress={() => openRolePicker(item)}
              disabled={isSelf}
            >
              <Icon name="swap-horiz" size={16} color={isSelf ? colors.textSecondary : colors.primary} />
              <Text style={[styles.roleBtnText, { color: isSelf ? colors.textSecondary : colors.primary }]}>Role</Text>
            </TouchableOpacity>

            {!isSelf && (
              <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(item)}>
                <Icon name="delete-outline" size={16} color="#dc2626" />
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.title}>Admin Panel</Text>
        {pendingCount > 0 && (
          <View style={styles.pendingBadge}>
            <Text style={styles.pendingBadgeText}>{pendingCount} pending</Text>
          </View>
        )}
      </View>

      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterPill, filter === f.key && styles.filterPillActive]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[styles.filterText, filter === f.key && styles.filterTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={users}
          keyExtractor={(item) => item._id}
          renderItem={renderUser}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          ListEmptyComponent={
            <Text style={styles.empty}>No users found.</Text>
          }
        />
      )}
      <Modal
        visible={Boolean(rolePickerUser)}
        transparent
        animationType="fade"
        onRequestClose={() => setRolePickerUser(null)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setRolePickerUser(null)}
        >
          <View style={styles.rolePickerSheet}>
            <Text style={styles.rolePickerTitle}>
              Change role for {rolePickerUser?.name}
            </Text>
            <Text style={styles.rolePickerSubtitle}>
              Current: {ROLE_LABELS[rolePickerUser?.role]}
            </Text>

            {ROLE_CYCLE.map((role) => {
              const isCurrent = role === rolePickerUser?.role;
              return (
                <TouchableOpacity
                  key={role}
                  style={[
                    styles.roleOption,
                    isCurrent && styles.roleOptionCurrent,
                  ]}
                  onPress={() => confirmRoleChange(role)}
                  disabled={isCurrent}
                >
                  <View style={[styles.roleOptionDot, styles[`role_${role}`]]} />
                  <Text
                    style={[
                      styles.roleOptionText,
                      isCurrent && styles.roleOptionTextCurrent,
                    ]}
                  >
                    {ROLE_LABELS[role]}
                  </Text>
                  {isCurrent && (
                    <Text style={styles.roleOptionBadge}>CURRENT</Text>
                  )}
                </TouchableOpacity>
              );
            })}

            <TouchableOpacity
              style={styles.rolePickerCancel}
              onPress={() => setRolePickerUser(null)}
            >
              <Text style={styles.rolePickerCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
};

function getStyles(colors, isDark) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: 8,
    },
    title: {
      fontSize: 26,
      fontWeight: '800',
      color: colors.text,
      letterSpacing: 0.3,
    },
    pendingBadge: {
      backgroundColor: '#f59e0b',
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderRadius: 14,
    },
    pendingBadgeText: {
      color: '#0f172a',
      fontSize: 12,
      fontWeight: '800',
    },
    filterRow: {
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 20,
      paddingVertical: 10,
    },
    filterPill: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 20,
      borderWidth: 1.5,
      borderColor: isDark ? '#334155' : '#cbd5e1',
      backgroundColor: colors.surface,
    },
    filterPillActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primary,
    },
    filterText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textSecondary,
    },
    filterTextActive: {
      color: '#fff',
    },
    list: { paddingHorizontal: 16, paddingBottom: 30 },
    empty: {
      textAlign: 'center',
      color: colors.textSecondary,
      marginTop: 60,
      fontSize: 15,
    },

    // ── Card ──
    card: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: isDark ? '#334155' : '#e2e8f0',
      ...Platform.select({
        ios: { shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
        android: { elevation: 2 },
      }),
    },
    cardPending: {
      borderColor: '#f59e0b',
      borderWidth: 1.5,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    avatar: {
      width: 48,
      height: 48,
      borderRadius: 24,
      borderWidth: 2,
      borderColor: colors.border,
    },
    cardInfo: { flex: 1, minWidth: 0 },
    userName: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    userMobile: {
      fontSize: 13,
      color: colors.textSecondary,
      fontWeight: '500',
      marginTop: 2,
    },
    badges: {
      alignItems: 'flex-end',
      gap: 6,
    },
    roleBadge: {
      paddingHorizontal: 10,
      paddingVertical: 3,
      borderRadius: 10,
    },
    roleBadgeText: {
      fontSize: 10,
      fontWeight: '800',
      color: '#fff',
      textTransform: 'uppercase',
      letterSpacing: 0.8,
    },
    role_super_admin: { backgroundColor: '#7c3aed' },
    role_owner: { backgroundColor: '#0ea5e9' },
    role_guest: { backgroundColor: '#94a3b8' },
    statusDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },

    // ── Actions ──
    actionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginTop: 14,
      paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: isDark ? '#334155' : '#e2e8f0',
    },
    busyRow: {
      alignItems: 'center',
      marginTop: 14,
      paddingTop: 12,
    },
    approveBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: '#16a34a',
      paddingVertical: 10,
      borderRadius: 12,
    },
    approveBtnText: {
      color: '#fff',
      fontWeight: '800',
      fontSize: 13,
    },
    revokeBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 10,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: '#fecaca',
      backgroundColor: isDark ? '#1c1917' : '#fef2f2',
    },
    revokeBtnText: {
      color: '#dc2626',
      fontWeight: '700',
      fontSize: 13,
    },
    roleBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 10,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: isDark ? '#334155' : '#cbd5e1',
      backgroundColor: colors.surface,
    },
    roleBtnText: {
      fontWeight: '700',
      fontSize: 13,
    },
    deleteBtn: {
      width: 40,
      height: 40,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1.5,
      borderColor: '#fecaca',
      backgroundColor: isDark ? '#1c1917' : '#fef2f2',
    },

    // ── Role picker modal ──
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      justifyContent: 'center',
      paddingHorizontal: 30,
    },
    rolePickerSheet: {
      backgroundColor: colors.surface,
      borderRadius: 20,
      padding: 24,
      maxWidth: 400,
      alignSelf: 'center',
      width: '100%',
      borderWidth: 1,
      borderColor: isDark ? '#334155' : '#e2e8f0',
    },
    rolePickerTitle: {
      fontSize: 18,
      fontWeight: '800',
      color: colors.text,
      marginBottom: 4,
    },
    rolePickerSubtitle: {
      fontSize: 13,
      color: colors.textSecondary,
      fontWeight: '600',
      marginBottom: 20,
    },
    roleOption: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 14,
      paddingHorizontal: 16,
      borderRadius: 14,
      marginBottom: 8,
      borderWidth: 1.5,
      borderColor: isDark ? '#334155' : '#e2e8f0',
      backgroundColor: isDark ? '#0f172a' : '#f8fafc',
    },
    roleOptionCurrent: {
      borderColor: colors.primary,
      backgroundColor: isDark ? '#1e293b' : '#eff6ff',
    },
    roleOptionDot: {
      width: 14,
      height: 14,
      borderRadius: 7,
    },
    roleOptionText: {
      flex: 1,
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    roleOptionTextCurrent: {
      color: colors.primary,
    },
    roleOptionBadge: {
      fontSize: 10,
      fontWeight: '800',
      color: colors.primary,
      letterSpacing: 1,
      backgroundColor: isDark ? '#1e3a5f' : '#dbeafe',
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 6,
    },
    rolePickerCancel: {
      marginTop: 8,
      paddingVertical: 14,
      borderRadius: 14,
      alignItems: 'center',
      borderWidth: 1.5,
      borderColor: isDark ? '#334155' : '#e2e8f0',
    },
    rolePickerCancelText: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textSecondary,
    },
  });
}

export default AdminPanelScreen;
