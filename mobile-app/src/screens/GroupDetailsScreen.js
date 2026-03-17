import React, { useState, useEffect, useCallback, useContext } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Alert, ActivityIndicator, TextInput, Modal, ScrollView, RefreshControl } from 'react-native';
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
  const [addMemberSearch, setAddMemberSearch] = useState('');
  const [contactMedscanUsers, setContactMedscanUsers] = useState([]); // contacts who are on MedScan
  const [filteredUsers, setFilteredUsers] = useState([]);
  const [dbSearchResults, setDbSearchResults] = useState([]);
  const [contactLoading, setContactLoading] = useState(false);
  const [dbSearching, setDbSearching] = useState(false);
  const [contactNameMap, setContactNameMap] = useState({}); // phone last10 -> contact display name

  // Share schedules picker state
  const [shareModalVisible, setShareModalVisible] = useState(false);
  const [userSchedules, setUserSchedules] = useState([]);
  const [selectedShareIds, setSelectedShareIds] = useState(new Set());
  const [shareLoading, setShareLoading] = useState(false);

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

  // A5: Silently load contact name map on mount so member list shows contact names immediately
  useEffect(() => {
    const loadContactNames = async () => {
      try {
        const { status } = await Contacts.requestPermissionsAsync();
        if (status !== 'granted') return;
        const { data } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers] });
        if (!data) return;
        const phoneMap = {};
        data.forEach(contact => {
          const displayName = contact.name || contact.firstName || '';
          (contact.phoneNumbers || []).forEach(phone => {
            const normalized = phone.number.replace(/[\s\-\(\)\+]/g, '');
            const last10 = normalized.slice(-10);
            if (last10.length >= 10) {
              phoneMap[last10] = { contactName: displayName, fullNumber: phone.number };
            }
          });
        });
        setContactNameMap(phoneMap);
      } catch (e) {
        // Silent fail — not critical
      }
    };
    loadContactNames();
  }, []);

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

  // — B1: Open Add Member — auto-load contacts who are MedScan users —
  const handleOpenAddMember = async () => {
    setAddMemberVisible(true);
    setAddMemberSearch('');
    setDbSearchResults([]);
    setContactLoading(true);
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Allow contacts access to find MedScan users.');
        setContactLoading(false);
        return;
      }

      const { data } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers] });
      if (!data || data.length === 0) {
        setContactLoading(false);
        return;
      }

      // Build phone -> contact name map
      const phoneMap = {}; // last10 -> { contactName, fullNumber }
      const allPhones = [];
      data.forEach(contact => {
        const displayName = contact.name || contact.firstName || '';
        (contact.phoneNumbers || []).forEach(phone => {
          const normalized = phone.number.replace(/[\s\-\(\)\+]/g, '');
          const last10 = normalized.slice(-10);
          if (last10.length >= 10) {
            phoneMap[last10] = { contactName: displayName, fullNumber: phone.number };
            allPhones.push(last10);
          }
        });
      });

      setContactNameMap(phoneMap);

      // Check which contacts are registered on MedScan
      const allMatched = [];
      for (let i = 0; i < allPhones.length; i += 100) {
        const batch = allPhones.slice(i, i + 100);
        try {
          const res = await api.post('/groups/contacts/check', batch);
          allMatched.push(...(res.data || []));
        } catch (e) {
          console.log('[GroupDetails] Contact batch check failed:', e.message);
        }
      }

      // Deduplicate, exclude self and existing members, attach contact name
      const seen = new Set();
      const medscanUsers = allMatched.filter(u => {
        if (u.id === userInfo.id || members.find(m => m.id === u.id) || seen.has(u.id)) return false;
        seen.add(u.id);
        return true;
      }).map(u => {
        const phone10 = (u.phoneNumber || '').replace(/[\s\-\(\)\+]/g, '').slice(-10);
        const contactInfo = phoneMap[phone10];
        return {
          ...u,
          contactName: contactInfo?.contactName || null,
          displayPhone: contactInfo?.fullNumber || u.phoneNumber,
        };
      });

      setContactMedscanUsers(medscanUsers);
      setFilteredUsers(medscanUsers);
    } catch (e) {
      console.log('[GroupDetails] Contact load error:', e.message);
    } finally {
      setContactLoading(false);
    }
  };

  // — Integrated search: filter contacts, then fallback to DB —
  const handleMemberSearch = async (query) => {
    setAddMemberSearch(query);
    const digits = query.replace(/\D/g, '');

    if (!query.trim()) {
      // Empty search — show all contacts
      setFilteredUsers(contactMedscanUsers);
      setDbSearchResults([]);
      return;
    }

    // Filter local contacts by name or phone
    const lowerQuery = query.toLowerCase();
    const localFiltered = contactMedscanUsers.filter(u => {
      const name = (u.contactName || u.fullName || u.username || '').toLowerCase();
      const phone = (u.phoneNumber || '');
      return name.includes(lowerQuery) || phone.includes(digits);
    });
    setFilteredUsers(localFiltered);

    // If 10+ digits typed and no local match — search DB
    if (digits.length >= 10 && localFiltered.length === 0) {
      setDbSearching(true);
      try {
        const res = await api.post('/groups/contacts/check', [digits.slice(-10)]);
        const dbMatches = (res.data || []).filter(
          u => u.id !== userInfo.id && !members.find(m => m.id === u.id)
        );
        setDbSearchResults(dbMatches);
      } catch (e) {
        setDbSearchResults([]);
      } finally {
        setDbSearching(false);
      }
    } else {
      setDbSearchResults([]);
    }
  };

  const handleAddMember = async (user) => {
    try {
      await api.post(`/groups/${group.id}/add-member?adminId=${userInfo.id}&userId=${user.id}`);
      Alert.alert('Added', `${user.contactName || user.fullName || user.username} has been added to the group.`);
      // Remove from lists and refresh
      setContactMedscanUsers(prev => prev.filter(m => m.id !== user.id));
      setFilteredUsers(prev => prev.filter(m => m.id !== user.id));
      setDbSearchResults(prev => prev.filter(m => m.id !== user.id));
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

  // — Open share picker modal —
  const handleShareSchedules = async () => {
    try {
      const schedRes = await api.get(`/schedules/user/${userInfo.id}`);
      const allSchedules = schedRes.data || [];
      if (allSchedules.length === 0) {
        Alert.alert('No Schedules', 'You have no medication schedules to share.');
        return;
      }

      // Mark which are already shared
      const alreadySharedIds = new Set(
        sharedSchedules
          .filter(ss => (ss.sharedByUser?.id || ss.sharedByUserId) === userInfo.id)
          .map(ss => ss.schedule?.id || ss.scheduleId)
      );

      const schedulesWithStatus = allSchedules.map(s => ({
        ...s,
        alreadyShared: alreadySharedIds.has(s.id),
      }));

      setUserSchedules(schedulesWithStatus);
      setSelectedShareIds(new Set()); // start with none selected
      setShareModalVisible(true);
    } catch (e) {
      Alert.alert('Error', 'Failed to load your schedules.');
    }
  };

  const toggleShareSelection = (scheduleId) => {
    setSelectedShareIds(prev => {
      const next = new Set(prev);
      if (next.has(scheduleId)) next.delete(scheduleId);
      else next.add(scheduleId);
      return next;
    });
  };

  const confirmShareSelected = async () => {
    if (selectedShareIds.size === 0) {
      Alert.alert('Nothing Selected', 'Please select at least one schedule to share.');
      return;
    }
    setShareLoading(true);
    try {
      await api.post(`/groups/${group.id}/share-schedules`, {
        userId: userInfo.id,
        scheduleIds: Array.from(selectedShareIds),
      });
      Alert.alert('Shared', `${selectedShareIds.size} schedule(s) shared with the group.`);
      setShareModalVisible(false);
      fetchData();
    } catch (err) {
      Alert.alert('Error', err.response?.data?.message || err.response?.data?.error || 'Failed to share schedules.');
    } finally {
      setShareLoading(false);
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
            {members.length + 1} member{members.length !== 0 ? 's' : ''} · Admin: {group?.admin?.fullName || group?.admin?.username || 'You'}
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

  const renderMemberItem = ({ item }) => {
    // A4: Resolve contact name from device contacts
    const phone10 = (item.phoneNumber || '').replace(/[\s\-\(\)\+]/g, '').slice(-10);
    const contactInfo = contactNameMap[phone10];
    const primaryName = contactInfo?.contactName || item.fullName || item.username;
    const aliasName = contactInfo?.contactName ? (item.username || item.fullName) : null;
    const isSelf = item.id === userInfo?.id;
    const isGroupAdmin = item.id === group?.admin?.id;

    return (
      <TouchableOpacity
        style={styles.memberCard}
        activeOpacity={0.65}
        onPress={() => {
          if (!isSelf) {
            navigation.navigate('MemberActivity', { member: item, group });
          }
        }}
      >
        <View style={[styles.memberAvatar, isGroupAdmin && { backgroundColor: '#f39c12' }]}>
          <Text style={styles.memberAvatarText}>{(primaryName || '?')[0].toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.memberName}>
            {primaryName}
            {isGroupAdmin && <Text style={styles.adminBadge}> (Admin)</Text>}
            {isSelf && <Text style={styles.youBadge}> (You)</Text>}
          </Text>
          {aliasName && aliasName !== primaryName && (
            <Text style={styles.memberAlias}>~{aliasName}</Text>
          )}
          <Text style={styles.memberPhone}>{item.phoneNumber || '—'}</Text>
        </View>
        {!isSelf && (
          <Text style={{ fontSize: 16, color: '#bdc3c7' }}>›</Text>
        )}
      </TouchableOpacity>
    );
  };

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
    // A3: Backend returns flat map: { medicineName, doseAmount, doseUnit, sharedByName, scheduleId, ... }
    const medName = item.medicineName || item.schedule?.medicine?.name || 'Unknown Medicine';
    const dose = item.doseAmount || item.schedule?.doseAmount || '—';
    const unit = item.doseUnit || item.schedule?.doseUnit || '';
    const sharedByName = item.sharedByName || item.sharedByUser?.fullName || item.sharedByUser?.username;
    const scheduleId = item.scheduleId || item.schedule?.id;
    const sharedByUserId = item.sharedByUserId;
    const times = item.scheduleTimes || item.schedule?.scheduleTimes || [];
    return (
      <View style={styles.scheduleCard}>
        <View style={styles.scheduleHeader}>
          <Text style={styles.scheduleName}>{medName}</Text>
          <Text style={styles.scheduleDose}>{dose} {unit}</Text>
        </View>
        {sharedByName && <Text style={styles.scheduleSharedBy}>Shared by {sharedByName}</Text>}
        <View style={styles.scheduleTimes}>
          {times.map((t, idx) => (
            <Text key={idx} style={styles.scheduleTimeChip}>
              ⏰ {t.scheduledTime ? t.scheduledTime.substring(0, 5) : '—'}
            </Text>
          ))}
        </View>
        {(isAdmin || allowTriggers) && sharedByUserId && (
          <TouchableOpacity
            style={styles.reminderBtn}
            onPress={() => handleTriggerReminder(sharedByUserId, scheduleId)}
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
              <TouchableOpacity style={styles.addMemberBtn} onPress={handleOpenAddMember}>
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Group Header */}
        {renderHeader()}

        {/* ── Reminder Section ── */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionLabel}>NOTIFICATIONS</Text>
          
          {/* Global Remind Button — admin always sees it, non-admin sees it faded/disabled when triggers are OFF */}
          <TouchableOpacity
            style={[
              styles.globalRemindBtn,
              !(isAdmin || allowTriggers) && { opacity: 0.4 },
            ]}
            onPress={() => {
              if (!(isAdmin || allowTriggers)) {
                Alert.alert('Disabled', 'The group admin has not enabled reminders for members.');
                return;
              }
              Alert.alert(
                '🔔 Send Reminder',
                'This will send a notification to all group members who haven\'t updated their shared medicines today.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Send to All Pending',
                    onPress: async () => {
                      try {
                        // Send reminder to each member (except self)
                        const targets = members.filter(m => m.id !== userInfo.id);
                        for (const m of targets) {
                          await api.post(`/groups/${group.id}/trigger-reminder`, {
                            triggerUserId: userInfo.id,
                            targetUserId: m.id,
                            scheduleId: null,
                          });
                        }
                        Alert.alert('Sent', `Reminders sent to ${targets.length} member(s).`);
                      } catch (e) {
                        Alert.alert('Error', 'Failed to send reminders.');
                      }
                    },
                  },
                ]
              );
            }}
          >
            <Text style={styles.globalRemindBtnText}>🔔 Send Reminder to Pending Members</Text>
            <Text style={styles.globalRemindDesc}>Notify members who haven't updated their shared medicines</Text>
          </TouchableOpacity>

          {/* Trigger Toggle — admin only */}
          {isAdmin && (
            <TouchableOpacity style={styles.triggerToggleRow} onPress={handleToggleTriggers}>
              <View style={{ flex: 1 }}>
                <Text style={styles.triggerTitle}>Member Reminders</Text>
                <Text style={styles.triggerDesc}>
                  {allowTriggers
                    ? 'All members can send medication reminders to other members in this group.'
                    : 'Only the admin can send reminders. Enable this to let all members send reminders.'}
                </Text>
              </View>
              <View style={[styles.toggleTrack, allowTriggers && styles.toggleTrackActive]}>
                <View style={[styles.toggleThumb, allowTriggers && styles.toggleThumbActive]} />
              </View>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Members Section ── */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionLabel}>MEMBERS · {members.length + 1}</Text>
          {isAdmin && (
            <TouchableOpacity style={styles.addMemberBtn} onPress={handleOpenAddMember}>
              <Text style={styles.addMemberBtnText}>➕ Add Member</Text>
            </TouchableOpacity>
          )}
          {/* Admin as first entry */}
          {group?.admin && (
            <View style={styles.memberCard}>
              <View style={[styles.memberAvatar, { backgroundColor: '#f39c12' }]}>
                <Text style={styles.memberAvatarText}>{(group.admin.fullName || group.admin.username || '?')[0].toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.memberName}>
                  {group.admin.fullName || group.admin.username}
                  <Text style={styles.adminBadge}> (Admin)</Text>
                  {group.admin.id === userInfo?.id && <Text style={styles.youBadge}> (You)</Text>}
                </Text>
                <Text style={styles.memberPhone}>{group.admin.phoneNumber || '—'}</Text>
              </View>
            </View>
          )}
          <FlatList
            data={members}
            renderItem={renderMemberItem}
            keyExtractor={item => String(item.id)}
            scrollEnabled={false}
            ListEmptyComponent={<Text style={styles.emptyText}>No other members</Text>}
          />
        </View>

        {/* ── Shared Schedules Section ── */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionLabel}>SHARED SCHEDULES</Text>
          <TouchableOpacity style={styles.addMemberBtn} onPress={handleShareSchedules}>
            <Text style={styles.addMemberBtnText}>📊 Share My Schedules</Text>
          </TouchableOpacity>
          <FlatList
            data={sharedSchedules}
            renderItem={renderScheduleItem}
            keyExtractor={(item, idx) => String(item.id || idx)}
            scrollEnabled={false}
            ListEmptyComponent={
              <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                <Text style={{ fontSize: 28, marginBottom: 6 }}>📋</Text>
                <Text style={styles.emptyText}>No shared schedules</Text>
                <Text style={{ fontSize: 12, color: '#95a5a6', marginTop: 4, textAlign: 'center' }}>
                  Tap "Share My Schedules" to let group members see your medications
                </Text>
              </View>
            }
          />
        </View>

        {/* ── Leave / Exit ── */}
        {!isAdmin && (
          <View style={[styles.sectionCard, { marginBottom: 20 }]}>
            <TouchableOpacity style={styles.leaveBtn} onPress={handleLeaveGroup}>
              <Text style={styles.leaveBtnText}>🚪 Leave Group</Text>
            </TouchableOpacity>
          </View>
        )}
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

      {/* Add Member Modal — WhatsApp Style */}
      <Modal visible={addMemberVisible} animationType="slide" transparent onRequestClose={() => setAddMemberVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '85%' }]}>
            <Text style={styles.modalTitle}>Add Member</Text>

            {/* Integrated search bar */}
            <TextInput
              style={styles.modalInput}
              value={addMemberSearch}
              onChangeText={handleMemberSearch}
              placeholder="Search by name or phone number"
              placeholderTextColor="#bdc3c7"
              autoFocus
            />

            {contactLoading ? (
              <View style={{ alignItems: 'center', paddingVertical: 30 }}>
                <ActivityIndicator size="large" color="#3498db" />
                <Text style={{ color: '#95a5a6', marginTop: 8, fontSize: 13 }}>Loading contacts...</Text>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 380 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                {/* Contacts who are on MedScan */}
                {filteredUsers.length > 0 && (
                  <View>
                    <Text style={styles.contactMatchesTitle}>Contacts on MedScan ({filteredUsers.length})</Text>
                    {filteredUsers.map(user => (
                      <TouchableOpacity key={user.id} style={styles.matchItem} onPress={() => handleAddMember(user)}>
                        <View style={styles.memberAvatar}>
                          <Text style={styles.memberAvatarText}>{(user.contactName || user.fullName || '?')[0].toUpperCase()}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.memberName}>{user.contactName || user.fullName || user.username}</Text>
                          {user.contactName && user.username && (
                            <Text style={styles.memberAlias}>~{user.username}</Text>
                          )}
                          <Text style={styles.memberPhone}>{user.displayPhone || user.phoneNumber}</Text>
                        </View>
                        <Text style={{ color: '#27ae60', fontSize: 22, fontWeight: '700' }}>+</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* DB search results (non-contact users) */}
                {dbSearching && <ActivityIndicator size="small" color="#3498db" style={{ marginVertical: 10 }} />}
                {dbSearchResults.length > 0 && (
                  <View style={{ marginTop: 8 }}>
                    <Text style={[styles.contactMatchesTitle, { color: '#7f8c8d' }]}>Not in your contacts</Text>
                    {dbSearchResults.map(user => (
                      <TouchableOpacity key={user.id} style={styles.matchItem} onPress={() => handleAddMember(user)}>
                        <View style={[styles.memberAvatar, { backgroundColor: '#95a5a6' }]}>
                          <Text style={styles.memberAvatarText}>{(user.fullName || user.username || '?')[0].toUpperCase()}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.memberName}>{user.fullName || user.username}</Text>
                          <Text style={styles.memberPhone}>{user.phoneNumber}</Text>
                        </View>
                        <Text style={{ color: '#27ae60', fontSize: 22, fontWeight: '700' }}>+</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* Empty states */}
                {filteredUsers.length === 0 && dbSearchResults.length === 0 && !dbSearching && !contactLoading && (
                  <View style={{ alignItems: 'center', paddingVertical: 24 }}>
                    <Text style={{ fontSize: 32, marginBottom: 8 }}>👤</Text>
                    {addMemberSearch.trim() ? (
                      <>
                        <Text style={styles.emptyText}>No users found</Text>
                        <Text style={{ fontSize: 12, color: '#95a5a6', marginTop: 4, textAlign: 'center' }}>
                          {addMemberSearch.replace(/\D/g, '').length < 10
                            ? 'Enter a full 10-digit phone number to search our database'
                            : 'This number is not registered on MedScan'}
                        </Text>
                      </>
                    ) : (
                      <>
                        <Text style={styles.emptyText}>No contacts on MedScan</Text>
                        <Text style={{ fontSize: 12, color: '#95a5a6', marginTop: 4, textAlign: 'center' }}>
                          Type a phone number to search
                        </Text>
                      </>
                    )}
                  </View>
                )}
              </ScrollView>
            )}

            <TouchableOpacity style={[styles.modalBtn, { backgroundColor: '#e0e0e0', marginTop: 16 }]} onPress={() => setAddMemberVisible(false)}>
              <Text style={{ fontWeight: '600', color: '#7f8c8d' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Share Schedules Picker Modal */}
      <Modal visible={shareModalVisible} animationType="slide" transparent onRequestClose={() => setShareModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '80%' }]}>
            <Text style={styles.modalTitle}>Select Schedules to Share</Text>
            <Text style={{ fontSize: 12, color: '#95a5a6', marginBottom: 12 }}>Choose which medicines to share with this group</Text>

            <ScrollView style={{ maxHeight: 320 }} nestedScrollEnabled>
              {userSchedules.map(sched => {
                const isSelected = selectedShareIds.has(sched.id);
                const isShared = sched.alreadyShared;
                return (
                  <TouchableOpacity
                    key={sched.id}
                    style={[styles.sharePickerItem, isShared && { opacity: 0.5 }]}
                    onPress={() => !isShared && toggleShareSelection(sched.id)}
                    disabled={isShared}
                  >
                    <View style={[styles.shareCheckbox, isSelected && styles.shareCheckboxActive]}>
                      {(isSelected || isShared) && <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>✓</Text>}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.shareItemName}>{sched.medicine?.name || 'Unknown Medicine'}</Text>
                      <Text style={styles.shareItemDetail}>
                        {sched.doseAmount || '1'} {sched.doseUnit || 'Dose'} · {sched.frequencyType || 'Daily'}
                        {isShared ? '  ✓ Already shared' : ''}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: '#e0e0e0', flex: 1 }]} onPress={() => setShareModalVisible(false)}>
                <Text style={{ fontWeight: '600', color: '#7f8c8d' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: '#27ae60', flex: 1 }]}
                onPress={confirmShareSelected}
                disabled={shareLoading || selectedShareIds.size === 0}
              >
                {shareLoading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={{ fontWeight: '700', color: '#fff' }}>Share ({selectedShareIds.size})</Text>
                )}
              </TouchableOpacity>
            </View>
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
  memberAlias: { fontSize: 11, color: '#bdc3c7', fontStyle: 'italic', marginTop: 1 },
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

  // Share picker
  sharePickerItem: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  shareCheckbox: {
    width: 24, height: 24, borderRadius: 6, borderWidth: 2,
    borderColor: '#d1d5db', alignItems: 'center', justifyContent: 'center',
    marginRight: 12,
  },
  shareCheckboxActive: {
    backgroundColor: '#27ae60', borderColor: '#27ae60',
  },
  shareItemName: { fontSize: 15, fontWeight: '600', color: '#2c3e50' },
  shareItemDetail: { fontSize: 12, color: '#95a5a6', marginTop: 2 },

  // Section cards
  sectionCard: {
    backgroundColor: '#fff', marginHorizontal: 16, marginTop: 12,
    borderRadius: 14, padding: 16,
    elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4,
  },
  sectionLabel: {
    fontSize: 12, fontWeight: '700', color: '#95a5a6', letterSpacing: 0.8,
    marginBottom: 12,
  },

  // Global remind button
  globalRemindBtn: {
    backgroundColor: '#e8faf0', borderRadius: 12, padding: 14,
    borderWidth: 1.5, borderColor: '#a7f3d0', marginBottom: 12, alignItems: 'center',
  },
  globalRemindBtnText: { fontSize: 14, fontWeight: '700', color: '#059669' },
  globalRemindDesc: { fontSize: 11, color: '#6ee7b7', marginTop: 4, textAlign: 'center' },

  // Trigger toggle
  triggerToggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10, paddingHorizontal: 4,
  },
  triggerTitle: { fontSize: 14, fontWeight: '600', color: '#2c3e50', marginBottom: 2 },
  triggerDesc: { fontSize: 12, color: '#95a5a6', lineHeight: 17 },
  toggleTrack: {
    width: 46, height: 26, borderRadius: 13, backgroundColor: '#d1d5db',
    justifyContent: 'center', paddingHorizontal: 3,
  },
  toggleTrackActive: { backgroundColor: '#34d399' },
  toggleThumb: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff',
    elevation: 2,
  },
  toggleThumbActive: { alignSelf: 'flex-end' },

  // Leave button
  leaveBtn: {
    backgroundColor: '#fef2f2', paddingVertical: 14, borderRadius: 10,
    alignItems: 'center', borderWidth: 1, borderColor: '#fecaca',
  },
  leaveBtnText: { fontSize: 15, fontWeight: '700', color: '#dc2626' },
});

export default GroupDetailsScreen;
