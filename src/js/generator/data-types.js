// @ts-check
/**
 * Per-type registry for the generator payload. Each entry owns the form
 * fields one data type reads, how it compiles those fields into a data
 * string (with its warnings/aria wiring), and how a decoded data string is
 * parsed back into the fields. generator.compileDataString and
 * share.populateInputsFromState are generic lookups over this table.
 */
import { t } from "../i18n.js";
import {
  formatUrl,
  formatWifi,
  formatVCard,
  formatCrypto,
  formatGeo,
  formatEvent,
  formatSms,
  formatPhone,
  formatEmail,
} from "./formatters.js";

/**
 * @typedef {Record<string, any>} DomRefs
 * @typedef {{
 *   DOM: DomRefs,
 *   showWarnings: boolean,
 *   setWarning: (el: HTMLElement | undefined, show: boolean, relatedInput?: HTMLElement | undefined) => void,
 *   setAriaInvalid: (el: HTMLElement | undefined, invalid: boolean) => void,
 * }} CompileContext
 * @typedef {{
 *   field: (id: string) => HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null,
 * }} HydrateContext
 * @typedef {{
 *   fields: string[],
 *   compile: (ctx: CompileContext) => { str: string, isValid: boolean },
 *   hydrate: (data: string, ctx: HydrateContext) => void,
 * }} DataTypeDefinition
 */

