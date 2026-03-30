import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors, fonts } from '../theme';

/**
 * Circular progress ring with multi-segment support.
 *
 * Props:
 *   size        - diameter (default 120)
 *   strokeWidth - ring thickness (default 10)
 *   progress    - 0 to 1 (single color mode)
 *   segments    - [{value, color}] for multi-segment mode (values are counts, not percentages)
 *   label       - text inside the ring
 *   sublabel    - smaller text below label
 */
const CircularProgress = ({
  size = 120,
  strokeWidth = 10,
  progress = 0,
  segments = null,
  label = '',
  sublabel = '',
}) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  // Multi-segment mode
  if (segments && segments.length > 0) {
    const total = segments.reduce((sum, s) => sum + (s.value || 0), 0);
    let accumulatedOffset = 0;

    return (
      <View style={[styles.container, { width: size, height: size }]}>
        <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
          {/* Track */}
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={colors.chartTrack}
            strokeWidth={strokeWidth}
            fill="none"
          />
          {/* Segments - render in reverse so first segment is on top */}
          {total > 0 && [...segments].reverse().map((seg, i) => {
            if (!seg.value || seg.value <= 0) return null;
            const segProgress = seg.value / total;
            const segLength = segProgress * circumference;
            // Calculate offset: we draw from end backwards
            const reverseIndex = segments.length - 1 - i;
            let offset = 0;
            for (let j = 0; j < reverseIndex; j++) {
              offset += (segments[j].value || 0) / total * circumference;
            }
            const dashOffset = circumference - offset - segLength;

            return (
              <Circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                stroke={seg.color}
                strokeWidth={strokeWidth}
                fill="none"
                strokeDasharray={`${segLength} ${circumference - segLength}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
              />
            );
          })}
        </Svg>
        <View style={styles.labelContainer}>
          <Text style={[styles.label, { fontSize: size * 0.2 }]}>{label}</Text>
          {sublabel ? (
            <Text style={[styles.sublabel, { fontSize: size * 0.09 }]}>{sublabel}</Text>
          ) : null}
        </View>
      </View>
    );
  }

  // Single color mode
  const clampedProgress = Math.min(Math.max(progress, 0), 1);
  const strokeDashoffset = circumference * (1 - clampedProgress);

  const ringColor = clampedProgress >= 0.8
    ? colors.success
    : clampedProgress >= 0.5
      ? colors.warning
      : clampedProgress > 0
        ? colors.danger
        : colors.chartTrack;

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
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
        />
      </Svg>
      <View style={styles.labelContainer}>
        <Text style={[styles.label, { fontSize: size * 0.2 }]}>{label}</Text>
        {sublabel ? (
          <Text style={[styles.sublabel, { fontSize: size * 0.09 }]}>{sublabel}</Text>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontFamily: fonts.bold,
    color: colors.text,
  },
  sublabel: {
    fontFamily: fonts.medium,
    color: colors.textTertiary,
    marginTop: 2,
  },
});

export default CircularProgress;
