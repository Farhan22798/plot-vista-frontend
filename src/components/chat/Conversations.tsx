import React from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { CometChatConversations } from '@cometchat/chat-uikit-react-native';
import { CometChat } from '@cometchat/chat-sdk-react-native';

export interface ConversationsProps {
  onItemPress: (conversation: CometChat.Conversation) => void;
  containerStyle?: StyleProp<ViewStyle>;
  /** When false, the list is not rendered (e.g. while a thread is full screen). */
  visible?: boolean;
}

/**
 * Conversation list from CometChat UI Kit. Use when you want inbox-style navigation;
 * for a single group, prefer navigating to {@link Messages} / GroupChatScreen with a group id.
 */
export default function Conversations({
  onItemPress,
  containerStyle,
  visible = true,
}: ConversationsProps) {
  if (!visible) {
    return null;
  }

  return (
    <CometChatConversations
      onItemPress={onItemPress}
      style={{
        containerStyle: StyleSheet.flatten([{ flex: 1 }, containerStyle]),
      }}
    />
  );
}
