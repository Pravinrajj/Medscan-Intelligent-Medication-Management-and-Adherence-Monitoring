import React, { useContext, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, RefreshControl, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import api from '../api/client';
import { AuthContext } from '../context/AuthContext';
import CircularProgress from '../components/CircularProgress';
import { useToast } from '../components/Toast';
import { colors, fonts, spacing, radii, shadows, typography, components } from '../theme';

const PERIOD_OPTIONS = [
  { label: '7d', value: 7 },
  { label: '14d', value: 14 },
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
];

const ReportScreen = () => {
  const { userInfo } = useContext(AuthContext);
  const toast = useToast();
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

  useEffect(() => { fetchReport(); }, []);

  const onPeriodChange = (newDays) => {
    setDays(newDays);
    setLoading(true);
    fetchReport(newDays);
  };

  const onRefresh = () => { setRefreshing(true); fetchReport(); };

  const getScoreColor = (rate) => {
    if (rate >= 80) return colors.success;
    if (rate >= 50) return colors.warning;
    return colors.danger;
  };

  // ── Generate PDF Report ─────────────────────────────────────────
  const handleShare = async () => {
    if (!report) return;

    const medRows = (report.medicineBreakdown || []).map(med => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #E2E8F0;font-weight:600;">${med.medicineName}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #E2E8F0;text-align:center;">${med.adherenceRate}%</td>
        <td style="padding:8px 12px;border-bottom:1px solid #E2E8F0;text-align:center;color:#10B981;">${med.taken}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #E2E8F0;text-align:center;color:#EF4444;">${med.missed}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #E2E8F0;text-align:center;color:#F59E0B;">${med.snoozed}</td>
      </tr>
    `).join('');

    const scoreColor = report.overallAdherenceRate >= 80 ? '#10B981' : report.overallAdherenceRate >= 50 ? '#F59E0B' : '#EF4444';
    const dateStr = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

    const html = `
    <html>
    <head>
      <meta charset="utf-8"/>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin:0; padding:0; color:#0F172A; }
        .header { background: linear-gradient(135deg, #0891B2, #0E7490); color:white; padding:32px 24px; }
        .header h1 { margin:0; font-size:24px; }
        .header p { margin:4px 0 0; opacity:0.85; font-size:13px; }
        .body { padding:24px; }
        .stats-grid { display:flex; gap:16px; margin-bottom:24px; }
        .stat-card { flex:1; background:#F8FAFC; border-radius:12px; padding:16px; text-align:center; border:1px solid #E2E8F0; }
        .stat-value { font-size:28px; font-weight:700; }
        .stat-label { font-size:11px; color:#64748B; margin-top:4px; text-transform:uppercase; letter-spacing:0.5px; }
        .section-title { font-size:16px; font-weight:700; margin:24px 0 12px; color:#0F172A; }
        table { width:100%; border-collapse:collapse; font-size:13px; }
        th { background:#F1F5F9; padding:10px 12px; text-align:left; font-size:11px; text-transform:uppercase; color:#64748B; letter-spacing:0.5px; border-bottom:2px solid #E2E8F0; }
        .footer { margin-top:32px; padding-top:16px; border-top:1px solid #E2E8F0; text-align:center; font-size:11px; color:#94A3B8; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>MedScan Adherence Report</h1>
        <p>${days}-Day Summary | ${userInfo?.fullName || userInfo?.username} | ${dateStr}</p>
      </div>
      <div class="body">
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-value" style="color:${scoreColor}">${report.overallAdherenceRate}%</div>
            <div class="stat-label">Overall Adherence</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" style="color:#10B981">${report.totalTaken}</div>
            <div class="stat-label">Taken</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" style="color:#EF4444">${report.totalMissed}</div>
            <div class="stat-label">Missed</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" style="color:#F59E0B">${report.totalSnoozed}</div>
            <div class="stat-label">Snoozed</div>
          </div>
        </div>

        <div class="section-title">Medicine Breakdown</div>
        <table>
          <thead>
            <tr>
              <th>Medicine</th>
              <th style="text-align:center;">Adherence</th>
              <th style="text-align:center;">Taken</th>
              <th style="text-align:center;">Missed</th>
              <th style="text-align:center;">Snoozed</th>
            </tr>
          </thead>
          <tbody>${medRows}</tbody>
        </table>

        <div class="footer">
          Generated by MedScan App | ${dateStr}
        </div>
      </div>
    </body>
    </html>`;

    try {
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: 'MedScan Adherence Report',
          UTI: 'com.adobe.pdf',
        });
      } else {
        toast.info('PDF saved but sharing not available on this device.');
      }
    } catch (e) {
      console.log('[Report] PDF failed, falling back to text:', e.message);
      // Fallback to text share
      const lines = [
        `MedScan Adherence Report (${days} days)`,
        `Generated: ${dateStr}`,
        `Patient: ${userInfo?.fullName || userInfo?.username}`,
        '',
        `Overall Adherence: ${report.overallAdherenceRate}%`,
        `Taken: ${report.totalTaken} | Missed: ${report.totalMissed} | Snoozed: ${report.totalSnoozed}`,
        '',
        '--- By Medicine ---',
      ];
      (report.medicineBreakdown || []).forEach(med => {
        lines.push(`${med.medicineName}: ${med.adherenceRate}% (T:${med.taken} M:${med.missed} S:${med.snoozed})`);
      });
      lines.push('', 'Generated by MedScan App');
      try {
        await Share.share({ message: lines.join('\n'), title: 'MedScan Report' });
      } catch (err) {
        toast.error('Failed to share report.');
      }
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Generating report...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Period Selector + Share */}
        <View style={styles.topRow}>
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
          <TouchableOpacity style={styles.shareBtn} onPress={handleShare}>
            <MaterialCommunityIcons name="share-variant-outline" size={18} color={colors.primary} />
          </TouchableOpacity>
        </View>

        {!report ? (
          <View style={styles.emptyCard}>
            <MaterialCommunityIcons name="chart-line" size={48} color={colors.textTertiary} />
            <Text style={styles.emptyTitle}>No Data Yet</Text>
            <Text style={styles.emptyText}>Start tracking your medications to see adherence reports</Text>
          </View>
        ) : (
          <>
            {/* Overall Score with Circular Chart */}
            <View style={styles.scoreCard}>
              <CircularProgress
                size={140}
                strokeWidth={12}
                progress={(report.overallAdherenceRate || 0) / 100}
                label={`${report.overallAdherenceRate || 0}%`}
                sublabel="adherence"
              />

              <View style={styles.statsRow}>
                <StatPill value={report.totalTaken} label="Taken" color={colors.taken} icon="check-circle" />
                <StatPill value={report.totalMissed} label="Missed" color={colors.missed} icon="close-circle" />
                <StatPill value={report.totalSnoozed} label="Snoozed" color={colors.snoozed} icon="clock-outline" />
              </View>
            </View>

            {/* Summary Insight */}
            <View style={styles.insightCard}>
              <MaterialCommunityIcons
                name={report.overallAdherenceRate >= 80 ? "shield-check" : "alert-circle-outline"}
                size={20}
                color={report.overallAdherenceRate >= 80 ? colors.success : colors.warning}
              />
              <Text style={styles.insightText}>
                {report.overallAdherenceRate >= 90
                  ? 'Excellent adherence. Keep it up!'
                  : report.overallAdherenceRate >= 70
                    ? 'Good adherence, but there is room for improvement.'
                    : report.overallAdherenceRate >= 50
                      ? 'Moderate adherence. Try to take doses on time.'
                      : 'Low adherence. Set reminders to help stay on track.'}
              </Text>
            </View>

            {/* Per-Medicine Breakdown */}
            <Text style={styles.sectionTitle}>By Medicine</Text>
            {(report.medicineBreakdown || []).map((med, idx) => (
              <View key={idx} style={styles.medCard}>
                <View style={styles.medHeader}>
                  <Text style={styles.medName} numberOfLines={1}>{med.medicineName}</Text>
                  <Text style={[styles.medRate, { color: getScoreColor(med.adherenceRate) }]}>
                    {med.adherenceRate}%
                  </Text>
                </View>

                {/* Progress bar */}
                <View style={styles.medBar}>
                  <View style={[styles.medBarFill, {
                    width: `${Math.min(med.adherenceRate, 100)}%`,
                    backgroundColor: getScoreColor(med.adherenceRate),
                  }]} />
                </View>

                <View style={styles.medStats}>
                  <MiniStat icon="check-circle" color={colors.taken} value={med.taken} />
                  <MiniStat icon="close-circle" color={colors.missed} value={med.missed} />
                  <MiniStat icon="clock-outline" color={colors.snoozed} value={med.snoozed} />
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
      </ScrollView>
    </SafeAreaView>
  );
};

// ─── Sub-components ──────────────────────────────────────────────
const StatPill = ({ value, label, color, icon }) => (
  <View style={styles.statPill}>
    <MaterialCommunityIcons name={icon} size={16} color={color} />
    <Text style={[styles.statValue, { color }]}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

const MiniStat = ({ icon, color, value }) => (
  <View style={styles.miniStat}>
    <MaterialCommunityIcons name={icon} size={14} color={color} />
    <Text style={styles.miniStatText}>{value}</Text>
  </View>
);

// ─── Styles ──────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, paddingBottom: spacing.section },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  loadingText: { ...typography.caption, marginTop: spacing.md },

  // Top row
  topRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: spacing.xl,
  },
  periodRow: { flexDirection: 'row', gap: spacing.sm },
  periodChip: {
    paddingVertical: spacing.xs + 2, paddingHorizontal: spacing.md,
    borderRadius: radii.full, backgroundColor: colors.surface, ...shadows.sm,
  },
  periodChipActive: { backgroundColor: colors.primary },
  periodText: { fontSize: 13, fontFamily: fonts.semiBold, color: colors.textSecondary },
  periodTextActive: { color: colors.textInverse },
  shareBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primaryBg,
    alignItems: 'center', justifyContent: 'center',
  },

  // Score card
  scoreCard: {
    backgroundColor: colors.surface, borderRadius: radii.xxl, padding: spacing.xxl,
    alignItems: 'center', marginBottom: spacing.lg, ...shadows.md,
  },
  statsRow: {
    flexDirection: 'row', width: '100%', justifyContent: 'space-around', marginTop: spacing.xl,
    paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.borderLight,
  },
  statPill: { alignItems: 'center', gap: 4 },
  statValue: { fontSize: 20, fontFamily: fonts.bold },
  statLabel: { fontSize: 11, fontFamily: fonts.medium, color: colors.textTertiary },

  // Insight
  insightCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.primaryBg, borderRadius: radii.lg, padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  insightText: { flex: 1, fontSize: 13, fontFamily: fonts.medium, color: colors.text, lineHeight: 20 },

  // Section
  sectionTitle: { ...typography.sectionLabel, marginBottom: spacing.md },

  // Medicine cards
  medCard: {
    backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg,
    marginBottom: spacing.md, ...shadows.sm,
  },
  medHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm,
  },
  medName: { fontSize: 14, fontFamily: fonts.semiBold, color: colors.text, flex: 1, marginRight: spacing.sm },
  medRate: { fontSize: 18, fontFamily: fonts.bold },
  medBar: {
    height: 6, backgroundColor: colors.chartTrack, borderRadius: 3,
    overflow: 'hidden', marginBottom: spacing.sm,
  },
  medBarFill: { height: '100%', borderRadius: 3 },
  medStats: { flexDirection: 'row', gap: spacing.lg },
  miniStat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  miniStatText: { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },

  // Empty
  emptyCard: {
    backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.xxl,
    alignItems: 'center', ...shadows.sm,
  },
  emptyTitle: { ...typography.bodySemiBold, color: colors.textSecondary, marginTop: spacing.md },
  emptyText: { ...typography.caption, textAlign: 'center', marginTop: spacing.xs },
});

export default ReportScreen;
