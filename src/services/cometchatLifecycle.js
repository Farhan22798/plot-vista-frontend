import { CometChatUIKit } from '@cometchat/chat-uikit-react-native';
import { getCometChatUIKitSettings } from '../config/cometchatSettings';
import { devLog, devError, serializeError } from '../utils/devLog';

let initPromise = null;

/**
 * Single shared init for the whole app (bootstrap + signup user creation).
 * Resolves to true if the SDK initialized, false if env is missing or init failed.
 */
export function initCometChatOnce() {
  if (initPromise) {
    if (__DEV__) {
      devLog('cometchatLifecycle', 'initCometChatOnce: reusing existing promise');
    }
    return initPromise;
  }

  const settings = getCometChatUIKitSettings();
  if (!settings) {
    devLog('cometchatLifecycle', 'init skipped: missing COMETCHAT_* env');
    initPromise = Promise.resolve(false);
    return initPromise;
  }

  if (__DEV__) {
    devLog('cometchatLifecycle', 'CometChatUIKit.init starting', {
      region: settings.region,
      appIdLength: settings.appId?.length,
      hasAuthKey: !!settings.authKey,
    });
  }

  initPromise = CometChatUIKit.init(settings)
    .then(() => {
      devLog('cometchatLifecycle', 'CometChatUIKit.init SUCCESS');
      return true;
    })
    .catch((error) => {
      devError('cometchatLifecycle', 'CometChatUIKit.init FAILED', serializeError(error));
      return false;
    });

  return initPromise;
}
