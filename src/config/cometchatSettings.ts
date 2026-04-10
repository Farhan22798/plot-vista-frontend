import Config from 'react-native-config';
import { CometChat } from '@cometchat/chat-sdk-react-native';
import type { UIKitSettings } from '@cometchat/chat-uikit-react-native';

declare const __DEV__: boolean;

function devSettingsLog(message: string, extra?: Record<string, unknown>) {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log('[PlotVista:cometchatSettings]', message, extra ?? '');
  }
}

export function getCometChatUIKitSettings(): UIKitSettings | null {
  const appId = Config.COMETCHAT_APP_ID?.trim();
  const region = Config.COMETCHAT_REGION?.trim();
  const authKey = Config.COMETCHAT_AUTH_KEY?.trim();

  if (!appId || !region || !authKey) {
    devSettingsLog('UIKit settings INCOMPLETE — check .env');
    console.warn(
      '[CometChat] Set COMETCHAT_APP_ID, COMETCHAT_REGION, and COMETCHAT_AUTH_KEY in .env (see .env.example).',
    );
    return null;
  }

  devSettingsLog('UIKit settings OK', {
    region,
    appIdLen: appId.length,
    authKeyLen: authKey.length,
  });

  return {
    appId,
    authKey,
    region,
    subscriptionType: CometChat.AppSettings.SUBSCRIPTION_TYPE_ALL_USERS as UIKitSettings['subscriptionType'],
  };
}

/** Default CometChat group GUID for Golden City community chat (create this group in dashboard). */
export const COMETCHAT_COMMUNITY_GROUP_DEFAULT = 'golden-city';
export const COMETCHAT_NOTIFICATION_GROUP_DEFAULT = 'golden-city-noti';

/**
 * Group GUID for the shared community room. Env `COMETCHAT_COMMUNITY_GROUP_ID` overrides when set.
 */
export function getCometChatCommunityGroupId(): string {
  const fromEnv = Config.COMETCHAT_COMMUNITY_GROUP_ID?.trim();
  const id = fromEnv || COMETCHAT_COMMUNITY_GROUP_DEFAULT;
  devSettingsLog('community group id', { id, fromEnv: !!fromEnv });
  return id;
}

/**
 * Group GUID for activity feed notifications. Env override: COMETCHAT_NOTIFICATION_GROUP_ID.
 */
export function getCometChatNotificationGroupId(): string {
  const fromEnv = Config.COMETCHAT_NOTIFICATION_GROUP_ID?.trim();
  const id = fromEnv || COMETCHAT_NOTIFICATION_GROUP_DEFAULT;
  devSettingsLog('notification group id', { id, fromEnv: !!fromEnv });
  return id;
}

/**
 * FCM provider ID configured in CometChat dashboard (Notifications -> Settings).
 */
export function getCometChatFcmProviderId(): string {
  const providerId = Config.COMETCHAT_FCM_PROVIDER_ID?.trim() || '';
  if (!providerId) {
    devSettingsLog('FCM provider id missing');
  }
  return providerId;
}
