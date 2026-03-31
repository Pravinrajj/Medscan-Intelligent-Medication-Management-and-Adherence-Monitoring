import React, { useState, useContext, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  ActivityIndicator, RefreshControl, Alert
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Contacts from 'expo-contacts';
import { useFocusEffect } from '@react-navigation/native';
import api from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { colors, fonts, spacing, radii, shadows } from '../theme';

// System events — automated structural events
const SYSTEM_TYPES = [
  'GROUP_CREATED', 'MEMBER_ADDED', 'MEMBER_LEFT', 'MEMBER_REMOVED',
  'GROUP_DELETED', 'SCHEDULES_SHARED', 'SETTINGS_CHANGED',
];

// Color palette for member names
const NAME_COLORS = ['#E11D48', '#7C3AED', '#0891B2', '#059669', '#D97706', '#DC2626', '#2563EB', '#9333EA'];

const GroupChatScreen = ({ route, navigation }) => {
  const { userInfo } = useContext(AuthContext);
  const toast = useToast();
  const group = route.params?.group;
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [memberNameMap, setMemberNameMap] = useState({});
  const flatListRef = useRef(null);

  const isAdmin = group?.admin?.id === userInfo?.id;
  const allowTriggers = group?.allowMemberTriggers || false;
  const groupName = group?.groupName || group?.name || 'Group';

  // Load group members + contact names
  useEffect(() => {
    (async () => {
      try {
        const membersRes = await api.get(`/groups/members/${group.id}`);
        const members = membersRes.data || [];

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
        } catch (e) { /* contacts permission denied */ }

        const nameMap = {};
        if (group?.admin) {
          const adminPhone = (group.admin.phoneNumber || '').replace(/\D/g, '').slice(-10);
          nameMap[group.admin.id] = phoneToContact[adminPhone] || group.admin.fullName || group.admin.username;
        }
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

  useEffect(() => {
    if (activity.length > 0 && !loading) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 250);
    }
  }, [activity, loading]);

  const onRefresh = () => { setRefreshing(true); fetchActivity(); };

  const getDisplayName = (userId) => {
    if (userId === userInfo?.id) return 'You';
    return memberNameMap[userId] || 'Member';
  };

  const stripNameFromMessage = (message, userId) => {
    if (!message) return '';
    let cleaned = message;
    const backendName = memberNameMap[userId];
    if (backendName && cleaned.startsWith(backendName + ' ')) {
      cleaned = cleaned.substring(backendName.length + 1);
    }
    if (group?.admin?.id === userId) {
      const names = [group.admin.fullName, group.admin.username].filter(Boolean);
      for (const n of names) {
        if (cleaned.startsWith(n + ' ')) {
          cleaned = cleaned.substring(n.length + 1);
          break;
        }
      }
    }
    // If stripping made it empty, return original message
    return cleaned.trim() || message;
  };

  const getNameColor = (userId) => NAME_COLORS[(userId || 0) % NAME_COLORS.length];

  const getDateLabel = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const getTimeLabel = (timestamp) => {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getEventStyle = (type) => {
    switch (type) {
      case 'TAKEN':         return { icon: 'check-circle-outline', accent: colors.taken };
      case 'MISSED':        return { icon: 'alert-circle-outline', accent: colors.missed };
      case 'SNOOZED':       return { icon: 'clock-outline', accent: colors.snoozed };
      case 'REMINDER_SENT': return { icon: 'bell-ring-outline', accent: colors.primary };
      case 'UNDO':          return { icon: 'undo', accent: colors.textTertiary };
      default:              return { icon: 'clipboard-text-outline', accent: colors.textTertiary };
    }
  };

  const handleSendReminder = () => {
    Alert.alert(
      'Send Reminder',
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
              toast.success(`Reminders sent to ${targets.length} member(s).`);
              fetchActivity();
            } catch (e) {
              toast.error('Failed to send reminders.');
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

    const currentDate = getDateLabel(item.timestamp);
    const prevDate = prevItem ? getDateLabel(prevItem.timestamp) : '';
    const showDateSep = currentDate !== prevDate;

    const prevPerformer = prevItem ? (prevItem.performedByUserId || prevItem.userId) : null;
    const showNameLabel = performerId !== prevPerformer || showDateSep;

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
          {!isMe && (
            <View style={[styles.avatar, { backgroundColor: nameColor + '18' }]}>
              <Text style={[styles.avatarText, { color: nameColor }]}>
                {displayName[0]?.toUpperCase() || '?'}
              </Text>
            </View>
          )}

          <View style={[styles.bubble, isMe ? styles.bubbleSelf : styles.bubbleOther]}>
            {isMe && showNameLabel ? (
              <Text style={[styles.bubbleName, { color: colors.primary }]}>You</Text>
            ) : !isMe && showNameLabel ? (
              <Text style={[styles.bubbleName, { color: nameColor }]}>{displayName}</Text>
            ) : null}

            <View style={styles.messageRow}>
              <View style={[styles.eventDot, { backgroundColor: ev.accent }]}>
                <MaterialCommunityIcons name={ev.icon} size={10} color={colors.textInverse} />
              </View>
              <Text style={styles.bubbleMessage}>{cleanMessage || item.message || item.activityType}</Text>
            </View>

            <Text style={styles.bubbleTime}>{getTimeLabel(item.timestamp)}</Text>
          </View>

          {isMe && (
            <View style={[styles.avatar, { backgroundColor: colors.primary + '18', marginLeft: 6, marginRight: 0 }]}>
              <Text style={[styles.avatarText, { color: colors.primary }]}>
                {(userInfo?.fullName || userInfo?.username || 'Y')[0].toUpperCase()}
              </Text>
            </View>
          )}
        </View>
      </View>
    );
  };

  // Header
  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <TouchableOpacity
          onPress={() => navigation.navigate('GroupDetails', { group })}
          style={styles.headerTouchable}
        >
          <View style={styles.headerAvatar}>
            <MaterialCommunityIcons name="account-group" size={16} color={colors.primary} />
          </View>
          <View>
            <Text style={styles.headerTitle}>{groupName}</Text>
            <Text style={styles.headerSubtitle}>
              {group?.memberCount || '—'} members
            </Text>
          </View>
        </TouchableOpacity>
      ),
    });
  }, [navigation, group, groupName]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
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
        contentContainerStyle={[styles.listContent, activity.length === 0 && { flex: 1 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
        onContentSizeChange={() => {
          if (activity.length > 0) flatListRef.current?.scrollToEnd({ animated: false });
        }}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <MaterialCommunityIcons name="clipboard-text-outline" size={48} color={colors.textTertiary} />
            <Text style={styles.emptyTitle}>No activity yet</Text>
            <Text style={styles.emptyDesc}>
              Medicine sharing, dose tracking, and reminders will appear here
            </Text>
          </View>
        }
      />

      {/* FAB — Send Reminder */}
      {(isAdmin || allowTriggers) && (
        <TouchableOpacity style={styles.fab} onPress={handleSendReminder} activeOpacity={0.8}>
          <MaterialCommunityIcons name="bell-ring" size={18} color={colors.textInverse} />
          <Text style={styles.fabLabel}>Remind</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  listContent: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: 100 },

  // Header
  headerTouchable: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerAvatar: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primaryBg,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 16, fontFamily: fonts.bold, color: colors.text },
  headerSubtitle: { fontSize: 11, fontFamily: fonts.regular, color: colors.textTertiary },

  // Date separator
  dateSep: { alignItems: 'center', marginVertical: spacing.md },
  dateText: {
    backgroundColor: colors.surfaceHover, paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    borderRadius: radii.full, fontSize: 12, fontFamily: fonts.semiBold, color: colors.textSecondary,
    overflow: 'hidden',
  },

  // System messages
  systemRow: { alignItems: 'center', marginVertical: spacing.xs, paddingHorizontal: spacing.xxl },
  systemText: {
    backgroundColor: colors.warningLight, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2,
    borderRadius: radii.sm, fontSize: 12, fontFamily: fonts.medium, color: colors.warningDark,
    textAlign: 'center', fontStyle: 'italic', overflow: 'hidden',
  },

  // Bubble row
  bubbleRow: { flexDirection: 'row', marginVertical: 2, alignItems: 'flex-end' },
  bubbleRowLeft: { justifyContent: 'flex-start', paddingRight: 50 },
  bubbleRowRight: { justifyContent: 'flex-end', paddingLeft: 50 },

  // Avatar
  avatar: {
    width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 4,
  },
  avatarText: { fontSize: 10, fontFamily: fonts.bold },

  // Bubble
  bubble: {
    paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs + 2,
    borderRadius: radii.md,
    ...shadows.sm,
  },
  bubbleSelf: {
    backgroundColor: colors.primaryBg,
    borderBottomRightRadius: radii.xs,
  },
  bubbleOther: {
    backgroundColor: colors.surface,
    borderBottomLeftRadius: radii.xs,
  },

  bubbleName: { fontSize: 11, fontFamily: fonts.bold, marginBottom: 1 },

  messageRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 60 },
  eventDot: {
    width: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
  },
  bubbleMessage: { fontSize: 13, fontFamily: fonts.regular, color: colors.text, lineHeight: 18, flexShrink: 1 },
  bubbleTime: {
    fontSize: 9, fontFamily: fonts.regular, color: colors.textTertiary, marginTop: 2, textAlign: 'right',
  },

  // FAB
  fab: {
    position: 'absolute', bottom: 80, right: spacing.xl,
    backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radii.full,
    ...shadows.colored(colors.primary),
    gap: spacing.sm,
  },
  fabLabel: { color: colors.textInverse, fontSize: 14, fontFamily: fonts.bold },

  // Empty state
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xxl },
  emptyTitle: { fontSize: 18, fontFamily: fonts.bold, color: colors.text, marginTop: spacing.md, marginBottom: spacing.sm },
  emptyDesc: { fontSize: 13, fontFamily: fonts.regular, color: colors.textTertiary, textAlign: 'center', lineHeight: 20 },
});

export default GroupChatScreen;
