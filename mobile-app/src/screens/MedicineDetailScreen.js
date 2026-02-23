import React, { useState, useContext, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, Alert, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import api from '../api/client';
import { AuthContext } from '../context/AuthContext';

const MedicineDetailScreen = ({ navigation, route }) => {
  const { userInfo } = useContext(AuthContext);
  const schedule = route.params?.schedule || {};
  const medicine = schedule.medicine || {};

  const [stats, setStats] = useState(null);
  const [drugInfo, setDrugInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStats = async () => {
    try {
      const res = await api.get(`/stats/user/${userInfo.id}/medicine/${encodeURIComponent(medicine.name)}`);
      setStats(res.data);
    } catch (e) {
      console.error('[MedicineDetail] Stats fetch failed:', e.message);
    }
  };

  const fetchDrugInfo = async () => {
    try {
      const res = await api.get(`/medicines/drug-info?name=${encodeURIComponent(medicine.name)}`);
      setDrugInfo(res.data);
    } catch (e) {
      console.log('[MedicineDetail] Drug info not available:', e.message);
    }
  };

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      Promise.all([fetchStats(), fetchDrugInfo()]).finally(() => setLoading(false));
    }, [schedule.id])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchStats(), fetchDrugInfo()]);
    setRefreshing(false);
  }, [schedule.id]);

  const handleDelete = () => {
    Alert.alert(
      'Delete Medicine',
      `Are you sure you want to remove ${medicine.name} from your schedule?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/schedules/${schedule.id}`);
              Alert.alert('Deleted', 'Medicine removed from schedule.');
              navigation.goBack();
            } catch (e) {
              Alert.alert('Error', 'Failed to delete schedule.');
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator size="large" color="#3498db" /></View>;
  }

  const timesDisplay = (schedule.scheduleTimes || [])
    .map(t => (t.scheduledTime || '').substring(0, 5))
    .filter(Boolean)
    .join(', ');

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Header Card */}
      <View style={styles.headerCard}>
        <Text style={styles.medicineName}>{medicine.name || 'Medication'}</Text>
        {medicine.type && <Text style={styles.medicineType}>{medicine.type}</Text>}
        <View style={styles.dosageRow}>
          <Text style={styles.dosageText}>
            {schedule.doseAmount || '1'} {schedule.doseUnit || 'Dose'} • {schedule.frequencyType || 'DAILY'}
          </Text>
        </View>
        {timesDisplay && (
          <Text style={styles.timesText}>⏰ {timesDisplay}</Text>
        )}
        {schedule.currentStock != null && (
          <Text style={[styles.stockText, schedule.currentStock <= 5 && styles.lowStock]}>
            📦 Stock: {schedule.currentStock} remaining
          </Text>
        )}
      </View>

      {/* Adherence Stats */}
      {stats && (
        <View style={styles.statsCard}>
          <Text style={styles.cardTitle}>Adherence Stats</Text>
          <View style={styles.statsGrid}>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: '#27ae60' }]}>{stats.takenCount || 0}</Text>
              <Text style={styles.statLabel}>Taken</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: '#e74c3c' }]}>{stats.missedCount || 0}</Text>
              <Text style={styles.statLabel}>Missed</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: '#f39c12' }]}>{stats.snoozedCount || 0}</Text>
              <Text style={styles.statLabel}>Snoozed</Text>
            </View>
          </View>
          {stats.adherenceRate != null && (
            <View style={styles.adherenceSection}>
              <Text style={styles.adherenceLabel}>Adherence Rate</Text>
              <Text style={[styles.adherenceValue, {
                color: stats.adherenceRate >= 80 ? '#27ae60' : stats.adherenceRate >= 50 ? '#f39c12' : '#e74c3c'
              }]}>
                {stats.adherenceRate}%
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Drug Information */}
      {drugInfo && (
        <View style={styles.infoCard}>
          <Text style={styles.cardTitle}>Drug Information</Text>
          
          {drugInfo.manufacturer && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Manufacturer</Text>
              <Text style={styles.infoValue}>{drugInfo.manufacturer}</Text>
            </View>
          )}

          {drugInfo.composition && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Composition</Text>
              <Text style={styles.infoValue}>{drugInfo.composition}</Text>
            </View>
          )}

          {drugInfo.uses && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Uses</Text>
              <Text style={styles.infoValue}>{drugInfo.uses}</Text>
            </View>
          )}

          {drugInfo.sideEffects && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Side Effects</Text>
              <Text style={[styles.infoValue, { color: '#e67e22' }]}>{drugInfo.sideEffects}</Text>
            </View>
          )}

          {drugInfo.drugInteractions && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Drug Interactions</Text>
              <Text style={[styles.infoValue, { color: '#e74c3c' }]}>{drugInfo.drugInteractions}</Text>
            </View>
          )}

          {drugInfo.description && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Description</Text>
              <Text style={styles.infoValue}>{drugInfo.description}</Text>
            </View>
          )}
        </View>
      )}

      {/* Actions */}
      <View style={styles.actionsSection}>
        <TouchableOpacity
          style={styles.editBtn}
          onPress={() => navigation.navigate('EditSchedule', { schedule })}
        >
          <Text style={styles.editBtnText}>✏️ Edit Schedule</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
          <Text style={styles.deleteBtnText}>🗑️ Remove Medicine</Text>
        </TouchableOpacity>
      </View>

      <View style={{ height: 80 }} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f9fc' },
  content: { padding: 16 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f6f9fc' },

  headerCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 20,
    marginBottom: 16, elevation: 3,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8,
  },
  medicineName: { fontSize: 24, fontWeight: '800', color: '#2c3e50' },
  medicineType: { fontSize: 14, color: '#7f8c8d', marginTop: 4, textTransform: 'uppercase', letterSpacing: 1 },
  dosageRow: { marginTop: 12 },
  dosageText: { fontSize: 16, fontWeight: '600', color: '#34495e' },
  timesText: { fontSize: 14, color: '#3498db', fontWeight: '600', marginTop: 8 },
  stockText: { fontSize: 13, color: '#27ae60', marginTop: 6, fontWeight: '600' },
  lowStock: { color: '#e74c3c' },

  statsCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 18,
    marginBottom: 16, elevation: 2,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#34495e', marginBottom: 14 },
  statsGrid: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 14 },
  statItem: { alignItems: 'center' },
  statValue: { fontSize: 24, fontWeight: '800' },
  statLabel: { fontSize: 12, color: '#95a5a6', marginTop: 2 },
  adherenceSection: { alignItems: 'center', borderTopWidth: 1, borderTopColor: '#f0f0f0', paddingTop: 12 },
  adherenceLabel: { fontSize: 13, color: '#95a5a6' },
  adherenceValue: { fontSize: 32, fontWeight: '800', marginTop: 4 },

  infoCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 18,
    marginBottom: 16, elevation: 2,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4,
  },
  infoRow: { marginBottom: 14 },
  infoLabel: { fontSize: 12, fontWeight: '700', color: '#95a5a6', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  infoValue: { fontSize: 14, color: '#2c3e50', lineHeight: 20 },

  actionsSection: { marginTop: 8, gap: 10 },
  editBtn: {
    backgroundColor: '#3498db', paddingVertical: 15, borderRadius: 12,
    alignItems: 'center', elevation: 2,
  },
  editBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  deleteBtn: {
    backgroundColor: '#fef2f2', paddingVertical: 15, borderRadius: 12,
    alignItems: 'center', borderWidth: 1, borderColor: '#fee2e2',
  },
  deleteBtnText: { color: '#e74c3c', fontSize: 16, fontWeight: '700' },
});

export default MedicineDetailScreen;
