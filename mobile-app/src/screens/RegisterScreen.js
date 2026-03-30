import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform, StatusBar } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import api from '../api/client';
import { colors, fonts, spacing, radii, shadows, typography } from '../theme';

const RegisterScreen = ({ navigation }) => {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleRegister = async () => {
    if (!username.trim() || !email.trim() || !password.trim() || !fullName.trim()) {
      Alert.alert('Error', 'Please fill in all required fields.');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    try {
      await api.post('/auth/signup', {
        username: username.trim(),
        email: email.trim(),
        fullName: fullName.trim(),
        phoneNumber: phoneNumber.trim(),
        password,
        role: 'PATIENT',
      });
      Alert.alert('Success', 'Account created successfully! Please sign in.', [
        { text: 'OK', onPress: () => navigation.navigate('Login') }
      ]);
    } catch (e) {
      const msg = e.response?.data?.message || 'Registration failed. Please try again.';
      Alert.alert('Registration Failed', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <StatusBar barStyle="light-content" />

      {/* Top compact header */}
      <View style={styles.topSection}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={colors.textInverse} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Create Account</Text>
        <Text style={styles.topSub}>Join MedScan to manage your medications</Text>
      </View>

      <ScrollView style={styles.formSection} contentContainerStyle={styles.formContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <InputField icon="account-outline" label="Full Name" value={fullName} onChange={setFullName} placeholder="Your full name" />
        <InputField icon="at" label="Username" value={username} onChange={setUsername} placeholder="Choose a username" autoCapitalize="none" />
        <InputField icon="email-outline" label="Email" value={email} onChange={setEmail} placeholder="your@email.com" keyboardType="email-address" autoCapitalize="none" />
        <InputField icon="phone-outline" label="Phone (optional)" value={phoneNumber} onChange={setPhoneNumber} placeholder="+91 9876543210" keyboardType="phone-pad" />

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Password</Text>
          <View style={styles.inputWrapper}>
            <MaterialCommunityIcons name="lock-outline" size={20} color={colors.textTertiary} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="At least 6 characters"
              placeholderTextColor={colors.textTertiary}
              secureTextEntry={!showPassword}
            />
            <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
              <MaterialCommunityIcons name={showPassword ? "eye-off-outline" : "eye-outline"} size={20} color={colors.textTertiary} />
            </TouchableOpacity>
          </View>
        </View>

        <InputField icon="lock-check-outline" label="Confirm Password" value={confirmPassword} onChange={setConfirmPassword} placeholder="Re-enter password" secureTextEntry={!showPassword} />

        <TouchableOpacity style={styles.registerBtn} onPress={handleRegister} disabled={loading} activeOpacity={0.8}>
          {loading ? (
            <ActivityIndicator color={colors.textInverse} />
          ) : (
            <Text style={styles.registerBtnText}>Create Account</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate('Login')} style={styles.loginRow}>
          <Text style={styles.loginText}>Already have an account? </Text>
          <Text style={styles.loginLink}>Sign In</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const InputField = ({ icon, label, value, onChange, ...props }) => (
  <View style={styles.inputContainer}>
    <Text style={styles.label}>{label}</Text>
    <View style={styles.inputWrapper}>
      <MaterialCommunityIcons name={icon} size={20} color={colors.textTertiary} style={styles.inputIcon} />
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholderTextColor={colors.textTertiary}
        {...props}
      />
    </View>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  topSection: {
    paddingTop: 50, paddingBottom: spacing.xxl, paddingHorizontal: spacing.xxl,
    backgroundColor: colors.primary,
    borderBottomLeftRadius: 24, borderBottomRightRadius: 24,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md,
  },
  topTitle: { fontSize: 24, fontFamily: fonts.bold, color: colors.textInverse },
  topSub: { fontSize: 13, fontFamily: fonts.regular, color: 'rgba(255,255,255,0.75)', marginTop: spacing.xs },

  formSection: { flex: 1 },
  formContent: { padding: spacing.xxl, paddingBottom: spacing.section },

  inputContainer: { marginBottom: spacing.lg },
  label: { ...typography.sectionLabel, marginBottom: spacing.xs },
  inputWrapper: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surfaceHover, borderRadius: radii.md,
    paddingHorizontal: spacing.md,
  },
  inputIcon: { marginRight: spacing.sm },
  input: {
    flex: 1, fontSize: 15, fontFamily: fonts.regular, color: colors.text,
    paddingVertical: spacing.md,
  },
  eyeBtn: { padding: spacing.sm },

  registerBtn: {
    backgroundColor: colors.primary, paddingVertical: spacing.md + 2,
    borderRadius: radii.md, alignItems: 'center', marginTop: spacing.md,
    ...shadows.colored(colors.primary),
  },
  registerBtnText: { color: colors.textInverse, fontSize: 16, fontFamily: fonts.bold },

  loginRow: { flexDirection: 'row', justifyContent: 'center', marginTop: spacing.xxl },
  loginText: { fontSize: 14, fontFamily: fonts.regular, color: colors.textSecondary },
  loginLink: { fontSize: 14, fontFamily: fonts.bold, color: colors.primary },
});

export default RegisterScreen;
