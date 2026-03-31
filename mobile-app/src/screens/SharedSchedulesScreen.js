import React, { useState, useContext, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  ActivityIndicator, RefreshControl, Alert, Modal
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Contacts from 'expo-contacts';
import { useFocusEffect } from '@react-navigation/native';
import api from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { colors, fonts, spacing, radii, shadows, typography } from '../theme';
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
            <MaterialCommunityIcons name="pill" size={20} color={colors.primary} />
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
                  <MaterialCommunityIcons name="clock-outline" size={12} color={colors.textSecondary} /> {t.scheduledTime ? t.scheduledTime.substring(0, 5) : '—'}
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
            <Text style={{ color: colors.textInverse, fontSize: 12, fontFamily: fonts.bold }}>✓</Text>
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.pickerMedName, isAlready && { color: colors.textTertiary }]}>
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
        <ActivityIndicator size="large" color={colors.primary} />
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
            <MaterialCommunityIcons name="chart-bar" size={48} color={colors.textTertiary} style={{marginBottom: 12}} />
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
          <Text style={styles.shareBtnText}><MaterialCommunityIcons name="chart-bar" size={15} color={colors.textInverse} /> Share My Schedules</Text>
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
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={{ color: colors.textTertiary, marginTop: 12, fontFamily: fonts.regular }}>Loading your schedules...</Text>
              </View>
            ) : mySchedules.length === 0 ? (
              <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                <MaterialCommunityIcons name="clipboard-text-outline" size={36} color={colors.textTertiary} style={{ marginBottom: 8 }} />
                <Text style={{ fontSize: 15, fontFamily: fonts.semiBold, color: colors.textSecondary }}>No schedules found</Text>
                <Text style={{ fontSize: 13, fontFamily: fonts.regular, color: colors.textTertiary, marginTop: 4, textAlign: 'center' }}>
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
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { padding: spacing.lg, paddingBottom: 120 },

  listHeader: { marginBottom: spacing.lg },
  listHeaderTitle: { fontSize: 18, fontFamily: fonts.bold, color: colors.text },
  listHeaderDesc: { fontSize: 13, fontFamily: fonts.regular, color: colors.textTertiary, marginTop: 4, lineHeight: 19 },

  scheduleCard: {
    backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, marginBottom: spacing.sm + 2,
    ...shadows.sm,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardIconCircle: {
    width: 44, height: 44, borderRadius: radii.md, backgroundColor: colors.successLight,
    alignItems: 'center', justifyContent: 'center',
  },
  medName: { fontSize: 16, fontFamily: fonts.bold, color: colors.text },
  dosage: { fontSize: 13, fontFamily: fonts.regular, color: colors.textSecondary, marginTop: 2 },

  unshareBtn: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: colors.dangerLight,
    alignItems: 'center', justifyContent: 'center',
  },
  unshareBtnText: { color: colors.danger, fontSize: 14, fontFamily: fonts.bold },

  timesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm + 2 },
  timeChip: {
    backgroundColor: colors.primaryBg, paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs + 1,
    borderRadius: radii.sm,
  },
  timeChipText: { fontSize: 12, fontFamily: fonts.semiBold, color: colors.primary },

  sharedByRow: { marginTop: spacing.sm + 2, paddingTop: spacing.sm + 2, borderTopWidth: 1, borderTopColor: colors.borderLight },
  sharedByText: { fontSize: 12, fontFamily: fonts.regular, color: colors.textTertiary },

  bottomBar: { padding: spacing.lg, paddingBottom: spacing.md, marginBottom: 100 },
  shareBtn: {
    backgroundColor: colors.primary, paddingVertical: spacing.md, borderRadius: radii.lg,
    alignItems: 'center', ...shadows.colored(colors.primary),
  },
  shareBtnText: { color: colors.textInverse, fontSize: 16, fontFamily: fonts.bold },

  emptyBox: { alignItems: 'center', paddingTop: 50, paddingHorizontal: spacing.xxl },
  emptyTitle: { fontSize: 18, fontFamily: fonts.bold, color: colors.text, marginBottom: spacing.sm },
  emptyDesc: { fontSize: 13, fontFamily: fonts.regular, color: colors.textTertiary, textAlign: 'center', lineHeight: 20 },

  modalOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: colors.surface, borderTopLeftRadius: radii.xxl, borderTopRightRadius: radii.xxl,
    padding: spacing.xxl, paddingBottom: spacing.xxl + 6, maxHeight: '80%',
  },
  modalTitle: { fontSize: 20, fontFamily: fonts.bold, color: colors.text, marginBottom: 4 },
  modalSubtitle: { fontSize: 13, fontFamily: fonts.regular, color: colors.textTertiary, marginBottom: spacing.lg },

  pickerItem: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.md, paddingHorizontal: spacing.xs,
    borderBottomWidth: 1, borderBottomColor: colors.borderLight,
  },
  pickerItemDisabled: { opacity: 0.5 },
  pickerItemSelected: { backgroundColor: colors.primaryBg },

  pickerCheckbox: {
    width: 24, height: 24, borderRadius: 6,
    borderWidth: 2, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  pickerCheckboxDisabled: { backgroundColor: colors.surfaceHover, borderColor: colors.surfaceHover },
  pickerCheckboxSelected: { backgroundColor: colors.primary, borderColor: colors.primary },

  pickerMedName: { fontSize: 15, fontFamily: fonts.semiBold, color: colors.text },
  pickerDose: { fontSize: 12, fontFamily: fonts.regular, color: colors.textSecondary, marginTop: 2 },
  pickerAlreadyText: { fontSize: 11, fontFamily: fonts.semiBold, color: colors.success, marginTop: 2 },

  modalActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  modalBtn: { flex: 1, paddingVertical: spacing.md, borderRadius: radii.md, alignItems: 'center' },
  modalCancelBtn: { backgroundColor: colors.surfaceHover },
  modalCancelText: { fontSize: 15, fontFamily: fonts.semiBold, color: colors.textSecondary },
  modalShareBtn: { backgroundColor: colors.primary },
  modalShareText: { fontSize: 15, fontFamily: fonts.bold, color: colors.textInverse },
});

export default SharedSchedulesScreen;
