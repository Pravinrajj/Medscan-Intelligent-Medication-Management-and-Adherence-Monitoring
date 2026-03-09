import React, { useContext, useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, Switch } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import { AuthContext } from '../context/AuthContext';
import api from '../api/client';

const ProfileScreen = ({ navigation }) => {
  const { userInfo, logout } = useContext(AuthContext);
  
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState(userInfo?.fullName || '');
  const [email, setEmail] = useState(userInfo?.email || '');
  const [username, setUsername] = useState(userInfo?.username || '');
  const [saving, setSaving] = useState(false);
  const [remindersEnabled, setRemindersEnabled] = useState(true);
  const [biometricEnabled, setBiometricEnabled] = useState(false);

  // Load persisted settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const [reminderVal, bioVal] = await Promise.all([
          AsyncStorage.getItem('global_notifications'),
          AsyncStorage.getItem('biometric_enabled'),
        ]);
        if (reminderVal !== null) setRemindersEnabled(reminderVal === 'true');
        if (bioVal !== null) setBiometricEnabled(bioVal === 'true');
      } catch (e) {
        console.log('[Profile] Failed to load settings:', e.message);
      }
    };
    loadSettings();
  }, []);

  const handleToggleReminders = async (value) => {
    setRemindersEnabled(value);
    await AsyncStorage.setItem('global_notifications', String(value));
  };

  const handleToggleBiometric = async (value) => {
    if (value) {
      // Verify device ownership before enabling
      try {
        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const isEnrolled = await LocalAuthentication.isEnrolledAsync();
        if (!hasHardware || !isEnrolled) {
          Alert.alert('Not Available', 'Your device does not support biometric authentication or no biometric is enrolled.');
          return;
        }
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Confirm to enable Screen Lock',
          fallbackLabel: 'Use Passcode',
          disableDeviceFallback: false,
        });
        if (!result.success) {
          Alert.alert('Authentication Failed', 'Screen Lock was not enabled.');
          return;
        }
      } catch (e) {
        Alert.alert('Error', 'Could not verify authentication.');
        return;
      }
    }
    setBiometricEnabled(value);
    await AsyncStorage.setItem('biometric_enabled', String(value));
    if (value) {
      Alert.alert('Screen Lock Enabled', 'MedScan will ask for authentication when you open the app after being inactive.');
    }
  };

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      const res = await api.put('/auth/profile', { fullName, email, username });
      Alert.alert('Updated', 'Profile saved successfully!');
      setEditing(false);
    } catch (e) {
      const msg = e.response?.data?.message || 'Failed to update profile.';
      Alert.alert('Error', msg);
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    Alert.alert(
      'Log Out',
      'Are you sure you want to log out?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Log Out', style: 'destructive', onPress: logout }
      ]
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Avatar Section */}
      <View style={styles.avatarSection}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(userInfo?.fullName || userInfo?.username || '?')[0].toUpperCase()}
          </Text>
        </View>
        <Text style={styles.displayName}>{userInfo?.fullName || userInfo?.username}</Text>
        <Text style={styles.role}>{userInfo?.roles?.[0] || 'PATIENT'}</Text>
      </View>

      {/* Info Card */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Personal Information</Text>
          <TouchableOpacity onPress={() => editing ? handleSaveProfile() : setEditing(true)}>
            <Text style={styles.editBtn}>{saving ? 'Saving...' : editing ? '💾 Save' : '✏️ Edit'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Full Name</Text>
          {editing ? (
            <TextInput style={styles.fieldInput} value={fullName} onChangeText={setFullName} />
          ) : (
            <Text style={styles.fieldValue}>{fullName || '—'}</Text>
          )}
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Email</Text>
          {editing ? (
            <TextInput style={styles.fieldInput} value={email} onChangeText={setEmail} keyboardType="email-address" />
          ) : (
            <Text style={styles.fieldValue}>{email || '—'}</Text>
          )}
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Phone</Text>
          <Text style={[styles.fieldValue, { color: '#95a5a6' }]}>{userInfo?.phoneNumber || '—'}</Text>
          {editing && <Text style={styles.lockedHint}>Phone number cannot be changed</Text>}
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Username</Text>
          {editing ? (
            <TextInput style={styles.fieldInput} value={username} onChangeText={setUsername} autoCapitalize="none" />
          ) : (
            <Text style={styles.fieldValue}>{username || '—'}</Text>
          )}
        </View>

        {editing && (
          <TouchableOpacity style={styles.cancelBtn} onPress={() => {
            setEditing(false);
            setFullName(userInfo?.fullName || '');
            setEmail(userInfo?.email || '');
            setUsername(userInfo?.username || '');
          }}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Settings Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Settings</Text>

        <View style={styles.settingRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.settingLabel}>🔔 Medication Reminders</Text>
            <Text style={styles.settingHint}>
              {remindersEnabled ? 'Notifications are on for scheduled medicines' : 'All notifications are off'}
            </Text>
          </View>
          <Switch
            value={remindersEnabled}
            onValueChange={handleToggleReminders}
            trackColor={{ false: '#d1d5db', true: '#86efac' }}
            thumbColor={remindersEnabled ? '#22c55e' : '#9ca3af'}
          />
        </View>

        <View style={[styles.settingRow, { borderTopWidth: 1, borderTopColor: '#f0f0f0', paddingTop: 14 }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.settingLabel}>🔒 Screen Lock</Text>
            <Text style={styles.settingHint}>
              {biometricEnabled ? 'Fingerprint/PIN required on app launch' : 'Off — no authentication required'}
            </Text>
          </View>
          <Switch
            value={biometricEnabled}
            onValueChange={handleToggleBiometric}
            trackColor={{ false: '#d1d5db', true: '#93c5fd' }}
            thumbColor={biometricEnabled ? '#3b82f6' : '#9ca3af'}
          />
        </View>
      </View>

      {/* Actions Card */}
      <View style={styles.card}>
        <TouchableOpacity style={styles.actionRow} onPress={() => navigation.navigate('Report')}>
          <Text style={styles.actionText}>📊 Adherence Reports</Text>
          <Text style={styles.actionArrow}>→</Text>
        </TouchableOpacity>
      </View>

      {/* Logout */}
      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <Text style={styles.logoutText}>Log Out</Text>
      </TouchableOpacity>

      <Text style={styles.version}>MedScan v1.0.0</Text>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f9fc' },
  content: { padding: 20, paddingBottom: 40 },

  avatarSection: { alignItems: 'center', marginBottom: 24, marginTop: 10 },
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: '#3498db', alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
    shadowColor: '#3498db', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
  avatarText: { color: '#fff', fontSize: 32, fontWeight: '700' },
  displayName: { fontSize: 22, fontWeight: '800', color: '#2c3e50' },
  role: { fontSize: 13, color: '#7f8c8d', marginTop: 4, textTransform: 'uppercase', letterSpacing: 1 },

  card: {
    backgroundColor: '#fff', borderRadius: 16, padding: 18,
    marginBottom: 16, elevation: 2,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#34495e' },
  editBtn: { fontSize: 14, fontWeight: '600', color: '#3498db' },

  field: { marginBottom: 14 },
  fieldLabel: { fontSize: 12, color: '#95a5a6', fontWeight: '600', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  fieldValue: { fontSize: 16, color: '#2c3e50', fontWeight: '500' },
  fieldInput: {
    borderWidth: 1, borderColor: '#3498db', borderRadius: 8,
    padding: 10, fontSize: 16, backgroundColor: '#f0f8ff',
  },

  cancelBtn: { alignSelf: 'flex-end', marginTop: 4 },
  cancelBtnText: { color: '#e74c3c', fontWeight: '600', fontSize: 14 },
  lockedHint: { fontSize: 11, color: '#bdc3c7', marginTop: 2, fontStyle: 'italic' },

  settingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  settingLabel: { fontSize: 15, color: '#2c3e50', fontWeight: '500' },
  settingHint: { fontSize: 11, color: '#95a5a6', marginTop: 2 },

  actionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  actionText: { fontSize: 15, color: '#2c3e50', fontWeight: '500' },
  actionArrow: { fontSize: 18, color: '#bdc3c7' },

  logoutBtn: {
    backgroundColor: '#fef2f2', borderRadius: 12,
    paddingVertical: 14, alignItems: 'center', marginTop: 8,
    borderWidth: 1, borderColor: '#fee2e2',
  },
  logoutText: { color: '#ef4444', fontWeight: '700', fontSize: 16 },

  version: { textAlign: 'center', color: '#bdc3c7', fontSize: 12, marginTop: 16 },
});

export default ProfileScreen;
