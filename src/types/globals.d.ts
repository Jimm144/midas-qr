/** Ambient global declarations for vendored/CDN libraries that aren't typed ES modules. */

/** qr-code-styling global, loaded via CDN or src/lib/qr-code-styling.min.js. */
declare class QRCodeStyling {
  constructor(options: Record<string, unknown>);
  update(options: Record<string, unknown>): void;
  getRawData(ext: string): Promise<Blob>;
  download(opts: { name: string; extension: string }): void;
  append(container: HTMLElement): void;
}

/** qrcode.js global, loaded via src/lib/qrcode.min.js. */
declare function qrcode(
  typeNumber: number,
  errorCorrectionLevel: string
): {
  addData(data: string): void;
  make(): void;
  getModuleCount(): number;
  isDark(row: number, col: number): boolean;
};

/** jsQR global, loaded via CDN or src/lib/jsqr.min.js. */
declare function jsQR(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  opts?: { inversionAttempts?: string }
): { data: string } | null;