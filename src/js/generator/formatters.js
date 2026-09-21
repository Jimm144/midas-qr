// @ts-check
/**
 * Pure QR payload formatters — no DOM dependency.
 * Each takes a plain object of field values and returns { str, isValid }.
 * This is the testable core extracted from compileDataString in generator.js.
 */

import { escapeWifiStr, escapeVCard } from "../utils.js";

/** Validate a URL string (tolerant: prepends https:// if no scheme). */
export function checkUrlValid(str) {
  if (!str) return true;
  let testStr = str;
  if (!/^https?:\/\//i.test(testStr)) {
    testStr = "https://" + testStr;
  }
  try {
    new URL(testStr);
    return true;
  } catch (_err) {
    return false;
  }
}

/** Format URL payload, auto-prepending https:// when a scheme is missing. */
export function formatUrl(value) {
  const str = (value || "").trim();
  if (!str) return { str: "", isValid: true };
  if (!/^https?:\/\//i.test(str)) {
    return { str: "https://" + str, isValid: checkUrlValid(str) };
  }
  return { str, isValid: checkUrlValid(str) };
}

/** Format WIFI: payload from {ssid, pass, enc, hidden}. */
export function formatWifi({ ssid, pass, enc, hidden }) {
  const s = (ssid || "").trim();
  const p = pass || "";
  const encryption = enc || "WPA";
  const hasInput = s || p || encryption !== "WPA" || hidden;

  if (hasInput && !s) {
    return { str: "", isValid: false, error: "Network name (SSID) is required" };
  }
  if (!s) {
    return { str: "", isValid: true };
  }

  if (encryption === "WPA" || encryption === "WPA2") {
    if (!p) {
      return { str: "", isValid: false, error: "Password is required for WPA network" };
    }
    if (p.length < 8) {
      return { str: "", isValid: false, error: "WPA password must be at least 8 characters" };
    }
    if (p.length > 63) {
      return { str: "", isValid: false, error: "WPA password must be at most 63 characters" };
    }
  } else if (encryption === "WEP") {
    if (!p) {
      return { str: "", isValid: false, error: "Password is required for WEP network" };
    }
    const isHex = /^[0-9a-fA-F]+$/.test(p);
    const validAscii = p.length === 5 || p.length === 13 || p.length === 16;
    const validHex = isHex && (p.length === 10 || p.length === 26 || p.length === 32);
    if (!validAscii && !validHex) {
      return {
        str: "",
        isValid: false,
        error: "WEP key must be 5 or 13 characters (or 10/26 hex digits)",
      };
    }
  }

  const eSsid = escapeWifiStr(s);
  const ePass = escapeWifiStr(p);
  const h = hidden ? "true" : "false";
  const str =
    encryption === "nopass"
      ? `WIFI:S:${eSsid};T:nopass;H:${h};;`
      : `WIFI:S:${eSsid};T:${encryption};P:${ePass};H:${h};;`;
  return { str, isValid: true };
}

/** Format vCard 3.0 from contact fields object. */
export function formatVCard(c) {
  const {
    first: fn,
    last: ln,
    org,
    title,
    tel,
    work,
    fax,
    email,
    url,
    street,
    city,
    stateProv,
    zip,
    country,
  } = c || {};
  const hasAnyInput =
    fn ||
    ln ||
    org ||
    title ||
    tel ||
    work ||
    fax ||
    email ||
    url ||
    street ||
    city ||
    stateProv ||
    zip ||
    country;
  const nonBlank = (v) => typeof v === "string" && v.trim() !== "";
  const hasRequired = nonBlank(fn) || nonBlank(ln) || nonBlank(tel) || nonBlank(email);
  if (hasAnyInput && !hasRequired) {
    return { str: "", isValid: false };
  }
  if (!hasRequired) {
    return { str: "", isValid: true };
  }
  const esc = escapeVCard;
  // FN is required by strict parsers and must never be a bare space: prefer
  // the display name, fall back to org/email/phone when only those exist.
  const name =
    [fn, ln]
      .map((part) => (typeof part === "string" ? part.trim() : ""))
      .filter(Boolean)
      .join(" ") ||
    org ||
    email ||
    tel ||
    "";
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `N:${esc(ln)};${esc(fn)};;;`];
  if (name) lines.push(`FN:${esc(name)}`);
  if (org) lines.push(`ORG:${esc(org)}`);
  if (title) lines.push(`TITLE:${esc(title)}`);
  if (tel) lines.push(`TEL;TYPE=CELL:${esc(tel)}`);
  if (work) lines.push(`TEL;TYPE=WORK,VOICE:${esc(work)}`);
  if (fax) lines.push(`TEL;TYPE=WORK,FAX:${esc(fax)}`);
  if (email) lines.push(`EMAIL:${esc(email)}`);
  if (url) lines.push(`URL:${esc(url)}`);
  if (street || city || stateProv || zip || country) {
    lines.push(`ADR;TYPE=WORK:;;${esc(street)};${esc(city)};${esc(stateProv)};${esc(zip)};${esc(country)}`);
  }
  lines.push("END:VCARD");
  return { str: lines.map(foldLine).join("\r\n"), isValid: true };
}

