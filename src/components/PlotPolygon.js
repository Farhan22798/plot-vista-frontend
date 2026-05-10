import React, { Fragment } from 'react';
import { Circle, Path, Polygon } from 'react-native-svg';
import { getPlotFillColor, matchesLayoutStatusFilter } from '../utils/plotColors';
import { useTheme } from '../context/ThemeContext';

const PlotPolygon = ({
  plot,
  isSelected,
  mapStatusFilter = null,
  showFullAdvanceBadge = true,
}) => {
  const { isDark } = useTheme();
  const { coordinates } = plot;
  const points = coordinates.map((coord) => `${coord.x},${coord.y}`).join(' ');

  const filterActive = mapStatusFilter != null && mapStatusFilter !== 'open';
  const matches = matchesLayoutStatusFilter(plot, mapStatusFilter);
  const dimOthers = filterActive && !matches;
  const dimFill = isDark ? '#475569' : '#94a3b8';

  let fillColor = getPlotFillColor(plot);
  let fillOpacity = 0.5;

  if (dimOthers) {
    if (plot.status === 'vacant') {
      fillColor = 'transparent';
      fillOpacity = 0;
    } else {
      fillColor = dimFill;
      fillOpacity = 0.11;
    }
  } else if (filterActive && matches) {
    fillOpacity = 0.62;
  }

  const hasFullAdvance = Boolean(
    showFullAdvanceBadge &&
      plot?.status === 'booked' &&
      plot?.bookingDetails?.isFullAdvanceReceived
  );
  const xs = coordinates.map((c) => Number(c.x) || 0);
  const ys = coordinates.map((c) => Number(c.y) || 0);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  /** Inset from top-right bbox so the badge sits inside the polygon (not on the outer edge). */
  const badgeCx = maxX - 18;
  const badgeCy = minY + 18;
  /** ~6% larger than original r=12; do not use vectorEffect — it breaks fill on RN SVG (white ring). */
  const badgeR = 12.75;
  /** react-native-svg Path: use strokeWidth only (there is no tickStroke prop). */
  const checkMarkStrokeWidth = 2.25;

  return (
    <Fragment>
      {/* Base polygon — status colour; dimmed when another legend filter is active */}
      <Polygon
        points={points}
        fill={fillColor}
        fillOpacity={String(fillOpacity)}
        stroke="none"
        strokeWidth="0"
      />
      {/* Selection overlay — dark charcoal tint to darken the plot without clashing with status colours */}
      {isSelected && (
        <Polygon
          points={points}
          fill="#1F2937"
          fillOpacity="0.28"
          stroke="none"
          strokeWidth="0"
        />
      )}
      {hasFullAdvance && (
        <Fragment>
          <Circle
            cx={badgeCx}
            cy={badgeCy}
            r={badgeR}
            fill="#2563eb"
            stroke="#ffffff"
            strokeWidth={1.35}
          />
          <Path
            d={`M ${badgeCx - 5.1} ${badgeCy} L ${badgeCx - 1.55} ${badgeCy + 3.85} L ${badgeCx + 5.1} ${badgeCy - 2.9}`}
            stroke="#ffffff"
            strokeWidth={checkMarkStrokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </Fragment>
      )}
    </Fragment>
  );
};

export default PlotPolygon;
