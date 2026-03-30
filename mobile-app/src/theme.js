/**
 * MedScan Design System — Single source of truth for all UI tokens.
 * Import { colors, typography, spacing, shadows, radii } from '../theme';
 */

// ─── Color Palette ───────────────────────────────────────────────
export const colors = {
  // Primary — Modern teal-blue
  primary: '#0891B2',       // cyan-600
  primaryLight: '#22D3EE',  // cyan-400
  primaryDark: '#0E7490',   // cyan-700
  primaryBg: '#ECFEFF',     // cyan-50 (tinted backgrounds)

  // Accent — Warm amber for CTAs & highlights
  accent: '#F59E0B',        // amber-500
  accentLight: '#FDE68A',   // amber-200
  accentDark: '#D97706',    // amber-600

  // Success
  success: '#10B981',       // emerald-500
  successLight: '#D1FAE5',  // emerald-100
  successDark: '#059669',   // emerald-600

  // Warning
  warning: '#F59E0B',       // amber-500
  warningLight: '#FEF3C7',  // amber-100
  warningDark: '#D97706',   // amber-600

  // Danger / Error
  danger: '#EF4444',        // red-500
  dangerLight: '#FEE2E2',   // red-100
  dangerDark: '#DC2626',    // red-600

  // Neutral — Text, backgrounds, borders
  text: '#0F172A',          // slate-900
  textSecondary: '#64748B', // slate-500
  textTertiary: '#94A3B8',  // slate-400
  textInverse: '#FFFFFF',

  background: '#F8FAFC',    // slate-50
  surface: '#FFFFFF',
  surfaceHover: '#F1F5F9',  // slate-100
  border: '#E2E8F0',        // slate-200
  borderLight: '#F1F5F9',   // slate-100
  divider: '#E2E8F0',

  // Specific use
  cardBg: '#FFFFFF',
  overlay: 'rgba(15, 23, 42, 0.5)',   // slate-900 at 50%
  shimmer: '#E2E8F0',

  // Info
  info: '#3B82F6',          // blue-500
  infoBg: '#EFF6FF',        // blue-50

  // Medicine type colors (for cards, chips)
  medicineTypes: {
    tablet: '#3B82F6',     // blue-500
    capsule: '#8B5CF6',    // violet-500
    syrup: '#F97316',      // orange-500
    injection: '#EF4444',  // red-500
    drops: '#06B6D4',      // cyan-500
    inhaler: '#10B981',    // emerald-500
    cream: '#EC4899',      // pink-500
    other: '#6B7280',      // gray-500
  },

  // Adherence status colors
  taken: '#10B981',
  missed: '#EF4444',
  snoozed: '#F59E0B',
  pending: '#94A3B8',

  // Chart colors
  chartPrimary: '#0891B2',
  chartSecondary: '#22D3EE',
  chartTrack: '#E2E8F0',
};

// ─── Typography ──────────────────────────────────────────────────
// Font family will be set after Inter loads; fallback to system
export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semiBold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  // Fallbacks for before font loads
  system: undefined, // Uses system default
};

export const typography = {
  // Display / Large titles
  h1: { fontSize: 28, fontFamily: fonts.bold, lineHeight: 36, color: colors.text },
  h2: { fontSize: 22, fontFamily: fonts.bold, lineHeight: 30, color: colors.text },
  h3: { fontSize: 18, fontFamily: fonts.semiBold, lineHeight: 26, color: colors.text },

  // Body
  body: { fontSize: 15, fontFamily: fonts.regular, lineHeight: 22, color: colors.text },
  bodyMedium: { fontSize: 15, fontFamily: fonts.medium, lineHeight: 22, color: colors.text },
  bodySemiBold: { fontSize: 15, fontFamily: fonts.semiBold, lineHeight: 22, color: colors.text },

  // Small / Captions
  caption: { fontSize: 13, fontFamily: fonts.regular, lineHeight: 18, color: colors.textSecondary },
  captionMedium: { fontSize: 13, fontFamily: fonts.medium, lineHeight: 18, color: colors.textSecondary },
  small: { fontSize: 11, fontFamily: fonts.medium, lineHeight: 16, color: colors.textTertiary },

  // Labels
  label: { fontSize: 14, fontFamily: fonts.semiBold, lineHeight: 20, color: colors.text },
  sectionLabel: { fontSize: 12, fontFamily: fonts.bold, lineHeight: 16, color: colors.textTertiary, letterSpacing: 0.8, textTransform: 'uppercase' },

  // Buttons
  button: { fontSize: 15, fontFamily: fonts.semiBold, lineHeight: 20 },
  buttonSmall: { fontSize: 13, fontFamily: fonts.semiBold, lineHeight: 18 },
};

// ─── Spacing Scale ───────────────────────────────────────────────
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  section: 40,
};

// ─── Border Radii ────────────────────────────────────────────────
export const radii = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  full: 999,
};

// ─── Shadows ─────────────────────────────────────────────────────
export const shadows = {
  sm: {
    shadowColor: '#006780',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: '#006780',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 4,
  },
  lg: {
    shadowColor: '#006780',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 8,
  },
  xl: {
    shadowColor: '#006780',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.1,
    shadowRadius: 32,
    elevation: 12,
  },
  colored: (color) => ({
    shadowColor: color,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 6,
  }),
};

// ─── Common Component Styles ─────────────────────────────────────
export const components = {
  // Standard card
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    ...shadows.sm,
  },

  // Elevated card
  cardElevated: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    ...shadows.md,
  },

  // Primary button
  buttonPrimary: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.colored(colors.primary),
  },

  // Secondary / outline button
  buttonSecondary: {
    backgroundColor: 'transparent',
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.primary,
  },

  // Danger button
  buttonDanger: {
    backgroundColor: colors.danger,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Input field
  input: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 15,
    color: colors.text,
  },

  // Chip / tag
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radii.full,
    backgroundColor: colors.primaryBg,
  },

  // Divider
  divider: {
    height: 1,
    backgroundColor: colors.divider,
    marginVertical: spacing.md,
  },

  // Section header
  sectionHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.sm,
  },

  // Screen container
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
};

// ─── Tab Bar Constants ───────────────────────────────────────────
export const tabBar = {
  height: 68,
  bottomInset: 16,
  horizontalInset: 16,
  borderRadius: 34,
  iconSize: 24,
  activeDotSize: 5,
};
