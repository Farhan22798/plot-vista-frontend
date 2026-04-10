import React, { createContext, useState, useContext, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  useWindowDimensions,
  Platform,
  ScrollView,
} from 'react-native';
import { useTheme } from './ThemeContext';

export const AlertContext = createContext();

export const useAlert = () => useContext(AlertContext);

export const AlertProvider = ({ children }) => {
  const { colors, isDark } = useTheme();
  const { width } = useWindowDimensions();
  const styles = useMemo(() => getStyles(colors, isDark, width), [colors, isDark, width]);

  const [alertState, setAlertState] = useState({
    visible: false,
    title: '',
    message: '',
    buttons: [],
    verticalButtons: false,
  });

  const scaleValue = useRef(new Animated.Value(0)).current;
  const opacityValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (alertState.visible) {
      Animated.parallel([
        Animated.spring(scaleValue, {
          toValue: 1,
          friction: 6,
          tension: 40,
          useNativeDriver: true,
        }),
        Animated.timing(opacityValue, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(scaleValue, {
          toValue: 0.8,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(opacityValue, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [alertState.visible]);

  const hideAlert = useCallback(() => {
    setAlertState((prev) => ({ ...prev, visible: false }));
  }, []);

  const showAlert = useCallback((title, message, buttons, options = {}) => {
    const list = buttons || [{ text: 'OK', onPress: () => hideAlert() }];
    const verticalButtons =
      options.verticalButtons === true || (options.verticalButtons !== false && list.length > 2);
    setAlertState({
      visible: true,
      title,
      message,
      buttons: list,
      verticalButtons,
    });
  }, [hideAlert]);

  const handleButtonPress = useCallback((onPress) => {
    hideAlert();
    if (onPress) {
      setTimeout(onPress, 150);
    }
  }, [hideAlert]);

  return (
    <AlertContext.Provider value={{ showAlert, hideAlert }}>
      {children}
      <Modal
        transparent
        visible={alertState.visible}
        animationType="none"
        onRequestClose={hideAlert}
      >
        <View style={styles.overlay}>
          <Animated.View
            style={[
              styles.alertBox,
              {
                opacity: opacityValue,
                transform: [{ scale: scaleValue }],
              },
            ]}
          >
            <View style={styles.content}>
              {alertState.title ? (
                <Text style={styles.title}>{alertState.title}</Text>
              ) : null}
              {alertState.message ? (
                <ScrollView
                  style={styles.messageScroll}
                  contentContainerStyle={styles.messageScrollContent}
                  showsVerticalScrollIndicator={alertState.message.length > 180}
                  keyboardShouldPersistTaps="handled"
                >
                  <Text style={styles.message}>{alertState.message}</Text>
                </ScrollView>
              ) : null}
            </View>

            <View
              style={[
                styles.buttonContainer,
                alertState.buttons.length > 0 && styles.buttonContainerDivider,
                alertState.verticalButtons && styles.buttonContainerVertical,
              ]}
            >
              {alertState.buttons.map((btn, index) => {
                const isDestructive = btn.style === 'destructive';
                const isCancel = btn.style === 'cancel';
                const vertical = alertState.verticalButtons;
                return (
                  <TouchableOpacity
                    key={index}
                    style={[
                      styles.button,
                      vertical && styles.buttonVertical,
                      isDestructive && styles.destructiveButton,
                      isCancel && styles.cancelButton,
                      !vertical && alertState.buttons.length > 1 && styles.buttonRowFlex,
                      !vertical && index > 0 && styles.buttonRowMargin,
                    ]}
                    onPress={() => handleButtonPress(btn.onPress)}
                    activeOpacity={0.85}
                  >
                    <Text
                      style={[
                        styles.buttonText,
                        vertical && styles.buttonTextVertical,
                        isDestructive && styles.destructiveButtonText,
                        isCancel && styles.cancelButtonText,
                      ]}
                      numberOfLines={3}
                      ellipsizeMode="tail"
                    >
                      {btn.text}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Animated.View>
        </View>
      </Modal>
    </AlertContext.Provider>
  );
};

const getStyles = (colors, isDark, windowWidth) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(15, 23, 42, 0.72)',
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 20,
    },
    alertBox: {
      width: '100%',
      maxWidth: Math.min(400, windowWidth - 40),
      backgroundColor: colors.surface,
      borderRadius: 20,
      padding: 22,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? 'rgba(148,163,184,0.2)' : 'rgba(15,23,42,0.08)',
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 12 },
          shadowOpacity: 0.22,
          shadowRadius: 24,
        },
        android: {
          elevation: 18,
        },
      }),
    },
    content: {
      marginBottom: 20,
      alignItems: 'stretch',
      width: '100%',
    },
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 8,
      textAlign: 'center',
      letterSpacing: 0.2,
    },
    messageScroll: {
      maxHeight: 140,
      width: '100%',
    },
    messageScrollContent: {
      flexGrow: 1,
    },
    message: {
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 20,
      fontWeight: '500',
    },
    buttonContainer: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      alignItems: 'stretch',
      width: '100%',
      flexWrap: 'nowrap',
    },
    buttonContainerDivider: {
      marginTop: 4,
      paddingTop: 18,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    buttonContainerVertical: {
      flexDirection: 'column',
      gap: 10,
    },
    button: {
      backgroundColor: colors.primary,
      paddingVertical: 13,
      paddingHorizontal: 16,
      borderRadius: 14,
      justifyContent: 'center',
      alignItems: 'center',
      minWidth: 100,
    },
    buttonVertical: {
      width: '100%',
      minWidth: undefined,
      paddingVertical: 14,
      paddingHorizontal: 14,
    },
    buttonRowFlex: {
      flex: 1,
    },
    buttonRowMargin: {
      marginLeft: 10,
    },
    cancelButton: {
      backgroundColor: isDark ? '#1e293b' : '#f1f5f9',
      borderWidth: 1,
      borderColor: colors.border,
    },
    destructiveButton: {
      backgroundColor: colors.danger,
    },
    buttonText: {
      color: '#ffffff',
      fontSize: 15,
      fontWeight: '700',
      letterSpacing: 0.2,
      textAlign: 'center',
    },
    buttonTextVertical: {
      fontSize: 14,
      lineHeight: 18,
    },
    cancelButtonText: {
      color: colors.textSecondary,
    },
    destructiveButtonText: {
      color: '#ffffff',
    },
  });
