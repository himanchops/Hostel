/**
 * Phone numbers are Indian mobiles, checked strictly — the same rule as the
 * backend's normalizePhone (handlers/phone.go), which has the final say. This
 * copy only lets a form say so before anything uploads.
 *
 * Accepts spaces, dashes, brackets and a +91, 91 or 0 in front, and returns
 * the ten digits to send. Anything else is null: letters, the wrong number of
 * digits, or a first digit no Indian mobile starts with.
 */
export function tenDigits(phone: string): string | null {
  let d = "";
  for (const ch of (phone ?? "").trim()) {
    if (ch >= "0" && ch <= "9") d += ch;
    else if (ch === "+" && d === "") continue;
    else if (!" -()".includes(ch)) return null;
  }
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

export const PHONE_ERROR = "Enter a 10-digit mobile number.";
export const EMERGENCY_PHONE_ERROR = "Enter a 10-digit mobile number for the emergency contact.";

/**
 * Both numbers on a tenant form, checked together. `emergency` may be blank
 * unless `emergencyRequired`; blank comes back as undefined.
 */
export function checkPhones(
  phone: string,
  emergency = "",
): { phone: string; emergency?: string } | { error: string } {
  const p = tenDigits(phone);
  if (!p) return { error: PHONE_ERROR };
  if (!emergency.trim()) return { phone: p };
  const e = tenDigits(emergency);
  if (!e) return { error: EMERGENCY_PHONE_ERROR };
  return { phone: p, emergency: e };
}

/**
 * Digits only, the last ten: "+91 98450 11001" and "9845011001" are one
 * number. For comparing records, including older ones stored as typed.
 */
export function phoneKey(phone: string): string {
  return (phone ?? "").replace(/\D/g, "").slice(-10);
}
