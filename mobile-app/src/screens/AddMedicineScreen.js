import React, { useState, useContext, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView, ActivityIndicator, Modal, FlatList, KeyboardAvoidingView, Platform } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import api from '../api/client';
import { AuthContext } from '../context/AuthContext';
import DateTimePicker from '@react-native-community/datetimepicker';

// Multiple common options per type + "Other…" free-text
const TYPE_UNITS = {
  TABLET: { options: ['Tablet(s)', 'Capsule(s)', 'Lozenge(s)'], icon: 'pill' },
  SYRUP: { options: ['mL', 'Teaspoon(s)', 'Tablespoon(s)'], icon: 'bottle-tonic' },
  INJECTION: { options: ['mL', 'Unit(s)'], icon: 'needle' },
  OTHER: { options: ['Dose(s)', 'Drop(s)', 'Puff(s)', 'Patch(es)'], icon: 'help-circle' },
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

const AddMedicineScreen = ({ navigation, route }) => {
  const { userInfo } = useContext(AuthContext);
  const targetUserId = route.params?.targetUserId || userInfo?.id;
  const targetUserName = route.params?.targetUserName;
  
  const [name, setName] = useState('');
  const [type, setType] = useState('TABLET');
  const [doseAmount, setDoseAmount] = useState('1');
  const [doseUnit, setDoseUnit] = useState(TYPE_UNITS.TABLET.options[0]);
  const [isCustomUnit, setIsCustomUnit] = useState(false);
  const [customUnitText, setCustomUnitText] = useState('');
  const [frequencyType, setFrequencyType] = useState('DAILY');
  const [customDays, setCustomDays] = useState([]);
  const [times, setTimes] = useState([new Date()]);
  const [currentStock, setCurrentStock] = useState('');
  const [bundleName, setBundleName] = useState('');
  const [existingBundles, setExistingBundles] = useState([]); // existing bundle names for autocomplete
  const [saving, setSaving] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [currentPickerIndex, setCurrentPickerIndex] = useState(0);

  // Search state
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Unit picker modal
  const [showUnitPicker, setShowUnitPicker] = useState(false);

  // Flag to prevent re-search after selecting a suggestion
  const skipSearchRef = useRef(false);

  // Load existing bundle names on mount
  useEffect(() => {
    const loadBundles = async () => {
      try {
        const res = await api.get(`/schedules/user/${targetUserId}`);
        const names = [...new Set((res.data || [])
          .map(s => s.bundleName)
          .filter(Boolean)
        )];
        setExistingBundles(names);
      } catch (e) {
        // silently fail — not critical
      }
    };
    if (targetUserId) loadBundles();
  }, [targetUserId]);

  const handleTypeChange = (newType) => {
    setType(newType);
    const firstOption = TYPE_UNITS[newType]?.options?.[0] || 'Dose(s)';
    setDoseUnit(firstOption);
    setIsCustomUnit(false);
    setCustomUnitText('');
  };

  const getUnitOptions = () => {
    const opts = TYPE_UNITS[type]?.options || ['Dose(s)'];
    return [...opts, 'Other…'];
  };

  const handleUnitSelect = (unit) => {
    setShowUnitPicker(false);
    if (unit === 'Other…') {
      setIsCustomUnit(true);
      setDoseUnit('');
      setCustomUnitText('');
    } else {
      setIsCustomUnit(false);
      setDoseUnit(unit);
    }
  };

  // Pre-fill from scan results if available
  useEffect(() => {
    if (route.params?.scannedMedicine) {
      const med = route.params.scannedMedicine;
      if (med.name) setName(med.name);
      if (med.type) {
        const t = med.type.toUpperCase();
        if (TYPES.includes(t)) handleTypeChange(t);
      }
      if (med.dosage) setDoseAmount(String(med.dosage));
    }
  }, [route.params]);

  // Autocomplete search with deduplication
  useEffect(() => {
    const searchTimer = setTimeout(async () => {
      if (skipSearchRef.current) {
        skipSearchRef.current = false;
        return;
      }
      if (name.length >= 2) {
        setSearchLoading(true);
        setSearchError(false);
        try {
          const res = await api.get(`/medicines/search?query=${encodeURIComponent(name)}`);
          // Deduplicate by name (case-insensitive) — keep first match
          const seen = new Set();
          const deduped = (res.data || []).filter(item => {
            const key = (item.name || item.medicineName || '').toLowerCase().trim();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          setSearchResults(deduped.slice(0, 8));
          setShowSuggestions(true);
        } catch (e) {
          console.log('[Search] Error:', e.message);
          setSearchError(true);
        } finally {
          setSearchLoading(false);
        }
      } else {
        setSearchResults([]);
        setShowSuggestions(false);
        setSearchError(false);
      }
    }, 300);
    return () => clearTimeout(searchTimer);
  }, [name]);

  const selectSuggestion = (item) => {
    skipSearchRef.current = true;
    setName(item.name || item.medicineName || '');
    if (item.type) {
      const t = String(item.type).toUpperCase();
      if (TYPES.includes(t)) handleTypeChange(t);
    }
    setSearchResults([]);
    setShowSuggestions(false);
  };

  const toggleDay = (dayKey) => {
    setCustomDays(prev =>
      prev.includes(dayKey) ? prev.filter(d => d !== dayKey) : [...prev, dayKey]
    );
  };

  const addTime = () => setTimes([...times, new Date()]);

  const removeTime = (index) => {
    if (times.length <= 1) return;
    const newTimes = [...times];
    newTimes.splice(index, 1);
    setTimes(newTimes);
  };

  const showTimepicker = (index) => {
    setCurrentPickerIndex(index);
    setShowPicker(true);
  };

  const onTimeChange = (event, selectedDate) => {
    setShowPicker(false);
    if (selectedDate) {
      const newTimes = [...times];
      newTimes[currentPickerIndex] = selectedDate;
      setTimes(newTimes);
    }
  };

  const formatTime = (date) => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Please enter a medicine name.');
      return;
    }
    if (!doseAmount) {
      Alert.alert('Error', 'Please enter a dosage amount.');
      return;
    }
    const finalUnit = isCustomUnit ? customUnitText.trim() : doseUnit;
    if (!finalUnit) {
      Alert.alert('Error', 'Please specify the dose unit.');
      return;
    }
    if (frequencyType === 'CUSTOM' && customDays.length === 0) {
      Alert.alert('Error', 'Please select at least one day for custom frequency.');
      return;
    }

    setSaving(true);
    try {
      // Step 1: Create or get the medicine
      const medRes = await api.post('/medicines', {
        name: name.trim(),
        type: type,
      });
      const medicineId = medRes.data.id;

      // Step 2: Build schedule payload
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const schedulePayload = {
        startDate: today,
        doseAmount: parseFloat(doseAmount) || 1,
        doseUnit: finalUnit,
        frequencyType: frequencyType === 'CUSTOM' ? 'SPECIFIC_DAYS' : frequencyType,
        currentStock: currentStock.trim() ? parseInt(currentStock) : null,
      };

      // Only include times if not AS_NEEDED
      if (frequencyType !== 'AS_NEEDED') {
        schedulePayload.times = times.map(t =>
          t.getHours().toString().padStart(2, '0') + ':' + t.getMinutes().toString().padStart(2, '0') + ':00'
        );
      }

      // Include custom days
      if (frequencyType === 'CUSTOM') {
        schedulePayload.customDays = customDays.join(',');
      }

      // Optional bundle
      if (bundleName.trim()) {
        schedulePayload.bundleName = bundleName.trim();
      }

      await api.post(`/schedules/user/${targetUserId}/medicine/${medicineId}`, schedulePayload);
      
      const msg = targetUserName
        ? `${name.trim()} has been added to ${targetUserName}'s schedule.`
        : `${name.trim()} has been added to your schedule.`;
      Alert.alert('Success', msg);
      navigation.goBack();
    } catch (e) {
      console.error('[AddMedicine] Save failed:', e.response?.data || e.message);
      Alert.alert('Error', e.response?.data?.message || 'Failed to save medicine.');
    } finally {
      setSaving(false);
    }
  };

  const isAsNeeded = frequencyType === 'AS_NEEDED';

  const scrollRef = useRef(null);

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        
        {/* Admin creating for member banner */}
        {targetUserName && (
          <View style={styles.adminBanner}>
            <Text style={styles.adminBannerText}><MaterialCommunityIcons name="clipboard-text-outline" size={14} color="#d97706" /> Adding medicine for {targetUserName}</Text>
          </View>
        )}

        {/* Medicine Name with search */}
        <Text style={styles.label}>Medicine Name *</Text>
        <View style={{ zIndex: 10 }}>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Search or type medicine name"
            placeholderTextColor="#bdc3c7"
            onFocus={() => searchResults.length > 0 && setShowSuggestions(true)}
          />
          {searchLoading && <ActivityIndicator size="small" color="#3498db" style={{ position: 'absolute', right: 14, top: 14 }} />}
          
          {/* Search Results — absolute positioned dropdown */}
          {showSuggestions && searchResults.length > 0 && (
            <View style={styles.suggestionsDropdown}>
              <ScrollView style={{ maxHeight: 240 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                {searchResults.map((item, idx) => (
                  <TouchableOpacity key={idx} style={styles.suggestionItem} onPress={() => selectSuggestion(item)}>
                    <Text style={styles.suggestionName}>{item.name || item.medicineName}</Text>
                    {item.description ? (
                      <Text style={styles.suggestionDesc} numberOfLines={2}>{item.description}</Text>
                    ) : null}
                    {item.manufacturer && <Text style={styles.suggestionInfo}>{item.manufacturer}{item.dosageStrength ? ` · ${item.dosageStrength}` : ''}</Text>}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
        </View>
        {searchError && !searchLoading && (
          <Text style={{ color: '#e74c3c', fontSize: 12, marginTop: 4, marginLeft: 4 }}>
            <MaterialCommunityIcons name="alert-circle-outline" size={12} color="#e74c3c" /> Search unavailable — type the name manually
          </Text>
        )}

        {/* Type */}
        <Text style={styles.label}>Type</Text>
        <View style={styles.chipRow}>
          {TYPES.map(t => (
            <TouchableOpacity
              key={t}
              style={[styles.chip, type === t && styles.chipActive]}
              onPress={() => handleTypeChange(t)}
            >
              <Text style={[styles.chipText, type === t && styles.chipTextActive]}>
                <MaterialCommunityIcons name={TYPE_UNITS[t].icon} size={13} color={type === t ? '#fff' : '#7f8c8d'} /> {t.charAt(0) + t.slice(1).toLowerCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Dosage */}
        <Text style={styles.label}>Dosage per Dose *</Text>
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
            {isCustomUnit ? (
              <TextInput
                style={styles.input}
                value={customUnitText}
                onChangeText={(text) => { setCustomUnitText(text); setDoseUnit(text); }}
                placeholder="Type unit (e.g., drops, puffs)"
                placeholderTextColor="#bdc3c7"
                autoFocus
              />
            ) : (
              <TouchableOpacity style={styles.unitDropdown} onPress={() => setShowUnitPicker(true)}>
                <Text style={styles.unitDropdownText}>{doseUnit || 'Select unit'}</Text>
                <Text style={styles.unitDropdownArrow}>▼</Text>
              </TouchableOpacity>
            )}
            {isCustomUnit && (
              <TouchableOpacity onPress={() => { setIsCustomUnit(false); setDoseUnit(TYPE_UNITS[type]?.primary || 'Dose(s)'); setCustomUnitText(''); }}>
                <Text style={{ color: '#3498db', fontSize: 12, marginTop: 4 }}>← Back to default</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Unit Picker Modal */}
        <Modal visible={showUnitPicker} transparent animationType="fade" onRequestClose={() => setShowUnitPicker(false)}>
          <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowUnitPicker(false)}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Select Unit</Text>
              {getUnitOptions().map((unit, idx) => (
                <TouchableOpacity key={idx} style={styles.modalOption} onPress={() => handleUnitSelect(unit)}>
                  <Text style={[styles.modalOptionText, unit === doseUnit && styles.modalOptionActive]}>
                    {unit}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </TouchableOpacity>
        </Modal>

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
              {DAYS_OF_WEEK.map((d, idx) => (
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
            <Text style={styles.infoText}><MaterialCommunityIcons name="information" size={14} color="#3498db" /> No scheduled reminders — take this medicine whenever you need it. Stock tracking will still work.</Text>
          </View>
        )}

        {/* Schedule Times — hidden for AS_NEEDED */}
        {!isAsNeeded && (
          <>
            <Text style={styles.label}>Schedule Times</Text>
            {times.map((t, idx) => (
              <View key={idx} style={styles.timeRow}>
                <TouchableOpacity style={styles.timeButton} onPress={() => showTimepicker(idx)}>
                  <Text style={styles.timeButtonText}><MaterialCommunityIcons name="clock-outline" size={16} color="#2c3e50" /> {formatTime(t)}</Text>
                </TouchableOpacity>
                {times.length > 1 && (
                  <TouchableOpacity style={styles.removeTimeBtn} onPress={() => removeTime(idx)}>
                    <Text style={styles.removeTimeBtnText}><MaterialCommunityIcons name="close" size={16} color="#e74c3c" /></Text>
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

        {/* Stock */}
        <Text style={styles.label}>Current Stock (optional)</Text>
        <TextInput
          style={styles.input}
          value={currentStock}
          onChangeText={setCurrentStock}
          placeholder="e.g., 30"
          keyboardType="numeric"
          placeholderTextColor="#bdc3c7"
        />

        {/* Bundle Name — optional grouping */}
        <Text style={styles.label}>Medicine Group (optional)</Text>
        <TextInput
          style={styles.input}
          value={bundleName}
          onChangeText={setBundleName}
          placeholder="e.g., Morning Meds, Heart Pills"
          placeholderTextColor="#bdc3c7"
          autoCapitalize="words"
          onFocus={() => {
            // Auto-scroll to make bundle input visible above keyboard
            setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 300);
          }}
        />
        {/* Bundle suggestions */}
        {(() => {
          const filtered = bundleName.trim()
            ? existingBundles.filter(b => b.toLowerCase().includes(bundleName.toLowerCase()) && b !== bundleName)
            : existingBundles;
          if (filtered.length > 0) {
            return (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8, marginBottom: 12 }}>
                <View style={{ flexDirection: 'row', gap: 8, paddingRight: 16 }}>
                  {filtered.map(b => (
                    <TouchableOpacity
                      key={b}
                      style={styles.bundleChip}
                      onPress={() => setBundleName(b)}
                    >
                      <Text style={styles.bundleChipIcon}><MaterialCommunityIcons name="package-variant" size={14} color="#95a5a6" /></Text>
                      <Text style={styles.bundleChipText}>{b}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            );
          }
          return (
            <Text style={{ fontSize: 12, color: '#94a3b8', marginLeft: 5, marginTop: 4, marginBottom: 12 }}>
              {existingBundles.length === 0
                ? 'Group medicines together under one label on your dashboard'
                : 'Or type a new name to create one'}
            </Text>
          );
        })()}

        {/* Save Button */}
        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveBtnText}><MaterialCommunityIcons name="content-save-outline" size={17} color="#fff" /> Add Medicine</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f9fc' },
  scrollContent: { padding: 20, paddingBottom: 80 },
  
  adminBanner: {
    backgroundColor: '#e8f4fd', borderRadius: 12, padding: 14,
    marginBottom: 12, borderLeftWidth: 4, borderLeftColor: '#3498db',
  },
  adminBannerText: { fontSize: 14, fontWeight: '600', color: '#2c3e50' },

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

  // Search dropdown — absolutely positioned to overlay content
  suggestionsDropdown: {
    position: 'absolute', top: 54, left: 0, right: 0, zIndex: 100,
    backgroundColor: '#fff', borderRadius: 12, borderWidth: 1,
    borderColor: '#e0e6ed',
    elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15, shadowRadius: 8,
    overflow: 'hidden',
  },
  suggestionItem: {
    padding: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  suggestionName: { fontSize: 15, fontWeight: '600', color: '#2c3e50' },
  suggestionDesc: { fontSize: 12, color: '#3498db', marginTop: 3, lineHeight: 16 },
  suggestionInfo: { fontSize: 12, color: '#95a5a6', marginTop: 2 },

  // Unit dropdown button
  unitDropdown: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#e0e6ed',
    borderRadius: 12, padding: 14,
  },
  unitDropdownText: { fontSize: 16, color: '#2c3e50', fontWeight: '500' },
  unitDropdownArrow: { fontSize: 12, color: '#95a5a6' },

  // Unit picker modal
  modalOverlay: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  modalContent: {
    backgroundColor: '#fff', borderRadius: 16, padding: 20,
    width: '75%', maxWidth: 300,
    elevation: 10,
  },
  modalTitle: { fontSize: 16, fontWeight: '700', color: '#34495e', marginBottom: 14, textAlign: 'center' },
  modalOption: {
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  modalOptionText: { fontSize: 16, color: '#2c3e50', textAlign: 'center' },
  modalOptionActive: { color: '#3498db', fontWeight: '700' },

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

  // Bundle suggestion chips
  bundleChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#eef2ff', paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 20, borderWidth: 1.5, borderColor: '#c7d2fe',
  },
  bundleChipIcon: { fontSize: 14 },
  bundleChipText: { fontSize: 13, color: '#4338ca', fontWeight: '600' },


  saveBtn: {
    backgroundColor: '#27ae60', paddingVertical: 16, borderRadius: 12,
    alignItems: 'center', marginTop: 24,
    elevation: 3, shadowColor: '#27ae60',
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 6,
  },
  saveBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});

export default AddMedicineScreen;
