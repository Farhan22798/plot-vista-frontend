import React, { forwardRef, useMemo } from 'react';
import { View, Image, Text, StyleSheet } from 'react-native';
import Svg from 'react-native-svg';
import PlotPolygon from './PlotPolygon';

/**
 * Export size: JPEG is stretched to this exact rectangle so it matches SVG viewBox 0 0 3509 2480
 * (same coordinate system as plot polygons). "contain" caused letterboxing and broken overlay.
 */
export const SHARE_MAP_WIDTH = 1200;
export const SHARE_MAP_HEIGHT = Math.round(SHARE_MAP_WIDTH * (2480 / 3509));

const OUTER_PAD = 16;
const BORDER = 4;
const FOOTER_PAD = 20;
const FOOTER_HORIZONTAL = 8;

const CARD_WIDTH = OUTER_PAD * 2 + BORDER * 2 + SHARE_MAP_WIDTH;

const LEGEND_ITEMS = [
  { color: '#2e7d32', label: 'Booked',           border: null,      textColor: '#0f172a' },
  { color: '#ffeb3b', label: 'Waiting',           border: null,      textColor: '#0f172a' },
  { color: '#f97316', label: 'Multiple Waiting',  border: null,      textColor: '#0f172a' },
  { color: '#ffffff', label: 'Open',              border: '#64748b', textColor: '#0f172a' },
];

/**
 * Off-screen capture card. Root View keeps a stable ref for react-native-view-shot.
 */
const LayoutShareCapture = forwardRef(function LayoutShareCapture(
  { plots, shareAt, sharedBy },
  ref
) {
  const dateLine = useMemo(() => {
    if (!shareAt) return '';
    try {
      return shareAt.toLocaleString(undefined, {
        dateStyle: 'full',
        timeStyle: 'short',
      });
    } catch {
      return String(shareAt);
    }
  }, [shareAt]);

  const byLine = sharedBy && String(sharedBy).trim() ? String(sharedBy).trim() : 'User';

  const mapImageStyle = useMemo(
    () => ({
      position: 'absolute',
      top: 0,
      left: 0,
      width: SHARE_MAP_WIDTH,
      height: SHARE_MAP_HEIGHT,
    }),
    []
  );

  const svgStyle = useMemo(
    () => ({
      position: 'absolute',
      top: 0,
      left: 0,
    }),
    []
  );

  return (
    <View ref={ref} collapsable={false} style={styles.captureRoot}>
      <View style={styles.outer} collapsable={false}>
        <View style={styles.borderFrame} collapsable={false}>
          <View style={styles.mapBox} collapsable={false}>
            {/*
             * Always rendered (off-screen) so the asset is decoded and in GPU
             * memory before captureRef fires.
             */}
            <Image
              source={require('../assets/Golden City.jpg')}
              style={mapImageStyle}
              resizeMode="stretch"
            />

            {shareAt && (
              <Svg
                width={SHARE_MAP_WIDTH}
                height={SHARE_MAP_HEIGHT}
                viewBox="0 0 3509 2480"
                style={svgStyle}
              >
                {plots.map((plot) => (
                  <PlotPolygon
                    key={plot._id}
                    plot={plot}
                    isSelected={false}
                    showFullAdvanceBadge={false}
                  />
                ))}
              </Svg>
            )}

            {/* ── Color legend — bottom-left ── */}
            {shareAt && (
              <View style={styles.legend}>
                <Text style={styles.legendTitle}>LEGEND</Text>
                {LEGEND_ITEMS.map((item) => (
                  <View key={item.label} style={styles.legendRow}>
                    <View
                      style={[
                        styles.legendSwatch,
                        { backgroundColor: item.color },
                        item.border ? { borderColor: item.border, borderWidth: 1.5 } : null,
                      ]}
                    />
                    <Text style={styles.legendLabel}>{item.label}</Text>
                  </View>
                ))}
              </View>
            )}

          </View>
        </View>

        {shareAt && (
          <View style={styles.footer}>
            <Text style={styles.footerLeft} numberOfLines={1}>
              Shared {dateLine}
            </Text>
            <Text style={styles.footerBrand} numberOfLines={1}>
              BM TAILORS
            </Text>
            <Text style={styles.footerRight} numberOfLines={1}>
              Shared by {byLine}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  captureRoot: {
    position: 'absolute',
    left: -12000,
    top: 0,
    width: CARD_WIDTH,
    opacity: 1,
    overflow: 'visible',
  },
  outer: {
    padding: OUTER_PAD,
    backgroundColor: '#f8fafc',
    width: CARD_WIDTH,
  },
  borderFrame: {
    borderWidth: BORDER,
    borderColor: '#0f172a',
    backgroundColor: '#0f172a',
  },
  mapBox: {
    width: SHARE_MAP_WIDTH,
    height: SHARE_MAP_HEIGHT,
    overflow: 'hidden',
    backgroundColor: '#eaeaea',
  },

  // ── Legend ────────────────────────────────────────────────────────────────
  legend: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.93)',
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: '#0f172a',
    paddingHorizontal: 12,
    paddingVertical: 10,
    zIndex: 10,
  },
  legendTitle: {
    fontSize: 13,
    fontWeight: '900',
    color: '#0f172a',
    letterSpacing: 1.5,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  legendSwatch: {
    width: 18,
    height: 18,
    borderRadius: 3,
    marginRight: 8,
  },
  legendLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
    letterSpacing: 0.2,
  },

  // ── Footer ────────────────────────────────────────────────────────────────
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 14,
    paddingBottom: 10,
    paddingHorizontal: FOOTER_HORIZONTAL,
  },
  footerLeft: {
    fontSize: 20,
    color: '#0f172a',
    fontWeight: '700',
    letterSpacing: 0.2,
    flex: 1,
  },
  footerBrand: {
    fontSize: 22,
    fontWeight: '800',
    fontStyle: 'italic',
    color: '#7c3aed',
    letterSpacing: 2,
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  footerRight: {
    fontSize: 20,
    color: '#0f172a',
    fontWeight: '700',
    letterSpacing: 0.2,
    textAlign: 'right',
    flex: 1,
  },
});

export default LayoutShareCapture;
