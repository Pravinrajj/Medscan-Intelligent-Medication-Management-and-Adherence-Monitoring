import React, { useContext, useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, Alert, SafeAreaView } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { cancelAllReminders } from '../services/NotificationService';
import { colors, fonts, spacing, radii, shadows, typography, components } from '../theme';

const ProfileScreen = ({ navigation }) => {
  const { userInfo, logout } = useContext(AuthContext);
  const toast = useToast();

  const [remindersEnabled, setRemindersEnabled] = useState(true);
  const [biometricEnabled, setBiometricEnabled] = useState(false);

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
    toast.info(value ? 'Reminders enabled' : 'All reminders turned off');
  };

  const handleToggleBiometric = async (value) => {
    if (value) {
      try {
        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const isEnrolled = await LocalAuthentication.isEnrolledAsync();
        if (!hasHardware || !isEnrolled) {
          toast.warning('Your device does not support biometric authentication.');
          return;
        }
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Confirm to enable Screen Lock',
          fallbackLabel: 'Use Passcode',
          disableDeviceFallback: false,
        });
        if (!result.success) {
          toast.error('Authentication failed. Screen Lock was not enabled.');
          return;
        }
      } catch (e) {
        toast.error('Could not verify authentication.');
        return;
      }
    }
    setBiometricEnabled(value);
    await AsyncStorage.setItem('biometric_enabled', String(value));
    if (value) {
      toast.success('Screen Lock enabled.');
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
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Header / User Card */}
        <View style={styles.header}>
          <Text style={styles.title}>Settings</Text>
        </View>

        <TouchableOpacity style={styles.userCard} onPress={() => navigation.navigate('Account')} activeOpacity={0.7}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(userInfo?.fullName || userInfo?.username || '?')[0].toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.userName}>{userInfo?.fullName || userInfo?.username}</Text>
            <Text style={styles.userEmail}>{userInfo?.email || 'View profile'}</Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={22} color={colors.textTertiary} />
        </TouchableOpacity>

        {/* Preferences */}
        <Text style={styles.sectionLabel}>Preferences</Text>
        <View style={styles.card}>
          <SettingToggle
            icon="bell-outline"
            label="Medication Reminders"
            hint={remindersEnabled ? 'Notifications are on' : 'All notifications off'}
            value={remindersEnabled}
            onToggle={handleToggleReminders}
          />
          <View style={styles.divider} />
          <SettingToggle
            icon="lock-outline"
            label="Screen Lock"
            hint={biometricEnabled ? 'Fingerprint/PIN required' : 'No authentication required'}
            value={biometricEnabled}
            onToggle={handleToggleBiometric}
          />
        </View>

        {/* Navigation Items */}
        <Text style={styles.sectionLabel}>More</Text>
        <View style={styles.card}>
          <NavRow icon="chart-bar" label="Adherence Report" onPress={() => navigation.navigate('Report')} />
          <View style={styles.divider} />
          <NavRow icon="help-circle-outline" label="Help & About" onPress={() => {
            Alert.alert('MedScan Help',
              'MedScan helps you track medications, set reminders, and manage adherence with care groups.\n\n' +
              'Dashboard: View & log today\'s medicines\n' +
              'Medicines: View history & manage schedules\n' +
              'Groups: Share schedules with family/caregivers\n' +
              'Scan: Add medicines via prescription/strip scan\n\n' +
              'Need help? Contact: support@medscan.app'
            );
          }} />
        </View>

        {/* Logout */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <MaterialCommunityIcons name="logout" size={18} color={colors.danger} />
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>

        <Text style={styles.version}>MedScan v2.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
};

const SettingToggle = ({ icon, label, hint, value, onToggle }) => (
  <View style={styles.settingRow}>
    <View style={styles.settingIconBox}>
      <MaterialCommunityIcons name={icon} size={20} color={colors.primary} />
    </View>
    <View style={{ flex: 1 }}>
      <Text style={styles.settingLabel}>{label}</Text>
      <Text style={styles.settingHint}>{hint}</Text>
    </View>
    <Switch
      value={value}
      onValueChange={onToggle}
      trackColor={{ false: colors.border, true: colors.primaryLight }}
      thumbColor={value ? colors.primary : colors.textTertiary}
    />
  </View>
);

const NavRow = ({ icon, label, onPress }) => (
  <TouchableOpacity style={styles.navRow} onPress={onPress} activeOpacity={0.6}>
    <View style={styles.settingIconBox}>
      <MaterialCommunityIcons name={icon} size={20} color={colors.primary} />
    </View>
    <Text style={styles.navLabel}>{label}</Text>
    <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textTertiary} />
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: spacing.section },

  header: {
    paddingHorizontal: spacing.xl, paddingTop: 50, paddingBottom: spacing.lg,
    backgroundColor: colors.surface,
  },
  title: { ...typography.h1 },

  // User card
  userCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, marginHorizontal: spacing.lg,
    marginTop: spacing.md, padding: spacing.lg, borderRadius: radii.xl,
    ...shadows.sm,
  },
  avatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: colors.textInverse, fontSize: 20, fontFamily: fonts.bold },
  userName: { fontSize: 16, fontFamily: fonts.semiBold, color: colors.text },
  userEmail: { fontSize: 13, fontFamily: fonts.regular, color: colors.textTertiary, marginTop: 2 },

  // Section
  sectionLabel: {
    ...typography.sectionLabel,
    marginHorizontal: spacing.xl, marginTop: spacing.xxl, marginBottom: spacing.sm,
  },

  card: {
    backgroundColor: colors.surface, marginHorizontal: spacing.lg,
    borderRadius: radii.xl, ...shadows.sm,
    overflow: 'hidden',
  },
  divider: { height: 1, backgroundColor: colors.borderLight, marginLeft: 60 },

  // Setting toggle
  settingRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.md, paddingHorizontal: spacing.lg,
  },
  settingIconBox: {
    width: 36, height: 36, borderRadius: radii.sm,
    backgroundColor: colors.primaryBg, alignItems: 'center', justifyContent: 'center',
  },
  settingLabel: { fontSize: 15, fontFamily: fonts.medium, color: colors.text },
  settingHint: { fontSize: 12, fontFamily: fonts.regular, color: colors.textTertiary, marginTop: 2 },

  // Nav row
  navRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.md + 2, paddingHorizontal: spacing.lg,
  },
  navLabel: { flex: 1, fontSize: 15, fontFamily: fonts.medium, color: colors.text },

  // Logout
  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    marginHorizontal: spacing.lg, marginTop: spacing.xxl,
    backgroundColor: colors.dangerLight, borderRadius: radii.lg,
    paddingVertical: spacing.md + 2,
    borderWidth: 1, borderColor: '#FECACA',
  },
  logoutText: { color: colors.danger, fontFamily: fonts.bold, fontSize: 15 },

  version: {
    textAlign: 'center', fontFamily: fonts.regular,
    color: colors.textTertiary, fontSize: 12, marginTop: spacing.lg,
  },
});

export default ProfileScreen;