/**
 * Fold a content line at 75 chars (RFC 2426 / RFC 5545). Continuation lines
 * lead with one space, and that space counts toward the limit, so subsequent
 * chunks carry at most 74 chars. Never splits a surrogate pair.
 */
function foldLine(line) {
  if (line.length <= 75) return line;
  const chunks = [];
  let rest = line;
  let limit = 75;
  while (rest.length > limit) {
    let sliceLen = limit;
    const lastCode = rest.charCodeAt(sliceLen - 1);
    if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
      sliceLen -= 1;
    }
    chunks.push(rest.slice(0, sliceLen));
    rest = rest.slice(sliceLen);
    limit = 74;
  }
  chunks.push(rest);
  return chunks.join("\r\n ");
}

// Loose but useful per-coin address validators. These reject obviously
// wrong-network addresses (e.g. a Bitcoin address selected under "ethereum")
// which would otherwise silently generate a QR that misdirects funds.
const CRYPTO_VALIDATORS = {
  // P2PKH/P2SH/Bech32 (BC1...)
  bitcoin: (a) => /^(1|3|bc1)[a-zA-HJ-NP-Z0-9]{25,62}$/.test(a) || /^[A-F0-9]{64}$/.test(a),
  litecoin: (a) => /^(L|M|ltc1)[a-zA-HJ-NP-Z0-9]{25,62}$/.test(a) || /^[A-F0-9]{64}$/.test(a),
  bitcoincash: (a) => /^bitcoincash:q[a-z0-9]{41}$/.test(a) || /^q[a-z0-9]{41}$/.test(a),
  dash: (a) => /^X[1-9A-HJ-NP-Za-km-z]{33}$/.test(a),
  // EIP-55 checksum or all-lowercase / all-uppercase (no mixed unless checksummed)
  ethereum: (a) => /^0x[a-fA-F0-9]{40}$/.test(a),
  // Monero: standard addresses are 95 base58 chars, optionally 8-base58 leading "Address is invalid"
  monero: (a) => /^[1-9A-HJ-NP-Za-km-z]{95}$/.test(a) || /^[1-9A-HJ-NP-Za-km-z]{106}$/.test(a),
};

/** Format crypto URI (e.g. bitcoin:<addr>?amount=<amount>). */
export function formatCrypto({ coin, address, amount }) {
  const amountVal = (amount || "").trim();
  const isAmountInvalid = amountVal && !/^\d*\.?\d+$/.test(amountVal);
  const hasAnyCrypto = (address || "").trim() || amountVal;
  if ((hasAnyCrypto && !(address || "").trim()) || isAmountInvalid) {
    const reason = isAmountInvalid ? "Invalid amount" : "Wallet address is required";
    return { str: "", isValid: false, error: reason };
  }
  if (!(address || "").trim()) {
    return { str: "", isValid: true };
  }

  const trimmedAddr = address.trim();
  const validator = CRYPTO_VALIDATORS[coin];
  if (validator && !validator(trimmedAddr)) {
    return { str: "", isValid: false, error: "Address is invalid for the selected coin" };
  }

  const addr = trimmedAddr.startsWith("bitcoincash:") ? trimmedAddr.slice(12) : trimmedAddr;
  let str = `${coin}:${encodeURIComponent(addr)}`;
  if (amountVal && !isNaN(Number(amountVal))) {
    const param = coin === "ethereum" ? "value" : coin === "monero" ? "tx_amount" : "amount";
    str += `?${param}=${encodeURIComponent(amountVal)}`;
  }
  return { str, isValid: true };
}

/** Format geo: URI from latitude/longitude. */
export function formatGeo({ lat, lon }) {
  const latVal = (lat || "").trim();
  const lonVal = (lon || "").trim();
  const isLatInvalid =
    latVal && (!/^-?\d*\.?\d+$/.test(latVal) || Number(latVal) < -90 || Number(latVal) > 90);
  const isLonInvalid =
    lonVal && (!/^-?\d*\.?\d+$/.test(lonVal) || Number(lonVal) < -180 || Number(lonVal) > 180);
  const hasAnyGeo = latVal || lonVal;
  if ((hasAnyGeo && (!latVal || !lonVal)) || isLatInvalid || isLonInvalid) {
    const reason = isLatInvalid
      ? "Latitude must be between -90 and 90"
      : isLonInvalid
        ? "Longitude must be between -180 and 180"
        : !latVal && !lonVal
          ? "Latitude and longitude are required"
          : !latVal
            ? "Latitude is required"
            : "Longitude is required";
    return { str: "", isValid: false, error: reason };
  }
  if (!latVal || !lonVal) {
    return { str: "", isValid: true };
  }
  return { str: `geo:${latVal},${lonVal}`, isValid: true };
}

