import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CometChat } from '@cometchat/chat-sdk-react-native';
import Messages from '../components/chat/Messages';
import { useTheme } from '../context/ThemeContext';
import { devLog, devWarn, devError, serializeError } from '../utils/devLog';

export type LayoutStackParamList = {
  LayoutMap: undefined;
  PlotDetails: { plotId: string };
  GroupChat: { groupId: string; messageId?: string; searchKeyword?: string };
  SearchMessages: { guid?: string; groupName?: string; uid?: string; userName?: string };
};

type GroupChatRoute = RouteProp<LayoutStackParamList, 'GroupChat'>;

const LOGIN_WAIT_MS = 20000;
const LOGIN_POLL_MS = 400;

async function waitForCometChatLogin(
  label: string,
  cancelled: () => boolean,
): Promise<CometChat.User | null> {
  const deadline = Date.now() + LOGIN_WAIT_MS;
  let attempt = 0;

  while (Date.now() < deadline && !cancelled()) {
    attempt += 1;
    try {
      const user = await CometChat.getLoggedinUser();
      if (user) {
        devLog('GroupChat', `${label}: logged in as`, user.getUid(), `(attempt ${attempt})`);
        return user;
      }
    } catch (e) {
      devWarn('GroupChat', `${label}: getLoggedinUser attempt ${attempt}`, serializeError(e));
    }

    if (__DEV__) {
      devLog('GroupChat', `${label}: no CC user yet, waiting...`, { attempt, pollMs: LOGIN_POLL_MS });
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, LOGIN_POLL_MS);
    });
  }

  return null;
}

function typeIsPublic(t: string | undefined): boolean {
  return String(t ?? '').toLowerCase() === 'public';
}

/**
 * Load group; if user is not a member and the group is public, join via SDK (CometChat.joinGroup).
 */
async function resolveGroupForChat(guid: string): Promise<CometChat.Group> {
  let group: CometChat.Group;

  try {
    group = await CometChat.getGroup(guid);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === 'ERR_NOT_A_MEMBER') {
      devWarn('GroupChat', 'getGroup: not a member — trying joinGroup as public', { guid });
      group = await CometChat.joinGroup(guid, 'public', '');
      return group;
    }
    throw err;
  }

  if (group.getHasJoined()) {
    devLog('GroupChat', 'already a member', { guid });
    return group;
  }

  if (typeIsPublic(group.getType())) {
    devLog('GroupChat', 'joinGroup (public)', { guid, type: group.getType() });
    return CometChat.joinGroup(group.getGuid(), group.getType(), '');
  }

  if (String(group.getType()).toLowerCase() === 'password') {
    throw new Error('This group requires a password to join.');
  }

  throw new Error(
    `Cannot join this group automatically (type: ${group.getType()}). Use a public community group or invite members.`,
  );
}

export default function GroupChatScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<LayoutStackParamList>>();
  const route = useRoute<GroupChatRoute>();
  const { groupId, messageId, searchKeyword } = route.params;
  const { colors } = useTheme();
  const styles = React.useMemo(() => getStyles(colors), [colors]);

  const [group, setGroup] = useState<CometChat.Group | undefined>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    devLog('GroupChat', 'screen mounted', { groupId, params: route.params });

    if (!groupId?.trim()) {
      devWarn('GroupChat', 'missing groupId');
      setError('Missing group ID');
      return;
    }

    const guid = groupId.trim();
    let cancelled = false;

    (async () => {
      try {
        const ccUser = await waitForCometChatLogin(`waitForLogin[${guid}]`, () => cancelled);
        if (cancelled) {
          return;
        }

        if (!ccUser) {
          devError('GroupChat', 'CometChat still not logged in after wait', {
            guid,
            waitedMs: LOGIN_WAIT_MS,
            hint: 'PlotVista session OK but CometChatUIKit.login may have failed — check CometChatSession logs',
          });
          setError(
            'Chat login is still starting. Close and reopen chat, or ensure you are logged in and try again.',
          );
          return;
        }

        devLog('GroupChat', 'resolving group (getGroup / joinGroup if public)', {
          guid,
          uid: ccUser.getUid(),
        });

        const g = await resolveGroupForChat(guid);

        if (cancelled) {
          return;
        }

        devLog('GroupChat', 'ready', { guid, name: g?.getName?.(), hasJoined: g?.getHasJoined?.() });
        setGroup(g);
      } catch (e: unknown) {
        const serialized = serializeError(e);
        devError('GroupChat', 'group FAILED', { guid, ...serialized });

        const message =
          typeof (e as { message?: string })?.message === 'string'
            ? (e as { message: string }).message
            : 'Could not open group';

        if (!cancelled) {
          setError(
            __DEV__
              ? `${message}\n\n(guid: ${guid})\nCheck Metro logs for [PlotVista:GroupChat].`
              : message,
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [groupId]);

  if (error) {
    return (
      <SafeAreaView style={styles.centered} edges={['top']}>
        <Text style={styles.errorText}>{error}</Text>
      </SafeAreaView>
    );
  }

  if (!group) {
    return (
      <SafeAreaView style={styles.centered} edges={['top']}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.hintText}>Loading chat…</Text>
      </SafeAreaView>
    );
  }

  return (
    <Messages
      group={group}
      messageId={messageId}
      searchKeyword={searchKeyword}
      onBack={() => navigation.goBack()}
    />
  );
}

function getStyles(colors: { background: string; text: string; textSecondary?: string }) {
  return StyleSheet.create({
    centered: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.background,
      padding: 24,
    },
    errorText: {
      color: colors.text,
      textAlign: 'center',
    },
    hintText: {
      marginTop: 12,
      fontSize: 13,
      color: colors.textSecondary ?? '#64748b',
    },
  });
}
