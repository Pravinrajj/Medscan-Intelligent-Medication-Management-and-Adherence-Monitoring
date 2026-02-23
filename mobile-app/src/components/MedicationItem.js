import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

/**
 * Determines the status of each scheduled time for today.
 * Returns: { isActive: boolean, activeTimeLabel: string, statusText: string }
 * 
 * - "active" = within ±10 min of a scheduled time (show Take/Miss/Snooze)
 * - "upcoming" = next scheduled time is in the future (show upcoming time)
 * - "done" = all times have passed today (show Done)
 */
const getTimeStatus = (scheduleTimes) => {
  if (!scheduleTimes || scheduleTimes.length === 0) {
    return { isActive: true, activeTimeLabel: '', statusText: '' };
  }

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const WINDOW = 10; // ±10 minutes

  let closestUpcoming = null;
  let isInWindow = false;
  let activeTimeLabel = '';

  for (const t of scheduleTimes) {
    const timeStr = t.scheduledTime || '';
    const parts = timeStr.split(':');
    if (parts.length < 2) continue;
    
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) continue;
    
    const schedMinutes = h * 60 + m;
    const diff = nowMinutes - schedMinutes;
    
    // Within ±10 min window
    if (diff >= -WINDOW && diff <= WINDOW) {
      isInWindow = true;
      activeTimeLabel = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      break;
    }
    
    // Track closest upcoming time
    if (schedMinutes > nowMinutes) {
      if (!closestUpcoming || schedMinutes < closestUpcoming.minutes) {
        closestUpcoming = { 
          minutes: schedMinutes, 
          label: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` 
        };
      }
    }
  }

  if (isInWindow) {
    return { isActive: true, activeTimeLabel, statusText: `Due: ${activeTimeLabel}` };
  }
  
  if (closestUpcoming) {
    return { isActive: false, activeTimeLabel: '', statusText: `Upcoming: ${closestUpcoming.label}` };
  }

  // All times have passed
  return { isActive: false, activeTimeLabel: '', statusText: 'All doses done for today' };
};

const MedicationItem = ({ schedule, onTaken, onMissed, onSnooze, onPress, loggedToday }) => {
  const medicine = schedule?.medicine || {};
  const scheduleTimes = schedule?.scheduleTimes || [];
  
  const timeStatus = useMemo(() => getTimeStatus(scheduleTimes), [scheduleTimes]);
  const timesDisplay = scheduleTimes
    .map(t => (t.scheduledTime || '').substring(0, 5))
    .filter(Boolean)
    .join(', ');

  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.infoSection} onPress={onPress} activeOpacity={onPress ? 0.6 : 1}>
        <Text style={styles.medName}>{medicine.name || 'Medication'}</Text>
        <Text style={styles.details}>
          Take: {schedule?.doseAmount || '1'} {schedule?.doseUnit || 'Dose'}{medicine.type ? ` (${medicine.type})` : ''}
        </Text>
        {schedule?.currentStock != null && (
          <Text style={[styles.stock, schedule.currentStock <= 5 ? styles.lowStock : null]}>
              Stock: {schedule.currentStock} left
          </Text>
        )}
        {timesDisplay ? (
          <Text style={styles.time}>⏰ {timesDisplay}</Text>
        ) : null}
        
        {/* Status indicator */}
        <Text style={[
          styles.statusText, 
          timeStatus.isActive ? styles.statusActive : styles.statusUpcoming
        ]}>
          {loggedToday ? '✅ Recorded today' : timeStatus.statusText}
        </Text>
        
        {onPress && <Text style={styles.tapHint}>Tap for details →</Text>}
      </TouchableOpacity>

      {/* Action Buttons */}
      <View style={styles.actions}>
        {loggedToday ? (
          <View style={styles.doneIndicator}>
            <Text style={styles.doneText}>Done ✓</Text>
          </View>
        ) : timeStatus.isActive ? (
          <>
            <TouchableOpacity style={styles.takeButton} onPress={onTaken}>
              <Text style={styles.takeButtonText}>✓ Take</Text>
            </TouchableOpacity>
            {onSnooze && (
              <TouchableOpacity style={styles.snoozeButton} onPress={onSnooze}>
                <Text style={styles.snoozeButtonText}>⏰</Text>
              </TouchableOpacity>
            )}
            {onMissed && (
              <TouchableOpacity style={styles.missButton} onPress={onMissed}>
                <Text style={styles.missButtonText}>✗ Miss</Text>
              </TouchableOpacity>
            )}
          </>
        ) : (
          <View style={styles.waitIndicator}>
            <Text style={styles.waitText}>
              {timeStatus.statusText.startsWith('Upcoming') ? '⏳' : '✅'}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 12,
    marginBottom: 10,
    elevation: 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  infoSection: {
    flex: 1,
    paddingRight: 10,
  },
  medName: {
    fontSize: 17,
    fontWeight: '700',
    color: '#2c3e50',
  },
  details: {
    color: '#7f8c8d',
    fontSize: 13,
    marginTop: 2,
  },
  time: {
    marginTop: 5,
    fontWeight: '600',
    color: '#4a90e2',
    fontSize: 13,
  },
  stock: {
    fontSize: 12,
    marginTop: 2,
    color: '#27ae60',
  },
  lowStock: {
    color: '#e74c3c',
    fontWeight: 'bold',
  },
  statusText: {
    fontSize: 11,
    marginTop: 4,
    fontWeight: '600',
  },
  statusActive: {
    color: '#e67e22',
  },
  statusUpcoming: {
    color: '#95a5a6',
  },
  tapHint: {
    fontSize: 11,
    color: '#bdc3c7',
    marginTop: 4,
  },
  actions: {
    alignItems: 'center',
    gap: 6,
  },
  takeButton: {
    backgroundColor: '#2ecc71',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    minWidth: 70,
    alignItems: 'center',
  },
  takeButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  snoozeButton: {
    backgroundColor: '#f39c12',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 18,
    minWidth: 50,
    alignItems: 'center',
  },
  snoozeButtonText: {
    fontSize: 16,
  },
  missButton: {
    backgroundColor: '#fff',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e74c3c',
    minWidth: 70,
    alignItems: 'center',
  },
  missButtonText: {
    color: '#e74c3c',
    fontWeight: '600',
    fontSize: 12,
  },
  doneIndicator: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: '#eafaf1',
  },
  doneText: {
    color: '#27ae60',
    fontWeight: '700',
    fontSize: 13,
  },
  waitIndicator: {
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  waitText: {
    fontSize: 20,
  },
});

export default MedicationItem;
