import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView, ActivityIndicator, Switch } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '../api/client';
import DateTimePicker from '@react-native-community/datetimepicker';

const TYPE_UNITS = {
  TABLET: { options: ['Tablet(s)', 'Capsule(s)'], default: 'Tablet(s)', icon: '💊' },
  SYRUP: { options: ['mL', 'Teaspoon(s)', 'Tablespoon(s)'], default: 'mL', icon: '🧴' },
  INJECTION: { options: ['mL', 'Unit(s)', 'IU'], default: 'mL', icon: '💉' },
  OTHER: { options: ['Dose(s)', 'Unit(s)', 'Tablet(s)', 'mL', 'Puff(s)', 'Drop(s)'], default: 'Dose(s)', icon: '💠' },
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
          <Text style={styles.medicineType}>{TYPE_UNITS[medType]?.icon} {medType.charAt(0) + medType.slice(1).toLowerCase()}</Text>
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
            placeholderTextColor="#bdc3c7"
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
            <Text style={styles.infoText}>ℹ️ No scheduled reminders — take when needed. Stock tracking still works.</Text>
          </View>
        )}

        {/* Schedule Times — hidden for AS_NEEDED */}
        {!isAsNeeded && (
          <>
            <Text style={styles.label}>Schedule Times</Text>
            {times.map((t, idx) => (
              <View key={idx} style={styles.timeRow}>
                <TouchableOpacity style={styles.timeButton} onPress={() => showTimepicker(idx)}>
                  <Text style={styles.timeButtonText}>⏰ {formatTime(t)}</Text>
                </TouchableOpacity>
                {times.length > 1 && (
                  <TouchableOpacity style={styles.removeTimeBtn} onPress={() => removeTime(idx)}>
                    <Text style={styles.removeTimeBtnText}>✗</Text>
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
            placeholderTextColor="#bdc3c7"
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
            <Text style={styles.notifTitle}>🔔 Reminders</Text>
            <Text style={styles.notifHint}>
              {notificationsOn 
                ? 'You will get reminders for this medicine' 
                : 'Reminders are off — stock tracking only'}
            </Text>
          </View>
          <Switch
            value={notificationsOn}
            onValueChange={handleToggleNotification}
            trackColor={{ false: '#d1d5db', true: '#86efac' }}
            thumbColor={notificationsOn ? '#22c55e' : '#9ca3af'}
          />
        </View>

        {/* Save Button */}
        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveBtnText}>💾 Update Schedule</Text>
          )}
        </TouchableOpacity>

        {/* Delete Button */}
        <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
          <Text style={styles.deleteBtnText}>🗑️ Delete Schedule</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f9fc' },
  scrollContent: { padding: 20, paddingBottom: 40 },

  medicineHeader: {
    backgroundColor: '#fff', borderRadius: 14, padding: 16,
    marginBottom: 8, elevation: 2,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4,
  },
  medicineName: { fontSize: 20, fontWeight: '800', color: '#2c3e50' },
  medicineType: { fontSize: 13, color: '#7f8c8d', marginTop: 2 },

  label: { fontSize: 13, fontWeight: '700', color: '#34495e', marginBottom: 6, marginTop: 16, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#e0e6ed',
    borderRadius: 12, padding: 14, fontSize: 16, color: '#2c3e50',
  },
  row: { flexDirection: 'row', alignItems: 'flex-start' },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20,
    borderWidth: 1, borderColor: '#ddd', backgroundColor: '#fff',
  },
  chipActive: { backgroundColor: '#3498db', borderColor: '#3498db' },
  chipText: { fontSize: 13, fontWeight: '600', color: '#7f8c8d' },
  chipTextActive: { color: '#fff' },

  daySelector: { marginTop: 8 },
  dayLabel: { fontSize: 12, color: '#7f8c8d', marginBottom: 8 },
  dayRow: { flexDirection: 'row', justifyContent: 'space-between' },
  dayChip: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#ddd',
  },
  dayChipActive: { backgroundColor: '#3498db', borderColor: '#3498db' },
  dayChipText: { fontSize: 14, fontWeight: '700', color: '#7f8c8d' },
  dayChipTextActive: { color: '#fff' },

  infoCard: {
    backgroundColor: '#e8f4fd', borderRadius: 12, padding: 14,
    marginTop: 12, borderLeftWidth: 4, borderLeftColor: '#3498db',
  },
  infoText: { fontSize: 13, color: '#34495e', lineHeight: 18 },

  timeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  timeButton: {
    flex: 1, backgroundColor: '#fff', padding: 14,
    borderRadius: 12, borderWidth: 1, borderColor: '#e0e6ed',
  },
  timeButtonText: { fontSize: 16, color: '#2c3e50', fontWeight: '600' },
  removeTimeBtn: {
    marginLeft: 10, padding: 10, backgroundColor: '#fef2f2', borderRadius: 10,
  },
  removeTimeBtnText: { color: '#e74c3c', fontWeight: '700', fontSize: 16 },
  addTimeBtn: { marginTop: 4, marginBottom: 8 },
  addTimeBtnText: { color: '#3498db', fontWeight: '600', fontSize: 14 },

  stockRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stockInput: { flex: 1 },
  stockBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#fef2f2', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#e74c3c',
  },
  stockBtnText: { fontSize: 22, fontWeight: '700', color: '#e74c3c' },
  stockBtnPlus: { backgroundColor: '#eafaf1', borderColor: '#27ae60' },
  stockBtnPlusText: { color: '#27ae60' },
  stockQuickBtn: {
    paddingVertical: 8, paddingHorizontal: 12, borderRadius: 16,
    backgroundColor: '#e8f4fd', borderWidth: 1, borderColor: '#3498db',
  },
  stockQuickBtnText: { fontSize: 12, fontWeight: '700', color: '#3498db' },

  notifCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 14, padding: 16,
    marginTop: 16, elevation: 2,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4,
    borderWidth: 1, borderColor: '#e0e6ed',
  },
  notifTitle: { fontSize: 15, fontWeight: '600', color: '#2c3e50' },
  notifHint: { fontSize: 11, color: '#95a5a6', marginTop: 2 },

  saveBtn: {
    backgroundColor: '#27ae60', paddingVertical: 16, borderRadius: 12,
    alignItems: 'center', marginTop: 24,
    elevation: 3, shadowColor: '#27ae60',
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 6,
  },
  saveBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },

  deleteBtn: {
    paddingVertical: 14, borderRadius: 12,
    alignItems: 'center', marginTop: 12,
    borderWidth: 1.5, borderColor: '#e74c3c',
  },
  deleteBtnText: { color: '#e74c3c', fontSize: 15, fontWeight: '600' },
});

export default EditScheduleScreen;