/** Percent-decode without throwing on malformed input (URLSearchParams is lenient). */
function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Known coin ids (must match the #crypto-coin options + formatters). */
const KNOWN_COINS = new Set(["bitcoin", "ethereum", "litecoin", "bitcoincash", "dash", "monero"]);

/** Unfold folded content lines (RFC 2426/5545: CRLF followed by SP/HT is removed). */
function unfoldContentLines(data) {
  return String(data || "")
    .replace(/\r\n[ \t]/g, "")
    .split(/\r\n|\n/);
}

/** Unescape vCard/iCal TEXT values (\n -> newline, \, \; \\ unescaped). */
function unescapeTextValue(value) {
  return String(value || "")
    .replace(/\\n/gi, "\n")
    .replace(/\\([\\,;])/g, "$1");
}

/** Split on unescaped `;` (a `\;` stays inside the field). */
function splitUnescaped(value) {
  const parts = [];
  let buf = "";
  for (let i = 0; i < String(value).length; i++) {
    const ch = value[i];
    if (ch === "\\" && i + 1 < value.length) {
      buf += ch + value[i + 1];
      i++;
    } else if (ch === ";") {
      parts.push(buf);
      buf = "";
    } else {
      buf += ch;
    }
  }
  parts.push(buf);
  return parts;
}

const WIFI_PASSWORD_ERROR_KEYS = new Set([
  "validation.wpaPasswordRequired",
  "validation.wpaPasswordShort",
  "validation.wpaPasswordLong",
  "validation.wepPasswordRequired",
  "validation.wepKey",
]);
const GEO_LONGITUDE_ERROR_KEYS = new Set(["validation.longitudeRange", "validation.longitudeRequired"]);
const GEO_LATITUDE_ERROR_KEYS = new Set(["validation.latitudeRange", "validation.latitudeRequired"]);
const SMS_MESSAGE_ERROR_KEYS = new Set(["validation.smsMessageTooLong"]);

/** @type {Record<import("../constants.js").DataType, DataTypeDefinition>} */
export const DATA_TYPES = {
  url: {
    fields: ["inputUrl"],
    compile: ({ DOM, showWarnings, setWarning }) => {
      const r = formatUrl(DOM.inputUrl.value);
      if (showWarnings && r.errorKey) DOM.urlWarning.textContent = t(r.errorKey);
      setWarning(DOM.urlWarning, !r.isValid && showWarnings, DOM.inputUrl);
      return { str: r.str, isValid: r.isValid };
    },
    hydrate: (data, { field }) => {
      const el = field("inputUrl");
      if (el) el.value = data;
    },
  },
  text: {
    fields: ["inputText"],
    compile: ({ DOM }) => ({ str: DOM.inputText.value, isValid: true }),
    hydrate: (data, { field }) => {
      const el = field("inputText");
      if (el) el.value = data;
    },
  },
  wifi: {
    fields: ["wifiSsid", "wifiPass", "wifiEnc", "wifiHidden"],
    compile: ({ DOM, showWarnings, setWarning, setAriaInvalid }) => {
      const r = formatWifi({
        ssid: DOM.wifiSsid.value,
        pass: DOM.wifiPass.value,
        enc: DOM.wifiEnc.value,
        hidden: DOM.wifiHidden.checked,
      });
      if (showWarnings && r.errorKey) {
        DOM.wifiWarning.textContent = t(r.errorKey);
        const isPassErr = WIFI_PASSWORD_ERROR_KEYS.has(r.errorKey);
        setWarning(DOM.wifiWarning, true, isPassErr ? DOM.wifiPass : DOM.wifiSsid);
        if (isPassErr) setAriaInvalid(DOM.wifiSsid, false);
        else setAriaInvalid(DOM.wifiPass, false);
      } else {
        setWarning(DOM.wifiWarning, false, DOM.wifiSsid);
        setAriaInvalid(DOM.wifiPass, false);
      }
      return { str: r.str, isValid: r.isValid };
    },
    hydrate: (data, { field }) => {
      const ssid = field("wifiSsid");
      if (ssid && data.startsWith("WIFI:")) {
        const matchS = data.match(/S:((?:\\;|[^;])*);/);
        const matchT = data.match(/T:((?:\\;|[^;])*);/);
        const matchP = data.match(/P:((?:\\;|[^;])*);/);
        const matchH = data.match(/H:((?:\\;|[^;])*);/);
        if (matchS) ssid.value = matchS[1].replace(/\\([;,":\\])/g, "$1");
        const enc = field("wifiEnc");
        if (matchT && enc) enc.value = matchT[1];
        const pass = field("wifiPass");
        if (matchP && pass) pass.value = matchP[1].replace(/\\([;,":\\])/g, "$1");
        const hidden = field("wifiHidden");
        if (matchH && hidden instanceof HTMLInputElement) hidden.checked = matchH[1] === "true";
      }
    },
  },
  contact: {
    fields: [
      "contactFirst",
      "contactLast",
      "contactOrg",
      "contactTitle",
      "contactPhone",
      "contactWork",
      "contactFax",
      "contactEmail",
      "contactUrl",
      "contactStreet",
      "contactCity",
      "contactState",
      "contactZip",
      "contactCountry",
    ],
    compile: ({ DOM, showWarnings, setWarning }) => {
      const r = formatVCard({
        first: DOM.contactFirst.value,
        last: DOM.contactLast.value,
        org: DOM.contactOrg.value,
        title: DOM.contactTitle.value,
        tel: DOM.contactPhone.value,
        work: DOM.contactWork.value,
        fax: DOM.contactFax.value,
        email: DOM.contactEmail.value,
        url: DOM.contactUrl.value,
        street: DOM.contactStreet.value,
        city: DOM.contactCity.value,
        stateProv: DOM.contactState.value,
        zip: DOM.contactZip.value,
        country: DOM.contactCountry.value,
      });
      if (showWarnings && r.errorKey) DOM.contactWarning.textContent = t(r.errorKey);
      setWarning(DOM.contactWarning, !r.isValid && showWarnings, DOM.contactFirst);
      return { str: r.str, isValid: r.isValid };
    },
    // No vCard parser exists: structured contact fields are restored from the
    // persisted field bag, so a decoded payload leaves the form untouched.
    hydrate: (data, { field }) => {
      if (typeof data !== "string" || !data.includes("BEGIN:VCARD")) return;
      const lines = unfoldContentLines(data);
      const byPrefix = (prefix) => {
        const line = lines.find((l) => l.startsWith(prefix));
        return line ? unescapeTextValue(line.slice(prefix.length)) : "";
      };
      const byName = (name) => {
        // Property may carry params (TEL;TYPE=CELL:...): match NAME or NAME;…
        const line = lines.find((l) => l === name || l.startsWith(`${name}:`) || l.startsWith(`${name};`));
        if (!line) return "";
        const colon = line.indexOf(":");
        return colon === -1 ? "" : unescapeTextValue(line.slice(colon + 1));
      };
      const set = (id, value) => {
        const el = field(id);
        if (el) el.value = value;
      };
      // N:ln;fn;;; — split on unescaped ';' so an escaped "\;" in a name survives.
      const nRaw = byPrefix("N:");
      if (nRaw !== "") {
        const rawParts = splitUnescaped(lines.find((l) => l.startsWith("N:"))?.slice(2) || "");
        set("contactLast", unescapeTextValue(rawParts[0] || ""));
        set("contactFirst", unescapeTextValue(rawParts[1] || ""));
      }
      const org = byPrefix("ORG:");
      if (org !== "" || nRaw !== "") set("contactOrg", org);
      set("contactTitle", byName("TITLE"));
      const cell = lines.find((l) => l.startsWith("TEL;TYPE=CELL:") || l.startsWith("TEL;TYPE=CELL,VOICE:"));
      set(
        "contactPhone",
        cell ? unescapeTextValue(cell.slice(cell.indexOf(":") + 1)) : byName("TEL")
      );
      const work = lines.find((l) => l.startsWith("TEL;TYPE=WORK,VOICE:"));
      if (work) set("contactWork", unescapeTextValue(work.slice(work.indexOf(":") + 1)));
      const fax = lines.find((l) => l.startsWith("TEL;TYPE=WORK,FAX:"));
      if (fax) set("contactFax", unescapeTextValue(fax.slice(fax.indexOf(":") + 1)));
      set("contactEmail", byName("EMAIL"));
      set("contactUrl", byName("URL"));
      const adrLine = lines.find((l) => l.startsWith("ADR"));
      if (adrLine) {
        const colon = adrLine.indexOf(":");
        const parts = splitUnescaped(colon === -1 ? "" : adrLine.slice(colon + 1)).map(unescapeTextValue);
        // ADR:po;ext;street;city;region;zip;country
        set("contactStreet", parts[2] || "");
        set("contactCity", parts[3] || "");
        set("contactState", parts[4] || "");
        set("contactZip", parts[5] || "");
        set("contactCountry", parts[6] || "");
      }
    },
  },
  crypto: {
    fields: ["cryptoCoin", "cryptoAddress", "cryptoAmount"],
    compile: ({ DOM, showWarnings, setWarning }) => {
      const r = formatCrypto({
        coin: DOM.cryptoCoin.value,
        address: DOM.cryptoAddress.value,
        amount: DOM.cryptoAmount.value,
      });
      if (showWarnings && r.errorKey) {
        DOM.cryptoWarning.textContent = t(r.errorKey);
        setWarning(DOM.cryptoWarning, true, DOM.cryptoAddress);
      } else {
        setWarning(DOM.cryptoWarning, false, DOM.cryptoAddress);
      }
      return { str: r.str, isValid: r.isValid };
    },
    hydrate: (data, { field }) => {
      const address = field("cryptoAddress");
      if (address) {
        const colonIdx = data.indexOf(":");
        if (colonIdx !== -1) {
          const coin = data.slice(0, colonIdx);
          const rest = data.slice(colonIdx + 1);
          const qIdx = rest.indexOf("?");
          let addr = rest;
          let amount = "";
          if (qIdx !== -1) {
            addr = rest.slice(0, qIdx);
            const q = new URLSearchParams(rest.slice(qIdx + 1));
            amount = q.get("amount") || q.get("value") || q.get("tx_amount") || "";
          }
          const coinEl = field("cryptoCoin");
          // An unvalidated coin would set a <select> to a missing option
          // (selectedIndex -1, value "") so the next compile sees no
          // validator and emits `:addr` as valid. Validate + fall back.
          let finalCoin = KNOWN_COINS.has(coin) ? coin : "bitcoin";
          if (coinEl) {
            if (coinEl instanceof HTMLSelectElement) {
              const values = Array.from(coinEl.options).map((o) => o.value);
              if (!values.includes(finalCoin)) {
                finalCoin = values.includes("bitcoin") ? "bitcoin" : values[0] || "bitcoin";
              }
            }
            coinEl.value = finalCoin;
          }
          // Malformed percent sequences must not abort the whole decode.
          address.value = safeDecodeURIComponent(addr);
          const amountEl = field("cryptoAmount");
          if (amountEl) amountEl.value = amount;
        }
      }
    },
  },
  geo: {
    fields: ["geoLat", "geoLon"],
    compile: ({ DOM, showWarnings, setWarning, setAriaInvalid }) => {
      const r = formatGeo({
        lat: DOM.geoLat.value,
        lon: DOM.geoLon.value,
      });
      if (showWarnings && r.errorKey) {
        DOM.geoWarning.textContent = t(r.errorKey);
        const isLonErr = GEO_LONGITUDE_ERROR_KEYS.has(r.errorKey);
        const isLatErr = GEO_LATITUDE_ERROR_KEYS.has(r.errorKey);
        if (isLonErr && !isLatErr) {
          setWarning(DOM.geoWarning, true, DOM.geoLon);
          setAriaInvalid(DOM.geoLat, false);
        } else if (isLatErr && !isLonErr) {
          setWarning(DOM.geoWarning, true, DOM.geoLat);
          setAriaInvalid(DOM.geoLon, false);
        } else {
          setWarning(DOM.geoWarning, true, DOM.geoLat);
          setAriaInvalid(DOM.geoLon, true);
        }
      } else {
        setWarning(DOM.geoWarning, false, DOM.geoLat);
        setAriaInvalid(DOM.geoLon, false);
      }
      return { str: r.str, isValid: r.isValid };
    },
    hydrate: (data, { field }) => {
      const lat = field("geoLat");
      const lon = field("geoLon");
      if (lat && lon && data.startsWith("geo:")) {
        const coords = data.slice("geo:".length).split(",");
        lat.value = coords[0] || "";
        lon.value = coords[1] || "";
      }
    },
  },
  event: {
    fields: ["eventTitle", "eventStart", "eventEnd", "eventLocation", "eventDesc"],
    compile: ({ DOM, showWarnings, setWarning, setAriaInvalid }) => {
      const r = formatEvent({
        title: DOM.eventTitle.value,
        start: DOM.eventStart.value,
        end: DOM.eventEnd.value,
        location: DOM.eventLocation.value,
        description: DOM.eventDesc.value,
      });
      if (showWarnings && r.errorKey) DOM.eventWarning.textContent = t(r.errorKey);
      setWarning(DOM.eventWarning, !r.isValid && showWarnings, DOM.eventTitle);
      if (!r.isValid) setAriaInvalid(DOM.eventStart, true);
      else setAriaInvalid(DOM.eventStart, false);
      return { str: r.str, isValid: r.isValid };
    },
    // No VEVENT parser exists (and the payload carries generated UID/time
    // fields), so a decoded event payload leaves the form untouched.
    hydrate: (data, { field }) => {
      if (typeof data !== "string" || !data.includes("BEGIN:VEVENT")) return;
      const lines = unfoldContentLines(data);
      const getProp = (name) => {
        // DTSTART may carry ";VALUE=DATE": match "NAME" or "NAME;…".
        const line = lines.find((l) => l === name || l.startsWith(`${name}:`) || l.startsWith(`${name};`));
        if (!line) return null;
        const colon = line.indexOf(":");
        return colon === -1 ? "" : line.slice(colon + 1);
      };
      const toInputDateTime = (raw) => {
        if (!raw) return "";
        // DATE: 20240101 -> 2024-01-01; DATE-TIME: 20240101T100000 -> 2024-01-01T10:00
        let m = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
        if (m) return `${m[1]}-${m[2]}-${m[3]}`;
        m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?$/.exec(raw);
        if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
        return "";
      };
      const set = (id, value) => {
        const el = field(id);
        if (el) el.value = value;
      };
      const summary = getProp("SUMMARY");
      if (summary !== null) set("eventTitle", unescapeTextValue(summary));
      const dtStart = getProp("DTSTART");
      if (dtStart !== null) set("eventStart", toInputDateTime(dtStart));
      const dtEnd = getProp("DTEND");
      if (dtEnd !== null) set("eventEnd", toInputDateTime(dtEnd));
      const loc = getProp("LOCATION");
      if (loc !== null) set("eventLocation", unescapeTextValue(loc));
      const desc = getProp("DESCRIPTION");
      if (desc !== null) set("eventDesc", unescapeTextValue(desc));
    },
  },
  sms: {
    fields: ["smsPhone", "smsMsg"],
    compile: ({ DOM, showWarnings, setWarning }) => {
      const r = formatSms({
        phone: DOM.smsPhone.value,
        message: DOM.smsMsg.value,
      });
      if (showWarnings && r.errorKey) {
        DOM.smsWarning.textContent = t(r.errorKey);
        const isMsgErr = SMS_MESSAGE_ERROR_KEYS.has(r.errorKey);
        setWarning(DOM.smsWarning, true, isMsgErr ? DOM.smsMsg : DOM.smsPhone);
      } else {
        setWarning(DOM.smsWarning, false, DOM.smsPhone);
      }
      return { str: r.str, isValid: r.isValid };
    },
    hydrate: (data, { field }) => {
      const phone = field("smsPhone");
      if (phone && data.startsWith("SMSTO:")) {
        const parts = data.slice("SMSTO:".length).split(":");
        phone.value = parts[0] || "";
        const msg = field("smsMsg");
        if (msg) msg.value = safeDecodeURIComponent(parts.slice(1).join(":") || "");
      } else if (phone && /^sms:/i.test(data)) {
        // Alternate `sms:<number>?body=<text>` form (e.g. from scanners).
        const rest = data.slice(4);
        const qIdx = rest.indexOf("?");
        const msg = field("smsMsg");
        if (qIdx === -1) {
          phone.value = rest;
          if (msg) msg.value = "";
        } else {
          phone.value = rest.slice(0, qIdx);
          if (msg) {
            try {
              const q = new URLSearchParams(rest.slice(qIdx + 1));
              msg.value = q.get("body") ?? safeDecodeURIComponent(rest.slice(qIdx + 1));
            } catch {
              msg.value = rest.slice(qIdx + 1);
            }
          }
        }
      }
    },
  },
  phone: {
    fields: ["phoneNumber"],
    compile: ({ DOM, showWarnings, setWarning }) => {
      const r = formatPhone(DOM.phoneNumber.value);
      if (showWarnings && r.errorKey) {
        DOM.phoneWarning.textContent = t(r.errorKey);
        setWarning(DOM.phoneWarning, true, DOM.phoneNumber);
      } else {
        setWarning(DOM.phoneWarning, false, DOM.phoneNumber);
      }
      return { str: r.str, isValid: r.isValid };
    },
    hydrate: (data, { field }) => {
      const el = field("phoneNumber");
      if (el) el.value = data.startsWith("tel:") ? data.slice("tel:".length) : data;
    },
  },
  email: {
    fields: ["emailTo", "emailSubject", "emailBody"],
    compile: ({ DOM, showWarnings, setWarning }) => {
      const r = formatEmail({
        to: DOM.emailTo.value,
        subject: DOM.emailSubject.value,
        body: DOM.emailBody.value,
      });
      if (showWarnings && r.errorKey) {
        DOM.emailWarning.textContent = t(r.errorKey);
        setWarning(DOM.emailWarning, true, DOM.emailTo);
      } else {
        setWarning(DOM.emailWarning, false, DOM.emailTo);
      }
      return { str: r.str, isValid: r.isValid };
    },
    hydrate: (data, { field }) => {
      const to = field("emailTo");
      if (to) {
        let rest = data;
        if (rest.startsWith("mailto:")) rest = rest.slice("mailto:".length);
        const qIdx = rest.indexOf("?");
        let addr = rest;
        let subject = "";
        let body = "";
        if (qIdx !== -1) {
          addr = rest.slice(0, qIdx);
          const query = new URLSearchParams(rest.slice(qIdx + 1));
          subject = query.get("subject") || "";
          body = query.get("body") || "";
        }
        to.value = addr;
        const subjectEl = field("emailSubject");
        if (subjectEl) subjectEl.value = subject;
        const bodyEl = field("emailBody");
        if (bodyEl) bodyEl.value = body;
      }
    },
  },
};

/**
 * DOM ref property names one type reads/writes (its form controls, i.e. the
 * persisted field-bag scope). Unknown types yield an empty list.
 * @param {string} type
 * @returns {string[]}
 */
export function fieldsForType(type) {
  const def = DATA_TYPES[type];
  return def ? [...def.fields] : [];
}
