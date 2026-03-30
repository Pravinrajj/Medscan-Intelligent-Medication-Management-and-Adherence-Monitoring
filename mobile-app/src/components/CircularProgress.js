import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors, fonts, spacing, radii, shadows } from '../theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * Circular progress ring with animated fill.
 *
 * Props:
 *   size        - diameter (default 120)
 *   strokeWidth - ring thickness (default 10)
 *   progress    - 0 to 1
 *   label       - text inside the ring (e.g., "4/6")
 *   sublabel    - smaller text below label (e.g., "doses taken")
 *   color       - ring fill color (default primary)
 *   trackColor  - ring background color
 */
const CircularProgress = ({
  size = 120,
  strokeWidth = 10,
  progress = 0,
  label = '',
  sublabel = '',
  color = colors.primary,
  trackColor = colors.chartTrack,
}) => {
  const animatedValue = useRef(new Animated.Value(0)).current;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  useEffect(() => {
    Animated.timing(animatedValue, {
      toValue: Math.min(Math.max(progress, 0), 1),
      duration: 800,
      useNativeDriver: false,
    }).start();
  }, [progress]);

  const strokeDashoffset = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [circumference, 0],
  });

  // Determine color based on progress if not explicitly set
  const ringColor = progress >= 0.8
    ? colors.success
    : progress >= 0.5
      ? colors.warning
      : progress > 0
        ? colors.danger
        : trackColor;

  const finalColor = color !== colors.primary ? color : ringColor;

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
        {/* Track (background ring) */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* Progress ring */}
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={finalColor}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
        />
      </Svg>
      {/* Center text */}
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
