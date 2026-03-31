import React, { useState, useEffect, useContext } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView, ActivityIndicator, Switch } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '../api/client';
import DateTimePicker from '@react-native-community/datetimepicker';
import { colors, fonts, spacing, radii, shadows, typography } from '../theme';
import { scheduleMedicationReminder, cancelAllReminders } from '../services/NotificationService';
import { AuthContext } from '../context/AuthContext';

const TYPE_UNITS = {
  TABLET: { options: ['Tablet(s)', 'Capsule(s)'], default: 'Tablet(s)', icon: 'pill' },
  SYRUP: { options: ['mL', 'Teaspoon(s)', 'Tablespoon(s)'], default: 'mL', icon: 'bottle-tonic' },
  INJECTION: { options: ['mL', 'Unit(s)', 'IU'], default: 'mL', icon: 'needle' },
  OTHER: { options: ['Dose(s)', 'Unit(s)', 'Tablet(s)', 'mL', 'Puff(s)', 'Drop(s)'], default: 'Dose(s)', icon: 'help-circle' },
};

const TYPES = Object.keys(TYPE_UNITS);

const DAYS_OF_WEEK = [
  { key: 'SUN', label: 'S' },
  { key: 'MON', label: 'M' },
  { key: 'TUE', label: 'T' },
  { key: 'WED', label: 'W' },
  { key: 'THU', label: 'T' },
  { key: 'FRI', label: 'F' },
  { key: 'SAT', label: 'S' },
];

