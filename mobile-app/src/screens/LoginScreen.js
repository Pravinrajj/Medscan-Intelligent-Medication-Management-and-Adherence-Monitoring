import React, { useState, useContext } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, SafeAreaView, StatusBar } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AuthContext } from '../context/AuthContext';
import { colors, fonts, spacing, radii, shadows, typography } from '../theme';

const LoginScreen = ({ navigation }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const { login } = useContext(AuthContext);

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      Alert.alert('Error', 'Please enter both username and password.');
      return;
    }
    setLoading(true);
    try {
      await login(username.trim(), password);
    } catch (e) {
      const msg = e.response?.data?.message || 'Login failed. Please check your credentials.';
      Alert.alert('Login Failed', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <StatusBar barStyle="light-content" />

      {/* Top Section */}
      <View style={styles.topSection}>
        <View style={styles.iconCircle}>
          <MaterialCommunityIcons name="pill" size={32} color={colors.textInverse} />
        </View>
        <Text style={styles.appName}>MedScan</Text>
        <Text style={styles.tagline}>Intelligent Medication Management</Text>
      </View>

      {/* Form */}
      <View style={styles.formSection}>
        <Text style={styles.title}>Welcome Back</Text>
        <Text style={styles.subtitle}>Sign in to continue</Text>

        <View style={styles.inputGroup}>
          <View style={styles.inputWrapper}>
            <MaterialCommunityIcons name="account-outline" size={20} color={colors.textTertiary} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              value={username}
              onChangeText={setUsername}
              placeholder="Username, email, or phone"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
            />
          </View>

          <View style={styles.inputWrapper}>
            <MaterialCommunityIcons name="lock-outline" size={20} color={colors.textTertiary} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={colors.textTertiary}
              secureTextEntry={!showPassword}
            />
            <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
              <MaterialCommunityIcons name={showPassword ? "eye-off-outline" : "eye-outline"} size={20} color={colors.textTertiary} />
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity style={styles.loginBtn} onPress={handleLogin} disabled={loading} activeOpacity={0.8}>
          {loading ? (
            <ActivityIndicator color={colors.textInverse} />
          ) : (
            <Text style={styles.loginBtnText}>Sign In</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate('Register')} style={styles.registerRow}>
          <Text style={styles.registerText}>Don't have an account? </Text>
          <Text style={styles.registerLink}>Sign Up</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  topSection: {
    flex: 0.32, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primary,
    borderBottomLeftRadius: 32, borderBottomRightRadius: 32,
  },
  iconCircle: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md,
  },
  appName: { fontSize: 30, fontFamily: fonts.bold, color: colors.textInverse, letterSpacing: -0.5 },
  tagline: { fontSize: 13, fontFamily: fonts.regular, color: 'rgba(255,255,255,0.75)', marginTop: spacing.xs },

  formSection: { flex: 0.68, padding: spacing.xxl + 4, justifyContent: 'center' },
  title: { ...typography.h1, marginBottom: spacing.xs },
  subtitle: { ...typography.caption, marginBottom: spacing.xxl },

  inputGroup: { gap: spacing.md, marginBottom: spacing.xxl },
  inputWrapper: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surfaceHover, borderRadius: radii.md,
    paddingHorizontal: spacing.md,
  },
  inputIcon: { marginRight: spacing.sm },
  input: {
    flex: 1, fontSize: 15, fontFamily: fonts.regular, color: colors.text,
    paddingVertical: spacing.md + 2,
  },
  eyeBtn: { padding: spacing.sm },

  loginBtn: {
    backgroundColor: colors.primary, paddingVertical: spacing.md + 2,
    borderRadius: radii.md, alignItems: 'center',
    ...shadows.colored(colors.primary),
  },
  loginBtnText: { color: colors.textInverse, fontSize: 16, fontFamily: fonts.bold },

  registerRow: { flexDirection: 'row', justifyContent: 'center', marginTop: spacing.xxl },
  registerText: { fontSize: 14, fontFamily: fonts.regular, color: colors.textSecondary },
  registerLink: { fontSize: 14, fontFamily: fonts.bold, color: colors.primary },
});

export default LoginScreen;
