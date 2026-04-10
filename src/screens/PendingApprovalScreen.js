import React, { useContext, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

const PendingApprovalScreen = () => {
  const { isDark, colors } = useTheme();
  const styles = React.useMemo(() => getStyles(colors, isDark), [colors, isDark]);
  const { logout, userInfo, refreshUserData } = useContext(AuthContext);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Poll for approval status every 10 seconds while the user lingers on this screen
  useEffect(() => {
    const intervalId = setInterval(() => {
      refreshUserData();
    }, 10000); // 10 seconds
    
    return () => clearInterval(intervalId);
  }, [refreshUserData]);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    await refreshUserData();
    setIsRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Icon name="verified-user" size={80} color="#E9C46A" style={styles.icon} />
        <Text style={styles.title}>Account Pending Approval</Text>
        
        <View style={styles.infoBox}>
          <Text style={styles.message}>
            Hello <Text style={styles.bold}>{userInfo?.name}</Text>, you have successfully created an account and logged in.
          </Text>
          <Text style={styles.message}>
            However, your account requires <Text style={styles.bold}>Administrator Approval</Text> before you can access the PlotVista dashboard.
          </Text>
          <Text style={styles.contact}>
            Please contact the system administrator to request access.
          </Text>
        </View>

        <View style={styles.buttonRow}>
          <TouchableOpacity 
            style={[styles.button, styles.refreshButton, isRefreshing && styles.refreshButtonActive]} 
            onPress={handleManualRefresh}
            disabled={isRefreshing}
          >
            {isRefreshing ? (
              <ActivityIndicator size="small" color="#FFF" style={{marginRight: 8}} />
            ) : (
              <Icon name="refresh" size={20} color="#FFF" style={{marginRight: 8}} />
            )}
            <Text style={styles.buttonText}>{isRefreshing ? 'Checking...' : 'Check Status'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.button, styles.logoutButton]} onPress={logout}>
            <Icon name="logout" size={20} color="#FFF" style={{marginRight: 8}} />
            <Text style={styles.buttonText}>Log Out</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
};

const getStyles = (colors, isDark) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  icon: {
    marginBottom: 20,
    opacity: 0.9,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 30,
    textAlign: 'center',
  },
  infoBox: {
    backgroundColor: colors.surface,
    padding: 24,
    borderRadius: 12,
    elevation: 2,
    shadowColor: colors.text,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    marginBottom: 40,
    width: '100%',
  },
  message: {
    fontSize: 16,
    color: colors.textSecondary,
    lineHeight: 24,
    marginBottom: 16,
    textAlign: 'center',
  },
  bold: {
    fontWeight: 'bold',
    color: colors.text,
  },
  contact: {
    fontSize: 15,
    color: colors.primary,
    fontWeight: '500',
    textAlign: 'center',
    marginTop: 10,
    fontStyle: 'italic',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 15,
    width: '100%',
    justifyContent: 'center',
  },
  button: {
    flexDirection: 'row',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: 'center',
    elevation: 2,
    flex: 1,
    justifyContent: 'center',
  },
  refreshButton: {
    backgroundColor: colors.primary,
  },
  refreshButtonActive: {
    backgroundColor: '#1E756B',
  },
  logoutButton: {
    backgroundColor: '#d32f2f',
  },
  buttonText: {
    color: colors.surface,
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default PendingApprovalScreen;
