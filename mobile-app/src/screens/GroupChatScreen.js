import React, { useState, useContext, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  ActivityIndicator, RefreshControl
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import api from '../api/client';
import { AuthContext } from '../context/AuthContext';

// Activity types that are system/centered events
const SYSTEM_TYPES = [
  'GROUP_CREATED', 'MEMBER_ADDED', 'MEMBER_LEFT', 'MEMBER_REMOVED',
  'GROUP_DELETED', 'SCHEDULES_SHARED', 'SETTINGS_CHANGED',
];

const GroupChatScreen = ({ route, navigation }) => {
  const { userInfo } = useContext(AuthContext);
  const group = route.params?.group;
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const isAdmin = group?.admin?.id === userInfo?.id;
  const groupName = group?.groupName || group?.name || 'Group';

  const fetchActivity = useCallback(async () => {
    try {
      const res = await api.get(`/groups/${group.id}/activity`);
      // Reverse so newest is at bottom (like a chat)
      setActivity((res.data || []).reverse());
    } catch (e) {
      console.error('[GroupChat] Fetch error:', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [group.id]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchActivity();
    }, [fetchActivity])
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchActivity();
  };

  // Group activities by date for date separators
  const getDateLabel = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const getTimeLabel = (timestamp) => {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Get initials for avatar
  const getInitial = (message) => {
    if (!message) return '?';
    return message.charAt(0).toUpperCase();
  };

  // Determine event styling
  const getEventInfo = (type) => {
    switch (type) {
      case 'TAKEN': return { icon: '✓', color: '#27ae60', bg: '#e8f8f0' };
      case 'MISSED': return { icon: '✗', color: '#e74c3c', bg: '#fef2f2' };
      case 'SNOOZED': return { icon: '⏰', color: '#f39c12', bg: '#fef9e7' };
      case 'REMINDER_SENT': return { icon: '🔔', color: '#3498db', bg: '#eef6fc' };
      case 'UNDO': return { icon: '↩', color: '#95a5a6', bg: '#f4f6f7' };
      default: return { icon: '•', color: '#7f8c8d', bg: '#f8f9fa' };
    }
  };

  const renderActivityItem = ({ item, index }) => {
    const isSystem = SYSTEM_TYPES.includes(item.activityType);
    const isMe = item.userId === userInfo?.id;
    const prevItem = index > 0 ? activity[index - 1] : null;

    // Date separator
    const currentDate = getDateLabel(item.timestamp);
    const prevDate = prevItem ? getDateLabel(prevItem.timestamp) : '';
    const showDateSep = currentDate !== prevDate;

    if (isSystem) {
      // Centered system message (like WhatsApp date/system messages)
      return (
        <View>
          {showDateSep && (
            <View style={styles.dateSeparator}>
              <Text style={styles.dateSeparatorText}>{currentDate}</Text>
            </View>
          )}
          <View style={styles.systemMessage}>
            <Text style={styles.systemMessageText}>{item.message}</Text>
            <Text style={styles.systemTime}>{getTimeLabel(item.timestamp)}</Text>
          </View>
        </View>
      );
    }

    // Chat bubble — left for others, right for self
    const eventInfo = getEventInfo(item.activityType);
    return (
      <View>
        {showDateSep && (
          <View style={styles.dateSeparator}>
            <Text style={styles.dateSeparatorText}>{currentDate}</Text>
          </View>
        )}
        <View style={[styles.bubbleRow, isMe ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
          {!isMe && (
            <View style={[styles.bubbleAvatar, { backgroundColor: eventInfo.color }]}>
              <Text style={styles.bubbleAvatarText}>{getInitial(item.message)}</Text>
            </View>
          )}
          <View style={[
            styles.bubble,
            { backgroundColor: eventInfo.bg },
            isMe ? styles.bubbleRight : styles.bubbleLeft,
          ]}>
            <Text style={[styles.bubbleText, { color: eventInfo.color }]}>
              {eventInfo.icon} {item.message}
            </Text>
            <Text style={styles.bubbleTime}>{getTimeLabel(item.timestamp)}</Text>
          </View>
        </View>
      </View>
    );
  };

  // Header — tappable group name that navigates to GroupDetailsScreen
  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <TouchableOpacity
          onPress={() => navigation.navigate('GroupDetails', { group })}
          style={styles.headerTouchable}
        >
          <View style={styles.headerAvatar}>
            <Text style={{ fontSize: 16 }}>👥</Text>
          </View>
          <View>
            <Text style={styles.headerTitle}>{groupName}</Text>
            <Text style={styles.headerSubtitle}>
              {group?.memberCount || '—'} members · tap for details
            </Text>
          </View>
        </TouchableOpacity>
      ),
    });
  }, [navigation, group, groupName]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#3498db" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={activity}
        renderItem={renderActivityItem}
        keyExtractor={(item, idx) => item.id || String(idx)}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={{ fontSize: 48, marginBottom: 12 }}>💬</Text>
            <Text style={styles.emptyTitle}>No activity yet</Text>
            <Text style={styles.emptyDesc}>
              Group actions like medicine sharing, dose tracking, and reminders will appear here
            </Text>
          </View>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ece5dd' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#ece5dd' },
  listContent: { paddingHorizontal: 12, paddingVertical: 8 },

  // Header
  headerTouchable: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerAvatar: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#d5e8d4',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#2c3e50' },
  headerSubtitle: { fontSize: 11, color: '#95a5a6' },

  // Date separator
  dateSeparator: { alignItems: 'center', marginVertical: 10 },
  dateSeparatorText: {
    backgroundColor: '#d4e4f7', paddingHorizontal: 14, paddingVertical: 5,
    borderRadius: 12, fontSize: 11, fontWeight: '600', color: '#34495e',
    overflow: 'hidden',
  },

  // System messages (centered)
  systemMessage: { alignItems: 'center', marginVertical: 4, paddingHorizontal: 20 },
  systemMessageText: {
    backgroundColor: '#fdf2ce', paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 8, fontSize: 12, color: '#5f6368', textAlign: 'center',
    fontStyle: 'italic', overflow: 'hidden',
  },
  systemTime: { fontSize: 10, color: '#bdc3c7', marginTop: 2 },

  // Bubble rows
  bubbleRow: { flexDirection: 'row', marginVertical: 3 },
  bubbleRowLeft: { justifyContent: 'flex-start' },
  bubbleRowRight: { justifyContent: 'flex-end' },

  bubbleAvatar: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', marginRight: 6, marginTop: 2,
  },
  bubbleAvatarText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  bubble: {
    maxWidth: '75%', paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 14, elevation: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08, shadowRadius: 2,
  },
  bubbleLeft: { borderTopLeftRadius: 4 },
  bubbleRight: { borderTopRightRadius: 4 },
  bubbleText: { fontSize: 13, fontWeight: '500', lineHeight: 18 },
  bubbleTime: { fontSize: 10, color: '#95a5a6', marginTop: 4, textAlign: 'right' },

  // Empty state
  emptyContainer: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#2c3e50', marginBottom: 8 },
  emptyDesc: { fontSize: 13, color: '#95a5a6', textAlign: 'center', lineHeight: 20 },
});

export default GroupChatScreen;
