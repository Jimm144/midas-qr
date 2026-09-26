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
    hydrate: () => undefined,
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
          if (coinEl) coinEl.value = coin;
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
    hydrate: () => undefined,
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
        if (msg) msg.value = parts.slice(1).join(":") || "";
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
