/**
 * How a payment arrived, in the words the owner uses. The stored value stays
 * "online" — every payment already recorded says so — but the hostel takes
 * that money by scanning a UPI code, and "Online" was the word nobody at the
 * desk used. Every screen labels it through here, so none says "online".
 */
export type PayMethod = "cash" | "online";

export const PAY_METHODS: readonly { value: PayMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "online", label: "UPI" },
];

export function payMethodLabel(type: string | null | undefined): string {
  return type === "online" ? "UPI" : type === "cash" ? "Cash" : "";
}
