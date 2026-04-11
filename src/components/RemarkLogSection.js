import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Modal,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { useTheme } from '../context/ThemeContext';
import { useAlert } from '../context/AlertContext';
import { formatRemarkEntryAuditLines } from '../utils/remarkLog';
import { keyboardAvoidingBehavior } from '../utils/keyboardAvoiding';

function responseLooksLikeHtml(data) {
  const s = String(data || '').trimStart().toLowerCase();
  return s.startsWith('<!doctype') || s.startsWith('<html');
}

function formatRemarkSaveError(e) {
  const data = e?.response?.data;
  const status = e?.response?.status;

  if (typeof data === 'string' && data.trim() && responseLooksLikeHtml(data)) {
    if (status === 404) {
      return 'The API returned an HTML 404 page (not JSON). That usually means the backend on that IP/port is an old build without the notes routes, or another app is using that port. Copy the latest backend project there and restart it (npm run dev or node index.js).';
    }
    return 'The server sent a web page instead of JSON. Check API_URL and that the PlotVista backend is running.';
  }
  if (data && typeof data === 'object' && data.message != null && String(data.message).trim()) {
    return String(data.message).trim();
  }
  if (typeof data === 'string' && data.trim()) {
    return data.trim().slice(0, 280);
  }
  if (status === 401) {
    return 'Session expired or not signed in. Please log in again.';
  }
  if (status === 404) {
    return 'Server could not find this plot or note (404). If you just deployed, restart the API so new routes are active.';
  }
  if (status === 400) {
    return 'Invalid request (400). Check note text and plot state.';
  }
  if (status) {
    return `Request failed (HTTP ${status}).`;
  }
  if (e?.message && typeof e.message === 'string') {
    return e.message;
  }
  return 'Could not save note.';
}

/**
 * Append-only notes with per-entry timestamp + author; edit = typo fix (same entry).
 * @param {{ text: string, _id?: string, isLegacy?: boolean, createdAt?: string, createdBy?: string, updatedAt?: string, updatedBy?: string }[]} entries
 * @param {(text: string) => Promise<void>} onAdd
 * @param {(remarkId: string, text: string) => Promise<void>} onPatch — remarkId is Mongo subdoc id or 'legacy'
 * @param {'full' | 'addButtonOnly'} listDisplay — `addButtonOnly`: icon + modal only (e.g. table row); parent renders note text elsewhere.
 */
