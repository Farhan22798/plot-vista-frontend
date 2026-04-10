import React, { useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { CometChat } from '@cometchat/chat-sdk-react-native';
import { CometChatSearch } from '@cometchat/chat-uikit-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../context/ThemeContext';

type SearchParams = {
  guid?: string;
  groupName?: string;
  uid?: string;
  userName?: string;
};

export default function SearchMessagesScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const route = useRoute<any>();
  const { guid, groupName, uid, userName } = (route.params || {}) as SearchParams;

  const handleBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const handleConversationClicked = useCallback(
    (conversation: CometChat.Conversation, searchKeyword?: string) => {
      const withTarget = conversation.getConversationWith();
      if (withTarget instanceof CometChat.Group) {
        navigation.navigate('GroupChat', {
          groupId: withTarget.getGuid(),
          searchKeyword,
        });
      }
    },
    [navigation],
  );

  const handleMessageClicked = useCallback(
    async (message: CometChat.BaseMessage, searchKeyword?: string) => {
      const receiver = message.getReceiver();
      if (receiver instanceof CometChat.Group) {
        navigation.navigate('GroupChat', {
          groupId: receiver.getGuid(),
          messageId: String(message.getId()),
          searchKeyword,
        });
      }
    },
    [navigation],
  );

  const searchPlaceholder = groupName
    ? `Search in ${groupName}`
    : userName
      ? `Search in ${userName}`
      : 'Search';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
      <CometChatSearch
        onBack={handleBack}
        hideBackButton={false}
        onConversationClicked={handleConversationClicked}
        onMessageClicked={handleMessageClicked}
        uid={uid}
        guid={guid}
        searchPlaceholder={searchPlaceholder}
        messagesRequestBuilder={new CometChat.MessagesRequestBuilder().setLimit(30)}
        conversationsRequestBuilder={new CometChat.ConversationsRequestBuilder().setLimit(30)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

