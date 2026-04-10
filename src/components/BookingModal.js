import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Image, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
  PermissionsAndroid, Linking, Pressable, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { launchCamera } from 'react-native-image-picker';
import Icon from '@react-native-vector-icons/material-design-icons';
import api from '../services/api';
import { displayActivityAction } from '../utils/activityLabels';
import {
  toOrdinal,
  formatDateTime as formatDateTimeShared,
  formatDateTimeCard,
  nameOnly,
} from '../utils/formatting';
import { STATUS_COLORS, STATUS_TEXT_COLORS, getStatusSwatchColor } from '../constants/statusColors';
import MobileBoxInput from './MobileBoxInput';
import UserAvatar from './UserAvatar';
import { useAlert } from '../context/AlertContext';
import { useTheme } from '../context/ThemeContext';
import { keyboardAvoidingBehavior } from '../utils/keyboardAvoiding';

const PAYMENT_MODES = ['Cash', 'Cheque', 'UPI', 'Bank Transfer'];
const REFUND_MODES = PAYMENT_MODES;
const ADMIN_PASSWORD = '8811';

const paymentToLabel = (mode) => {
  if (mode === 'Cash') return 'Owner Name (Received By)';
  if (mode === 'UPI') return 'UPI ID / Recipient Name';
  if (mode === 'Cheque') return 'In Favour Of / Bank Name';
  if (mode === 'Bank Transfer') return 'Bank Name & Account';
  return 'Received By';
};

const StatusBadge = ({ status, waiterCount, styles, colors, isDark }) => {
  const isVacant = status === 'vacant';
  const bg = status === 'waiting' && waiterCount > 1
    ? STATUS_COLORS.waitingMultiple
    : STATUS_COLORS[status] || '#888';
  const borderVacant = isDark ? '#94a3b8' : colors.text;
  return (
    <View style={[
      styles.statusBadge,
      { backgroundColor: bg },
      isVacant && { borderWidth: 1, borderColor: borderVacant },
    ]}>
      <Text style={[styles.statusBadgeText, { color: STATUS_TEXT_COLORS[status] || (isVacant ? '#0f172a' : '#fff') }]}>
        {status === 'vacant' ? 'OPEN' : status === 'waiting' ? 'Waiting' : status === 'booked' ? 'Booked' : status === 'BM' ? 'Reserved BM' : status}
      </Text>
    </View>
  );
};

