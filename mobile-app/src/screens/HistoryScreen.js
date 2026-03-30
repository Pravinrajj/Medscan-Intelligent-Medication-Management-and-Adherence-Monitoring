import React, { useContext, useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl, ActivityIndicator, SafeAreaView } from 'react-native';
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
const FILTER_OPTIONS = ['All', 'TAKEN', 'MISSED', 'SNOOZED'];

const HistoryScreen = ({ navigation }) => {
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
    const config = STATUS_CONFIG[item.status] || { color: colors.textTertiary, icon: 'circle', verb: 'recorded', bg: colors.surfaceHover };

    return (
      <View style={styles.timelineItem} key={item.id}>
        {/* Timeline connector */}
        <View style={styles.timelineLeft}>
          <View style={[styles.timelineDot, { backgroundColor: config.color }]}>
            <MaterialCommunityIcons name={config.icon} size={14} color={colors.textInverse} />
          </View>
          <View style={styles.timelineLine} />
        </View>

        {/* Content card */}
        <View style={styles.timelineCard}>
          <View style={styles.timelineCardHeader}>
            <Text style={styles.medicineName}>{item.medicineName || 'Medication'}</Text>
            <View style={[styles.statusBadge, { backgroundColor: config.bg }]}>
              <Text style={[styles.statusText, { color: config.color }]}>{config.verb}</Text>
            </View>
          </View>
          <Text style={styles.timeText}>{time}</Text>
          {item.reason && <Text style={styles.reasonText}>{item.reason}</Text>}
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

  if (error && history.length === 0) {
    return (
      <SafeAreaView style={styles.centered}>
        <MaterialCommunityIcons name="alert-circle-outline" size={48} color={colors.textTertiary} />
        <Text style={styles.errorTitle}>Failed to Load History</Text>
        <Text style={styles.errorSub}>Check your connection and try again.</Text>
        <TouchableOpacity style={[components.buttonPrimary, { marginTop: spacing.lg }]} onPress={fetchHistory}>
          <Text style={[typography.button, { color: colors.textInverse }]}>Retry</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Medicines</Text>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => navigation.navigate('AddMedicine')}
        >
          <MaterialCommunityIcons name="plus" size={20} color={colors.textInverse} />
        </TouchableOpacity>
      </View>

      {/* Filter Bar */}
      <View style={styles.filterBar}>
        {FILTER_OPTIONS.map(opt => (
          <TouchableOpacity
            key={opt}
            style={[styles.filterBtn, filter === opt && styles.filterBtnActive]}
            onPress={() => setFilter(opt)}
          >
            {opt !== 'All' && (
              <View style={[styles.filterDot, { backgroundColor: STATUS_CONFIG[opt]?.color }]} />
            )}
            <Text style={[styles.filterText, filter === opt && styles.filterTextActive]}>
              {opt === 'All' ? 'All' : opt.charAt(0) + opt.slice(1).toLowerCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Timeline */}
      {sections.length === 0 ? (
        <View style={styles.emptyState}>
          <MaterialCommunityIcons name="clipboard-text-outline" size={48} color={colors.textTertiary} />
          <Text style={styles.emptyTitle}>No history recorded</Text>
          <Text style={styles.emptySub}>Your medication activity will appear here</Text>
        </View>
      ) : (
        <FlatList
          data={sections}
          keyExtractor={(item) => item[0]}
          renderItem={({ item }) => (
            <View style={styles.dateSection}>
              <View style={styles.dateBadge}>
                <MaterialCommunityIcons name="calendar" size={12} color={colors.primary} />
                <Text style={styles.dateText}>{item[0]}</Text>
              </View>
              {item[1].map(log => renderItem(log))}
            </View>
          )}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
          contentContainerStyle={{ paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: colors.background, padding: spacing.xxl,
  },
  errorTitle: { ...typography.h3, marginTop: spacing.md },
  errorSub: { ...typography.caption, marginTop: spacing.xs },

  // Header
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.xl, paddingTop: 50, paddingBottom: spacing.lg,
    backgroundColor: colors.surface,
  },
  title: { ...typography.h1 },
  addButton: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
    ...shadows.colored(colors.primary),
  },

  // Filters
  filterBar: {
    flexDirection: 'row', paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md, gap: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1, borderBottomColor: colors.borderLight,
  },
  filterBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: spacing.xs + 2, paddingHorizontal: spacing.md,
    borderRadius: radii.full, backgroundColor: colors.surfaceHover,
  },
  filterBtnActive: { backgroundColor: colors.primary },
  filterDot: { width: 8, height: 8, borderRadius: 4 },
  filterText: { fontSize: 12, fontFamily: fonts.semiBold, color: colors.textSecondary },
  filterTextActive: { color: colors.textInverse },

  // Timeline items
  dateSection: { paddingHorizontal: spacing.xl, marginTop: spacing.lg },
  dateBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.primaryBg, paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md, borderRadius: radii.full,
    alignSelf: 'flex-start', marginBottom: spacing.md,
  },
  dateText: { fontSize: 12, fontFamily: fonts.bold, color: colors.primary },

  timelineItem: {
    flexDirection: 'row', marginBottom: spacing.xs,
  },
  timelineLeft: {
    width: 28, alignItems: 'center',
  },
  timelineDot: {
    width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  timelineLine: {
    flex: 1, width: 2, backgroundColor: colors.border,
    marginVertical: 2,
  },

  timelineCard: {
    flex: 1, marginLeft: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radii.md,
    padding: spacing.md, marginBottom: spacing.sm,
    ...shadows.sm,
  },
  timelineCardHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  medicineName: { fontSize: 14, fontFamily: fonts.semiBold, color: colors.text, flex: 1 },
  statusBadge: {
    paddingHorizontal: spacing.sm, paddingVertical: 2,
    borderRadius: radii.full,
  },
  statusText: { fontSize: 11, fontFamily: fonts.bold },
  timeText: { fontSize: 12, fontFamily: fonts.regular, color: colors.textTertiary, marginTop: 4 },
  reasonText: { fontSize: 12, fontFamily: fonts.regular, color: colors.textSecondary, marginTop: 4, fontStyle: 'italic' },

  // Empty state
  emptyState: {
    flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xxl,
  },
  emptyTitle: { ...typography.bodySemiBold, color: colors.textSecondary, marginTop: spacing.md },
  emptySub: { ...typography.caption, marginTop: spacing.xs },
});

export default HistoryScreen;
