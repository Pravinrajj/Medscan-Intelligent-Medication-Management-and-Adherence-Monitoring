import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

/**
 * Determines status for the medicine card.
 * No longer uses a ±10 min window — shows action buttons for ALL unlogged times today.
 * Past unlogged times show "Overdue" label, upcoming show "Next: HH:MM".
 */
const getTimeStatus = (scheduleTimes, frequencyType) => {
  // AS_NEEDED medicines always show Take button
  if (frequencyType === 'AS_NEEDED') {
    return { isActive: true, statusText: 'Take as needed', isAsNeeded: true };
  }

  if (!scheduleTimes || scheduleTimes.length === 0) {
    return { isActive: true, statusText: '', isAsNeeded: false };
  }

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  let hasOverdue = false;
  let overdueLabel = '';
  let closestUpcoming = null;

  for (const t of scheduleTimes) {
    const timeStr = t.scheduledTime || '';
    const parts = timeStr.split(':');
    if (parts.length < 2) continue;
    
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) continue;
    
    const schedMinutes = h * 60 + m;
    const label = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    
    if (schedMinutes <= nowMinutes) {
      // Past time — overdue if not logged
      hasOverdue = true;
      overdueLabel = label;
    } else {
      // Upcoming
      if (!closestUpcoming || schedMinutes < closestUpcoming.minutes) {
        closestUpcoming = { minutes: schedMinutes, label };
      }
    }
  }

  if (hasOverdue) {
    return { isActive: true, statusText: `⚠️ Overdue since ${overdueLabel}`, isAsNeeded: false };
  }
  
  if (closestUpcoming) {
    return { isActive: true, statusText: `Next: ${closestUpcoming.label}`, isAsNeeded: false };
  }

  return { isActive: false, statusText: 'All doses done for today', isAsNeeded: false };
};

const MedicationItem = ({ schedule, onTaken, onMissed, onSnooze, onPress, loggedToday }) => {
  const medicine = schedule?.medicine || {};
  const scheduleTimes = schedule?.scheduleTimes || [];
  const frequencyType = schedule?.frequencyType;
  
  const timeStatus = useMemo(() => getTimeStatus(scheduleTimes, frequencyType), [scheduleTimes, frequencyType]);
  const timesDisplay = scheduleTimes
    .map(t => (t.scheduledTime || '').substring(0, 5))
    .filter(Boolean)
    .join(', ');

  // Build smart dosage display (no redundant type)
  const dosageText = `${schedule?.doseAmount || '1'} ${schedule?.doseUnit || 'Dose'}`;
  const isAsNeeded = frequencyType === 'AS_NEEDED';

  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.infoSection} onPress={onPress} activeOpacity={onPress ? 0.6 : 1}>
        <Text style={styles.medName}>{medicine.name || 'Medication'}</Text>
        <Text style={styles.details}>Take: {dosageText}</Text>
        
        {schedule?.currentStock != null && (
          <Text style={[styles.stock, schedule.currentStock <= 5 ? styles.lowStock : null]}>
              Stock: {schedule.currentStock} left
          </Text>
        )}
        
        {/* Show times only for scheduled medicines */}
        {!isAsNeeded && timesDisplay ? (
          <Text style={styles.time}>⏰ {timesDisplay}</Text>
        ) : null}
        
        {/* Frequency badge for special types */}
        {isAsNeeded && (
          <View style={styles.asNeededBadge}>
            <Text style={styles.asNeededText}>As Needed</Text>
          </View>
        )}
        
        {/* Status indicator */}
        <Text style={[
          styles.statusText, 
          loggedToday ? styles.statusDone :
          timeStatus.statusText.includes('Overdue') ? styles.statusOverdue :
          styles.statusUpcoming
        ]}>
          {loggedToday ? '✅ Recorded today' : timeStatus.statusText}
        </Text>
        
        {onPress && <Text style={styles.tapHint}>Tap for details →</Text>}
      </TouchableOpacity>

      {/* Action Buttons — always show for unlogged items */}
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
            {!isAsNeeded && onSnooze && (
              <TouchableOpacity style={styles.snoozeButton} onPress={onSnooze}>
                <Text style={styles.snoozeButtonText}>⏰</Text>
              </TouchableOpacity>
            )}
            {!isAsNeeded && onMissed && (
              <TouchableOpacity style={styles.missButton} onPress={onMissed}>
                <Text style={styles.missButtonText}>✗ Miss</Text>
              </TouchableOpacity>
            )}
          </>
        ) : (
          <View style={styles.doneIndicator}>
            <Text style={styles.doneText}>Done ✓</Text>
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
  asNeededBadge: {
    backgroundColor: '#f0f0ff',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginTop: 4,
  },
  asNeededText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6c5ce7',
  },
  statusText: {
    fontSize: 11,
    marginTop: 4,
    fontWeight: '600',
  },
  statusDone: {
    color: '#27ae60',
  },
  statusOverdue: {
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
});

export default MedicationItem;
