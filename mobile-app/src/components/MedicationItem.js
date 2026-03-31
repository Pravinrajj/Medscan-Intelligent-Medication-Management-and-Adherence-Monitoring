import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, fonts, spacing, radii, shadows } from '../theme';

const TYPE_ICONS = {
  TABLET: 'pill',
  CAPSULE: 'pill',
  SYRUP: 'bottle-tonic',
  INJECTION: 'needle',
  DROPS: 'eyedropper',
  INHALER: 'lungs',
  CREAM: 'lotion-outline',
  OTHER: 'medical-bag',
};

const getTimeStatus = (scheduleTimes, frequencyType) => {
  if (frequencyType === 'AS_NEEDED') {
    return { isActive: true, statusText: 'Take as needed', isOverdue: false };
  }
  if (!scheduleTimes || scheduleTimes.length === 0) {
    return { isActive: true, statusText: '', isOverdue: false };
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
      hasOverdue = true;
      overdueLabel = label;
    } else {
      if (!closestUpcoming || schedMinutes < closestUpcoming.minutes) {
        closestUpcoming = { minutes: schedMinutes, label };
      }
    }
  }

  if (hasOverdue) {
    return { isActive: true, statusText: `Overdue since ${overdueLabel}`, isOverdue: true };
  }
  if (closestUpcoming) {
    return { isActive: true, statusText: `Next at ${closestUpcoming.label}`, isOverdue: false };
  }
  return { isActive: false, statusText: 'All doses done', isOverdue: false };
};

