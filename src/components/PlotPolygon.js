import React, { Fragment } from 'react';
import { Polygon } from 'react-native-svg';
import { getPlotFillColor, matchesLayoutStatusFilter } from '../utils/plotColors';
import { useTheme } from '../context/ThemeContext';

const PlotPolygon = ({ plot, isSelected, mapStatusFilter = null }) => {
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
    </Fragment>
  );
};

export default PlotPolygon;
