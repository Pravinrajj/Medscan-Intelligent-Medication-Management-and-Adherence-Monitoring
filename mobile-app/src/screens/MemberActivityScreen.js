import React, { useState, useContext, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  ActivityIndicator, RefreshControl, Alert
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import api from '../api/client';
import { AuthContext } from '../context/AuthContext';

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
      case 'TAKEN': return { icon: '✓', color: '#27ae60', bg: '#e8f8f0' };
      case 'MISSED': return { icon: '✗', color: '#e74c3c', bg: '#fef2f2' };
      case 'SNOOZED': return { icon: '⏰', color: '#f39c12', bg: '#fef9e7' };
      case 'REMINDER_SENT': return { icon: '🔔', color: '#3498db', bg: '#eef6fc' };
      case 'UNDO': return { icon: '↩', color: '#95a5a6', bg: '#f4f6f7' };
      default: return { icon: '•', color: '#7f8c8d', bg: '#f8f9fa' };
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
          <Text style={[styles.activityIcon, { color: evStyle.color }]}>{evStyle.icon}</Text>
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
        <ActivityIndicator size="large" color="#3498db" />
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
            <Text style={styles.actionBtnIcon}>📋</Text>
            <Text style={styles.actionBtnLabel}>Add Medicine</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={[styles.actionBtn, { borderColor: '#27ae60' }]} onPress={handleSendReminder}>
          <Text style={styles.actionBtnIcon}>🔔</Text>
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
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Text style={{ fontSize: 36, marginBottom: 8 }}>📭</Text>
            <Text style={styles.emptyText}>No activity from {memberName} yet</Text>
          </View>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f9fc' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // Member header
  memberHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 20, paddingVertical: 18,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eef0f2',
  },
  memberAvatar: {
    width: 50, height: 50, borderRadius: 25, backgroundColor: '#3498db',
    alignItems: 'center', justifyContent: 'center',
  },
  memberAvatarText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  memberNameText: { fontSize: 18, fontWeight: '700', color: '#2c3e50' },
  memberPhoneText: { fontSize: 13, color: '#95a5a6', marginTop: 2 },

  // Actions
  actionsRow: {
    flexDirection: 'row', gap: 10,
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eef0f2',
  },
  actionBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10,
    borderWidth: 1.5, borderColor: '#3498db', backgroundColor: '#fafbfc',
  },
  actionBtnIcon: { fontSize: 18, marginBottom: 3 },
  actionBtnLabel: { fontSize: 11, fontWeight: '600', color: '#3498db' },

  // Section
  sectionTitle: {
    fontSize: 13, fontWeight: '700', color: '#7f8c8d', textTransform: 'uppercase',
    letterSpacing: 0.5, marginTop: 16, marginBottom: 8, marginLeft: 20,
  },

  // Date separator
  dateSep: { alignItems: 'center', marginVertical: 8 },
  dateSepText: {
    backgroundColor: '#e8ecf0', paddingHorizontal: 12, paddingVertical: 4,
    borderRadius: 10, fontSize: 11, fontWeight: '600', color: '#5f6368', overflow: 'hidden',
  },

  // Activity card
  activityCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    padding: 12, borderRadius: 10, marginBottom: 6,
    borderLeftWidth: 3,
  },
  activityIcon: { fontSize: 16, fontWeight: '700', marginTop: 1 },
  activityMsg: { fontSize: 13, color: '#2c3e50', lineHeight: 18 },
  activityTime: { fontSize: 10, color: '#95a5a6', marginTop: 3 },

  // Empty
  emptyBox: { alignItems: 'center', paddingTop: 50 },
  emptyText: { fontSize: 14, color: '#95a5a6' },
});

export default MemberActivityScreen;