const MedicationItem = ({ schedule, onTaken, onMissed, onSnooze, onPress, onUndo, loggedToday, snoozedToday, readOnly }) => {
  const medicine = schedule?.medicine || {};
  const scheduleTimes = schedule?.scheduleTimes || [];
  const frequencyType = schedule?.frequencyType;
  const medType = (medicine.type || schedule?.type || 'OTHER').toUpperCase();
  const typeIcon = TYPE_ICONS[medType] || TYPE_ICONS.OTHER;

  const timeStatus = useMemo(() => getTimeStatus(scheduleTimes, frequencyType), [scheduleTimes, frequencyType]);
  const timesDisplay = scheduleTimes
    .map(t => (t.scheduledTime || '').substring(0, 5))
    .filter(Boolean);

  const dosageText = `${schedule?.doseAmount || '1'} ${schedule?.doseUnit || 'Dose'}`;
  const isAsNeeded = frequencyType === 'AS_NEEDED';
  const hasStock = schedule?.currentStock != null;
  const isLowStock = hasStock && schedule.currentStock <= 5;

  return (
    <TouchableOpacity
      style={[styles.card, loggedToday && styles.cardDone, snoozedToday && styles.cardSnoozed]}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
    >
      {/* Top Row: Icon + Name + Status */}
      <View style={styles.topRow}>
        <View style={[styles.typeIcon, { backgroundColor: colors.primaryBg }]}>
          <MaterialCommunityIcons name={typeIcon} size={18} color={colors.primary} />
        </View>
        <View style={styles.nameSection}>
          <Text style={styles.medName} numberOfLines={1}>{medicine.name || 'Medication'}</Text>
          <Text style={styles.dosage}>{dosageText}</Text>
        </View>
        {/* Stock indicator */}
        {hasStock && (
          <View style={[styles.stockBadge, isLowStock && styles.stockBadgeLow]}>
            <MaterialCommunityIcons
              name={isLowStock ? 'alert-outline' : 'package-variant'}
              size={12}
              color={isLowStock ? colors.danger : colors.textTertiary}
            />
            <Text style={[styles.stockText, isLowStock && styles.stockTextLow]}>
              {schedule.currentStock}
            </Text>
          </View>
        )}
      </View>

      {/* Middle: Time chips + Status */}
      <View style={styles.middleRow}>
        {/* Time chips */}
        {!isAsNeeded && timesDisplay.length > 0 && (
          <View style={styles.timeChips}>
            <MaterialCommunityIcons name="clock-outline" size={13} color={colors.textTertiary} />
            {timesDisplay.map((t, i) => (
              <View key={i} style={styles.timeChip}>
                <Text style={styles.timeChipText}>{t}</Text>
              </View>
            ))}
          </View>
        )}

        {isAsNeeded && (
          <View style={styles.asNeededChip}>
            <MaterialCommunityIcons name="gesture-tap" size={12} color={colors.info} />
            <Text style={styles.asNeededText}>As Needed</Text>
          </View>
        )}

        {/* Status */}
        {!loggedToday && !snoozedToday && timeStatus.statusText ? (
          <View style={[styles.statusChip, timeStatus.isOverdue && styles.statusOverdue]}>
            <MaterialCommunityIcons
              name={timeStatus.isOverdue ? 'alert-circle' : 'clock-fast'}
              size={12}
              color={timeStatus.isOverdue ? colors.warningDark : colors.textTertiary}
            />
            <Text style={[styles.statusText, timeStatus.isOverdue && styles.statusTextOverdue]}>
              {timeStatus.statusText}
            </Text>
          </View>
        ) : null}

        {loggedToday && (
          <View style={styles.doneChip}>
            <MaterialCommunityIcons name="check-circle" size={13} color={colors.success} />
            <Text style={styles.doneChipText}>Recorded</Text>
          </View>
        )}

        {snoozedToday && (
          <View style={styles.snoozedChip}>
            <MaterialCommunityIcons name="clock-alert-outline" size={13} color={colors.snoozed} />
            <Text style={styles.snoozedChipText}>Snoozed</Text>
          </View>
        )}
      </View>

      {/* Bottom: Action buttons */}
      <View style={styles.actionRow}>
        {readOnly ? (
          <View style={styles.doneIndicator}>
            <MaterialCommunityIcons name="eye-outline" size={14} color={colors.textTertiary} />
            <Text style={[styles.doneLabel, { color: colors.textTertiary }]}>View only</Text>
          </View>
        ) : loggedToday || snoozedToday ? (
          <>
            <View style={styles.doneIndicator}>
              <MaterialCommunityIcons
                name={snoozedToday ? 'clock-outline' : 'check-circle-outline'}
                size={16}
                color={snoozedToday ? colors.snoozed : colors.success}
              />
              <Text style={[styles.doneLabel, snoozedToday && { color: colors.snoozed }]}>
                {snoozedToday ? 'Snoozed' : 'Done'}
              </Text>
            </View>
            {onUndo && (
              <TouchableOpacity style={styles.undoBtn} onPress={onUndo} activeOpacity={0.7}>
                <MaterialCommunityIcons name="undo-variant" size={14} color={colors.danger} />
                <Text style={styles.undoBtnText}>Undo</Text>
              </TouchableOpacity>
            )}
          </>
        ) : timeStatus.isActive ? (
          <>
            <TouchableOpacity style={styles.takeBtn} onPress={onTaken} activeOpacity={0.8}>
              <MaterialCommunityIcons name="check" size={16} color={colors.textInverse} />
              <Text style={styles.takeBtnText}>Take</Text>
            </TouchableOpacity>
            {!isAsNeeded && onSnooze && (
              <TouchableOpacity style={styles.snoozeBtn} onPress={onSnooze} activeOpacity={0.8}>
                <MaterialCommunityIcons name="clock-outline" size={14} color={colors.snoozed} />
              </TouchableOpacity>
            )}
            {!isAsNeeded && onMissed && (
              <TouchableOpacity style={styles.missBtn} onPress={onMissed} activeOpacity={0.8}>
                <MaterialCommunityIcons name="close" size={14} color={colors.danger} />
                <Text style={styles.missBtnText}>Miss</Text>
              </TouchableOpacity>
            )}
          </>
        ) : (
          <View style={styles.doneIndicator}>
            <MaterialCommunityIcons name="check-all" size={16} color={colors.success} />
            <Text style={styles.doneLabel}>All done</Text>
          </View>
        )}

        {/* Tap hint arrow */}
        {onPress && (
          <View style={styles.arrowHint}>
            <MaterialCommunityIcons name="chevron-right" size={18} color={colors.textTertiary} />
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  cardDone: {
    backgroundColor: colors.successLight || '#F0FDF4',
    borderLeftWidth: 3,
    borderLeftColor: colors.success,
  },
  cardSnoozed: {
    backgroundColor: colors.warningLight,
    borderLeftWidth: 3,
    borderLeftColor: colors.snoozed,
  },

  // Top row
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  typeIcon: {
    width: 36, height: 36, borderRadius: radii.md,
    alignItems: 'center', justifyContent: 'center',
  },
  nameSection: {
    flex: 1,
  },
  medName: {
    fontSize: 16, fontFamily: fonts.bold, color: colors.text,
  },
  dosage: {
    fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary, marginTop: 1,
  },
  stockBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: spacing.sm, paddingVertical: 3,
    borderRadius: radii.full, backgroundColor: colors.surfaceHover,
  },
  stockBadgeLow: {
    backgroundColor: colors.dangerLight || '#FEF2F2',
  },
  stockText: {
    fontSize: 11, fontFamily: fonts.semiBold, color: colors.textTertiary,
  },
  stockTextLow: {
    color: colors.danger,
  },

  // Middle row
  middleRow: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap',
    gap: spacing.xs, marginTop: spacing.sm,
    paddingLeft: 36 + spacing.sm, // align with name
  },
  timeChips: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  timeChip: {
    backgroundColor: colors.surfaceHover,
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: radii.sm,
  },
  timeChipText: {
    fontSize: 11, fontFamily: fonts.semiBold, color: colors.textSecondary,
  },
  asNeededChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: colors.infoBg || '#EFF6FF',
    paddingHorizontal: spacing.sm, paddingVertical: 2,
    borderRadius: radii.full,
  },
  asNeededText: {
    fontSize: 11, fontFamily: fonts.semiBold, color: colors.info || '#3B82F6',
  },

  statusChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
  },
  statusOverdue: {},
  statusText: {
    fontSize: 11, fontFamily: fonts.medium, color: colors.textTertiary,
  },
  statusTextOverdue: {
    color: colors.warningDark, fontFamily: fonts.semiBold,
  },

  doneChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
  },
  doneChipText: {
    fontSize: 11, fontFamily: fonts.semiBold, color: colors.success,
  },
  snoozedChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
  },
  snoozedChipText: {
    fontSize: 11, fontFamily: fonts.semiBold, color: colors.snoozed,
  },

  // Action row
  actionRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: spacing.sm, marginTop: spacing.sm,
    paddingLeft: 36 + spacing.sm,
  },
  takeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.success, paddingVertical: 7,
    paddingHorizontal: spacing.md, borderRadius: radii.full,
  },
  takeBtnText: {
    fontSize: 13, fontFamily: fonts.bold, color: colors.textInverse,
  },
  snoozeBtn: {
    width: 34, height: 34, borderRadius: 17,
    borderWidth: 1.5, borderColor: colors.snoozed,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  missBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingVertical: 7, paddingHorizontal: spacing.md,
    borderRadius: radii.full, borderWidth: 1.5,
    borderColor: colors.danger, backgroundColor: colors.surface,
  },
  missBtnText: {
    fontSize: 12, fontFamily: fonts.semiBold, color: colors.danger,
  },
  doneIndicator: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  doneLabel: {
    fontSize: 13, fontFamily: fonts.semiBold, color: colors.success,
  },
  undoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingVertical: 4, paddingHorizontal: spacing.sm,
    borderRadius: radii.full, backgroundColor: colors.dangerLight || '#FEF2F2',
  },
  undoBtnText: {
    fontSize: 11, fontFamily: fonts.semiBold, color: colors.danger,
  },
  arrowHint: {
    marginLeft: 'auto',
  },
});

export default React.memo(MedicationItem);
