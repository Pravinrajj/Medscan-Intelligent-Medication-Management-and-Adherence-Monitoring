import React, { useState, useEffect, useCallback, useContext } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Alert, ActivityIndicator, TextInput, Modal, ScrollView, RefreshControl } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Contacts from 'expo-contacts';
import { useFocusEffect } from '@react-navigation/native';
import api from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { colors, fonts, spacing, radii, shadows, typography } from '../theme';

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

  // R2: Auto-open add member modal when navigated with openAddMember flag
  // Wait until contacts are loaded before opening
  const [contactsReady, setContactsReady] = useState(false);
  const isAdmin = group?.admin?.id === userInfo?.id;
  useEffect(() => {
    if (route.params?.openAddMember && isAdmin && contactsReady) {
      setTimeout(() => setAddMemberVisible(true), 300);
    }
  }, [route.params?.openAddMember, contactsReady]);

  // Share schedules picker state
  const [shareModalVisible, setShareModalVisible] = useState(false);
  const [userSchedules, setUserSchedules] = useState([]);
  const [selectedShareIds, setSelectedShareIds] = useState(new Set());
  const [shareLoading, setShareLoading] = useState(false);

  // Group settings state
  const [groupName, setGroupName] = useState(group?.groupName || group?.name || '');
  const [groupDescription, setGroupDescription] = useState(group?.description || '');
  const [allowTriggers, setAllowTriggers] = useState(group?.allowMemberTriggers || false);


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

  // Load data every time screen gains focus
  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchData();
    }, [fetchData])
  );

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
        setContactsReady(true);
      } catch (e) {
        // Silent fail — not critical
        setContactsReady(true); // Still mark ready so modal can open
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
            navigation.popToTop();
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
            navigation.popToTop();
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
          <MaterialCommunityIcons name="account-group" size={28} color="#3b82f6" />
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
            <Text style={styles.editBtnText}><MaterialCommunityIcons name="pencil-outline" size={14} color="#2563eb" /> Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.editBtn, { backgroundColor: '#fef2f2', borderColor: '#fecaca' }]} onPress={handleDeleteGroup}>
            <Text style={[styles.editBtnText, { color: colors.danger }]}><MaterialCommunityIcons name="delete-outline" size={14} color={colors.danger} /> Delete</Text>
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
            navigation.navigate('MemberActivity', { member: item, group, contactName: primaryName });
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
          <Text style={{ fontSize: 16, color: colors.textTertiary }}>›</Text>
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
              <MaterialCommunityIcons name="clock-outline" size={12} color="#64748b" /> {t.scheduledTime ? t.scheduledTime.substring(0, 5) : '—'}
            </Text>
          ))}
        </View>
        {(isAdmin || allowTriggers) && sharedByUserId && (
          <TouchableOpacity
            style={styles.reminderBtn}
            onPress={() => handleTriggerReminder(sharedByUserId, scheduleId)}
          >
            <Text style={styles.reminderBtnText}><MaterialCommunityIcons name="bell-ring-outline" size={14} color="#fff" /> Send Reminder</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const renderTabContent = () => {
    if (loading) return <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />;

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
              <Text style={styles.addMemberBtnText}><MaterialCommunityIcons name="chart-bar" size={14} color="#fff" /> Share My Schedules</Text>
            </TouchableOpacity>
            <FlatList
              data={sharedSchedules}
              renderItem={renderScheduleItem}
              keyExtractor={(item, idx) => String(item.id || idx)}
              scrollEnabled={false}
              ListEmptyComponent={
                <View style={{ alignItems: 'center', paddingVertical: 30 }}>
                  <MaterialCommunityIcons name="clipboard-text-outline" size={36} color="#94a3b8" style={{marginBottom: 10}} />
                  <Text style={styles.emptyText}>No shared schedules</Text>
                  <Text style={{ fontSize: 13, color: colors.textTertiary, marginTop: 4, textAlign: 'center' }}>
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

        {/* ── Settings Section ── */}
        {isAdmin && (
        <View style={styles.sectionCard}>
          <Text style={styles.sectionLabel}>SETTINGS</Text>
          
          {/* Trigger Toggle — admin only */}
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
        </View>
        )}

        {/* ── Members Section ── */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionLabel}>MEMBERS · {members.length + 1}</Text>
          {isAdmin && (
            <TouchableOpacity style={styles.addMemberBtn} onPress={handleOpenAddMember}>
              <Text style={styles.addMemberBtnText}><MaterialCommunityIcons name="account-plus" size={14} color="#fff" /> Add Member</Text>
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

        {/* ── Shared Schedules — tappable row to separate page ── */}
        <TouchableOpacity
          style={[styles.sectionCard, { flexDirection: 'row', alignItems: 'center', paddingVertical: 16 }]}
          onPress={() => navigation.navigate('SharedSchedules', { group })}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name="chart-bar" size={22} color="#3b82f6" style={{marginRight: 12}} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, fontFamily: fonts.bold, color: colors.text }}>Shared Schedules</Text>
            <Text style={{ fontSize: 12, fontFamily: fonts.regular, color: colors.textTertiary, marginTop: 2 }}>
              {sharedSchedules.length > 0 ? `${sharedSchedules.length} schedule${sharedSchedules.length !== 1 ? 's' : ''} shared` : 'Share & manage medication schedules'}
            </Text>
          </View>
          <Text style={{ fontSize: 18, color: colors.textTertiary }}>›</Text>
        </TouchableOpacity>

        {/* ── Leave / Exit ── */}
        {!isAdmin && (
          <View style={[styles.sectionCard, { marginBottom: 20 }]}>
            <TouchableOpacity style={styles.leaveBtn} onPress={handleLeaveGroup}>
              <Text style={styles.leaveBtnText}><MaterialCommunityIcons name="exit-run" size={15} color="#dc2626" /> Leave Group</Text>
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
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: colors.surfaceHover, flex: 1 }]} onPress={() => setEditModalVisible(false)}>
                <Text style={{ fontFamily: fonts.semiBold, color: colors.textSecondary }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: colors.primary, flex: 1 }]} onPress={handleSaveEdit} disabled={editSaving}>
                {editSaving ? <ActivityIndicator color={colors.textInverse} size="small" /> : <Text style={{ fontFamily: fonts.bold, color: colors.textInverse }}>Save</Text>}
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
              placeholderTextColor={colors.textTertiary}
              autoFocus
            />

            {contactLoading ? (
              <View style={{ alignItems: 'center', paddingVertical: 30 }}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={{ color: colors.textTertiary, marginTop: 8, fontSize: 13, fontFamily: fonts.regular }}>Loading contacts...</Text>
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
                        <Text style={{ color: colors.success, fontSize: 22, fontFamily: fonts.bold }}>+</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* DB search results (non-contact users) */}
                {dbSearching && <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 10 }} />}
                {dbSearchResults.length > 0 && (
                  <View style={{ marginTop: 8 }}>
                    <Text style={[styles.contactMatchesTitle, { color: colors.textSecondary }]}>Not in your contacts</Text>
                    {dbSearchResults.map(user => (
                      <TouchableOpacity key={user.id} style={styles.matchItem} onPress={() => handleAddMember(user)}>
                        <View style={[styles.memberAvatar, { backgroundColor: colors.textTertiary }]}>
                          <Text style={styles.memberAvatarText}>{(user.fullName || user.username || '?')[0].toUpperCase()}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.memberName}>{user.fullName || user.username}</Text>
                          <Text style={styles.memberPhone}>{user.phoneNumber}</Text>
                        </View>
                        <Text style={{ color: colors.success, fontSize: 22, fontFamily: fonts.bold }}>+</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* Empty states */}
                {filteredUsers.length === 0 && dbSearchResults.length === 0 && !dbSearching && !contactLoading && (
                  <View style={{ alignItems: 'center', paddingVertical: 24 }}>
                    <MaterialCommunityIcons name="account-outline" size={32} color={colors.textTertiary} style={{marginBottom: 8}} />
                    {addMemberSearch.trim() ? (
                      <>
                        <Text style={styles.emptyText}>No users found</Text>
                        <Text style={{ fontSize: 12, color: colors.textTertiary, marginTop: 4, textAlign: 'center' }}>
                          {addMemberSearch.replace(/\D/g, '').length < 10
                            ? 'Enter a full 10-digit phone number to search our database'
                            : 'This number is not registered on MedScan'}
                        </Text>
                      </>
                    ) : (
                      <>
                        <Text style={styles.emptyText}>No contacts on MedScan</Text>
                        <Text style={{ fontSize: 12, color: colors.textTertiary, marginTop: 4, textAlign: 'center' }}>
                          Type a phone number to search
                        </Text>
                      </>
                    )}
                  </View>
                )}
              </ScrollView>
            )}

            <TouchableOpacity style={[styles.modalBtn, { backgroundColor: colors.surfaceHover, marginTop: 16 }]} onPress={() => setAddMemberVisible(false)}>
              <Text style={{ fontFamily: fonts.semiBold, color: colors.textSecondary }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Share Schedules Picker Modal */}
      <Modal visible={shareModalVisible} animationType="slide" transparent onRequestClose={() => setShareModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '80%' }]}>
            <Text style={styles.modalTitle}>Select Schedules to Share</Text>
            <Text style={{ fontSize: 12, fontFamily: fonts.regular, color: colors.textTertiary, marginBottom: 12 }}>Choose which medicines to share with this group</Text>

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
                      {(isSelected || isShared) && <Text style={{ color: colors.textInverse, fontSize: 12, fontFamily: fonts.bold }}>✓</Text>}
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
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: colors.surfaceHover, flex: 1 }]} onPress={() => setShareModalVisible(false)}>
                <Text style={{ fontFamily: fonts.semiBold, color: colors.textSecondary }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: colors.success, flex: 1 }]}
                onPress={confirmShareSelected}
                disabled={shareLoading || selectedShareIds.size === 0}
              >
                {shareLoading ? (
                  <ActivityIndicator color={colors.textInverse} size="small" />
                ) : (
                  <Text style={{ fontFamily: fonts.bold, color: colors.textInverse }}>Share ({selectedShareIds.size})</Text>
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
  container: { flex: 1, backgroundColor: colors.background },

  headerCard: {
    backgroundColor: colors.surface, margin: spacing.lg, borderRadius: radii.xl, padding: spacing.lg,
    ...shadows.md,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  headerIcon: {
    width: 50, height: 50, borderRadius: 25, backgroundColor: colors.primaryBg,
    alignItems: 'center', justifyContent: 'center', marginRight: spacing.md,
  },
  headerName: { fontSize: 20, fontFamily: fonts.bold, color: colors.text },
  headerDesc: { fontSize: 13, fontFamily: fonts.regular, color: colors.textSecondary, marginTop: 3, lineHeight: 18 },
  headerMeta: { fontSize: 12, fontFamily: fonts.regular, color: colors.textTertiary, marginTop: 4 },
  editBtn: {
    marginTop: spacing.md, alignSelf: 'flex-start', paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
    backgroundColor: colors.primaryBg, borderRadius: radii.sm,
  },
  editBtnText: { fontSize: 13, fontFamily: fonts.semiBold, color: colors.primary },

  tabRow: {
    flexDirection: 'row', marginHorizontal: spacing.lg, marginBottom: spacing.md,
    backgroundColor: colors.surfaceHover, borderRadius: radii.md, padding: 4,
  },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: radii.sm },
  tabActive: { backgroundColor: colors.surface, ...shadows.sm },
  tabText: { fontSize: 13, fontFamily: fonts.semiBold, color: colors.textTertiary },
  tabTextActive: { color: colors.text },

  memberCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    marginHorizontal: spacing.lg, marginBottom: spacing.sm, padding: spacing.md, borderRadius: radii.lg,
    ...shadows.sm,
  },
  memberAvatar: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center', marginRight: spacing.md,
  },
  memberAvatarText: { color: colors.textInverse, fontFamily: fonts.bold, fontSize: 16 },
  memberName: { fontSize: 14, fontFamily: fonts.semiBold, color: colors.text },
  adminBadge: { fontFamily: fonts.regular, color: colors.success, fontSize: 12 },
  youBadge: { fontFamily: fonts.regular, color: colors.primary, fontSize: 12 },
  memberPhone: { fontSize: 12, fontFamily: fonts.regular, color: colors.textTertiary, marginTop: 2 },
  memberAlias: { fontSize: 11, fontFamily: fonts.regular, color: colors.textTertiary, fontStyle: 'italic', marginTop: 1 },
  memberActionBtn: {
    paddingVertical: 6, paddingHorizontal: 10, borderRadius: radii.sm,
    borderWidth: 1, borderColor: colors.primary,
  },

  addMemberBtn: {
    marginHorizontal: spacing.lg, marginBottom: spacing.md, paddingVertical: spacing.md,
    backgroundColor: colors.primaryBg, borderRadius: radii.md, alignItems: 'center',
  },
  addMemberBtnText: { fontSize: 14, fontFamily: fonts.semiBold, color: colors.primary },

  activityCard: {
    backgroundColor: colors.surface, marginHorizontal: spacing.lg, marginBottom: spacing.sm,
    padding: spacing.md, borderRadius: radii.lg, ...shadows.sm,
  },
  activityType: { fontSize: 11, fontFamily: fonts.bold, color: colors.primary, textTransform: 'uppercase', marginBottom: 4 },
  activityMessage: { fontSize: 14, fontFamily: fonts.regular, color: colors.text },
  activityTime: { fontSize: 11, fontFamily: fonts.regular, color: colors.textTertiary, marginTop: 6 },

  scheduleCard: {
    backgroundColor: colors.surface, marginHorizontal: spacing.lg, marginBottom: spacing.sm + 2,
    padding: spacing.md, borderRadius: radii.lg, ...shadows.sm,
  },
  scheduleHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  scheduleName: { fontSize: 15, fontFamily: fonts.bold, color: colors.text },
  scheduleDose: { fontSize: 13, fontFamily: fonts.regular, color: colors.textSecondary },
  scheduleSharedBy: { fontSize: 12, fontFamily: fonts.medium, color: colors.primary, marginTop: 4 },
  scheduleTimes: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
  scheduleTimeChip: {
    fontSize: 12, fontFamily: fonts.medium, color: colors.text, backgroundColor: colors.primaryBg,
    paddingVertical: 4, paddingHorizontal: 10, borderRadius: radii.sm,
  },
  reminderBtn: {
    marginTop: spacing.sm + 2, paddingVertical: spacing.sm, alignItems: 'center',
    backgroundColor: colors.warningLight, borderRadius: radii.sm,
  },
  reminderBtnText: { fontSize: 12, fontFamily: fonts.semiBold, color: colors.warningDark },

  settingRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surfaceHover, borderRadius: radii.md, padding: spacing.md,
  },

  emptyText: { fontSize: 15, fontFamily: fonts.regular, color: colors.textTertiary, textAlign: 'center', marginTop: 20 },

  // Modals
  modalOverlay: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: colors.overlay,
  },
  modalContent: {
    backgroundColor: colors.surface, borderRadius: radii.xxl, padding: spacing.xxl,
    width: '88%', maxWidth: 400, ...shadows.xl,
  },
  modalTitle: { fontSize: 18, fontFamily: fonts.bold, color: colors.text, marginBottom: spacing.lg },
  modalLabel: { ...typography.sectionLabel, marginBottom: 6 },
  modalInput: {
    backgroundColor: colors.surfaceHover, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.md, padding: spacing.md, fontSize: 15, fontFamily: fonts.regular, color: colors.text,
    marginBottom: spacing.sm,
  },
  modalBtn: {
    paddingVertical: spacing.md, borderRadius: radii.md, alignItems: 'center',
  },

  contactsBtn: {
    backgroundColor: colors.primaryBg, paddingVertical: spacing.md, borderRadius: radii.md,
    alignItems: 'center', marginBottom: spacing.sm + 2,
  },
  contactsBtnText: { fontSize: 14, fontFamily: fonts.semiBold, color: colors.primary },
  contactMatchesSection: {
    backgroundColor: colors.successLight, borderRadius: radii.md, padding: spacing.sm + 2,
    marginBottom: spacing.sm,
  },
  contactMatchesTitle: { fontSize: 13, fontFamily: fonts.semiBold, color: colors.success, marginBottom: 6 },
  matchItem: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.borderLight,
  },

  // Share picker
  sharePickerItem: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.borderLight,
  },
  shareCheckbox: {
    width: 24, height: 24, borderRadius: 6, borderWidth: 2,
    borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
    marginRight: spacing.md,
  },
  shareCheckboxActive: {
    backgroundColor: colors.success, borderColor: colors.success,
  },
  shareItemName: { fontSize: 15, fontFamily: fonts.semiBold, color: colors.text },
  shareItemDetail: { fontSize: 12, fontFamily: fonts.regular, color: colors.textTertiary, marginTop: 2 },

  // Section cards
  sectionCard: {
    backgroundColor: colors.surface, marginHorizontal: spacing.lg, marginTop: spacing.md,
    borderRadius: radii.lg, padding: spacing.lg, ...shadows.sm,
  },
  sectionLabel: { ...typography.sectionLabel, marginBottom: spacing.md },

  // Global remind button
  globalRemindBtn: {
    backgroundColor: colors.successLight, borderRadius: radii.md, padding: spacing.md,
    marginBottom: spacing.md, alignItems: 'center',
  },
  globalRemindBtnText: { fontSize: 14, fontFamily: fonts.bold, color: colors.successDark },
  globalRemindDesc: { fontSize: 11, fontFamily: fonts.regular, color: colors.success, marginTop: 4, textAlign: 'center' },

  // Trigger toggle
  triggerToggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.xs,
  },
  triggerTitle: { fontSize: 14, fontFamily: fonts.semiBold, color: colors.text, marginBottom: 2 },
  triggerDesc: { fontSize: 12, fontFamily: fonts.regular, color: colors.textTertiary, lineHeight: 17 },
  toggleTrack: {
    width: 46, height: 26, borderRadius: 13, backgroundColor: colors.border,
    justifyContent: 'center', paddingHorizontal: 3,
  },
  toggleTrackActive: { backgroundColor: colors.success },
  toggleThumb: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: colors.textInverse,
    elevation: 2,
  },
  toggleThumbActive: { alignSelf: 'flex-end' },

  // Leave button
  leaveBtn: {
    backgroundColor: colors.dangerLight, paddingVertical: spacing.md, borderRadius: radii.md,
    alignItems: 'center', borderWidth: 1, borderColor: '#FECACA',
  },
  leaveBtnText: { fontSize: 15, fontFamily: fonts.bold, color: colors.danger },
});

export default GroupDetailsScreen;
