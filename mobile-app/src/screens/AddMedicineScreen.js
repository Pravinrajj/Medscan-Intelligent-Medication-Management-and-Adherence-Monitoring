import React, { useState, useContext, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert,
  ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform, SafeAreaView,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import api from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { scheduleMedicationReminder } from '../services/NotificationService';
import { colors, fonts, spacing, radii, shadows, typography, components } from '../theme';

// ─── Constants ───────────────────────────────────────────────────
const DOSAGE_UNITS = ['mg', 'ml', 'IU', 'mcg', 'g', 'drops', 'puffs'];

const MEDICINE_TYPES = [
  { key: 'TABLET', label: 'Tablet', icon: 'pill' },
  { key: 'CAPSULE', label: 'Capsule', icon: 'pill' },
  { key: 'SYRUP', label: 'Syrup', icon: 'bottle-tonic' },
  { key: 'INJECTION', label: 'Injection', icon: 'needle' },
  { key: 'DROPS', label: 'Drops', icon: 'eyedropper' },
  { key: 'INHALER', label: 'Inhaler', icon: 'lungs' },
  { key: 'CREAM', label: 'Cream', icon: 'lotion-outline' },
  { key: 'OTHER', label: 'Other', icon: 'dots-horizontal' },
];

const FREQUENCY_OPTIONS = [
  { key: 'DAILY', label: 'Once Daily' },
  { key: 'TWICE_DAILY', label: 'Twice Daily' },
  { key: 'THREE_DAILY', label: '3x Daily' },
  { key: 'CUSTOM', label: 'Custom' },
  { key: 'AS_NEEDED', label: 'As Needed' },
];

const DAYS_OF_WEEK = [
  { key: 'SUN', label: 'S' }, { key: 'MON', label: 'M' }, { key: 'TUE', label: 'T' },
  { key: 'WED', label: 'W' }, { key: 'THU', label: 'T' }, { key: 'FRI', label: 'F' },
  { key: 'SAT', label: 'S' },
];

const TYPE_COLOR = (key) => colors.medicineTypes[key?.toLowerCase()] || colors.textTertiary;

const AddMedicineScreen = ({ navigation, route }) => {
  const { userInfo } = useContext(AuthContext);
  const toast = useToast();
  const targetUserId = route.params?.targetUserId || userInfo?.id;
  const targetUserName = route.params?.targetUserName;
  const scrollRef = useRef(null);
  const skipSearchRef = useRef(false);

  // ── Step state ──────────────────────────────────────────────────
  const [step, setStep] = useState(1); // 1, 2, or 3

  // Step 1: Medicine info
  const [name, setName] = useState('');
  const [type, setType] = useState('TABLET');
  const [doseAmount, setDoseAmount] = useState('');
  const [doseUnit, setDoseUnit] = useState('mg');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [drugInfo, setDrugInfo] = useState(null); // from drug-info API

  // Step 2: Schedule
  const [frequencyType, setFrequencyType] = useState('DAILY');
  const [customDays, setCustomDays] = useState([]);
  const [times, setTimes] = useState([new Date()]);
  const [currentStock, setCurrentStock] = useState('');
  const [bundleName, setBundleName] = useState('');
  const [existingBundles, setExistingBundles] = useState([]);
  const [showPicker, setShowPicker] = useState(false);
  const [currentPickerIndex, setCurrentPickerIndex] = useState(0);

  // Step 3 / Save
  const [saving, setSaving] = useState(false);
  const [interactions, setInteractions] = useState(null);

  // ── Init ────────────────────────────────────────────────────────
  useEffect(() => {
    const loadBundles = async () => {
      try {
        const res = await api.get(`/schedules/user/${targetUserId}`);
        const names = [...new Set((res.data || []).map(s => s.bundleName).filter(Boolean))];
        setExistingBundles(names);
      } catch (e) { /* not critical */ }
    };
    if (targetUserId) loadBundles();
  }, [targetUserId]);

  // Pre-fill from scan results
  useEffect(() => {
    if (route.params?.scannedMedicine) {
      const med = route.params.scannedMedicine;
      if (med.name) setName(med.name);
      if (med.type) {
        const t = med.type.toUpperCase();
        const found = MEDICINE_TYPES.find(m => m.key === t);
        if (found) setType(t);
      }
      if (med.dosage) setDoseAmount(String(med.dosage));
    }
  }, [route.params]);

  // ── Autocomplete ────────────────────────────────────────────────
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (skipSearchRef.current) { skipSearchRef.current = false; return; }
      if (name.length >= 2) {
        setSearchLoading(true);
        try {
          const res = await api.get(`/medicines/drug-search?query=${encodeURIComponent(name)}`);
          const seen = new Set();
          const deduped = (res.data || []).filter(item => {
            const key = (item.name || '').toLowerCase().trim();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          setSearchResults(deduped.slice(0, 8));
          setShowSuggestions(true);
        } catch (e) {
          // Fallback to medicines search
          try {
            const res = await api.get(`/medicines/search?query=${encodeURIComponent(name)}`);
            const seen = new Set();
            const deduped = (res.data || []).filter(item => {
              const key = (item.name || item.medicineName || '').toLowerCase().trim();
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
            setSearchResults(deduped.slice(0, 8));
            setShowSuggestions(true);
          } catch (e2) { /* fail silently */ }
        } finally { setSearchLoading(false); }
      } else { setSearchResults([]); setShowSuggestions(false); }
    }, 350);
    return () => clearTimeout(timer);
  }, [name]);

  const selectSuggestion = (item) => {
    skipSearchRef.current = true;
    setName(item.name || item.medicineName || '');
    setSearchResults([]);
    setShowSuggestions(false);

    // Auto-fill drug info
    if (item.saltName || item.manufacturer) {
      setDrugInfo(item);
    }
    // Try to fetch full drug info
    fetchDrugInfo(item.name || item.medicineName);
  };

  const fetchDrugInfo = async (medName) => {
    try {
      const res = await api.get(`/medicines/drug-info?name=${encodeURIComponent(medName)}`);
      if (res.data && res.data.name) {
        setDrugInfo(res.data);
      }
    } catch (e) { /* not found — okay */ }
  };

  // Fetch interactions when moving to step 3
  const fetchInteractions = async () => {
    if (!name.trim()) return;
    try {
      const res = await api.get(`/medicines/interactions?name=${encodeURIComponent(name.trim())}`);
      if (res.data?.interactions && res.data.interactions !== '[]') {
        setInteractions(res.data);
      }
    } catch (e) { /* no interactions data */ }
  };

  // ── Time handling ───────────────────────────────────────────────
  const addTime = () => setTimes([...times, new Date()]);
  const removeTime = (i) => { if (times.length > 1) { const t = [...times]; t.splice(i, 1); setTimes(t); } };
  const showTimepicker = (i) => { setCurrentPickerIndex(i); setShowPicker(true); };
  const onTimeChange = (e, d) => { setShowPicker(false); if (d) { const t = [...times]; t[currentPickerIndex] = d; setTimes(t); } };
  const formatTime = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const toggleDay = (k) => setCustomDays(p => p.includes(k) ? p.filter(d => d !== k) : [...p, k]);

  // ── Auto set times based on frequency ───────────────────────────
  useEffect(() => {
    if (frequencyType === 'DAILY') setTimes([new Date(new Date().setHours(8, 0))]);
    else if (frequencyType === 'TWICE_DAILY') setTimes([new Date(new Date().setHours(8, 0)), new Date(new Date().setHours(20, 0))]);
    else if (frequencyType === 'THREE_DAILY') setTimes([new Date(new Date().setHours(8, 0)), new Date(new Date().setHours(14, 0)), new Date(new Date().setHours(20, 0))]);
  }, [frequencyType]);

  // ── Navigation ──────────────────────────────────────────────────
  const goNext = () => {
    if (step === 1) {
      if (!name.trim()) { toast.error('Please enter a medicine name.'); return; }
      if (!doseAmount.trim()) { toast.error('Please enter a dosage.'); return; }
      setStep(2);
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    } else if (step === 2) {
      if (frequencyType === 'CUSTOM' && customDays.length === 0) {
        toast.error('Please select at least one day.'); return;
      }
      fetchInteractions();
      setStep(3);
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    }
  };

  const goBack = () => {
    if (step > 1) { setStep(step - 1); scrollRef.current?.scrollTo({ y: 0, animated: true }); }
    else navigation.goBack();
  };

  // ── Save ────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    try {
      const medRes = await api.post('/medicines', { name: name.trim(), type });
      const medicineId = medRes.data.id;

      const today = new Date().toISOString().split('T')[0];
      const payload = {
        startDate: today,
        doseAmount: parseFloat(doseAmount) || 1,
        doseUnit,
        frequencyType: frequencyType === 'CUSTOM' ? 'SPECIFIC_DAYS' :
                       frequencyType === 'TWICE_DAILY' ? 'DAILY' :
                       frequencyType === 'THREE_DAILY' ? 'DAILY' : frequencyType,
        currentStock: currentStock.trim() ? parseInt(currentStock) : null,
      };

      if (frequencyType !== 'AS_NEEDED') {
        payload.times = times.map(t =>
          t.getHours().toString().padStart(2, '0') + ':' + t.getMinutes().toString().padStart(2, '0') + ':00'
        );
      }
      if (frequencyType === 'CUSTOM') payload.customDays = customDays.join(',');
      if (bundleName.trim()) payload.bundleName = bundleName.trim();

      await api.post(`/schedules/user/${targetUserId}/medicine/${medicineId}`, payload);

      // Schedule notifications
      if (frequencyType !== 'AS_NEEDED') {
        for (const t of times) {
          await scheduleMedicationReminder(name.trim(), t.getHours(), t.getMinutes(), medicineId, targetUserId);
        }
      }

      const who = targetUserName ? `${targetUserName}'s` : 'your';
      toast.success(`${name.trim()} added to ${who} schedule.`);
      navigation.goBack();
    } catch (e) {
      console.error('[AddMedicine] Save failed:', e.response?.data || e.message);
      toast.error(e.response?.data?.message || 'Failed to save medicine.');
    } finally {
      setSaving(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      {/* Step Indicator */}
      <View style={styles.stepRow}>
        {[1, 2, 3].map(s => (
          <View key={s} style={styles.stepItem}>
            <View style={[styles.stepCircle, s === step && styles.stepCircleActive, s < step && styles.stepCircleDone]}>
              {s < step ? (
                <MaterialCommunityIcons name="check" size={14} color={colors.textInverse} />
              ) : (
                <Text style={[styles.stepNum, (s === step || s < step) && styles.stepNumActive]}>{s}</Text>
              )}
            </View>
            <Text style={[styles.stepLabel, s === step && styles.stepLabelActive]}>
              {s === 1 ? 'Medicine' : s === 2 ? 'Schedule' : 'Review'}
            </Text>
            {s < 3 && <View style={[styles.stepLine, s < step && styles.stepLineDone]} />}
          </View>
        ))}
      </View>

      {/* Admin banner */}
      {targetUserName && (
        <View style={styles.adminBanner}>
          <MaterialCommunityIcons name="account-arrow-right" size={16} color={colors.warningDark} />
          <Text style={styles.adminBannerText}>Adding for {targetUserName}</Text>
        </View>
      )}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView ref={scrollRef} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          {/* ─── STEP 1: Medicine Info ───────────────────────────── */}
          {step === 1 && (
            <View>
              <Text style={styles.sectionTitle}>Medicine Details</Text>

              {/* Name + Search */}
              <Text style={styles.label}>Medicine Name</Text>
              <View style={{ zIndex: 10 }}>
                <View style={styles.searchInputRow}>
                  <MaterialCommunityIcons name="magnify" size={20} color={colors.textTertiary} style={{ marginRight: 8 }} />
                  <TextInput
                    style={styles.searchInput}
                    value={name}
                    onChangeText={setName}
                    placeholder="Search or type medicine name"
                    placeholderTextColor={colors.textTertiary}
                    onFocus={() => searchResults.length > 0 && setShowSuggestions(true)}
                  />
                  {searchLoading && <ActivityIndicator size="small" color={colors.primary} />}
                </View>

                {showSuggestions && searchResults.length > 0 && (
                  <View style={styles.dropdown}>
                    <ScrollView style={{ maxHeight: 200 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                      {searchResults.map((item, idx) => (
                        <TouchableOpacity key={idx} style={styles.dropdownItem} onPress={() => selectSuggestion(item)}>
                          <Text style={styles.dropdownName}>{item.name || item.medicineName}</Text>
                          {item.saltName && <Text style={styles.dropdownSub}>{item.saltName}</Text>}
                          {item.manufacturer && <Text style={styles.dropdownMfg}>{item.manufacturer}</Text>}
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}
              </View>

              {/* Drug Info Card */}
              {drugInfo && (
                <View style={styles.drugInfoCard}>
                  <View style={styles.drugInfoHeader}>
                    <MaterialCommunityIcons name="information-outline" size={16} color={colors.primary} />
                    <Text style={styles.drugInfoTitle}>Drug Information</Text>
                  </View>
                  {drugInfo.saltName && <InfoRow label="Salt/Generic" value={drugInfo.saltName} />}
                  {drugInfo.manufacturer && <InfoRow label="Manufacturer" value={drugInfo.manufacturer} />}
                  {drugInfo.therapeuticClass && <InfoRow label="Class" value={drugInfo.therapeuticClass} />}
                  {drugInfo.price && <InfoRow label="MRP" value={`₹${drugInfo.price}`} />}
                </View>
              )}

              {/* Dosage */}
              <Text style={styles.label}>Dosage</Text>
              <View style={styles.dosageRow}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={doseAmount}
                  onChangeText={setDoseAmount}
                  placeholder="Amount"
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="decimal-pad"
                />
                <View style={styles.unitChips}>
                  {DOSAGE_UNITS.slice(0, 4).map(u => (
                    <TouchableOpacity
                      key={u}
                      style={[styles.unitChip, doseUnit === u && styles.unitChipActive]}
                      onPress={() => setDoseUnit(u)}
                    >
                      <Text style={[styles.unitChipText, doseUnit === u && styles.unitChipTextActive]}>{u}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <View style={styles.unitChips}>
                {DOSAGE_UNITS.slice(4).map(u => (
                  <TouchableOpacity
                    key={u}
                    style={[styles.unitChip, doseUnit === u && styles.unitChipActive]}
                    onPress={() => setDoseUnit(u)}
                  >
                    <Text style={[styles.unitChipText, doseUnit === u && styles.unitChipTextActive]}>{u}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Medicine Type */}
              <Text style={[styles.label, { marginTop: spacing.lg }]}>Type</Text>
              <View style={styles.typeGrid}>
                {MEDICINE_TYPES.map(t => (
                  <TouchableOpacity
                    key={t.key}
                    style={[styles.typeChip, type === t.key && { backgroundColor: TYPE_COLOR(t.key), ...shadows.colored(TYPE_COLOR(t.key)) }]}
                    onPress={() => setType(t.key)}
                  >
                    <MaterialCommunityIcons name={t.icon} size={18} color={type === t.key ? colors.textInverse : colors.textSecondary} />
                    <Text style={[styles.typeChipText, type === t.key && { color: colors.textInverse }]}>{t.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* ─── STEP 2: Schedule ────────────────────────────────── */}
          {step === 2 && (
            <View>
              <Text style={styles.sectionTitle}>Schedule</Text>

              {/* Frequency */}
              <Text style={styles.label}>Frequency</Text>
              <View style={styles.freqRow}>
                {FREQUENCY_OPTIONS.map(f => (
                  <TouchableOpacity
                    key={f.key}
                    style={[styles.freqChip, frequencyType === f.key && styles.freqChipActive]}
                    onPress={() => setFrequencyType(f.key)}
                  >
                    <Text style={[styles.freqChipText, frequencyType === f.key && styles.freqChipTextActive]}>{f.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Custom Days */}
              {frequencyType === 'CUSTOM' && (
                <View style={styles.daysRow}>
                  {DAYS_OF_WEEK.map(d => (
                    <TouchableOpacity
                      key={d.key}
                      style={[styles.dayBtn, customDays.includes(d.key) && styles.dayBtnActive]}
                      onPress={() => toggleDay(d.key)}
                    >
                      <Text style={[styles.dayBtnText, customDays.includes(d.key) && styles.dayBtnTextActive]}>{d.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Times */}
              {frequencyType !== 'AS_NEEDED' && (
                <>
                  <Text style={[styles.label, { marginTop: spacing.lg }]}>Reminder Times</Text>
                  {times.map((t, i) => (
                    <View key={i} style={styles.timeRow}>
                      <TouchableOpacity style={styles.timeBtn} onPress={() => showTimepicker(i)}>
                        <MaterialCommunityIcons name="clock-outline" size={18} color={colors.primary} />
                        <Text style={styles.timeText}>{formatTime(t)}</Text>
                      </TouchableOpacity>
                      {times.length > 1 && (
                        <TouchableOpacity onPress={() => removeTime(i)} style={styles.timeRemove}>
                          <MaterialCommunityIcons name="close-circle" size={20} color={colors.danger} />
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                  <TouchableOpacity style={styles.addTimeBtn} onPress={addTime}>
                    <MaterialCommunityIcons name="plus-circle-outline" size={18} color={colors.primary} />
                    <Text style={styles.addTimeText}>Add another time</Text>
                  </TouchableOpacity>
                </>
              )}

              {showPicker && (
                <DateTimePicker value={times[currentPickerIndex]} mode="time" is24Hour={false} onChange={onTimeChange} />
              )}

              {/* Stock */}
              <Text style={[styles.label, { marginTop: spacing.lg }]}>Current Stock (optional)</Text>
              <TextInput
                style={styles.input}
                value={currentStock}
                onChangeText={setCurrentStock}
                placeholder="e.g. 30"
                placeholderTextColor={colors.textTertiary}
                keyboardType="number-pad"
              />

              {/* Bundle */}
              <Text style={[styles.label, { marginTop: spacing.lg }]}>Bundle (optional)</Text>
              <TextInput
                style={styles.input}
                value={bundleName}
                onChangeText={setBundleName}
                placeholder="Group name, e.g. Morning Meds"
                placeholderTextColor={colors.textTertiary}
              />
              {existingBundles.length > 0 && (
                <View style={styles.bundleSuggestions}>
                  {existingBundles.map(b => (
                    <TouchableOpacity key={b} style={styles.bundleChip} onPress={() => setBundleName(b)}>
                      <MaterialCommunityIcons name="package-variant" size={12} color={colors.primary} />
                      <Text style={styles.bundleChipText}>{b}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* ─── STEP 3: Review ─────────────────────────────────── */}
          {step === 3 && (
            <View>
              <Text style={styles.sectionTitle}>Review & Confirm</Text>

              <View style={styles.reviewCard}>
                <ReviewRow icon="pill" label="Medicine" value={name} />
                <ReviewRow icon="medical-bag" label="Type" value={type} />
                <ReviewRow icon="scale-balance" label="Dosage" value={`${doseAmount} ${doseUnit}`} />
                <ReviewRow icon="calendar-clock" label="Frequency" value={FREQUENCY_OPTIONS.find(f => f.key === frequencyType)?.label || frequencyType} />
                {frequencyType !== 'AS_NEEDED' && (
                  <ReviewRow icon="clock-outline" label="Times" value={times.map(t => formatTime(t)).join(', ')} />
                )}
                {frequencyType === 'CUSTOM' && (
                  <ReviewRow icon="calendar-week" label="Days" value={customDays.join(', ')} />
                )}
                {currentStock ? <ReviewRow icon="package-variant" label="Stock" value={`${currentStock} units`} /> : null}
                {bundleName ? <ReviewRow icon="folder-outline" label="Bundle" value={bundleName} /> : null}
                {drugInfo?.manufacturer && <ReviewRow icon="factory" label="Manufacturer" value={drugInfo.manufacturer} />}
                {drugInfo?.therapeuticClass && <ReviewRow icon="stethoscope" label="Class" value={drugInfo.therapeuticClass} />}
              </View>

              {/* Drug Interaction Warning */}
              {interactions && interactions.interactions && interactions.interactions !== '[]' && (
                <View style={styles.interactionCard}>
                  <View style={styles.interactionHeader}>
                    <MaterialCommunityIcons name="alert-outline" size={18} color={colors.warningDark} />
                    <Text style={styles.interactionTitle}>Drug Interactions Found</Text>
                  </View>
                  <Text style={styles.interactionDesc}>
                    This medicine may interact with other drugs. Review the interaction data after saving, or consult your doctor.
                  </Text>
                </View>
              )}

              {/* Side Effects */}
              {drugInfo?.sideEffects && (
                <View style={styles.sideEffectsCard}>
                  <View style={styles.interactionHeader}>
                    <MaterialCommunityIcons name="information-outline" size={16} color={colors.textSecondary} />
                    <Text style={[styles.interactionTitle, { color: colors.textSecondary }]}>Common Side Effects</Text>
                  </View>
                  <Text style={styles.sideEffectsText} numberOfLines={4}>{drugInfo.sideEffects}</Text>
                </View>
              )}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Bottom Action Bar */}
      <View style={styles.bottomBar}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack}>
          <MaterialCommunityIcons name={step === 1 ? "close" : "arrow-left"} size={20} color={colors.text} />
          <Text style={styles.backBtnText}>{step === 1 ? 'Cancel' : 'Back'}</Text>
        </TouchableOpacity>

        {step < 3 ? (
          <TouchableOpacity style={styles.nextBtn} onPress={goNext}>
            <Text style={styles.nextBtnText}>Next</Text>
            <MaterialCommunityIcons name="arrow-right" size={20} color={colors.textInverse} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={[styles.nextBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
            {saving ? (
              <ActivityIndicator size="small" color={colors.textInverse} />
            ) : (
              <>
                <MaterialCommunityIcons name="check" size={20} color={colors.textInverse} />
                <Text style={styles.nextBtnText}>Save Medicine</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
};

// ─── Sub-components ──────────────────────────────────────────────
const InfoRow = ({ label, value }) => (
  <View style={styles.infoRow}>
    <Text style={styles.infoLabel}>{label}</Text>
    <Text style={styles.infoValue} numberOfLines={2}>{value}</Text>
  </View>
);

const ReviewRow = ({ icon, label, value }) => (
  <View style={styles.reviewRow}>
    <MaterialCommunityIcons name={icon} size={16} color={colors.textTertiary} />
    <Text style={styles.reviewLabel}>{label}</Text>
    <Text style={styles.reviewValue} numberOfLines={2}>{value}</Text>
  </View>
);

// ─── Styles ──────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: { padding: spacing.xl, paddingBottom: 120 },

  // Step indicator
  stepRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: spacing.md, paddingHorizontal: spacing.xxl,
    backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.borderLight,
  },
  stepItem: { flexDirection: 'row', alignItems: 'center' },
  stepCircle: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surfaceHover,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.border,
  },
  stepCircleActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  stepCircleDone: { backgroundColor: colors.success, borderColor: colors.success },
  stepNum: { fontSize: 12, fontFamily: fonts.bold, color: colors.textTertiary },
  stepNumActive: { color: colors.textInverse },
  stepLabel: { fontSize: 11, fontFamily: fonts.medium, color: colors.textTertiary, marginLeft: 6, marginRight: 6 },
  stepLabelActive: { color: colors.primary },
  stepLine: { width: 24, height: 2, backgroundColor: colors.border, marginHorizontal: 4 },
  stepLineDone: { backgroundColor: colors.success },

  // Admin banner
  adminBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.warningLight, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg,
  },
  adminBannerText: { fontSize: 13, fontFamily: fonts.semiBold, color: colors.warningDark },

  sectionTitle: { ...typography.h3, marginBottom: spacing.lg },
  label: { ...typography.sectionLabel, marginBottom: spacing.sm, marginTop: spacing.md },

  // Search
  searchInputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surfaceHover, borderRadius: radii.md,
    paddingHorizontal: spacing.md, paddingVertical: Platform.OS === 'ios' ? spacing.md : 0,
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: fonts.regular, color: colors.text, paddingVertical: spacing.md },

  dropdown: {
    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
    backgroundColor: colors.surface, borderRadius: radii.md, marginTop: 4, ...shadows.lg,
  },
  dropdownItem: { paddingVertical: spacing.md, paddingHorizontal: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  dropdownName: { fontSize: 14, fontFamily: fonts.semiBold, color: colors.text },
  dropdownSub: { fontSize: 12, fontFamily: fonts.regular, color: colors.primary, marginTop: 2 },
  dropdownMfg: { fontSize: 11, fontFamily: fonts.regular, color: colors.textTertiary, marginTop: 2 },

  // Drug info card
  drugInfoCard: {
    backgroundColor: colors.primaryBg, borderRadius: radii.lg, padding: spacing.md,
    marginTop: spacing.md, borderLeftWidth: 3, borderLeftColor: colors.primary,
  },
  drugInfoHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  drugInfoTitle: { fontSize: 13, fontFamily: fonts.bold, color: colors.primary },
  infoRow: { flexDirection: 'row', marginBottom: 4, paddingLeft: spacing.xxl },
  infoLabel: { fontSize: 12, fontFamily: fonts.medium, color: colors.textTertiary, width: 90 },
  infoValue: { fontSize: 12, fontFamily: fonts.medium, color: colors.text, flex: 1 },

  // Inputs
  input: { ...components.input, backgroundColor: colors.surfaceHover, borderWidth: 0 },

  // Dosage
  dosageRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  unitChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  unitChip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2,
    borderRadius: radii.full, backgroundColor: colors.surfaceHover,
  },
  unitChipActive: { backgroundColor: colors.primary },
  unitChipText: { fontSize: 12, fontFamily: fonts.semiBold, color: colors.textSecondary },
  unitChipTextActive: { color: colors.textInverse },

  // Type grid
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  typeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2,
    borderRadius: radii.md, backgroundColor: colors.surfaceHover,
  },
  typeChipText: { fontSize: 13, fontFamily: fonts.semiBold, color: colors.textSecondary },

  // Frequency
  freqRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  freqChip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radii.full, backgroundColor: colors.surfaceHover,
  },
  freqChipActive: { backgroundColor: colors.primary },
  freqChipText: { fontSize: 13, fontFamily: fonts.semiBold, color: colors.textSecondary },
  freqChipTextActive: { color: colors.textInverse },

  // Days
  daysRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md },
  dayBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceHover,
    alignItems: 'center', justifyContent: 'center',
  },
  dayBtnActive: { backgroundColor: colors.primary },
  dayBtnText: { fontSize: 14, fontFamily: fonts.bold, color: colors.textSecondary },
  dayBtnTextActive: { color: colors.textInverse },

  // Times
  timeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  timeBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceHover, paddingVertical: spacing.md, paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
  },
  timeText: { fontSize: 16, fontFamily: fonts.semiBold, color: colors.text },
  timeRemove: { marginLeft: spacing.sm, padding: spacing.xs },
  addTimeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  addTimeText: { fontSize: 13, fontFamily: fonts.semiBold, color: colors.primary },

  // Bundle suggestions
  bundleSuggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  bundleChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2,
    borderRadius: radii.full, backgroundColor: colors.primaryBg,
  },
  bundleChipText: { fontSize: 12, fontFamily: fonts.medium, color: colors.primary },

  // Review
  reviewCard: {
    backgroundColor: colors.surface, borderRadius: radii.xl, padding: spacing.lg, ...shadows.sm,
  },
  reviewRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.borderLight,
  },
  reviewLabel: { fontSize: 13, fontFamily: fonts.medium, color: colors.textTertiary, width: 85 },
  reviewValue: { fontSize: 14, fontFamily: fonts.semiBold, color: colors.text, flex: 1 },

  // Interaction warning
  interactionCard: {
    backgroundColor: colors.warningLight, borderRadius: radii.lg, padding: spacing.lg,
    marginTop: spacing.lg, borderLeftWidth: 4, borderLeftColor: colors.warning,
  },
  interactionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  interactionTitle: { fontSize: 14, fontFamily: fonts.bold, color: colors.warningDark },
  interactionDesc: { fontSize: 13, fontFamily: fonts.regular, color: colors.textSecondary },

  // Side effects
  sideEffectsCard: {
    backgroundColor: colors.surfaceHover, borderRadius: radii.lg, padding: spacing.lg, marginTop: spacing.md,
  },
  sideEffectsText: { fontSize: 13, fontFamily: fonts.regular, color: colors.textSecondary, marginTop: spacing.xs },

  // Bottom bar
  bottomBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
    backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.borderLight,
    ...shadows.md,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm },
  backBtnText: { fontSize: 15, fontFamily: fonts.medium, color: colors.text },
  nextBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.primary, paddingVertical: spacing.md, paddingHorizontal: spacing.xl,
    borderRadius: radii.md, ...shadows.colored(colors.primary),
  },
  nextBtnText: { fontSize: 15, fontFamily: fonts.semiBold, color: colors.textInverse },
});

export default AddMedicineScreen;
