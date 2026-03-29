import React, { useState, useContext } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Alert, KeyboardAvoidingView, Platform, ActivityIndicator
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import api from '../api/client';
import { AuthContext } from '../context/AuthContext';

const AddGroupScreen = ({ navigation }) => {
  const { userInfo } = useContext(AuthContext);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) {
      Alert.alert('Required', 'Please enter a group name.');
      return;
    }

    setSaving(true);
    try {
      const params = new URLSearchParams({
        adminId: userInfo.id.toString(),
        groupName: name.trim(),
      });
      if (description.trim()) {
        params.append('description', description.trim());
      }
      const groupRes = await api.post(`/groups/create?${params.toString()}`);
      const createdGroup = groupRes.data;

      Alert.alert(
        'Group Created',
        'Your group is ready! Add members now?',
        [
          {
            text: 'Later',
            style: 'cancel',
            onPress: () => navigation.goBack(),
          },
          {
            text: 'Add Members',
            onPress: () => {
              // Navigate to GroupDetails where Add Member modal exists
              navigation.replace('GroupChat', { group: createdGroup });
              setTimeout(() => {
                navigation.navigate('GroupDetails', { group: createdGroup, openAddMember: true });
              }, 300);
            },
          },
        ]
      );
    } catch (e) {
      const msg = e.response?.data?.message || 'Failed to create group.';
      Alert.alert('Error', msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.content}>
        {/* Icon */}
        <View style={styles.iconCircle}>
          <MaterialCommunityIcons name="account-group" size={40} color="#3b82f6" />
        </View>

        <Text style={styles.title}>Create a Care Group</Text>
        <Text style={styles.subtitle}>
          Create a group to share medication schedules and send reminders to family or caregivers
        </Text>

        {/* Group Name */}
        <Text style={styles.label}>GROUP NAME</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g., Family Care Group"
          placeholderTextColor="#94a3b8"
          autoFocus
          maxLength={50}
        />
        <Text style={styles.charCount}>{name.length}/50</Text>

        {/* Description */}
        <Text style={styles.label}>DESCRIPTION (optional)</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={description}
          onChangeText={setDescription}
          placeholder="What's this group for?"
          placeholderTextColor="#94a3b8"
          multiline
          numberOfLines={3}
          maxLength={200}
        />

        {/* Info */}
        <View style={styles.infoRow}>
          <MaterialCommunityIcons name="information-outline" size={14} color="#0369a1" style={{ marginTop: 1 }} />
          <Text style={styles.infoText}>
            You ({userInfo?.fullName || userInfo?.username}) will be the admin. You can add members after creation.
          </Text>
        </View>

        {/* Create Button */}
        <TouchableOpacity
          style={[styles.createBtn, !name.trim() && { opacity: 0.5 }]}
          onPress={handleCreate}
          disabled={saving || !name.trim()}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.createBtnText}>Create Group →</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f9fc' },
  content: { flex: 1, padding: 24, paddingTop: 20 },

  iconCircle: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: '#e0f2fe',
    alignItems: 'center', justifyContent: 'center', alignSelf: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 22, fontWeight: '800', color: '#1e293b', textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13, color: '#94a3b8', textAlign: 'center', lineHeight: 19,
    marginBottom: 28, paddingHorizontal: 10,
  },

  label: {
    fontSize: 11, fontWeight: '700', color: '#64748b', letterSpacing: 0.8,
    marginBottom: 6, marginTop: 16,
  },
  input: {
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#e2e8f0',
    borderRadius: 12, padding: 14, fontSize: 16, color: '#1e293b',
  },
  textArea: { height: 80, textAlignVertical: 'top' },
  charCount: { fontSize: 11, color: '#94a3b8', textAlign: 'right', marginTop: 4 },

  infoRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: '#f0f9ff', padding: 12, borderRadius: 10,
    marginTop: 24, borderWidth: 1, borderColor: '#bae6fd',
  },
  infoIcon: { fontSize: 14, marginTop: 1 },
  infoText: { flex: 1, fontSize: 12, color: '#0369a1', lineHeight: 18 },

  createBtn: {
    backgroundColor: '#2563eb', paddingVertical: 16, borderRadius: 14,
    alignItems: 'center', marginTop: 28,
    elevation: 4, shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8,
  },
  createBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});

export default AddGroupScreen;
