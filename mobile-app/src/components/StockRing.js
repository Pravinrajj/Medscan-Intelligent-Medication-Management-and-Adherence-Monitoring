import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors, fonts } from '../theme';

/**
 * Tiny circular stock indicator for medicine cards.
 *
 * Props:
 *   current    - current stock count
 *   total      - total/initial stock count (for %)
 *   size       - diameter (default 36)
 */
const StockRing = ({ current = 0, total = 30, size = 36 }) => {
  if (total <= 0 || current == null) return null;

  const strokeWidth = 3;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.min(current / total, 1);
  const offset = circumference * (1 - pct);

  const ringColor = pct > 0.3
    ? colors.success
    : pct > 0.15
      ? colors.warning
      : colors.danger;

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={colors.chartTrack}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={ringColor}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </Svg>
      <Text style={[styles.count, { fontSize: size * 0.28 }]}>{current}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: {
    position: 'absolute',
    fontFamily: fonts.bold,
    color: colors.text,
  },
});

export default StockRing;
