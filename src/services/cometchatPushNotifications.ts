import { PermissionsAndroid, Platform } from 'react-native';
import messaging from '@react-native-firebase/messaging';
import notifee, { AndroidImportance } from '@notifee/react-native';
import { CometChatNotifications } from '@cometchat/chat-sdk-react-native';
import { getCometChatFcmProviderId } from '../config/cometchatSettings';
import { devError, devLog, serializeError } from '../utils/devLog';

const DEFAULT_CHANNEL_ID = 'cometchat_messages';

function isCometChatAuthMissingError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message || '').toLowerCase();
  const code = String((error as { code?: string })?.code || '').toLowerCase();
  return (
    code.includes('auth') ||
    message.includes('auth token') ||
    message.includes('requires an authtoken') ||
    message.includes('unauthorized')
  );
}

async function ensureAndroidNotificationChannel(): Promise<string | undefined> {
  if (Platform.OS !== 'android') return undefined;
  return notifee.createChannel({
    id: DEFAULT_CHANNEL_ID,
    name: 'CometChat Messages',
    importance: AndroidImportance.HIGH,
    vibration: true,
    lights: true,
  });
}

export async function requestAndroidPushPermission(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    if (Platform.Version >= 33) {
      await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    }
  } catch (error) {
    devError('push', 'POST_NOTIFICATIONS request failed', serializeError(error));
  }
}

export async function registerCometChatPushToken(): Promise<void> {
  if (Platform.OS !== 'android') return;

  const providerId = getCometChatFcmProviderId();
  if (!providerId) {
    devLog('push', 'skipping push token registration: COMETCHAT_FCM_PROVIDER_ID missing');
    return;
  }

  try {
    await requestAndroidPushPermission();
    await messaging().registerDeviceForRemoteMessages();
    const fcmToken = await messaging().getToken();
    await CometChatNotifications.registerPushToken(
      fcmToken,
      CometChatNotifications.PushPlatforms.FCM_REACT_NATIVE_ANDROID,
      providerId,
    );
    devLog('push', 'CometChat push token registered');
  } catch (error) {
    devError('push', 'CometChat push token registration failed', serializeError(error));
  }
}

export async function unregisterCometChatPushToken(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await CometChatNotifications.unregisterPushToken();
    devLog('push', 'CometChat push token unregistered');
  } catch (error) {
    if (isCometChatAuthMissingError(error)) {
      // Happens when logout/session-expiry already cleared CometChat auth.
      // Token is effectively unusable at this point, so don't treat as fatal.
      devLog('push', 'CometChat push token unregister skipped (no active auth token)');
    } else {
      devError('push', 'CometChat push token unregister failed', serializeError(error));
    }
  } finally {
    await notifee.cancelAllNotifications();
    await notifee.setBadgeCount(0);
  }
}

export async function displayLocalNotification(remoteMessage: any): Promise<void> {
  const { notification = {}, data = {} } = remoteMessage || {};
  const title = notification?.title || data?.title || 'New message';
  const body = notification?.body || data?.body || '';
  const unreadCount = Number.parseInt(String(data?.unreadMessageCount ?? ''), 10);
  const badgeCount = Number.isNaN(unreadCount) ? undefined : unreadCount;

  try {
    const channelId = await ensureAndroidNotificationChannel();
    if (badgeCount !== undefined && badgeCount >= 0) {
      await notifee.setBadgeCount(badgeCount);
    }
    const androidNotification =
      channelId === undefined
        ? undefined
        : {
            channelId,
            importance: AndroidImportance.HIGH,
            pressAction: { id: 'default' },
            smallIcon: 'ic_launcher',
            ...(badgeCount !== undefined && badgeCount >= 0 ? { badgeCount } : {}),
          };
    await notifee.displayNotification({
      title,
      body,
      data,
      android: androidNotification,
    });
  } catch (error) {
    devError('push', 'displayLocalNotification failed', serializeError(error));
  }
}

export function subscribeToCometChatPushTokenRefresh(): () => void {
  if (Platform.OS !== 'android') return () => {};
  return messaging().onTokenRefresh(async () => {
    await registerCometChatPushToken();
  });
}
