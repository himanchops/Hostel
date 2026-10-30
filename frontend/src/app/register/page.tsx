"use client";

import { RegisterForm } from "./RegisterForm";
import { registerOwnerId } from "@/lib/registerOwner";

/**
 * `/register` with no owner in it (Oct 2026): the link on the poster and the
 * one people type, `choprahostel.vercel.app/register`. A deployment that
 * belongs to one hostel says whose form this is with
 * NEXT_PUBLIC_REGISTER_OWNER_ID; unset, it shows the "link doesn't work" card
 * rather than guessing an owner. `/register/:ownerId` still works for every
 * owner, and every link already shared.
 */
export default function DefaultRegisterPage() {
  return <RegisterForm ownerId={registerOwnerId(process.env.NEXT_PUBLIC_REGISTER_OWNER_ID)} />;
}
