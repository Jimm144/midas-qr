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
    expect(r.error).toBe("Network name (SSID) is required");
  });
  it("invalid when WPA password is empty", () => {
    const r = formatWifi({ ssid: "Home", pass: "", enc: "WPA", hidden: false });
    expect(r.isValid).toBe(false);
    expect(r.error).toBe("Password is required for WPA network");
  });
  it("invalid when WPA password is too short", () => {
    const r = formatWifi({ ssid: "Home", pass: "short", enc: "WPA", hidden: false });
    expect(r.isValid).toBe(false);
    expect(r.error).toBe("WPA password must be at least 8 characters");
  });
  it("invalid when WPA password is too long", () => {
    const r = formatWifi({ ssid: "Home", pass: "a".repeat(64), enc: "WPA", hidden: false });
    expect(r.isValid).toBe(false);
    expect(r.error).toBe("WPA password must be at most 63 characters");
  });
  it("validates WEP passwords", () => {
    const rValid = formatWifi({ ssid: "Home", pass: "12345", enc: "WEP", hidden: false });
    expect(rValid.isValid).toBe(true);
    const rInvalid = formatWifi({ ssid: "Home", pass: "123", enc: "WEP", hidden: false });
    expect(rInvalid.isValid).toBe(false);
    expect(rInvalid.error).toBe("WEP key must be 5 or 13 characters (or 10/26 hex digits)");
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
      tel: "555",
      email: "a@b.com",
      url: "https://b.com",
      street: "1 St",
      city: "Town",
    });
    expect(r.str).toContain("TEL;TYPE=CELL:555");
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
  it("escapes newlines and special chars in TEL, EMAIL, URL", () => {
    const r = formatVCard({
      first: "Test",
      tel: "555;CELL=WORK:666",
      email: "x\nevil@x.com",
      url: "https://x;BAD=1",
    });
    expect(r.str).toContain("TEL;TYPE=CELL:555\\;CELL=WORK:666");
    expect(r.str).toContain("EMAIL:x\\nevil@x.com");
    expect(r.str).toContain("URL:https://x\\;BAD=1");
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
    expect(r.error).toBe("Address is invalid for the selected coin");
  });
  it("rejects an ethereum address with invalid length", () => {
    const r = formatCrypto({ coin: "ethereum", address: "0xabc" });
    expect(r.isValid).toBe(false);
    expect(r.error).toBe("Address is invalid for the selected coin");
  });
  it("invalid when amount present but address missing", () => {
    const r = formatCrypto({ coin: "bitcoin", address: "", amount: "0.5" });
    expect(r.isValid).toBe(false);
    expect(r.error).toBe("Wallet address is required");
  });
  it("invalid amount format", () => {
    const r = formatCrypto({
      coin: "bitcoin",
      address: "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2",
      amount: "abc",
    });
    expect(r.isValid).toBe(false);
    expect(r.error).toBe("Invalid amount");
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
    expect(r.error).toBe("Latitude must be between -90 and 90");
  });
  it("invalid longitude out of range", () => {
    const r = formatGeo({ lat: "0", lon: "999" });
    expect(r.isValid).toBe(false);
    expect(r.error).toBe("Longitude must be between -180 and 180");
  });
  it("requires both lat and lon", () => {
    const r = formatGeo({ lat: "40", lon: "" });
    expect(r.isValid).toBe(false);
    expect(r.error).toBe("Longitude is required");
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
    expect(r.error).toBe("Invalid phone number");
  });
  it("requires phone when message present", () => {
    const r = formatSms({ phone: "", message: "Hi" });
    expect(r.isValid).toBe(false);
    expect(r.error).toBe("Phone number is required");
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
    expect(r.error).toBe("Invalid phone number");
  });
  it("rejects garbage that previously passed", () => {
    expect(formatPhone("+--+()()1").isValid).toBe(false);
    expect(formatPhone("---").isValid).toBe(false);
  });
  it("rejects too-short numbers", () => {
    expect(formatPhone("123").isValid).toBe(false);
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
    expect(r.error).toBe("End time must be after the start time");
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
    expect(r.error).toBe("Email address is required");
  });
  it("rejects malformed addresses", () => {
    const r = formatEmail({ to: "not-an-email", subject: "" });
    expect(r.isValid).toBe(false);
    expect(r.error).toBe("Invalid email address");
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