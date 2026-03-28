import React, { useState, useContext, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  ActivityIndicator, RefreshControl, Alert
} from 'react-native';
import * as Contacts from 'expo-contacts';
import { useFocusEffect } from '@react-navigation/native';
import api from '../api/client';
import { AuthContext } from '../context/AuthContext';

// System events — automated structural events
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
  const [memberNameMap, setMemberNameMap] = useState({}); // userId -> display name
  const flatListRef = useRef(null);

  const isAdmin = group?.admin?.id === userInfo?.id;
  const allowTriggers = group?.allowMemberTriggers || false;
  const groupName = group?.groupName || group?.name || 'Group';

  // Load group members + contact names for display
  useEffect(() => {
    (async () => {
      try {
        // 1. Get group members from API
        const membersRes = await api.get(`/groups/members/${group.id}`);
        const members = membersRes.data || [];

        // 2. Load device contacts for phone → contact name mapping
        let phoneToContact = {};
        try {
          const { status } = await Contacts.requestPermissionsAsync();
          if (status === 'granted') {
            const { data } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers] });
            (data || []).forEach(c => {
              (c.phoneNumbers || []).forEach(p => {
                const last10 = (p.number || '').replace(/[\s\-\(\)\+]/g, '').slice(-10);
                if (last10.length >= 10) phoneToContact[last10] = c.name;
              });
            });
          }
        } catch (e) { /* contacts permission denied — use backend names */ }

        // 3. Build userId → displayName map
        const nameMap = {};
        // Add admin
        if (group?.admin) {
          const adminPhone = (group.admin.phoneNumber || '').replace(/\D/g, '').slice(-10);
          nameMap[group.admin.id] = phoneToContact[adminPhone] || group.admin.fullName || group.admin.username;
        }
        // Add members
        members.forEach(m => {
          const mPhone = (m.phoneNumber || '').replace(/\D/g, '').slice(-10);
          nameMap[m.id] = phoneToContact[mPhone] || m.fullName || m.username;
        });

        setMemberNameMap(nameMap);
      } catch (e) {
        console.log('[GroupChat] Member load error:', e.message);
      }
    })();
  }, [group.id]);

  const fetchActivity = useCallback(async () => {
    try {
      const res = await api.get(`/groups/${group.id}/activity`);
      // API returns newest-first — reverse for chronological (oldest top → newest bottom)
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

  // Auto-scroll to bottom when activity loads
  useEffect(() => {
    if (activity.length > 0 && !loading) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 250);
    }
  }, [activity, loading]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchActivity();
  };

  // Get display name for a userId — contact name preferred, "You" for self
  const getDisplayName = (userId) => {
    if (userId === userInfo?.id) return 'You';
    return memberNameMap[userId] || 'Member';
  };

  // Strip user name from message start, e.g. "John took Aspirin" → "took Aspirin"
  const stripNameFromMessage = (message, userId) => {
    if (!message) return '';
    // Try to strip the backend-inserted name from the beginning
    const backendName = memberNameMap[userId];
    if (backendName && message.startsWith(backendName + ' ')) {
      return message.substring(backendName.length + 1);
    }
    // Also try fullName/username from admin
    if (group?.admin?.id === userId) {
      const names = [group.admin.fullName, group.admin.username].filter(Boolean);
      for (const n of names) {
        if (message.startsWith(n + ' ')) return message.substring(n.length + 1);
      }
    }
    return message;
  };

  // Color for each member (consistent by userId)
  const getNameColor = (userId) => {
    const colors = ['#e11d48', '#7c3aed', '#0891b2', '#059669', '#d97706', '#dc2626', '#2563eb', '#9333ea'];
    return colors[(userId || 0) % colors.length];
  };

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

  // Event type → styling
  const getEventStyle = (type) => {
    switch (type) {
      case 'TAKEN':         return { icon: '💊', accent: '#059669' };
      case 'MISSED':        return { icon: '⚠️', accent: '#dc2626' };
      case 'SNOOZED':       return { icon: '⏰', accent: '#d97706' };
      case 'REMINDER_SENT': return { icon: '🔔', accent: '#2563eb' };
      case 'UNDO':          return { icon: '↩️', accent: '#6b7280' };
      default:              return { icon: '📋', accent: '#6b7280' };
    }
  };

  const handleSendReminder = () => {
    Alert.alert(
      '🔔 Send Reminder',
      'Notify all members who haven\'t updated their medicines today.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send',
          onPress: async () => {
            try {
              const membersRes = await api.get(`/groups/members/${group.id}`);
              const targets = (membersRes.data || []).filter(m => m.id !== userInfo.id);
              for (const m of targets) {
                await api.post(`/groups/${group.id}/trigger-reminder`, {
                  triggerUserId: userInfo.id,
                  targetUserId: m.id,
                  scheduleId: null,
                });
              }
              Alert.alert('✅ Sent', `Reminders sent to ${targets.length} member(s).`);
              fetchActivity();
            } catch (e) {
              Alert.alert('Error', 'Failed to send reminders.');
            }
          },
        },
      ]
    );
  };

  const renderActivityItem = ({ item, index }) => {
    const isSystem = SYSTEM_TYPES.includes(item.activityType);
    const isMe = (item.performedByUserId || item.userId) === userInfo?.id;
    const performerId = item.performedByUserId || item.userId;
    const prevItem = index > 0 ? activity[index - 1] : null;

    // Date separator — centered pill like WhatsApp
    const currentDate = getDateLabel(item.timestamp);
    const prevDate = prevItem ? getDateLabel(prevItem.timestamp) : '';
    const showDateSep = currentDate !== prevDate;

    // Show name label if different user from previous bubble
    const prevPerformer = prevItem ? (prevItem.performedByUserId || prevItem.userId) : null;
    const showNameLabel = !isMe && performerId !== prevPerformer;

    if (isSystem) {
      return (
        <View>
          {showDateSep && (
            <View style={styles.dateSep}>
              <Text style={styles.dateText}>{currentDate}</Text>
            </View>
          )}
          <View style={styles.systemRow}>
            <Text style={styles.systemText}>{item.message}</Text>
          </View>
        </View>
      );
    }

    // Chat bubble
    const ev = getEventStyle(item.activityType);
    const displayName = getDisplayName(performerId);
    const cleanMessage = stripNameFromMessage(item.message, performerId);
    const nameColor = getNameColor(performerId);

    return (
      <View>
        {showDateSep && (
          <View style={styles.dateSep}>
            <Text style={styles.dateText}>{currentDate}</Text>
          </View>
        )}
        <View style={[styles.bubbleRow, isMe ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
          {/* Avatar — left side for others */}
          {!isMe && (
            <View style={[styles.avatar, { backgroundColor: nameColor + '20' }]}>
              <Text style={[styles.avatarText, { color: nameColor }]}>
                {displayName[0]?.toUpperCase() || '?'}
              </Text>
            </View>
          )}

          <View style={[styles.bubble, isMe ? styles.bubbleSelf : styles.bubbleOther]}>
            {/* Name label — top of bubble */}
            {isMe ? (
              <Text style={[styles.bubbleName, { color: '#2563eb' }]}>You</Text>
            ) : showNameLabel ? (
              <Text style={[styles.bubbleName, { color: nameColor }]}>{displayName}</Text>
            ) : null}

            {/* Message with event icon */}
            <Text style={styles.bubbleMessage}>
              {ev.icon}  {cleanMessage || item.message}
            </Text>

            {/* Time — bottom right */}
            <Text style={styles.bubbleTime}>{getTimeLabel(item.timestamp)}</Text>
          </View>

          {/* Avatar — right side for self */}
          {isMe && (
            <View style={[styles.avatar, { backgroundColor: '#2563eb20', marginLeft: 6, marginRight: 0 }]}>
              <Text style={[styles.avatarText, { color: '#2563eb' }]}>
                {(userInfo?.fullName || userInfo?.username || 'Y')[0].toUpperCase()}
              </Text>
            </View>
          )}
        </View>
      </View>
    );
  };

  // Header — tappable group name
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
              {group?.memberCount || '—'} members · tap for info
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
        ref={flatListRef}
        data={activity}
        renderItem={renderActivityItem}
        keyExtractor={(item, idx) => item.id || String(idx)}
        contentContainerStyle={[
          styles.listContent,
          activity.length === 0 && { flex: 1 },
        ]}
        showsVerticalScrollIndicator={true}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        onContentSizeChange={() => {
          if (activity.length > 0) {
            flatListRef.current?.scrollToEnd({ animated: false });
          }
        }}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={{ fontSize: 48, marginBottom: 12 }}>📋</Text>
            <Text style={styles.emptyTitle}>No activity yet</Text>
            <Text style={styles.emptyDesc}>
              Medicine sharing, dose tracking, and reminders will appear here
            </Text>
          </View>
        }
      />

      {/* FAB — Send Reminder (admin always, members if allowed) */}
      {(isAdmin || allowTriggers) && (
        <TouchableOpacity style={styles.fab} onPress={handleSendReminder} activeOpacity={0.8}>
          <Text style={styles.fabIcon}>🔔</Text>
          <Text style={styles.fabLabel}>Remind</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#e8edf2' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#e8edf2' },
  listContent: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 100 },

  // Header
  headerTouchable: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerAvatar: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#e0f2fe',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#1e293b' },
  headerSubtitle: { fontSize: 11, color: '#94a3b8' },

  // Date separator — centered pill
  dateSep: { alignItems: 'center', marginVertical: 12 },
  dateText: {
    backgroundColor: '#d1dce8', paddingHorizontal: 14, paddingVertical: 5,
    borderRadius: 16, fontSize: 12, fontWeight: '600', color: '#475569',
    overflow: 'hidden',
  },

  // System messages — centered subtle
  systemRow: { alignItems: 'center', marginVertical: 4, paddingHorizontal: 30 },
  systemText: {
    backgroundColor: '#fffbeb', paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: 10, fontSize: 12, color: '#92400e', textAlign: 'center',
    fontStyle: 'italic', overflow: 'hidden',
  },

  // Bubble row
  bubbleRow: { flexDirection: 'row', marginVertical: 2, alignItems: 'flex-start' },
  bubbleRowLeft: { justifyContent: 'flex-start', paddingRight: 50 },
  bubbleRowRight: { justifyContent: 'flex-end', paddingLeft: 50 },

  // Avatar
  avatar: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 6, marginBottom: 2,
  },
  avatarText: { fontSize: 13, fontWeight: '700' },

  // Bubble
  bubble: {
    maxWidth: '82%', paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 16,
    elevation: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 2,
  },
  bubbleSelf: {
    backgroundColor: '#dbeafe',
    borderBottomRightRadius: 4,
  },
  bubbleOther: {
    backgroundColor: '#fff',
    borderBottomLeftRadius: 4,
  },

  // Name label — top of bubble for others
  bubbleName: {
    fontSize: 13, fontWeight: '700', marginBottom: 2,
  },

  // Message
  bubbleMessage: { fontSize: 14, color: '#1e293b', lineHeight: 20 },

  // Time — bottom right
  bubbleTime: {
    fontSize: 10, color: '#94a3b8', marginTop: 4, textAlign: 'right',
  },

  // FAB
  fab: {
    position: 'absolute', bottom: 75, right: 20,
    backgroundColor: '#2563eb', flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 18, paddingVertical: 12, borderRadius: 28,
    elevation: 6,
    shadowColor: '#2563eb', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35, shadowRadius: 8,
    gap: 6,
  },
  fabIcon: { fontSize: 18 },
  fabLabel: { color: '#fff', fontSize: 14, fontWeight: '700' },

  // Empty state
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#1e293b', marginBottom: 8 },
  emptyDesc: { fontSize: 13, color: '#94a3b8', textAlign: 'center', lineHeight: 20 },
});

export default GroupChatScreen;
