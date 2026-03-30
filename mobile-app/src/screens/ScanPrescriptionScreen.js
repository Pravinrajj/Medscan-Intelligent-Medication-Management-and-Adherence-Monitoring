import React, { useState, useContext } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Alert, ActivityIndicator, ScrollView, SafeAreaView } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import api from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { colors, fonts, spacing, radii, shadows, typography } from '../theme';

const SCAN_MODES = [
  { key: 'prescription', label: 'Prescription', icon: 'file-document-outline', desc: 'Handwritten or printed prescription' },
  { key: 'strip', label: 'Medicine Strip', icon: 'pill', desc: 'Tablet blister pack or strip' },
];

const ScanPrescriptionScreen = ({ navigation }) => {
  const { userInfo } = useContext(AuthContext);
  const toast = useToast();
  const [image, setImage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [scanMode, setScanMode] = useState('prescription');

  const pickImage = async (useCamera) => {
    try {
      let pickerResult;
      if (useCamera) {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Required', 'Camera permission is needed to scan prescriptions.');
          return;
        }
        pickerResult = await ImagePicker.launchCameraAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: true,
          quality: 0.8,
        });
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Required', 'Gallery permission is needed.');
          return;
        }
        pickerResult = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: true,
          quality: 0.8,
        });
      }

      if (!pickerResult.canceled && pickerResult.assets?.[0]) {
        setImage(pickerResult.assets[0].uri);
        setResult(null);
      }
    } catch (e) {
      console.error('[Scan] Picker error:', e.message);
      toast.error('Failed to pick image.');
    }
  };

  const handleScan = async () => {
    if (!image) {
      toast.error('Please select or capture an image first.');
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('image', { uri: image, type: 'image/jpeg', name: 'prescription.jpg' });

      const endpoint = scanMode === 'strip' ? '/prescriptions/scan-strip' : '/prescriptions/scan';
      const res = await api.post(endpoint, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      });

      setResult(res.data);
      if (res.data?.medicines?.length) {
        toast.success(`Found ${res.data.medicines.length} medicine(s).`);
      }
    } catch (e) {
      console.error('[Scan] OCR failed:', e.response?.data || e.message);
      toast.error('Could not process image. Try a clearer photo.');
    } finally {
      setLoading(false);
    }
  };

  const handleAddMedicine = (med) => {
    navigation.navigate('AddMedicine', { scannedMedicine: med });
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Mode Toggle */}
        <View style={styles.modeRow}>
          {SCAN_MODES.map(mode => (
            <TouchableOpacity
              key={mode.key}
              style={[styles.modeBtn, scanMode === mode.key && styles.modeBtnActive]}
              onPress={() => { setScanMode(mode.key); setResult(null); }}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons name={mode.icon} size={20} color={scanMode === mode.key ? colors.textInverse : colors.textSecondary} />
              <Text style={[styles.modeText, scanMode === mode.key && styles.modeTextActive]}>{mode.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.modeDesc}>{SCAN_MODES.find(m => m.key === scanMode)?.desc}</Text>

        {/* Image Preview */}
        <View style={styles.imageContainer}>
          {image ? (
            <Image source={{ uri: image }} style={styles.image} resizeMode="contain" />
          ) : (
            <View style={styles.placeholder}>
              <View style={styles.placeholderCircle}>
                <MaterialCommunityIcons name="camera-outline" size={36} color={colors.textTertiary} />
              </View>
              <Text style={styles.placeholderText}>No image selected</Text>
              <Text style={styles.placeholderSub}>Take a photo or choose from gallery</Text>
            </View>
          )}
        </View>

        {/* Capture Buttons */}
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.cameraBtn} onPress={() => pickImage(true)} activeOpacity={0.8}>
            <MaterialCommunityIcons name="camera" size={18} color={colors.textInverse} />
            <Text style={styles.btnText}>Camera</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.galleryBtn} onPress={() => pickImage(false)} activeOpacity={0.8}>
            <MaterialCommunityIcons name="image-outline" size={18} color={colors.textInverse} />
            <Text style={styles.btnText}>Gallery</Text>
          </TouchableOpacity>
        </View>

        {/* Scan Button */}
        {image && (
          <TouchableOpacity style={styles.scanBtn} onPress={handleScan} disabled={loading} activeOpacity={0.8}>
            {loading ? (
              <View style={{ alignItems: 'center' }}>
                <ActivityIndicator color={colors.textInverse} />
                <Text style={styles.scanLoadingText}>Processing... this may take a moment</Text>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <MaterialCommunityIcons name="text-recognition" size={20} color={colors.textInverse} />
                <Text style={styles.scanBtnText}>Scan Now</Text>
              </View>
            )}
          </TouchableOpacity>
        )}

        {/* Results */}
        {result && (
          <View style={styles.resultsSection}>
            <Text style={styles.resultsTitle}>Extracted Medicines</Text>
            {(result.medicines || []).length === 0 ? (
              <View style={styles.noResultsCard}>
                <MaterialCommunityIcons name="file-search-outline" size={36} color={colors.textTertiary} />
                <Text style={styles.noResults}>No medicines detected. Try a clearer image or switch scan mode.</Text>
              </View>
            ) : (
              result.medicines.map((med, idx) => (
                <View key={idx} style={styles.resultCard}>
                  <View style={styles.resultInfo}>
                    <Text style={styles.resultName}>{med.name || 'Unknown'}</Text>
                    {med.manufacturer && <Text style={styles.resultDetail}>Manufacturer: {med.manufacturer}</Text>}
                    {med.composition && <Text style={styles.resultDetail}>Composition: {med.composition}</Text>}
                    {med.dosage && <Text style={styles.resultDetail}>Dosage: {med.dosage}</Text>}
                    {med.matchScore != null && (
                      <View style={styles.matchBadge}>
                        <MaterialCommunityIcons name="check-circle" size={12} color={colors.success} />
                        <Text style={styles.resultScore}>{Math.round(med.matchScore)}% match</Text>
                      </View>
                    )}
                  </View>
                  <TouchableOpacity style={styles.addBtn} onPress={() => handleAddMedicine(med)}>
                    <MaterialCommunityIcons name="plus" size={16} color={colors.textInverse} />
                    <Text style={styles.addBtnText}>Add</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
          </View>
        )}

        {result?.rawText && (
          <View style={styles.rawTextSection}>
            <View style={styles.rawTextHeader}>
              <MaterialCommunityIcons name="text-box-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.rawTextTitle}>Raw OCR Text</Text>
            </View>
            <Text style={styles.rawText}>{result.rawText}</Text>
          </View>
        )}

        <View style={{ height: 80 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl },

  // Mode toggle
  modeRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  modeBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, paddingVertical: spacing.md, borderRadius: radii.md,
    backgroundColor: colors.surface, ...shadows.sm,
  },
  modeBtnActive: { backgroundColor: colors.primary, ...shadows.colored(colors.primary) },
  modeText: { fontSize: 14, fontFamily: fonts.semiBold, color: colors.textSecondary },
  modeTextActive: { color: colors.textInverse },
  modeDesc: { fontSize: 12, fontFamily: fonts.regular, color: colors.textTertiary, marginBottom: spacing.lg, textAlign: 'center' },

  // Image
  imageContainer: {
    height: 240, backgroundColor: colors.surface, borderRadius: radii.xl,
    marginBottom: spacing.lg, overflow: 'hidden', ...shadows.md,
  },
  image: { width: '100%', height: '100%' },
  placeholder: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  placeholderCircle: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: colors.surfaceHover,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md,
  },
  placeholderText: { fontSize: 15, fontFamily: fonts.semiBold, color: colors.textSecondary },
  placeholderSub: { fontSize: 12, fontFamily: fonts.regular, color: colors.textTertiary, marginTop: spacing.xs },

  // Buttons
  buttonRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  cameraBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, paddingVertical: spacing.md, borderRadius: radii.md,
    backgroundColor: colors.primary, ...shadows.colored(colors.primary),
  },
  galleryBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, paddingVertical: spacing.md, borderRadius: radii.md,
    backgroundColor: '#7C3AED', ...shadows.colored('#7C3AED'),
  },
  btnText: { color: colors.textInverse, fontSize: 15, fontFamily: fonts.bold },

  scanBtn: {
    backgroundColor: colors.success, paddingVertical: spacing.lg, borderRadius: radii.md,
    alignItems: 'center', marginBottom: spacing.xl, ...shadows.colored(colors.success),
  },
  scanBtnText: { color: colors.textInverse, fontSize: 17, fontFamily: fonts.bold },
  scanLoadingText: { color: colors.textInverse, fontSize: 12, fontFamily: fonts.regular, marginTop: spacing.sm, opacity: 0.8 },

  // Results
  resultsSection: { marginTop: spacing.sm },
  resultsTitle: { ...typography.sectionLabel, marginBottom: spacing.md },
  noResultsCard: {
    alignItems: 'center', padding: spacing.xxl, backgroundColor: colors.surface,
    borderRadius: radii.lg, ...shadows.sm,
  },
  noResults: { ...typography.caption, textAlign: 'center', marginTop: spacing.sm },

  resultCard: {
    flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radii.lg,
    padding: spacing.lg, marginBottom: spacing.sm + 2, alignItems: 'center', ...shadows.sm,
  },
  resultInfo: { flex: 1 },
  resultName: { fontSize: 15, fontFamily: fonts.bold, color: colors.text },
  resultDetail: { fontSize: 13, fontFamily: fonts.regular, color: colors.textSecondary, marginTop: 2 },
  matchBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.xs },
  resultScore: { fontSize: 12, fontFamily: fonts.semiBold, color: colors.success },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.primary, paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
  },
  addBtnText: { color: colors.textInverse, fontFamily: fonts.bold, fontSize: 13 },

  // Raw text
  rawTextSection: {
    backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, marginTop: spacing.lg, ...shadows.sm,
  },
  rawTextHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  rawTextTitle: { fontSize: 14, fontFamily: fonts.bold, color: colors.textSecondary },
  rawText: { fontSize: 13, fontFamily: fonts.regular, color: colors.textTertiary, lineHeight: 18 },
});

export default ScanPrescriptionScreen;
