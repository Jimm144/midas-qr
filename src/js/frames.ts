/**
 * Frame geometry/font tables and built-in overall-mask silhouettes.
 * Split out of state.ts: pure render data consumed by generator/frame.js,
 * generator/mask.js and the share-URL validator.
 */

export interface FrameTextArea {
  x: number;
  y: number;
  size: number;
}

export interface FrameQrArea {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FrameConfig {
  svg: string;
  qrArea: FrameQrArea;
  textArea: FrameTextArea;
  /** Total viewBox height (24 without text, 28 with a text band). */
  vbHeight: number;
  /** Text colour: "fg" = dots colour (default), "bg" = background colour. */
  textColor?: "fg" | "bg";
  strokeWidth?: number;
  rx?: number;
  /**
   * Artwork used when the text band is hidden. Bar frames (label/badge) drop
   * their bar so no empty band remains; defaults to `svg`.
   */
  noTextSvg?: string;
  /** QR placement when the text band is hidden; defaults to `qrArea`. */
  noTextQrArea?: FrameQrArea;
}

/**
 * Frame text fonts. `stack` is the CSS font-family list used in the SVG text;
 * hosted families also carry the woff2 file so exports can embed the font
 * (SVG rendered into an <img>/canvas cannot fetch external fonts). "theme"
 * resolves to the active theme's stack at render time.
 */
export const FRAME_FONTS: {
  value: string;
  label: string;
  stack: string;
  family: string | null;
  file: string | null;
}[] = [
  { value: "theme", label: "Theme font", stack: "", family: null, file: null },
  {
    value: "figtree",
    label: "Figtree",
    stack: '"Figtree", system-ui, sans-serif',
    family: "Figtree",
    file: "src/fonts/figtree-var-latin.woff2",
  },
  {
    value: "montserrat",
    label: "Montserrat",
    stack: '"Montserrat", system-ui, sans-serif',
    family: "Montserrat",
    file: "src/fonts/montserrat-latin.woff2",
  },
  {
    value: "dmsans",
    label: "DM Sans",
    stack: '"DM Sans", system-ui, sans-serif',
    family: "DM Sans",
    file: "src/fonts/dm-sans-latin.woff2",
  },
  {
    value: "playwrite",
    label: "Playwrite US Trad",
    stack: '"Playwrite US Trad", system-ui, sans-serif',
    family: "Playwrite US Trad",
    file: "src/fonts/playwrite-us-trad-latin.woff2",
  },
  {
    value: "fustat",
    label: "Fustat",
    stack: '"Fustat", system-ui, sans-serif',
    family: "Fustat",
    file: "src/fonts/fustat-latin.woff2",
  },
  {
    value: "poppins",
    label: "Poppins",
    stack: '"Poppins", system-ui, sans-serif',
    family: "Poppins",
    file: "src/fonts/poppins-600-latin.woff2",
  },
  {
    value: "outfit",
    label: "Outfit",
    stack: '"Outfit", system-ui, sans-serif',
    family: "Outfit",
    file: "src/fonts/outfit-latin.woff2",
  },
  {
    value: "albertsans",
    label: "Albert Sans",
    stack: '"Albert Sans", system-ui, sans-serif',
    family: "Albert Sans",
    file: "src/fonts/albert-sans-latin.woff2",
  },
  {
    value: "fraunces",
    label: "Fraunces",
    stack: '"Fraunces", system-ui, sans-serif',
    family: "Fraunces",
    file: "src/fonts/fraunces-latin.woff2",
  },
  {
    value: "jetbrains",
    label: "JetBrains Mono",
    stack: '"JetBrains Mono", system-ui, sans-serif',
    family: "JetBrains Mono",
    file: "src/fonts/jetbrains-mono-latin.woff2",
  },
  {
    value: "unifraktur",
    label: "UnifrakturMaguntia",
    stack: '"UnifrakturMaguntia", system-ui, sans-serif',
    family: "UnifrakturMaguntia",
    file: "src/fonts/unifrakturmaguntia-latin.woff2",
  },
  {
    value: "inter",
    label: "Inter",
    stack: '"Inter", system-ui, sans-serif',
    family: "Inter",
    file: "src/fonts/inter-latin.woff2",
  },
  {
    value: "spacegrotesk",
    label: "Space Grotesk",
    stack: '"Space Grotesk", system-ui, sans-serif',
    family: "Space Grotesk",
    file: "src/fonts/space-grotesk-latin.woff2",
  },
  {
    value: "bebasneue",
    label: "Bebas Neue",
    stack: '"Bebas Neue", system-ui, sans-serif',
    family: "Bebas Neue",
    file: "src/fonts/bebas-neue-latin.woff2",
  },
  {
    value: "anton",
    label: "Anton",
    stack: '"Anton", system-ui, sans-serif',
    family: "Anton",
    file: "src/fonts/anton-latin.woff2",
  },
  {
    value: "archivoblack",
    label: "Archivo Black",
    stack: '"Archivo Black", system-ui, sans-serif',
    family: "Archivo Black",
    file: "src/fonts/archivo-black-latin.woff2",
  },
  {
    value: "merriweather",
    label: "Merriweather",
    stack: '"Merriweather", system-ui, serif',
    family: "Merriweather",
    file: "src/fonts/merriweather-latin.woff2",
  },
  {
    value: "lora",
    label: "Lora",
    stack: '"Lora", system-ui, serif',
    family: "Lora",
    file: "src/fonts/lora-latin.woff2",
  },
  {
    value: "spacemono",
    label: "Space Mono",
    stack: '"Space Mono", system-ui, monospace',
    family: "Space Mono",
    file: "src/fonts/space-mono-latin.woff2",
  },
  {
    value: "serif",
    label: "Serif (system)",
    stack: 'Georgia, "Times New Roman", serif',
    family: null,
    file: null,
  },
  {
    value: "cursive",
    label: "Cursive (system)",
    stack: '"Segoe Script", "Comic Sans MS", cursive',
    family: null,
    file: null,
  },
  {
    value: "fantasy",
    label: "Fantasy (system)",
    stack: "Impact, Papyrus, fantasy",
    family: null,
    file: null,
  },
  {
    value: "system",
    label: "System sans",
    stack: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    family: null,
    file: null,
  },
  {
    value: "mono",
    label: "Monospace",
    stack: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    family: null,
    file: null,
  },
];

/**
 * Built-in overall-shape silhouettes on a 24x24 viewBox (circle/heart/triangle
 * live in export.js as their own math). Used by the mask point-in-path test
 * and the background shape builder.
 */
export const BUILT_IN_MASK_PATHS: Record<string, string> = {
  star: "M12 2.2l2.94 6.05 6.66.9-4.85 4.63 1.2 6.62L12 17.1l-5.95 3.3 1.2-6.62L2.4 9.15l6.66-.9z",
  diamond: "M12 2l10 10-10 10L2 12z",
  hexagon: "M12 2l8.66 5v10L12 22l-8.66-5V7z",
  shield: "M12 2l8 3.2v6.1c0 5.1-3.4 8.9-8 10.7-4.6-1.8-8-5.6-8-10.7V5.2z",
};

export const framesConfig: Record<string, FrameConfig | null> = {
  none: null,
  scan: {
    svg: `<path d="M2.5 7.5v-3a2 2 0 0 1 2-2h3" /><path d="M16.5 2.5h3a2 2 0 0 1 2 2v3" /><path d="M21.5 16.5v3a2 2 0 0 1-2 2h-3" /><path d="M7.5 21.5h-3a2 2 0 0 1-2-2v-3" />`,
    qrArea: { x: 4, y: 4, w: 16, h: 16 },
    textArea: { x: 12, y: 24.85, size: 2.0 },
    vbHeight: 27.5,
    rx: 2,
  },
  dashed: {
    svg: `<rect x="2.5" y="2.5" width="19" height="19" rx="3.5" fill="none" stroke-dasharray="2.4 2" stroke-linecap="round" />`,
    qrArea: { x: 4, y: 4, w: 16, h: 16 },
    textArea: { x: 12, y: 24.85, size: 2.0 },
    vbHeight: 27.5,
    rx: 2,
  },
  rounded: {
    svg: `<rect x="2.5" y="2.5" width="19" height="19" rx="2" fill="none" />`,
    qrArea: { x: 4, y: 4, w: 16, h: 16 },
    textArea: { x: 12, y: 24.85, size: 2.0 },
    vbHeight: 27.5,
    rx: 2,
  },
  label: {
    svg: `<rect x="2.5" y="2.5" width="19" height="19" rx="2" fill="none" /><rect x="2.5" y="22.6" width="19" height="4.8" rx="1.5" fill="__ACCENT__" stroke="none" />`,
    qrArea: { x: 4, y: 4, w: 16, h: 16 },
    textArea: { x: 12, y: 25, size: 2.1 },
    vbHeight: 28,
    rx: 2,
    textColor: "bg",
    noTextSvg: `<rect x="2.5" y="2.5" width="19" height="19" rx="2" fill="none" />`,
  },
  badge: {
    svg: `<rect x="2.5" y="1.2" width="19" height="5.4" rx="1.5" fill="__ACCENT__" stroke="none" /><rect x="2.5" y="8.4" width="19" height="19" rx="2" fill="none" />`,
    qrArea: { x: 4, y: 9.9, w: 16, h: 16 },
    textArea: { x: 12, y: 3.9, size: 2.1 },
    vbHeight: 28,
    rx: 2,
    textColor: "bg",
    // Without the bar the QR re-centres in the full 24-unit square.
    noTextSvg: `<rect x="2.5" y="2.5" width="19" height="19" rx="2" fill="none" />`,
    noTextQrArea: { x: 4, y: 4, w: 16, h: 16 },
  },
};

/**
 * Per-style default for the frame-text toggle: open frames default to no text,
 * bar/plain frames to labelled. Applied on a real style change and used to
 * infer the value when a share URL omits an explicit override.
 */
export const FRAME_TEXT_DEFAULTS: Record<string, boolean> = {
  none: true,
  scan: false,
  dashed: false,
  rounded: false,
  label: true,
  badge: true,
};

/** Default frame-text visibility for a style; unknown styles keep text on. */
export function defaultFrameTextEnabled(style: string): boolean {
  return FRAME_TEXT_DEFAULTS[style] !== false;
}
