import { test, expect } from "@playwright/test";
import { checkPhones, tenDigits, PHONE_ERROR, EMERGENCY_PHONE_ERROR } from "../../src/lib/phone";

// The same cases as backend/internal/handlers/phone_test.go: the form's check
// and the server's must agree, or a form would pass a number the server then
// refuses (or stop one it would have taken).

test("the ways people write a mobile number all come back as ten digits", () => {
  for (const typed of [
    "9845012345",
    "98450 12345",
    "+91 98450 12345",
    "+919845012345",
    "919845012345",
    "09845012345",
    "(+91) 98450-12345",
    "  9845012345 ",
  ]) {
    expect(tenDigits(typed), typed).toBe("9845012345");
  }
  // Ten digits that start 91 are a number, not a prefix.
  expect(tenDigits("9100000000")).toBe("9100000000");
});

test("anything that is not an Indian mobile is refused", () => {
  for (const typed of [
    "",
    "98450",
    "98450123456",
    "9198450123456",
    "5845012345",
    "0000000000",
    "98450l2345",
    "9845012345 ext 2",
    "98+45012345",
    "+1 415 555 0100",
    "91 5845012345",
  ]) {
    expect(tenDigits(typed), typed).toBeNull();
  }
});

test("a form checks both numbers, and a blank emergency number is left out", () => {
  expect(checkPhones("+91 98450 12345")).toEqual({ phone: "9845012345" });
  expect(checkPhones("9845012345", " ")).toEqual({ phone: "9845012345" });
  expect(checkPhones("9845012345", "098470 12345")).toEqual({ phone: "9845012345", emergency: "9847012345" });
  expect(checkPhones("12345", "9847012345")).toEqual({ error: PHONE_ERROR });
  expect(checkPhones("9845012345", "12345")).toEqual({ error: EMERGENCY_PHONE_ERROR });
});
