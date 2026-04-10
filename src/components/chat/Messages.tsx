import React, { useState } from 'react';
import {
  View, StyleSheet, TouchableOpacity, Modal,
  Text, Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MaterialIcon from 'react-native-vector-icons/MaterialIcons';
import {
  CometChatMessageHeader,
  CometChatMessageList,
  CometChatMessageComposer,
  CometChatGroupMembers,
} from '@cometchat/chat-uikit-react-native';
import { CometChat } from '@cometchat/chat-sdk-react-native';

export interface MessagesProps {
  user?: CometChat.User;
  group?: CometChat.Group;
  messageId?: string;
  searchKeyword?: string;
  onBack: () => void;
}

export default function Messages({ user, group, messageId, searchKeyword, onBack }: MessagesProps) {
  const [showMembers, setShowMembers] = useState(false);
  const navigation = useNavigation<any>();

  const handleSearchPress = () => {
    navigation.navigate('SearchMessages', {
      guid: group?.getGuid?.(),
      groupName: group?.getName?.(),
      uid: user?.getUid?.(),
      userName: user?.getName?.(),
    });
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.container}>

        {/* Tapping the header opens the group members sheet */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => group && setShowMembers(true)}
          disabled={!group}
          accessibilityRole="button"
          accessibilityLabel="View group members"
        >
          <CometChatMessageHeader
            user={user}
            group={group}
            onBack={onBack}
            showBackButton
            TrailingView={() => (
              <TouchableOpacity
                onPress={handleSearchPress}
                style={styles.searchBtn}
                accessibilityRole="button"
                accessibilityLabel="Search messages"
              >
                <MaterialIcon name="search" size={20} color="#ffffff" />
              </TouchableOpacity>
            )}
          />
        </TouchableOpacity>

        <CometChatMessageList
          user={user}
          group={group}
          goToMessageId={messageId}
          searchKeyword={searchKeyword}
        />
        <CometChatMessageComposer user={user} group={group} />
      </View>

      {/* Group members slide-up modal */}
      {group && (
        <Modal
          visible={showMembers}
          animationType="slide"
          transparent
          onRequestClose={() => setShowMembers(false)}
          statusBarTranslucent={Platform.OS === 'android'}
        >
          <View style={styles.modalOverlay}>
            <TouchableOpacity
              style={styles.modalBackdrop}
              activeOpacity={1}
              onPress={() => setShowMembers(false)}
            />
            <SafeAreaView style={styles.sheet} edges={['bottom']}>
              {/* Sheet handle + header */}
              <View style={styles.sheetHeader}>
                <View style={styles.sheetHandle} />
                <Text style={styles.sheetTitle}>Group Members</Text>
                <TouchableOpacity
                  onPress={() => setShowMembers(false)}
                  style={styles.closeBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                >
                  <Text style={styles.closeBtnText}>✕</Text>
                </TouchableOpacity>
              </View>

              <CometChatGroupMembers group={group} />
            </SafeAreaView>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const SHEET_HEIGHT = '75%';

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    height: SHEET_HEIGHT,
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
  },
  sheetHandle: {
    position: 'absolute',
    top: 8,
    alignSelf: 'center',
    left: '50%',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#cbd5e1',
  },
  sheetTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  closeBtn: {
    padding: 4,
  },
  closeBtnText: {
    fontSize: 16,
    color: '#64748b',
    fontWeight: '600',
  },
  searchBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
    backgroundColor: '#2563eb',
  },
  searchBtnText: {
    fontSize: 19,
    fontWeight: '700',
    color: '#0f172a',
  },
});
