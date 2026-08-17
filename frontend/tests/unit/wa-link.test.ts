import { test, expect } from "@playwright/test";
import { normalizePhone, waLink, duePhrase, roomLabel, nudgeMessage } from "../../src/lib/wa";

// wa.me wants a bare country-code-prefixed number: no +, no spaces, no dashes.
// Phone numbers in this app are typed by hand into a form, so every one of
// these shapes turns up in real data.
test("ten digits are assumed Indian and get a 91 prefix", () => {
  expect(normalizePhone("9812345601")).toBe("919812345601");
  expect(normalizePhone("98123 45601")).toBe("919812345601");
  expect(normalizePhone("98123-45601")).toBe("919812345601");
});

test("numbers that already carry the country code are left alone", () => {
  expect(normalizePhone("919812345601")).toBe("919812345601");
  expect(normalizePhone("+91 98123 45601")).toBe("919812345601");
  expect(normalizePhone("+91-98123-45601")).toBe("919812345601");
});

// Anything that does not land on twelve digits is rejected rather than
// guessed at. Guessing wrong means opening a stranger's WhatsApp chat with
// someone else's rent in it.
test("anything that isn't 10 or 12 digits is rejected", () => {
  expect(normalizePhone("098123456012")).toBe(null); // 12 digits, but a leading 0 — not a country code
  expect(normalizePhone("09812345601")).toBe(null); // 11: leading zero, no country code
  expect(normalizePhone("12345")).toBe(null); // too short
  expect(normalizePhone("98123456012345")).toBe(null); // too long
  expect(normalizePhone("")).toBe(null);
  expect(normalizePhone("not a phone number")).toBe(null);
  expect(normalizePhone("+++")).toBe(null);
});

// A leading zero is the one case where the digit count alone would let a bad
// number through, so it is pinned separately: 0 + 11 digits reads as 12.
test("a leading zero is not mistaken for a country code", () => {
  expect(normalizePhone("098123456012")).toBe(null);
});

test("waLink builds a wa.me url with the message encoded", () => {
  expect(waLink("9812345601", "Hi Asha")).toBe("https://wa.me/919812345601?text=Hi%20Asha");
});

// The message contains ₹, spaces, parentheses and an exclamation mark, all of
// which have to survive the round trip into the URL.
test("waLink encodes rupee amounts and punctuation", () => {
  const link = waLink("9812345601", "rent of ₹7,500 is pending (due 12 days ago)!");
  expect(link).toBe(
    "https://wa.me/919812345601?text=rent%20of%20%E2%82%B97%2C500%20is%20pending%20(due%2012%20days%20ago)!"
  );
  // And decodes back to exactly what went in.
  expect(decodeURIComponent(link!.split("?text=")[1])).toBe(
    "rent of ₹7,500 is pending (due 12 days ago)!"
  );
});

test("waLink returns null for a number it cannot trust", () => {
  expect(waLink("12345", "Hi")).toBe(null);
  expect(waLink("", "Hi")).toBe(null);
});

test("duePhrase reads naturally at the boundaries", () => {
  expect(duePhrase(0)).toBe("due today");
  expect(duePhrase(1)).toBe("due 1 day ago");
  expect(duePhrase(2)).toBe("due 2 days ago");
  expect(duePhrase(83)).toBe("due 83 days ago");
  expect(duePhrase(-1)).toBe("due today"); // clamped, never "due -1 days ago"
});

test("roomLabel handles a stay with no bed assigned", () => {
  expect(roomLabel({ room_name: "101", bed_name: "A" })).toBe("101 · A");
  expect(roomLabel({ room_name: "101", bed_name: null })).toBe("101");
  expect(roomLabel({ room_name: "", bed_name: null })).toBe("");
});

// The whole message, asserted verbatim — it goes to a real person, so a stray
// double space or a missing amount is a real defect.
test("nudgeMessage renders the full default template", () => {
  expect(
    nudgeMessage({
      tenant_name: "Asha Rao",
      room_name: "101",
      bed_name: "A",
      balance_paise: 750000,
      days_since_due: 12,
    })
  ).toBe(
    "Hi Asha, this is a reminder that rent of ₹7,500 for 101 · A is pending (due 12 days ago). Please pay at your convenience. Thank you!"
  );
});

test("nudgeMessage uses the first name only, and copes with one-word names", () => {
  const base = { room_name: "101", bed_name: "A", balance_paise: 750000, days_since_due: 1 };
  expect(nudgeMessage({ ...base, tenant_name: "Rahul Kumar Sharma" })).toContain("Hi Rahul,");
  expect(nudgeMessage({ ...base, tenant_name: "Meera" })).toContain("Hi Meera,");
  expect(nudgeMessage({ ...base, tenant_name: "  Asha  Rao " })).toContain("Hi Asha,");
});

test("nudgeMessage drops the location when there is no bed or room", () => {
  const message = nudgeMessage({
    tenant_name: "Vikram Desai",
    room_name: "",
    bed_name: null,
    balance_paise: 1200000,
    days_since_due: 0,
  });
  expect(message).toBe(
    "Hi Vikram, this is a reminder that rent of ₹12,000 is pending (due today). Please pay at your convenience. Thank you!"
  );
  expect(message).not.toContain("  ");
});
