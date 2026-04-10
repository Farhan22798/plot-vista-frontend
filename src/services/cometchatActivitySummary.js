import { CometChat } from '@cometchat/chat-sdk-react-native';
import { getCometChatNotificationGroupId } from '../config/cometchatSettings';
import { devError, devLog, serializeError } from '../utils/devLog';

export async function sendActivitySummaryMessage(text) {
  const body = String(text || '').trim();
  if (!body) return;

  try {
    const loggedIn = await CometChat.getLoggedinUser();
    if (!loggedIn) return;

    const groupId = getCometChatNotificationGroupId();
    if (!groupId) return;

    const message = new CometChat.TextMessage(
      groupId,
      body,
      CometChat.RECEIVER_TYPE.GROUP,
    );
    await CometChat.sendMessage(message);
    devLog('CometChatActivitySummary', 'sent to notification group', { groupId });
  } catch (error) {
    devError(
      'CometChatActivitySummary',
      'failed to send activity message',
      serializeError(error),
    );
  }
}
