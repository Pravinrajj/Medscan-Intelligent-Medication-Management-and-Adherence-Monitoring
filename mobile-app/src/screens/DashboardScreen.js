import React, { useState, useCallback, useContext, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  ActivityIndicator, TouchableOpacity, Alert, SafeAreaView,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import api from '../api/client';
import { AuthContext } from '../context/AuthContext';
import MedicationItem from '../components/MedicationItem';
import CircularProgress from '../components/CircularProgress';
import WeekStrip from '../components/WeekStrip';
import StockRing from '../components/StockRing';
import { useToast } from '../components/Toast';
import offlineSyncService from '../services/OfflineSyncService';
import { colors, fonts, spacing, radii, shadows, typography, components } from '../theme';

// Track which bundles are collapsed (persists during session)
let collapsedBundlesState = {};

const formatCacheAge = (isoString) => {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

const FILTER_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'taken', label: 'Taken' },
  { key: 'missed', label: 'Missed' },
];

const DashboardScreen = ({ navigation }) => {
  const { userInfo } = useContext(AuthContext);
  const toast = useToast();

  const [schedules, setSchedules] = useState([]);
  const [stats, setStats] = useState(null);
  const [lowStockItems, setLowStockItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [loggedSchedules, setLoggedSchedules] = useState(new Set());
  const [snoozedSchedules, setSnoozedSchedules] = useState(new Set());
  const [isOnline, setIsOnline] = useState(true);
  const [cachedAt, setCachedAt] = useState(null);
  const [isFromCache, setIsFromCache] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [activeFilter, setActiveFilter] = useState('all');
  const [chartMode, setChartMode] = useState('week'); // 'week' or 'month'

  useEffect(() => {
    const unsub = offlineSyncService.subscribe(status => {
      const wasOffline = !isOnline;
      setIsOnline(status);
      if (wasOffline && status) {
        console.log('[Dashboard] Back online — auto-refreshing');
        fetchData();
      }
    });
    return unsub;
  }, [isOnline]);

  const fetchData = async () => {
    if (!userInfo?.id) return;
    try {
      setError(false);
      setIsFromCache(false);
      const [schedRes, statsRes] = await Promise.all([
        api.get(`/schedules/user/${userInfo.id}`),
        api.get(`/stats/user/${userInfo.id}`),
      ]);
      const schedData = Array.isArray(schedRes.data) ? schedRes.data : [];
      setSchedules(schedData);
      setStats(statsRes.data);

      const lowStock = schedData.filter(s => s.currentStock != null && s.currentStock <= 5);
      setLowStockItems(lowStock);

      const logged = new Set();
      if (statsRes.data?.todayLogs) {
        statsRes.data.todayLogs.forEach(log => logged.add(log.scheduleId));
      }
      setLoggedSchedules(logged);

      // Cache
      const cacheData = {
        schedules: schedData,
        stats: statsRes.data,
        lastUpdated: new Date().toISOString(),
        version: 1,
      };
      AsyncStorage.setItem('dashboard_cache', JSON.stringify(cacheData)).catch(() => {});
      setCachedAt(null);
    } catch (e) {
      console.error('[Dashboard] Fetch failed:', e.message);
      setError(true);
      await loadFromCache();
    } finally {
      setLoading(false);
    }
  };

  const loadFromCache = async () => {
    try {
      const cached = await AsyncStorage.getItem('dashboard_cache');
      if (cached) {
        const data = JSON.parse(cached);
        setSchedules(data.schedules || []);
        setStats(data.stats || null);
        setCachedAt(data.lastUpdated);
        setIsFromCache(true);
        const lowStock = (data.schedules || []).filter(s => s.currentStock != null && s.currentStock <= 5);
        setLowStockItems(lowStock);
        const logged = new Set();
        if (data.stats?.todayLogs) {
          data.stats.todayLogs.forEach(log => logged.add(log.scheduleId));
        }
        setLoggedSchedules(logged);
        setError(false);
      }
    } catch (e) {
      console.log('[Dashboard] Cache load failed:', e.message);
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  // ─── Dose Actions ──────────────────────────────────────────────
  const handleTakeDose = async (scheduleId) => {
    try {
      const result = await offlineSyncService.safePost('/adherence/log', {
        scheduleId, userId: userInfo.id, status: 'TAKEN', timestamp: new Date().toISOString()
      });
      if (result.queued) {
        toast.info('Dose saved offline. Will sync when back online.');
      } else if (result.data?.metadata === 'ALREADY_LOGGED') {
        toast.warning('This dose was already logged today.');
      } else {
        toast.success('Dose recorded as taken.');
      }
      setLoggedSchedules(prev => new Set([...prev, scheduleId]));
      fetchData();
    } catch (e) {
      console.error(e);
      toast.error('Failed to record dose.');
    }
  };

  const handleMissDose = (scheduleId) => {
    Alert.alert(
      "Mark as Missed?",
      "This will record the dose as missed.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Yes, Missed", style: "destructive",
          onPress: async () => {
            try {
              const result = await offlineSyncService.safePost('/adherence/log', {
                scheduleId, userId: userInfo.id, status: 'MISSED', timestamp: new Date().toISOString()
              });
              if (result.queued) {
                toast.info('Saved offline. Will sync when online.');
              } else if (result.data?.metadata === 'ALREADY_LOGGED') {
                toast.warning('This dose was already logged today.');
              } else {
                toast.info('Dose marked as missed.');
              }
              setLoggedSchedules(prev => new Set([...prev, scheduleId]));
              fetchData();
            } catch (e) {
              toast.error('Failed to record.');
            }
          }
        }
      ]
    );
  };

  const handleSnooze = async (scheduleId) => {
    try {
      const result = await offlineSyncService.safePost('/adherence/log', {
        scheduleId, userId: userInfo.id, status: 'SNOOZED', timestamp: new Date().toISOString()
      });
      if (result.data?.metadata === 'ALREADY_LOGGED') {
        toast.warning('This dose was already logged today.');
      } else {
        toast.info('Snoozed. We will remind you later.');
      }
      setSnoozedSchedules(prev => new Set([...prev, scheduleId]));
      fetchData();
    } catch (e) {
      toast.error('Failed to snooze.');
    }
  };

  const handleUndo = (scheduleId) => {
    Alert.alert(
      "Undo Status",
      "This will remove today's recorded status for this medicine. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Undo", style: "destructive",
          onPress: async () => {
            try {
              await api.delete(`/adherence/undo?userId=${userInfo.id}&scheduleId=${scheduleId}`);
              setLoggedSchedules(prev => { const n = new Set(prev); n.delete(scheduleId); return n; });
              setSnoozedSchedules(prev => { const n = new Set(prev); n.delete(scheduleId); return n; });
              toast.success('Status has been reset.');
              fetchData();
            } catch (e) {
              toast.error(e.response?.data?.message || 'Failed to undo.');
            }
          }
        }
      ]
    );
  };

  // ─── Computed Values ───────────────────────────────────────────
  const todayISO = new Date().toISOString().split('T')[0];
  const selectedISO = selectedDate.toISOString().split('T')[0];
  const isToday = todayISO === selectedISO;

  const todayTaken = stats?.takenCount || 0;
  const todayTotal = (stats?.takenCount || 0) + (stats?.missedCount || 0) + (stats?.snoozedCount || 0);
  const todayProgress = todayTotal > 0 ? todayTaken / todayTotal : 0;

  // Weekly adherence from dailyBreakdown
  const weeklyStats = useMemo(() => {
    const breakdown = stats?.dailyBreakdown || [];
    const last7 = breakdown.slice(-7);
    let taken = 0, total = 0;
    last7.forEach(d => {
      taken += d.taken || 0;
      total += (d.taken || 0) + (d.missed || 0) + (d.snoozed || 0);
    });
    return { taken, total, progress: total > 0 ? taken / total : 0 };
  }, [stats?.dailyBreakdown]);

  // Monthly adherence (use all breakdown data)
  const monthlyStats = useMemo(() => {
    const breakdown = stats?.dailyBreakdown || [];
    let taken = 0, total = 0;
    breakdown.forEach(d => {
      taken += d.taken || 0;
      total += (d.taken || 0) + (d.missed || 0) + (d.snoozed || 0);
    });
    return { taken, total, progress: total > 0 ? taken / total : 0 };
  }, [stats?.dailyBreakdown]);

  const currentPeriodStats = chartMode === 'week' ? weeklyStats : monthlyStats;

  // Marked dates (dates with schedules)
  const markedDates = useMemo(() => {
    const set = new Set();
    set.add(todayISO); // Today always marked
    return set;
  }, [todayISO]);

  // Filter schedules
  const filteredSchedules = useMemo(() => {
    let list = Array.isArray(schedules) ? schedules : [];
    if (activeFilter === 'pending') {
      list = list.filter(s => !loggedSchedules.has(s.id));
    } else if (activeFilter === 'taken') {
      list = list.filter(s => loggedSchedules.has(s.id) && !snoozedSchedules.has(s.id));
    } else if (activeFilter === 'missed') {
      // We show missed by looking at logged + status
      list = list.filter(s => loggedSchedules.has(s.id));
    }
    return list;
  }, [schedules, activeFilter, loggedSchedules, snoozedSchedules]);

  // ─── Loading State ─────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (error && schedules.length === 0) {
    return (
      <SafeAreaView style={styles.centered}>
        <MaterialCommunityIcons name="wifi-off" size={48} color={colors.textTertiary} />
        <Text style={styles.errorTitle}>Could Not Load Data</Text>
        <Text style={styles.errorSubtext}>Check your internet connection and make sure the server is running.</Text>
        <TouchableOpacity style={[components.buttonPrimary, { marginTop: spacing.lg }]} onPress={fetchData}>
          <Text style={[typography.button, { color: colors.textInverse }]}>Retry</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ─── Bundle Grouping ───────────────────────────────────────────
  const bundled = {};
  const standalone = [];
  filteredSchedules.forEach(item => {
    if (item.bundleName) {
      if (!bundled[item.bundleName]) bundled[item.bundleName] = [];
      bundled[item.bundleName].push(item);
    } else {
      standalone.push(item);
    }
  });
  const bundleNames = Object.keys(bundled);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ──────────────────────────────────────────── */}
        <View style={styles.header}>
          <View>
            <Text style={styles.welcomeLabel}>Welcome Back,</Text>
            <Text style={styles.username}>{userInfo.fullName || userInfo.username}</Text>
          </View>
          <TouchableOpacity
            style={styles.headerAction}
            onPress={() => navigation.navigate('ScanPrescription')}
          >
            <MaterialCommunityIcons name="line-scan" size={22} color={colors.primary} />
          </TouchableOpacity>
        </View>

        {/* ── Banners ─────────────────────────────────────────── */}
        {!isOnline && (
          <View style={styles.offlineBanner}>
            <MaterialCommunityIcons name="wifi-off" size={14} color={colors.danger} />
            <Text style={styles.bannerText}>Offline — actions saved locally</Text>
          </View>
        )}
        {isFromCache && cachedAt && (
          <View style={styles.cacheBanner}>
            <MaterialCommunityIcons name="database-outline" size={14} color={colors.warning} />
            <Text style={[styles.bannerText, { color: colors.warningDark }]}>Cached data — {formatCacheAge(cachedAt)}</Text>
          </View>
        )}

        {/* ── Dual Circular Charts ────────────────────────────── */}
        <View style={styles.chartsRow}>
          {/* Today's Progress */}
          <View style={styles.chartCard}>
            <Text style={styles.chartLabel}>Today</Text>
            <CircularProgress
              size={110}
              strokeWidth={10}
              progress={todayProgress}
              label={`${todayTaken}/${todayTotal || schedules.length}`}
              sublabel="doses"
            />
            <View style={styles.chartStatsRow}>
              <View style={styles.miniStat}>
                <View style={[styles.miniDot, { backgroundColor: colors.taken }]} />
                <Text style={styles.miniStatText}>{stats?.takenCount || 0}</Text>
              </View>
              <View style={styles.miniStat}>
                <View style={[styles.miniDot, { backgroundColor: colors.missed }]} />
                <Text style={styles.miniStatText}>{stats?.missedCount || 0}</Text>
              </View>
              <View style={styles.miniStat}>
                <View style={[styles.miniDot, { backgroundColor: colors.snoozed }]} />
                <Text style={styles.miniStatText}>{stats?.snoozedCount || 0}</Text>
              </View>
            </View>
          </View>

          {/* Period Progress */}
          <View style={styles.chartCard}>
            <View style={styles.periodToggle}>
              <TouchableOpacity onPress={() => setChartMode('week')}>
                <Text style={[styles.periodBtn, chartMode === 'week' && styles.periodBtnActive]}>Week</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setChartMode('month')}>
                <Text style={[styles.periodBtn, chartMode === 'month' && styles.periodBtnActive]}>Month</Text>
              </TouchableOpacity>
            </View>
            <CircularProgress
              size={110}
              strokeWidth={10}
              progress={currentPeriodStats.progress}
              label={`${Math.round(currentPeriodStats.progress * 100)}%`}
              sublabel="adherence"
            />
            <Text style={styles.periodDetail}>
              {currentPeriodStats.taken}/{currentPeriodStats.total} doses
            </Text>
          </View>
        </View>

        {/* ── Low Stock Alert ─────────────────────────────────── */}
        {lowStockItems.length > 0 && (
          <View style={styles.alertCard}>
            <View style={styles.alertHeader}>
              <MaterialCommunityIcons name="alert-outline" size={18} color={colors.warningDark} />
              <Text style={styles.alertTitle}>Restock Needed</Text>
            </View>
            {lowStockItems.map(item => (
              <Text key={item.id} style={styles.alertText}>
                {item.medicine ? item.medicine.name : 'Medication'} — {item.currentStock} left
              </Text>
            ))}
          </View>
        )}

        {/* ── Week Strip Calendar ─────────────────────────────── */}
        <WeekStrip
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          markedDates={markedDates}
        />

        {/* ── Filter Chips ────────────────────────────────────── */}
        <View style={styles.filterRow}>
          {FILTER_OPTIONS.map(f => (
            <TouchableOpacity
              key={f.key}
              style={[styles.filterChip, activeFilter === f.key && styles.filterChipActive]}
              onPress={() => setActiveFilter(f.key)}
            >
              <Text style={[styles.filterText, activeFilter === f.key && styles.filterTextActive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Section Header ──────────────────────────────────── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>
            {isToday ? "Today's Schedule" : selectedDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </Text>
          <Text style={styles.scheduleCount}>{filteredSchedules.length} items</Text>
        </View>

        {/* ── Schedule List ────────────────────────────────────── */}
        {filteredSchedules.length === 0 ? (
          <View style={styles.emptyContainer}>
            <MaterialCommunityIcons name="pill" size={48} color={colors.textTertiary} style={{ marginBottom: spacing.md }} />
            <Text style={styles.emptyText}>
              {schedules.length === 0
                ? 'No medications scheduled yet'
                : `No ${activeFilter !== 'all' ? activeFilter : ''} medications`}
            </Text>
            <Text style={styles.emptySubtext}>
              {schedules.length === 0
                ? 'Add your first medicine to start tracking'
                : 'Try a different filter'}
            </Text>
            {schedules.length === 0 && (
              <TouchableOpacity
                style={[components.buttonPrimary, { marginTop: spacing.xl }]}
                onPress={() => navigation.navigate('AddMedicine')}
              >
                <Text style={[typography.button, { color: colors.textInverse }]}>Add Medication</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={styles.listContainer}>
            {/* Bundled medicines */}
            {bundleNames.map(bName => {
              const items = bundled[bName];
              const takenCount = items.filter(i => loggedSchedules.has(i.id)).length;
              const isCollapsed = collapsedBundlesState[bName];
              return (
                <View key={bName} style={styles.bundleSection}>
                  <TouchableOpacity
                    style={styles.bundleHeader}
                    activeOpacity={0.7}
                    onPress={() => {
                      collapsedBundlesState = { ...collapsedBundlesState, [bName]: !isCollapsed };
                      setSchedules([...schedules]);
                    }}
                  >
                    <View style={styles.bundleTitleRow}>
                      <MaterialCommunityIcons name="package-variant" size={16} color={colors.primary} />
                      <Text style={styles.bundleTitle}>{bName}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={[
                        styles.bundleCount,
                        takenCount === items.length && { color: colors.success },
                      ]}>
                        {takenCount}/{items.length}
                      </Text>
                      <MaterialCommunityIcons
                        name={isCollapsed ? 'chevron-right' : 'chevron-down'}
                        size={18}
                        color={colors.textTertiary}
                      />
                    </View>
                  </TouchableOpacity>
                  {!isCollapsed && items.map(item => (
                    <MedicationItem
                      key={item.id}
                      schedule={item}
                      onTaken={() => handleTakeDose(item.id)}
                      onMissed={() => handleMissDose(item.id)}
                      onSnooze={() => handleSnooze(item.id)}
                      onUndo={() => handleUndo(item.id)}
                      onPress={() => navigation.navigate('MedicineDetail', { schedule: item })}
                      loggedToday={loggedSchedules.has(item.id)}
                      snoozedToday={snoozedSchedules.has(item.id)}
                    />
                  ))}
                </View>
              );
            })}

            {/* Standalone medicines */}
            {standalone.map(item => (
              <MedicationItem
                key={item.id}
                schedule={item}
                onTaken={() => handleTakeDose(item.id)}
                onMissed={() => handleMissDose(item.id)}
                onSnooze={() => handleSnooze(item.id)}
                onUndo={() => handleUndo(item.id)}
                onPress={() => navigation.navigate('MedicineDetail', { schedule: item })}
                loggedToday={loggedSchedules.has(item.id)}
                snoozedToday={snoozedSchedules.has(item.id)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      {/* FAB — Add Medicine */}
      {schedules.length > 0 && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => navigation.navigate('AddMedicine')}
          activeOpacity={0.8}
        >
          <MaterialCommunityIcons name="plus" size={26} color={colors.textInverse} />
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
};

// ─────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: colors.background, padding: spacing.xxl,
  },
  errorTitle: { ...typography.h3, marginTop: spacing.md, marginBottom: spacing.xs },
  errorSubtext: { ...typography.caption, textAlign: 'center', marginBottom: spacing.lg },

  // Header
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.xl, paddingTop: 50, paddingBottom: spacing.xl,
    backgroundColor: colors.surface,
    borderBottomLeftRadius: radii.xxl, borderBottomRightRadius: radii.xxl,
    ...shadows.sm,
  },
  welcomeLabel: { ...typography.caption, color: colors.textTertiary },
  username: { ...typography.h2, marginTop: 2 },
  headerAction: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.primaryBg, alignItems: 'center', justifyContent: 'center',
  },

  // Banners
  offlineBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.dangerLight, marginHorizontal: spacing.lg, marginTop: spacing.sm,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radii.sm,
    borderLeftWidth: 3, borderLeftColor: colors.danger,
  },
  cacheBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.warningLight, marginHorizontal: spacing.lg, marginTop: spacing.sm,
    paddingVertical: 6, paddingHorizontal: spacing.md, borderRadius: radii.sm,
    borderLeftWidth: 3, borderLeftColor: colors.warning,
  },
  bannerText: { fontSize: 12, fontFamily: fonts.semiBold, color: colors.dangerDark },

  // Charts Row
  chartsRow: {
    flexDirection: 'row', paddingHorizontal: spacing.lg,
    gap: spacing.md, marginTop: spacing.lg, marginBottom: spacing.md,
  },
  chartCard: {
    flex: 1, backgroundColor: colors.surface, borderRadius: radii.xl,
    paddingVertical: spacing.lg, alignItems: 'center',
    ...shadows.sm,
  },
  chartLabel: {
    ...typography.sectionLabel, marginBottom: spacing.sm,
  },
  chartStatsRow: {
    flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm,
  },
  miniStat: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  miniDot: {
    width: 8, height: 8, borderRadius: 4,
  },
  miniStatText: {
    fontSize: 12, fontFamily: fonts.semiBold, color: colors.textSecondary,
  },

  // Period toggle
  periodToggle: {
    flexDirection: 'row', gap: 2, marginBottom: spacing.sm,
    backgroundColor: colors.surfaceHover, borderRadius: radii.full,
    padding: 2,
  },
  periodBtn: {
    fontSize: 11, fontFamily: fonts.semiBold, color: colors.textTertiary,
    paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radii.full,
  },
  periodBtnActive: {
    color: colors.primary, backgroundColor: colors.surface,
  },
  periodDetail: {
    fontSize: 12, fontFamily: fonts.medium, color: colors.textTertiary,
    marginTop: spacing.xs,
  },

  // Alert card
  alertCard: {
    backgroundColor: colors.warningLight, borderRadius: radii.lg,
    padding: spacing.md, marginHorizontal: spacing.lg, marginBottom: spacing.md,
    borderLeftWidth: 4, borderLeftColor: colors.warning,
  },
  alertHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs,
  },
  alertTitle: { ...typography.label, color: colors.warningDark },
  alertText: { ...typography.caption, color: colors.textSecondary, marginLeft: spacing.xxl },

  // Filters
  filterRow: {
    flexDirection: 'row', paddingHorizontal: spacing.lg,
    gap: spacing.sm, marginBottom: spacing.md,
  },
  filterChip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2,
    borderRadius: radii.full, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
  },
  filterChipActive: {
    backgroundColor: colors.primary, borderColor: colors.primary,
  },
  filterText: {
    fontSize: 12, fontFamily: fonts.semiBold, color: colors.textSecondary,
  },
  filterTextActive: {
    color: colors.textInverse,
  },

  // Section header
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.lg, marginBottom: spacing.sm,
  },
  sectionTitle: { ...typography.h3 },
  scheduleCount: { ...typography.small, color: colors.textTertiary },

  // Empty state
  emptyContainer: {
    alignItems: 'center', paddingVertical: spacing.section, paddingHorizontal: spacing.lg,
  },
  emptyText: { ...typography.bodySemiBold, color: colors.textSecondary, marginBottom: spacing.xs },
  emptySubtext: { ...typography.caption, textAlign: 'center' },

  // List
  listContainer: { paddingHorizontal: spacing.lg },

  // Bundle grouping
  bundleSection: {
    marginBottom: spacing.md, backgroundColor: colors.primaryBg,
    borderRadius: radii.lg, padding: spacing.sm + 2,
    borderWidth: 1, borderColor: colors.border,
  },
  bundleHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.sm, paddingBottom: spacing.sm,
    marginBottom: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  bundleTitleRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
  },
  bundleTitle: { fontSize: 14, fontFamily: fonts.bold, color: colors.primary },
  bundleCount: { fontSize: 12, fontFamily: fonts.semiBold, color: colors.textTertiary },

  // FAB
  fab: {
    position: 'absolute', bottom: 90, right: spacing.xl,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
    ...shadows.colored(colors.primary),
  },
});

export default DashboardScreen;
