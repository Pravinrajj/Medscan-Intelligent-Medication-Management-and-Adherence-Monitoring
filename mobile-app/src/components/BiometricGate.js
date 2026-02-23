import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, AppState, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';

const INACTIVITY_THRESHOLD = 60000 * 5; // 5 minutes
const BIOMETRIC_KEY = 'biometric_enabled';

const BiometricGate = ({ children }) => {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [authFailed, setAuthFailed] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const lastActiveRef = useRef(Date.now());
  const appStateRef = useRef(AppState.currentState);

  const authenticate = async () => {
    setIsChecking(true);
    setAuthFailed(false);
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock MedScan',
        fallbackLabel: 'Use Passcode',
        disableDeviceFallback: false,
      });
      if (result.success) {
        setIsUnlocked(true);
        lastActiveRef.current = Date.now();
      } else {
        setAuthFailed(true);
      }
    } catch (e) {
      console.log('[BiometricGate] Auth error:', e.message);
      setAuthFailed(true);
    } finally {
      setIsChecking(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      try {
        // Check if user has enabled biometric lock
        const stored = await AsyncStorage.getItem(BIOMETRIC_KEY);
        const enabled = stored === 'true';
        setBiometricEnabled(enabled);

        if (!enabled) {
          // Biometric is OFF by default — skip auth, go straight in
          setIsUnlocked(true);
          setIsChecking(false);
          return;
        }

        // User enabled biometric — check hardware support
        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const isEnrolled = await LocalAuthentication.isEnrolledAsync();

        if (hasHardware && isEnrolled) {
          setIsSupported(true);
          await authenticate();
        } else {
          // Hardware not available even though user wants it
          console.log('[BiometricGate] Biometric not available, skipping');
          setIsSupported(false);
          setIsUnlocked(true);
          setIsChecking(false);
        }
      } catch (e) {
        console.log('[BiometricGate] Init error:', e.message);
        setIsUnlocked(true);
        setIsChecking(false);
      }
    };

    init();
  }, []);

  // AppState listener — re-lock after inactivity > 60s (only if biometric is enabled)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextAppState) => {
      if (appStateRef.current === 'active' && nextAppState.match(/inactive|background/)) {
        lastActiveRef.current = Date.now();
      }

      if (
        appStateRef.current.match(/inactive|background/) &&
        nextAppState === 'active' &&
        isSupported &&
        biometricEnabled
      ) {
        const elapsed = Date.now() - lastActiveRef.current;
        if (elapsed > INACTIVITY_THRESHOLD) {
          console.log(`[BiometricGate] Inactive for ${Math.round(elapsed / 1000)}s, re-locking`);
          setIsUnlocked(false);
          await authenticate();
        }
      }

      appStateRef.current = nextAppState;
    });

    return () => subscription.remove();
  }, [isSupported, biometricEnabled]);

  if (isChecking) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#3498db" />
        <Text style={styles.checkingText}>Verifying identity...</Text>
      </View>
    );
  }

  if (authFailed && !isUnlocked) {
    return (
      <View style={styles.container}>
        <Text style={styles.lockIcon}>🔒</Text>
        <Text style={styles.title}>MedScan is Locked</Text>
        <Text style={styles.subtitle}>Authenticate to access your medications</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={authenticate}>
          <Text style={styles.retryBtnText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return isUnlocked ? children : null;
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f6f9fc',
    padding: 40,
  },
  checkingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#7f8c8d',
    fontWeight: '500',
  },
  lockIcon: {
    fontSize: 64,
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#2c3e50',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#7f8c8d',
    textAlign: 'center',
    marginBottom: 30,
  },
  retryBtn: {
    backgroundColor: '#3498db',
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 12,
    elevation: 2,
    shadowColor: '#3498db',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  retryBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});

export default BiometricGate;
