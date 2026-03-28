import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const AdherenceChart = ({ dailyBreakdown }) => {
  if (!dailyBreakdown || dailyBreakdown.length === 0) {
    return null;
  }

  // Take last 7 days
  const last7 = dailyBreakdown.slice(-7);
  const maxTotal = Math.max(...last7.map(d => (d.taken || 0) + (d.missed || 0) + (d.snoozed || 0)), 1);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Weekly Overview</Text>
      <View style={styles.chartRow}>
        {last7.map((day, idx) => {
          const total = (day.taken || 0) + (day.missed || 0) + (day.snoozed || 0);
          const height = total > 0 ? (total / maxTotal) * 100 : 4;
          const takenPct = total > 0 ? (day.taken / total) * 100 : 0;
          
          const dayLabel = day.date 
            ? new Date(day.date).toLocaleDateString('en-US', { weekday: 'short' }).substring(0, 2)
            : '';

          const barColor = takenPct >= 80 ? '#2ecc71' : takenPct >= 50 ? '#f1c40f' : '#e74c3c';

          return (
            <View key={idx} style={styles.barContainer}>
              <View style={styles.barWrapper}>
                <View style={[styles.bar, { height: height, backgroundColor: barColor }]} />
              </View>
              <Text style={styles.dayLabel}>{dayLabel}</Text>
              <Text style={styles.countLabel}>{total}</Text>
            </View>
          );
        })}
      </View>
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#2ecc71' }]} />
          <Text style={styles.legendText}>≥80%</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#f1c40f' }]} />
          <Text style={styles.legendText}>50-79%</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#e74c3c' }]} />
          <Text style={styles.legendText}>&lt;50%</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    marginHorizontal: 16,
    marginBottom: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: '#34495e',
    marginBottom: 14,
    textAlign: 'center',
  },
  chartRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-end',
    height: 150,
    paddingBottom: 6,
  },
  barContainer: {
    alignItems: 'center',
    flex: 1,
  },
  barWrapper: {
    height: 120,
    justifyContent: 'flex-end',
    width: '100%',
    alignItems: 'center',
    paddingBottom: 4,
  },
  bar: {
    width: 20,
    borderRadius: 6,
    minHeight: 4,
  },
  dayLabel: {
    fontSize: 11,
    color: '#95a5a6',
    fontWeight: '600',
    marginTop: 8,
  },
  countLabel: {
    fontSize: 10,
    color: '#bdc3c7',
    marginTop: 3,
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 12,
    gap: 16,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 4,
  },
  legendText: {
    fontSize: 11,
    color: '#95a5a6',
  },
});

export default AdherenceChart;
