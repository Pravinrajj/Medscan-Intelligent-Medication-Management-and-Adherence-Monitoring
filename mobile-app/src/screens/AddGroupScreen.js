import React, { useState, useContext } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView, ActivityIndicator } from 'react-native';
import api from '../api/client';
import { AuthContext } from '../context/AuthContext';

const AddGroupScreen = ({ navigation }) => {
  const { userInfo } = useContext(AuthContext);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);

  const searchByPhone = async (query) => {
    setMemberSearch(query);
    // Need at least 3 digits to search
    if (query.replace(/\D/g, '').length < 3) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    try {
      // Use the contact matching endpoint
      const res = await api.post('/groups/contacts/check', [query.trim()]);
      // Filter out already selected members and current user
      const filtered = (res.data || []).filter(
        u => u.id !== userInfo.id && !selectedMembers.find(m => m.id === u.id)
      );
      setSearchResults(filtered);
    } catch (e) {
      console.log('[AddGroup] Search failed:', e.message);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const addMember = (user) => {
    setSelectedMembers([...selectedMembers, user]);
    setSearchResults([]);
    setMemberSearch('');
  };

  const removeMember = (userId) => {
    setSelectedMembers(selectedMembers.filter(m => m.id !== userId));
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Please enter a group name.');
      return;
    }

    setSaving(true);
    try {
      // Step 1: Create the group
      const groupRes = await api.post(`/groups/create?adminId=${userInfo.id}&groupName=${encodeURIComponent(name.trim())}`);
      const groupId = groupRes.data.id;

      // Step 2: Add each selected member
      for (const member of selectedMembers) {
        try {
          await api.post(`/groups/${groupId}/add-member?adminId=${userInfo.id}&userId=${member.id}`);
        } catch (e) {
          console.log(`[AddGroup] Failed to add member ${member.id}:`, e.message);
        }
      }
      Alert.alert('Success', 'Group created successfully!');
      navigation.goBack();
    } catch (e) {
      const msg = e.response?.data?.message || 'Failed to create group.';
      Alert.alert('Error', msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionTitle}>Group Details</Text>

        <Text style={styles.label}>Group Name *</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g., Family Care Group"
          placeholderTextColor="#bdc3c7"
        />

        <Text style={styles.label}>Description</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={description}
          onChangeText={setDescription}
          placeholder="Briefly describe this group's purpose"
          placeholderTextColor="#bdc3c7"
          multiline
          numberOfLines={3}
        />

        <Text style={styles.sectionTitle}>Add Members</Text>

        <TextInput
          style={styles.input}
          value={memberSearch}
          onChangeText={searchByPhone}
          placeholder="Search by phone number"
          placeholderTextColor="#bdc3c7"
          keyboardType="phone-pad"
        />

        {searching && <ActivityIndicator size="small" color="#3498db" style={{ marginVertical: 8 }} />}

        {searchResults.length > 0 && (
          <View style={styles.searchResults}>
            {searchResults.map(user => (
              <TouchableOpacity key={user.id} style={styles.searchResultItem} onPress={() => addMember(user)}>
                <View style={styles.userAvatar}>
                  <Text style={styles.userAvatarText}>{(user.fullName || user.username || '?')[0].toUpperCase()}</Text>
                </View>
                <View style={styles.userInfo}>
                  <Text style={styles.userName}>{user.fullName || user.username}</Text>
                  <Text style={styles.userPhone}>{user.phoneNumber || '—'}</Text>
                </View>
                <Text style={styles.addIcon}>+</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {memberSearch.replace(/\D/g, '').length >= 3 && !searching && searchResults.length === 0 && (
          <Text style={styles.noResults}>No registered user found with that number</Text>
        )}

        {/* Selected Members */}
        {selectedMembers.length > 0 && (
          <View style={styles.selectedSection}>
            <Text style={styles.selectedTitle}>Selected ({selectedMembers.length})</Text>
            {selectedMembers.map(member => (
              <View key={member.id} style={styles.selectedMember}>
                <View style={[styles.userAvatar, { backgroundColor: '#27ae60' }]}>
                  <Text style={styles.userAvatarText}>{(member.fullName || member.username || '?')[0].toUpperCase()}</Text>
                </View>
                <Text style={styles.selectedName}>{member.fullName || member.username}</Text>
                <TouchableOpacity onPress={() => removeMember(member.id)}>
                  <Text style={styles.removeBtn}>✗</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* Creator info */}
        <View style={styles.creatorInfo}>
          <Text style={styles.creatorText}>You ({userInfo?.fullName || userInfo?.username}) will be the group admin.</Text>
        </View>

        {/* Create Button */}
        <TouchableOpacity style={styles.createBtn} onPress={handleCreate} disabled={saving}>
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.createBtnText}>✨ Create Group</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f9fc' },
  scrollContent: { padding: 20, paddingBottom: 40 },

  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#34495e', marginBottom: 12, marginTop: 16 },
  label: { fontSize: 13, fontWeight: '700', color: '#34495e', marginBottom: 6, marginTop: 12, textTransform: 'uppercase', letterSpacing: 0.5 },

  input: {
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#e0e6ed',
    borderRadius: 12, padding: 14, fontSize: 16, color: '#2c3e50',
  },
  textArea: { height: 80, textAlignVertical: 'top' },

  searchResults: {
    backgroundColor: '#fff', borderRadius: 12, borderWidth: 1,
    borderColor: '#e0e6ed', marginTop: 8, maxHeight: 200,
  },
  searchResultItem: {
    flexDirection: 'row', alignItems: 'center', padding: 12,
    borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  userAvatar: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#3498db',
    alignItems: 'center', justifyContent: 'center', marginRight: 10,
  },
  userAvatarText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  userInfo: { flex: 1 },
  userName: { fontSize: 14, fontWeight: '600', color: '#2c3e50' },
  userPhone: { fontSize: 12, color: '#95a5a6' },
  addIcon: { fontSize: 20, color: '#3498db', fontWeight: '700' },
  noResults: { color: '#95a5a6', fontSize: 13, textAlign: 'center', marginTop: 12 },

  selectedSection: { marginTop: 16 },
  selectedTitle: { fontSize: 14, fontWeight: '600', color: '#7f8c8d', marginBottom: 8 },
  selectedMember: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    padding: 10, borderRadius: 10, marginBottom: 6,
  },
  selectedName: { flex: 1, fontSize: 14, fontWeight: '600', color: '#2c3e50', marginLeft: 10 },
  removeBtn: { color: '#e74c3c', fontSize: 18, fontWeight: '700', paddingHorizontal: 8 },

  creatorInfo: {
    backgroundColor: '#eaf7fd', padding: 12, borderRadius: 10, marginTop: 16,
    borderLeftWidth: 4, borderLeftColor: '#3498db',
  },
  creatorText: { color: '#2980b9', fontSize: 13, fontWeight: '500' },

  createBtn: {
    backgroundColor: '#27ae60', paddingVertical: 16, borderRadius: 12,
    alignItems: 'center', marginTop: 24,
    elevation: 3, shadowColor: '#27ae60',
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 6,
  },
  createBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});

export default AddGroupScreen;
