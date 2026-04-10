import React, { useContext, useEffect } from 'react';
import { StatusBar, View, ActivityIndicator, Text, AppState, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer, DarkTheme as NavigationDarkTheme, DefaultTheme as NavigationDefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import messaging from '@react-native-firebase/messaging';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { CometChatI18nProvider, CometChatThemeProvider } from '@cometchat/chat-uikit-react-native';

// Import Screens & Context
import KeepAwake, { activateKeepAwake } from '@sayem314/react-native-keep-awake';
import { AuthProvider, AuthContext } from './src/context/AuthContext';
import { UserAvatarProvider } from './src/context/UserAvatarContext';
import { AlertProvider } from './src/context/AlertContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { usePermissions } from './src/hooks/usePermissions';
import LayoutStack from './src/navigation/LayoutStack';
import AreaStatementScreen from './src/screens/AreaStatementScreen';
import SummaryScreen from './src/screens/SummaryScreen';
import WaitingListScreen from './src/screens/WaitingListScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import AdminPanelScreen from './src/screens/AdminPanelScreen';
import LoginScreen from './src/screens/LoginScreen';
import SignupScreen from './src/screens/SignupScreen';
import PendingApprovalScreen from './src/screens/PendingApprovalScreen';
import ServerWarmup from './src/components/ServerWarmup';
import CometChatInit from './src/components/chat/CometChatInit';
import CometChatSession from './src/components/chat/CometChatSession';
import { displayLocalNotification } from './src/services/cometchatPushNotifications';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function TabLabel({ color, line1, line2 }: { color: string; line1: string; line2: string }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ color, fontSize: 10, fontWeight: '600', lineHeight: 13, textAlign: 'center' }}>{line1}</Text>
      <Text style={{ color, fontSize: 10, fontWeight: '600', lineHeight: 13, textAlign: 'center' }}>{line2}</Text>
    </View>
  );
}

/** Full tab navigator for super_admin and owner roles. */
function FullTabs() {
  const { colors } = useTheme();
  const { canAccessAdmin } = usePermissions();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: { fontWeight: 'bold', color: colors.text },
        headerTintColor: colors.text,
        tabBarIcon: ({ color, size }) => {
          let iconName = 'error';
          if (route.name === 'Layout') iconName = 'map';
          else if (route.name === 'Area Statement') iconName = 'pie-chart';
          else if (route.name === 'Waiting List') iconName = 'hourglass-top';
          else if (route.name === 'Summary') iconName = 'list-alt';
          else if (route.name === 'Admin') iconName = 'admin-panel-settings';
          else if (route.name === 'Profile') iconName = 'person';
          return <Icon name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarHideOnKeyboard: true,
        tabBarItemStyle: { paddingVertical: 4 },
        tabBarStyle: {
          paddingBottom: 2,
          paddingTop: 2,
          height: 74,
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
      })}
    >
      <Tab.Screen name="Layout" component={LayoutStack} options={{ title: 'Master Plan', headerShown: false, tabBarLabel: ({ color }) => <TabLabel color={color} line1="Master" line2="Plan" /> }} />
      <Tab.Screen name="Area Statement" component={AreaStatementScreen} options={{ title: 'Area Statement', tabBarLabel: ({ color }) => <TabLabel color={color} line1="Area" line2="Statement" /> }} />
      <Tab.Screen name="Waiting List" component={WaitingListScreen} options={{ title: 'Waiting List', tabBarLabel: ({ color }) => <TabLabel color={color} line1="Waiting" line2="List" /> }} />
      <Tab.Screen name="Summary" component={SummaryScreen} options={{ title: 'Activity Summary', tabBarLabel: ({ color }) => <TabLabel color={color} line1="Activity" line2="Summary" /> }} />
      {canAccessAdmin && (
        <Tab.Screen name="Admin" component={AdminPanelScreen} options={{ title: 'Admin Panel', headerShown: false, tabBarLabel: ({ color }) => <TabLabel color={color} line1="Admin" line2="Panel" /> }} />
      )}
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: 'User Profile', tabBarLabel: ({ color }) => <TabLabel color={color} line1="User" line2="Profile" /> }} />
    </Tab.Navigator>
  );
}

/** Read-only navigator for guest role — map + profile tabs only. */
function GuestTabs() {
  const { colors } = useTheme();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: { fontWeight: 'bold', color: colors.text },
        headerTintColor: colors.text,
        tabBarIcon: ({ color, size }) => {
          const iconName = route.name === 'Layout' ? 'map' : 'person';
          return <Icon name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarHideOnKeyboard: true,
        tabBarItemStyle: { paddingVertical: 4 },
        tabBarStyle: {
          paddingBottom: 2,
          paddingTop: 2,
          height: 74,
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
      })}
    >
      <Tab.Screen name="Layout" component={LayoutStack} options={{ title: 'Master Plan', headerShown: false, tabBarLabel: ({ color }) => <TabLabel color={color} line1="Master" line2="Plan" /> }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: 'User Profile', tabBarLabel: ({ color }) => <TabLabel color={color} line1="User" line2="Profile" /> }} />
    </Tab.Navigator>
  );
}

function MainAppWithWarmup() {
  const { isGuest } = usePermissions();
  return (
    <ServerWarmup>
      {isGuest ? <GuestTabs /> : <FullTabs />}
    </ServerWarmup>
  );
}

function NavigationWrapper() {
  const { isLoading, userToken, userInfo } = useContext(AuthContext);
  const { isDark, colors } = useTheme();

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer theme={isDark ? NavigationDarkTheme : NavigationDefaultTheme}>
      {userToken == null ? (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Signup" component={SignupScreen} />
        </Stack.Navigator>
      ) : userInfo?.isApproved === false ? (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Pending" component={PendingApprovalScreen} />
        </Stack.Navigator>
      ) : (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="MainTabs" component={MainAppWithWarmup} />
        </Stack.Navigator>
      )}
    </NavigationContainer>
  );
}

function AppContent() {
  const { isDark, colors } = useTheme();
  return (
    <>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.surface} />
      <AlertProvider>
        <CometChatInit />
        <AuthProvider>
          <UserAvatarProvider>
            <CometChatSession />
            <NavigationWrapper />
          </UserAvatarProvider>
        </AuthProvider>
      </AlertProvider>
    </>
  );
}

function App(): React.JSX.Element {
  // KeepAwake only applies FLAG_KEEP_SCREEN_ON when getCurrentActivity() is set.
  // On some devices that is briefly null at first JS paint; OxygenOS can also drop
  // window flags after aggressive lifecycle transitions. Re-apply on a short delay
  // and whenever the app returns to the foreground.
  useEffect(() => {
    const bump = () => {
      activateKeepAwake();
    };
    bump();
    const t1 = setTimeout(bump, 100);
    const t2 = setTimeout(bump, 600);
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') bump();
    });
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const unsubscribe = messaging().onMessage(async (remoteMessage) => {
      await displayLocalNotification(remoteMessage);
    });
    return () => unsubscribe();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeepAwake />
      <SafeAreaProvider>
        <ThemeProvider>
          <CometChatI18nProvider>
            <CometChatThemeProvider>
              <AppContent />
            </CometChatThemeProvider>
          </CometChatI18nProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default App;
