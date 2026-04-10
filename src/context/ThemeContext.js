import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const lightColors = {
  background: '#F5f5f5',  // Default light grey/white background
  surface: '#FFFFFF',     // Cards and modals
  text: '#333333',        // Dark grey text
  textSecondary: '#666666',
  border: '#DDDDDD',
  primary: '#2A9D8F',     // Main brand color
  placeholder: '#A0A0A0', // High visibility light mode placeholder
  inputBackground: '#F9F9F9',
  buttonBackground: '#E76F51',
  buttonText: '#FFFFFF',
  danger: '#E53935'
};

export const darkColors = {
  background: '#121212',  // Deep sleek aesthetic grey
  surface: '#1E1E1E',     // Elevated modal or card area
  text: '#ECECEC',        // Off-white text to prevent eye strain
  textSecondary: '#A0A0A0',
  border: '#333333',
  primary: '#2A9D8F',     // Main brand color remains identical
  placeholder: '#7A7A7A', // Beautiful high contrast placeholder for dark mode
  inputBackground: '#262626',
  buttonBackground: '#E76F51',
  buttonText: '#FFFFFF',
  danger: '#ff5252'
};

const ThemeContext = createContext({
  isDark: false,
  colors: lightColors,
  themeMode: 'system',
  setThemeMode: (_mode) => {},
});

const THEME_MODE_KEY = 'themeModePreference';

export const ThemeProvider = ({ children }) => {
  const systemColorScheme = useColorScheme();
  const [themeMode, setThemeModeState] = useState('system');

  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(THEME_MODE_KEY);
        if (saved === 'light' || saved === 'dark' || saved === 'system') {
          setThemeModeState(saved);
        }
      } catch (_) {
        // Ignore preference load failures; system mode remains active.
      }
    })();
  }, []);

  const setThemeMode = async (mode) => {
    if (!['system', 'light', 'dark'].includes(mode)) return;
    setThemeModeState(mode);
    try {
      await AsyncStorage.setItem(THEME_MODE_KEY, mode);
    } catch (_) {
      // Ignore persistence errors; in-memory mode still updates UI.
    }
  };

  const isDark = themeMode === 'system' ? systemColorScheme === 'dark' : themeMode === 'dark';

  const theme = useMemo(
    () => ({
      isDark,
      colors: isDark ? darkColors : lightColors,
      themeMode,
      setThemeMode,
    }),
    [isDark, themeMode],
  );

  return (
    <ThemeContext.Provider value={theme}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
