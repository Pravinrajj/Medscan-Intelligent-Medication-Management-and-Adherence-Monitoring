import React, { useContext, useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import api from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { useFocusEffect } from '@react-navigation/native';

const STATUS_COLORS = { TAKEN: '#27ae60', MISSED: '#e74c3c', SNOOZED: '#f39c12' };
const STATUS_ICONS = { TAKEN: '✅', MISSED: '❌', SNOOZED: '⏰' };
const FILTER_OPTIONS = ['All', 'TAKEN', 'MISSED', 'SNOOZED'];

const HistoryScreen = () => {
  const { userInfo } = useContext(AuthContext);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState('All');

  const fetchHistory = async () => {
    try {
      setError(false);
      const res = await api.get(`/adherence/user/${userInfo.id}`);
      setHistory(res.data);
    } catch (e) {
      console.error('[History] Fetch failed:', e.message);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchHistory();
    }, [userInfo])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchHistory();
    setRefreshing(false);
  }, [userInfo]);

  const filtered = filter === 'All' ? history : history.filter(h => h.status === filter);

  const groupedByDate = filtered.reduce((groups, item) => {
    const date = new Date(item.timestamp).toLocaleDateString('en-IN', {
      weekday: 'short', day: 'numeric', month: 'short',
    });
    if (!groups[date]) groups[date] = [];
    groups[date].push(item);
    return groups;
  }, {});

  const sections = Object.entries(groupedByDate);

  const renderItem = (item) => {
    const time = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const statusColor = STATUS_COLORS[item.status] || '#999';
    const icon = STATUS_ICONS[item.status] || '📋';
    const verb = item.status === 'TAKEN' ? 'took' : item.status === 'MISSED' ? 'missed' : 'snoozed';

    return (
      <View style={styles.messageRow} key={item.id}>
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        <View style={styles.messageBubble}>
          <Text style={styles.messageText}>
            {icon} You {verb} <Text style={styles.medicineName}>{item.medicineName || 'medication'}</Text>
          </Text>
          <Text style={styles.messageTime}>{time}</Text>
          {item.reason && <Text style={styles.messageReason}>{item.reason}</Text>}
        </View>
      </View>
    );
  };

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator size="large" color="#3498db" /></View>;
  }

  if (error && history.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={{fontSize: 40, marginBottom: 10}}>😵</Text>
        <Text style={{fontSize: 16, fontWeight: '600', color: '#2c3e50', marginBottom: 6}}>Failed to Load History</Text>
        <Text style={{color: '#7f8c8d', marginBottom: 16}}>Check your connection and try again.</Text>
        <TouchableOpacity style={{backgroundColor: '#3498db', paddingVertical: 10, paddingHorizontal: 24, borderRadius: 8}} onPress={fetchHistory}>
          <Text style={{color: '#fff', fontWeight: '600'}}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Medication History</Text>

      {/* Filter Bar */}
      <View style={styles.filterBar}>
        {FILTER_OPTIONS.map(opt => (
          <TouchableOpacity
            key={opt}
            style={[styles.filterBtn, filter === opt && styles.filterBtnActive]}
            onPress={() => setFilter(opt)}
          >
            <Text style={[styles.filterText, filter === opt && styles.filterTextActive]}>
              {opt}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Timeline */}
      {sections.length === 0 ? (
        <Text style={styles.empty}>No history recorded.</Text>
      ) : (
        <FlatList
          data={sections}
          keyExtractor={(item) => item[0]}
          renderItem={({ item }) => (
            <View style={styles.dateSection}>
              <View style={styles.dateBadge}>
                <Text style={styles.dateText}>{item[0]}</Text>
              </View>
              {item[1].map(log => renderItem(log))}
            </View>
          )}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={{ paddingBottom: 80 }}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f9fc', padding: 20 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: '800', color: '#2c3e50', marginBottom: 15 },

  // Filters
  filterBar: { flexDirection: 'row', marginBottom: 15 },
  filterBtn: {
    paddingVertical: 6, paddingHorizontal: 14,
    borderRadius: 20, backgroundColor: '#ecf0f1', marginRight: 8,
  },
  filterBtnActive: { backgroundColor: '#3498db' },
  filterText: { fontSize: 13, fontWeight: '600', color: '#7f8c8d' },
  filterTextActive: { color: '#fff' },

  // Timeline
  dateSection: { marginBottom: 16 },
  dateBadge: {
    backgroundColor: '#ecf0f1', paddingVertical: 4, paddingHorizontal: 12,
    borderRadius: 12, alignSelf: 'flex-start', marginBottom: 8,
  },
  dateText: { fontSize: 13, fontWeight: '700', color: '#7f8c8d' },

  messageRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10, marginLeft: 4 },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginTop: 8, marginRight: 10 },
  messageBubble: {
    flex: 1, backgroundColor: '#fff', padding: 12, borderRadius: 12,
    elevation: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 3,
  },
  messageText: { fontSize: 14, color: '#2c3e50' },
  medicineName: { fontWeight: '700', color: '#3498db' },
  messageTime: { fontSize: 11, color: '#bdc3c7', marginTop: 4 },
  messageReason: { fontSize: 12, color: '#95a5a6', marginTop: 2, fontStyle: 'italic' },

  empty: { fontSize: 15, color: '#95a5a6', textAlign: 'center', marginTop: 40 },
});

export default HistoryScreen;
