import React, { Fragment } from 'react';
import { Polygon } from 'react-native-svg';
import { getPlotFillColor } from '../utils/plotColors';

const PlotPolygon = ({ plot, isSelected }) => {
  const { coordinates } = plot;
  const points = coordinates.map(coord => `${coord.x},${coord.y}`).join(' ');
  const fillColor = getPlotFillColor(plot);

  return (
    <Fragment>
      {/* Base polygon — status colour always visible */}
      <Polygon
        points={points}
        fill={fillColor}
        fillOpacity="0.5"
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