const EditScheduleScreen = ({ navigation, route }) => {
  const schedule = route.params?.schedule || {};
  const medicine = schedule.medicine || {};
  
  const [doseAmount, setDoseAmount] = useState(String(schedule.doseAmount || '1'));
  const [doseUnit, setDoseUnit] = useState(schedule.doseUnit || TYPE_UNITS[medicine.type?.toUpperCase()]?.default || 'Tablet(s)');
  const [currentStock, setCurrentStock] = useState(schedule.currentStock != null ? String(schedule.currentStock) : '');
  const [frequencyType, setFrequencyType] = useState(schedule.frequencyType || 'DAILY');
  const [customDays, setCustomDays] = useState(() => {
    if (schedule.customDays) return schedule.customDays.split(',');
    return [];
  });
  const [notificationsOn, setNotificationsOn] = useState(true);
  const [times, setTimes] = useState(() => {
    if (schedule.scheduleTimes?.length > 0) {
      return schedule.scheduleTimes.map(t => {
        const [h, m] = (t.scheduledTime || '08:00').split(':');
        const d = new Date();
        d.setHours(parseInt(h), parseInt(m), 0, 0);
        return d;
      });
    }
    return [new Date()];
  });
  const [saving, setSaving] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [currentPickerIndex, setCurrentPickerIndex] = useState(0);

  const medType = (medicine.type || 'TABLET').toUpperCase();
  const unitOptions = TYPE_UNITS[medType]?.options || TYPE_UNITS.OTHER.options;
  const isAsNeeded = frequencyType === 'AS_NEEDED';

  // Load per-schedule notification preference
  useEffect(() => {
    const loadNotifPref = async () => {
      try {
        const stored = await AsyncStorage.getItem(`schedule_notif_${schedule.id}`);
        if (stored !== null) {
          setNotificationsOn(stored === 'true');
        }
      } catch (e) {}
    };
    if (schedule.id) loadNotifPref();
  }, [schedule.id]);

  const handleToggleNotification = async (value) => {
    setNotificationsOn(value);
    await AsyncStorage.setItem(`schedule_notif_${schedule.id}`, String(value));
  };

  const toggleDay = (dayKey) => {
    setCustomDays(prev =>
      prev.includes(dayKey) ? prev.filter(d => d !== dayKey) : [...prev, dayKey]
    );
  };

  const onTimeChange = (event, selectedDate) => {
    setShowPicker(false);
    if (selectedDate) {
      const newTimes = [...times];
      newTimes[currentPickerIndex] = selectedDate;
      setTimes(newTimes);
    }
  };

  const showTimepicker = (index) => {
    setCurrentPickerIndex(index);
    setShowPicker(true);
  };

  const formatTime = (date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const removeTime = (index) => {
    if (times.length <= 1) return;
    const newTimes = [...times];
    newTimes.splice(index, 1);
    setTimes(newTimes);
  };

  const addTime = () => {
    setTimes([...times, new Date()]);
  };

  const adjustStock = (delta) => {
    const current = parseInt(currentStock) || 0;
    const newVal = Math.max(0, current + delta);
    setCurrentStock(String(newVal));
  };

  const handleSave = async () => {
    if (!doseAmount) {
      Alert.alert("Error", "Please fill in dosage amount.");
      return;
    }
    if (frequencyType === 'CUSTOM' && customDays.length === 0) {
      Alert.alert('Error', 'Please select at least one day for custom frequency.');
      return;
    }
    
    setSaving(true);
    try {
      const payload = {
        doseAmount: parseFloat(doseAmount) || 1,
        doseUnit: doseUnit,
        currentStock: currentStock.trim() ? parseInt(currentStock) : null,
        frequencyType: frequencyType === 'CUSTOM' ? 'SPECIFIC_DAYS' : frequencyType,
      };

      // Only include times if not AS_NEEDED
      if (!isAsNeeded) {
        payload.times = times.map(t =>
          t.getHours().toString().padStart(2, '0') + ":" + t.getMinutes().toString().padStart(2, '0') + ":00"
        );
      }

      // Include custom days
      if (frequencyType === 'CUSTOM') {
        payload.customDays = customDays.join(',');
      }

      await api.put(`/schedules/${schedule.id}`, payload);
      await AsyncStorage.setItem(`schedule_notif_${schedule.id}`, String(notificationsOn));

      // Re-schedule notifications for the updated times
      if (!isAsNeeded && notificationsOn) {
        const userId = schedule.userId || schedule.user?.id;
        for (const t of times) {
          await scheduleMedicationReminder(
            medicine.name || 'Medication',
            t.getHours(),
            t.getMinutes(),
            schedule.id,
            userId
          );
        }
      }

      Alert.alert("Updated", "Schedule updated successfully!");
      navigation.goBack();
    } catch (e) {
      console.error('[EditSchedule] Save failed:', e.response?.data || e.message);
      Alert.alert("Error", e.response?.data?.message || "Failed to update schedule.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    Alert.alert(
      "Delete Schedule",
      "Are you sure you want to delete this schedule? This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await api.delete(`/schedules/${schedule.id}`);
              Alert.alert("Deleted", "Schedule has been removed.");
              navigation.goBack();
            } catch (e) {
              Alert.alert("Error", "Failed to delete schedule.");
            }
          }
        }
      ]
    );
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        
        {/* Medicine name (read-only) */}
        <View style={styles.medicineHeader}>
          <Text style={styles.medicineName}>{medicine.name || 'Medication'}</Text>
          <Text style={styles.medicineType}>
            <MaterialCommunityIcons name={TYPE_UNITS[medType]?.icon || 'pill'} size={14} color={colors.textSecondary} /> {medType.charAt(0) + medType.slice(1).toLowerCase()}
          </Text>
        </View>

        {/* Dosage */}
        <Text style={styles.label}>Dosage per Dose</Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, { flex: 1, marginRight: 10 }]}
            value={doseAmount}
            onChangeText={setDoseAmount}
            placeholder="1"
            keyboardType="numeric"
            placeholderTextColor={colors.textTertiary}
          />
          <View style={{ flex: 2 }}>
            <View style={styles.chipRow}>
              {unitOptions.map(u => (
                <TouchableOpacity
                  key={u}
                  style={[styles.chip, doseUnit === u && styles.chipActive]}
                  onPress={() => setDoseUnit(u)}
                >
                  <Text style={[styles.chipText, doseUnit === u && styles.chipTextActive]}>{u}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        {/* Frequency */}
        <Text style={styles.label}>Frequency</Text>
        <View style={styles.chipRow}>
          {['DAILY', 'WEEKLY', 'CUSTOM', 'AS_NEEDED'].map(f => (
            <TouchableOpacity
              key={f}
              style={[styles.chip, frequencyType === f && styles.chipActive]}
              onPress={() => setFrequencyType(f)}
            >
              <Text style={[styles.chipText, frequencyType === f && styles.chipTextActive]}>
                {f === 'CUSTOM' ? 'Custom' : f === 'AS_NEEDED' ? 'As Needed' : f.charAt(0) + f.slice(1).toLowerCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Custom Days Selector */}
        {frequencyType === 'CUSTOM' && (
          <View style={styles.daySelector}>
            <Text style={styles.dayLabel}>Select Days</Text>
            <View style={styles.dayRow}>
              {DAYS_OF_WEEK.map(d => (
                <TouchableOpacity
                  key={d.key}
                  style={[styles.dayChip, customDays.includes(d.key) && styles.dayChipActive]}
                  onPress={() => toggleDay(d.key)}
                >
                  <Text style={[styles.dayChipText, customDays.includes(d.key) && styles.dayChipTextActive]}>
                    {d.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* As Needed info */}
        {isAsNeeded && (
          <View style={styles.infoCard}>
            <Text style={styles.infoText}><MaterialCommunityIcons name="information" size={14} color={colors.primary} /> No scheduled reminders — take when needed. Stock tracking still works.</Text>
          </View>
        )}

        {/* Schedule Times — hidden for AS_NEEDED */}
        {!isAsNeeded && (
          <>
            <Text style={styles.label}>Schedule Times</Text>
            {times.map((t, idx) => (
              <View key={idx} style={styles.timeRow}>
                <TouchableOpacity style={styles.timeButton} onPress={() => showTimepicker(idx)}>
                  <Text style={styles.timeButtonText}><MaterialCommunityIcons name="clock-outline" size={16} color={colors.text} /> {formatTime(t)}</Text>
                </TouchableOpacity>
                {times.length > 1 && (
                  <TouchableOpacity style={styles.removeTimeBtn} onPress={() => removeTime(idx)}>
                    <Text style={styles.removeTimeBtnText}><MaterialCommunityIcons name="close" size={16} color={colors.danger} /></Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
            <TouchableOpacity style={styles.addTimeBtn} onPress={addTime}>
              <Text style={styles.addTimeBtnText}>+ Add Another Time</Text>
            </TouchableOpacity>

            {showPicker && (
              <DateTimePicker
                value={times[currentPickerIndex]}
                mode="time"
                is24Hour={false}
                display="default"
                onChange={onTimeChange}
              />
            )}
          </>
        )}

        {/* Stock with +/- controls */}
        <Text style={styles.label}>Current Stock</Text>
        <View style={styles.stockRow}>
          <TouchableOpacity style={styles.stockBtn} onPress={() => adjustStock(-1)}>
            <Text style={styles.stockBtnText}>−</Text>
          </TouchableOpacity>
          <TextInput
            style={[styles.input, styles.stockInput]}
            value={currentStock}
            onChangeText={setCurrentStock}
            placeholder="0"
            keyboardType="numeric"
            placeholderTextColor={colors.textTertiary}
            textAlign="center"
          />
          <TouchableOpacity style={[styles.stockBtn, styles.stockBtnPlus]} onPress={() => adjustStock(1)}>
            <Text style={[styles.stockBtnText, styles.stockBtnPlusText]}>+</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.stockQuickBtn} onPress={() => adjustStock(10)}>
            <Text style={styles.stockQuickBtnText}>+10</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.stockQuickBtn} onPress={() => adjustStock(30)}>
            <Text style={styles.stockQuickBtnText}>+30</Text>
          </TouchableOpacity>
        </View>

        {/* Notification Toggle */}
        <View style={styles.notifCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.notifTitle}><MaterialCommunityIcons name="bell-ring-outline" size={15} color={colors.text} /> Reminders</Text>
            <Text style={styles.notifHint}>
              {notificationsOn 
                ? 'You will get reminders for this medicine' 
                : 'Reminders are off — stock tracking only'}
            </Text>
          </View>
          <Switch
            value={notificationsOn}
            onValueChange={handleToggleNotification}
            trackColor={{ false: colors.border, true: colors.successLight }}
            thumbColor={notificationsOn ? colors.success : colors.textTertiary}
          />
        </View>

        {/* Save Button */}
        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
          {saving ? (
            <ActivityIndicator color={colors.textInverse} />
          ) : (
            <Text style={styles.saveBtnText}><MaterialCommunityIcons name="content-save-outline" size={17} color={colors.textInverse} /> Update Schedule</Text>
          )}
        </TouchableOpacity>

        {/* Delete Button */}
        <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
          <Text style={styles.deleteBtnText}><MaterialCommunityIcons name="delete-outline" size={15} color={colors.danger} /> Delete Schedule</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: { padding: spacing.xl, paddingBottom: 120 },

  medicineHeader: {
    backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg,
    marginBottom: spacing.sm, ...shadows.sm,
  },
  medicineName: { fontSize: 20, fontFamily: fonts.bold, color: colors.text },
  medicineType: { fontSize: 13, fontFamily: fonts.regular, color: colors.textSecondary, marginTop: 2 },

  label: { ...typography.sectionLabel, marginBottom: spacing.xs, marginTop: spacing.lg },
  input: {
    backgroundColor: colors.surfaceHover, borderWidth: 0,
    borderRadius: radii.md, padding: spacing.md, fontSize: 16, fontFamily: fonts.regular, color: colors.text,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start' },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radii.full,
    backgroundColor: colors.surfaceHover,
  },
  chipActive: { backgroundColor: colors.primary },
  chipText: { fontSize: 13, fontFamily: fonts.semiBold, color: colors.textSecondary },
  chipTextActive: { color: colors.textInverse },

  daySelector: { marginTop: spacing.sm },
  dayLabel: { fontSize: 12, fontFamily: fonts.regular, color: colors.textSecondary, marginBottom: spacing.sm },
  dayRow: { flexDirection: 'row', justifyContent: 'space-between' },
  dayChip: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceHover,
  },
  dayChipActive: { backgroundColor: colors.primary },
  dayChipText: { fontSize: 14, fontFamily: fonts.bold, color: colors.textSecondary },
  dayChipTextActive: { color: colors.textInverse },

  infoCard: {
    backgroundColor: colors.primaryBg, borderRadius: radii.md, padding: spacing.md,
    marginTop: spacing.md, borderLeftWidth: 4, borderLeftColor: colors.primary,
  },
  infoText: { fontSize: 13, fontFamily: fonts.regular, color: colors.text, lineHeight: 18 },

  timeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  timeButton: {
    flex: 1, backgroundColor: colors.surfaceHover, padding: spacing.md,
    borderRadius: radii.md,
  },
  timeButtonText: { fontSize: 16, fontFamily: fonts.semiBold, color: colors.text },
  removeTimeBtn: {
    marginLeft: spacing.sm, padding: spacing.sm, backgroundColor: colors.dangerLight, borderRadius: radii.sm,
  },
  removeTimeBtnText: { color: colors.danger, fontFamily: fonts.bold, fontSize: 16 },
  addTimeBtn: { marginTop: spacing.xs, marginBottom: spacing.sm },
  addTimeBtnText: { color: colors.primary, fontFamily: fonts.semiBold, fontSize: 14 },

  stockRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stockInput: { flex: 1 },
  stockBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.dangerLight, alignItems: 'center', justifyContent: 'center',
  },
  stockBtnText: { fontSize: 22, fontFamily: fonts.bold, color: colors.danger },
  stockBtnPlus: { backgroundColor: colors.successLight },
  stockBtnPlusText: { color: colors.success },
  stockQuickBtn: {
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radii.full,
    backgroundColor: colors.primaryBg,
  },
  stockQuickBtnText: { fontSize: 12, fontFamily: fonts.bold, color: colors.primary },

  notifCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg,
    marginTop: spacing.lg, ...shadows.sm,
  },
  notifTitle: { fontSize: 15, fontFamily: fonts.semiBold, color: colors.text },
  notifHint: { fontSize: 11, fontFamily: fonts.regular, color: colors.textTertiary, marginTop: 2 },

  saveBtn: {
    backgroundColor: colors.success, paddingVertical: spacing.lg, borderRadius: radii.md,
    alignItems: 'center', marginTop: spacing.xxl,
    ...shadows.colored(colors.success),
  },
  saveBtnText: { color: colors.textInverse, fontSize: 17, fontFamily: fonts.bold },

  deleteBtn: {
    paddingVertical: spacing.md, borderRadius: radii.md,
    alignItems: 'center', marginTop: spacing.md,
    backgroundColor: colors.dangerLight,
  },
  deleteBtnText: { color: colors.danger, fontSize: 15, fontFamily: fonts.semiBold },
});

export default EditScheduleScreen;
