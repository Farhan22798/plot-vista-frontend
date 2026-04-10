import React, { createContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authApi } from '../services/api';
import { COMETCHAT_UID_STORAGE_KEY } from '../constants/storageKeys';

export const AuthContext = createContext();
const TEMP_GUEST_MODE_KEY = 'temporaryGuestModeEnabled';

export const AuthProvider = ({ children }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [userToken, setUserToken] = useState(null);
  const [userInfo, setUserInfo] = useState(null);
  const [temporaryGuestModeEnabled, setTemporaryGuestModeEnabled] = useState(false);

  const login = async (mobileNumber, password) => {
    setIsLoading(true);
    try {
      const response = await authApi.post('/login', { mobileNumber, password });
      const { token, ...userData } = response.data;

      await AsyncStorage.setItem('userInfo', JSON.stringify(userData));
      await AsyncStorage.setItem('userToken', token);
      setUserInfo(userData);
      setUserToken(token);
    } catch (e) {
      if (__DEV__) console.error(`Login error: ${e.response?.data?.message || e.message}`);
      throw e;
    } finally {
      setIsLoading(false);
    }
  };

  const sendSignupOtp = async (email) => {
    const response = await authApi.post('/signup-otp', { email });
    return response.data;
  };

  const verifySignupOtp = async (email, emailOtp) => {
    const response = await authApi.post('/signup-otp/verify', { email, emailOtp });
    return response.data;
  };

  const register = async (name, mobileNumber, email, emailOtp, password, profilePicBase64 = null) => {
    setIsLoading(true);
    try {
      const payload = { name, mobileNumber, email, emailOtp, password };
      if (profilePicBase64) payload.profilePicBase64 = profilePicBase64;
      await authApi.post('/register', payload);
    } catch (e) {
      if (__DEV__) console.error(`Register error: ${e.response?.data?.message || e.message}`);
      throw e;
    } finally {
      setIsLoading(false);
    }
  };

  const updatePassword = async (currentPassword, newPassword) => {
    await authApi.put('/password', { currentPassword, newPassword });
  };

  const updateEmail = async (email, currentPassword) => {
    const { data } = await authApi.put('/email', { email, currentPassword });
    setUserInfo(data);
    await AsyncStorage.setItem('userInfo', JSON.stringify(data));
  };

  const logout = async () => {
    setIsLoading(true);
    try {
      setUserToken(null);
      setUserInfo(null);
      setTemporaryGuestModeEnabled(false);
      await AsyncStorage.removeItem('userInfo');
      await AsyncStorage.removeItem('userToken');
      await AsyncStorage.removeItem(COMETCHAT_UID_STORAGE_KEY);
      await AsyncStorage.removeItem(TEMP_GUEST_MODE_KEY);
    } catch (e) {
      if (__DEV__) console.error(`Logout error: ${e}`);
    } finally {
      setIsLoading(false);
    }
  };

  const enableTemporaryGuestMode = useCallback(async () => {
    setTemporaryGuestModeEnabled(true);
    await AsyncStorage.setItem(TEMP_GUEST_MODE_KEY, 'true');
  }, []);

  const disableTemporaryGuestMode = useCallback(async () => {
    setTemporaryGuestModeEnabled(false);
    await AsyncStorage.removeItem(TEMP_GUEST_MODE_KEY);
  }, []);

  const refreshUserData = useCallback(async () => {
    try {
      const response = await authApi.get('/me');
      setUserInfo(response.data);
      await AsyncStorage.setItem('userInfo', JSON.stringify(response.data));
    } catch (e) {
      if (__DEV__) console.error('Failed to refresh user data', e);
      // On 401 (invalid/expired token), clear the session so the user is
      // taken back to login instead of silently staying "logged in".
      if (e?.response?.status === 401) {
        setUserToken(null);
        setUserInfo(null);
        await AsyncStorage.multiRemove(['userToken', 'userInfo', COMETCHAT_UID_STORAGE_KEY]);
      }
    }
  }, []);

  useEffect(() => {
    const isLoggedIn = async () => {
      try {
        setIsLoading(true);
        const storedInfo = await AsyncStorage.getItem('userInfo');
        const storedToken = await AsyncStorage.getItem('userToken');

        let parsedInfo = null;
        try {
          parsedInfo = storedInfo ? JSON.parse(storedInfo) : null;
        } catch (_) {
          await AsyncStorage.removeItem('userInfo');
        }

        const guestModeFlag = await AsyncStorage.getItem(TEMP_GUEST_MODE_KEY);
        setTemporaryGuestModeEnabled(guestModeFlag === 'true');

        if (parsedInfo && storedToken) {
          setUserToken(storedToken);
          setUserInfo(parsedInfo);

          try {
            const response = await authApi.get('/me', {
              headers: { Authorization: `Bearer ${storedToken}` },
            });
            setUserInfo(response.data);
            await AsyncStorage.setItem('userInfo', JSON.stringify(response.data));
          } catch (syncError) {
            if (__DEV__) console.log('[AuthContext] Background sync failed', syncError.message);
            if (syncError?.response?.status === 401) {
              setUserToken(null);
              setUserInfo(null);
              setTemporaryGuestModeEnabled(false);
              await AsyncStorage.multiRemove(['userToken', 'userInfo', COMETCHAT_UID_STORAGE_KEY]);
              await AsyncStorage.removeItem(TEMP_GUEST_MODE_KEY);
            }
          }
        }
      } catch (e) {
        if (__DEV__) console.error(`isLoggedIn error: ${e}`);
      } finally {
        setIsLoading(false);
      }
    };

    isLoggedIn();
  }, []);

  const effectiveRole =
    temporaryGuestModeEnabled && userInfo?.role !== 'guest'
      ? 'guest'
      : userInfo?.role;

  return (
    <AuthContext.Provider
      value={{
        login,
        logout,
        register,
        sendSignupOtp,
        verifySignupOtp,
        updatePassword,
        updateEmail,
        refreshUserData,
        isLoading,
        userToken,
        userInfo,
        effectiveRole,
        temporaryGuestModeEnabled,
        enableTemporaryGuestMode,
        disableTemporaryGuestMode,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
