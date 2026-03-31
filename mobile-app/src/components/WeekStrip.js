import React, { useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { colors, fonts, spacing, radii, shadows } from '../theme';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const toLocalISO = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/**
 * Horizontal week strip showing 7 days centered on today.
 */
const WeekStrip = ({ selectedDate, onSelectDate, markedDates = new Set() }) => {
  const scrollRef = useRef(null);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const days = [];
  for (let i = -3; i <= 3; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    d.setHours(0, 0, 0, 0);
    days.push(d);
  }

  const selectedISO = selectedDate ? toLocalISO(new Date(selectedDate)) : '';
  const todayISO = toLocalISO(today);

  useEffect(() => {
    // Scroll to center (today) on mount
    setTimeout(() => {
      scrollRef.current?.scrollTo({ x: 3 * 62, animated: false });
    }, 100);
  }, []);

  return (
    <View style={styles.container}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {days.map((day, idx) => {
          const iso = toLocalISO(day);
          const isSelected = iso === selectedISO;
          const isToday = iso === todayISO;
          const hasSchedules = markedDates.has(iso);
          const isPast = day < today;

          return (
            <TouchableOpacity
              key={iso}
              style={[
                styles.dayItem,
                isSelected && styles.dayItemSelected,
                isToday && !isSelected && styles.dayItemToday,
              ]}
              onPress={() => onSelectDate(day)}
              activeOpacity={0.7}
            >
              <Text style={[
                styles.dayLabel,
                isSelected && styles.dayLabelSelected,
                isPast && !isSelected && styles.dayLabelPast,
              ]}>
                {DAYS[day.getDay()]}
              </Text>
              <Text style={[
                styles.dayNumber,
                isSelected && styles.dayNumberSelected,
                isToday && !isSelected && styles.dayNumberToday,
                isPast && !isSelected && styles.dayNumberPast,
              ]}>
                {day.getDate()}
              </Text>
              {hasSchedules && !isSelected && (
                <View style={styles.dot} />
              )}
              {isSelected && hasSchedules && (
                <View style={styles.dotSelected} />
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
};

const ITEM_WIDTH = 52;
const ITEM_GAP = 10;

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.lg,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    gap: ITEM_GAP,
  },

  dayItem: {
    width: ITEM_WIDTH,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    ...shadows.sm,
  },
  dayItemSelected: {
    backgroundColor: colors.primary,
    ...shadows.colored(colors.primary),
  },
  dayItemToday: {
    borderWidth: 1.5,
    borderColor: colors.primary,
  },

  dayLabel: {
    fontSize: 11,
    fontFamily: fonts.medium,
    color: colors.textTertiary,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  dayLabelSelected: {
    color: 'rgba(255,255,255,0.8)',
  },
  dayLabelPast: {
    color: colors.textTertiary,
  },

  dayNumber: {
    fontSize: 18,
    fontFamily: fonts.bold,
    color: colors.text,
  },
  dayNumberSelected: {
    color: colors.textInverse,
  },
  dayNumberToday: {
    color: colors.primary,
  },
  dayNumberPast: {
    color: colors.textSecondary,
  },

  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: colors.primary,
    marginTop: 4,
  },
  dotSelected: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: 'rgba(255,255,255,0.7)',
    marginTop: 4,
  },
});

export default WeekStrip;
