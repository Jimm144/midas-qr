/**
 * Theme token families (Astryx-ported) and their typography.
 * Split out of state.ts: these are pure data, read by theme-runtime.js and
 * buildCssVarMap, and have no dependency on application state.
 */

export interface ThemeVariant {
  bg: string;
  accent: string;
  accentContrast: string;
  accentSoft: string;
  text: string;
  surface: string;
  bgElevated: string;
  inset: string;
  border: string;
  borderStrong: string;
  muted: string;
  danger: string;
  success: string;
  warning: string;
  shadowPop: string;
  shadowColor: string;
  radiusInner: string;
  radiusElement: string;
  radiusContainer: string;
  buttonRadius: string;
}

export interface ThemeFamily {
  dark: ThemeVariant;
  light: ThemeVariant;
  /** UI typography applied by applyTheme (all self-hosted). */
  fonts: { body: string; heading: string; code: string };
}

/**
 * Theme families ported 1:1 from the Astryx theme packages
 * (facebook/astryx, packages/themes): Neutral, Stone, Matcha, Gothic,
 * Y2K, Butter, Chocolate. Values map from Astryx semantic tokens:
 * background-body → bg, background-card → surface, background-popover →
 * bgElevated, background-muted → inset, border/border-emphasized →
 * border/borderStrong, text-primary/secondary → text/muted, accent /
 * accent-muted / on-accent → accent / accentSoft / accentContrast.
 * Gothic ships dark-only, so both variants share its dark palette.
 */
/** Theme typography (facebook/astryx packages/themes): body, heading and code stacks. */
const SANS_FALLBACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const SERIF_FALLBACK = 'Georgia, "Times New Roman", Times, serif';
const MONO_FALLBACK = '"SF Mono", Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

const THEME_FONTS: Record<
  string,
  { body: string; heading: string; display: string; code: string; scale: number; headingWeight: string }
> = {
  neutral: {
    body: `"Figtree", ${SANS_FALLBACK}`,
    heading: `"Figtree", ${SANS_FALLBACK}`,
    display: `"Figtree", ${SANS_FALLBACK}`,
    code: `ui-monospace, ${MONO_FALLBACK}`,
    scale: 14,
    headingWeight: "600",
  },
  stone: {
    body: `"Figtree", ${SANS_FALLBACK}`,
    heading: `"Montserrat", "Figtree", ${SANS_FALLBACK}`,
    display: `"Montserrat", "Figtree", ${SANS_FALLBACK}`,
    code: `"JetBrains Mono", ${MONO_FALLBACK}`,
    scale: 14,
    headingWeight: "700",
  },
  matcha: {
    body: `"DM Sans", ${SANS_FALLBACK}`,
    heading: `"Playwrite US Trad", ${SERIF_FALLBACK}`,
    display: `"Playwrite US Trad", ${SERIF_FALLBACK}`,
    code: `"JetBrains Mono", ${MONO_FALLBACK}`,
    scale: 16,
    headingWeight: "600",
  },
  gothic: {
    body: `"Fustat", ${SANS_FALLBACK}`,
    heading: `"UnifrakturMaguntia", "Manufacturing Consent", "Old English Text MT", serif`,
    display: `"Manufacturing Consent", "UnifrakturMaguntia", "Old English Text MT", serif`,
    code: `"JetBrains Mono", ${MONO_FALLBACK}`,
    scale: 16,
    headingWeight: "700",
  },
  y2k: {
    body: `"Poppins", ${SANS_FALLBACK}`,
    heading: `"Poppins", ${SANS_FALLBACK}`,
    display: `"Poppins", ${SANS_FALLBACK}`,
    code: `"JetBrains Mono", ${MONO_FALLBACK}`,
    scale: 16,
    headingWeight: "600",
  },
  butter: {
    body: `"Outfit", ${SANS_FALLBACK}`,
    heading: `"Outfit", ${SANS_FALLBACK}`,
    display: `"Outfit", ${SANS_FALLBACK}`,
    code: `"JetBrains Mono", ${MONO_FALLBACK}`,
    scale: 14,
    headingWeight: "700",
  },
  chocolate: {
    body: `"Albert Sans", ${SANS_FALLBACK}`,
    heading: `"Fraunces", ${SERIF_FALLBACK}`,
    display: `"Fraunces", ${SERIF_FALLBACK}`,
    code: `"JetBrains Mono", ${MONO_FALLBACK}`,
    scale: 14,
    headingWeight: "700",
  },
};

