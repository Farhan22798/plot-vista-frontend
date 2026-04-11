import React, { useState, useEffect, useRef, useContext, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Text,
  Image,
  Dimensions,
  Platform,
  AppState,
  InteractionManager,
  Share as NativeShare,
  Modal,
  TextInput,
  ScrollView,
  Pressable,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import Svg from 'react-native-svg';
import { ReactNativeZoomableView } from '@openspacelabs/react-native-zoomable-view';
import { captureRef } from 'react-native-view-shot';
import Share from 'react-native-share';
import dayjs from 'dayjs';
import Icon from 'react-native-vector-icons/MaterialIcons';
import PlotPolygon from '../components/PlotPolygon';
import BookingModal from '../components/BookingModal';
import LayoutShareCapture from '../components/LayoutShareCapture';
import api, { backupApi } from '../services/api';
import socket from '../services/socket';
import { useAlert } from '../context/AlertContext';
import { useTheme } from '../context/ThemeContext';
import { AuthContext } from '../context/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import { getTransferTargetValidationError } from '../utils/transferTargetValidation';
import { useOnAppForeground } from '../hooks/useOnAppForeground';
import {
  SITE_NAME,
  SITE_TAGLINE,
  LOCATION_SHARE_MESSAGE,
} from '../constants/siteBranding.js';
import { CometChat } from '@cometchat/chat-sdk-react-native';
import { mapCaptureRegistry } from '../utils/mapCaptureRef';
import { getCometChatCommunityGroupId } from '../config/cometchatSettings';
import { initCometChatOnce } from '../services/cometchatLifecycle';
import { sendActivitySummaryMessage } from '../services/cometchatActivitySummary';
import { buildNoteActivitySummaryText } from '../utils/activitySummaryMessages';
import { devLog } from '../utils/devLog';
import { toOrdinal } from '../utils/formatting';
import { isBiometricAvailable, promptBiometric } from '../utils/biometricAuth';

// Stable — derived from env/config, never changes at runtime
const COMMUNITY_GUID = getCometChatCommunityGroupId();

function formatActionDateTime(date = new Date()) {
  return dayjs(date).format('DD/MM/YYYY hh:mm A');
}

function formatAmount(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return '-';
  return `Rs. ${n.toLocaleString()}`;
}

/** Before vacating, read booking / waiting from plot; merge with refund / removal payload for notifications. */
function deriveVacantActivityContext(plot, payload) {
  if (!plot || !payload || payload.status !== 'vacant') return {};
  if (plot.status === 'booked' && plot.bookingDetails) {
    const bd = plot.bookingDetails;
    return {
      customerName: String(bd.customerName || '').trim() || '-',
      refundMode: String(payload.refundMode || '').trim(),
      refundAmount: payload.refundAmount,
      refundBy: String(payload.refundBy || '').trim(),
      refundRemarks: String(payload.refundRemarks || '').trim(),
    };
  }
  if (plot.status === 'waiting' && Array.isArray(plot.waitingList) && plot.waitingList.length > 0) {
    const names = plot.waitingList
      .map((w) => String(w.customerName || '').trim())
      .filter(Boolean);
    return {
      customerName: names.length ? names.join(', ') : '-',
      removalRemarks: String(payload.removalRemarks || '').trim(),
    };
  }
  return {
    customerName: '-',
    removalRemarks: String(payload.removalRemarks || '').trim(),
  };
}

function buildStatusActivityMessage({
  status,
  plotNumber,
  customerName,
  waitingOrdinal,
  advanceAmount,
  paymentTo,
  paymentMode,
  actor,
  at,
  refundMode,
  refundAmount,
  refundBy,
  refundRemarks,
  removalRemarks,
}) {
  const plotLabel = `Plot No. ${plotNumber}`;
  const actorLabel = actor || 'Owner';
  const when = at || formatActionDateTime();
  const customer = String(customerName || '').trim() || '-';

  if (status === 'waiting') {
    const ord = waitingOrdinal || '1st';
    return `${plotLabel}, ${customer}, ${ord} Waiting, added by ${actorLabel} on ${when}.`;
  }
  if (status === 'booked') {
    const paidTo = String(paymentTo || '').trim() || '-';
    const paidVia = String(paymentMode || '').trim() || '-';
    const amount = formatAmount(advanceAmount);
    return `${plotLabel}, ${customer}, Final, Booking details: ${amount} paid to ${paidTo} via ${paidVia}, by ${actorLabel} on ${when}.`;
  }
  if (status === 'vacant') {
    const parts = [`${plotLabel} marked OPEN`];
    if (customer && customer !== '-') {
      parts.push(`cleared: ${customer}`);
    }
    const rm = String(refundMode || '').trim();
    if (rm) {
      parts.push(
        `Refund ${formatAmount(refundAmount)} via ${rm}${
          refundBy ? ` (recorded by ${refundBy})` : ''
        }`,
      );
      const rr = String(refundRemarks || '').trim();
      if (rr) {
        parts.push(rr.length > 180 ? `Refund notes: ${rr.slice(0, 177)}…` : `Refund notes: ${rr}`);
      }
    }
    const wr = String(removalRemarks || '').trim();
    if (wr) {
      parts.push(
        wr.length > 180 ? `Waiting cancel / notes: ${wr.slice(0, 177)}…` : `Waiting cancel / notes: ${wr}`,
      );
    }
    parts.push(`by ${actorLabel} on ${when}.`);
    return parts.join('. ');
  }
  if (status === 'BM') {
    return `${plotLabel} reserved for BM by ${actorLabel} on ${when}.`;
  }
  return `${plotLabel} updated by ${actorLabel} on ${when}.`;
}

const MAP_MARGIN_H = 18;
const MAP_CARD_PADDING = 10;
const MAP_BORDER = 2;

/** Legend pills: tap to filter the map (Open = count only, map unchanged). */
const LAYOUT_LEGEND = [
  { filterKey: 'booked', countKey: 'booked', color: '#2e7d32', label: 'Booked', border: null },
  { filterKey: 'waiting', countKey: 'waiting', color: '#ffeb3b', label: 'Waiting', border: null },
  { filterKey: 'waiting_multi', countKey: 'waitingMulti', color: '#f97316', label: 'Multiple Waiting', border: null },
  { filterKey: 'BM', countKey: 'bm', color: '#0ea5e9', label: 'Reserved BM', border: null },
  { filterKey: 'open', countKey: 'open', color: '#ffffff', label: 'Open', border: '#94a3b8' },
];

const LAYOUT_LEGEND_ROWS = [LAYOUT_LEGEND.slice(0, 3), LAYOUT_LEGEND.slice(3, 5)];
const ADMIN_OVERRIDE_PASSWORD = '8811';

const LayoutScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  const { isDark, colors } = useTheme();
  const styles = React.useMemo(() => getStyles(colors, isDark), [colors, isDark]);
  const { showAlert } = useAlert();
  const {
    userInfo,
    temporaryGuestModeEnabled,
    enableTemporaryGuestMode,
    disableTemporaryGuestMode,
  } = useContext(AuthContext);
  const { canEdit, canUseChat, canBulkSelect, canViewDetails, isGuest } = usePermissions();
  const [plots, setPlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [selectedPlot, setSelectedPlot] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);

  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedPlots, setSelectedPlots] = useState([]);

  const [shareMeta, setShareMeta] = useState(null);
  const [shareBusy, setShareBusy] = useState(false);

  const [unreadCount, setUnreadCount] = useState(0);
  const [showGuestEnableModal, setShowGuestEnableModal] = useState(false);
  const [showGuestDisableModal, setShowGuestDisableModal] = useState(false);
  const [guestDisableUsePassword, setGuestDisableUsePassword] = useState(false);
  const [guestDisablePassword, setGuestDisablePassword] = useState('');

  /** null | 'booked' | 'waiting' | 'waiting_multi' | 'BM' | 'open' — open = counts only, no map dimming */
  const [mapStatusFilter, setMapStatusFilter] = useState(null);
  const [mapFilterModalVisible, setMapFilterModalVisible] = useState(false);

  /** Booking sheet: user chose to pick transfer destination by tapping the layout */
  const [transferMapPick, setTransferMapPick] = useState(null);
  const [pendingTransferTargetPlot, setPendingTransferTargetPlot] = useState(null);

  const innerViewRef = useRef(null);
  const shareCaptureRef = useRef(null);
  /** After viewing Plot details from the booking sheet, reopen the same sheet on back. */
  const reopenBookingModalRef = useRef(false);
  /** Suppresses the onSingleTap that fires immediately after a long-press lift. */
  const suppressNextTapRef = useRef(false);
  /** Tracks latest userName without creating stale closures in mapCaptureRegistry. */
  const userNameForCaptureRef = useRef(userInfo?.name);
  /** Timestamp (ms) of the last successful map snapshot upload. Throttles to max once per 30 min. */
  const lastSnapshotAtRef = useRef(0);

  const screenWidth = Dimensions.get('window').width;
  const innerMapWidth =
    screenWidth -
    MAP_MARGIN_H * 2 -
    MAP_CARD_PADDING * 2 -
    MAP_BORDER * 2;
  const renderWidth = Math.max(200, innerMapWidth);
  const renderHeight = renderWidth * (2480 / 3509);

  const layoutCounts = useMemo(() => {
    let booked = 0;
    let waiting = 0;
    let waitingMulti = 0;
    let bm = 0;
    let open = 0;
    for (const p of plots) {
      if (p.status === 'booked') booked += 1;
      else if (p.status === 'BM') bm += 1;
      else if (p.status === 'vacant') open += 1;
      else if (p.status === 'waiting') {
        waiting += 1;
        if ((p.waitingList?.length || 0) > 1) waitingMulti += 1;
      }
    }
    return { booked, waiting, waitingMulti, bm, open };
  }, [plots]);

  const filterBannerLine = useMemo(() => {
    if (!mapStatusFilter) return '';
    const item = LAYOUT_LEGEND.find((x) => x.filterKey === mapStatusFilter);
    if (!item) return '';
    const n = layoutCounts[item.countKey];
    return `${item.label} · ${n} plot${n === 1 ? '' : 's'}`;
  }, [mapStatusFilter, layoutCounts]);

  const refreshUnread = useCallback(async () => {
    try {
      const loggedIn = await CometChat.getLoggedinUser();
      if (!loggedIn) return;
      const countMap = await CometChat.getUnreadMessageCountForGroup(COMMUNITY_GUID);
      setUnreadCount(Number(countMap?.[COMMUNITY_GUID] ?? 0));
    } catch (_) {
      // CometChat not ready or not logged in — silently ignore
    }
  }, []);

  // Keep userName ref in sync so the capture closure is never stale.
  useEffect(() => {
    userNameForCaptureRef.current = userInfo?.name;
  }, [userInfo?.name]);

  // Register a silent map-capture function into the module-level registry so
  // ProfileScreen (and the backup flow) can capture the layout image without
  // navigating here or lifting state all the way up.
  useEffect(() => {
    mapCaptureRegistry.capture = async () => {
      setShareMeta({ at: new Date(), by: userNameForCaptureRef.current || 'Backup' });
      // Give React/native a frame to render the off-screen LayoutShareCapture.
      await new Promise((r) =>
        setTimeout(r, Platform.OS === 'android' ? 150 : 100),
      );
      const base64 = await captureRef(shareCaptureRef, {
        format: 'jpg',
        quality: 0.85,
        result: 'base64',
      });
      setShareMeta(null);
      return base64;
    };
    return () => {
      mapCaptureRegistry.capture = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Set up real-time message listener once CometChat is ready.
  // Any incoming group message triggers a count refresh.
  useEffect(() => {
    const LISTENER_KEY = 'LAYOUT_UNREAD_BADGE';
    let cancelled = false;

    initCometChatOnce().then((ok) => {
      if (!ok || cancelled) return;
      refreshUnread();
      CometChat.addMessageListener(
        LISTENER_KEY,
        new CometChat.MessageListener({
          onTextMessageReceived: () => refreshUnread(),
          onMediaMessageReceived: () => refreshUnread(),
          onCustomMessageReceived: () => refreshUnread(),
        }),
      );
    });

    return () => {
      cancelled = true;
      CometChat.removeMessageListener(LISTENER_KEY);
    };
  }, [refreshUnread]);

  const fetchPlots = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const response = await api.get('/');
      setPlots(response.data);

      // After plots load, silently push a map snapshot to the backend so the
      // 6-hourly scheduled backup always has a recent image even if no manual
      // backup has been triggered. Throttled to max once every 30 minutes.
      const THIRTY_MIN = 30 * 60 * 1000;
      if (Date.now() - lastSnapshotAtRef.current > THIRTY_MIN) {
        // Run entirely in the background — never block or alert on failure.
        setTimeout(async () => {
          try {
            const base64 = await mapCaptureRegistry.capture?.();
            if (!base64) return;
            await backupApi.post('/map-snapshot', { mapImageBase64: base64 });
            lastSnapshotAtRef.current = Date.now();
          } catch (_) {
            // Silent — snapshot failure must never affect the user experience.
          }
        }, 2000); // 2s delay gives React time to finish rendering before capture
      }
    } catch (error) {
      showAlert('Error', `Could not fetch layout data: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [showAlert]);

  useFocusEffect(
    useCallback(() => {
      const openId = route.params?.openBookingForPlotId;
      if (openId && plots.length > 0) {
        const p = plots.find((x) => x._id === openId);
        // Always clear the param regardless of whether the plot was found,
        // to prevent the stale param from re-triggering on subsequent focuses.
        navigation.setParams({ openBookingForPlotId: undefined });
        if (p) {
          setSelectedPlot(p);
          setModalVisible(true);
        }
        return undefined;
      }
      if (reopenBookingModalRef.current && selectedPlot?._id && plots.length > 0) {
        const fresh = plots.find((x) => x._id === selectedPlot._id);
        if (fresh) setSelectedPlot(fresh);
        setModalVisible(true);
        reopenBookingModalRef.current = false;
      }
      return undefined;
    }, [route.params?.openBookingForPlotId, plots, navigation, selectedPlot])
  );

  useFocusEffect(
    useCallback(() => {
      fetchPlots(true);
      refreshUnread();
      return undefined;
    }, [fetchPlots, refreshUnread])
  );

  // Socket events are not delivered while the app is suspended; reconnect and
  // pull fresh plot data when returning from lock / background / inactive.
  useOnAppForeground(
    useCallback(() => {
      if (!socket.connected) socket.connect();
      fetchPlots(true);
      refreshUnread();
    }, [fetchPlots, refreshUnread])
  );

  useEffect(() => {
    socket.connect();
    const onPlotUpdated = (updatedPlot) => {
      setPlots((prevPlots) => {
        const idx = prevPlots.findIndex((p) => p._id === updatedPlot._id);
        if (idx === -1) return prevPlots;
        const next = [...prevPlots];
        next[idx] = updatedPlot;
        return next;
      });
      setSelectedPlot((prevSelected) =>
        prevSelected?._id === updatedPlot._id ? updatedPlot : prevSelected
      );
      setSelectedPlots((prevSelectedPlots) =>
        prevSelectedPlots.map((p) =>
          p._id === updatedPlot._id ? updatedPlot : p
        )
      );
    };
    socket.on('plotUpdated', onPlotUpdated);

    return () => {
      socket.off('plotUpdated', onPlotUpdated);
    };
  }, []);

  // Keep modal data in sync with latest `plots` array updates.
  useEffect(() => {
    if (!selectedPlot?._id || plots.length === 0) return;
    const freshSelected = plots.find((p) => p._id === selectedPlot._id);
    if (freshSelected && freshSelected !== selectedPlot) {
      setSelectedPlot(freshSelected);
    }
  }, [plots, selectedPlot, selectedPlot?._id]);

  const handleOpenPlotDetailsFromModal = () => {
    if (!selectedPlot?._id) return;
    reopenBookingModalRef.current = true;
    setModalVisible(false);
    navigation.navigate('PlotDetails', { plotId: selectedPlot._id });
  };

  const hitTestPlot = useCallback(
    (tapPageX, tapPageY, callback) => {
      if (!innerViewRef.current) return;
      innerViewRef.current.measure((x, y, width, height, viewPageX, viewPageY) => {
        const scaledX = ((tapPageX - viewPageX) / width) * 3509;
        const scaledY = ((tapPageY - viewPageY) / height) * 2480;

        let clickedPlot = null;
        for (const plot of plots) {
          let isInside = false;
          const coords = plot.coordinates;
          for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
            const xi = coords[i].x;
            const yi = coords[i].y;
            const xj = coords[j].x;
            const yj = coords[j].y;
            const intersect =
              yi > scaledY !== yj > scaledY &&
              scaledX < ((xj - xi) * (scaledY - yi)) / (yj - yi) + xi;
            if (intersect) isInside = !isInside;
          }
          if (isInside) {
            clickedPlot = plot;
            break;
          }
        }
        callback(clickedPlot);
      });
    },
    [plots],
  );

  const handleSingleTap = (event) => {
    if (!canViewDetails) return;
    if (suppressNextTapRef.current) {
      suppressNextTapRef.current = false;
      return;
    }
    const { pageX: tapPageX, pageY: tapPageY } = event.nativeEvent;
    hitTestPlot(tapPageX, tapPageY, (clickedPlot) => {
      if (!clickedPlot) return;

      if (transferMapPick) {
        const source = selectedPlot;
        if (!source?._id) {
          setTransferMapPick(null);
          setModalVisible(true);
          return;
        }
        const err = getTransferTargetValidationError(source, clickedPlot, transferMapPick.kind);
        if (err) {
          showAlert('Not allowed', err);
          return;
        }
        const fresh = plots.find((p) => p._id === clickedPlot._id) || clickedPlot;
        setPendingTransferTargetPlot(fresh);
        setTransferMapPick(null);
        setModalVisible(true);
        return;
      }

      if (isGuest) {
        navigation.navigate('PlotDetails', { plotId: clickedPlot._id });
        return;
      }
      if (isMultiSelectMode) {
        setSelectedPlots((prev) => {
          if (prev.find((p) => p._id === clickedPlot._id)) {
            return prev.filter((p) => p._id !== clickedPlot._id);
          }
          return [...prev, clickedPlot];
        });
      } else {
        setSelectedPlot(clickedPlot);
        setModalVisible(true);
      }
    });
  };

  const handleLongPress = (event) => {
    if (transferMapPick) return;
    if (!canBulkSelect) return;
    suppressNextTapRef.current = true;
    const { pageX: tapPageX, pageY: tapPageY } = event.nativeEvent;
    hitTestPlot(tapPageX, tapPageY, (clickedPlot) => {
      if (!clickedPlot) {
        suppressNextTapRef.current = false;
        return;
      }
      if (!isMultiSelectMode) {
        setIsMultiSelectMode(true);
        setSelectedPlots([clickedPlot]);
      } else {
        setSelectedPlots((prev) => {
          if (prev.find((p) => p._id === clickedPlot._id)) {
            return prev.filter((p) => p._id !== clickedPlot._id);
          }
          return [...prev, clickedPlot];
        });
      }
    });
  };

  const handleUpdate = async (payload) => {
    try {
      setIsSubmitting(true);
      const actor = String(userInfo?.name || userInfo?.mobileNumber || 'User').trim();
      const at = formatActionDateTime();
      if (isMultiSelectMode && selectedPlots.length > 0) {
        const plotIds = selectedPlots.map((p) => p._id);
        await api.patch('/bulk', { plotIds, ...payload });
        selectedPlots.forEach((p) => {
          const waitingOrdinal =
            payload?.status === 'waiting'
              ? toOrdinal((p?.waitingList?.length || 0) + 1)
              : undefined;
          const vacCtx =
            payload?.status === 'vacant' ? deriveVacantActivityContext(p, payload) : {};
          const msg = buildStatusActivityMessage({
            status: payload?.status,
            plotNumber: p?.plotNumber,
            customerName: payload?.customerName || vacCtx.customerName,
            waitingOrdinal,
            advanceAmount: payload?.advanceAmount,
            paymentTo: payload?.paymentTo,
            paymentMode: payload?.paymentMode,
            actor,
            at,
            ...vacCtx,
          });
          sendActivitySummaryMessage(msg).catch(() => {});
        });
        setSelectedPlots([]);
        setIsMultiSelectMode(false);
      } else if (selectedPlot) {
        await api.patch(`/${selectedPlot._id}`, payload);
        const waitingOrdinal =
          payload?.status === 'waiting'
            ? toOrdinal((selectedPlot?.waitingList?.length || 0) + 1)
            : undefined;
        const vacCtx =
          payload?.status === 'vacant'
            ? deriveVacantActivityContext(selectedPlot, payload)
            : {};
        const msg = buildStatusActivityMessage({
          status: payload?.status,
          plotNumber: selectedPlot?.plotNumber,
          customerName: payload?.customerName || vacCtx.customerName,
          waitingOrdinal,
          advanceAmount: payload?.advanceAmount,
          paymentTo: payload?.paymentTo,
          paymentMode: payload?.paymentMode,
          actor,
          at,
          ...vacCtx,
        });
        sendActivitySummaryMessage(msg).catch(() => {});
      }
      setModalVisible(false);
      setSelectedPlot(null);
    } catch (error) {
      showAlert(
        'Update Failed',
        error.response?.data?.message || 'Could not update plot.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleActivitySummary = useCallback((message) => {
    const actor = String(userInfo?.name || userInfo?.mobileNumber || 'User').trim();
    const at = formatActionDateTime();

    if (typeof message === 'string') {
      const text = String(message || '').trim();
      if (!text) return;
      sendActivitySummaryMessage(text).catch(() => {});
      return;
    }

    const evt = message && typeof message === 'object' ? message : null;
    if (!evt) return;

    const plotLabel = `Plot No. ${evt.plotNumber ?? '-'}`;
    const customer = String(evt.customerName || '').trim() || '-';

    if (evt.type === 'remove_waiter') {
      const reason = String(evt.reason || '').trim() || '-';
      const text = `${plotLabel}, ${customer}, Waiting entry removed (Reason: ${reason}), by ${actor} on ${at}.`;
      sendActivitySummaryMessage(text).catch(() => {});
      return;
    }

    if (evt.type === 'update_waiter') {
      const text = `${plotLabel}, ${customer}, Waiting details updated, by ${actor} on ${at}.`;
      sendActivitySummaryMessage(text).catch(() => {});
      return;
    }

    if (evt.type === 'update_booking') {
      const text = `${plotLabel}, ${customer}, Booking details updated, by ${actor} on ${at}.`;
      sendActivitySummaryMessage(text).catch(() => {});
      return;
    }

    if (evt.type === 'note_activity') {
      const text = buildNoteActivitySummaryText({
        kind: evt.kind === 'booking' ? 'booking' : 'waiting',
        isUpdate: !!evt.isUpdate,
        plotNumber: evt.plotNumber,
        customerName: evt.customerName,
        preview: evt.preview,
        actor,
        at,
      });
      sendActivitySummaryMessage(text).catch(() => {});
      return;
    }

    if (evt.type === 'plot_transfer') {
      const from = evt.sourcePlotNumber ?? '-';
      const to = evt.targetPlotNumber ?? '-';
      const cust = String(evt.customerName || '').trim() || '-';
      const kind = evt.kind === 'booking' ? 'Booking' : 'Waiting';
      const text = `Plot transfer (${kind}): Plot No. ${from} → Plot No. ${to}, ${cust}, by ${actor} on ${at}.`;
      sendActivitySummaryMessage(text).catch(() => {});
    }
  }, [userInfo?.mobileNumber, userInfo?.name]);

  const handleShareLayout = async () => {
    if (shareBusy) return;
    const sharedByName =
      (userInfo?.name && String(userInfo.name).trim()) || 'User';
    try {
      setShareBusy(true);
      setShareMeta({ at: new Date(), by: sharedByName });

      await new Promise((resolve) => {
        InteractionManager.runAfterInteractions(() => {
          setTimeout(resolve, Platform.OS === 'android' ? 120 : 80);
        });
      });

      const uri = await captureRef(shareCaptureRef, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
      });

      const fileUrl =
        Platform.OS === 'android' && uri && !uri.startsWith('file://')
          ? `file://${uri}`
          : uri;

      // On Samsung (and some Android OEMs), choosing "Save to Gallery" launches
      // a separate activity. The app goes to background and Share.open() never
      // resolves, leaving shareBusy=true and the loader spinning forever.
      // Fix: race the share promise against an AppState watcher — if the app
      // went to background and then comes back active, treat the share as done.
      await new Promise((resolve, reject) => {
        let settled = false;
        let wentBackground = false;

        const finish = (err) => {
          if (settled) return;
          settled = true;
          subscription.remove();
          if (err) reject(err);
          else resolve();
        };

        const subscription = AppState.addEventListener('change', (nextState) => {
          if (nextState === 'background') {
            wentBackground = true;
          } else if (nextState === 'active' && wentBackground) {
            // App returned from background (e.g. gallery save completed).
            // Small delay lets Share.open() resolve naturally first if it can.
            setTimeout(() => finish(null), 400);
          }
        });

        Share.open({
          title: SITE_NAME,
          url: fileUrl,
          type: 'image/png',
          filename: `golden-city-layout-${Date.now()}.png`,
          failOnCancel: false,
          showAppsToView: true,
        })
          .then(() => finish(null))
          .catch((err) => finish(err));
      });
    } catch (err) {
      const msg = err?.message ? String(err.message) : '';
      if (!/user did not share|cancel|canceled|dismissed/i.test(msg)) {
        showAlert('Share', 'Could not share the layout. Please try again.');
      }
    } finally {
      setShareBusy(false);
      setShareMeta(null);
    }
  };

  const handleShareLocation = async () => {
    try {
      await NativeShare.share({
        title: SITE_NAME,
        message: LOCATION_SHARE_MESSAGE,
      });
    } catch (err) {
      if (err?.message && !/cancel|abort|dismiss/i.test(String(err.message))) {
        showAlert('Share', 'Could not open the share sheet.');
      }
    }
  };

  const handleOpenCommunityChat = () => {
    const groupId = getCometChatCommunityGroupId();
    devLog('Layout', 'open community chat', { groupId });
    navigation.navigate('GroupChat', { groupId });
  };

  const canControlTemporaryGuestMode =
    userInfo?.role === 'owner' || userInfo?.role === 'super_admin';

  const onEnableGuestMode = () => {
    setShowGuestEnableModal(true);
  };

  const tryDisableGuestModeWithBiometric = async () => {
    try {
      const { available } = await isBiometricAvailable();
      if (!available) {
        setGuestDisableUsePassword(true);
        return;
      }
      const ok = await promptBiometric('Disable Guest Mode');
      if (!ok) {
        showAlert('Authentication failed', 'Biometric verification failed. You can use admin password.');
        return;
      }
      await disableTemporaryGuestMode();
    } catch {
      showAlert('Error', 'Could not disable Guest Mode with biometrics.');
    }
  };

  const onDisableGuestMode = () => {
    setGuestDisablePassword('');
    setGuestDisableUsePassword(false);
    setShowGuestDisableModal(true);
  };

  const submitGuestDisablePassword = async () => {
    const pin = guestDisablePassword.trim();
    if (pin !== ADMIN_OVERRIDE_PASSWORD) {
      showAlert('Incorrect password', 'Admin password is incorrect.');
      return;
    }
    try {
      await disableTemporaryGuestMode();
      setShowGuestDisableModal(false);
      setGuestDisableUsePassword(false);
      setGuestDisablePassword('');
    } catch {
      showAlert('Error', 'Could not disable Guest Mode.');
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center} edges={['top', 'left', 'right']}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingLabel}>Loading master plan</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <LayoutShareCapture
        ref={shareCaptureRef}
        plots={plots}
        shareAt={shareMeta?.at ?? null}
        sharedBy={shareMeta?.by ?? ''}
      />

      <View style={styles.topSection}>
        <View style={styles.brandRow}>
          <View style={styles.brandTextBlock}>
            <Text style={styles.brandTagline}>{SITE_TAGLINE}</Text>
            <Text style={styles.brandTitle}>{SITE_NAME}</Text>
            <View style={styles.brandRule} />
          </View>
          {canUseChat && (
            <TouchableOpacity
              style={styles.chatHeaderButton}
              onPress={handleOpenCommunityChat}
              accessibilityRole="button"
              accessibilityLabel={unreadCount > 0 ? `Open community chat, ${unreadCount} unread` : 'Open community chat'}
            >
              <Icon name="chat" size={22} color={colors.primary} />
              {unreadCount > 0 && (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadBadgeText}>
                    {unreadCount > 99 ? '99+' : String(unreadCount)}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.toolbar}>
          <TouchableOpacity
            style={[styles.toolButton, styles.toolButtonOutlined]}
            onPress={handleShareLayout}
            disabled={shareBusy}
            accessibilityRole="button"
            accessibilityLabel="Share Map as image"
          >
            {shareBusy ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Icon name="image" size={18} color={colors.text} />
            )}
            <Text style={styles.toolButtonLabel} numberOfLines={2}>
              Share Map
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.toolButton, styles.toolButtonOutlined]}
            onPress={handleShareLocation}
            accessibilityRole="button"
            accessibilityLabel="Share Location"
          >
            <Icon name="place" size={18} color={colors.text} />
            <Text style={styles.toolButtonLabel} numberOfLines={2}>
              Share Location
            </Text>
          </TouchableOpacity>

          {canBulkSelect && (
            <TouchableOpacity
              style={[
                styles.toolButton,
                isMultiSelectMode ? styles.toolButtonDanger : styles.toolButtonPrimary,
              ]}
              onPress={() => {
                setIsMultiSelectMode(!isMultiSelectMode);
                setSelectedPlots([]);
              }}
              accessibilityRole="button"
              accessibilityLabel={
                isMultiSelectMode ? 'Cancel multi-select' : 'Select multiple plots'
              }
            >
              <Icon
                name={isMultiSelectMode ? 'close' : 'checklist'}
                size={18}
                color="#fff"
              />
              <Text style={styles.toolButtonLabelOnColor} numberOfLines={2}>
                {isMultiSelectMode ? 'Cancel' : 'Select'}
              </Text>
            </TouchableOpacity>
          )}
          {canControlTemporaryGuestMode && (
            <TouchableOpacity
              style={[
                styles.toolButton,
                temporaryGuestModeEnabled ? styles.toolButtonDanger : styles.toolButtonOutlined,
              ]}
              onPress={temporaryGuestModeEnabled ? onDisableGuestMode : onEnableGuestMode}
              accessibilityRole="button"
              accessibilityLabel={temporaryGuestModeEnabled ? 'Disable guest mode' : 'Enable guest mode'}
            >
              <Icon
                name={temporaryGuestModeEnabled ? 'lock-open' : 'visibility'}
                size={18}
                color={temporaryGuestModeEnabled ? '#fff' : colors.text}
              />
              <Text
                style={temporaryGuestModeEnabled ? styles.toolButtonLabelOnColor : styles.toolButtonLabel}
                numberOfLines={2}
              >
                {temporaryGuestModeEnabled ? 'Exit Guest' : 'Guest Mode'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={styles.mapSection}>
        <View style={styles.mapCard}>
          <ReactNativeZoomableView
            style={styles.zoomHost}
            maxZoom={10}
            minZoom={0.5}
            zoomStep={0.5}
            initialZoom={1}
            bindToBorders={true}
            onSingleTap={handleSingleTap}
            onLongPress={handleLongPress}
          >
            <View style={styles.zoomContentCenter}>
              <View
                ref={innerViewRef}
                style={{
                  width: renderWidth,
                  height: renderHeight,
                  position: 'relative',
                }}
              >
                <Image
                  source={require('../assets/Golden City.jpg')}
                  style={{
                    width: renderWidth,
                    height: renderHeight,
                    position: 'absolute',
                    top: 0,
                    left: 0,
                  }}
                  resizeMode="stretch"
                />
                <Svg
                  width="100%"
                  height="100%"
                  viewBox="0 0 3509 2480"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                  }}
                  pointerEvents="none"
                >
                  {plots.map((plot) => (
                    <PlotPolygon
                      key={plot._id}
                      plot={plot}
                      isSelected={selectedPlots.some((p) => p._id === plot._id)}
                      mapStatusFilter={mapStatusFilter}
                    />
                  ))}
                </Svg>
              </View>
            </View>
          </ReactNativeZoomableView>
        </View>

        {mapStatusFilter ? (
          <View style={styles.filterBanner}>
            <View style={styles.filterBannerTextCol}>
              <Text style={styles.filterBannerLine}>{filterBannerLine}</Text>
              {mapStatusFilter === 'open' ? (
                <Text style={styles.filterBannerHint}>
                  Open plots have no overlay colour — the map is unchanged.
                </Text>
              ) : (
                <Text style={styles.filterBannerHint}>Other statuses are faded. Tap a plot as usual.</Text>
              )}
            </View>
            <TouchableOpacity
              style={styles.filterBannerClear}
              onPress={() => setMapStatusFilter(null)}
              accessibilityRole="button"
              accessibilityLabel="Clear map filter and return to normal view"
            >
              <Icon name="arrow-back" size={18} color={colors.primary} />
              <Text style={styles.filterBannerClearText}>Normal</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <Text style={styles.mapHint}>Pinch to zoom · Pan to move · Tap a plot</Text>

        <View style={styles.legendCompactWrap}>
          <View style={styles.legendCompactRows}>
            {LAYOUT_LEGEND_ROWS.map((row, ri) => (
              <View key={String(ri)} style={styles.legendCompactRow}>
                {row.map((item) => (
                  <View key={item.filterKey} style={styles.legendCompactItem}>
                    <View
                      style={[
                        styles.legendKeySwatch,
                        { backgroundColor: item.color },
                        item.border
                          ? { borderColor: item.border, borderWidth: 1 }
                          : { borderColor: isDark ? '#475569' : '#64748b', borderWidth: 1 },
                      ]}
                    />
                    <Text style={styles.legendCompactLabel} numberOfLines={1}>
                      {item.label}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
          <TouchableOpacity
            style={[
              styles.legendFilterOpenBtn,
              { borderColor: colors.border, backgroundColor: colors.surface },
              mapStatusFilter ? styles.legendFilterOpenBtnActive : null,
            ]}
            onPress={() => setMapFilterModalVisible(true)}
            accessibilityRole="button"
            accessibilityLabel={
              mapStatusFilter ? 'Map filter active — open focus options' : 'Focus map by plot status'
            }
          >
            <Icon name="tune" size={20} color={colors.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {transferMapPick ? (
        <View
          style={[
            styles.transferMapPickBanner,
            {
              bottom: Math.max(insets.bottom, 10) + (isMultiSelectMode && selectedPlots.length > 0 ? 72 : 8),
              borderColor: colors.border,
              backgroundColor: isDark ? '#2e1065' : '#ede9fe',
            },
          ]}
        >
          <View style={styles.transferMapPickBannerTextCol}>
            <Text style={[styles.transferMapPickTitle, { color: colors.text }]}>
              Choose destination plot
            </Text>
            <Text style={[styles.transferMapPickHint, { color: colors.textSecondary }]}>
              Tap the plot on the map to transfer here
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.transferMapPickCancel, { borderColor: colors.border }]}
            onPress={() => {
              setTransferMapPick(null);
              setModalVisible(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Cancel choosing plot on map"
          >
            <Text style={[styles.transferMapPickCancelText, { color: colors.primary }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {isMultiSelectMode && selectedPlots.length > 0 && (
        <View style={styles.bottomBanner}>
          <Text style={styles.bannerText}>
            {selectedPlots.length} plot{selectedPlots.length !== 1 ? 's' : ''}{' '}
            selected
          </Text>
          <View style={styles.bannerActions}>
            <TouchableOpacity
              style={[styles.bannerBtn, styles.bannerInfoBtn]}
              onPress={() => {
                navigation.navigate('MultiPlotSummary', {
                  selectedPlotIds: selectedPlots.map((p) => p._id),
                });
              }}
            >
              <Icon name="info-outline" size={16} color="#0f172a" />
              <Text style={styles.bannerInfoBtnText}> Info</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.bannerBtn}
              onPress={() => {
                setSelectedPlot(null);
                setModalVisible(true);
              }}
            >
              <Text style={styles.bannerBtnText}>Update</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <BookingModal
        visible={modalVisible}
        plot={selectedPlot}
        isBulk={!selectedPlot && isMultiSelectMode}
        bulkCount={selectedPlots.length}
        selectedPlots={selectedPlots}
        readOnlyGuest={isGuest}
        onClose={() => {
          reopenBookingModalRef.current = false;
          setModalVisible(false);
          setSelectedPlot(null);
          setTransferMapPick(null);
          setPendingTransferTargetPlot(null);
        }}
        pendingTransferTarget={pendingTransferTargetPlot}
        onConsumedPendingTransferTarget={() => setPendingTransferTargetPlot(null)}
        onRequestTransferTargetByMap={({ kind, waitingId }) => {
          setTransferMapPick({ kind, waitingId: waitingId ?? null });
          setModalVisible(false);
        }}
        onPressPlotDetails={handleOpenPlotDetailsFromModal}
        onUpdate={handleUpdate}
        onActivitySummary={handleActivitySummary}
      />
      <Modal
        visible={showGuestEnableModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowGuestEnableModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <View style={styles.modalHeroIconWrap}>
              <Icon name="visibility" size={24} color={colors.primary} />
            </View>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Enable Guest Mode</Text>
            <Text style={[styles.modalSubtitle, { color: colors.textSecondary }]}>
              This will temporarily hide edit/admin powers so customers can safely browse the app.
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnCancel]}
                onPress={() => setShowGuestEnableModal(false)}
              >
                <Text style={styles.modalBtnCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnConfirm]}
                onPress={async () => {
                  try {
                    await enableTemporaryGuestMode();
                    setShowGuestEnableModal(false);
                  } catch {
                    showAlert('Error', 'Could not enable Guest Mode.');
                  }
                }}
              >
                <Text style={styles.modalBtnConfirmText}>Enable</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        visible={showGuestDisableModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setShowGuestDisableModal(false);
          setGuestDisableUsePassword(false);
          setGuestDisablePassword('');
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <View style={styles.modalHeroIconWrap}>
              <Icon name="lock-open" size={24} color={colors.primary} />
            </View>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Disable Guest Mode</Text>
            <Text style={[styles.modalSubtitle, { color: colors.textSecondary }]}>
              Choose an authentication method to restore full access.
            </Text>
            <View style={styles.authChoiceRow}>
              <TouchableOpacity
                style={[styles.authChoiceBtn, { borderColor: colors.border, backgroundColor: colors.background }]}
                onPress={() => { void tryDisableGuestModeWithBiometric(); }}
              >
                <Icon name="fingerprint" size={22} color={colors.primary} />
                <Text style={[styles.authChoiceTitle, { color: colors.text }]}>Biometric</Text>
                <Text style={[styles.authChoiceHint, { color: colors.textSecondary }]}>Fast unlock</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.authChoiceBtn, { borderColor: colors.border, backgroundColor: colors.background }]}
                onPress={() => setGuestDisableUsePassword((v) => !v)}
              >
                <Icon name="admin-panel-settings" size={22} color={colors.primary} />
                <Text style={[styles.authChoiceTitle, { color: colors.text }]}>Admin PIN</Text>
              </TouchableOpacity>
            </View>
            {guestDisableUsePassword && (
              <>
                <TextInput
                  style={[styles.modalInput, { borderColor: colors.border, color: colors.text }]}
                  value={guestDisablePassword}
                  onChangeText={setGuestDisablePassword}
                  secureTextEntry
                  keyboardType="number-pad"
                  accessibilityLabel="Admin PIN"
                  placeholder="Enter admin PIN"
                  placeholderTextColor={colors.placeholder}
                />
                <TouchableOpacity
                  style={styles.modalBtnSubmitPin}
                  onPress={() => { void submitGuestDisablePassword(); }}
                  accessibilityRole="button"
                  accessibilityLabel="Disable guest mode with admin PIN"
                >
                  <Text style={styles.modalBtnSubmitPinText}>Disable with Admin PIN</Text>
                </TouchableOpacity>
              </>
            )}
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnCancel]}
                onPress={() => {
                  setShowGuestDisableModal(false);
                  setGuestDisableUsePassword(false);
                  setGuestDisablePassword('');
                }}
              >
                <Text style={styles.modalBtnCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={mapFilterModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMapFilterModalVisible(false)}
      >
        <View style={styles.filterMapModalRoot}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setMapFilterModalVisible(false)}
            accessibilityLabel="Dismiss"
          />
          <View
            style={[styles.filterMapModalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Text style={[styles.filterMapModalTitle, { color: colors.text }]}>Focus map</Text>
            <Text style={[styles.filterMapModalSubtitle, { color: colors.textSecondary }]}>
              Highlight one status. Other plots fade. Open only updates the count — map colours stay the same.
            </Text>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={styles.filterMapModalScroll}
            >
              <View style={styles.filterModalPillRow}>
                {LAYOUT_LEGEND.map((item) => {
                  const count = layoutCounts[item.countKey];
                  const active = mapStatusFilter === item.filterKey;
                  return (
                    <TouchableOpacity
                      key={item.filterKey}
                      activeOpacity={0.85}
                      onPress={() => {
                        setMapStatusFilter((prev) => (prev === item.filterKey ? null : item.filterKey));
                        setMapFilterModalVisible(false);
                      }}
                      style={[styles.filterModalPill, active && styles.filterModalPillActive]}
                      accessibilityRole="button"
                      accessibilityLabel={`${item.label}, ${count} plots${active ? ', currently selected' : ''}`}
                    >
                      <View
                        style={[
                          styles.filterModalPillDot,
                          { backgroundColor: item.color },
                          item.border ? { borderColor: item.border, borderWidth: 1 } : null,
                        ]}
                      />
                      <Text style={[styles.filterModalPillLabel, { color: colors.text }]} numberOfLines={1}>
                        {item.label}
                      </Text>
                      <View style={[styles.filterModalPillBadge, { backgroundColor: isDark ? '#334155' : '#e2e8f0' }]}>
                        <Text style={[styles.filterModalPillBadgeText, { color: isDark ? '#e2e8f0' : '#475569' }]}>
                          {count}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {mapStatusFilter ? (
                <TouchableOpacity
                  style={[styles.filterModalClearRow, { borderColor: colors.border }]}
                  onPress={() => {
                    setMapStatusFilter(null);
                    setMapFilterModalVisible(false);
                  }}
                >
                  <Icon name="highlight-off" size={20} color={colors.primary} />
                  <Text style={[styles.filterModalClearText, { color: colors.primary }]}>
                    Clear focus — show all plots
                  </Text>
                </TouchableOpacity>
              ) : null}
            </ScrollView>
            <TouchableOpacity
              style={[styles.filterMapModalDone, { backgroundColor: colors.primary }]}
              onPress={() => setMapFilterModalVisible(false)}
            >
              <Text style={styles.filterMapModalDoneText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

function getStyles(colors, isDark) {
  const gold = isDark ? '#E4C76B' : '#9A7209';
  const goldMuted = isDark ? '#C4A84A' : '#B8860B';
  const cardBorder = isDark ? '#334155' : '#cbd5e1';
  const mapFrame = isDark ? '#1e293b' : '#e2e8f0';

  const s = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    center: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.background,
    },
    loadingLabel: {
      marginTop: 12,
      fontSize: 14,
      color: colors.textSecondary,
      fontWeight: '600',
    },
    topSection: {
      paddingHorizontal: MAP_MARGIN_H,
      paddingTop: 8,
      paddingBottom: 12,
    },
    brandRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
    },
    brandTextBlock: {
      flex: 1,
      paddingRight: 10,
      minWidth: 0,
    },
    chatHeaderButton: {
      marginTop: 2,
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: cardBorder,
    },
    unreadBadge: {
      position: 'absolute',
      top: 2,
      right: 2,
      minWidth: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: '#e53935',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 4,
      borderWidth: 1.5,
      borderColor: colors.surface,
    },
    unreadBadgeText: {
      color: '#fff',
      fontSize: 10,
      fontWeight: '800',
      lineHeight: 13,
      textAlign: 'center',
      includeFontPadding: false,
    },
    brandTagline: {
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      color: colors.textSecondary,
      marginBottom: 4,
    },
    brandTitle: {
      fontSize: 26,
      fontWeight: '800',
      letterSpacing: 2,
      color: gold,
    },
    brandRule: {
      height: 3,
      width: 56,
      backgroundColor: goldMuted,
      marginTop: 10,
      borderRadius: 2,
    },
    toolbar: {
      flexDirection: 'row',
      alignItems: 'stretch',
      gap: 8,
      marginTop: 14,
    },
    toolButton: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
      paddingVertical: 10,
      paddingHorizontal: 4,
      borderRadius: 12,
      minHeight: 64,
    },
    toolButtonOutlined: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: cardBorder,
    },
    toolButtonPrimary: {
      backgroundColor: colors.primary,
    },
    toolButtonDanger: {
      backgroundColor: '#c62828',
    },
    toolButtonLabel: {
      fontSize: 11,
      fontWeight: '800',
      color: colors.text,
      textAlign: 'center',
      lineHeight: 14,
      letterSpacing: 0.2,
      width: '100%',
    },
    toolButtonLabelOnColor: {
      fontSize: 12,
      fontWeight: '800',
      color: '#fff',
      textAlign: 'center',
      lineHeight: 15,
      width: '100%',
    },
    mapSection: {
      flex: 1,
      minHeight: 0,
      marginHorizontal: MAP_MARGIN_H,
      marginBottom: 12,
    },
    mapCard: {
      flex: 1,
      minHeight: 0,
      borderRadius: 16,
      borderWidth: MAP_BORDER,
      borderColor: mapFrame,
      backgroundColor: isDark ? '#0f172a' : '#eaeaea',
      overflow: 'hidden',
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: isDark ? 0.35 : 0.12,
          shadowRadius: 12,
        },
        android: { elevation: 4 },
      }),
    },
    zoomHost: {
      flex: 1,
      minHeight: 0,
    },
    zoomContentCenter: {
      flex: 1,
      minHeight: 0,
      justifyContent: 'center',
      alignItems: 'center',
    },
    mapHint: {
      textAlign: 'center',
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 4,
      fontWeight: '500',
    },
    filterBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 6,
      paddingVertical: 11,
      paddingHorizontal: 12,
      borderRadius: 14,
      backgroundColor: isDark ? '#1e293b' : '#eef2ff',
      borderWidth: 1,
      borderColor: isDark ? '#334155' : '#c7d2fe',
      gap: 10,
    },
    filterBannerTextCol: {
      flex: 1,
      minWidth: 0,
    },
    filterBannerLine: {
      fontSize: 15,
      fontWeight: '800',
      color: colors.text,
    },
    filterBannerHint: {
      fontSize: 11,
      marginTop: 3,
      color: colors.textSecondary,
      fontWeight: '600',
      lineHeight: 15,
    },
    filterBannerClear: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingVertical: 8,
      paddingHorizontal: 11,
      borderRadius: 12,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: cardBorder,
    },
    filterBannerClearText: {
      fontSize: 13,
      fontWeight: '800',
      color: colors.primary,
    },
    transferMapPickBanner: {
      position: 'absolute',
      alignSelf: 'center',
      left: 14,
      right: 14,
      maxWidth: 520,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderRadius: 16,
      borderWidth: 1.5,
      elevation: 10,
      zIndex: 50,
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.18,
          shadowRadius: 10,
        },
      }),
    },
    transferMapPickBannerTextCol: { flex: 1, minWidth: 0 },
    transferMapPickTitle: { fontSize: 16, fontWeight: '800' },
    transferMapPickHint: { fontSize: 12, fontWeight: '600', marginTop: 4, lineHeight: 16 },
    transferMapPickCancel: {
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: 12,
      borderWidth: 1,
      backgroundColor: isDark ? '#1a1a1a' : '#fff',
    },
    transferMapPickCancelText: { fontWeight: '800', fontSize: 14 },

    bottomBanner: {
      position: 'absolute',
      bottom: 20,
      alignSelf: 'center',
      backgroundColor: isDark ? '#1e293b' : '#0f172a',
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderRadius: 28,
      elevation: 8,
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.2,
          shadowRadius: 8,
        },
      }),
    },
    bannerText: {
      color: '#f8fafc',
      fontSize: 15,
      fontWeight: '700',
      marginRight: 14,
    },
    bannerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    bannerBtn: {
      backgroundColor: colors.primary,
      paddingVertical: 9,
      paddingHorizontal: 16,
      borderRadius: 20,
    },
    bannerInfoBtn: {
      backgroundColor: '#facc15',
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: '#ca8a04',
    },
    bannerInfoBtnText: {
      color: '#0f172a',
      fontWeight: '800',
      fontSize: 13,
    },
    bannerBtnText: {
      color: '#fff',
      fontWeight: '800',
      fontSize: 14,
    },

    // ── Compact map key (2 lines) + tune opens filter modal ─────────────────
    legendCompactWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 6,
      paddingVertical: 2,
      gap: 10,
    },
    legendCompactRows: {
      flex: 1,
      minWidth: 0,
      gap: 4,
    },
    legendCompactRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      columnGap: 12,
      rowGap: 4,
    },
    legendCompactItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    legendKeySwatch: {
      width: 12,
      height: 12,
      borderRadius: 2,
    },
    legendCompactLabel: {
      fontSize: 10,
      fontWeight: '800',
      color: colors.textSecondary,
      flexShrink: 1,
    },
    legendFilterOpenBtn: {
      width: 44,
      height: 44,
      borderRadius: 12,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: isDark ? 0.25 : 0.08,
          shadowRadius: 3,
        },
        android: { elevation: 2 },
      }),
    },
    legendFilterOpenBtnActive: {
      borderWidth: 2,
      borderColor: colors.primary,
    },
    filterMapModalRoot: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      paddingHorizontal: 20,
      paddingVertical: 24,
    },
    filterMapModalCard: {
      borderRadius: 16,
      borderWidth: 1,
      padding: 16,
      maxHeight: '88%',
      width: '100%',
      maxWidth: 400,
      alignSelf: 'center',
    },
    filterMapModalTitle: {
      fontSize: 18,
      fontWeight: '800',
      marginBottom: 6,
      textAlign: 'center',
    },
    filterMapModalSubtitle: {
      fontSize: 12,
      fontWeight: '600',
      lineHeight: 17,
      marginBottom: 14,
      textAlign: 'center',
    },
    filterMapModalScroll: {
      maxHeight: 340,
    },
    filterModalPillRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 8,
    },
    filterModalPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 9,
      paddingHorizontal: 12,
      borderRadius: 999,
      backgroundColor: isDark ? '#1e293b' : '#f1f5f9',
      borderWidth: 1.5,
      borderColor: isDark ? '#334155' : '#e2e8f0',
    },
    filterModalPillActive: {
      borderColor: colors.primary,
      backgroundColor: isDark ? 'rgba(59,130,246,0.22)' : 'rgba(59,130,246,0.12)',
    },
    filterModalPillDot: {
      width: 12,
      height: 12,
      borderRadius: 6,
    },
    filterModalPillLabel: {
      fontSize: 12,
      fontWeight: '800',
      maxWidth: 100,
    },
    filterModalPillBadge: {
      minWidth: 24,
      paddingHorizontal: 7,
      paddingVertical: 3,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
    },
    filterModalPillBadgeText: {
      fontSize: 11,
      fontWeight: '900',
    },
    filterModalClearRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginTop: 14,
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderRadius: 12,
      borderWidth: 1,
    },
    filterModalClearText: {
      fontSize: 14,
      fontWeight: '800',
    },
    filterMapModalDone: {
      marginTop: 14,
      paddingVertical: 14,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    filterMapModalDoneText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '800',
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 24,
    },
    modalCard: {
      width: '100%',
      maxWidth: 380,
      borderRadius: 14,
      borderWidth: 1,
      padding: 16,
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: '800',
      marginBottom: 6,
      textAlign: 'center',
    },
    modalSubtitle: {
      fontSize: 13,
      marginBottom: 12,
      textAlign: 'center',
    },
    modalHeroIconWrap: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignSelf: 'center',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? '#1e293b' : '#e0f2fe',
      marginBottom: 10,
    },
    authChoiceRow: {
      flexDirection: 'row',
      gap: 10,
      marginBottom: 12,
    },
    authChoiceBtn: {
      flex: 1,
      borderWidth: 1,
      borderRadius: 12,
      paddingVertical: 10,
      paddingHorizontal: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    authChoiceTitle: {
      marginTop: 6,
      fontSize: 13,
      fontWeight: '700',
    },
    authChoiceHint: {
      fontSize: 11,
      marginTop: 2,
    },
    modalInput: {
      borderWidth: 1,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      marginBottom: 12,
    },
    modalActions: {
      flexDirection: 'row',
      gap: 10,
    },
    modalBtn: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modalBtnCancel: {
      backgroundColor: '#e2e8f0',
    },
    modalBtnConfirm: {
      backgroundColor: '#dc2626',
    },
    modalBtnCancelText: {
      color: '#111827',
      fontWeight: '700',
    },
    modalBtnConfirmText: {
      color: '#fff',
      fontWeight: '800',
    },
    /** Full-width primary action (avoid modalBtn flex:1 outside modalActions row — label can vanish). */
    modalBtnSubmitPin: {
      alignSelf: 'stretch',
      width: '100%',
      paddingVertical: 12,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#dc2626',
      marginBottom: 10,
    },
    modalBtnSubmitPinText: {
      color: '#ffffff',
      fontSize: 15,
      fontWeight: '800',
    },
  });

  return s;
}

export default LayoutScreen;