const BookingModal = ({
  visible,
  plot,
  isBulk,
  bulkCount,
  selectedPlots = [],
  onClose,
  onUpdate,
  onPressPlotDetails,
  onActivitySummary,
}) => {
  const { isDark, colors } = useTheme();
  const styles = React.useMemo(() => getStyles(colors, isDark), [colors, isDark]);
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Cap sheet/scroll height but do not force a fixed sheet height — flex:1 on ScrollView
  // was stretching empty space between header and quick actions for sparse plots.
  const sheetMaxHeight = Math.round(windowHeight * 0.92);
  const scrollMaxHeight = Math.round(
    Math.max(200, sheetMaxHeight - 108 - 128 - Math.max(insets.bottom, 0)),
  );
  const { showAlert } = useAlert();
  const [activeAction, setActiveAction] = useState(null);
  /** When booking while waiters exist: set after "Book as …" or per-row "Make final" so submit is allowed. */
  const bookedFlowSourceRef = useRef(null);

  const [customerName, setCustomerName] = useState('');
  const [customerMobiles, setCustomerMobiles] = useState(['']);
  const [customerAddress, setCustomerAddress] = useState('');
  const [customerPhoto, setCustomerPhoto] = useState('');
  const [photoLocalUri, setPhotoLocalUri] = useState('');
  const [photoBase64, setPhotoBase64] = useState('');

  const [advanceAmount, setAdvanceAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState('');
  const [paymentTo, setPaymentTo] = useState('');
  const [remarks, setRemarks] = useState('');

  const [refundMode, setRefundMode] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundBy, setRefundBy] = useState('');
  const [refundRemarks, setRefundRemarks] = useState('');
  const [openWaitingRemarks, setOpenWaitingRemarks] = useState('');

  const [showAdminOverride, setShowAdminOverride] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [adminOverrideGranted, setAdminOverrideGranted] = useState(false);

  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [removeWaiterId, setRemoveWaiterId] = useState(null);
  const [removeWaiterReason, setRemoveWaiterReason] = useState('');
  const [isEditingWaiter, setIsEditingWaiter] = useState(false);
  const [editWaiterId, setEditWaiterId] = useState(null);
  const [editWaiterName, setEditWaiterName] = useState('');
  const [editWaiterMobiles, setEditWaiterMobiles] = useState(['']);
  const [editWaiterAddress, setEditWaiterAddress] = useState('');
  const [editWaiterRemarks, setEditWaiterRemarks] = useState('');

  // History states
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [queueImagePreviewUri, setQueueImagePreviewUri] = useState(null);

  // Reset only when the target plot or bulk mode changes — not when the modal is hidden
  // to view Plot details (so back returns to the same step: quick actions, forms, history).
  useEffect(() => {
    setCustomerName('');
    setCustomerMobiles(['']);
    setCustomerAddress('');
    setCustomerPhoto('');
    setPhotoLocalUri('');
    setPhotoBase64('');
    setAdvanceAmount('');
    setPaymentMode('');
    setPaymentTo('');
    setRemarks('');
    setRefundMode('');
    setRefundAmount('');
    setRefundBy('');
    setRefundRemarks('');
    setOpenWaitingRemarks('');

    setActiveAction(null);
    setAdminOverrideGranted(false);
    setAdminPassword('');
    setShowAdminOverride(false);

    setIsUploading(false);
    setIsSubmitting(false);
    setIsRemoving(false);
    setRemoveWaiterId(null);
    setRemoveWaiterReason('');
    setIsEditingWaiter(false);
    setEditWaiterId(null);
    setEditWaiterName('');
    setEditWaiterMobiles(['']);
    setEditWaiterAddress('');
    setEditWaiterRemarks('');

    setShowHistory(false);
    setHistory([]);
    setQueueImagePreviewUri(null);
    bookedFlowSourceRef.current = null;
  }, [plot?._id, isBulk]);

  useEffect(() => {
    if (activeAction !== 'booked') {
      bookedFlowSourceRef.current = null;
    }
  }, [activeAction]);

  useEffect(() => {
    if (!visible) setQueueImagePreviewUri(null);
  }, [visible]);

  // Re-fetch history when the modal opens, or when the same plot receives a new
  // action (detected via historySummary length change from socket updates).
  const historySummaryLength = plot?.historySummary?.length ?? 0;
  useEffect(() => {
    if (visible && plot && !isBulk) {
      fetchHistory();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, plot?._id, isBulk, historySummaryLength]);

  const fetchHistory = async () => {
    try {
      setIsLoadingHistory(true);
      const res = await api.get(`${plot._id}/history`);
      setHistory(res.data);
    } catch (e) {
      console.error('[BookingModal] Fetch History Error:', e.message);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const addMobile = () => {
    if (customerMobiles.length < 5) setCustomerMobiles([...customerMobiles, '']);
  };

  const removeMobile = (index) => {
    const updated = customerMobiles.filter((_, i) => i !== index);
    setCustomerMobiles(updated.length ? updated : ['']);
  };

  const updateMobile = (text, index) => {
    const updated = [...customerMobiles];
    updated[index] = text;
    setCustomerMobiles(updated);
  };

  const handleCamera = async () => {
    try {
      // Android 6+ requires runtime permission even if declared in AndroidManifest.xml
      if (Platform.OS === 'android') {
        const status = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.CAMERA,
          {
            title: 'Camera Permission',
            message: 'PlotSync needs camera access to capture customer photos for booking records.',
            buttonPositive: 'Allow',
            buttonNegative: 'Deny',
            buttonNeutral: 'Ask Later',
          },
        );
        if (status !== PermissionsAndroid.RESULTS.GRANTED) {
          showAlert(
            'Camera Permission Denied',
            'Please allow camera access in Settings to capture customer photos.',
          );
          return;
        }
      }

      const response = await launchCamera({ mediaType: 'photo', quality: 0.6, includeBase64: true });
      if (response.didCancel || response.errorCode) return;
      const asset = response.assets?.[0];
      if (asset) {
        setPhotoLocalUri(asset.uri);
        setPhotoBase64(asset.base64);
      }
    } catch (err) {
      if (__DEV__) console.error('[BookingModal] launchCamera error:', err?.message);
    }
  };

  const uploadPhoto = async () => {
    if (!photoBase64) return '';
    try {
      setIsUploading(true);
      if (__DEV__) console.log('[BookingModal] Uploading photo, base64 length:', photoBase64.length);
      const res = await api.post('/upload-photo', { base64Image: photoBase64 });
      if (__DEV__) console.log('[BookingModal] Photo uploaded successfully:', res.data.url);
      return res.data.url;
    } catch (e) {
      const errDetail = e.response?.data?.detail || e.response?.data?.message || e.message;
      if (__DEV__) console.error('[BookingModal] Photo upload failed:', JSON.stringify(e.response?.data || e.message));
      showAlert('Photo Upload Failed', `Error: ${errDetail}\n\nProceeding without photo.`);
      return '';
    } finally {
      setIsUploading(false);
    }
  };

  const applyWaiterToBookingForm = useCallback(
    (waiter) => {
      if (!waiter) return;
      bookedFlowSourceRef.current = { waiterId: waiter._id };
      setCustomerName(String(waiter.customerName || '').trim());
      const mobiles = (waiter.customerMobiles || []).map((m) => String(m).trim()).filter(Boolean);
      setCustomerMobiles(mobiles.length ? mobiles : ['']);
      setCustomerAddress(String(waiter.customerAddress || '').trim());
      setRemarks(String(waiter.remarks || '').trim());
      const photoUrl = String(waiter.customerPhoto || '').trim();
      setCustomerPhoto(photoUrl);
      setPhotoLocalUri(photoUrl && /^https?:\/\//i.test(photoUrl) ? photoUrl : '');
      setPhotoBase64('');
      setAdvanceAmount('');
      setPaymentMode('');
      setPaymentTo('');
      setAdminOverrideGranted(false);
      setShowAdminOverride(false);
      setAdminPassword('');
      setActiveAction('booked');
    },
    []
  );

  const openFreshBookedForm = useCallback(() => {
    bookedFlowSourceRef.current = null;
    setCustomerName('');
    setCustomerMobiles(['']);
    setCustomerAddress('');
    setRemarks('');
    setCustomerPhoto('');
    setPhotoLocalUri('');
    setPhotoBase64('');
    setAdvanceAmount('');
    setPaymentMode('');
    setPaymentTo('');
    setAdminOverrideGranted(false);
    setShowAdminOverride(false);
    setAdminPassword('');
    setActiveAction('booked');
  }, []);

  const onPressFinal = useCallback(() => {
    if (isBulk) {
      openFreshBookedForm();
      return;
    }
    const wl = plot?.waitingList || [];
    if (wl.length === 0) {
      openFreshBookedForm();
      return;
    }
    const first = wl[0];
    const nm = String(first.customerName || 'Waiting').trim() || 'Waiting';
    const shortBtn = nm.length > 22 ? `${nm.slice(0, 21)}…` : nm;
    const body =
      wl.length === 1
        ? 'This plot has waiting,\nBook as that person, or remove them if the buyer is different.'
        : `This plot has ${wl.length} people waiting,\nBook as the first person, or remove them if the buyer is different.`;
    showAlert(
      'Final Booking',
      body,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: `Book as ${shortBtn}`, onPress: () => applyWaiterToBookingForm(first) },
      ],
      { verticalButtons: true }
    );
  }, [isBulk, plot?.waitingList, showAlert, applyWaiterToBookingForm, openFreshBookedForm]);

  const checkAdminOverride = () => {
    if (adminPassword === ADMIN_PASSWORD) {
      setAdminOverrideGranted(true);
      setShowAdminOverride(false);
      showAlert('Override Granted', 'You can now book without an advance amount.');
    } else {
      showAlert('Wrong Password', 'Admin password is incorrect.');
    }
  };

  const needsRefundToOpen = React.useMemo(() => {
    if (isBulk && selectedPlots.length > 0) {
      return selectedPlots.some((p) => p.status === 'booked');
    }
    if (!isBulk && plot) return plot.status === 'booked';
    return false;
  }, [isBulk, selectedPlots, plot]);

  const needsWaitingReasonToOpen = React.useMemo(() => {
    if (isBulk && selectedPlots.length > 0) {
      return selectedPlots.some((p) => p.status === 'waiting');
    }
    if (!isBulk && plot) return plot.status === 'waiting';
    return false;
  }, [isBulk, selectedPlots, plot]);

  const validateRefundClient = () => {
    if (!refundMode.trim()) return 'Select refund mode.';
    if (!refundBy.trim()) return 'Enter owner name (processed by).';
    if (!refundRemarks.trim()) return 'Enter refund remarks.';
    const raw = String(refundAmount).trim().replace(/,/g, '');
    if (raw === '' || Number.isNaN(Number(raw))) return 'Enter a valid refund amount.';
    if (Number(raw) < 0) return 'Refund amount cannot be negative.';
    return null;
  };

  const handleSubmit = async (status) => {
    if (status === 'vacant') {
      if (needsRefundToOpen) {
        const err = validateRefundClient();
        if (err) {
          showAlert('Required', err);
          return;
        }
      }
      if (needsWaitingReasonToOpen && !openWaitingRemarks.trim()) {
        showAlert('Required', 'Please enter cancellation reason for waiting entries.');
        return;
      }
      try {
        setIsSubmitting(true);
        const payload = { status };
        if (needsRefundToOpen) {
          const raw = String(refundAmount).trim().replace(/,/g, '');
          payload.refundMode = refundMode.trim();
          payload.refundAmount = parseFloat(raw, 10);
          payload.refundBy = refundBy.trim();
          payload.refundRemarks = refundRemarks.trim();
        }
        if (needsWaitingReasonToOpen) {
          payload.removalRemarks = openWaitingRemarks.trim();
        }
        await onUpdate(payload);
      } catch (e) {
        console.error('[BookingModal] handleSubmit error:', e.message);
        showAlert('Error', 'Something went wrong. Please try again.');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (status === 'BM') {
      try {
        setIsSubmitting(true);
        await onUpdate({ status });
      } catch (e) {
        console.error('[BookingModal] handleSubmit error:', e.message);
        showAlert('Error', 'Something went wrong. Please try again.');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (!customerName.trim()) {
      showAlert('Required', 'Customer name is required.');
      return;
    }
    const validMobiles = customerMobiles.filter((m) => m.trim());
    if (!validMobiles.length) {
      showAlert('Required', 'At least one mobile number is required.');
      return;
    }
    const badMobile = validMobiles.find((m) => m.replace(/\D/g, '').length !== 10);
    if (badMobile) {
      showAlert('Invalid Number', `"${badMobile}" is not a valid 10-digit mobile number.`);
      return;
    }
    if (status === 'booked' && !isBulk && (plot?.waitingList?.length ?? 0) > 0) {
      if (!bookedFlowSourceRef.current) {
        showAlert(
          'Waiting list',
          'Use “Make final” on the correct waiting person, or tap Final and choose “Book as …” for the 1st waiting. If the buyer is not in the queue, remove all waiters first.',
        );
        return;
      }
    }

    if (status === 'booked') {
      if (!advanceAmount && !adminOverrideGranted) {
        showAlert(
          'Advance Amount Required',
          'Booking requires an advance amount. Enter it or use admin override.',
          [
            { text: 'Enter Amount', style: 'cancel' },
            { text: 'Admin Override', onPress: () => setShowAdminOverride(true) },
          ]
        );
        return;
      }
      if (!paymentMode) {
        showAlert('Required', 'Please select a payment mode.');
        return;
      }
    }

    try {
      setIsSubmitting(true);
      let finalPhotoUrl = await uploadPhoto();
      const existingPhoto = String(customerPhoto || '').trim();
      if (!finalPhotoUrl && existingPhoto && /^https?:\/\//i.test(existingPhoto)) {
        finalPhotoUrl = existingPhoto;
      }
      const mobiles = customerMobiles.filter((m) => m.trim());
      const payload = {
        status,
        customerName: customerName.trim(),
        customerMobiles: mobiles,
        customerAddress: customerAddress.trim(),
        customerPhoto: finalPhotoUrl,
        ...(status === 'booked' && {
          advanceAmount: advanceAmount ? parseFloat(advanceAmount) : null,
          paymentMode,
          paymentTo: paymentTo.trim(),
          remarks: remarks.trim(),
        }),
        ...(status === 'waiting' && remarks.trim()
          ? { remarks: remarks.trim() }
          : {}),
      };
      await onUpdate(payload);
    } catch (e) {
      console.error('[BookingModal] handleSubmit error:', e.message);
      showAlert('Error', 'Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const openRemoveWaiter = (waitingId) => {
    setRemoveWaiterReason('');
    setRemoveWaiterId(waitingId);
  };

  const openEditWaiter = (waiter) => {
    const mobiles = (waiter?.customerMobiles || []).filter((m) => String(m).trim());
    setEditWaiterId(waiter?._id || null);
    setEditWaiterName(waiter?.customerName || '');
    setEditWaiterMobiles(mobiles.length ? mobiles : ['']);
    setEditWaiterAddress(waiter?.customerAddress || '');
    setEditWaiterRemarks(waiter?.remarks || '');
  };

  const closeEditWaiter = () => {
    if (isEditingWaiter) return;
    setEditWaiterId(null);
    setEditWaiterName('');
    setEditWaiterMobiles(['']);
    setEditWaiterAddress('');
    setEditWaiterRemarks('');
  };

  const addEditWaiterMobile = () => {
    if (editWaiterMobiles.length < 5) {
      setEditWaiterMobiles((prev) => [...prev, '']);
    }
  };

  const removeEditWaiterMobile = (index) => {
    const next = editWaiterMobiles.filter((_, i) => i !== index);
    setEditWaiterMobiles(next.length ? next : ['']);
  };

  const updateEditWaiterMobile = (text, index) => {
    const next = [...editWaiterMobiles];
    next[index] = text;
    setEditWaiterMobiles(next);
  };

  const dialPhone = async (raw) => {
    const normalized = String(raw || '').replace(/[^\d+]/g, '');
    if (!normalized) {
      showAlert('No number', 'No phone number is saved for this contact.');
      return;
    }
    const url = `tel:${normalized}`;
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) await Linking.openURL(url);
      else showAlert('Cannot open dialer', 'This device cannot place calls from the app.');
    } catch (e) {
      showAlert('Call failed', e?.message || 'Could not open the phone app.');
    }
  };

  const confirmRemoveWaiter = async () => {
    const reason = removeWaiterReason.trim();
    if (!reason) {
      showAlert('Required', 'Please enter a reason for removing this person from the queue.');
      return;
    }
    try {
      setIsRemoving(true);
      const waiter = (plot?.waitingList || []).find((w) => String(w._id) === String(removeWaiterId));
      const waiterName = String(waiter?.customerName || 'Unknown').trim();
      const res = await api.delete(`/${plot._id}/waiting/${removeWaiterId}`, {
        data: { removalRemarks: reason },
      });
      onActivitySummary?.({
        type: 'remove_waiter',
        plotNumber: plot?.plotNumber,
        customerName: waiterName,
        reason,
      });
      setRemoveWaiterId(null);
      setRemoveWaiterReason('');
      const updatedPlot = res?.data;
      if (
        updatedPlot &&
        Array.isArray(updatedPlot.waitingList) &&
        updatedPlot.waitingList.length === 0
      ) {
        // Same UX as marking OPEN: if no queue remains, close the sheet.
        onClose?.();
      }
    } catch (error) {
      const msg = error.response?.data?.message || 'Failed to remove waiter.';
      showAlert('Error', msg);
    } finally {
      setIsRemoving(false);
    }
  };

  const saveEditWaiter = async () => {
    const name = editWaiterName.trim();
    const mobiles = editWaiterMobiles.map((m) => String(m).trim()).filter(Boolean);
    if (!name) {
      showAlert('Required', 'Customer name is required.');
      return;
    }
    if (!mobiles.length) {
      showAlert('Required', 'At least one mobile number is required.');
      return;
    }
    const badMobile = mobiles.find((m) => m.replace(/\D/g, '').length !== 10);
    if (badMobile) {
      showAlert('Invalid Number', `"${badMobile}" is not a valid 10-digit mobile number.`);
      return;
    }
    if (!plot?._id || !editWaiterId) return;
    try {
      setIsEditingWaiter(true);
      await api.patch(`/${plot._id}/waiting/${editWaiterId}`, {
        customerName: name,
        customerMobiles: mobiles,
        customerAddress: editWaiterAddress.trim(),
        remarks: editWaiterRemarks.trim(),
      });
      onActivitySummary?.({
        type: 'update_waiter',
        plotNumber: plot?.plotNumber,
        customerName: name,
      });
      closeEditWaiter();
    } catch (error) {
      const msg = error.response?.data?.message || 'Failed to update waiting details.';
      showAlert('Error', msg);
    } finally {
      setIsEditingWaiter(false);
    }
  };

  const confirmOpen = () => {
    showAlert(
      'Mark as OPEN?',
      'Are you sure you want to mark this plot as OPEN? This will permanently clear all booking and waiting list data for this plot.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          style: 'destructive',
          onPress: () => handleSubmit('vacant'),
        },
      ]
    );
  };

  const handleOpenPress = () => {
    if (needsRefundToOpen || needsWaitingReasonToOpen) {
      setActiveAction('refundOpen');
      return;
    }
    confirmOpen();
  };

  const confirmBM = () => {
    showAlert(
      'Reserve Plot (BM)?',
      'Are you sure you want to reserve this plot as BM? This will lock it from bookings and clear current waitlists.',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Confirm', 
          style: 'destructive', 
          onPress: () => handleSubmit('BM') 
        }
      ]
    );
  };

  const plotTitle = isBulk
    ? `Bulk Update — ${bulkCount} Plots`
    : plot ? `Plot No. ${plot.plotNumber}` : '';

  const hasBulkSelection = isBulk && selectedPlots.length > 0;
  const showOpenButton = isBulk
    ? hasBulkSelection && !selectedPlots.every((p) => p.status === 'vacant')
    : Boolean(plot) && plot.status !== 'vacant';
  const showWaitlistAndBook = isBulk
    ? hasBulkSelection && !selectedPlots.some((p) => p.status === 'booked' || p.status === 'BM')
    : Boolean(plot) && plot.status !== 'booked' && plot.status !== 'BM';
  const showBmButton = isBulk
    ? hasBulkSelection && !selectedPlots.some((p) => p.status === 'booked' || p.status === 'BM')
    : Boolean(plot) && plot.status !== 'booked' && plot.status !== 'BM';
  const nextWaitingOrdinal = toOrdinal((plot?.waitingList?.length || 0) + 1);

  const formatDateTime = formatDateTimeShared;

  return (
    <>
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <KeyboardAvoidingView
          behavior={keyboardAvoidingBehavior()}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
          style={styles.kav}
        >
          <View style={[styles.sheet, { maxHeight: sheetMaxHeight }]}>

            {/* Header */}
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <Text style={styles.plotTitle}>{plotTitle}</Text>
                {!isBulk && plot && (
                  <StatusBadge
                    status={plot.status}
                    waiterCount={plot.waitingList ? plot.waitingList.length : 0}
                    styles={styles}
                    colors={colors}
                    isDark={isDark}
                  />
                )}
              </View>
              <View style={styles.headerActions}>
                {!isBulk && plot && onPressPlotDetails && (
                  <TouchableOpacity
                    onPress={onPressPlotDetails}
                    style={styles.headerActionBtn}
                    accessibilityLabel="Plot details"
                  >
                    <Icon name="information-outline" size={22} color="#fff" />
                  </TouchableOpacity>
                )}
                {!isBulk && plot && (
                  <TouchableOpacity 
                    onPress={() => setShowHistory(!showHistory)} 
                    style={[styles.headerActionBtn, showHistory && styles.headerActionBtnActive]}
                  >
                    <Icon name={showHistory ? "form-select" : "history"} size={22} color="#fff" />
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={onClose} style={styles.closeX}>
                  <Icon name="close" size={20} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>

            {showHistory ? (
              <ScrollView
                style={[styles.bodyScroll, { maxHeight: scrollMaxHeight }]}
                contentContainerStyle={styles.bodyContent}
                showsVerticalScrollIndicator
                keyboardShouldPersistTaps="handled"
              >
              {!isBulk && (
                <View style={styles.historyContainer}>
                  <View style={styles.historyHeaderRow}>
                    <Text style={styles.historyTitle}>Activity History</Text>
                    {isLoadingHistory && <ActivityIndicator size="small" color={colors.primary} />}
                  </View>
                  
                  {history.length === 0 && !isLoadingHistory ? (
                    <Text style={styles.emptyHistory}>No history recorded for this plot yet.</Text>
                  ) : (
                    history.map((item, index) => (
                      <View key={item._id || index} style={styles.historyItem}>
                        <View style={styles.historyDotContainer}>
                          <View style={styles.historyDot} />
                          {index < history.length - 1 && <View style={styles.historyLine} />}
                        </View>
                        <View style={styles.historyContent}>
                          <View style={styles.historyItemHeader}>
                            <View style={{flexDirection: 'row', alignItems: 'center'}}>
                              {(() => {
                                const swColor = getStatusSwatchColor(item.action, item.newStatus, item.waiterCount);
                                const isVacant = item.action === 'Marked Vacant' || item.newStatus === 'vacant';
                                const isRemoved = item.action === 'Removed Waiting' || item.action === 'Removed Waiter';
                                return swColor != null ? (
                                  <View style={{
                                    width: 12, height: 12, backgroundColor: swColor, marginRight: 6,
                                    ...(isVacant ? { borderWidth: 1, borderColor: isDark ? '#94a3b8' : '#1a1a2e' } : {}),
                                    ...(isRemoved ? { borderRadius: 2 } : {}),
                                  }} />
                                ) : null;
                              })()}
                              <Text style={styles.historyAction}>{displayActivityAction(item.action, item.newStatus)}</Text>
                            </View>
                            <Text style={styles.historyTime}>{formatDateTime(item.createdAt)}</Text>
                          </View>
                          <View style={styles.historyByRow}>
                            <Text style={styles.historyDetails}>
                              Customer: {item.customerName} • By:{' '}
                            </Text>
                            <UserAvatar
                              name={item.changedBy}
                              imageUrl={item.changedByAvatarUrl}
                              size={18}
                              style={styles.historyAvatar}
                            />
                            <Text style={styles.historyDetails}>{nameOnly(item.changedBy)}</Text>
                          </View>
                          {item.refundDetails && item.refundDetails.mode ? (
                            <View style={styles.historyRefundBlock}>
                              <View style={styles.historyRefundRow}>
                                <Text style={styles.historyRefund}>
                                  Refund: Rs. {Number(item.refundDetails.amount).toLocaleString()} via{' '}
                                  {item.refundDetails.mode} • Owner:{' '}
                                </Text>
                                <UserAvatar
                                  name={item.refundDetails.processedBy}
                                  imageUrl={item.refundDetails.processedByAvatarUrl}
                                  size={16}
                                  style={styles.historyAvatar}
                                />
                                <Text style={styles.historyRefund}>{nameOnly(item.refundDetails.processedBy)}</Text>
                              </View>
                              {item.refundDetails.remarks ? (
                                <Text style={[styles.historyRefund, { marginTop: 6 }]}>
                                  Notes: {item.refundDetails.remarks}
                                </Text>
                              ) : null}
                            </View>
                          ) : null}
                          {(item.action === 'Removed Waiting' || item.action === 'Removed Waiter') && item.removalRemarks ? (
                            <Text style={styles.historyRefund}>
                              Removal reason: {item.removalRemarks}
                            </Text>
                          ) : null}
                        </View>
                      </View>
                    ))
                  )}
                  <TouchableOpacity style={styles.historyBackBtn} onPress={() => setShowHistory(false)}>
                    <Text style={styles.historyBackBtnText}>Back to Plot Details</Text>
                  </TouchableOpacity>
                </View>
              )}
              </ScrollView>
            ) : (
              <>
              <ScrollView
                style={[styles.bodyScroll, { maxHeight: scrollMaxHeight }]}
                contentContainerStyle={styles.bodyContent}
                showsVerticalScrollIndicator
                keyboardShouldPersistTaps="handled"
              >
              {/* BOOKED SUMMARY (same visual language as waiting-queue cards) */}
              {!isBulk && plot && plot.status === 'booked' && plot.bookingDetails && (!activeAction || activeAction === 'refundOpen') && (() => {
                const bd = plot.bookingDetails;
                const bookedMobiles = (bd.customerMobiles || []).filter((m) => String(m).trim());
                const hasPayment =
                  bd.advanceAmount != null ||
                  (bd.paymentMode && String(bd.paymentMode).trim()) ||
                  (bd.paymentTo && String(bd.paymentTo).trim());
                return (
                  <View style={styles.bookedSummaryOuter}>
                    <View style={styles.bookedDetailsCard}>
                      {bd.customerPhoto ? (
                        <Pressable
                          onPress={() => setQueueImagePreviewUri(bd.customerPhoto)}
                          style={({ pressed }) => [
                            styles.queuePhotoTouchable,
                            styles.bookedPhotoStrip,
                            pressed && styles.queuePhotoTouchablePressed,
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel="View customer photo full screen"
                        >
                          <Image source={{ uri: bd.customerPhoto }} style={styles.queuePhotoTop} />
                          <View style={styles.queuePhotoOverlay}>
                            <Icon name="fullscreen" size={22} color="#fff" />
                          </View>
                        </Pressable>
                      ) : null}

                      <View style={styles.queueCardInner}>
                        <Text style={styles.queueSectionTitle}>Booked for</Text>

                        <Text style={styles.queueFieldLabel}>Name</Text>
                        <Text style={styles.queueFieldValue} numberOfLines={4}>
                          {bd.customerName || '—'}
                        </Text>

                        {bookedMobiles.length > 0 ? (
                          <>
                            <Text style={[styles.queueFieldLabel, styles.queueFieldLabelSpaced]}>
                              Mobile number
                            </Text>
                            {bookedMobiles.map((m, mi) => (
                              <View key={mi} style={styles.queueMobileRow}>
                                <Text style={styles.queueFieldValueMono}>{m}</Text>
                                <TouchableOpacity
                                  onPress={() => dialPhone(m)}
                                  style={styles.queueInlineCall}
                                  accessibilityLabel={`Call ${m}`}
                                >
                                  <Icon name="phone" size={24} color="#1565c0" />
                                </TouchableOpacity>
                              </View>
                            ))}
                          </>
                        ) : null}

                        {bd.customerAddress ? (
                          <>
                            <Text style={[styles.queueFieldLabel, styles.queueFieldLabelSpaced]}>
                              Address
                            </Text>
                            <Text style={styles.queueFieldValue}>{bd.customerAddress}</Text>
                          </>
                        ) : null}

                        {bd.remarks ? (
                          <>
                            <Text style={[styles.queueFieldLabel, styles.queueFieldLabelSpaced]}>
                              Notes
                            </Text>
                            <Text style={styles.queueFieldValue}>{bd.remarks}</Text>
                          </>
                        ) : null}

                        {hasPayment ? (
                          <View style={styles.queuePaymentHint}>
                            <Text style={styles.queueFieldLabel}>Payment</Text>
                            {bd.advanceAmount != null ? (
                              <Text style={styles.queuePaymentText}>
                                Advance: Rs. {Number(bd.advanceAmount).toLocaleString()}
                                {bd.paymentMode && String(bd.paymentMode).trim()
                                  ? ` • ${String(bd.paymentMode).trim()}`
                                  : ''}
                              </Text>
                            ) : bd.paymentMode && String(bd.paymentMode).trim() ? (
                              <Text style={styles.queuePaymentText}>
                                Mode: {String(bd.paymentMode).trim()}
                              </Text>
                            ) : null}
                            {bd.paymentTo && String(bd.paymentTo).trim() ? (
                              <Text style={styles.queuePaymentText} numberOfLines={4}>
                                Paid to: {String(bd.paymentTo).trim()}
                              </Text>
                            ) : null}
                          </View>
                        ) : null}

                        <View style={styles.queueMetaFooter}>
                          <Text style={styles.queueAddedWhen}>
                            Booked {formatDateTimeCard(bd.createdAt)}
                          </Text>
                          {bd.createdBy ? (
                            <View style={styles.queueAddedByRow}>
                              <Text style={styles.queueAddedByLabel}>Performed by</Text>
                              <UserAvatar
                                name={bd.createdBy}
                                imageUrl={bd.createdByAvatarUrl}
                                size={26}
                              />
                              <Text style={styles.queueAddedByName}>{nameOnly(bd.createdBy)}</Text>
                            </View>
                          ) : null}
                        </View>
                      </View>
                    </View>
                  </View>
                );
              })()}

              {/* WAITING LIST SUMMARY (QUEUE) */}
              {!isBulk && plot && plot.waitingList?.length > 0 && !activeAction && (
                <View style={styles.summaryCard}>
                  <Text style={styles.queueSectionTitle}>
                    Waiting list queue ({plot.waitingList.length})
                  </Text>

                  {plot.waitingList.map((waiter, index) => {
                    const mobiles = (waiter.customerMobiles || []).filter((m) => String(m).trim());
                    return (
                      <View key={waiter._id || index} style={styles.queueItem}>
                        <View style={styles.queueLevel}>
                          <View style={styles.queueBadge}>
                            <Text style={styles.queueBadgeText}>{index + 1}</Text>
                          </View>
                          {index < plot.waitingList.length - 1 ? <View style={styles.queueLine} /> : null}
                        </View>

                        <View style={styles.queueCard}>
                          {waiter.customerPhoto ? (
                            <Pressable
                              onPress={() => setQueueImagePreviewUri(waiter.customerPhoto)}
                              style={({ pressed }) => [
                                styles.queuePhotoTouchable,
                                pressed && styles.queuePhotoTouchablePressed,
                              ]}
                              accessibilityRole="button"
                              accessibilityLabel="View customer photo full screen"
                            >
                              <Image
                                source={{ uri: waiter.customerPhoto }}
                                style={styles.queuePhotoTop}
                              />
                              <View style={styles.queuePhotoOverlay}>
                                <Icon name="fullscreen" size={22} color="#fff" />
                              </View>
                            </Pressable>
                          ) : null}

                          <View style={styles.queueCardInner}>
                            <View style={styles.queueTopBar}>
                              <Text style={styles.queueOrderText}>
                                {toOrdinal(index + 1)} WAITING
                              </Text>
                              <View style={styles.queueActionIcons}>
                                <TouchableOpacity
                                  onPress={() => openEditWaiter(waiter)}
                                  style={styles.queueIconBtn}
                                  accessibilityLabel="Edit waiting details"
                                >
                                  <Icon name="pencil-outline" size={22} color={colors.primary} />
                                </TouchableOpacity>
                                <TouchableOpacity
                                  onPress={() => openRemoveWaiter(waiter._id)}
                                  disabled={isRemoving}
                                  style={styles.queueIconBtn}
                                  accessibilityLabel="Remove from queue"
                                >
                                  <Icon name="delete-outline" size={22} color="#e53935" />
                                </TouchableOpacity>
                              </View>
                            </View>

                            <Text style={styles.queueFieldLabel}>Name</Text>
                            <Text style={styles.queueFieldValue} numberOfLines={3}>
                              {waiter.customerName || '—'}
                            </Text>

                            {mobiles.length > 0 ? (
                              <>
                                <Text style={[styles.queueFieldLabel, styles.queueFieldLabelSpaced]}>
                                  Mobile number
                                </Text>
                                {mobiles.map((m, mi) => (
                                  <View key={mi} style={styles.queueMobileRow}>
                                    <Text style={styles.queueFieldValueMono}>{m}</Text>
                                    <TouchableOpacity
                                      onPress={() => dialPhone(m)}
                                      style={styles.queueInlineCall}
                                      accessibilityLabel={`Call ${m}`}
                                    >
                                      <Icon name="phone" size={24} color="#1565c0" />
                                    </TouchableOpacity>
                                  </View>
                                ))}
                              </>
                            ) : null}

                            {waiter.customerAddress ? (
                              <>
                                <Text style={[styles.queueFieldLabel, styles.queueFieldLabelSpaced]}>
                                  Address
                                </Text>
                                <Text style={styles.queueFieldValue}>{waiter.customerAddress}</Text>
                              </>
                            ) : null}

                            {waiter.remarks ? (
                              <>
                                <Text style={[styles.queueFieldLabel, styles.queueFieldLabelSpaced]}>
                                  Notes
                                </Text>
                                <Text style={styles.queueFieldValue}>{waiter.remarks}</Text>
                              </>
                            ) : null}

                            {(waiter.advanceAmount != null && waiter.advanceAmount !== '') ||
                            (waiter.paymentMode && String(waiter.paymentMode).trim()) ? (
                              <View style={styles.queuePaymentHint}>
                                {waiter.advanceAmount != null && waiter.advanceAmount !== '' ? (
                                  <Text style={styles.queuePaymentText}>
                                    Advance: Rs. {Number(waiter.advanceAmount).toLocaleString()}
                                    {waiter.paymentMode ? ` • ${waiter.paymentMode}` : ''}
                                  </Text>
                                ) : waiter.paymentMode ? (
                                  <Text style={styles.queuePaymentText}>{waiter.paymentMode}</Text>
                                ) : null}
                                {waiter.paymentTo ? (
                                  <Text style={styles.queuePaymentText} numberOfLines={3}>
                                    To: {waiter.paymentTo}
                                  </Text>
                                ) : null}
                              </View>
                            ) : null}

                            <View style={styles.queueMetaFooter}>
                              <View style={styles.queueMetaFooterRow}>
                                <View style={styles.queueMetaLeft}>
                                  <Text style={styles.queueAddedWhen}>
                                    Added {formatDateTimeCard(waiter.createdAt)}
                                  </Text>
                                  {waiter.createdBy ? (
                                    <View style={styles.queueAddedByRow}>
                                      <Text style={styles.queueAddedByLabel}>Added by</Text>
                                      <UserAvatar
                                        name={waiter.createdBy}
                                        imageUrl={waiter.createdByAvatarUrl}
                                        size={26}
                                      />
                                      <Text style={styles.queueAddedByName}>
                                        {nameOnly(waiter.createdBy)}
                                      </Text>
                                    </View>
                                  ) : null}
                                </View>
                                {index === 0 ? (
                                  <TouchableOpacity
                                    style={styles.makeFinalBtnCompact}
                                    onPress={() => applyWaiterToBookingForm(waiter)}
                                    activeOpacity={0.88}
                                    accessibilityLabel="Final — use first waiting customer details"
                                  >
                                    <Icon name="check-circle-outline" size={17} color="#1b5e20" />
                                    <Text style={styles.makeFinalBtnCompactText}>Final</Text>
                                  </TouchableOpacity>
                                ) : null}
                              </View>
                            </View>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Refund / waiting-clear reason required when opening certain plot states */}
              {activeAction === 'refundOpen' && (
                <>
                  <Text style={styles.sectionLabel}>
                    {needsRefundToOpen ? 'Refund details' : 'Cancellation details'}
                  </Text>
                  {needsRefundToOpen && (
                    <Text style={styles.refundIntro}>
                      This plot is booked. Enter how the advance was refunded before marking it OPEN.
                    </Text>
                  )}
                  {!needsRefundToOpen && needsWaitingReasonToOpen && (
                    <Text style={styles.refundIntro}>
                      This plot has waiting entries. Enter cancellation reason before marking it OPEN.
                    </Text>
                  )}
                  {!isBulk && plot?.bookingDetails?.advanceAmount != null && (
                    <Text style={styles.refundHint}>
                      Original advance: Rs.{' '}
                      {Number(plot.bookingDetails.advanceAmount).toLocaleString()}
                    </Text>
                  )}
                  {isBulk && needsRefundToOpen && (
                    <Text style={styles.refundHint}>
                      At least one selected plot is booked — the same refund details apply to each
                      booked plot in this update.
                    </Text>
                  )}

                  <View style={styles.paymentCard}>
                    {needsRefundToOpen && (
                      <View style={styles.paymentHeaderRow}>
                        <Icon name="cash-multiple" size={18} color={colors.text} />
                        <Text style={styles.paymentHeader}> Refund</Text>
                      </View>
                    )}

                    {needsRefundToOpen && (
                      <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>
                          Refund mode <Text style={styles.required}>*</Text>
                        </Text>
                        <View style={styles.pillRow}>
                          {REFUND_MODES.map((mode) => (
                            <TouchableOpacity
                              key={mode}
                              style={[styles.pill, refundMode === mode && styles.pillActive]}
                              onPress={() => setRefundMode(mode)}
                            >
                              <Text
                                style={[styles.pillText, refundMode === mode && styles.pillTextActive]}
                              >
                                {mode}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>
                    )}

                    {needsRefundToOpen && (
                      <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>
                          Refund amount (Rs.) <Text style={styles.required}>*</Text>
                        </Text>
                        <View style={styles.inputWrapper}>
                          <Text style={styles.currencySymbol}>Rs.</Text>
                          <TextInput
                            placeholderTextColor={colors.placeholder}
                            style={[styles.inputWithIcon, { flex: 1 }]}
                            value={refundAmount}
                            onChangeText={setRefundAmount}
                            placeholder="Amount refunded"
                            keyboardType="decimal-pad"
                          />
                        </View>
                      </View>
                    )}

                    {needsRefundToOpen && (
                      <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>
                          Processed by (owner) <Text style={styles.required}>*</Text>
                        </Text>
                        <View style={styles.inputWrapper}>
                          <Icon name="account-outline" size={18} color={colors.textSecondary} style={styles.inputIcon} />
                          <TextInput
                            placeholderTextColor={colors.placeholder}
                            style={styles.inputWithIcon}
                            value={refundBy}
                            onChangeText={setRefundBy}
                            placeholder="Owner name"
                          />
                        </View>
                      </View>
                    )}

                    {needsRefundToOpen && (
                      <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>
                          Refund remarks <Text style={styles.required}>*</Text>
                        </Text>
                        <TextInput
                          placeholderTextColor={colors.placeholder}
                          style={[styles.inputWrapper, styles.multilineInput, { paddingHorizontal: 14 }]}
                          value={refundRemarks}
                          onChangeText={setRefundRemarks}
                          placeholder="Refund notes, reference no., etc."
                          multiline
                          numberOfLines={3}
                          textAlignVertical="top"
                        />
                      </View>
                    )}

                    {needsWaitingReasonToOpen && (
                      <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>
                          Cancellation reason (waiting) <Text style={styles.required}>*</Text>
                        </Text>
                        <TextInput
                          placeholderTextColor={colors.placeholder}
                          style={[styles.inputWrapper, styles.multilineInput, { paddingHorizontal: 14 }]}
                          value={openWaitingRemarks}
                          onChangeText={setOpenWaitingRemarks}
                          placeholder="Reason for clearing waiting entries before OPEN"
                          multiline
                          numberOfLines={3}
                          textAlignVertical="top"
                        />
                      </View>
                    )}
                  </View>

                  <View style={styles.submitRow}>
                    <TouchableOpacity style={styles.backBtn} onPress={() => setActiveAction(null)}>
                      <Icon name="arrow-left" size={16} color={colors.textSecondary} />
                      <Text style={styles.backBtnText}> Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.submitBtn, styles.openBtnSolid]}
                      onPress={() => handleSubmit('vacant')}
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? (
                        <ActivityIndicator color="#0f172a" />
                      ) : (
                        <Text style={[styles.submitBtnText, styles.submitBtnTextOnYellow]}>Confirm OPEN</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {/* Customer Form */}
              {activeAction && activeAction !== 'vacant' && activeAction !== 'refundOpen' && (
                <>
                  <Text style={styles.sectionLabel}>
                    {activeAction === 'waiting' ? 'Add to Waiting List' : 'Instant Booking'}
                  </Text>

                  {/* Name */}
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Customer Name <Text style={styles.required}>*</Text></Text>
                    <View style={styles.inputWrapper}>
                      <Icon name="account-outline" size={18} color={colors.textSecondary} style={styles.inputIcon} />
                      <TextInput
                        placeholderTextColor={colors.placeholder}
                        style={styles.inputWithIcon}
                        value={customerName}
                        onChangeText={setCustomerName}
                        placeholder="Full Name"
                      />
                    </View>
                  </View>

                  {/* Mobiles */}
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Contact Numbers <Text style={styles.required}>*</Text></Text>
                    {customerMobiles.map((m, i) => (
                      <View key={i} style={styles.mobileNumberEntry}>
                        <View style={styles.mobileNumberHeader}>
                          <Text style={[styles.mobileNumberLabel, { color: colors.textSecondary }]}>
                            Mobile {i + 1}
                          </Text>
                          {customerMobiles.length > 1 && (
                            <TouchableOpacity onPress={() => removeMobile(i)} style={styles.mobileRemoveBtn}>
                              <Icon name="minus" size={15} color="#e53935" />
                            </TouchableOpacity>
                          )}
                        </View>
                        <MobileBoxInput
                          value={m}
                          onChange={(t) => updateMobile(t, i)}
                          colors={colors}
                          isDark={isDark}
                        />
                      </View>
                    ))}
                    {customerMobiles.length < 5 && (
                      <TouchableOpacity onPress={addMobile} style={styles.addMobileBtn}>
                        <Icon name="plus" size={15} color={colors.primary} />
                        <Text style={[styles.addMobileBtnText, { color: colors.primary }]}>Add number</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* Address */}
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Area / Locality <Text style={styles.optional}>(Optional)</Text></Text>
                    <View style={styles.inputWrapper}>
                      <Icon name="map-marker-outline" size={18} color={colors.textSecondary} style={styles.inputIcon} />
                      <TextInput
                        placeholderTextColor={colors.placeholder}
                        style={styles.inputWithIcon}
                        value={customerAddress}
                        onChangeText={setCustomerAddress}
                        placeholder="e.g. Block B, Sector 4"
                      />
                    </View>
                  </View>

                  {/* Photo */}
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Customer Photo <Text style={styles.optional}>(Optional)</Text></Text>
                    <TouchableOpacity style={styles.cameraBtn} onPress={handleCamera}>
                      {photoLocalUri ? (
                        <Image source={{ uri: photoLocalUri }} style={styles.photoPreview} />
                      ) : (
                        <View style={styles.cameraPlaceholder}>
                          <Icon name="camera-outline" size={32} color={colors.placeholder} />
                          <Text style={styles.cameraText}>Tap to capture</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                    {photoLocalUri && (
                      <TouchableOpacity onPress={handleCamera} style={styles.retakeBtn}>
                        <Icon name="camera-retake-outline" size={14} color={colors.text} />
                        <Text style={styles.retakeBtnText}>  Retake Photo</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {activeAction === 'waiting' && (
                    <View style={styles.fieldGroup}>
                      <Text style={styles.fieldLabel}>Remarks <Text style={styles.optional}>(Optional)</Text></Text>
                      <TextInput
                        placeholderTextColor={colors.placeholder}
                        style={[styles.inputWrapper, styles.multilineInput, { paddingHorizontal: 14 }]}
                        value={remarks}
                        onChangeText={setRemarks}
                        placeholder="Notes about this waiting entry..."
                        multiline
                        numberOfLines={3}
                        textAlignVertical="top"
                      />
                    </View>
                  )}

                  {/* Payment — Booked only */}
                  {activeAction === 'booked' && (
                    <View style={styles.paymentCard}>
                      <View style={styles.paymentHeaderRow}>
                        <Icon name="cash-multiple" size={18} color={colors.text} />
                        <Text style={styles.paymentHeader}>  Payment Details</Text>
                      </View>

                      {/* Amount */}
                      <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>Advance / Booking Amount <Text style={styles.required}>*</Text></Text>
                        <View style={styles.inputWrapper}>
                          <Text style={styles.currencySymbol}>Rs.</Text>
                          <TextInput
                            placeholderTextColor={colors.placeholder}
                            style={[styles.inputWithIcon, { flex: 1 }]}
                            value={advanceAmount}
                            onChangeText={setAdvanceAmount}
                            placeholder="Enter amount"
                            keyboardType="numeric"
                          />
                        </View>
                        {!advanceAmount && !adminOverrideGranted && (
                          <TouchableOpacity onPress={() => setShowAdminOverride(!showAdminOverride)} style={styles.overrideLink}>
                            <Icon name="shield-key-outline" size={14} color="#e53935" />
                            <Text style={styles.overrideLinkText}>  No advance? Admin override</Text>
                          </TouchableOpacity>
                        )}
                        {adminOverrideGranted && (
                          <View style={styles.overrideGrantedRow}>
                            <Icon name="check-circle" size={14} color="#388e3c" />
                            <Text style={styles.overrideGranted}>  Override active</Text>
                          </View>
                        )}
                        {showAdminOverride && !adminOverrideGranted && (
                          <View style={styles.overrideBox}>
                            <Text style={styles.overrideLabel}>Admin Password</Text>
                            <View style={styles.mobileRow}>
                              <TextInput
                                placeholderTextColor={colors.placeholder}
                                style={[styles.inputWithIcon, { flex: 1, marginLeft: 0 }]}
                                value={adminPassword}
                                onChangeText={setAdminPassword}
                                placeholder="Enter password"
                                secureTextEntry
                              />
                              <TouchableOpacity onPress={checkAdminOverride} style={[styles.mobileActionBtn, styles.mobileAddBtn]}>
                                <Icon name="check" size={18} color="#fff" />
                              </TouchableOpacity>
                            </View>
                          </View>
                        )}
                      </View>

                      {/* Payment Mode */}
                      <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>Payment Mode <Text style={styles.required}>*</Text></Text>
                        <View style={styles.pillRow}>
                          {PAYMENT_MODES.map(mode => (
                            <TouchableOpacity
                              key={mode}
                              style={[styles.pill, paymentMode === mode && styles.pillActive]}
                              onPress={() => { setPaymentMode(mode); setPaymentTo(''); }}
                            >
                              <Text style={[styles.pillText, paymentMode === mode && styles.pillTextActive]}>{mode}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>

                      {/* Payment To */}
                      {paymentMode && (
                        <View style={styles.fieldGroup}>
                          <Text style={styles.fieldLabel}>{paymentToLabel(paymentMode)}</Text>
                          <View style={styles.inputWrapper}>
                            <Icon name="account-arrow-right-outline" size={18} color={colors.textSecondary} style={styles.inputIcon} />
                            <TextInput
                              placeholderTextColor={colors.placeholder}
                              style={styles.inputWithIcon}
                              value={paymentTo}
                              onChangeText={setPaymentTo}
                              placeholder={paymentToLabel(paymentMode)}
                            />
                          </View>
                        </View>
                      )}

                      {/* Remarks */}
                      <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>Remarks <Text style={styles.optional}>(Optional)</Text></Text>
                        <TextInput
                          placeholderTextColor={colors.placeholder}
                          style={[styles.inputWrapper, styles.multilineInput, { paddingHorizontal: 14 }]}
                          value={remarks}
                          onChangeText={setRemarks}
                          placeholder="Comments..."
                          multiline
                          numberOfLines={3}
                          textAlignVertical="top"
                        />
                      </View>
                    </View>
                  )}

                  {/* Submit Row */}
                  <View style={styles.submitRow}>
                    <TouchableOpacity
                      style={styles.backBtn}
                      onPress={() => {
                        bookedFlowSourceRef.current = null;
                        setActiveAction(null);
                      }}
                    >
                      <Icon name="arrow-left" size={16} color={colors.textSecondary} />
                      <Text style={styles.backBtnText}>  Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.submitBtn, activeAction === 'booked' ? styles.bookedBtn : styles.waitingBtn]}
                      onPress={() => handleSubmit(activeAction)}
                      disabled={isSubmitting || isUploading}
                    >
                      {isSubmitting || isUploading ? (
                        <ActivityIndicator
                          color={activeAction === 'waiting' ? '#0f172a' : '#ffffff'}
                        />
                      ) : (
                        <Text
                          style={[
                            styles.submitBtnText,
                            activeAction === 'waiting' && styles.submitBtnTextOnYellow,
                          ]}
                        >
                          {activeAction === 'booked'
                            ? 'Confirm Booking'
                            : `Add ${nextWaitingOrdinal} waiting`}
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </>
              )}

              <View style={{ height: 8 }} />
            </ScrollView>
            {!activeAction && (
              <View
                style={[
                  styles.quickActionsFooter,
                  {
                    paddingBottom: Math.max(insets.bottom, 12),
                    borderTopColor: colors.border,
                    backgroundColor: isDark ? '#1a1a1a' : '#fafafa',
                  },
                ]}
              >
                <View style={[styles.actionRow, styles.quickActionsFooterInner]}>
                  <Text style={styles.sectionLabel}>Quick Actions</Text>
                  <View style={styles.actionButtons}>
                    {showOpenButton && (
                      <TouchableOpacity style={[styles.actionBtn, styles.openBtn]} onPress={handleOpenPress}>
                        <Icon name="home-outline" size={18} color="#0f172a" />
                        <Text style={styles.actionBtnTextDark}>OPEN</Text>
                      </TouchableOpacity>
                    )}
                    {showWaitlistAndBook && (
                      <TouchableOpacity style={[styles.actionBtn, styles.waitingBtn]} onPress={() => setActiveAction('waiting')}>
                        <Icon name="clock-outline" size={18} color="#0f172a" />
                        <Text style={styles.actionBtnTextDark} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
                          {isBulk ? 'Add Waiting' : `Add ${nextWaitingOrdinal} waiting`}
                        </Text>
                      </TouchableOpacity>
                    )}
                    {showWaitlistAndBook && (
                      <TouchableOpacity style={[styles.actionBtn, styles.bookedBtn]} onPress={onPressFinal}>
                        <Icon name="check-circle-outline" size={18} color="#fff" />
                        <Text style={styles.actionBtnText} numberOfLines={1}>Final</Text>
                      </TouchableOpacity>
                    )}
                    {showBmButton && (
                      <TouchableOpacity style={[styles.actionBtn, styles.bmBtn]} onPress={confirmBM}>
                        <Icon name="shield-lock-outline" size={18} color="#fff" />
                        <Text style={styles.actionBtnText} numberOfLines={1}>BM</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </View>
            )}
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>

    <Modal
      visible={Boolean(removeWaiterId && plot?._id)}
      transparent
      animationType="fade"
      onRequestClose={() => { if (!isRemoving) { setRemoveWaiterId(null); setRemoveWaiterReason(''); } }}
    >
      <View style={styles.removalOverlay}>
        <KeyboardAvoidingView behavior={keyboardAvoidingBehavior()} style={styles.removalKav}>
          <View style={[styles.removalSheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.removalTitle, { color: colors.text }]}>Remove from queue</Text>
            <Text style={[styles.removalSubtitle, { color: colors.textSecondary }]}>
              Enter why this person is being removed. This is stored in the activity log.
            </Text>
            <TextInput
              placeholderTextColor={colors.placeholder}
              style={[styles.removalInput, { borderColor: colors.border, color: colors.text }]}
              value={removeWaiterReason}
              onChangeText={setRemoveWaiterReason}
              placeholder="e.g. Booked elsewhere, not interested, duplicate entry…"
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              editable={!isRemoving}
            />
            <View style={styles.removalActions}>
              <TouchableOpacity
                style={[styles.removalBtnCancel, { borderColor: colors.border }]}
                onPress={() => { if (!isRemoving) { setRemoveWaiterId(null); setRemoveWaiterReason(''); } }}
                disabled={isRemoving}
              >
                <Text style={[styles.removalBtnCancelText, { color: colors.textSecondary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.removalBtnConfirm}
                onPress={confirmRemoveWaiter}
                disabled={isRemoving}
              >
                {isRemoving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.removalBtnConfirmText}>Remove</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>

    <Modal
      visible={Boolean(queueImagePreviewUri)}
      transparent
      animationType="fade"
      onRequestClose={() => setQueueImagePreviewUri(null)}
    >
      <Pressable
        style={styles.queueImagePreviewBackdrop}
        onPress={() => setQueueImagePreviewUri(null)}
        accessibilityRole="button"
        accessibilityLabel="Close full screen image"
      >
        <Image
          source={{ uri: queueImagePreviewUri || undefined }}
          style={styles.queueImagePreviewImage}
          resizeMode="contain"
        />
        <Text style={styles.queueImagePreviewHint}>Tap anywhere to close</Text>
      </Pressable>
    </Modal>

    <Modal
      visible={Boolean(editWaiterId && plot?._id)}
      transparent
      animationType="fade"
      onRequestClose={closeEditWaiter}
    >
      <View style={styles.removalOverlay}>
        <KeyboardAvoidingView behavior={keyboardAvoidingBehavior()} style={styles.removalKav}>
          <View style={[styles.removalSheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.removalTitle, { color: colors.text }]}>Edit Waiting Details</Text>
            <Text style={[styles.removalSubtitle, { color: colors.textSecondary }]}>
              Same layout as Add Waiting — add/remove rows for extra numbers (up to 5).
            </Text>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={styles.editWaiterScroll}
            >
              <Text style={[styles.fieldLabel, { marginLeft: 0 }]}>Customer Name</Text>
              <View style={[styles.inputWrapper, { marginBottom: 12 }]}>
                <Icon name="account-outline" size={18} color={colors.textSecondary} style={styles.inputIcon} />
                <TextInput
                  placeholderTextColor={colors.placeholder}
                  style={styles.inputWithIcon}
                  value={editWaiterName}
                  onChangeText={setEditWaiterName}
                  placeholder="Full Name"
                  editable={!isEditingWaiter}
                />
              </View>

              <Text style={[styles.fieldLabel, { marginLeft: 0 }]}>Contact Numbers</Text>
              {editWaiterMobiles.map((m, i) => (
                <View key={i} style={styles.mobileNumberEntry}>
                  <View style={styles.mobileNumberHeader}>
                    <Text style={[styles.mobileNumberLabel, { color: colors.textSecondary }]}>
                      Mobile {i + 1}
                    </Text>
                    {editWaiterMobiles.length > 1 && (
                      <TouchableOpacity
                        onPress={() => removeEditWaiterMobile(i)}
                        style={styles.mobileRemoveBtn}
                        disabled={isEditingWaiter}
                      >
                        <Icon name="minus" size={15} color="#e53935" />
                      </TouchableOpacity>
                    )}
                  </View>
                  <MobileBoxInput
                    value={m}
                    onChange={(t) => updateEditWaiterMobile(t, i)}
                    colors={colors}
                    isDark={isDark}
                    editable={!isEditingWaiter}
                  />
                </View>
              ))}
              {editWaiterMobiles.length < 5 && (
                <TouchableOpacity
                  onPress={addEditWaiterMobile}
                  style={styles.addMobileBtn}
                  disabled={isEditingWaiter}
                >
                  <Icon name="plus" size={15} color={colors.primary} />
                  <Text style={[styles.addMobileBtnText, { color: colors.primary }]}>Add number</Text>
                </TouchableOpacity>
              )}

              <Text style={[styles.fieldLabel, { marginLeft: 0 }]}>Area / Locality</Text>
              <View style={[styles.inputWrapper, { marginBottom: 12 }]}>
                <Icon name="map-marker-outline" size={18} color={colors.textSecondary} style={styles.inputIcon} />
                <TextInput
                  placeholderTextColor={colors.placeholder}
                  style={styles.inputWithIcon}
                  value={editWaiterAddress}
                  onChangeText={setEditWaiterAddress}
                  placeholder="e.g. Block B, Sector 4"
                  editable={!isEditingWaiter}
                />
              </View>

              <Text style={[styles.fieldLabel, { marginLeft: 0 }]}>Remarks</Text>
              <TextInput
                placeholderTextColor={colors.placeholder}
                style={[styles.removalInput, { borderColor: colors.border, color: colors.text, marginBottom: 4 }]}
                value={editWaiterRemarks}
                onChangeText={setEditWaiterRemarks}
                placeholder="Any comments or notes..."
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                editable={!isEditingWaiter}
              />
            </ScrollView>

            <View style={styles.removalActions}>
              <TouchableOpacity
                style={[styles.removalBtnCancel, { borderColor: colors.border }]}
                onPress={closeEditWaiter}
                disabled={isEditingWaiter}
              >
                <Text style={[styles.removalBtnCancelText, { color: colors.textSecondary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.removalBtnSave}
                onPress={saveEditWaiter}
                disabled={isEditingWaiter}
              >
                {isEditingWaiter ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.removalBtnConfirmText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
    </>
  );
};

const getStyles = (colors, isDark) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  kav: { width: '100%' },
  sheet: {
    backgroundColor: isDark ? '#1a1a1a' : '#fafafa',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    width: '100%',
    flexDirection: 'column',
    elevation: 20,
  },
  header: {
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingVertical: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  plotTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#f8fafc',
    letterSpacing: 0.3,
  },
  statusBadge: {
    marginTop: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 3,
    borderRadius: 20,
  },
  statusBadgeText: {
    fontWeight: '700',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  closeX: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bodyScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  bodyContent: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 8,
  },
  quickActionsFooter: {
    borderTopWidth: StyleSheet.hairlineWidth,
    flexShrink: 0,
  },
  quickActionsFooterInner: {
    marginBottom: 0,
    paddingTop: 4,
  },
  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
    elevation: 2,
  },
  bookedSummaryOuter: {
    marginBottom: 16,
  },
  /** Booked-plot customer card only: green tint so “booked” reads at a glance */
  bookedDetailsCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(74, 222, 128, 0.42)' : 'rgba(56, 142, 60, 0.4)',
    backgroundColor: isDark ? 'rgba(34, 197, 94, 0.14)' : 'rgba(76, 175, 80, 0.16)',
    overflow: 'hidden',
    marginBottom: 14,
  },
  bookedPhotoStrip: {
    backgroundColor: isDark ? 'rgba(34, 197, 94, 0.12)' : 'rgba(76, 175, 80, 0.22)',
  },
  summaryHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  summaryHeader: {
    fontWeight: '900',
    fontSize: 12,
    color: colors.text,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  metaText: { fontSize: 11, color: colors.textSecondary, fontWeight: '600' },
  summaryRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  summaryIcon: { marginTop: 2, marginRight: 8 },
  summaryValue: { fontSize: 15, color: colors.text, fontWeight: '600', flex: 1, lineHeight: 22 },
  divider: {
    height: 1.5,
    backgroundColor: isDark ? '#334155' : '#f0f0f0',
    marginVertical: 14,
  },
  existingPhoto: { width: 100, height: 100, borderRadius: 12, marginTop: 14, alignSelf: 'flex-start' },
  createdByText: {
    fontSize: 10,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  createdByRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    marginTop: 10,
    flexWrap: 'wrap',
  },
  
  // QUEUE STYLES (waiting list in modal)
  queueSectionTitle: {
    fontWeight: '900',
    fontSize: 15,
    color: colors.text,
    letterSpacing: 0.3,
    marginBottom: 14,
    textTransform: 'uppercase',
  },
  queueItem: { flexDirection: 'row', alignItems: 'stretch', gap: 10, marginBottom: 2 },
  queueLevel: { width: 36, alignItems: 'center', paddingTop: 6 },
  queueBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#f9a825',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  queueBadgeText: { color: '#0f172a', fontSize: 14, fontWeight: '900' },
  queueLine: {
    width: 3,
    flex: 1,
    minHeight: 16,
    backgroundColor: colors.border,
    marginVertical: 4,
    borderRadius: 2,
  },
  queueCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: isDark ? '#1e293b' : '#f8fafc',
    overflow: 'hidden',
    marginBottom: 14,
  },
  queuePhotoTouchable: {
    width: '100%',
    height: 120,
    backgroundColor: isDark ? '#0f172a' : '#e2e8f0',
  },
  queuePhotoTouchablePressed: { opacity: 0.9 },
  queuePhotoTop: { width: '100%', height: 120, resizeMode: 'cover' },
  queuePhotoOverlay: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 22,
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  queueCardInner: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14 },
  queueTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 8,
  },
  queueOrderText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.textSecondary,
    letterSpacing: 0.5,
    flex: 1,
  },
  queueFieldLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.65,
    marginTop: 2,
  },
  queueFieldLabelSpaced: { marginTop: 14 },
  queueFieldValue: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
    lineHeight: 24,
    marginTop: 5,
  },
  queueFieldValueMono: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: 0.4,
    flex: 1,
    lineHeight: 26,
  },
  queueMobileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    gap: 8,
  },
  queueActionIcons: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  queueIconBtn: { padding: 8, borderRadius: 12 },
  queueInlineCall: {
    minWidth: 48,
    minHeight: 48,
    paddingHorizontal: 10,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: isDark ? 'rgba(21,101,192,0.22)' : '#e3f2fd',
  },
  queuePaymentHint: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: 6,
  },
  queuePaymentText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    lineHeight: 21,
  },
  queueMetaFooter: {
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  queueMetaFooterRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    gap: 10,
  },
  queueMetaLeft: {
    flex: 1,
    minWidth: 0,
  },
  queueAddedWhen: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    lineHeight: 21,
  },
  queueAddedByRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 10,
    gap: 8,
  },
  queueAddedByLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  queueAddedByName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    flexShrink: 1,
  },
  makeFinalBtnCompact: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 6,
    width: 52,
    alignSelf: 'stretch',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#2e7d32',
    backgroundColor: isDark ? 'rgba(46, 125, 50, 0.18)' : '#e8f5e9',
    flexShrink: 0,
  },
  makeFinalBtnCompactText: {
    fontSize: 11,
    fontWeight: '800',
    color: isDark ? '#81c784' : '#1b5e20',
    letterSpacing: 0.2,
  },
  queueImagePreviewBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.94)',
    justifyContent: 'center',
    alignItems: 'stretch',
    paddingHorizontal: 8,
    paddingVertical: 36,
  },
  queueImagePreviewImage: {
    width: '100%',
    flex: 1,
    minHeight: 280,
  },
  queueImagePreviewHint: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 14,
    textAlign: 'center',
    paddingHorizontal: 16,
  },

  removalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  removalKav: { width: '100%' },
  removalSheet: {
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    maxWidth: 400,
    alignSelf: 'center',
    width: '100%',
  },
  removalTitle: { fontSize: 18, fontWeight: '800', marginBottom: 6 },
  removalSubtitle: { fontSize: 13, lineHeight: 19, marginBottom: 14 },
  editWaiterScroll: { maxHeight: 420 },
  removalInput: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 100,
    fontSize: 15,
    marginBottom: 16,
  },
  removalActions: { flexDirection: 'row', gap: 12 },
  removalBtnCancel: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  removalBtnCancelText: { fontWeight: '800', fontSize: 15 },
  removalBtnConfirm: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#c62828',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removalBtnSave: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#1565c0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removalBtnConfirmText: { color: '#fff', fontWeight: '900', fontSize: 15 },

  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 16,
    marginLeft: 4,
  },
  actionRow: { marginBottom: 12 },
  actionButtons: { flexDirection: 'row', gap: 10 },
  actionBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    gap: 5,
    elevation: 2,
    shadowColor: colors.text,
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  actionBtnText: { fontWeight: '800', fontSize: 11, color: '#ffffff', textAlign: 'center', width: '100%' },
  actionBtnTextDark: { fontWeight: '800', fontSize: 11, color: '#0f172a', textAlign: 'center', width: '100%' },
  openBtn: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: isDark ? '#64748b' : '#1a1a2e',
  },
  openBtnSolid: {
    backgroundColor: '#ffeb3b',
    borderWidth: 0,
  },
  refundIntro: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 10,
    marginLeft: 4,
    lineHeight: 19,
  },
  refundHint: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: 12,
    marginLeft: 4,
  },
  waitingBtn: { backgroundColor: '#ffeb3b' },
  bookedBtn: { backgroundColor: '#2e7d32' },
  bmBtn: { backgroundColor: '#0ea5e9' },
  
  fieldGroup: { marginBottom: 18 },
  fieldLabel: { fontSize: 13, fontWeight: '800', color: colors.text, marginBottom: 8, marginLeft: 2 },
  required: { color: '#d32f2f' },
  optional: { fontWeight: '400', color: colors.textSecondary, fontSize: 11 },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: isDark ? '#3f3f46' : '#eeeeee',
    borderRadius: 14,
    paddingHorizontal: 4,
  },
  inputIcon: { marginHorizontal: 12 },
  inputWithIcon: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
    paddingVertical: 12,
    fontWeight: '500',
  },
  currencySymbol: { fontSize: 14, fontWeight: '800', color: colors.textSecondary, marginHorizontal: 14 },
  mobileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 14,
    marginBottom: 10,
  },
  mobileActionBtn: {
    width: 44,
    height: 44,
    margin: 4,
    borderRadius: 12,
    backgroundColor: isDark ? '#2d1518' : '#fff5f5',
    borderWidth: 1,
    borderColor: isDark ? '#5c2a30' : '#ffebee',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mobileAddBtn: { backgroundColor: '#1a1a2e', borderColor: '#1a1a2e' },
  mobileNumberEntry: {
    marginBottom: 12,
  },
  mobileNumberHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  mobileNumberLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  mobileRemoveBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: isDark ? '#2d1518' : '#fff5f5',
    borderWidth: 1,
    borderColor: isDark ? '#5c2a30' : '#ffcdd2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addMobileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 2,
    marginTop: 2,
  },
  addMobileBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  cameraBtn: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderStyle: 'dashed',
    backgroundColor: isDark ? '#262626' : '#fdfdfd',
  },
  cameraPlaceholder: { height: 110, justifyContent: 'center', alignItems: 'center', gap: 10 },
  cameraText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  photoPreview: { width: '100%', height: 200, resizeMode: 'cover' },
  retakeBtn: { flexDirection: 'row', alignItems: 'center', marginTop: 10, alignSelf: 'flex-end' },
  retakeBtnText: { color: colors.primary, fontWeight: '800', fontSize: 13 },
  paymentCard: {
    backgroundColor: isDark ? '#1e293b' : '#f8faff',
    borderRadius: 18,
    padding: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: isDark ? '#334155' : '#e8efff',
  },
  paymentHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  paymentHeader: {
    fontWeight: '900',
    fontSize: 16,
    color: colors.text,
    letterSpacing: 0.5,
  },
  overrideLink: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  overrideLinkText: { color: '#d32f2f', fontSize: 12, fontWeight: '700' },
  overrideGrantedRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  overrideGranted: { color: '#43a047', fontWeight: '800', fontSize: 13 },
  overrideBox: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginTop: 12, borderWidth: 1, borderColor: '#ffe082' },
  overrideLabel: { fontWeight: '800', color: '#ff8f00', fontSize: 12, marginBottom: 10 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  pillActive: { borderColor: '#1a1a2e', backgroundColor: '#1a1a2e' },
  pillText: { fontSize: 13, color: colors.textSecondary, fontWeight: '700' },
  pillTextActive: { color: '#f8fafc' },
  multilineInput: {
    minHeight: 100,
    paddingTop: 14,
    paddingHorizontal: 16,
    color: colors.text,
  },
  submitRow: { flexDirection: 'row', gap: 12, marginTop: 12 },
  backBtn: { 
    flexDirection: 'row', alignItems: 'center', paddingVertical: 15, paddingHorizontal: 20,
    borderRadius: 16, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface
  },
  backBtnText: { color: colors.textSecondary, fontWeight: '800', fontSize: 14 },
  submitBtn: { flex: 1, paddingVertical: 15, borderRadius: 16, alignItems: 'center' },
  submitBtnText: { fontWeight: '900', fontSize: 15, color: '#ffffff' },
  submitBtnTextOnYellow: { color: '#0f172a' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerActionBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerActionBtnActive: {
    backgroundColor: '#2A9D8F',
  },
  historyContainer: {
    paddingBottom: 20,
  },
  historyHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  historyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
  emptyHistory: {
    textAlign: 'center',
    color: colors.textSecondary,
    marginVertical: 30,
    fontSize: 14,
  },
  historyItem: {
    flexDirection: 'row',
    gap: 15,
  },
  historyDotContainer: {
    width: 20,
    alignItems: 'center',
  },
  historyDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#2A9D8F',
    marginTop: 5,
  },
  historyLine: {
    width: 2,
    flex: 1,
    backgroundColor: colors.border,
    marginVertical: 5,
  },
  historyContent: {
    flex: 1,
    paddingBottom: 20,
  },
  historyItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  historyAction: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  historyTime: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  historyDetails: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 4,
  },
  historyByRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginTop: 4,
  },
  historyAvatar: { marginHorizontal: 4 },
  historyRefundBlock: { marginTop: 4 },
  historyRefundRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginTop: 8,
  },
  historyRefund: {
    fontSize: 12,
    color: colors.text,
    lineHeight: 17,
    fontWeight: '600',
  },
  historyBackBtn: {
    marginTop: 10,
    paddingVertical: 15,
    borderRadius: 12,
    backgroundColor: isDark ? '#334155' : '#f0f0f0',
    alignItems: 'center',
  },
  historyBackBtnText: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 14,
  },
});

export default BookingModal;
