import { useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CometChat } from '@cometchat/chat-sdk-react-native';
import { CometChatUIKit } from '@cometchat/chat-uikit-react-native';
import { AuthContext } from '../../context/AuthContext';
import { COMETCHAT_UID_STORAGE_KEY } from '../../constants/storageKeys';
import { initCometChatOnce } from '../../services/cometchatLifecycle';
import { cometChatUidFromMobile } from '../../utils/cometchatUid';
import {
  getCometChatCommunityGroupId,
  getCometChatNotificationGroupId,
} from '../../config/cometchatSettings';
import { devLog, devError, serializeError } from '../../utils/devLog';
import {
  registerCometChatPushToken,
  subscribeToCometChatPushTokenRefresh,
  unregisterCometChatPushToken,
} from '../../services/cometchatPushNotifications';

let lastMembershipUid: string | null = null;

function isCometChatUidNotFound(error: unknown): boolean {
  const e = error as { code?: string; message?: string };
  if (e?.code === 'ERR_UID_NOT_FOUND') return true;
  if (/does not exist/i.test(String(e?.message || ''))) return true;
  return false;
}

/**
 * Join the community group after login. Silently ignores "already a member" errors
 * so this is safe to call on every login.
 */
async function ensureGroupMembership(uid: string): Promise<void> {
  if (lastMembershipUid === uid) return;

  const groupIds = [
    getCometChatCommunityGroupId(),
    getCometChatNotificationGroupId(),
  ].filter(Boolean);
  let canCacheMembership = true;

  for (const guid of groupIds) {
    try {
      await CometChat.joinGroup(guid, CometChat.GROUP_TYPE.PUBLIC, '');
      devLog('CometChatSession', 'joined group', { guid, uid });
    } catch (joinErr: unknown) {
      const e = joinErr as { code?: string; message?: string };
      const alreadyMember =
        e?.code === 'ERR_ALREADY_JOINED' ||
        /already.*joined|already.*member/i.test(String(e?.message || ''));
      if (alreadyMember) {
        devLog('CometChatSession', 'already a member of group', { guid });
        continue;
      }
      canCacheMembership = false;
      devError('CometChatSession', 'joinGroup failed', serializeError(joinErr));
    }
  }

  if (canCacheMembership) {
    lastMembershipUid = uid;
  }
}

/**
 * Login to CometChat. If the UID doesn't exist yet (backend registration happened before
 * CometChat was configured, or this is the very first login), create the user via SDK
 * and try again. After a successful login, ensure the user is in the community group.
 */
async function loginOrProvisionUser(
  uid: string,
  displayName: string,
  cancelled: () => boolean,
): Promise<void> {
  try {
    await CometChatUIKit.login({ uid });
  } catch (firstError: unknown) {
    if (!isCometChatUidNotFound(firstError)) {
      throw firstError;
    }

    if (cancelled()) return;

    devLog('CometChatSession', 'UID missing in CometChat — creating user via SDK then login', { uid });

    const user = new CometChat.User(uid);
    user.setName(String(displayName || '').trim() || uid);
    try {
      await CometChatUIKit.createUser(user);
    } catch (createErr: unknown) {
      devLog('CometChatSession', 'createUser (may already exist)', serializeError(createErr));
    }

    if (cancelled()) return;

    await CometChatUIKit.login({ uid });
  }

  if (cancelled()) return;

  // Ensure the user is a member of the shared community group.
  await ensureGroupMembership(uid);
}

/**
 * After shared init resolves: logs into CometChat when PlotVista has a session (+ mobile),
 * or logs out of CometChat when there is no PlotVista session (e.g. login screen).
 */
export default function CometChatSession() {
  const { userToken, userInfo } = useContext(AuthContext);
  const [initOk, setInitOk] = useState<boolean | null>(null);

  useEffect(() => {
    devLog('CometChatSession', 'waiting for initCometChatOnce...');
    initCometChatOnce().then((ok) => {
      devLog('CometChatSession', 'initCometChatOnce resolved', { initOk: ok });
      setInitOk(ok);
    });
  }, []);

  useEffect(() => {
    if (initOk !== true) {
      if (initOk === false) {
        devLog('CometChatSession', 'skip login sync: CometChat init failed or env missing');
      }
      return;
    }

    const uid = cometChatUidFromMobile(userInfo?.mobileNumber);
    const shouldLogin = Boolean(userToken && uid);
    const displayName =
      (userInfo?.name && String(userInfo.name)) || uid || '';

    devLog('CometChatSession', 'session sync tick', {
      hasToken: !!userToken,
      mobile: userInfo?.mobileNumber,
      derivedUid: uid,
      shouldLogin,
    });

    let cancelled = false;

    (async () => {
      try {
        if (shouldLogin && uid) {
          devLog('CometChatSession', 'CometChat login / provision starting', { uid });
          await loginOrProvisionUser(uid, displayName, () => cancelled);
          if (!cancelled) {
            await registerCometChatPushToken();
            await AsyncStorage.setItem(COMETCHAT_UID_STORAGE_KEY, uid);
            devLog('CometChatSession', 'CometChat session OK', { uid });
          }
        } else {
          await AsyncStorage.removeItem(COMETCHAT_UID_STORAGE_KEY);
          await unregisterCometChatPushToken();
          lastMembershipUid = null;
          const loggedIn = await CometChat.getLoggedinUser();
          if (loggedIn) {
            devLog('CometChatSession', 'PlotVista logged out → CometChat.logout', {
              wasUid: loggedIn.getUid(),
            });
            await CometChat.logout();
            if (!cancelled) {
              devLog('CometChatSession', 'CometChat.logout done');
            }
          }
        }
      } catch (error: unknown) {
        if (!cancelled) {
          devError('CometChatSession', 'Session sync failed', serializeError(error));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initOk, userToken, userInfo?.mobileNumber, userInfo?.name]);

  useEffect(() => {
    if (initOk !== true || !userToken) return;
    const unsubscribe = subscribeToCometChatPushTokenRefresh();
    return () => unsubscribe();
  }, [initOk, userToken]);

  return null;
}
