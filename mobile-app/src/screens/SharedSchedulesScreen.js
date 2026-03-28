import React, { useState, useContext, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  ActivityIndicator, RefreshControl, Alert, Modal
} from 'react-native';
import * as Contacts from 'expo-contacts';
import { useFocusEffect } from '@react-navigation/native';
import api from '../api/client';
import { AuthContext } from '../context/AuthContext';

const SharedSchedulesScreen = ({ route, navigation }) => {
  const { userInfo } = useContext(AuthContext);
  const { group } = route.params || {};
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [contactNameMap, setContactNameMap] = useState({});

  // Share picker modal state
  const [pickerVisible, setPickerVisible] = useState(false);
  const [mySchedules, setMySchedules] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [pickerLoading, setPickerLoading] = useState(false);
  const [sharing, setSharing] = useState(false);

  const isAdmin = group?.admin?.id === userInfo?.id;

  // Load contact names
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Contacts.requestPermissionsAsync();
        if (status !== 'granted') return;
        const { data } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers] });
        const map = {};
        (data || []).forEach(c => {
          (c.phoneNumbers || []).forEach(p => {
            const last10 = (p.number || '').replace(/[\s\-\(\)\+]/g, '').slice(-10);
            if (last10.length >= 10) map[last10] = c.name;
          });
        });
        setContactNameMap(map);
      } catch (e) { /* ignore */ }
    })();
  }, []);

  const fetchSchedules = useCallback(async () => {
    try {
      const res = await api.get(`/groups/${group.id}/shared-schedules`);
      setSchedules(res.data || []);
    } catch (e) {
      console.error('[SharedSchedules] Fetch error:', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [group.id]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchSchedules();
    }, [fetchSchedules])
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchSchedules();
  };

  // Resolve display name from contact or backend
  const resolveSharedByName = (item) => {
    const phone = (item.sharedByPhoneNumber || '').replace(/\D/g, '').slice(-10);
    if (phone && contactNameMap[phone]) return contactNameMap[phone];
    return item.sharedByFullName || item.sharedByUsername || 'Member';
  };

  const handleUnshare = (item) => {
    const scheduleId = item.scheduleId || item.id;
    const medName = item.medicineName || item.medicine?.name || 'this schedule';
    const isOwn = item.sharedByUserId === userInfo?.id;

    if (!isOwn && !isAdmin) {
      Alert.alert('Not Allowed', 'Only the admin or the person who shared can unshare a schedule.');
      return;
    }

    Alert.alert(
      'Unshare Schedule',
      `Remove "${medName}" from this group? The medicine itself won't be deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unshare',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/groups/${group.id}/unshare-schedule/${scheduleId}`);
              setSchedules(prev => prev.filter(s => (s.scheduleId || s.id) !== scheduleId));
              Alert.alert('Done', `"${medName}" has been unshared.`);
            } catch (e) {
              Alert.alert('Error', 'Failed to unshare schedule.');
            }
          },
        },
      ]
    );
  };

  // ─── Share Picker Modal ───
  const openSharePicker = async () => {
    setPickerVisible(true);
    setPickerLoading(true);
    setSelectedIds(new Set());
    try {
      const res = await api.get(`/schedules/user/${userInfo.id}`);
      const allSchedules = res.data || [];
      // Figure out which are already shared
      const alreadySharedIds = new Set(
        schedules
          .filter(s => s.sharedByUserId === userInfo?.id || s.userId === userInfo?.id)
          .map(s => s.scheduleId || s.id)
      );
      // Mark each schedule
      setMySchedules(allSchedules.map(s => ({
        ...s,
        alreadyShared: alreadySharedIds.has(s.id),
      })));
    } catch (e) {
      Alert.alert('Error', 'Failed to load your schedules.');
    } finally {
      setPickerLoading(false);
    }
  };

  const toggleScheduleSelection = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleShareSelected = async () => {
    if (selectedIds.size === 0) {
      Alert.alert('No Selection', 'Please select at least one schedule to share.');
      return;
    }
    setSharing(true);
    try {
      await api.post(`/groups/${group.id}/share-schedules`, {
        userId: userInfo.id,
        scheduleIds: Array.from(selectedIds),
      });
      Alert.alert('Shared!', `${selectedIds.size} schedule(s) shared with the group.`);
      setPickerVisible(false);
      fetchSchedules(); // Refresh the list
    } catch (e) {
      Alert.alert('Error', 'Failed to share schedules.');
    } finally {
      setSharing(false);
    }
  };

  // ─── Render Items ───
  const renderScheduleItem = ({ item }) => {
    const medName = item.medicineName || item.medicine?.name || 'Unknown Medicine';
    const dose = item.doseAmount || item.schedule?.doseAmount || '';
    const unit = item.doseUnit || item.schedule?.doseUnit || '';
    const sharedBy = resolveSharedByName(item);
    const isOwn = item.sharedByUserId === userInfo?.id;
    const times = item.scheduleTimes || item.schedule?.scheduleTimes || [];

    return (
      <View style={styles.scheduleCard}>
        <View style={styles.cardTop}>
          <View style={styles.cardIconCircle}>
            <Text style={{ fontSize: 20 }}>💊</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.medName}>{medName}</Text>
            {(dose || unit) ? (
              <Text style={styles.dosage}>{dose} {unit}</Text>
            ) : null}
          </View>
          {(isOwn || isAdmin) && (
            <TouchableOpacity style={styles.unshareBtn} onPress={() => handleUnshare(item)}>
              <Text style={styles.unshareBtnText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        {times.length > 0 && (
          <View style={styles.timesRow}>
            {times.map((t, idx) => (
              <View key={idx} style={styles.timeChip}>
                <Text style={styles.timeChipText}>
                  ⏰ {t.scheduledTime ? t.scheduledTime.substring(0, 5) : '—'}
                </Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.sharedByRow}>
          <Text style={styles.sharedByText}>
            Shared by {isOwn ? 'you' : sharedBy}
          </Text>
        </View>
      </View>
    );
  };

  const renderPickerItem = ({ item }) => {
    const medName = item.medicine?.name || 'Unknown';
    const dose = item.doseAmount || '';
    const unit = item.doseUnit || '';
    const bundle = item.medicine?.bundle || '';
    const isSelected = selectedIds.has(item.id);
    const isAlready = item.alreadyShared;

    return (
      <TouchableOpacity
        style={[
          styles.pickerItem,
          isAlready && styles.pickerItemDisabled,
          isSelected && styles.pickerItemSelected,
        ]}
        onPress={() => !isAlready && toggleScheduleSelection(item.id)}
        activeOpacity={isAlready ? 1 : 0.7}
        disabled={isAlready}
      >
        <View style={[
          styles.pickerCheckbox,
          isAlready && styles.pickerCheckboxDisabled,
          isSelected && styles.pickerCheckboxSelected,
        ]}>
          {(isSelected || isAlready) && (
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>✓</Text>
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.pickerMedName, isAlready && { color: '#94a3b8' }]}>
            {medName}
          </Text>
          <Text style={styles.pickerDose}>
            {dose} {unit}{bundle ? ` · ${bundle}` : ''}
          </Text>
          {isAlready && (
            <Text style={styles.pickerAlreadyText}>Already shared</Text>
          )}
        </View>
      </TouchableOpacity>
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
      <FlatList
        style={{ flex: 1 }}
        data={schedules}
        renderItem={renderScheduleItem}
        keyExtractor={(item, idx) => String(item.id || item.scheduleId || idx)}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <Text style={styles.listHeaderTitle}>
              {schedules.length} Schedule{schedules.length !== 1 ? 's' : ''} Shared
            </Text>
            <Text style={styles.listHeaderDesc}>
              Shared schedules let group members see each other's medication times and send reminders
            </Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Text style={{ fontSize: 48, marginBottom: 12 }}>📊</Text>
            <Text style={styles.emptyTitle}>No shared schedules</Text>
            <Text style={styles.emptyDesc}>
              Share your medication schedules with the group so members can help track and remind
            </Text>
          </View>
        }
      />

      {/* Share button — fixed bottom bar */}
      <View style={styles.bottomBar}>
        <TouchableOpacity style={styles.shareBtn} onPress={openSharePicker} activeOpacity={0.8}>
          <Text style={styles.shareBtnText}>📊 Share My Schedules</Text>
        </TouchableOpacity>
      </View>

      {/* ─── Share Picker Modal ─── */}
      <Modal visible={pickerVisible} animationType="slide" transparent onRequestClose={() => setPickerVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Share Schedules</Text>
            <Text style={styles.modalSubtitle}>
              Select which of your medication schedules to share with this group
            </Text>

            {pickerLoading ? (
              <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                <ActivityIndicator size="large" color="#2563eb" />
                <Text style={{ color: '#94a3b8', marginTop: 12 }}>Loading your schedules...</Text>
              </View>
            ) : mySchedules.length === 0 ? (
              <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                <Text style={{ fontSize: 36, marginBottom: 8 }}>📋</Text>
                <Text style={{ fontSize: 15, fontWeight: '600', color: '#64748b' }}>No schedules found</Text>
                <Text style={{ fontSize: 13, color: '#94a3b8', marginTop: 4, textAlign: 'center' }}>
                  Add medicines to your dashboard first, then share them here
                </Text>
              </View>
            ) : (
              <FlatList
                data={mySchedules}
                renderItem={renderPickerItem}
                keyExtractor={(item) => String(item.id)}
                style={{ maxHeight: 350 }}
                contentContainerStyle={{ paddingVertical: 8 }}
              />
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalCancelBtn]}
                onPress={() => setPickerVisible(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              {mySchedules.length > 0 && (
                <TouchableOpacity
                  style={[
                    styles.modalBtn, styles.modalShareBtn,
                    selectedIds.size === 0 && { opacity: 0.5 },
                  ]}
                  onPress={handleShareSelected}
                  disabled={selectedIds.size === 0 || sharing}
                >
                  {sharing ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.modalShareText}>
                      Share {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
                    </Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f9fc' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { padding: 16, paddingBottom: 16 },

  listHeader: { marginBottom: 16 },
  listHeaderTitle: { fontSize: 18, fontWeight: '700', color: '#1e293b' },
  listHeaderDesc: { fontSize: 13, color: '#94a3b8', marginTop: 4, lineHeight: 19 },

  // Schedule card
  scheduleCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 10,
    elevation: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 3,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardIconCircle: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: '#ecfdf5',
    alignItems: 'center', justifyContent: 'center',
  },
  medName: { fontSize: 16, fontWeight: '700', color: '#1e293b' },
  dosage: { fontSize: 13, color: '#64748b', marginTop: 2 },

  unshareBtn: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: '#fef2f2',
    alignItems: 'center', justifyContent: 'center',
  },
  unshareBtnText: { color: '#dc2626', fontSize: 14, fontWeight: '700' },

  timesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  timeChip: {
    backgroundColor: '#f0f9ff', paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 8, borderWidth: 1, borderColor: '#bae6fd',
  },
  timeChipText: { fontSize: 12, color: '#0369a1', fontWeight: '600' },

  sharedByRow: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  sharedByText: { fontSize: 12, color: '#94a3b8' },

  // Bottom bar
  bottomBar: {
    padding: 16, paddingBottom: 14, marginBottom: 60,
  },
  shareBtn: {
    backgroundColor: '#2563eb', paddingVertical: 14, borderRadius: 14,
    alignItems: 'center', elevation: 4,
    shadowColor: '#2563eb', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8,
  },
  shareBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  // Empty
  emptyBox: { alignItems: 'center', paddingTop: 50, paddingHorizontal: 30 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#1e293b', marginBottom: 8 },
  emptyDesc: { fontSize: 13, color: '#94a3b8', textAlign: 'center', lineHeight: 20 },

  // ─── Picker Modal ───
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 30,
    maxHeight: '80%',
  },
  modalTitle: { fontSize: 20, fontWeight: '800', color: '#1e293b', marginBottom: 4 },
  modalSubtitle: { fontSize: 13, color: '#94a3b8', marginBottom: 16 },

  // Picker item
  pickerItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, paddingHorizontal: 4,
    borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
  },
  pickerItemDisabled: { opacity: 0.5 },
  pickerItemSelected: { backgroundColor: '#eff6ff' },

  pickerCheckbox: {
    width: 24, height: 24, borderRadius: 6,
    borderWidth: 2, borderColor: '#cbd5e1',
    alignItems: 'center', justifyContent: 'center',
  },
  pickerCheckboxDisabled: { backgroundColor: '#e2e8f0', borderColor: '#e2e8f0' },
  pickerCheckboxSelected: { backgroundColor: '#2563eb', borderColor: '#2563eb' },

  pickerMedName: { fontSize: 15, fontWeight: '600', color: '#1e293b' },
  pickerDose: { fontSize: 12, color: '#64748b', marginTop: 2 },
  pickerAlreadyText: { fontSize: 11, color: '#059669', fontWeight: '600', marginTop: 2 },

  // Modal actions
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  modalBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  modalCancelBtn: { backgroundColor: '#f1f5f9' },
  modalCancelText: { fontSize: 15, fontWeight: '600', color: '#64748b' },
  modalShareBtn: { backgroundColor: '#2563eb' },
  modalShareText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});

export default SharedSchedulesScreen;
