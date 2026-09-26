import { describe, it, expect } from "vitest";
import {
  checkUrlValid,
  formatUrl,
  formatWifi,
  formatVCard,
  formatCrypto,
  formatGeo,
  formatEvent,
  formatSms,
  formatPhone,
  formatEmail,
} from "../src/js/generator/formatters.js";

describe("checkUrlValid", () => {
  it("treats empty as valid", () => {
    expect(checkUrlValid("")).toBe(true);
  });
  it("accepts well-formed URLs", () => {
    expect(checkUrlValid("https://example.com")).toBe(true);
    expect(checkUrlValid("http://foo.bar/path?q=1")).toBe(true);
  });
  it("prepends https:// when scheme is missing then validates", () => {
    expect(checkUrlValid("example.com")).toBe(true);
  });
  it("rejects malformed URLs", () => {
    expect(checkUrlValid("https://exa mple.com")).toBe(false);
  });
  it("rejects explicit non-http(s) schemes", () => {
    expect(checkUrlValid("javascript:alert(1)")).toBe(false);
    expect(checkUrlValid("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(checkUrlValid("file:///etc/passwd")).toBe(false);
    expect(checkUrlValid("ftp://example.com/file")).toBe(false);
  });
  it("rejects whitespace and control characters", () => {
    expect(checkUrlValid("https://example.com/pa th")).toBe(false);
    expect(checkUrlValid("example\u0000.com")).toBe(false);
    expect(checkUrlValid("example\n.com")).toBe(false);
  });
  it("rejects a scheme with no host", () => {
    expect(checkUrlValid("https://")).toBe(false);
    expect(checkUrlValid("http://")).toBe(false);
  });
  it("rejects a dotless host that is not localhost", () => {
    expect(checkUrlValid("foo")).toBe(false);
    expect(checkUrlValid("not a url")).toBe(false);
  });
  it("keeps accepting scheme-less hosts, ports, query, IDN, IP and localhost", () => {
    expect(checkUrlValid("example.com")).toBe(true);
    expect(checkUrlValid("example.com:8080/path?q=1#frag")).toBe(true);
    expect(checkUrlValid("münchen.de")).toBe(true);
    expect(checkUrlValid("https://münchen.de/straße")).toBe(true);
    expect(checkUrlValid("http://192.168.0.1:8080/logo.png")).toBe(true);
    expect(checkUrlValid("https://[2001:db8::1]/")).toBe(true);
    expect(checkUrlValid("localhost")).toBe(true);
    expect(checkUrlValid("localhost:3000")).toBe(true);
  });
});

describe("formatUrl", () => {
  it("prepends https:// and reports valid for bare host", () => {
    const r = formatUrl("example.com");
    expect(r.str).toBe("https://example.com");
    expect(r.isValid).toBe(true);
  });
  it("keeps existing https URL unchanged", () => {
    const r = formatUrl("https://example.com/path");
    expect(r.str).toBe("https://example.com/path");
    expect(r.isValid).toBe(true);
  });
  it("flags malformed URLs as invalid", () => {
    expect(checkUrlValid("https://exa mple.com")).toBe(false);
    expect(formatUrl("https://[invalid").isValid).toBe(false);
  });
  it("treats empty string as valid-empty", () => {
    expect(formatUrl("")).toEqual({ str: "", isValid: true });
  });
  it("rejects a non-http(s) scheme explicitly with the URL error key", () => {
    for (const value of ["javascript:alert(1)", "data:image/png;base64,AA", "ftp://example.com"]) {
      const r = formatUrl(value);
      expect(r.isValid, value).toBe(false);
      expect(r.errorKey).toBe("data.urlInvalid");
    }
  });
  it("rejects whitespace, scheme-only and dotless-host values", () => {
    expect(formatUrl("not a url").isValid).toBe(false);
    expect(formatUrl("https://").isValid).toBe(false);
    expect(formatUrl("foo").isValid).toBe(false);
  });
  it("keeps a port/query URL valid without adding a second scheme", () => {
    const r = formatUrl("example.com:8080/a?b=1");
    expect(r.isValid).toBe(true);
    expect(r.str).toBe("https://example.com:8080/a?b=1");
  });
});

describe("formatWifi", () => {
  it("formats a WPA network", () => {
    const r = formatWifi({ ssid: "Home", pass: "password123", enc: "WPA", hidden: false });
    expect(r.str).toBe("WIFI:S:Home;T:WPA;P:password123;H:false;;");
    expect(r.isValid).toBe(true);
  });
  it("formats nopass network without P:", () => {
    const r = formatWifi({ ssid: "Open", pass: "", enc: "nopass", hidden: false });
    expect(r.str).toBe("WIFI:S:Open;T:nopass;H:false;;");
    expect(r.isValid).toBe(true);
  });
  it("escapes special chars in SSID/password", () => {
    const r = formatWifi({ ssid: "a;b", pass: 'c"d12345', enc: "WPA", hidden: true });
    expect(r.str).toBe('WIFI:S:a\\;b;T:WPA;P:c\\"d12345;H:true;;');
    expect(r.isValid).toBe(true);
  });
  it("invalid when SSID missing but other fields present", () => {
    const r = formatWifi({ ssid: "", pass: "password123", enc: "WPA", hidden: false });
    expect(r.isValid).toBe(false);
    expect(r.str).toBe("");
    expect(r.errorKey).toBe("validation.ssidRequired");
  });
  it("invalid when WPA password is empty", () => {
    const r = formatWifi({ ssid: "Home", pass: "", enc: "WPA", hidden: false });
    expect(r.isValid).toBe(false);
    expect(r.errorKey).toBe("validation.wpaPasswordRequired");
  });
  it("invalid when WPA password is too short", () => {
    const r = formatWifi({ ssid: "Home", pass: "short", enc: "WPA", hidden: false });
    expect(r.isValid).toBe(false);
    expect(r.errorKey).toBe("validation.wpaPasswordShort");
  });
  it("invalid when WPA password is too long", () => {
    const r = formatWifi({ ssid: "Home", pass: "a".repeat(64), enc: "WPA", hidden: false });
    expect(r.isValid).toBe(false);
    expect(r.errorKey).toBe("validation.wpaPasswordLong");
  });
  it("validates WEP passwords", () => {
    const rValid = formatWifi({ ssid: "Home", pass: "12345", enc: "WEP", hidden: false });
    expect(rValid.isValid).toBe(true);
    const rInvalid = formatWifi({ ssid: "Home", pass: "123", enc: "WEP", hidden: false });
    expect(rInvalid.isValid).toBe(false);
    expect(rInvalid.errorKey).toBe("validation.wepKey");
  });
  it("rejects an SSID longer than 32 characters", () => {
    const r = formatWifi({ ssid: "s".repeat(33), pass: "password123", enc: "WPA" });
    expect(r.isValid).toBe(false);
    expect(r.errorKey).toBe("validation.ssidLong");
    expect(r.str).toBe("");
  });
  it("accepts a 32-character SSID but not a 33-character one", () => {
    expect(formatWifi({ ssid: "s".repeat(32), pass: "password123", enc: "WPA" }).isValid).toBe(true);
    expect(formatWifi({ ssid: "s".repeat(33), pass: "password123", enc: "WPA" }).isValid).toBe(false);
  });
  it("accepts the 5/13 ASCII and 10/26 hex WEP key lengths", () => {
    for (const pass of [
      "12345",
      "1234567890123",
      "1234567890",
      "12345678901234567890123456",
      "abcdefABCD",
    ]) {
      expect(formatWifi({ ssid: "Home", pass, enc: "WEP" }).isValid, pass).toBe(true);
    }
  });
  it("rejects the 16-ASCII and 32-hex WEP keys that used to pass", () => {
    for (const pass of ["1234567890123456", "12345678901234567890123456789012"]) {
      const r = formatWifi({ ssid: "Home", pass, enc: "WEP" });
      expect(r.isValid, pass).toBe(false);
      expect(r.errorKey, pass).toBe("validation.wepKey");
    }
  });
  it("keeps the nopass flow ignoring an over-long password", () => {
    const r = formatWifi({ ssid: "Open", pass: "x".repeat(200), enc: "nopass" });
    expect(r.isValid).toBe(true);
    expect(r.str).toBe("WIFI:S:Open;T:nopass;H:false;;");
  });
});

describe("formatVCard", () => {
  it("builds a vCard from name fields", () => {
    const r = formatVCard({ first: "Ada", last: "Lovelace" });
    expect(r.str).toContain("BEGIN:VCARD");
    expect(r.str).toContain("FN:Ada Lovelace");
    expect(r.str).toContain("END:VCARD");
    expect(r.isValid).toBe(true);
  });
  it("includes optional fields when provided", () => {
    const r = formatVCard({
      first: "A",
      last: "B",
      tel: "5551234",
      email: "a@b.com",
      url: "https://b.com",
      street: "1 St",
      city: "Town",
    });
    expect(r.str).toContain("TEL;TYPE=CELL:5551234");
    expect(r.str).toContain("EMAIL:a@b.com");
    expect(r.str).toContain("URL:https://b.com");
    expect(r.str).toContain("ADR;TYPE=WORK:;;1 St;Town");
  });
  it("invalid when optional-only fields present without a required one", () => {
    const r = formatVCard({ org: "Acme" });
    expect(r.isValid).toBe(false);
  });
  it("empty object is valid-empty", () => {
    const r = formatVCard({});
    expect(r.str).toBe("");
    expect(r.isValid).toBe(true);
  });
  it("escapes newlines and special chars in text, ADR and URL fields", () => {
    const r = formatVCard({
      first: "Test",
      org: "A; B, C",
      street: "1, Main; St\nApt 2",
      url: "https://x;BAD=1",
    });
    expect(r.str).toContain("ORG:A\\; B\\, C");
    expect(r.str).toContain("ADR;TYPE=WORK:;;1\\, Main\\; St\\nApt 2");
    expect(r.str).toContain("URL:https://x\\;BAD=1");
  });
  it("validates the email field when present", () => {
    const r = formatVCard({ first: "A", email: "not-an-email" });
    expect(r.isValid).toBe(false);
    expect(r.errorKey).toBe("validation.emailInvalid");
    expect(r.str).toBe("");
  });
  it("validates the phone field when present", () => {
    const r = formatVCard({ first: "A", tel: "abc" });
    expect(r.isValid).toBe(false);
    expect(r.errorKey).toBe("validation.phoneInvalid");
    expect(r.str).toBe("");
  });
  it("accepts a valid email and phone together", () => {
    const r = formatVCard({ first: "A", tel: "+1 (555) 123-4567", email: "a@b.com" });
    expect(r.isValid).toBe(true);
    expect(r.str).toContain("TEL;TYPE=CELL:+1 (555) 123-4567");
    expect(r.str).toContain("EMAIL:a@b.com");
  });
  it("validates the URL field when present (http(s) only)", () => {
    const r = formatVCard({ first: "A", url: "javascript:alert(1)" });
    expect(r.isValid).toBe(false);
    expect(r.errorKey).toBe("validation.urlInvalid");
    expect(r.str).toBe("");
    expect(formatVCard({ first: "A", url: "example.com" }).errorKey).toBe("validation.urlInvalid");
    expect(formatVCard({ first: "A", url: "data:text/plain,x" }).isValid).toBe(false);
    expect(formatVCard({ first: "A", url: "https://" }).isValid).toBe(false);
  });
  it("accepts a valid http(s) URL field and an empty one", () => {
    expect(formatVCard({ first: "A", url: "http://localhost/x" }).isValid).toBe(true);
    expect(formatVCard({ first: "A", url: "  " }).isValid).toBe(true);
    expect(formatVCard({ first: "A", url: "" }).str).not.toContain("URL:");
  });
});

describe("formatCrypto", () => {
  it("formats bitcoin: URI with amount", () => {
    const r = formatCrypto({
      coin: "bitcoin",
      address: "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2",
      amount: "0.5",
    });
    expect(r.str).toBe("bitcoin:1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2?amount=0.5");
    expect(r.isValid).toBe(true);
  });
  it("without amount omits query string", () => {
    const r = formatCrypto({ coin: "ethereum", address: "0x" + "a".repeat(40), amount: "" });
    expect(r.str).toBe("ethereum:0x" + "a".repeat(40));
  });
  it("accepts bech32 bitcoin addresses", () => {
    const r = formatCrypto({ coin: "bitcoin", address: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq" });
    expect(r.isValid).toBe(true);
  });
  it("rejects a bitcoin address under the wrong coin", () => {
    const r = formatCrypto({ coin: "ethereum", address: "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2" });
    expect(r.isValid).toBe(false);
    expect(r.errorKey).toBe("validation.addressInvalid");
  });
  it("rejects an ethereum address with invalid length", () => {
    const r = formatCrypto({ coin: "ethereum", address: "0xabc" });
    expect(r.isValid).toBe(false);
    expect(r.errorKey).toBe("validation.addressInvalid");
  });
  it("invalid when amount present but address missing", () => {
    const r = formatCrypto({ coin: "bitcoin", address: "", amount: "0.5" });
    expect(r.isValid).toBe(false);
    expect(r.errorKey).toBe("validation.walletRequired");
  });
  it("invalid amount format", () => {
    const r = formatCrypto({
      coin: "bitcoin",
      address: "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2",
      amount: "abc",
    });
    expect(r.isValid).toBe(false);
    expect(r.errorKey).toBe("validation.invalidAmount");
  });
});

describe("formatCrypto — amount must be a positive finite number", () => {
  const address = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2";
  it("rejects zero amounts", () => {
    for (const amount of ["0", "0.0", "00", "0.00", "000"]) {
      const r = formatCrypto({ coin: "bitcoin", address, amount });
      expect(r.isValid, amount).toBe(false);
      expect(r.errorKey, amount).toBe("validation.invalidAmount");
    }
  });
  it("rejects a leading plus and negative amounts", () => {
    for (const amount of ["+1", "-1", "-0.5"]) {
      const r = formatCrypto({ coin: "bitcoin", address, amount });
      expect(r.isValid, amount).toBe(false);
      expect(r.errorKey, amount).toBe("validation.invalidAmount");
    }
  });
  it("accepts a small positive amount", () => {
    expect(formatCrypto({ coin: "bitcoin", address, amount: "0.0001" }).isValid).toBe(true);
  });
});

describe("formatGeo — coordinate reporting", () => {
  it("reports non-numeric coordinates as out-of-range", () => {
    expect(formatGeo({ lat: "abc", lon: "0" }).errorKey).toBe("validation.latitudeRange");
    expect(formatGeo({ lat: "0", lon: "abc" }).errorKey).toBe("validation.longitudeRange");
  });
  it("reports the missing coordinate when the other is present", () => {
    expect(formatGeo({ lat: "", lon: "10" }).errorKey).toBe("validation.latitudeRequired");
    expect(formatGeo({ lat: "10", lon: "" }).errorKey).toBe("validation.longitudeRequired");
  });
  it("treats both coordinates empty as valid-empty", () => {
    expect(formatGeo({ lat: "", lon: "" })).toEqual({ str: "", isValid: true });
    expect(formatGeo({})).toEqual({ str: "", isValid: true });
  });
  it("accepts boundary latitude/longitude values", () => {
    expect(formatGeo({ lat: "-90", lon: "180" }).isValid).toBe(true);
    expect(formatGeo({ lat: "90", lon: "-180" }).isValid).toBe(true);
  });
});

describe("formatGeo", () => {
  it("formats geo: URI", () => {
    const r = formatGeo({ lat: "40.7128", lon: "-74.0060" });
    expect(r.str).toBe("geo:40.7128,-74.0060");
  });
  it("invalid latitude out of range", () => {
    const r = formatGeo({ lat: "999", lon: "0" });
    expect(r.isValid).toBe(false);
    expect(r.errorKey).toBe("validation.latitudeRange");
  });
  it("invalid longitude out of range", () => {
    const r = formatGeo({ lat: "0", lon: "999" });
    expect(r.isValid).toBe(false);
    expect(r.errorKey).toBe("validation.longitudeRange");
  });
  it("requires both lat and lon", () => {
    const r = formatGeo({ lat: "40", lon: "" });
    expect(r.isValid).toBe(false);
    expect(r.errorKey).toBe("validation.longitudeRequired");
  });
});

describe("formatEvent", () => {
  it("builds a VCALENDAR VEVENT", () => {
    const r = formatEvent({
      title: "Meet",
      start: "2024-01-01T10:00",
      end: "2024-01-01T11:00",
      location: "Room 1",
      description: "Sync",
    });
    expect(r.str).toContain("BEGIN:VEVENT");
    expect(r.str).toContain("SUMMARY:Meet");
    expect(r.str).toContain("DTSTART:20240101T100000");
    expect(r.str).toContain("DTEND:20240101T110000");
    expect(r.str).toContain("LOCATION:Room 1");
    expect(r.isValid).toBe(true);
  });
  it("invalid when title/start missing but other fields present", () => {
    const r = formatEvent({ title: "", start: "", location: "X" });
    expect(r.isValid).toBe(false);
  });
});

describe("formatSms", () => {
  it("formats SMSTO: URI", () => {
    const r = formatSms({ phone: "+15551234", message: "Hello" });
    expect(r.str).toBe("SMSTO:+15551234:Hello");
    expect(r.isValid).toBe(true);
  });
  it("invalid phone format", () => {
    const r = formatSms({ phone: "abc", message: "" });
    expect(r.isValid).toBe(false);
    expect(r.errorKey).toBe("validation.phoneInvalid");
  });
  it("requires phone when message present", () => {
    const r = formatSms({ phone: "", message: "Hi" });
    expect(r.isValid).toBe(false);
    expect(r.errorKey).toBe("validation.phoneRequired");
  });
});

describe("formatPhone", () => {
  it("formats tel: URI", () => {
    const r = formatPhone("+15551234");
    expect(r.str).toBe("tel:+15551234");
    expect(r.isValid).toBe(true);
  });
  it("accepts separators in phone numbers", () => {
    const r = formatPhone("+1 (555) 123-4567");
    expect(r.isValid).toBe(true);
    expect(r.str).toBe("tel:+1 (555) 123-4567");
  });
  it("invalid format", () => {
    const r = formatPhone("not-a-phone");
    expect(r.isValid).toBe(false);
    expect(r.errorKey).toBe("validation.phoneInvalid");
  });
  it("rejects garbage that previously passed", () => {
    expect(formatPhone("+--+()()1").isValid).toBe(false);
    expect(formatPhone("---").isValid).toBe(false);
  });
  it("rejects too-short numbers", () => {
    expect(formatPhone("123").isValid).toBe(false);
  });
  it("accepts a 7-digit number and rejects a 16-digit one", () => {
    expect(formatPhone("1234567").isValid).toBe(true);
    const r = formatPhone("1234567890123456");
    expect(r.isValid).toBe(false);
    expect(r.errorKey).toBe("validation.phoneInvalid");
  });
  it("accepts +1 (555) 123-4567 but rejects +--+()()1", () => {
    const r = formatPhone("+1 (555) 123-4567");
    expect(r.isValid).toBe(true);
    expect(r.str).toBe("tel:+1 (555) 123-4567");
    expect(formatPhone("+--+()()1").isValid).toBe(false);
  });
});

describe("formatCrypto — coin-specific edge cases", () => {
  it("accepts a 40-char all-lowercase ethereum address", () => {
    const r = formatCrypto({ coin: "ethereum", address: "0x" + "a".repeat(40) });
    expect(r.isValid).toBe(true);
  });
  it("accepts a monero standard 95-char address", () => {
    const r = formatCrypto({ coin: "monero", address: "4".repeat(95) });
    expect(r.isValid).toBe(true);
  });
  it("accepts a bitcoincash cashaddr without the scheme prefix", () => {
    const r = formatCrypto({ coin: "bitcoincash", address: "q" + "z".repeat(41) });
    expect(r.isValid).toBe(true);
  });
  it("handles bitcoincash address with scheme prefix without double-prefixing", () => {
    const r = formatCrypto({ coin: "bitcoincash", address: "bitcoincash:q" + "z".repeat(41) });
    expect(r.isValid).toBe(true);
    expect(r.str).toBe("bitcoincash:q" + "z".repeat(41));
  });
  it("rejects a dash address that doesn't start with X", () => {
    const r = formatCrypto({ coin: "dash", address: "X" + "1".repeat(33) });
    expect(r.isValid).toBe(true);
    expect(formatCrypto({ coin: "dash", address: "Y" + "1".repeat(33) }).isValid).toBe(false);
  });
});

describe("line folding and text escaping (RFC 2426 / RFC 5545)", () => {
  it("folds vCard lines at 75 chars including the continuation space", () => {
    const r = formatVCard({ first: "Ada", last: "Lovelace", street: "S".repeat(200) });
    expect(r.isValid).toBe(true);
    for (const line of r.str.split("\r\n")) expect(line.length).toBeLessThanOrEqual(75);
    expect(r.str).toContain("\r\n ");
    expect(r.str.replace(/\r\n /g, "")).toContain("ADR;TYPE=WORK:;;" + "S".repeat(200));
  });

  it("folds long iCal lines at 75 chars including the continuation space", () => {
    const description = "D".repeat(200);
    const r = formatEvent({ title: "Meet", start: "2024-01-01T10:00", description });
    expect(r.isValid).toBe(true);
    for (const line of r.str.split("\r\n")) expect(line.length).toBeLessThanOrEqual(75);
    expect(r.str).toContain("\r\n ");
    expect(r.str.replace(/\r\n /g, "")).toContain("DESCRIPTION:" + description);
  });

  it("never splits a surrogate pair when folding", () => {
    const r = formatVCard({ first: "Ada", last: "😀".repeat(60) });
    expect(r.str.replace(/\r\n /g, "")).toContain("FN:Ada " + "😀".repeat(60));
    for (let i = 0; i < r.str.length; i++) {
      const code = r.str.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = r.str.charCodeAt(i + 1);
        expect(next >= 0xdc00 && next <= 0xdfff).toBe(true);
        i++;
      } else {
        expect(code >= 0xdc00 && code <= 0xdfff).toBe(false);
      }
    }
  });

  it("escapes commas, semicolons and newlines in iCal text values", () => {
    const r = formatEvent({
      title: "A, B; C",
      start: "2024-01-01T10:00",
      description: "line1\nline2",
    });
    expect(r.str).toContain("SUMMARY:A\\, B\\; C");
    expect(r.str).toContain("DESCRIPTION:line1\\nline2");
  });

  it("rejects a whitespace-only required vCard field", () => {
    const r = formatVCard({ first: "   " });
    expect(r.isValid).toBe(false);
    expect(r.str).toBe("");
  });

  it("trims the FN display name", () => {
    const r = formatVCard({ first: "  Ada  ", last: " Lovelace " });
    expect(r.str).toContain("FN:Ada Lovelace");
  });
});

describe("formatSms — long messages", () => {
  it("handles multi-line messages", () => {
    const r = formatSms({ phone: "+15551234567", message: "line1\nline2" });
    expect(r.isValid).toBe(true);
    expect(r.str).toContain("line1\nline2");
  });
  it("accepts a 1600-char body", () => {
    const long = "a".repeat(1600);
    expect(formatSms({ phone: "+15551234567", message: long }).isValid).toBe(true);
  });
  it("rejects a body longer than 1600 chars", () => {
    const r = formatSms({ phone: "+15551234567", message: "a".repeat(1601) });
    expect(r.isValid).toBe(false);
    expect(r.errorKey).toBe("validation.smsMessageTooLong");
    expect(r.str).toBe("");
  });
});

describe("formatEvent — date edge cases", () => {
  it("builds a valid event when end is omitted", () => {
    const r = formatEvent({
      title: "Meet",
      start: "2024-01-01T10:00",
    });
    expect(r.isValid).toBe(true);
    expect(r.str).toContain("DTSTART:20240101T100000");
    expect(r.str).not.toContain("DTEND");
  });
  it("invalid when end is before start", () => {
    const r = formatEvent({
      title: "Meet",
      start: "2024-01-02T10:00",
      end: "2024-01-01T09:00",
    });
    expect(r.isValid).toBe(false);
    expect(r.errorKey).toBe("validation.endAfterStart");
  });
  it("rejects impossible calendar dates", () => {
    for (const bad of [
      "2026-02-31T10:00",
      "2026-02-29T10:00",
      "2026-04-31",
      "2026-13-01T10:00",
      "2026-00-10T10:00",
      "2026-01-00T10:00",
      "2026-01-01T24:00",
      "2026-01-01T10:60",
    ]) {
      const r = formatEvent({ title: "Meet", start: bad });
      expect(r.isValid, bad).toBe(false);
      expect(r.errorKey, bad).toBe("validation.invalidDate");
    }
  });
  it("accepts a leap day and date-only starts", () => {
    expect(formatEvent({ title: "Meet", start: "2024-02-29T10:00" }).isValid).toBe(true);
    expect(formatEvent({ title: "Meet", start: "2024-01-01" }).isValid).toBe(true);
  });
  it("rejects an impossible end date", () => {
    const r = formatEvent({
      title: "Meet",
      start: "2026-01-01T10:00",
      end: "2026-02-31T10:00",
    });
    expect(r.isValid).toBe(false);
    expect(r.errorKey).toBe("validation.invalidDate");
  });
});

describe("formatEmail", () => {
  it("treats empty as valid", () => {
    expect(formatEmail({}).isValid).toBe(true);
    expect(formatEmail({ to: "", subject: "", body: "" }).str).toBe("");
  });
  it("requires a recipient when other fields are filled", () => {
    const r = formatEmail({ to: "", subject: "Hi", body: "Hello" });
    expect(r.isValid).toBe(false);
    expect(r.errorKey).toBe("validation.emailRequired");
  });
  it("rejects malformed addresses", () => {
    const r = formatEmail({ to: "not-an-email", subject: "" });
    expect(r.isValid).toBe(false);
    expect(r.errorKey).toBe("validation.emailInvalid");
  });
  it("formats a plain mailto: URI", () => {
    const r = formatEmail({ to: "person@example.com", subject: "", body: "" });
    expect(r.isValid).toBe(true);
    expect(r.str).toBe("mailto:person@example.com");
  });
  it("appends encoded subject and body params", () => {
    const r = formatEmail({ to: "person@example.com", subject: "Hi there", body: "Line 1\nLine 2" });
    expect(r.isValid).toBe(true);
    expect(r.str).toBe("mailto:person@example.com?subject=Hi%20there&body=Line%201%0ALine%202");
  });
  it("skips the query string when only the recipient is set", () => {
    const r = formatEmail({ to: "person@example.com", subject: "  ", body: "" });
    expect(r.str).toBe("mailto:person@example.com");
  });
  it("rejects a local part longer than 64 characters", () => {
    const r = formatEmail({ to: "a".repeat(65) + "@example.com" });
    expect(r.isValid).toBe(false);
    expect(r.errorKey).toBe("validation.emailInvalid");
  });
  it("rejects an address longer than 254 characters", () => {
    const to = "a".repeat(64) + "@" + "b".repeat(186) + ".com";
    expect(to.length).toBe(255);
    const r = formatEmail({ to });
    expect(r.isValid).toBe(false);
    expect(r.errorKey).toBe("validation.emailInvalid");
  });
  it("accepts a 254-character address", () => {
    const to = "a".repeat(64) + "@" + "b".repeat(185) + ".com";
    expect(to.length).toBe(254);
    expect(formatEmail({ to }).isValid).toBe(true);
  });
});

describe("RFC compliance and coin URI parameters", () => {
  it("formats vCard with CRLF line endings", () => {
    const r = formatVCard({ first: "Ada", last: "Lovelace" });
    expect(r.str).toContain("\r\n");
    expect(r.str).toContain("BEGIN:VCARD\r\nVERSION:3.0");
  });

  it("formats iCal with CRLF and UID/DTSTAMP", () => {
    const r = formatEvent({ title: "Release", start: "2024-05-01T14:00" });
    expect(r.str).toContain("\r\n");
    expect(r.str).toContain("UID:");
    expect(r.str).toContain("DTSTAMP:");
  });

  it("formats ethereum with ?value= instead of ?amount=", () => {
    const r = formatCrypto({ coin: "ethereum", address: "0x" + "a".repeat(40), amount: "1.5" });
    expect(r.str).toBe("ethereum:0x" + "a".repeat(40) + "?value=1.5");
  });

  it("formats monero with ?tx_amount= instead of ?amount=", () => {
    const r = formatCrypto({ coin: "monero", address: "4".repeat(95), amount: "0.25" });
    expect(r.str).toBe("monero:" + "4".repeat(95) + "?tx_amount=0.25");
  });
});