import React, { useState, useCallback, useContext, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import api from '../api/client';
import { AuthContext } from '../context/AuthContext';
import MedicationItem from '../components/MedicationItem';
import AdherenceChart from '../components/AdherenceChart';
import offlineSyncService from '../services/OfflineSyncService';

// B1: Track which bundles are collapsed
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

const DashboardScreen = ({ navigation }) => {
  const { userInfo } = useContext(AuthContext);

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

      // Track low stock items
      const lowStock = schedData.filter(s => s.currentStock != null && s.currentStock <= 5);
      setLowStockItems(lowStock);

      // Track already-logged schedules for today
      const logged = new Set();
      if (statsRes.data?.todayLogs) {
        statsRes.data.todayLogs.forEach(log => logged.add(log.scheduleId));
      }
      setLoggedSchedules(logged);

      // Cache to AsyncStorage
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
        console.log('[Dashboard] Loaded from cache, last updated:', data.lastUpdated);
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

  const handleTakeDose = async (scheduleId) => {
    try {
        const result = await offlineSyncService.safePost('/adherence/log', {
            scheduleId,
            userId: userInfo.id,
            status: 'TAKEN',
            timestamp: new Date().toISOString()
        });
        if (result.queued) {
          Alert.alert("Saved Offline", "Dose will be synced when you're back online.");
        } else if (result.data?.metadata === 'ALREADY_LOGGED') {
          Alert.alert("Already Recorded", "This dose was already logged today.");
        } else {
          Alert.alert("Great Job!", "Dose recorded as Taken.");
        }
        setLoggedSchedules(prev => new Set([...prev, scheduleId]));
        fetchData(); 
    } catch (e) {
        console.error(e);
        Alert.alert("Error", "Failed to record dose.");
    }
  };

  const handleMissDose = (scheduleId) => {
    Alert.alert(
      "Mark as Missed?",
      "This will record the dose as missed.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Yes, Missed",
          style: "destructive",
          onPress: async () => {
            try {
              const result = await offlineSyncService.safePost('/adherence/log', {
                scheduleId,
                userId: userInfo.id,
                status: 'MISSED',
                timestamp: new Date().toISOString()
              });
              if (result.queued) {
                Alert.alert("Saved Offline", "Will sync when online.");
              } else if (result.data?.metadata === 'ALREADY_LOGGED') {
                Alert.alert("Already Recorded", "This dose was already logged today.");
              } else {
                Alert.alert("Recorded", "Dose marked as missed.");
              }
              setLoggedSchedules(prev => new Set([...prev, scheduleId]));
              fetchData();
            } catch (e) {
              console.error(e);
              Alert.alert("Error", "Failed to record.");
            }
          }
        }
      ]
    );
  };

  const handleSnooze = async (scheduleId) => {
    try {
      const result = await offlineSyncService.safePost('/adherence/log', {
        scheduleId,
        userId: userInfo.id,
        status: 'SNOOZED',
        timestamp: new Date().toISOString()
      });
      if (result.data?.metadata === 'ALREADY_LOGGED') {
        Alert.alert("Already Recorded", "This dose was already logged today.");
      } else {
        Alert.alert("Snoozed ⏰", "We'll remind you again later.");
      }
      setSnoozedSchedules(prev => new Set([...prev, scheduleId]));
      fetchData();
    } catch (e) {
      console.error(e);
      Alert.alert("Error", "Failed to snooze.");
    }
  };

  const handleUndo = async (scheduleId) => {
    Alert.alert(
      "Undo Status",
      "This will remove today's recorded status for this medicine. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Undo",
          style: "destructive",
          onPress: async () => {
            try {
              await api.delete(`/adherence/undo?userId=${userInfo.id}&scheduleId=${scheduleId}`);
              setLoggedSchedules(prev => {
                const next = new Set(prev);
                next.delete(scheduleId);
                return next;
              });
              setSnoozedSchedules(prev => {
                const next = new Set(prev);
                next.delete(scheduleId);
                return next;
              });
              Alert.alert("Undone", "Status has been reset. You can re-record it.");
              fetchData();
            } catch (e) {
              Alert.alert("Error", e.response?.data?.message || "Failed to undo.");
            }
          }
        }
      ]
    );
  };

  if (loading) {
     return <View style={styles.centered}><ActivityIndicator size="large" color="#4a90e2" /></View>;
  }

  if (error && schedules.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={{fontSize: 40, marginBottom: 10}}>📡</Text>
        <Text style={{fontSize: 16, fontWeight: '600', color: '#2c3e50', marginBottom: 6}}>Could Not Load Data</Text>
        <Text style={{color: '#7f8c8d', marginBottom: 16, textAlign: 'center'}}>Check your internet connection and make sure the server is running.</Text>
        <TouchableOpacity style={{backgroundColor: '#4a90e2', paddingVertical: 10, paddingHorizontal: 24, borderRadius: 8}} onPress={fetchData}>
          <Text style={{color: '#fff', fontWeight: '600'}}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const getAdherenceColor = (rate) => {
      if (rate >= 80) return '#2ecc71'; 
      if (rate >= 50) return '#f1c40f'; 
      return '#e74c3c'; 
  };

  return (
    <View style={styles.container}>
      <ScrollView 
        refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        <View style={styles.header}>
            <View>
                <Text style={styles.welcomeLabel}>Welcome Back,</Text>
                <Text style={styles.username}>{userInfo.fullName || userInfo.username}</Text>
            </View>
        </View>

        {/* Offline / Cache banners — compact, non-overlapping */}
        {!isOnline && (
          <View style={styles.offlineBanner}>
            <Text style={styles.offlineBannerText}>📡 Offline — actions saved locally</Text>
          </View>
        )}
        {isFromCache && cachedAt && (
          <View style={styles.cacheBanner}>
            <Text style={styles.cacheBannerText}>📦 Cached data — {formatCacheAge(cachedAt)}</Text>
          </View>
        )}

        {/* Low Stock Alert */}
        {lowStockItems.length > 0 && (
            <View style={styles.alertCard}>
                <Text style={styles.alertTitle}>⚠️ Restock Needed</Text>
                {lowStockItems.map(item => (
                    <Text key={item.id} style={styles.alertText}>
                        • {item.medicine ? item.medicine.name : 'Medication'} is running low ({item.currentStock} left)
                    </Text>
                ))}
            </View>
        )}
        
        {/* ===== STATS & CHART — below schedules ===== */}
        {stats && (
            <View style={styles.statsCompact}>
                <View style={styles.statsRow}>
                    <View style={styles.statPill}>
                        <Text style={[styles.statPillValue, { color: getAdherenceColor(stats.adherenceRate || 0) }]}>
                            {stats.adherenceRate || 0}%
                        </Text>
                        <Text style={styles.statPillLabel}>Adherence</Text>
                    </View>
                    <View style={styles.statPill}>
                        <Text style={styles.statPillValue}>{stats.takenCount || 0}</Text>
                        <Text style={styles.statPillLabel}>Taken</Text>
                    </View>
                    <View style={styles.statPill}>
                        <Text style={styles.statPillValue}>{stats.snoozedCount || 0}</Text>
                        <Text style={styles.statPillLabel}>Snoozed</Text>
                    </View>
                    <View style={styles.statPill}>
                        <Text style={styles.statPillValue}>{stats.missedCount || 0}</Text>
                        <Text style={styles.statPillLabel}>Missed</Text>
                    </View>
                </View>
            </View>
        )}

        {/* Weekly Chart */}
        <AdherenceChart dailyBreakdown={stats?.dailyBreakdown} />

        {/* ===== SCHEDULES FIRST — the primary content ===== */}
        <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Today's Schedule</Text>
            <TouchableOpacity onPress={() => navigation.navigate('ScanPrescription')}>
                <Text style={styles.scanLink}>📷 Scan</Text>
            </TouchableOpacity>
        </View>
        
        {schedules.length === 0 ? (
           <View style={styles.emptyContainer}>
               <Text style={styles.emptyIcon}>💊</Text>
               <Text style={styles.emptyText}>No medications scheduled yet</Text>
               <Text style={styles.emptySubtext}>Add your first medicine to start tracking</Text>
               <TouchableOpacity style={styles.addMedBtn} onPress={() => navigation.navigate('AddMedicine')}>
                   <Text style={styles.addMedText}>+ Add Medication</Text>
               </TouchableOpacity>
           </View>
        ) : (() => {
            // B3: Group schedules by bundle
            const bundled = {};
            const standalone = [];
            (Array.isArray(schedules) ? schedules : []).forEach(item => {
              if (item.bundleName) {
                if (!bundled[item.bundleName]) bundled[item.bundleName] = [];
                bundled[item.bundleName].push(item);
              } else {
                standalone.push(item);
              }
            });
            const bundleNames = Object.keys(bundled);

            return (
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
                        // Force re-render
                        setSchedules([...schedules]);
                      }}
                    >
                      <Text style={styles.bundleTitle}>📦 {bName}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={[
                          styles.bundleCount,
                          takenCount === items.length && { color: '#27ae60' },
                        ]}>
                          {takenCount}/{items.length} taken
                        </Text>
                        <Text style={{ fontSize: 14, color: '#95a5a6' }}>{isCollapsed ? '▸' : '▾'}</Text>
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

                {/* Standalone medicines (no bundle) */}
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
            );
        })()}


      </ScrollView>

      {/* Floating Add Button — visible only when there are schedules */}
      {schedules.length > 0 && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => navigation.navigate('AddMedicine')}
          activeOpacity={0.8}
        >
          <Text style={styles.fabText}>+</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f9fc' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f6f9fc' },
  header: {
    padding: 25, paddingTop: 50, backgroundColor: '#ffffff',
    borderBottomLeftRadius: 24, borderBottomRightRadius: 24,
    marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 3,
  },
  welcomeLabel: { color: '#95a5a6', fontSize: 14, fontWeight: '500' },
  username: { fontSize: 22, fontWeight: '800', color: '#2c3e50', marginTop: 2 },

  // Compact banners — inside ScrollView, small text, no overlap
  offlineBanner: {
    backgroundColor: '#fef2f2', marginHorizontal: 16, marginBottom: 8,
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10,
    borderLeftWidth: 3, borderLeftColor: '#e74c3c',
  },
  offlineBannerText: { fontSize: 12, fontWeight: '600', color: '#c0392b' },
  cacheBanner: {
    backgroundColor: '#fffbeb', marginHorizontal: 16, marginBottom: 8,
    paddingVertical: 6, paddingHorizontal: 14, borderRadius: 10,
    borderLeftWidth: 3, borderLeftColor: '#f39c12',
  },
  cacheBannerText: { fontSize: 11, fontWeight: '600', color: '#e67e22' },

  alertCard: {
    backgroundColor: '#fff8e1', borderRadius: 12, padding: 14,
    marginHorizontal: 16, marginBottom: 12, borderLeftWidth: 4, borderLeftColor: '#f39c12',
  },
  alertTitle: { fontWeight: '700', fontSize: 15, color: '#e67e22', marginBottom: 6 },
  alertText: { color: '#795548', fontSize: 13, marginBottom: 2 },

  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, marginBottom: 10, marginTop: 6,
  },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#2c3e50' },
  scanLink: { fontSize: 14, color: '#3498db', fontWeight: '600' },

  emptyContainer: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 16 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, fontWeight: '700', color: '#2c3e50', marginBottom: 4 },
  emptySubtext: { fontSize: 14, color: '#95a5a6', marginBottom: 20, textAlign: 'center' },
  addMedBtn: {
    backgroundColor: '#3498db', paddingVertical: 12, paddingHorizontal: 24,
    borderRadius: 10,
  },
  addMedText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  listContainer: { paddingHorizontal: 16 },

  // Compact stats row — below schedules
  statsCompact: {
    marginHorizontal: 16, marginTop: 16, marginBottom: 8,
  },
  statsRow: {
    flexDirection: 'row', justifyContent: 'space-between',
  },
  statPill: {
    flex: 1, alignItems: 'center', backgroundColor: '#fff',
    paddingVertical: 10, borderRadius: 12, marginHorizontal: 3,
    elevation: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 2,
  },
  statPillValue: { fontSize: 18, fontWeight: '800', color: '#2c3e50' },
  statPillLabel: { fontSize: 10, color: '#95a5a6', fontWeight: '600', marginTop: 2 },

  fab: {
    position: 'absolute', bottom: 90, right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#3498db', alignItems: 'center', justifyContent: 'center',
    elevation: 6,
    shadowColor: '#3498db', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35, shadowRadius: 8,
  },
  fabText: { color: '#fff', fontSize: 28, fontWeight: '600', marginTop: -2 },

  // B3: Bundle grouping
  bundleSection: {
    marginBottom: 12,
    backgroundColor: '#f0f4ff',
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: '#dbeafe',
  },
  bundleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingBottom: 8,
    marginBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#dbeafe',
  },
  bundleTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#3b82f6',
  },
  bundleCount: {
    fontSize: 11,
    color: '#93c5fd',
    fontWeight: '600',
  },
});

export default DashboardScreen;
