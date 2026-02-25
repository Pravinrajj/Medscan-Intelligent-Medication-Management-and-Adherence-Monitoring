import React, { useState, useCallback, useContext, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import api from '../api/client';
import { AuthContext } from '../context/AuthContext';
import MedicationItem from '../components/MedicationItem';
import AdherenceChart from '../components/AdherenceChart';
import offlineSyncService from '../services/OfflineSyncService';

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
      setSchedules(schedRes.data);
      setStats(statsRes.data);

      // Track low stock items
      const lowStock = schedRes.data.filter(s => s.currentStock != null && s.currentStock <= 5);
      setLowStockItems(lowStock);

      // Track already-logged schedules for today
      const logged = new Set();
      if (statsRes.data?.todayLogs) {
        statsRes.data.todayLogs.forEach(log => logged.add(log.scheduleId));
      }
      setLoggedSchedules(logged);

      // Cache to AsyncStorage
      const cacheData = {
        schedules: schedRes.data,
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
      setLoggedSchedules(prev => new Set([...prev, scheduleId]));
      fetchData();
    } catch (e) {
      console.error(e);
      Alert.alert("Error", "Failed to snooze.");
    }
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
      {/* Offline Banner */}
      {!isOnline && (
        <View style={{backgroundColor: '#e74c3c', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, marginBottom: 10, flexDirection: 'row', alignItems: 'center'}}>
          <Text style={{color: '#fff', fontWeight: '600', flex: 1}}>📡 You're offline — actions will be saved and synced later</Text>
        </View>
      )}
      {isFromCache && cachedAt && (
        <View style={{backgroundColor: '#f39c12', paddingVertical: 6, paddingHorizontal: 16, borderRadius: 8, marginBottom: 10, flexDirection: 'row', alignItems: 'center'}}>
          <Text style={{color: '#fff', fontWeight: '600', flex: 1, fontSize: 12}}>📦 Showing cached data — last updated {formatCacheAge(cachedAt)}</Text>
        </View>
      )}
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

        {/* Adherence Stats */}
        {stats && (
            <View style={styles.statsCard}>
                <Text style={styles.statsTitle}>Today's Adherence</Text>
                <View style={styles.adherenceRow}>
                    <Text style={[styles.adherenceRate, { color: getAdherenceColor(stats.adherenceRate || 0) }]}>
                        {stats.adherenceRate || 0}%
                    </Text>
                </View>
                <View style={styles.statsGrid}>
                    <View style={styles.statItem}>
                        <Text style={styles.statValue}>{stats.takenCount || 0}</Text>
                        <Text style={styles.statLabel}>Taken</Text>
                    </View>
                    <View style={styles.statItem}>
                        <Text style={styles.statValue}>{stats.snoozedCount || 0}</Text>
                        <Text style={styles.statLabel}>Snoozed</Text>
                    </View>
                    <View style={styles.statItem}>
                        <Text style={styles.statValue}>{stats.missedCount || 0}</Text>
                        <Text style={styles.statLabel}>Missed</Text>
                    </View>
                </View>
            </View>
        )}

        {/* Adherence Chart */}
        <AdherenceChart dailyBreakdown={stats?.dailyBreakdown} />

        <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Today's Schedule</Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
                <TouchableOpacity onPress={() => navigation.navigate('AddMedicine')}>
                    <Text style={styles.addLink}>+ Add</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => navigation.navigate('ScanPrescription')}>
                    <Text style={styles.scanLink}>📷 Scan</Text>
                </TouchableOpacity>
            </View>
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
        ) : (
            <View style={styles.listContainer}>
                {schedules.map(item => (
                    <MedicationItem 
                      key={item.id} 
                      schedule={item} 
                      onTaken={() => handleTakeDose(item.id)} 
                      onMissed={() => handleMissDose(item.id)}
                      onSnooze={() => handleSnooze(item.id)}
                      onPress={() => navigation.navigate('MedicineDetail', { schedule: item })} 
                      loggedToday={loggedSchedules.has(item.id)}
                    />
                ))}
            </View>
        )}
      </ScrollView>

    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f9fc' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f6f9fc' },
  header: {
    padding: 25, paddingTop: 50, backgroundColor: '#ffffff',
    borderBottomLeftRadius: 24, borderBottomRightRadius: 24,
    marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 3,
  },
  welcomeLabel: { color: '#95a5a6', fontSize: 14, fontWeight: '500' },
  username: { fontSize: 22, fontWeight: '800', color: '#2c3e50', marginTop: 2 },

  alertCard: {
    backgroundColor: '#fff8e1', borderRadius: 12, padding: 14,
    marginHorizontal: 16, marginBottom: 12, borderLeftWidth: 4, borderLeftColor: '#f39c12',
  },
  alertTitle: { fontWeight: '700', fontSize: 15, color: '#e67e22', marginBottom: 6 },
  alertText: { color: '#795548', fontSize: 13, marginBottom: 2 },

  statsCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 20,
    marginHorizontal: 16, marginBottom: 16,
    elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4,
  },
  statsTitle: { fontSize: 16, fontWeight: '700', color: '#34495e', marginBottom: 10, textAlign: 'center' },
  adherenceRow: { alignItems: 'center', marginBottom: 12 },
  adherenceRate: { fontSize: 36, fontWeight: '800' },
  statsGrid: { flexDirection: 'row', justifyContent: 'space-around' },
  statItem: { alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: '700', color: '#2c3e50' },
  statLabel: { fontSize: 12, color: '#95a5a6', marginTop: 2 },

  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, marginBottom: 10, marginTop: 6,
  },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#2c3e50' },
  addLink: { fontSize: 14, color: '#27ae60', fontWeight: '700' },
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
});

export default DashboardScreen;
