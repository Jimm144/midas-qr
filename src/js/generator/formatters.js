// @ts-check
/**
 * Pure QR payload formatters — no DOM dependency.
 * Each takes a plain object of field values and returns { str, isValid }.
 * This is the testable core extracted from compileDataString in generator.js.
 */

import { escapeWifiStr, escapeVCard } from "../utils.js";

/**
 * Invalid payloads report a translation key, never a sentence: the wording
 * lives in the catalogs (data-types.js calls `t(r.errorKey)`), so this module
 * stays pure and the two copies can no longer drift apart.
 * @param {string} str
 * @param {string} errorKey
 */
function invalid(str, errorKey) {
  return { str, isValid: false, errorKey };
}

// Raw whitespace or C0/DEL control characters never belong in a URL: they are
// the classic way a mistyped payload ("not a url") slips past `new URL`.
const URL_WHITESPACE_RE = /\s/;
function hasForbiddenUrlChars(str) {
  if (URL_WHITESPACE_RE.test(str)) return true;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}
// A leading `scheme:` token. `host:port` also matches, so it is disambiguated
// below by requiring a non-digit after the colon to count as a scheme.
const URL_SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i;
const HOST_PORT_RE = /^\d+([/?#]|$)/;

/** True when the string carries an explicit, non-http(s) scheme. */
function hasDisallowedScheme(str) {
  const match = URL_SCHEME_RE.exec(str);
  if (!match) return false;
  // `example.com:8080` / `localhost:3000`: a numeric tail is a port, not a scheme.
  if (HOST_PORT_RE.test(str.slice(match[0].length))) return false;
  const scheme = match[1].toLowerCase();
  return scheme !== "http" && scheme !== "https";
}

/**
 * A host is usable when it is `localhost`, an IP literal (IPv4 contains a dot;
 * IPv6 hostnames contain a colon), or a dotted domain. A single bare label
 * like `foo` is almost always a mistyped payload rather than a real host.
 * @param {string} hostname
 */
function hasUsableHost(hostname) {
  if (!hostname) return false;
  if (hostname === "localhost") return true;
  return hostname.includes(".") || hostname.includes(":");
}

/**
 * Validate a URL string (tolerant: prepends https:// if no scheme). Empty is
 * valid. Rejects whitespace/control characters, explicit non-http(s) schemes
 * (`javascript:`, `data:`, `file:`, `ftp:`), a scheme with no host, and a
 * dotless non-localhost host.
 */
export function checkUrlValid(str) {
  if (!str) return true;
  if (hasForbiddenUrlChars(str)) return false;
  if (hasDisallowedScheme(str)) return false;
  let testStr = str;
  if (!/^https?:\/\//i.test(testStr)) {
    testStr = "https://" + testStr;
  }
  try {
    return hasUsableHost(new URL(testStr).hostname);
  } catch (_err) {
    return false;
  }
}

/** Format URL payload, auto-prepending https:// when a scheme is missing. */
export function formatUrl(value) {
  const raw = (value || "").trim();
  if (!raw) return { str: "", isValid: true };
  // Reject bad schemes/characters on the raw value, before any https:// is
  // prepended, so `javascript:alert(1)` is refused because of its scheme
  // rather than incidentally because `new URL` chokes on the prefixed form.
  if (hasForbiddenUrlChars(raw) || hasDisallowedScheme(raw)) {
    return invalid(raw, "data.urlInvalid");
  }
  const str = /^https?:\/\//i.test(raw) ? raw : "https://" + raw;
  return checkUrlValid(str) ? { str, isValid: true } : invalid(str, "data.urlInvalid");
}

/** Format WIFI: payload from {ssid, pass, enc, hidden}. */
export function formatWifi({ ssid, pass, enc, hidden }) {
  const s = (ssid || "").trim();
  const p = pass || "";
  const encryption = enc || "WPA";
  const hasInput = s || p || encryption !== "WPA" || hidden;

  if (hasInput && !s) {
    return invalid("", "validation.ssidRequired");
  }
  if (!s) {
    return { str: "", isValid: true };
  }
  // The WIFI: payload grammar caps the SSID at 32 bytes; longer values are
  // silently truncated (or rejected) by scanners, so refuse them up front.
  if (s.length > 32) {
    return invalid("", "validation.ssidLong");
  }

  if (encryption === "WPA" || encryption === "WPA2") {
    if (!p) {
      return invalid("", "validation.wpaPasswordRequired");
    }
    if (p.length < 8) {
      return invalid("", "validation.wpaPasswordShort");
    }
    if (p.length > 63) {
      return invalid("", "validation.wpaPasswordLong");
    }
  } else if (encryption === "WEP") {
    if (!p) {
      return invalid("", "validation.wepPasswordRequired");
    }
    const isHex = /^[0-9a-fA-F]+$/.test(p);
    // WEP keys are 40/104-bit: 5/13 ASCII chars or 10/26 hex digits. The
    // 16-ASCII / 32-hex forms are NOT valid WEP keys.
    const validAscii = p.length === 5 || p.length === 13;
    const validHex = isHex && (p.length === 10 || p.length === 26);
    if (!validAscii && !validHex) {
      return invalid("", "validation.wepKey");
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

/**
 * vCard URL field is stricter than formatUrl: it must already carry an
 * explicit http(s) scheme (no auto-prepend, so `javascript:`/`data:` can never
 * be smuggled in) and resolve to a non-empty host. Empty stays valid.
 * @param {string} str
 */
function isExplicitHttpUrl(str) {
  if (hasForbiddenUrlChars(str)) return false;
  if (!/^https?:\/\//i.test(str)) return false;
  try {
    return Boolean(new URL(str).hostname);
  } catch (_err) {
    return false;
  }
}

// Pragmatic email validator: no spaces, single @, dot-separated domain.
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

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
    return invalid("", "data.contactRequired");
  }
  if (!hasRequired) {
    return { str: "", isValid: true };
  }
  const urlVal = typeof url === "string" ? url.trim() : "";
  if (urlVal && !isExplicitHttpUrl(urlVal)) {
    return invalid("", "validation.urlInvalid");
  }
  const emailVal = typeof email === "string" ? email.trim() : "";
  if (emailVal && !EMAIL_RE.test(emailVal)) {
    return invalid("", "validation.emailInvalid");
  }
  const telVal = typeof tel === "string" ? tel.trim() : "";
  if (telVal && !isValidPhone(telVal)) {
    return invalid("", "validation.phoneInvalid");
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
  if (urlVal) lines.push(`URL:${esc(urlVal)}`);
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
  // A payment amount must be a strictly positive finite number: reject `0`,
  // `0.0`, a leading `+`, and anything the decimal regex doesn't cover.
  const amountNum = /^\d*\.?\d+$/.test(amountVal) ? Number(amountVal) : NaN;
  const isAmountInvalid =
    Boolean(amountVal) && (!Number.isFinite(amountNum) || amountNum <= 0);
  const hasAnyCrypto = (address || "").trim() || amountVal;
  if ((hasAnyCrypto && !(address || "").trim()) || isAmountInvalid) {
    return invalid("", isAmountInvalid ? "validation.invalidAmount" : "validation.walletRequired");
  }
  if (!(address || "").trim()) {
    return { str: "", isValid: true };
  }

  const trimmedAddr = address.trim();
  const validator = CRYPTO_VALIDATORS[coin];
  if (validator && !validator(trimmedAddr)) {
    return invalid("", "validation.addressInvalid");
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
    const errorKey = isLatInvalid
      ? "validation.latitudeRange"
      : isLonInvalid
        ? "validation.longitudeRange"
        : !latVal && !lonVal
          ? "validation.coordinatesRequired"
          : !latVal
            ? "validation.latitudeRequired"
            : "validation.longitudeRequired";
    return invalid("", errorKey);
  }
  if (!latVal || !lonVal) {
    return { str: "", isValid: true };
  }
  return { str: `geo:${latVal},${lonVal}`, isValid: true };
}

/**
 * True for a real `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM` local date-time. The
 * shape alone is not enough: `2026-02-31T10:00` matches the regex but is not a
 * calendar date, and RFC 5545 requires a valid DATE value.
 * @param {string} value
 */
function isRealLocalDateTime(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(value || "");
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (match[4] !== undefined) {
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    if (hour > 23 || minute > 59) return false;
  }
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(year, month, 0).getDate();
}

/** Format iCalendar VEVENT payload. */
export function formatEvent({ title, start, end, location, description }) {
  const hasAnyEvent = title || start || end || location || description;
  if (hasAnyEvent && (!title || !start)) {
    return invalid("", "data.eventRequired");
  }
  if (!title || !start) {
    return { str: "", isValid: true };
  }
  if (!isRealLocalDateTime(start) || (end && !isRealLocalDateTime(end))) {
    return invalid("", "validation.invalidDate");
  }
  if (end && start && end < start) {
    return invalid("", "validation.endAfterStart");
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
  const messageVal = (message || "").trim();
  const isPhoneInvalid = phoneVal && !isValidPhone(phoneVal);
  const hasAnySms = phoneVal || messageVal;
  if ((hasAnySms && !phoneVal) || isPhoneInvalid) {
    return invalid("", isPhoneInvalid ? "validation.phoneInvalid" : "validation.phoneRequired");
  }
  if (!phoneVal) {
    return { str: "", isValid: true };
  }
  // 1600 chars is the practical ceiling for a single SMS QR payload; beyond
  // that scanners truncate or choke on the body.
  if (messageVal.length > 1600) {
    return invalid("", "validation.smsMessageTooLong");
  }
  // Encode only the characters that would break URI parsing (? = query start,
  // & = parameter separator, # = fragment start). Spaces and newlines stay
  // human-readable — decoders expect them raw in SMSTO bodies.
  const safeBody = messageVal.replace(/[?&#]/g, (c) => encodeURIComponent(c));
  return { str: `SMSTO:${phoneVal}:${safeBody}`, isValid: true };
}

/** Format tel: URI. */
export function formatPhone(phone) {
  const phoneVal = (phone || "").trim();
  const isPhoneInvalid = phoneVal && !isValidPhone(phoneVal);
  if (isPhoneInvalid) {
    return invalid("", "validation.phoneInvalid");
  }
  if (!phoneVal) {
    return { str: "", isValid: true };
  }
  return { str: `tel:${phoneVal}`, isValid: true };
}

/** Format mailto: URI from {to, subject, body}. */
export function formatEmail({ to, subject, body }) {
  const toVal = (to || "").trim();
  const subjectVal = (subject || "").trim();
  const bodyVal = (body || "").trim();
  const hasAnyEmail = toVal || subjectVal || bodyVal;
  if (hasAnyEmail && !toVal) {
    return invalid("", "validation.emailRequired");
  }
  if (toVal) {
    // RFC 5321 practical limits: 254 chars for the whole address, 64 for the
    // local part. A too-long address is un-deliverable, so reject it.
    const atIndex = toVal.indexOf("@");
    const localPart = atIndex === -1 ? toVal : toVal.slice(0, atIndex);
    if (toVal.length > 254 || localPart.length > 64 || !EMAIL_RE.test(toVal)) {
      return invalid("", "validation.emailInvalid");
    }
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
