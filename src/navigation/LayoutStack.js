import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../context/ThemeContext';
import LayoutScreen from '../screens/LayoutScreen';
import PlotDetailsScreen from '../screens/PlotDetailsScreen';
import MultiPlotSummaryScreen from '../screens/MultiPlotSummaryScreen';
import GroupChatScreen from '../screens/GroupChatScreen';
import SearchMessagesScreen from '../screens/SearchMessagesScreen';

const Stack = createNativeStackNavigator();

export default function LayoutStack() {
  const { colors } = useTheme();
  return (
    <Stack.Navigator
      screenOptions={{
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="LayoutMap" component={LayoutScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="PlotDetails"
        component={PlotDetailsScreen}
        options={{
          title: 'Plot details',
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '800', color: colors.text },
          headerShadowVisible: false,
        }}
      />
      <Stack.Screen
        name="MultiPlotSummary"
        component={MultiPlotSummaryScreen}
        options={{
          title: 'Selected Plots Info',
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '800', color: colors.text },
          headerShadowVisible: false,
        }}
      />
      <Stack.Screen
        name="GroupChat"
        component={GroupChatScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SearchMessages"
        component={SearchMessagesScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
}
