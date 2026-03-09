import React, { useState, useContext } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { AuthContext } from '../context/AuthContext';

const LoginScreen = ({ navigation }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  
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
      <View style={styles.topSection}>
        <Text style={styles.logo}>💊</Text>
        <Text style={styles.appName}>MedScan</Text>
        <Text style={styles.tagline}>Your medication companion</Text>
      </View>

      <View style={styles.formSection}>
        <Text style={styles.title}>Welcome Back</Text>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Username, Email, or Phone</Text>
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={setUsername}
            placeholder="Enter username, email, or phone"
            placeholderTextColor="#bdc3c7"
            autoCapitalize="none"
          />
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="Enter your password"
            placeholderTextColor="#bdc3c7"
            secureTextEntry
          />
        </View>

        <TouchableOpacity style={styles.loginBtn} onPress={handleLogin} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.loginBtnText}>Sign In</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate('Register')}>
          <Text style={styles.registerLink}>
            Don't have an account? <Text style={styles.registerLinkBold}>Sign Up</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f9fc' },
  
  topSection: {
    flex: 0.35,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3498db',
    borderBottomLeftRadius: 40,
    borderBottomRightRadius: 40,
  },
  logo: { fontSize: 56 },
  appName: { fontSize: 32, fontWeight: '800', color: '#fff', marginTop: 8 },
  tagline: { fontSize: 14, color: 'rgba(255, 255, 255, 0.72)', marginTop: 4 },

  formSection: {
    flex: 0.65,
    padding: 30,
    justifyContent: 'center',
  },
  title: { fontSize: 24, fontWeight: '800', color: '#2c3e50', marginBottom: 24 },

  inputContainer: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '600', color: '#7f8c8d', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e6ed',
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: '#2c3e50',
  },

  loginBtn: {
    backgroundColor: '#3498db',
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
    elevation: 2,
    shadowColor: '#3498db',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  loginBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },

  registerLink: { textAlign: 'center', marginTop: 20, color: '#7f8c8d', fontSize: 14 },
  registerLinkBold: { color: '#3498db', fontWeight: '700' },
});

export default LoginScreen;