/** Format iCalendar VEVENT payload. */
export function formatEvent({ title, start, end, location, description }) {
  const hasAnyEvent = title || start || end || location || description;
  if (hasAnyEvent && (!title || !start)) {
    return { str: "", isValid: false };
  }
  if (!title || !start) {
    return { str: "", isValid: true };
  }
  if (end && start && end < start) {
    return { str: "", isValid: false, error: "End time must be after the start time" };
  }
  const fmtDate = (d) => {
    const clean = d.replace(/[-:]/g, "");
    return /^\d{8}T\d{4}$/.test(clean) ? clean + "00" : clean;
  };
  const esc = escapeVCard;
  const uid = `qr-${Date.now()}@qrcodestudio`;
  const now = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Midas QR//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `SUMMARY:${esc(title)}`,
    `DTSTART:${fmtDate(start)}`,
  ];
  if (end) lines.push(`DTEND:${fmtDate(end)}`);
  if (location) lines.push(`LOCATION:${esc(location)}`);
  if (description) lines.push(`DESCRIPTION:${esc(description)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  // Long SUMMARY/DESCRIPTION values must be folded at 75 octets (RFC 5545),
  // same continuation rule as vCard.
  return { str: lines.map(foldLine).join("\r\n"), isValid: true };
}

// Reasonably strict international phone validator: optional leading +,
// digits and common separators (space, dash, dot, parentheses), and 7-15
// digits total. Rejects garbage like "+--+()()1" which previously passed and
// produced malformed tel:/smsto: URIs.
const PHONE_SEPARATORS = /[().\- ]/g;
function isValidPhone(value) {
  if (!value) return false;
  const stripped = value.replace(PHONE_SEPARATORS, "");
  if (!/^\+?\d+$/.test(stripped)) return false;
  const digitCount = stripped.replace(/\+/g, "").length;
  return digitCount >= 7 && digitCount <= 15;
}

/** Format sms:to URI. */
export function formatSms({ phone, message }) {
  const phoneVal = (phone || "").trim();
  const isPhoneInvalid = phoneVal && !isValidPhone(phoneVal);
  const hasAnySms = phoneVal || (message || "").trim();
  if ((hasAnySms && !phoneVal) || isPhoneInvalid) {
    const reason = isPhoneInvalid ? "Invalid phone number" : "Phone number is required";
    return { str: "", isValid: false, error: reason };
  }
  if (!phoneVal) {
    return { str: "", isValid: true };
  }
  // Encode only the characters that would break URI parsing (? = query start,
  // & = parameter separator, # = fragment start). Spaces and newlines stay
  // human-readable — decoders expect them raw in SMSTO bodies.
  const safeBody = (message || "").trim().replace(/[?&#]/g, (c) => encodeURIComponent(c));
  return { str: `SMSTO:${phoneVal}:${safeBody}`, isValid: true };
}

/** Format tel: URI. */
export function formatPhone(phone) {
  const phoneVal = (phone || "").trim();
  const isPhoneInvalid = phoneVal && !isValidPhone(phoneVal);
  if (isPhoneInvalid) {
    return { str: "", isValid: false, error: "Invalid phone number" };
  }
  if (!phoneVal) {
    return { str: "", isValid: true };
  }
  return { str: `tel:${phoneVal}`, isValid: true };
}

// Pragmatic email validator: no spaces, single @, dot-separated domain.
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

/** Format mailto: URI from {to, subject, body}. */
export function formatEmail({ to, subject, body }) {
  const toVal = (to || "").trim();
  const subjectVal = (subject || "").trim();
  const bodyVal = (body || "").trim();
  const hasAnyEmail = toVal || subjectVal || bodyVal;
  if (hasAnyEmail && !toVal) {
    return { str: "", isValid: false, error: "Email address is required" };
  }
  if (toVal && !EMAIL_RE.test(toVal)) {
    return { str: "", isValid: false, error: "Invalid email address" };
  }
  if (!toVal) {
    return { str: "", isValid: true };
  }
  let str = `mailto:${toVal}`;
  const params = [];
  if (subjectVal) params.push(`subject=${encodeURIComponent(subjectVal)}`);
  if (bodyVal) params.push(`body=${encodeURIComponent(bodyVal)}`);
  if (params.length) str += `?${params.join("&")}`;
  return { str, isValid: true };
}
