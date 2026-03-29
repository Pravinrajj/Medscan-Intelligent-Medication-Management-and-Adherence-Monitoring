import React, { useContext, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, RefreshControl } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import api from '../api/client';
import { AuthContext } from '../context/AuthContext';

const PERIOD_OPTIONS = [
  { label: '7 Days', value: 7 },
  { label: '14 Days', value: 14 },
  { label: '30 Days', value: 30 },
  { label: '90 Days', value: 90 },
];

const ReportScreen = () => {
  const { userInfo } = useContext(AuthContext);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [days, setDays] = useState(30);

  const fetchReport = async (daysParam) => {
    try {
      const res = await api.get(`/adherence/report?userId=${userInfo.id}&days=${daysParam || days}`);
      setReport(res.data);
    } catch (e) {
      console.error('[Report] Fetch failed:', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, []);

  const onPeriodChange = (newDays) => {
    setDays(newDays);
    setLoading(true);
    fetchReport(newDays);
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchReport();
  };

  const getScoreColor = (rate) => {
    if (rate >= 80) return '#27ae60';
    if (rate >= 50) return '#f39c12';
    return '#e74c3c';
  };

  const getScoreIcon = (rate) => {
    if (rate >= 90) return { name: 'trophy', color: '#f1c40f' };
    if (rate >= 80) return { name: 'star', color: '#f39c12' };
    if (rate >= 60) return { name: 'thumb-up', color: '#27ae60' };
    if (rate >= 40) return { name: 'alert-outline', color: '#f39c12' };
    return { name: 'alert-circle', color: '#e74c3c' };
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#4a90e2" />
        <Text style={styles.loadingText}>Generating report...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={styles.title}>Adherence Report</Text>

      {/* Period Selector */}
      <View style={styles.periodRow}>
        {PERIOD_OPTIONS.map(opt => (
          <TouchableOpacity
            key={opt.value}
            style={[styles.periodChip, days === opt.value && styles.periodChipActive]}
            onPress={() => onPeriodChange(opt.value)}
          >
            <Text style={[styles.periodText, days === opt.value && styles.periodTextActive]}>{opt.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {!report ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>No adherence data yet. Start tracking your medications!</Text>
        </View>
      ) : (
        <>
          {/* Overall Score */}
          <View style={styles.scoreCard}>
            <MaterialCommunityIcons name={getScoreIcon(report.overallAdherenceRate).name} size={36} color={getScoreIcon(report.overallAdherenceRate).color} style={{marginBottom: 4}} />
            <Text style={[styles.scoreValue, { color: getScoreColor(report.overallAdherenceRate) }]}>
              {report.overallAdherenceRate}%
            </Text>
            <Text style={styles.scoreLabel}>Overall Adherence</Text>

            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: '#27ae60' }]}>{report.totalTaken}</Text>
                <Text style={styles.statLabel}>Taken</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: '#e74c3c' }]}>{report.totalMissed}</Text>
                <Text style={styles.statLabel}>Missed</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: '#f39c12' }]}>{report.totalSnoozed}</Text>
                <Text style={styles.statLabel}>Snoozed</Text>
              </View>
            </View>
          </View>

          {/* Per-Medicine Breakdown */}
          <Text style={styles.sectionTitle}>By Medicine</Text>
          {(report.medicineBreakdown || []).map((med, idx) => (
            <View key={idx} style={styles.medCard}>
              <View style={styles.medHeader}>
                <Text style={styles.medName}>{med.medicineName}</Text>
                <Text style={[styles.medRate, { color: getScoreColor(med.adherenceRate) }]}>
                  {med.adherenceRate}%
                </Text>
              </View>
              <View style={styles.medBar}>
                <View style={[styles.medBarFill, { width: `${med.adherenceRate}%`, backgroundColor: getScoreColor(med.adherenceRate) }]} />
              </View>
              <View style={styles.medStats}>
                <Text style={styles.medStat}><MaterialCommunityIcons name="check-circle" size={12} color="#27ae60" /> {med.taken} taken</Text>
                <Text style={styles.medStat}><MaterialCommunityIcons name="close-circle" size={12} color="#e74c3c" /> {med.missed} missed</Text>
                <Text style={styles.medStat}><MaterialCommunityIcons name="clock-outline" size={12} color="#f39c12" /> {med.snoozed} snoozed</Text>
              </View>
            </View>
          ))}

          {(report.medicineBreakdown || []).length === 0 && (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No medicine-specific data available.</Text>
            </View>
          )}
        </>
      )}

      <View style={{ height: 80 }} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  content: { padding: 20, paddingTop: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f7fa' },
  loadingText: { marginTop: 12, color: '#7f8c8d', fontSize: 14 },

  title: { fontSize: 24, fontWeight: '800', color: '#2c3e50', marginBottom: 16 },

  // Period selector
  periodRow: { flexDirection: 'row', marginBottom: 20 },
  periodChip: {
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20,
    borderWidth: 1, borderColor: '#ddd', marginRight: 8, backgroundColor: '#fff',
  },
  periodChipActive: { backgroundColor: '#3498db', borderColor: '#3498db' },
  periodText: { fontSize: 13, fontWeight: '600', color: '#7f8c8d' },
  periodTextActive: { color: '#fff' },

  // Score card
  scoreCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 24,
    alignItems: 'center', marginBottom: 20,
    elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8,
  },
  scoreEmoji: { fontSize: 36, marginBottom: 4 },
  scoreValue: { fontSize: 48, fontWeight: '800' },
  scoreLabel: { fontSize: 14, color: '#95a5a6', marginTop: 4, marginBottom: 16 },

  statsRow: { flexDirection: 'row', width: '100%', justifyContent: 'space-around', marginTop: 10 },
  statItem: { alignItems: 'center', flex: 1 },
  statValue: { fontSize: 22, fontWeight: '700' },
  statLabel: { fontSize: 12, color: '#95a5a6', marginTop: 2 },
  statDivider: { width: 1, backgroundColor: '#ecf0f1', height: '100%' },

  // Section
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#34495e', marginBottom: 12 },

  // Medicine cards
  medCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16,
    marginBottom: 12, elevation: 2,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4,
  },
  medHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  medName: { fontSize: 15, fontWeight: '700', color: '#2c3e50', flex: 1 },
  medRate: { fontSize: 18, fontWeight: '800' },
  medBar: {
    height: 6, backgroundColor: '#ecf0f1', borderRadius: 3,
    overflow: 'hidden', marginBottom: 10,
  },
  medBarFill: { height: '100%', borderRadius: 3 },
  medStats: { flexDirection: 'row', justifyContent: 'space-between' },
  medStat: { fontSize: 12, color: '#7f8c8d' },

  // Empty
  emptyCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 24,
    alignItems: 'center', marginBottom: 16,
  },
  emptyText: { color: '#95a5a6', fontSize: 15, textAlign: 'center' },
});

export default ReportScreen;
