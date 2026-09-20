import { loadVendoredScript } from "../lib-loader.js";

/** Lazily load the vendored encoder used by TXT/ASCII exports. */
export async function ensureQrcodeLoaded() {
  return loadVendoredScript("src/lib/qrcode.min.js", "qrcode");
}

export function generateUnicodeQR(text, eccLevel) {
  if (typeof qrcode === "undefined") return null;
  try {
    const qr = qrcode(0, eccLevel);
    qr.addData(text);
    qr.make();
    const moduleCount = qr.getModuleCount();
    let unicode = "";
    const emptyRow = " ".repeat(moduleCount + 4) + "\r\n";
    unicode += emptyRow;
    for (let r = 0; r < moduleCount; r += 2) {
      unicode += "  ";
      for (let c = 0; c < moduleCount; c++) {
        const top = qr.isDark(r, c);
        const bottom = r + 1 < moduleCount ? qr.isDark(r + 1, c) : false;
        if (top && bottom) unicode += "█";
        else if (top && !bottom) unicode += "▀";
        else if (!top && bottom) unicode += "▄";
        else unicode += " ";
      }
      unicode += "  \r\n";
    }
    unicode += emptyRow;
    return unicode;
  } catch (e) {
    console.error(e);
    return null;
  }
}