export default function RemarkLogSection({
  entries = [],
  readOnly,
  onAdd,
  onPatch,
  disabled,
  listDisplay = 'full',
}) {
  const { colors, isDark } = useTheme();
  const { showAlert } = useAlert();
  const styles = useMemo(() => getStyles(colors, isDark), [colors, isDark]);

  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [editingEntry, setEditingEntry] = useState(null);
  const [saving, setSaving] = useState(false);

  const openAdd = () => {
    setEditingEntry(null);
    setDraft('');
    setModalOpen(true);
  };

  const openEdit = (e) => {
    setEditingEntry(e);
    setDraft(e.text || '');
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
    setEditingEntry(null);
    setDraft('');
  };

  const save = async () => {
    const t = draft.trim();
    if (!t) {
      showAlert('Required', 'Enter note text.');
      return;
    }
    try {
      setSaving(true);
      if (editingEntry) {
        const rid =
          editingEntry.isLegacy || !editingEntry._id
            ? 'legacy'
            : String(editingEntry._id);
        await onPatch(rid, t);
      } else {
        await onAdd(t);
      }
      closeModal();
    } catch (e) {
      showAlert('Error', formatRemarkSaveError(e));
    } finally {
      setSaving(false);
    }
  };

  const blocked = disabled || saving;
  const addButtonOnly = listDisplay === 'addButtonOnly';

  if (addButtonOnly && readOnly) {
    return null;
  }

  return (
    <View style={addButtonOnly ? styles.wrapAddOnly : styles.wrap}>
      {!addButtonOnly ? (
        <>
          <View style={styles.headerRow}>
            <Text style={styles.sectionTitle}>Notes</Text>
            {!readOnly ? (
              <TouchableOpacity
                style={styles.addBtn}
                onPress={openAdd}
                disabled={blocked}
                accessibilityRole="button"
                accessibilityLabel="Add note"
              >
                <Icon name="add" size={18} color={colors.primary} />
                <Text style={[styles.addBtnText, { color: colors.primary }]}>Add note</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {entries.length === 0 ? (
            <Text style={[styles.empty, { color: colors.textSecondary }]}>No notes yet.</Text>
          ) : (
            entries.map((entry, idx) => (
              <View
                key={entry._id != null ? String(entry._id) : `legacy-${idx}`}
                style={[styles.entryCard, { borderColor: colors.border, backgroundColor: colors.surface }]}
              >
                <View style={styles.entryTop}>
                  <Text style={[styles.entryText, { color: colors.text }]}>{entry.text}</Text>
                  {!readOnly ? (
                    <TouchableOpacity
                      style={styles.editIconBtn}
                      onPress={() => openEdit(entry)}
                      disabled={blocked}
                      accessibilityLabel="Edit note spelling"
                    >
                      <Icon name="edit" size={18} color={colors.primary} />
                    </TouchableOpacity>
                  ) : null}
                </View>
                {formatRemarkEntryAuditLines(entry).map((line, li) => (
                  <Text key={li} style={[styles.auditLine, { color: colors.textSecondary }]}>
                    {line}
                  </Text>
                ))}
              </View>
            ))
          )}
        </>
      ) : (
        <TouchableOpacity
          style={styles.inlineAddBtn}
          onPress={openAdd}
          disabled={blocked}
          accessibilityRole="button"
          accessibilityLabel="Add note"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Icon name="note-add" size={22} color={colors.primary} />
        </TouchableOpacity>
      )}

      <Modal visible={modalOpen} transparent animationType="fade" onRequestClose={closeModal}>
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView behavior={keyboardAvoidingBehavior()} style={styles.modalKav}>
            <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {editingEntry ? 'Edit note' : 'Add note'}
              </Text>
              <Text style={[styles.modalHint, { color: colors.textSecondary }]}>
                {editingEntry
                  ? 'Fix spelling or wording. To add a follow-up, use Add note on the list.'
                  : 'Saved with your name and time automatically.'}
              </Text>
              <TextInput
                style={[styles.modalInput, { borderColor: colors.border, color: colors.text }]}
                placeholder="Type note…"
                placeholderTextColor={colors.placeholder}
                value={draft}
                onChangeText={setDraft}
                multiline
                numberOfLines={5}
                textAlignVertical="top"
                editable={!saving}
              />
              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.modalBtn, { borderColor: colors.border }]}
                  onPress={closeModal}
                  disabled={saving}
                >
                  <Text style={{ color: colors.textSecondary, fontWeight: '700' }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalBtnPrimary, { backgroundColor: colors.primary }]}
                  onPress={() => { void save(); }}
                  disabled={saving}
                >
                  {saving ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.modalBtnPrimaryText}>Save</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

function getStyles(colors, isDark) {
  return StyleSheet.create({
    wrap: { marginTop: 4 },
    wrapAddOnly: {
      justifyContent: 'flex-start',
      alignItems: 'center',
      marginTop: 0,
    },
    inlineAddBtn: {
      padding: 4,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: isDark ? 'rgba(59,130,246,0.12)' : 'rgba(37,99,235,0.08)',
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    sectionTitle: {
      fontSize: 12,
      fontWeight: '800',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.65,
    },
    addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 6 },
    addBtnText: { fontSize: 13, fontWeight: '700' },
    empty: { fontSize: 14, fontWeight: '600', fontStyle: 'italic', marginBottom: 4 },
    entryCard: {
      borderWidth: 1,
      borderRadius: 10,
      padding: 10,
      marginBottom: 8,
    },
    entryTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    entryText: { flex: 1, fontSize: 15, fontWeight: '600', lineHeight: 22 },
    editIconBtn: { padding: 4 },
    auditLine: { fontSize: 11, fontWeight: '600', fontStyle: 'italic', marginTop: 4, lineHeight: 16 },
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      padding: 20,
    },
    modalKav: { width: '100%' },
    modalCard: {
      borderRadius: 14,
      borderWidth: 1,
      padding: 16,
      maxWidth: 400,
      alignSelf: 'center',
      width: '100%',
    },
    modalTitle: { fontSize: 17, fontWeight: '800', marginBottom: 6 },
    modalHint: { fontSize: 12, marginBottom: 12, lineHeight: 18 },
    modalInput: {
      borderWidth: 1,
      borderRadius: 10,
      padding: 12,
      minHeight: 100,
      fontSize: 15,
      marginBottom: 14,
    },
    modalActions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
    modalBtn: {
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: 10,
      borderWidth: 1,
    },
    modalBtnPrimary: {
      paddingVertical: 10,
      paddingHorizontal: 20,
      borderRadius: 10,
      minWidth: 100,
      alignItems: 'center',
    },
    modalBtnPrimaryText: { color: '#fff', fontWeight: '800' },
  });
}
