import React, { useState, useEffect, useCallback, useContext } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Alert, ActivityIndicator, TextInput, Modal, ScrollView } from 'react-native';
import * as Contacts from 'expo-contacts';
import api from '../api/client';
import { AuthContext } from '../context/AuthContext';

const TABS = ['Members', 'Activity', 'Schedules'];

const GroupDetailsScreen = ({ route, navigation }) => {
  const { userInfo } = useContext(AuthContext);
  const group = route.params?.group;
  const [activeTab, setActiveTab] = useState('Members');
  const [members, setMembers] = useState([]);
  const [activity, setActivity] = useState([]);
  const [sharedSchedules, setSharedSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Edit group state
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editName, setEditName] = useState(group?.groupName || group?.name || '');
  const [editDescription, setEditDescription] = useState(group?.description || '');
  const [editSaving, setEditSaving] = useState(false);

  // Add member state
  const [addMemberVisible, setAddMemberVisible] = useState(false);
  const [phoneSearch, setPhoneSearch] = useState('');
  const [phoneResults, setPhoneResults] = useState([]);
  const [phoneSearching, setPhoneSearching] = useState(false);
  const [contactLoading, setContactLoading] = useState(false);
  const [contactMatches, setContactMatches] = useState([]);

  // Group settings state
  const [groupName, setGroupName] = useState(group?.groupName || group?.name || '');
  const [groupDescription, setGroupDescription] = useState(group?.description || '');
  const [allowTriggers, setAllowTriggers] = useState(group?.allowMemberTriggers || false);

  const isAdmin = group?.admin?.id === userInfo?.id;

  const fetchData = useCallback(async () => {
    try {
      const [membersRes, activityRes, schedulesRes] = await Promise.all([
        api.get(`/groups/members/${group.id}`),
        api.get(`/groups/${group.id}/activity`),
        api.get(`/groups/${group.id}/shared-schedules`).catch(() => ({ data: [] })),
      ]);
      setMembers(membersRes.data || []);
      setActivity(activityRes.data || []);
      setSharedSchedules(schedulesRes.data || []);
    } catch (e) {
      console.error('[GroupDetails] Fetch error:', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [group.id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      fetchData();
    });
    return unsubscribe;
  }, [navigation, fetchData]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  // — Edit Group —
  const handleSaveEdit = async () => {
    if (!editName.trim()) {
      Alert.alert('Error', 'Group name cannot be empty.');
      return;
    }
    setEditSaving(true);
    try {
      const settings = {};
      if (editName.trim() !== groupName) {
        settings.groupName = editName.trim();
      }
      settings.description = editDescription.trim();

      await api.put(`/groups/${group.id}/settings?adminId=${userInfo.id}`, settings);
      setGroupName(editName.trim());
      setGroupDescription(editDescription.trim());
      // Update navigation title
      navigation.setOptions({ title: editName.trim() });
      setEditModalVisible(false);
      Alert.alert('Success', 'Group details updated!');
    } catch (e) {
      const msg = e.response?.data?.message || e.response?.data || 'Failed to update group.';
      Alert.alert('Error', typeof msg === 'string' ? msg : 'Update failed');
    } finally {
      setEditSaving(false);
    }
  };

  // — Add Member by phone —
  const handlePhoneSearch = async (query) => {
    setPhoneSearch(query);
    if (query.replace(/\D/g, '').length < 3) {
      setPhoneResults([]);
      return;
    }
    setPhoneSearching(true);
    try {
      const res = await api.post('/groups/contacts/check', [query.trim()]);
      const filtered = (res.data || []).filter(
        u => u.id !== userInfo.id && !members.find(m => m.id === u.id)
      );
      setPhoneResults(filtered);
    } catch (e) {
      setPhoneResults([]);
    } finally {
      setPhoneSearching(false);
    }
  };

  const handleFromContacts = async () => {
    setContactLoading(true);
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please allow access to contacts to find MedScan users.');
        setContactLoading(false);
        return;
      }

      const { data } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers] });
      if (!data || data.length === 0) {
        Alert.alert('No Contacts', 'No contacts found on this device.');
        setContactLoading(false);
        return;
      }

      const phoneNumbers = [];
      data.forEach(contact => {
        (contact.phoneNumbers || []).forEach(phone => {
          const normalized = phone.number.replace(/[\s\-\(\)\+]/g, '');
          const last10 = normalized.slice(-10);
          if (last10.length >= 10) phoneNumbers.push(last10);
        });
      });

      const allMatched = [];
      for (let i = 0; i < phoneNumbers.length; i += 100) {
        const batch = phoneNumbers.slice(i, i + 100);
        try {
          const res = await api.post('/groups/contacts/check', batch);
          allMatched.push(...(res.data || []));
        } catch (e) {
          console.log('[GroupDetails] Contact batch check failed:', e.message);
        }
      }

      const seen = new Set();
      const matches = allMatched.filter(u => {
        if (u.id === userInfo.id || members.find(m => m.id === u.id) || seen.has(u.id)) return false;
        seen.add(u.id);
        return true;
      });

      if (matches.length === 0) {
        Alert.alert('No Matches', 'None of your contacts are registered on MedScan (or all are already members).');
      } else {
        setContactMatches(matches);
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to access contacts.');
    } finally {
      setContactLoading(false);
    }
  };

  const handleAddMember = async (user) => {
    try {
      await api.post(`/groups/${group.id}/add-member?adminId=${userInfo.id}&userId=${user.id}`);
      Alert.alert('Added', `${user.fullName || user.username} has been added to the group.`);
      setContactMatches(prev => prev.filter(m => m.id !== user.id));
      setPhoneResults([]);
      setPhoneSearch('');
      fetchData();
    } catch (e) {
      const msg = e.response?.data?.message || e.response?.data || 'Failed to add member.';
      Alert.alert('Error', typeof msg === 'string' ? msg : 'Failed to add member.');
    }
  };

  const handleRemoveMember = (memberId, memberName) => {
    Alert.alert('Remove Member', `Remove ${memberName} from the group?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => {
          try {
            await api.delete(`/groups/${group.id}/remove-member?adminId=${userInfo.id}&userId=${memberId}`);
            fetchData();
          } catch (e) {
            Alert.alert('Error', 'Failed to remove member.');
          }
        }
      }
    ]);
  };

  // — Navigate to Add Medicine for a member —
  const handleAddMedicineForMember = (member) => {
    navigation.navigate('AddMedicineForMember', {
      targetUserId: member.id,
      targetUserName: member.fullName || member.username,
    });
  };

  const handleTriggerReminder = async (targetUserId, scheduleId) => {
    try {
      await api.post(`/groups/${group.id}/trigger-reminder`, {
        triggerUserId: userInfo.id,
        targetUserId,
        scheduleId,
      });
      Alert.alert('Reminder Sent', 'A reminder notification has been sent.');
    } catch (e) {
      Alert.alert('Error', 'Failed to send reminder.');
    }
  };

  // — Delete Group (admin only) —
  const handleDeleteGroup = () => {
    Alert.alert('Delete Group', `Are you sure you want to permanently delete "${groupName}"? This action cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try {
            await api.delete(`/groups/${group.id}?adminId=${userInfo.id}`);
            Alert.alert('Deleted', 'Group has been deleted.');
            navigation.goBack();
          } catch (e) {
            Alert.alert('Error', e.response?.data?.message || 'Failed to delete group.');
          }
        }
      }
    ]);
  };

  // — Leave Group (non-admin) —
  const handleLeaveGroup = () => {
    Alert.alert('Leave Group', `Are you sure you want to leave "${groupName}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave', style: 'destructive',
        onPress: async () => {
          try {
            await api.delete(`/groups/${group.id}/remove-member?adminId=${group?.admin?.id}&userId=${userInfo.id}`);
            Alert.alert('Left Group', 'You have left the group.');
            navigation.goBack();
          } catch (e) {
            Alert.alert('Error', 'Failed to leave group.');
          }
        }
      }
    ]);
  };

  // — Share my schedules with the group —
  const handleShareSchedules = async () => {
    try {
      // Fetch user's current schedules to get their IDs
      const schedRes = await api.get(`/schedules/user/${userInfo.id}`);
      const scheduleIds = (schedRes.data || []).map(s => s.id);
      if (scheduleIds.length === 0) {
        Alert.alert('No Schedules', 'You have no medication schedules to share.');
        return;
      }
      await api.post(`/groups/${group.id}/share-schedules`, {
        userId: userInfo.id,
        scheduleIds: scheduleIds,
      });
      Alert.alert('Shared', 'Your medication schedules have been shared with the group.');
      fetchData();
    } catch (e) {
      Alert.alert('Error', e.response?.data?.message || e.response?.data?.error || 'Failed to share schedules.');
    }
  };

  // — Toggle allow member triggers (admin setting) —
  const handleToggleTriggers = async () => {
    const newVal = !allowTriggers;
    try {
      await api.put(`/groups/${group.id}/settings?adminId=${userInfo.id}`, {
        allowMemberTriggers: newVal,
      });
      setAllowTriggers(newVal);
    } catch (e) {
      Alert.alert('Error', 'Failed to update setting.');
    }
  };

  // — Render Functions —

  const renderHeader = () => (
    <View style={styles.headerCard}>
      <View style={styles.headerRow}>
        <View style={styles.headerIcon}>
          <Text style={{ fontSize: 28 }}>👥</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerName}>{groupName}</Text>
          {groupDescription ? (
            <Text style={styles.headerDesc}>{groupDescription}</Text>
          ) : null}
          <Text style={styles.headerMeta}>
            {members.length} member{members.length !== 1 ? 's' : ''} · Admin: {group?.admin?.fullName || group?.admin?.username || 'You'}
          </Text>
        </View>
      </View>
      {isAdmin && (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
          <TouchableOpacity style={styles.editBtn} onPress={() => { setEditName(groupName); setEditDescription(groupDescription); setEditModalVisible(true); }}>
            <Text style={styles.editBtnText}>✏️ Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.editBtn, { backgroundColor: '#fef2f2', borderColor: '#fecaca' }]} onPress={handleDeleteGroup}>
            <Text style={[styles.editBtnText, { color: '#dc2626' }]}>🗑️ Delete</Text>
          </TouchableOpacity>
        </View>
      )}
      {!isAdmin && (
        <TouchableOpacity style={[styles.editBtn, { marginTop: 12, backgroundColor: '#fef2f2', borderColor: '#fecaca' }]} onPress={handleLeaveGroup}>
          <Text style={[styles.editBtnText, { color: '#dc2626' }]}>🚪 Leave Group</Text>
        </TouchableOpacity>
      )}
      {isAdmin && (
        <TouchableOpacity style={[styles.settingRow, { marginTop: 10 }]} onPress={handleToggleTriggers}>
          <Text style={{ fontSize: 13, color: '#34495e', flex: 1 }}>Allow members to send reminders</Text>
          <Text style={{ fontSize: 13, color: allowTriggers ? '#27ae60' : '#95a5a6', fontWeight: '700' }}>{allowTriggers ? 'ON' : 'OFF'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  const renderTabs = () => (
    <View style={styles.tabRow}>
      {TABS.map(tab => (
        <TouchableOpacity
          key={tab}
          style={[styles.tab, activeTab === tab && styles.tabActive]}
          onPress={() => setActiveTab(tab)}
        >
          <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{tab}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  const renderMemberItem = ({ item }) => (
    <View style={styles.memberCard}>
      <View style={styles.memberAvatar}>
        <Text style={styles.memberAvatarText}>{(item.fullName || item.username || '?')[0].toUpperCase()}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.memberName}>
          {item.fullName || item.username}
          {item.id === group?.admin?.id && <Text style={styles.adminBadge}> (Admin)</Text>}
          {item.id === userInfo?.id && <Text style={styles.youBadge}> (You)</Text>}
        </Text>
        <Text style={styles.memberPhone}>{item.phoneNumber || '—'}</Text>
      </View>
      {isAdmin && item.id !== userInfo?.id && (
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          <TouchableOpacity style={styles.memberActionBtn} onPress={() => handleAddMedicineForMember(item)}>
            <Text style={{ fontSize: 11, color: '#3498db', fontWeight: '600' }}>📋 Add Med</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.memberActionBtn, { borderColor: '#e74c3c' }]} onPress={() => handleRemoveMember(item.id, item.fullName || item.username)}>
            <Text style={{ fontSize: 11, color: '#e74c3c', fontWeight: '600' }}>✗</Text>
          </TouchableOpacity>
        </View>
      )}
      {/* Non-admin can send reminders when allowTriggers is ON */}
      {!isAdmin && allowTriggers && item.id !== userInfo?.id && (
        <TouchableOpacity style={[styles.memberActionBtn, { borderColor: '#f39c12' }]} onPress={() => {
          Alert.alert('Send Reminder', `Send a medication reminder to ${item.fullName || item.username}?`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Send', onPress: () => handleTriggerReminder(item.id, null) }
          ]);
        }}>
          <Text style={{ fontSize: 11, color: '#f39c12', fontWeight: '600' }}>🔔 Remind</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  const renderActivityItem = ({ item }) => (
    <View style={styles.activityCard}>
      <Text style={styles.activityType}>{item.activityType}</Text>
      <Text style={styles.activityMessage}>{item.message}</Text>
      <Text style={styles.activityTime}>
        {item.timestamp ? new Date(item.timestamp).toLocaleString() : '—'}
      </Text>
    </View>
  );

  const renderScheduleItem = ({ item }) => {
    const schedule = item.schedule || item;
    const med = schedule?.medicine;
    const sharedBy = item.sharedByUser;
    return (
      <View style={styles.scheduleCard}>
        <View style={styles.scheduleHeader}>
          <Text style={styles.scheduleName}>{med?.name || 'Unknown Medicine'}</Text>
          <Text style={styles.scheduleDose}>{schedule?.doseAmount || '—'} {schedule?.doseUnit || ''}</Text>
        </View>
        {sharedBy && <Text style={styles.scheduleSharedBy}>Shared by {sharedBy.fullName || sharedBy.username}</Text>}
        <View style={styles.scheduleTimes}>
          {(schedule?.scheduleTimes || []).map((t, idx) => (
            <Text key={idx} style={styles.scheduleTimeChip}>
              ⏰ {t.scheduledTime ? t.scheduledTime.substring(0, 5) : '—'}
            </Text>
          ))}
        </View>
        {(isAdmin || allowTriggers) && sharedBy && (
          <TouchableOpacity
            style={styles.reminderBtn}
            onPress={() => handleTriggerReminder(sharedBy.id || item.sharedByUserId, schedule.id)}
          >
            <Text style={styles.reminderBtnText}>🔔 Send Reminder</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const renderTabContent = () => {
    if (loading) return <ActivityIndicator size="large" color="#3498db" style={{ marginTop: 40 }} />;

    switch (activeTab) {
      case 'Members':
        return (
          <>
            {isAdmin && (
              <TouchableOpacity style={styles.addMemberBtn} onPress={() => { setAddMemberVisible(true); setContactMatches([]); setPhoneSearch(''); setPhoneResults([]); }}>
                <Text style={styles.addMemberBtnText}>+ Add Member</Text>
              </TouchableOpacity>
            )}
            <FlatList
              data={members}
              renderItem={renderMemberItem}
              keyExtractor={item => String(item.id)}
              scrollEnabled={false}
              ListEmptyComponent={<Text style={styles.emptyText}>No members yet</Text>}
            />
          </>
        );
      case 'Activity':
        return (
          <FlatList
            data={activity}
            renderItem={renderActivityItem}
            keyExtractor={(item, idx) => item.id || String(idx)}
            scrollEnabled={false}
            ListEmptyComponent={<Text style={styles.emptyText}>No activity yet</Text>}
          />
        );
      case 'Schedules':
        return (
          <>
            <TouchableOpacity style={styles.addMemberBtn} onPress={handleShareSchedules}>
              <Text style={styles.addMemberBtnText}>📊 Share My Schedules</Text>
            </TouchableOpacity>
            <FlatList
              data={sharedSchedules}
              renderItem={renderScheduleItem}
              keyExtractor={(item, idx) => String(item.id || idx)}
              scrollEnabled={false}
              ListEmptyComponent={
                <View style={{ alignItems: 'center', paddingVertical: 30 }}>
                  <Text style={{ fontSize: 36, marginBottom: 10 }}>📋</Text>
                  <Text style={styles.emptyText}>No shared schedules</Text>
                  <Text style={{ fontSize: 13, color: '#95a5a6', marginTop: 4, textAlign: 'center' }}>
                    Tap "Share My Schedules" to let group members see your medications
                  </Text>
                </View>
              }
            />
          </>
        );
      default:
        return null;
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshing={refreshing}
        onRefresh={onRefresh}
        showsVerticalScrollIndicator={false}
      >
        {renderHeader()}
        {renderTabs()}
        {renderTabContent()}
      </ScrollView>

      {/* Edit Group Modal */}
      <Modal visible={editModalVisible} animationType="slide" transparent onRequestClose={() => setEditModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Edit Group</Text>

            <Text style={styles.modalLabel}>Group Name</Text>
            <TextInput style={styles.modalInput} value={editName} onChangeText={setEditName} placeholder="Group name" placeholderTextColor="#bdc3c7" />

            <Text style={styles.modalLabel}>Description</Text>
            <TextInput style={[styles.modalInput, { height: 80, textAlignVertical: 'top' }]} value={editDescription} onChangeText={setEditDescription} placeholder="Describe this group" placeholderTextColor="#bdc3c7" multiline />

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: '#e0e0e0', flex: 1 }]} onPress={() => setEditModalVisible(false)}>
                <Text style={{ fontWeight: '600', color: '#7f8c8d' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: '#3498db', flex: 1 }]} onPress={handleSaveEdit} disabled={editSaving}>
                {editSaving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ fontWeight: '700', color: '#fff' }}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Add Member Modal */}
      <Modal visible={addMemberVisible} animationType="slide" transparent onRequestClose={() => setAddMemberVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '80%' }]}>
            <Text style={styles.modalTitle}>Add Member</Text>

            {/* From Contacts */}
            <TouchableOpacity style={styles.contactsBtn} onPress={handleFromContacts} disabled={contactLoading}>
              {contactLoading ? <ActivityIndicator size="small" color="#3498db" /> : <Text style={styles.contactsBtnText}>📱 From Contacts</Text>}
            </TouchableOpacity>

            {contactMatches.length > 0 && (
              <View style={styles.contactMatchesSection}>
                <Text style={styles.contactMatchesTitle}>Found on MedScan ({contactMatches.length})</Text>
                <ScrollView style={{ maxHeight: 160 }} nestedScrollEnabled>
                  {contactMatches.map(user => (
                    <TouchableOpacity key={user.id} style={styles.matchItem} onPress={() => handleAddMember(user)}>
                      <View style={styles.memberAvatar}>
                        <Text style={styles.memberAvatarText}>{(user.fullName || '?')[0].toUpperCase()}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.memberName}>{user.fullName || user.username}</Text>
                        <Text style={styles.memberPhone}>{user.phoneNumber || '—'}</Text>
                      </View>
                      <Text style={{ color: '#3498db', fontSize: 18, fontWeight: '700' }}>+</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Manual phone search */}
            <Text style={[styles.modalLabel, { marginTop: 12 }]}>Or search by phone</Text>
            <TextInput style={styles.modalInput} value={phoneSearch} onChangeText={handlePhoneSearch} placeholder="Phone number" placeholderTextColor="#bdc3c7" keyboardType="phone-pad" />
            {phoneSearching && <ActivityIndicator size="small" color="#3498db" style={{ marginVertical: 6 }} />}
            {phoneResults.map(user => (
              <TouchableOpacity key={user.id} style={styles.matchItem} onPress={() => handleAddMember(user)}>
                <View style={styles.memberAvatar}>
                  <Text style={styles.memberAvatarText}>{(user.fullName || '?')[0].toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.memberName}>{user.fullName || user.username}</Text>
                </View>
                <Text style={{ color: '#3498db', fontSize: 18, fontWeight: '700' }}>+</Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity style={[styles.modalBtn, { backgroundColor: '#e0e0e0', marginTop: 16 }]} onPress={() => setAddMemberVisible(false)}>
              <Text style={{ fontWeight: '600', color: '#7f8c8d' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f9fc' },

  headerCard: {
    backgroundColor: '#fff', margin: 16, borderRadius: 16, padding: 16,
    elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 8,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  headerIcon: {
    width: 50, height: 50, borderRadius: 25, backgroundColor: '#e8f4fd',
    alignItems: 'center', justifyContent: 'center', marginRight: 14,
  },
  headerName: { fontSize: 20, fontWeight: '700', color: '#2c3e50' },
  headerDesc: { fontSize: 13, color: '#7f8c8d', marginTop: 3, lineHeight: 18 },
  headerMeta: { fontSize: 12, color: '#95a5a6', marginTop: 4 },
  editBtn: {
    marginTop: 12, alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 14,
    backgroundColor: '#f0f7ff', borderRadius: 8, borderWidth: 1, borderColor: '#bee3f8',
  },
  editBtnText: { fontSize: 13, fontWeight: '600', color: '#2980b9' },

  tabRow: {
    flexDirection: 'row', marginHorizontal: 16, marginBottom: 12,
    backgroundColor: '#ecf0f1', borderRadius: 12, padding: 4,
  },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10 },
  tabActive: { backgroundColor: '#fff', elevation: 2 },
  tabText: { fontSize: 13, fontWeight: '600', color: '#95a5a6' },
  tabTextActive: { color: '#2c3e50' },

  memberCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    marginHorizontal: 16, marginBottom: 8, padding: 14, borderRadius: 12,
    elevation: 1,
  },
  memberAvatar: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#3498db',
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  memberAvatarText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  memberName: { fontSize: 14, fontWeight: '600', color: '#2c3e50' },
  adminBadge: { fontWeight: '400', color: '#27ae60', fontSize: 12 },
  youBadge: { fontWeight: '400', color: '#3498db', fontSize: 12 },
  memberPhone: { fontSize: 12, color: '#95a5a6', marginTop: 2 },
  memberActionBtn: {
    paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8,
    borderWidth: 1, borderColor: '#3498db',
  },

  addMemberBtn: {
    marginHorizontal: 16, marginBottom: 12, paddingVertical: 12,
    backgroundColor: '#e8f4fd', borderRadius: 10, alignItems: 'center',
    borderWidth: 1, borderColor: '#bee3f8',
  },
  addMemberBtnText: { fontSize: 14, fontWeight: '600', color: '#2980b9' },

  activityCard: {
    backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 8,
    padding: 14, borderRadius: 12, elevation: 1,
  },
  activityType: { fontSize: 11, fontWeight: '700', color: '#3498db', textTransform: 'uppercase', marginBottom: 4 },
  activityMessage: { fontSize: 14, color: '#2c3e50' },
  activityTime: { fontSize: 11, color: '#bdc3c7', marginTop: 6 },

  scheduleCard: {
    backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 10,
    padding: 14, borderRadius: 12, elevation: 1,
  },
  scheduleHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  scheduleName: { fontSize: 15, fontWeight: '700', color: '#2c3e50' },
  scheduleDose: { fontSize: 13, color: '#7f8c8d' },
  scheduleSharedBy: { fontSize: 12, color: '#3498db', marginTop: 4 },
  scheduleTimes: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  scheduleTimeChip: {
    fontSize: 12, color: '#34495e', backgroundColor: '#f0f7ff',
    paddingVertical: 4, paddingHorizontal: 10, borderRadius: 8,
  },
  reminderBtn: {
    marginTop: 10, paddingVertical: 8, alignItems: 'center',
    backgroundColor: '#fff8e1', borderRadius: 8,
    borderWidth: 1, borderColor: '#ffd54f',
  },
  reminderBtnText: { fontSize: 12, fontWeight: '600', color: '#f57f17' },

  settingRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#f8f9fa', borderRadius: 10, padding: 12,
  },

  emptyText: { fontSize: 15, color: '#95a5a6', textAlign: 'center', marginTop: 20 },

  // Modals
  modalOverlay: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  modalContent: {
    backgroundColor: '#fff', borderRadius: 20, padding: 24,
    width: '88%', maxWidth: 400, elevation: 10,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#2c3e50', marginBottom: 16 },
  modalLabel: { fontSize: 12, fontWeight: '700', color: '#7f8c8d', marginBottom: 6, textTransform: 'uppercase' },
  modalInput: {
    backgroundColor: '#f8f9fa', borderWidth: 1, borderColor: '#e0e6ed',
    borderRadius: 10, padding: 12, fontSize: 15, color: '#2c3e50',
    marginBottom: 8,
  },
  modalBtn: {
    paddingVertical: 12, borderRadius: 10, alignItems: 'center',
  },

  contactsBtn: {
    backgroundColor: '#e8f4fd', paddingVertical: 12, borderRadius: 10,
    alignItems: 'center', borderWidth: 1, borderColor: '#bee3f8', marginBottom: 10,
  },
  contactsBtnText: { fontSize: 14, fontWeight: '600', color: '#2980b9' },
  contactMatchesSection: {
    backgroundColor: '#f0fdf4', borderRadius: 10, padding: 10,
    marginBottom: 8, borderWidth: 1, borderColor: '#bbf7d0',
  },
  contactMatchesTitle: { fontSize: 13, fontWeight: '600', color: '#27ae60', marginBottom: 6 },
  matchItem: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
});

export default GroupDetailsScreen;
