import React, { useState, useContext, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, Alert, RefreshControl, SafeAreaView } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import api from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import CircularProgress from '../components/CircularProgress';
import { colors, fonts, spacing, radii, shadows, typography } from '../theme';

const MedicineDetailScreen = ({ navigation, route }) => {
  const { userInfo } = useContext(AuthContext);
  const toast = useToast();
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
    } catch (e) { /* silently skip */ }
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
              toast.success('Medicine removed from schedule.');
              navigation.goBack();
            } catch (e) {
              toast.error('Failed to delete schedule.');
            }
          },
        },
      ]
    );
  };

  const getScoreColor = (rate) => {
    if (rate >= 80) return colors.success;
    if (rate >= 50) return colors.warning;
    return colors.danger;
  };

  const typeColor = colors.medicineTypes[medicine.type?.toLowerCase()] || colors.primary;

  if (loading) {
    return <SafeAreaView style={styles.centered}><ActivityIndicator size="large" color={colors.primary} /></SafeAreaView>;
  }

  const timesDisplay = (schedule.scheduleTimes || [])
    .map(t => (t.scheduledTime || '').substring(0, 5))
    .filter(Boolean);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Header Card */}
        <View style={styles.headerCard}>
          <View style={styles.headerTopRow}>
            <View style={[styles.typeIcon, { backgroundColor: typeColor + '18' }]}>
              <MaterialCommunityIcons
                name={medicine.type === 'SYRUP' ? 'bottle-tonic' : medicine.type === 'INJECTION' ? 'needle' : 'pill'}
                size={24} color={typeColor}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.medicineName}>{medicine.name || 'Medication'}</Text>
              {medicine.type && (
                <View style={[styles.typeBadge, { backgroundColor: typeColor + '18' }]}>
                  <Text style={[styles.typeText, { color: typeColor }]}>{medicine.type}</Text>
                </View>
              )}
            </View>
          </View>

          <View style={styles.detailsGrid}>
            <DetailChip icon="scale-balance" label="Dosage" value={`${schedule.doseAmount || '1'} ${schedule.doseUnit || 'Dose'}`} />
            <DetailChip icon="calendar-sync" label="Frequency" value={schedule.frequencyType || 'DAILY'} />
            {schedule.currentStock != null && (
              <DetailChip
                icon="package-variant"
                label="Stock"
                value={`${schedule.currentStock} left`}
                valueColor={schedule.currentStock <= 5 ? colors.danger : colors.text}
              />
            )}
          </View>

          {timesDisplay.length > 0 && (
            <View style={styles.timesRow}>
              {timesDisplay.map((t, i) => (
                <View key={i} style={styles.timeChip}>
                  <MaterialCommunityIcons name="clock-outline" size={12} color={colors.primary} />
                  <Text style={styles.timeChipText}>{t}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Adherence Stats with CircularProgress */}
        {stats && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Adherence</Text>
            {stats.adherenceRate != null && (
              <View style={styles.adherenceCenter}>
                <CircularProgress
                  size={100}
                  strokeWidth={10}
                  progress={(stats.adherenceRate || 0) / 100}
                  label={`${stats.adherenceRate}%`}
                />
              </View>
            )}
            <View style={styles.statsGrid}>
              <StatPill icon="check-circle" value={stats.takenCount || 0} label="Taken" color={colors.taken} />
              <StatPill icon="close-circle" value={stats.missedCount || 0} label="Missed" color={colors.missed} />
              <StatPill icon="clock-outline" value={stats.snoozedCount || 0} label="Snoozed" color={colors.snoozed} />
            </View>
          </View>
        )}

        {/* Drug Information */}
        {drugInfo && (
          <View style={styles.card}>
            <View style={styles.cardTitleRow}>
              <MaterialCommunityIcons name="information-outline" size={16} color={colors.primary} />
              <Text style={styles.cardTitle}>Drug Information</Text>
            </View>
            {drugInfo.saltName && <InfoRow label="Salt / Generic" value={drugInfo.saltName} />}
            {drugInfo.manufacturer && <InfoRow label="Manufacturer" value={drugInfo.manufacturer} />}
            {drugInfo.therapeuticClass && <InfoRow label="Class" value={drugInfo.therapeuticClass} />}
            {drugInfo.price && <InfoRow label="Price" value={`₹${drugInfo.price}`} />}
            {drugInfo.description && <InfoRow label="Description" value={drugInfo.description} />}
            {drugInfo.sideEffects && <InfoRow label="Side Effects" value={drugInfo.sideEffects} color={colors.warning} />}
            {drugInfo.drugInteractions && drugInfo.drugInteractions !== '[]' && (
              <InfoRow label="Interactions" value={drugInfo.drugInteractions} color={colors.danger} />
            )}
          </View>
        )}

        {/* Actions */}
        <View style={styles.actionsSection}>
          <TouchableOpacity style={styles.editBtn} onPress={() => navigation.navigate('EditSchedule', { schedule })} activeOpacity={0.8}>
            <MaterialCommunityIcons name="pencil-outline" size={18} color={colors.textInverse} />
            <Text style={styles.editBtnText}>Edit Schedule</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} activeOpacity={0.8}>
            <MaterialCommunityIcons name="delete-outline" size={18} color={colors.danger} />
            <Text style={styles.deleteBtnText}>Remove Medicine</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 80 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

// Sub-components
const DetailChip = ({ icon, label, value, valueColor }) => (
  <View style={styles.detailChip}>
    <MaterialCommunityIcons name={icon} size={14} color={colors.textTertiary} />
    <Text style={styles.detailLabel}>{label}</Text>
    <Text style={[styles.detailValue, valueColor && { color: valueColor }]}>{value}</Text>
  </View>
);

const StatPill = ({ icon, value, label, color }) => (
  <View style={styles.statPill}>
    <MaterialCommunityIcons name={icon} size={16} color={color} />
    <Text style={[styles.statValue, { color }]}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

const InfoRow = ({ label, value, color }) => (
  <View style={styles.infoRow}>
    <Text style={styles.infoLabel}>{label}</Text>
    <Text style={[styles.infoValue, color && { color }]} numberOfLines={4}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },

  // Header
  headerCard: {
    backgroundColor: colors.surface, borderRadius: radii.xxl, padding: spacing.xl,
    marginBottom: spacing.lg, ...shadows.md,
  },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  typeIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  medicineName: { fontSize: 22, fontFamily: fonts.bold, color: colors.text },
  typeBadge: { alignSelf: 'flex-start', paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radii.full, marginTop: spacing.xs },
  typeText: { fontSize: 11, fontFamily: fonts.bold, letterSpacing: 0.8 },

  detailsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  detailChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.surfaceHover, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2,
    borderRadius: radii.full,
  },
  detailLabel: { fontSize: 11, fontFamily: fonts.medium, color: colors.textTertiary },
  detailValue: { fontSize: 12, fontFamily: fonts.semiBold, color: colors.text },

  timesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  timeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.primaryBg, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2,
    borderRadius: radii.full,
  },
  timeChipText: { fontSize: 13, fontFamily: fonts.semiBold, color: colors.primary },

  // Card
  card: {
    backgroundColor: colors.surface, borderRadius: radii.xl, padding: spacing.lg,
    marginBottom: spacing.lg, ...shadows.sm,
  },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  cardTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.text, marginBottom: spacing.md },

  // Adherence
  adherenceCenter: { alignItems: 'center', marginBottom: spacing.lg },

  // Stats
  statsGrid: {
    flexDirection: 'row', justifyContent: 'space-around',
    paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderLight,
  },
  statPill: { alignItems: 'center', gap: 4 },
  statValue: { fontSize: 20, fontFamily: fonts.bold },
  statLabel: { fontSize: 11, fontFamily: fonts.medium, color: colors.textTertiary },

  // Info
  infoRow: { marginBottom: spacing.md },
  infoLabel: { ...typography.sectionLabel, marginBottom: 4 },
  infoValue: { fontSize: 14, fontFamily: fonts.regular, color: colors.text, lineHeight: 20 },

  // Actions
  actionsSection: { marginTop: spacing.sm, gap: spacing.sm },
  editBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.primary, paddingVertical: spacing.md, borderRadius: radii.md,
    ...shadows.colored(colors.primary),
  },
  editBtnText: { color: colors.textInverse, fontSize: 16, fontFamily: fonts.bold },
  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.dangerLight, paddingVertical: spacing.md, borderRadius: radii.md,
  },
  deleteBtnText: { color: colors.danger, fontSize: 16, fontFamily: fonts.bold },
});

export default MedicineDetailScreen;
