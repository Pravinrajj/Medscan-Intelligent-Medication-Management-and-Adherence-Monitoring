import React, { useState, useContext } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Alert, ActivityIndicator, ScrollView } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import api from '../api/client';
import { AuthContext } from '../context/AuthContext';

const ScanPrescriptionScreen = ({ navigation }) => {
  const { userInfo } = useContext(AuthContext);
  const [image, setImage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

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
      Alert.alert('Error', 'Failed to pick image.');
    }
  };

  const handleScan = async () => {
    if (!image) {
      Alert.alert('Error', 'Please select or capture an image first.');
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('image', {
        uri: image,
        type: 'image/jpeg',
        name: 'prescription.jpg',
      });

      const res = await api.post('/ocr/scan', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setResult(res.data);
    } catch (e) {
      console.error('[Scan] OCR failed:', e.response?.data || e.message);
      Alert.alert('Scan Failed', 'Could not process the image. Please try again with a clearer image.');
    } finally {
      setLoading(false);
    }
  };

  const handleAddMedicine = (med) => {
    navigation.navigate('AddMedicine', { scannedMedicine: med });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Scan Prescription</Text>
      <Text style={styles.subtitle}>Take a photo or upload an image of your prescription to extract medicine details.</Text>

      {/* Image Preview */}
      <View style={styles.imageContainer}>
        {image ? (
          <Image source={{ uri: image }} style={styles.image} resizeMode="contain" />
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderIcon}>📷</Text>
            <Text style={styles.placeholderText}>No image selected</Text>
          </View>
        )}
      </View>

      {/* Buttons */}
      <View style={styles.buttonRow}>
        <TouchableOpacity style={[styles.pickBtn, styles.cameraBtn]} onPress={() => pickImage(true)}>
          <Text style={styles.pickBtnText}>📸 Camera</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.pickBtn, styles.galleryBtn]} onPress={() => pickImage(false)}>
          <Text style={styles.pickBtnText}>🖼️ Gallery</Text>
        </TouchableOpacity>
      </View>

      {image && (
        <TouchableOpacity style={styles.scanBtn} onPress={handleScan} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.scanBtnText}>🔍 Scan Now</Text>
          )}
        </TouchableOpacity>
      )}

      {/* Results */}
      {result && (
        <View style={styles.resultsSection}>
          <Text style={styles.resultsTitle}>Extracted Medicines</Text>
          {(result.medicines || []).length === 0 ? (
            <Text style={styles.noResults}>No medicines detected. Try a clearer image.</Text>
          ) : (
            result.medicines.map((med, idx) => (
              <View key={idx} style={styles.resultCard}>
                <View style={styles.resultInfo}>
                  <Text style={styles.resultName}>{med.name || 'Unknown'}</Text>
                  {med.dosage && <Text style={styles.resultDosage}>Dosage: {med.dosage}</Text>}
                  {med.frequency && <Text style={styles.resultFrequency}>Frequency: {med.frequency}</Text>}
                </View>
                <TouchableOpacity style={styles.addBtn} onPress={() => handleAddMedicine(med)}>
                  <Text style={styles.addBtnText}>+ Add</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>
      )}

      {result?.rawText && (
        <View style={styles.rawTextSection}>
          <Text style={styles.rawTextTitle}>Raw OCR Text</Text>
          <Text style={styles.rawText}>{result.rawText}</Text>
        </View>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f9fc' },
  content: { padding: 20 },
  title: { fontSize: 22, fontWeight: '800', color: '#2c3e50', marginBottom: 6 },
  subtitle: { fontSize: 14, color: '#7f8c8d', marginBottom: 20, lineHeight: 20 },

  imageContainer: {
    height: 250, backgroundColor: '#fff', borderRadius: 16,
    marginBottom: 16, overflow: 'hidden',
    elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4,
  },
  image: { width: '100%', height: '100%' },
  placeholder: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  placeholderIcon: { fontSize: 48, marginBottom: 8 },
  placeholderText: { color: '#bdc3c7', fontSize: 15 },

  buttonRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  pickBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center',
    elevation: 2,
  },
  cameraBtn: { backgroundColor: '#3498db' },
  galleryBtn: { backgroundColor: '#9b59b6' },
  pickBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  scanBtn: {
    backgroundColor: '#27ae60', paddingVertical: 16, borderRadius: 12,
    alignItems: 'center', marginBottom: 20,
    elevation: 3, shadowColor: '#27ae60',
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 6,
  },
  scanBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },

  resultsSection: { marginTop: 8 },
  resultsTitle: { fontSize: 18, fontWeight: '700', color: '#34495e', marginBottom: 12 },
  noResults: { color: '#95a5a6', fontSize: 14, textAlign: 'center', paddingVertical: 20 },

  resultCard: {
    flexDirection: 'row', backgroundColor: '#fff', borderRadius: 12,
    padding: 14, marginBottom: 10, alignItems: 'center',
    elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 3,
  },
  resultInfo: { flex: 1 },
  resultName: { fontSize: 16, fontWeight: '700', color: '#2c3e50' },
  resultDosage: { fontSize: 13, color: '#7f8c8d', marginTop: 2 },
  resultFrequency: { fontSize: 13, color: '#7f8c8d', marginTop: 1 },
  addBtn: {
    backgroundColor: '#3498db', paddingVertical: 8, paddingHorizontal: 16,
    borderRadius: 8,
  },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  rawTextSection: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14, marginTop: 16,
  },
  rawTextTitle: { fontSize: 14, fontWeight: '700', color: '#34495e', marginBottom: 8 },
  rawText: { fontSize: 13, color: '#7f8c8d', lineHeight: 18 },
});

export default ScanPrescriptionScreen;
