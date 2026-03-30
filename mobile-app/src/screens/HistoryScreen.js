import React, { useContext, useState, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  RefreshControl, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import api from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { useFocusEffect } from '@react-navigation/native';
import { colors, fonts, spacing, radii, shadows, typography, components } from '../theme';

const STATUS_CONFIG = {
  TAKEN:   { color: colors.taken,   icon: 'check-circle',  verb: 'took',    bg: colors.successLight },
  MISSED:  { color: colors.missed,  icon: 'close-circle',  verb: 'missed',  bg: colors.dangerLight },
  SNOOZED: { color: colors.snoozed, icon: 'clock-outline', verb: 'snoozed', bg: colors.warningLight },
};

const TYPE_ICONS = {
  TABLET: 'pill', CAPSULE: 'pill', SYRUP: 'bottle-tonic',
  INJECTION: 'needle', DROPS: 'eyedropper', INHALER: 'lungs',
  CREAM: 'lotion-outline', OTHER: 'medical-bag',
};

const HistoryScreen = ({ navigation }) => {
  const { userInfo } = useContext(AuthContext);
  const [tab, setTab] = useState('active'); // 'active' or 'history'
  const [schedules, setSchedules] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [historyFilter, setHistoryFilter] = useState('All');

  const fetchData = async () => {
    try {
      const [schedRes, histRes] = await Promise.all([
        api.get(`/schedules/user/${userInfo.id}`),
        api.get(`/adherence/user/${userInfo.id}`),
      ]);
      setSchedules(Array.isArray(schedRes.data) ? schedRes.data : []);
      setHistory(Array.isArray(histRes.data) ? histRes.data : []);
    } catch (e) {
      console.error('[Medicines] Fetch failed:', e.message);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => { setLoading(true); fetchData(); }, [userInfo])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [userInfo]);

  const handleDelete = (scheduleId, medicineName) => {
    Alert.alert(
      'Delete Schedule',
      `Remove ${medicineName} from your medications?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/schedules/${scheduleId}`);
              setSchedules(prev => prev.filter(s => s.id !== scheduleId));
            } catch (e) {
              Alert.alert('Error', 'Failed to delete schedule.');
            }
          },
        },
      ]
    );
  };

  // Group schedules by bundle
  const groupedSchedules = schedules.reduce((acc, s) => {
    const key = s.bundleName || '__standalone';
    if (!acc[key]) acc[key] = [];
    acc[key].push(s);
    return acc;
  }, {});

  // History filtered + grouped by date
  const filteredHistory = historyFilter === 'All' ? history : history.filter(h => h.status === historyFilter);
  const groupedByDate = filteredHistory.reduce((groups, item) => {
    const date = new Date(item.timestamp).toLocaleDateString('en-IN', {
      weekday: 'short', day: 'numeric', month: 'short',
    });
    if (!groups[date]) groups[date] = [];
    groups[date].push(item);
    return groups;
  }, {});
  const historySections = Object.entries(groupedByDate);

  // ─── Render Schedule Card ──────────────────────────────────────
  const renderScheduleCard = (item) => {
    const medicine = item.medicine || {};
    const medType = (medicine.type || 'OTHER').toUpperCase();
    const typeIcon = TYPE_ICONS[medType] || 'medical-bag';
    const times = (item.scheduleTimes || []).map(t => (t.scheduledTime || '').substring(0, 5)).filter(Boolean);
    const dosage = `${item.doseAmount || '1'} ${item.doseUnit || 'Dose'}`;

    return (
      <TouchableOpacity
        key={item.id}
        style={styles.schedCard}
        onPress={() => navigation.navigate('MedicineDetail', { schedule: item })}
        activeOpacity={0.7}
      >
        <View style={styles.schedRow}>
          <View style={styles.schedIcon}>
            <MaterialCommunityIcons name={typeIcon} size={18} color={colors.primary} />
          </View>
          <View style={styles.schedInfo}>
            <Text style={styles.schedName} numberOfLines={1}>{medicine.name || 'Medication'}</Text>
            <Text style={styles.schedDosage}>{dosage} {item.frequencyType === 'AS_NEEDED' ? '· As Needed' : ''}</Text>
            {times.length > 0 && (
              <View style={styles.schedTimes}>
                <MaterialCommunityIcons name="clock-outline" size={12} color={colors.textTertiary} />
                <Text style={styles.schedTimeText}>{times.join(' · ')}</Text>
              </View>
            )}
          </View>
          <View style={styles.schedActions}>
            <TouchableOpacity
              onPress={() => navigation.navigate('EditSchedule', { schedule: item })}
              style={styles.schedActionBtn}
            >
              <MaterialCommunityIcons name="pencil-outline" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleDelete(item.id, medicine.name || 'this medicine')}
              style={styles.schedActionBtn}
            >
              <MaterialCommunityIcons name="trash-can-outline" size={18} color={colors.danger} />
            </TouchableOpacity>
          </View>
        </View>
        {item.currentStock != null && (
          <View style={[styles.stockBar, item.currentStock <= 5 && styles.stockBarLow]}>
            <MaterialCommunityIcons
              name={item.currentStock <= 5 ? 'alert-outline' : 'package-variant'}
              size={12}
              color={item.currentStock <= 5 ? colors.danger : colors.textTertiary}
            />
            <Text style={[styles.stockBarText, item.currentStock <= 5 && { color: colors.danger }]}>
              {item.currentStock} remaining
            </Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  // ─── Render History Item ───────────────────────────────────────
  const renderHistoryItem = (item) => {
    const time = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const config = STATUS_CONFIG[item.status] || { color: colors.textTertiary, icon: 'circle', verb: 'recorded', bg: colors.surfaceHover };

    return (
      <View style={styles.timelineItem} key={item.id}>
        <View style={styles.timelineLeft}>
          <View style={[styles.timelineDot, { backgroundColor: config.color }]}>
            <MaterialCommunityIcons name={config.icon} size={12} color={colors.textInverse} />
          </View>
          <View style={styles.timelineLine} />
        </View>
        <View style={styles.timelineCard}>
          <View style={styles.timelineCardHeader}>
            <Text style={styles.medicineName} numberOfLines={1}>{item.medicineName || 'Medication'}</Text>
            <View style={[styles.statusBadge, { backgroundColor: config.bg }]}>
              <Text style={[styles.statusText, { color: config.color }]}>{config.verb}</Text>
            </View>
          </View>
          <Text style={styles.timeText}>{time}</Text>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Medicines</Text>
        <TouchableOpacity style={styles.addButton} onPress={() => navigation.navigate('AddMedicine')}>
          <MaterialCommunityIcons name="plus" size={20} color={colors.textInverse} />
        </TouchableOpacity>
      </View>

      {/* Tab Toggle */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'active' && styles.tabBtnActive]}
          onPress={() => setTab('active')}
        >
          <MaterialCommunityIcons
            name="pill"
            size={16}
            color={tab === 'active' ? colors.primary : colors.textTertiary}
          />
          <Text style={[styles.tabText, tab === 'active' && styles.tabTextActive]}>
            Active ({schedules.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'history' && styles.tabBtnActive]}
          onPress={() => setTab('history')}
        >
          <MaterialCommunityIcons
            name="history"
            size={16}
            color={tab === 'history' ? colors.primary : colors.textTertiary}
          />
          <Text style={[styles.tabText, tab === 'history' && styles.tabTextActive]}>
            History
          </Text>
        </TouchableOpacity>
      </View>

      {/* ─── Active Tab ─── */}
      {tab === 'active' && (
        <FlatList
          data={Object.entries(groupedSchedules)}
          keyExtractor={([key]) => key}
          renderItem={({ item: [bundleName, items] }) => (
            <View style={styles.schedSection}>
              {bundleName !== '__standalone' && (
                <View style={styles.bundleBadge}>
                  <MaterialCommunityIcons name="package-variant" size={13} color={colors.primary} />
                  <Text style={styles.bundleText}>{bundleName}</Text>
                </View>
              )}
              {items.map(s => renderScheduleCard(s))}
            </View>
          )}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
          contentContainerStyle={{ paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <MaterialCommunityIcons name="pill-off" size={48} color={colors.textTertiary} />
              <Text style={styles.emptyTitle}>No active medications</Text>
              <Text style={styles.emptySub}>Add your first medicine to start tracking</Text>
              <TouchableOpacity
                style={[components.buttonPrimary, { marginTop: spacing.lg }]}
                onPress={() => navigation.navigate('AddMedicine')}
              >
                <Text style={[typography.button, { color: colors.textInverse }]}>Add Medication</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}

      {/* ─── History Tab ─── */}
      {tab === 'history' && (
        <>
          {/* Filter chips */}
          <View style={styles.filterBar}>
            {['All', 'TAKEN', 'MISSED', 'SNOOZED'].map(opt => (
              <TouchableOpacity
                key={opt}
                style={[styles.filterBtn, historyFilter === opt && styles.filterBtnActive]}
                onPress={() => setHistoryFilter(opt)}
              >
                {opt !== 'All' && (
                  <View style={[styles.filterDot, { backgroundColor: STATUS_CONFIG[opt]?.color }]} />
                )}
                <Text style={[styles.filterText, historyFilter === opt && styles.filterTextActive]}>
                  {opt === 'All' ? 'All' : opt.charAt(0) + opt.slice(1).toLowerCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {historySections.length === 0 ? (
            <View style={styles.emptyState}>
              <MaterialCommunityIcons name="clipboard-text-outline" size={48} color={colors.textTertiary} />
              <Text style={styles.emptyTitle}>No history recorded</Text>
              <Text style={styles.emptySub}>Your medication activity will appear here</Text>
            </View>
          ) : (
            <FlatList
              data={historySections}
              keyExtractor={(item) => item[0]}
              renderItem={({ item }) => (
                <View style={styles.dateSection}>
                  <View style={styles.dateBadge}>
                    <MaterialCommunityIcons name="calendar" size={12} color={colors.primary} />
                    <Text style={styles.dateText}>{item[0]}</Text>
                  </View>
                  {item[1].map(log => renderHistoryItem(log))}
                </View>
              )}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
              contentContainerStyle={{ paddingBottom: 100 }}
              showsVerticalScrollIndicator={false}
            />
          )}
        </>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: colors.background,
  },

  // Header
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
    backgroundColor: colors.surface,
  },
  title: { fontSize: 24, fontFamily: fonts.bold, color: colors.text },
  addButton: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
    ...shadows.colored(colors.primary),
  },

  // Tabs
  tabRow: {
    flexDirection: 'row', paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm, gap: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1, borderBottomColor: colors.borderLight,
  },
  tabBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingVertical: spacing.xs + 2, paddingHorizontal: spacing.md,
    borderRadius: radii.full, backgroundColor: colors.surfaceHover,
  },
  tabBtnActive: {
    backgroundColor: colors.primaryBg,
  },
  tabText: { fontSize: 13, fontFamily: fonts.semiBold, color: colors.textTertiary },
  tabTextActive: { color: colors.primary },

  // Schedule cards (Active tab)
  schedSection: { paddingHorizontal: spacing.lg, marginTop: spacing.md },
  bundleBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: colors.primaryBg, paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md, borderRadius: radii.full,
    alignSelf: 'flex-start', marginBottom: spacing.sm,
  },
  bundleText: { fontSize: 12, fontFamily: fonts.bold, color: colors.primary },

  schedCard: {
    backgroundColor: colors.surface, borderRadius: radii.lg,
    padding: spacing.md, marginBottom: spacing.sm,
    ...shadows.sm,
  },
  schedRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
  },
  schedIcon: {
    width: 40, height: 40, borderRadius: radii.md,
    backgroundColor: colors.primaryBg, alignItems: 'center', justifyContent: 'center',
  },
  schedInfo: { flex: 1 },
  schedName: { fontSize: 15, fontFamily: fonts.bold, color: colors.text },
  schedDosage: { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary, marginTop: 1 },
  schedTimes: {
    flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3,
  },
  schedTimeText: { fontSize: 11, fontFamily: fonts.semiBold, color: colors.textTertiary },

  schedActions: { flexDirection: 'row', gap: spacing.xs },
  schedActionBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: colors.surfaceHover, alignItems: 'center', justifyContent: 'center',
  },

  stockBar: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: spacing.sm, paddingTop: spacing.xs,
    borderTopWidth: 1, borderTopColor: colors.borderLight,
  },
  stockBarLow: { borderTopColor: colors.dangerLight },
  stockBarText: { fontSize: 11, fontFamily: fonts.medium, color: colors.textTertiary },

  // Filters (History tab)
  filterBar: {
    flexDirection: 'row', paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm, gap: spacing.sm,
  },
  filterBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingVertical: spacing.xs + 2, paddingHorizontal: spacing.md,
    borderRadius: radii.full, backgroundColor: colors.surfaceHover,
  },
  filterBtnActive: { backgroundColor: colors.primary },
  filterDot: { width: 7, height: 7, borderRadius: 3.5 },
  filterText: { fontSize: 12, fontFamily: fonts.semiBold, color: colors.textSecondary },
  filterTextActive: { color: colors.textInverse },

  // Timeline (History tab)
  dateSection: { paddingHorizontal: spacing.xl, marginTop: spacing.md },
  dateBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: colors.primaryBg, paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md, borderRadius: radii.full,
    alignSelf: 'flex-start', marginBottom: spacing.sm,
  },
  dateText: { fontSize: 12, fontFamily: fonts.bold, color: colors.primary },

  timelineItem: { flexDirection: 'row', marginBottom: spacing.xs },
  timelineLeft: { width: 24, alignItems: 'center' },
  timelineDot: {
    width: 20, height: 20, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  timelineLine: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 2 },

  timelineCard: {
    flex: 1, marginLeft: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radii.md,
    padding: spacing.sm + 2, marginBottom: spacing.xs,
    ...shadows.sm,
  },
  timelineCardHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  medicineName: { fontSize: 13, fontFamily: fonts.semiBold, color: colors.text, flex: 1 },
  statusBadge: {
    paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radii.full,
  },
  statusText: { fontSize: 10, fontFamily: fonts.bold },
  timeText: { fontSize: 11, fontFamily: fonts.regular, color: colors.textTertiary, marginTop: 2 },

  // Empty
  emptyState: {
    flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xxl,
  },
  emptyTitle: { fontSize: 16, fontFamily: fonts.bold, color: colors.textSecondary, marginTop: spacing.md },
  emptySub: { fontSize: 13, fontFamily: fonts.regular, color: colors.textTertiary, marginTop: spacing.xs, textAlign: 'center' },
});

export default HistoryScreen;
