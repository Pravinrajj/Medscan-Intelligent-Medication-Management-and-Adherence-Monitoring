import React, { useState, useContext, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  ActivityIndicator, RefreshControl, Alert
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import api from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { colors, fonts, spacing, radii, shadows, typography } from '../theme';
const MemberActivityScreen = ({ route, navigation }) => {
  const { userInfo } = useContext(AuthContext);
  const { member, group } = route.params || {};
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const isAdmin = group?.admin?.id === userInfo?.id;
  // Use contactName passed from GroupDetailsScreen (already resolved)
  const memberName = route.params?.contactName || member?.fullName || member?.username || 'Member';

  // Update header title to match the resolved contact name
  useEffect(() => {
    navigation.setOptions({ title: memberName });
  }, [memberName, navigation]);

  const fetchActivity = useCallback(async () => {
    try {
      const res = await api.get(`/groups/${group.id}/activity`);
      // Filter to only this member's activities
      const memberActivities = (res.data || [])
        .filter(a => a.userId === member.id)
        .reverse(); // newest at bottom
      setActivity(memberActivities);
    } catch (e) {
      console.error('[MemberActivity] Fetch error:', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [group.id, member.id]);

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

  const handleSendReminder = () => {
    Alert.alert(
      'Send Reminder',
      `Send a medication reminder to ${memberName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send',
          onPress: async () => {
            try {
              await api.post(`/groups/${group.id}/trigger-reminder`, {
                triggerUserId: userInfo.id,
                targetUserId: member.id,
                scheduleId: null,
              });
              Alert.alert('Sent', `Reminder sent to ${memberName}`);
            } catch (e) {
              Alert.alert('Error', 'Failed to send reminder.');
            }
          },
        },
      ]
    );
  };

  const handleRemoveMember = () => {
    Alert.alert(
      'Remove Member',
      `Remove ${memberName} from the group?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/groups/${group.id}/remove-member?adminId=${userInfo.id}&userId=${member.id}`);
              Alert.alert('Removed', `${memberName} has been removed.`);
              navigation.goBack();
            } catch (e) {
              Alert.alert('Error', 'Failed to remove member.');
            }
          },
        },
      ]
    );
  };

  const getTimeLabel = (timestamp) => {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getDateLabel = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  };

  const getEventStyle = (type) => {
    switch (type) {
      case 'TAKEN': return { iconName: 'check', color: colors.success, bg: colors.successLight };
      case 'MISSED': return { iconName: 'close', color: colors.danger, bg: colors.dangerLight };
      case 'SNOOZED': return { iconName: 'clock-outline', color: colors.warning, bg: colors.warningLight };
      case 'REMINDER_SENT': return { iconName: 'bell-ring-outline', color: colors.primary, bg: colors.primaryBg };
      case 'UNDO': return { iconName: 'undo', color: colors.textTertiary, bg: colors.surfaceHover };
      default: return { iconName: 'circle-small', color: colors.textSecondary, bg: colors.surfaceHover };
    }
  };

  const renderItem = ({ item, index }) => {
    const evStyle = getEventStyle(item.activityType);
    const prevItem = index > 0 ? activity[index - 1] : null;
    const currentDate = getDateLabel(item.timestamp);
    const prevDate = prevItem ? getDateLabel(prevItem.timestamp) : '';
    const showDate = currentDate !== prevDate;

    return (
      <View>
        {showDate && (
          <View style={styles.dateSep}>
            <Text style={styles.dateSepText}>{currentDate}</Text>
          </View>
        )}
        <View style={[styles.activityCard, { backgroundColor: evStyle.bg, borderLeftColor: evStyle.color }]}>
          <MaterialCommunityIcons name={evStyle.iconName} size={18} color={evStyle.color} style={{marginRight: 10}} />
          <View style={{ flex: 1 }}>
            <Text style={styles.activityMsg}>{item.message}</Text>
            <Text style={styles.activityTime}>{getTimeLabel(item.timestamp)}</Text>
          </View>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Member Header */}
      <View style={styles.memberHeader}>
        <View style={styles.memberAvatar}>
          <Text style={styles.memberAvatarText}>{memberName[0].toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.memberNameText}>{memberName}</Text>
          <Text style={styles.memberPhoneText}>{member?.phoneNumber || '—'}</Text>
        </View>
      </View>

      {/* Quick Actions */}
      <View style={styles.actionsRow}>
        {isAdmin && (
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => navigation.navigate('AddMedicineForMember', {
              targetUserId: member.id,
              targetUserName: memberName,
            })}
          >
            <MaterialCommunityIcons name="clipboard-text-outline" size={20} color={colors.primary} />
            <Text style={styles.actionBtnLabel}>Add Medicine</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={[styles.actionBtn, { borderColor: '#27ae60' }]} onPress={handleSendReminder}>
          <MaterialCommunityIcons name="bell-ring-outline" size={20} color="#27ae60" />
          <Text style={[styles.actionBtnLabel, { color: '#27ae60' }]}>Send Reminder</Text>
        </TouchableOpacity>
        {isAdmin && (
          <TouchableOpacity style={[styles.actionBtn, { borderColor: '#e74c3c' }]} onPress={handleRemoveMember}>
            <Text style={styles.actionBtnIcon}>✗</Text>
            <Text style={[styles.actionBtnLabel, { color: '#e74c3c' }]}>Remove</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Activity Feed */}
      <Text style={styles.sectionTitle}>Activity</Text>
      <FlatList
        data={activity}
        renderItem={renderItem}
        keyExtractor={(item, idx) => item.id || String(idx)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <MaterialCommunityIcons name="clipboard-text-outline" size={36} color="#94a3b8" style={{ marginBottom: 8 }} />
            <Text style={styles.emptyText}>No activity from {memberName} yet</Text>
          </View>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  memberHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.lg + 2,
    backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.borderLight,
  },
  memberAvatar: {
    width: 50, height: 50, borderRadius: 25, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  memberAvatarText: { color: colors.textInverse, fontSize: 20, fontFamily: fonts.bold },
  memberNameText: { fontSize: 18, fontFamily: fonts.bold, color: colors.text },
  memberPhoneText: { fontSize: 13, fontFamily: fonts.regular, color: colors.textTertiary, marginTop: 2 },

  actionsRow: {
    flexDirection: 'row', gap: spacing.sm + 2,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.borderLight,
  },
  actionBtn: {
    flex: 1, alignItems: 'center', paddingVertical: spacing.sm + 2, borderRadius: radii.md,
    backgroundColor: colors.primaryBg,
  },
  actionBtnIcon: { fontSize: 18, marginBottom: 3 },
  actionBtnLabel: { fontSize: 11, fontFamily: fonts.semiBold, color: colors.primary },

  sectionTitle: { ...typography.sectionLabel, marginTop: spacing.lg, marginBottom: spacing.sm, marginLeft: spacing.xl },

  dateSep: { alignItems: 'center', marginVertical: spacing.sm },
  dateSepText: {
    backgroundColor: colors.surfaceHover, paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    borderRadius: radii.sm, fontSize: 11, fontFamily: fonts.semiBold, color: colors.textSecondary, overflow: 'hidden',
  },

  activityCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm + 2,
    padding: spacing.md, borderRadius: radii.md, marginBottom: spacing.xs + 2,
    borderLeftWidth: 3,
  },
  activityIcon: { fontSize: 16, fontFamily: fonts.bold, marginTop: 1 },
  activityMsg: { fontSize: 13, fontFamily: fonts.regular, color: colors.text, lineHeight: 18 },
  activityTime: { fontSize: 10, fontFamily: fonts.medium, color: colors.textTertiary, marginTop: 3 },

  emptyBox: { alignItems: 'center', paddingTop: 50 },
  emptyText: { fontSize: 14, fontFamily: fonts.regular, color: colors.textTertiary },
});

export default MemberActivityScreen;
