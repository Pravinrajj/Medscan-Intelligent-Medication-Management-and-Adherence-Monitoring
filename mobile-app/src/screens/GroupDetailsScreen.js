import React, { useState, useContext, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, Alert, RefreshControl, TextInput, Switch } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import api from '../api/client';
import { AuthContext } from '../context/AuthContext';

const GroupDetailsScreen = ({ navigation, route }) => {
  const { userInfo } = useContext(AuthContext);
  const group = route.params?.group || {};
  
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [invitePhone, setInvitePhone] = useState('');
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState(false);
  const [activeTab, setActiveTab] = useState('members');
  const [sharedSchedules, setSharedSchedules] = useState([]);
  const [allowMemberTriggers, setAllowMemberTriggers] = useState(group.allowMemberTriggers || false);

  const fetchDetails = async () => {
    try {
      setError(false);
      const [membersRes, activityRes, sharedRes] = await Promise.all([
        api.get(`/groups/members/${group.id}`),
        api.get(`/groups/${group.id}/activity`).catch(() => ({ data: [] })),
        api.get(`/groups/${group.id}/shared-schedules`).catch(() => ({ data: [] })),
      ]);
      setDetails({
        ...group,
        members: membersRes.data || [],
        activity: activityRes.data || [],
      });
      setSharedSchedules(sharedRes.data || []);
    } catch (e) {
      console.error('[GroupDetails] Fetch failed:', e.message);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchDetails();
    }, [group.id])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchDetails();
    setRefreshing(false);
  }, [group.id]);

  const isCreator = (group.admin?.id || group.adminId) === userInfo.id;

  const handleInvite = async () => {
    const phone = invitePhone.trim();
    if (!phone) {
      Alert.alert('Error', 'Please enter a phone number.');
      return;
    }

    setInviting(true);
    try {
      const checkRes = await api.post('/groups/contacts/check', [phone]);
      const matchedUsers = checkRes.data || [];
      
      if (matchedUsers.length === 0) {
        Alert.alert('Not Found', 'No registered user found with that phone number.');
        return;
      }

      const targetUser = matchedUsers[0];
      const currentMembers = details?.members || [];
      if (currentMembers.some(m => m.id === targetUser.id)) {
        Alert.alert('Already in Group', `${targetUser.fullName || targetUser.username} is already a member.`);
        return;
      }

      await api.post(`/groups/${group.id}/add-member?adminId=${userInfo.id}&userId=${targetUser.id}`);
      Alert.alert('Added!', `${targetUser.fullName || targetUser.username} has been added to the group.`);
      setInvitePhone('');
      fetchDetails();
    } catch (e) {
      const msg = e.response?.data?.message || 'Failed to add member.';
      Alert.alert('Error', msg);
    } finally {
      setInviting(false);
    }
  };

  const handleRemoveMember = (member) => {
    if (member.id === userInfo.id) return; // Can't remove yourself this way
    if (member.id === (group.admin?.id || group.adminId)) {
      Alert.alert('Cannot Remove', 'You cannot remove the group admin.');
      return;
    }
    Alert.alert(
      'Remove Member',
      `Remove ${member.fullName || member.username} from this group?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/groups/${group.id}/remove-member?adminId=${userInfo.id}&userId=${member.id}`);
              Alert.alert('Removed', `${member.fullName || member.username} has been removed.`);
              fetchDetails();
            } catch (e) {
              Alert.alert('Error', e.response?.data?.message || 'Failed to remove member.');
            }
          }
        }
      ]
    );
  };

  const handleTriggerReminder = async (targetUserId, targetName, scheduleId, medicineName) => {
    Alert.alert(
      'Send Reminder',
      `Send ${targetName} a reminder to take ${medicineName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send ✉️',
          onPress: async () => {
            try {
              await api.post(`/groups/${group.id}/trigger-reminder`, {
                triggerUserId: userInfo.id,
                targetUserId,
                scheduleId,
              });
              Alert.alert('Sent!', `Reminder sent to ${targetName}.`);
            } catch (e) {
              Alert.alert('Error', e.response?.data?.message || 'Failed to send reminder.');
            }
          }
        }
      ]
    );
  };

  const handleToggleMemberTriggers = async (value) => {
    setAllowMemberTriggers(value);
    try {
      await api.put(`/groups/${group.id}/settings?adminId=${userInfo.id}`, {
        allowMemberTriggers: value
      });
    } catch (e) {
      setAllowMemberTriggers(!value); // Revert
      Alert.alert('Error', 'Failed to update settings.');
    }
  };

  const handleLeaveGroup = () => {
    Alert.alert(
      'Leave Group',
      `Are you sure you want to leave ${group.groupName || group.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/groups/${group.id}/leave?userId=${userInfo.id}`);
              Alert.alert('Left Group', 'You have left the group.');
              navigation.goBack();
            } catch (e) {
              Alert.alert('Error', 'Failed to leave group.');
            }
          },
        },
      ]
    );
  };

  const handleDeleteGroup = () => {
    Alert.alert(
      'Delete Group',
      `This will permanently delete "${group.groupName || group.name}" and remove all members. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/groups/${group.id}?adminId=${userInfo.id}`);
              Alert.alert('Deleted', 'Group has been deleted.');
              navigation.goBack();
            } catch (e) {
              const msg = e.response?.data?.message || 'Failed to delete group.';
              Alert.alert('Error', msg);
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator size="large" color="#3498db" /></View>;
  }

  if (error && !details) {
    return (
      <View style={styles.centered}>
        <Text style={{ fontSize: 40, marginBottom: 10 }}>😵</Text>
        <Text style={{ fontSize: 16, fontWeight: '600', color: '#2c3e50', marginBottom: 6 }}>Failed to Load Group</Text>
        <Text style={{ color: '#7f8c8d', marginBottom: 16 }}>Check your connection and try again.</Text>
        <TouchableOpacity
          style={{ backgroundColor: '#3498db', paddingVertical: 10, paddingHorizontal: 24, borderRadius: 8 }}
          onPress={() => { setLoading(true); fetchDetails(); }}
        >
          <Text style={{ color: '#fff', fontWeight: '600' }}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const groupData = details || group;
  const members = groupData.members || [];
  const activity = groupData.activity || [];
  const displayName = groupData.groupName || groupData.name;

  const formatActivityTime = (timestamp) => {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Group Header */}
      <View style={styles.headerCard}>
        <View style={styles.headerIcon}>
          <Text style={{ fontSize: 32 }}>👥</Text>
        </View>
        <Text style={styles.groupName}>{displayName}</Text>
        {groupData.description && <Text style={styles.groupDescription}>{groupData.description}</Text>}
        <Text style={styles.memberCount}>{members.length} member{members.length !== 1 ? 's' : ''}</Text>
        {isCreator && <Text style={styles.adminBadge}>👑 You're the Admin</Text>}
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        {['members', 'schedules', 'activity'].map(tab => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab === 'members' ? `Members (${members.length})` :
               tab === 'schedules' ? 'Schedules' : 'Activity'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Members List */}
      {activeTab === 'members' && (
        <View style={styles.section}>
          {members.length === 0 ? (
            <Text style={{ color: '#95a5a6', textAlign: 'center', padding: 20 }}>No members yet. Add members by phone number below.</Text>
          ) : members.map((member, idx) => (
            <View key={member.id || idx} style={styles.memberRow}>
              <View style={styles.memberAvatar}>
                <Text style={styles.memberAvatarText}>
                  {(member.fullName || member.username || '?')[0].toUpperCase()}
                </Text>
              </View>
              <View style={styles.memberInfo}>
                <Text style={styles.memberName}>
                  {member.fullName || member.username}
                  {member.id === userInfo.id && ' (You)'}
                </Text>
                <Text style={styles.memberRole}>
                  {member.id === (group.admin?.id || group.adminId) ? '👑 Admin' : 'Member'}
                </Text>
              </View>
              {member.adherenceRate != null && (
                <Text style={[styles.adherenceText, {
                  color: member.adherenceRate >= 80 ? '#27ae60' : member.adherenceRate >= 50 ? '#f39c12' : '#e74c3c'
                }]}>
                  {member.adherenceRate}%
                </Text>
              )}
              {/* Remove button — admin only, not for self or admin */}
              {isCreator && member.id !== userInfo.id && member.id !== (group.admin?.id || group.adminId) && (
                <TouchableOpacity style={styles.removeMemberBtn} onPress={() => handleRemoveMember(member)}>
                  <Text style={styles.removeMemberBtnText}>✗</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>
      )}

      {/* Shared Schedules */}
      {activeTab === 'schedules' && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Shared Schedules</Text>
          {sharedSchedules.length === 0 ? (
            <Text style={{ color: '#95a5a6', textAlign: 'center', padding: 20 }}>
              No schedules shared yet. Members can share their schedules to help the group track adherence.
            </Text>
          ) : sharedSchedules.map((ss, idx) => (
            <View key={ss.sharedScheduleId || idx} style={styles.sharedRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sharedMedName}>{ss.medicineName}</Text>
                <Text style={styles.sharedDetail}>
                  {ss.doseAmount} {ss.doseUnit} · {(ss.frequencyType || 'DAILY').replace('_', ' ')}
                </Text>
                <Text style={styles.sharedBy}>Shared by {ss.sharedByName}</Text>
              </View>
              {/* Trigger Reminder Button */}
              {(isCreator || allowMemberTriggers) && ss.sharedByUserId !== userInfo.id && (
                <TouchableOpacity
                  style={styles.triggerBtn}
                  onPress={() => handleTriggerReminder(ss.sharedByUserId, ss.sharedByName, ss.scheduleId, ss.medicineName)}
                >
                  <Text style={styles.triggerBtnText}>🔔</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>
      )}

      {/* Activity Feed */}
      {activeTab === 'activity' && (
        <View style={styles.section}>
          {activity.length === 0 ? (
            <Text style={{ color: '#95a5a6', textAlign: 'center', padding: 20 }}>No activity yet</Text>
          ) : activity.map((item, idx) => (
            <View key={item.id || idx} style={styles.activityRow}>
              <View style={[
                styles.activityDot,
                { backgroundColor: item.eventType?.includes('TAKEN') ? '#27ae60' : item.eventType?.includes('MISSED') ? '#e74c3c' : '#3498db' }
              ]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.activityMessage}>{item.message || item.eventType}</Text>
                <Text style={styles.activityTime}>{formatActivityTime(item.timestamp || item.createdAt)}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Add Member by Phone — visible to admin */}
      {isCreator && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Add Member</Text>
          <View style={styles.inviteRow}>
            <TextInput
              style={styles.inviteInput}
              value={invitePhone}
              onChangeText={setInvitePhone}
              placeholder="Enter phone number"
              placeholderTextColor="#bdc3c7"
              keyboardType="phone-pad"
            />
            <TouchableOpacity style={styles.inviteBtn} onPress={handleInvite} disabled={inviting}>
              {inviting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.inviteBtnText}>Add</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Admin Settings */}
      {isCreator && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Admin Settings</Text>
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>Allow Member Reminders</Text>
              <Text style={styles.settingHint}>
                {allowMemberTriggers
                  ? 'All members can send reminders to others'
                  : 'Only you (admin) can send reminders'}
              </Text>
            </View>
            <Switch
              value={allowMemberTriggers}
              onValueChange={handleToggleMemberTriggers}
              trackColor={{ false: '#d1d5db', true: '#86efac' }}
              thumbColor={allowMemberTriggers ? '#22c55e' : '#9ca3af'}
            />
          </View>
        </View>
      )}

      {/* Actions */}
      <View style={{ gap: 10, marginTop: 4 }}>
        {!isCreator && (
          <TouchableOpacity style={styles.leaveBtn} onPress={handleLeaveGroup}>
            <Text style={styles.leaveBtnText}>Leave Group</Text>
          </TouchableOpacity>
        )}
        {isCreator && (
          <TouchableOpacity style={styles.deleteBtn} onPress={handleDeleteGroup}>
            <Text style={styles.deleteBtnText}>🗑️ Delete Group</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f9fc' },
  content: { padding: 16 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f6f9fc' },

  headerCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 24,
    alignItems: 'center', marginBottom: 16, elevation: 3,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8,
  },
  headerIcon: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: '#e8f4fd',
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  groupName: { fontSize: 22, fontWeight: '800', color: '#2c3e50' },
  groupDescription: { fontSize: 14, color: '#7f8c8d', marginTop: 4, textAlign: 'center' },
  memberCount: { fontSize: 13, color: '#3498db', fontWeight: '600', marginTop: 8 },
  adminBadge: { fontSize: 12, color: '#f39c12', fontWeight: '700', marginTop: 6 },

  section: {
    backgroundColor: '#fff', borderRadius: 16, padding: 18,
    marginBottom: 16, elevation: 2,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#34495e', marginBottom: 14 },

  memberRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#f5f5f5',
  },
  memberAvatar: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#3498db',
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  memberAvatarText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 15, fontWeight: '600', color: '#2c3e50' },
  memberRole: { fontSize: 12, color: '#95a5a6', marginTop: 2 },
  adherenceText: { fontSize: 16, fontWeight: '800' },
  removeMemberBtn: {
    marginLeft: 8, padding: 6, backgroundColor: '#fef2f2', borderRadius: 8,
  },
  removeMemberBtnText: { color: '#e74c3c', fontWeight: '700', fontSize: 16 },

  sharedRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#f5f5f5',
  },
  sharedMedName: { fontSize: 15, fontWeight: '700', color: '#2c3e50' },
  sharedDetail: { fontSize: 13, color: '#7f8c8d', marginTop: 2 },
  sharedBy: { fontSize: 11, color: '#95a5a6', marginTop: 2 },
  triggerBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#e8f4fd',
    alignItems: 'center', justifyContent: 'center', marginLeft: 8,
  },
  triggerBtnText: { fontSize: 20 },

  settingRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 4,
  },
  settingLabel: { fontSize: 14, fontWeight: '600', color: '#2c3e50' },
  settingHint: { fontSize: 11, color: '#95a5a6', marginTop: 2 },

  inviteRow: { flexDirection: 'row', gap: 10 },
  inviteInput: {
    flex: 1, backgroundColor: '#f8f9fa', borderWidth: 1, borderColor: '#e0e6ed',
    borderRadius: 10, padding: 12, fontSize: 15, color: '#2c3e50',
  },
  inviteBtn: {
    backgroundColor: '#3498db', paddingVertical: 12, paddingHorizontal: 20,
    borderRadius: 10, justifyContent: 'center',
  },
  inviteBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  tabRow: {
    flexDirection: 'row', marginBottom: 12, backgroundColor: '#fff',
    borderRadius: 12, padding: 4, elevation: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03, shadowRadius: 2,
  },
  tab: {
    flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10,
  },
  tabActive: {
    backgroundColor: '#3498db',
  },
  tabText: { fontSize: 13, fontWeight: '600', color: '#7f8c8d' },
  tabTextActive: { color: '#fff' },

  activityRow: {
    flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#f5f5f5',
  },
  activityDot: {
    width: 10, height: 10, borderRadius: 5, marginTop: 5, marginRight: 12,
  },
  activityMessage: { fontSize: 14, color: '#2c3e50', fontWeight: '500' },
  activityTime: { fontSize: 12, color: '#95a5a6', marginTop: 2 },

  leaveBtn: {
    backgroundColor: '#fef2f2', paddingVertical: 14, borderRadius: 12,
    alignItems: 'center', borderWidth: 1, borderColor: '#fee2e2',
  },
  leaveBtnText: { color: '#e74c3c', fontWeight: '700', fontSize: 16 },

  deleteBtn: {
    backgroundColor: '#fef2f2', paddingVertical: 14, borderRadius: 12,
    alignItems: 'center', borderWidth: 1, borderColor: '#fca5a5',
  },
  deleteBtnText: { color: '#dc2626', fontWeight: '700', fontSize: 16 },
});

export default GroupDetailsScreen;