export const themes: Record<string, ThemeFamily> = {
  neutral: {
    fonts: THEME_FONTS.neutral,
    dark: {
      bg: "#111112",
      surface: "#1F1F22",
      bgElevated: "#28292C",
      inset: "#161618",
      border: "rgba(255, 255, 255, 0.10)",
      borderStrong: "#525252",
      text: "#FAFAFA",
      muted: "#A3A3A3",
      accent: "#EBEBEB",
      accentContrast: "#111112",
      accentSoft: "rgba(255, 255, 255, 0.08)",
      danger: "#FFC6C1",
      success: "#9FE59B",
      warning: "#FDCF4F",
      shadowPop: "0 16px 40px rgba(0, 0, 0, 0.5), 0 4px 12px rgba(0, 0, 0, 0.35)",
      shadowColor: "#000000",
      radiusInner: "8px",
      radiusElement: "12px",
      radiusContainer: "16px",
      buttonRadius: "12px",
    },
    light: {
      bg: "#F1F1F1",
      surface: "#FFFFFF",
      bgElevated: "#EBEBEB",
      inset: "#FFFFFF",
      border: "rgba(0, 0, 0, 0.08)",
      borderStrong: "#A6A6A6",
      text: "#171717",
      muted: "#525252",
      accent: "#262626",
      accentContrast: "#FFFFFF",
      accentSoft: "rgba(0, 0, 0, 0.05)",
      danger: "#A50C25",
      success: "#007004",
      warning: "#745B00",
      shadowPop: "0 16px 40px rgba(23, 23, 23, 0.16), 0 4px 12px rgba(23, 23, 23, 0.08)",
      shadowColor: "#171717",
      radiusInner: "8px",
      radiusElement: "12px",
      radiusContainer: "16px",
      buttonRadius: "12px",
    },
  },
  stone: {
    fonts: THEME_FONTS.stone,
    dark: {
      bg: "#111015",
      surface: "#242325",
      bgElevated: "#2F2E33",
      inset: "#1B1B1F",
      border: "rgba(243, 243, 245, 0.10)",
      borderStrong: "#5E5E61",
      text: "#F3F3F5",
      muted: "#ABABB0",
      accent: "#F3F3F5",
      accentContrast: "#242325",
      accentSoft: "rgba(243, 243, 245, 0.13)",
      danger: "#DCC0BC",
      success: "#B4CDB2",
      warning: "#D7C59C",
      shadowPop: "0 12px 24px rgba(0, 0, 0, 0.30), 0 4px 6px rgba(0, 0, 0, 0.25)",
      shadowColor: "#000000",
      radiusInner: "4px",
      radiusElement: "8px",
      radiusContainer: "12px",
      buttonRadius: "9999px",
    },
    light: {
      bg: "#F3F3F5",
      surface: "#FFFFFF",
      bgElevated: "#F3F3F5",
      inset: "#FFFFFF",
      border: "#E2E2E8",
      borderStrong: "#83838A",
      text: "#25252A",
      muted: "#5E5E63",
      accent: "#25252A",
      accentContrast: "#FFFFFF",
      accentSoft: "rgba(37, 37, 42, 0.08)",
      danger: "#58413E",
      success: "#374C36",
      warning: "#524622",
      shadowPop: "0 12px 24px rgba(37, 37, 42, 0.15), 0 4px 6px rgba(37, 37, 42, 0.10)",
      shadowColor: "#25252A",
      radiusInner: "4px",
      radiusElement: "8px",
      radiusContainer: "12px",
      buttonRadius: "9999px",
    },
  },
  matcha: {
    fonts: THEME_FONTS.matcha,
    dark: {
      bg: "#12140E",
      surface: "#1E2016",
      bgElevated: "#282C1E",
      inset: "#161811",
      border: "rgba(192, 203, 169, 0.10)",
      borderStrong: "#5A6440",
      text: "#C0CBA9",
      muted: "#94A468",
      accent: "#C0CBA9",
      accentContrast: "#1E2016",
      accentSoft: "rgba(192, 203, 169, 0.13)",
      danger: "#FF5C5C",
      success: "#6DBF2A",
      warning: "#FFC940",
      shadowPop: "0 12px 24px rgba(0, 0, 0, 0.35), 0 4px 6px rgba(0, 0, 0, 0.25)",
      shadowColor: "#000000",
      radiusInner: "6px",
      radiusElement: "12px",
      radiusContainer: "18px",
      buttonRadius: "9999px",
    },
    light: {
      bg: "#F0F0E0",
      surface: "#FFFFFF",
      bgElevated: "#E2E5D5",
      inset: "#FFFFFF",
      border: "#DCE3CE",
      borderStrong: "#B7C29E",
      text: "#3E481D",
      // Darkened from #707E46: the old value failed 4.5:1 on bgElevated
      // (3.44) and surface (4.41) for label/muted text.
      muted: "#5C6836",
      accent: "#3E481D",
      accentContrast: "#FFFFFF",
      accentSoft: "rgba(62, 72, 29, 0.08)",
      danger: "#C42B2B",
      success: "#3D7A00",
      warning: "#8A6200",
      shadowPop: "0 12px 24px rgba(62, 72, 29, 0.15), 0 4px 6px rgba(62, 72, 29, 0.10)",
      shadowColor: "#3E481D",
      radiusInner: "6px",
      radiusElement: "12px",
      radiusContainer: "18px",
      buttonRadius: "9999px",
    },
  },
  gothic: {
    fonts: THEME_FONTS.gothic,
    dark: {
      bg: "#101314",
      surface: "#1A1D20",
      bgElevated: "#24292D",
      inset: "#131618",
      border: "rgba(232, 241, 246, 0.10)",
      borderStrong: "#495056",
      text: "#E8F1F6",
      muted: "#96A0AB",
      accent: "#E8F1F6",
      accentContrast: "#101314",
      accentSoft: "rgba(232, 241, 246, 0.13)",
      danger: "#C6A6A2",
      success: "#B3C79A",
      warning: "#D3C490",
      shadowPop: "0 12px 24px rgba(0, 0, 0, 0.30), 0 4px 6px rgba(0, 0, 0, 0.25)",
      shadowColor: "#000000",
      radiusInner: "4px",
      radiusElement: "8px",
      radiusContainer: "12px",
      buttonRadius: "8px",
    },
    light: {
      bg: "#101314",
      surface: "#1A1D20",
      bgElevated: "#24292D",
      inset: "#131618",
      border: "rgba(232, 241, 246, 0.10)",
      borderStrong: "#495056",
      text: "#E8F1F6",
      muted: "#96A0AB",
      accent: "#E8F1F6",
      accentContrast: "#101314",
      accentSoft: "rgba(232, 241, 246, 0.13)",
      danger: "#C6A6A2",
      success: "#B3C79A",
      warning: "#D3C490",
      shadowPop: "0 12px 24px rgba(0, 0, 0, 0.30), 0 4px 6px rgba(0, 0, 0, 0.25)",
      shadowColor: "#000000",
      radiusInner: "4px",
      radiusElement: "8px",
      radiusContainer: "12px",
      buttonRadius: "8px",
    },
  },
  y2k: {
    fonts: THEME_FONTS.y2k,
    dark: {
      bg: "#0E0F1A",
      surface: "#16182B",
      bgElevated: "#21243D",
      inset: "#11121E",
      border: "rgba(237, 239, 252, 0.10)",
      borderStrong: "#3A3F5E",
      text: "#EDEFFC",
      muted: "#A6ACD6",
      accent: "#CCCFFA",
      accentContrast: "#0E0F1A",
      accentSoft: "rgba(204, 207, 250, 0.13)",
      danger: "#FFC5C3",
      success: "#C5E17A",
      warning: "#FFE08A",
      shadowPop: "0 12px 24px rgba(0, 0, 0, 0.35), 0 4px 6px rgba(0, 0, 0, 0.25)",
      shadowColor: "#000000",
      radiusInner: "0px",
      radiusElement: "0px",
      radiusContainer: "0px",
      buttonRadius: "0px",
    },
    light: {
      bg: "#CCCFFA",
      surface: "#FFFFFF",
      bgElevated: "#E8EAFE",
      inset: "#FFFFFF",
      border: "#2F292E",
      borderStrong: "#2F292E",
      text: "#2D241B",
      // Darkened from #675D52: the old value failed 4.5:1 on bg (4.25).
      muted: "#5E554A",
      accent: "#2D241B",
      accentContrast: "#FFFFFF",
      accentSoft: "rgba(45, 36, 27, 0.08)",
      danger: "#8B1D24",
      success: "#3A5500",
      warning: "#614400",
      shadowPop: "0 12px 24px rgba(45, 36, 27, 0.18), 0 4px 6px rgba(45, 36, 27, 0.12)",
      shadowColor: "#2D241B",
      radiusInner: "0px",
      radiusElement: "0px",
      radiusContainer: "0px",
      buttonRadius: "0px",
    },
  },
  butter: {
    fonts: THEME_FONTS.butter,
    dark: {
      bg: "#261A13",
      surface: "#3A2A1F",
      bgElevated: "#463426",
      inset: "#20150F",
      border: "rgba(243, 242, 226, 0.10)",
      borderStrong: "#939184",
      text: "#F3F2E2",
      muted: "#ADAC9E",
      accent: "#FDEE8C",
      accentContrast: "#1D1C11",
      accentSoft: "rgba(253, 238, 140, 0.15)",
      danger: "#FFB4A6",
      success: "#99D94B",
      warning: "#F7BE00",
      shadowPop: "0 12px 24px rgba(0, 0, 0, 0.35), 0 4px 6px rgba(0, 0, 0, 0.25)",
      shadowColor: "#000000",
      radiusInner: "6px",
      radiusElement: "8px",
      radiusContainer: "12px",
      buttonRadius: "8px",
    },
    light: {
      bg: "#FDFBE4",
      surface: "#FFFFFF",
      bgElevated: "#F5F3D8",
      inset: "#FFFFFF",
      border: "#E5E3D4",
      borderStrong: "#C7C4B2",
      text: "#1D1C11",
      muted: "#605F52",
      accent: "#225BFF",
      accentContrast: "#FFFFFF",
      accentSoft: "rgba(34, 91, 255, 0.08)",
      danger: "#771210",
      success: "#004700",
      warning: "#543700",
      shadowPop: "0 12px 24px rgba(29, 28, 17, 0.15), 0 4px 6px rgba(29, 28, 17, 0.10)",
      shadowColor: "#1D1C11",
      radiusInner: "6px",
      radiusElement: "8px",
      radiusContainer: "12px",
      buttonRadius: "8px",
    },
  },
  chocolate: {
    fonts: THEME_FONTS.chocolate,
    dark: {
      bg: "#141010",
      surface: "#2A2018",
      bgElevated: "#36291F",
      inset: "#181310",
      border: "rgba(237, 228, 212, 0.10)",
      borderStrong: "#6B5540",
      text: "#EDE4D4",
      muted: "#C4A882",
      accent: "#D4A06A",
      accentContrast: "#141010",
      accentSoft: "rgba(212, 160, 106, 0.13)",
      danger: "#FF5C5C",
      success: "#96BF2A",
      warning: "#FFC940",
      shadowPop: "0 12px 24px rgba(0, 0, 0, 0.35), 0 4px 6px rgba(0, 0, 0, 0.25)",
      shadowColor: "#000000",
      radiusInner: "6px",
      radiusElement: "10px",
      radiusContainer: "12px",
      buttonRadius: "9999px",
    },
    light: {
      bg: "#FFFCF7",
      surface: "#EDE4D4",
      bgElevated: "#F7EFE4",
      inset: "#FFFFFF",
      border: "#C4AC95",
      borderStrong: "#B88859",
      text: "#4A3520",
      // Darkened from #B88859: the old value failed 4.5:1 on every light
      // chocolate surface (2.48 surface, 2.75 bgElevated, 3.06 bg).
      muted: "#7A5228",
      accent: "#8C5927",
      accentContrast: "#FFFFFF",
      accentSoft: "rgba(140, 89, 39, 0.08)",
      danger: "#B3261E",
      success: "#3E5500",
      warning: "#7A4F00",
      shadowPop: "0 12px 24px rgba(74, 53, 32, 0.15), 0 4px 6px rgba(74, 53, 32, 0.10)",
      shadowColor: "#4A3520",
      radiusInner: "6px",
      radiusElement: "10px",
      radiusContainer: "12px",
      buttonRadius: "9999px",
    },
  },
};
