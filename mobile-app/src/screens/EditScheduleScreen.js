import React, { useState, useContext, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView, ActivityIndicator, Switch } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '../api/client';
import { AuthContext } from '../context/AuthContext';
import DateTimePicker from '@react-native-community/datetimepicker';

const TYPE_UNITS = {
  TABLET: { options: ['Tablet(s)', 'Capsule(s)'], default: 'Tablet(s)' },
  SYRUP: { options: ['mL', 'Teaspoon(s)', 'Tablespoon(s)'], default: 'mL' },
  INJECTION: { options: ['mL', 'Unit(s)', 'IU'], default: 'mL' },
  DROPS: { options: ['Drop(s)'], default: 'Drop(s)' },
  CREAM: { options: ['Application(s)', 'g', 'cm'], default: 'Application(s)' },
  INHALER: { options: ['Puff(s)'], default: 'Puff(s)' },
  PATCH: { options: ['Patch(es)'], default: 'Patch(es)' },
  OTHER: { options: ['Dose(s)', 'Unit(s)', 'Tablet(s)', 'mL'], default: 'Dose(s)' },
};

const EditScheduleScreen = ({ navigation, route }) => {
  const schedule = route.params?.schedule || {};
  const medicine = schedule.medicine || {};
  
  const [doseAmount, setDoseAmount] = useState(String(schedule.doseAmount || '1'));
  const [doseUnit, setDoseUnit] = useState(schedule.doseUnit || TYPE_UNITS[medicine.type?.toUpperCase()]?.default || 'Tablet(s)');
  const [currentStock, setCurrentStock] = useState(schedule.currentStock != null ? String(schedule.currentStock) : '');
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

  // Load per-schedule notification preference
  useEffect(() => {
    const loadNotifPref = async () => {
      try {
        const stored = await AsyncStorage.getItem(`schedule_notif_${schedule.id}`);
        if (stored !== null) {
          setNotificationsOn(stored === 'true');
        }
        // Default is true (on) if never set
      } catch (e) {}
    };
    if (schedule.id) loadNotifPref();
  }, [schedule.id]);

  const handleToggleNotification = async (value) => {
    setNotificationsOn(value);
    await AsyncStorage.setItem(`schedule_notif_${schedule.id}`, String(value));
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

  const handleSave = async () => {
    if (!doseAmount) {
      Alert.alert("Error", "Please fill in dosage amount.");
      return;
    }
    
    setSaving(true);
    try {
      const formattedTimes = times.map(t => {
        return t.getHours().toString().padStart(2, '0') + ":" + t.getMinutes().toString().padStart(2, '0') + ":00";
      });

      const payload = {
        doseAmount: parseFloat(doseAmount) || 1,
        doseUnit: doseUnit,
        currentStock: currentStock.trim() ? parseInt(currentStock) : null,
        times: formattedTimes,
        frequencyType: schedule.frequencyType || 'DAILY',
      };

      await api.put(`/schedules/${schedule.id}`, payload);
      // Save notification preference
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

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        
        {/* Medicine name (read-only) */}
        <View style={styles.medicineHeader}>
          <Text style={styles.medicineName}>{medicine.name || 'Medication'}</Text>
          <Text style={styles.medicineType}>{medicine.type || ''}</Text>
        </View>

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

        {/* Schedule Times */}
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

        {/* Stock */}
        <Text style={styles.label}>Current Stock</Text>
        <TextInput
          style={styles.input}
          value={currentStock}
          onChangeText={setCurrentStock}
          placeholder="e.g., 30"
          keyboardType="numeric"
          placeholderTextColor="#bdc3c7"
        />

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
});

export default EditScheduleScreen;
