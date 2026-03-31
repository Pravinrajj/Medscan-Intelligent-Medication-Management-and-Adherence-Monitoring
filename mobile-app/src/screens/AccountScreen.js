import React, { useContext, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, SafeAreaView } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import api from '../api/client';
import { colors, fonts, spacing, radii, shadows, typography, components } from '../theme';

const AccountScreen = ({ navigation }) => {
  const { userInfo } = useContext(AuthContext);
  const toast = useToast();

  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState(userInfo?.fullName || '');
  const [email, setEmail] = useState(userInfo?.email || '');
  const [username, setUsername] = useState(userInfo?.username || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put('/auth/profile', { fullName, email, username });
      toast.success('Profile updated successfully.');
      setEditing(false);
    } catch (e) {
      const msg = e.response?.data?.message || 'Failed to update profile.';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditing(false);
    setFullName(userInfo?.fullName || '');
    setEmail(userInfo?.email || '');
    setUsername(userInfo?.username || '');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Avatar */}
        <View style={styles.avatarSection}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(userInfo?.fullName || userInfo?.username || '?')[0].toUpperCase()}
            </Text>
          </View>
          <Text style={styles.displayName}>{userInfo?.fullName || userInfo?.username}</Text>
          {userInfo?.createdAt && (
            <Text style={styles.memberSince}>
              Member since {new Date(userInfo.createdAt).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
            </Text>
          )}
        </View>

        {/* Personal Info Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Personal Information</Text>
            {!editing ? (
              <TouchableOpacity style={styles.editButton} onPress={() => setEditing(true)}>
                <MaterialCommunityIcons name="pencil-outline" size={16} color={colors.primary} />
                <Text style={styles.editButtonText}>Edit</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ flexDirection: 'row', gap: spacing.md }}>
                <TouchableOpacity onPress={handleCancel}>
                  <Text style={[styles.editButtonText, { color: colors.danger }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleSave} disabled={saving}>
                  <Text style={[styles.editButtonText, { color: colors.primary }]}>
                    {saving ? 'Saving...' : 'Save'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          <FieldRow
            icon="account-outline"
            label="Full Name"
            value={fullName}
            editing={editing}
            onChange={setFullName}
          />
          <FieldRow
            icon="email-outline"
            label="Email"
            value={email}
            editing={editing}
            onChange={setEmail}
            keyboardType="email-address"
          />
          <FieldRow
            icon="at"
            label="Username"
            value={username}
            editing={editing}
            onChange={setUsername}
            autoCapitalize="none"
          />
          <FieldRow
            icon="phone-outline"
            label="Phone"
            value={userInfo?.phoneNumber || '—'}
            editing={false}
            locked
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const FieldRow = ({ icon, label, value, editing, onChange, locked, ...inputProps }) => (
  <View style={styles.field}>
    <View style={styles.fieldHeader}>
      <MaterialCommunityIcons name={icon} size={16} color={colors.textTertiary} />
      <Text style={styles.fieldLabel}>{label}</Text>
      {locked && <Text style={styles.lockedBadge}>Read-only</Text>}
    </View>
    {editing && !locked ? (
      <TextInput
        style={styles.fieldInput}
        value={value}
        onChangeText={onChange}
        placeholderTextColor={colors.textTertiary}
        {...inputProps}
      />
    ) : (
      <Text style={styles.fieldValue}>{value || '—'}</Text>
    )}
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, paddingBottom: spacing.section },

  // Avatar
  avatarSection: { alignItems: 'center', marginBottom: spacing.xxl, marginTop: spacing.md },
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.md,
    ...shadows.colored(colors.primary),
  },
  avatarText: { color: colors.textInverse, fontSize: 32, fontFamily: fonts.bold },
  displayName: { ...typography.h2, textAlign: 'center' },
  memberSince: { ...typography.small, marginTop: spacing.xs },

  // Card
  card: { ...components.card, marginBottom: spacing.lg },
  cardHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.borderLight,
  },
  cardTitle: { ...typography.label },
  editButton: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  editButtonText: { fontSize: 14, fontFamily: fonts.semiBold, color: colors.primary },

  // Fields
  field: { marginBottom: spacing.lg },
  fieldHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs,
  },
  fieldLabel: { ...typography.sectionLabel, marginBottom: 0 },
  lockedBadge: {
    fontSize: 9, fontFamily: fonts.medium, color: colors.textTertiary,
    backgroundColor: colors.surfaceHover, paddingHorizontal: 6, paddingVertical: 1,
    borderRadius: radii.xs, marginLeft: spacing.xs,
  },
  fieldValue: { fontSize: 16, fontFamily: fonts.medium, color: colors.text, marginLeft: spacing.xxl },
  fieldInput: {
    ...components.input, marginLeft: spacing.xxl,
    borderColor: colors.primary, backgroundColor: colors.primaryBg,
  },
});

export default AccountScreen;
