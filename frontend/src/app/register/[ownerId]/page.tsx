"use client";

import { use } from "react";
import { RegisterForm } from "../RegisterForm";

export default function RegisterPage({ params }: { params: Promise<{ ownerId: string }> }) {
  const { ownerId } = use(params);
  return <RegisterForm ownerId={parseInt(ownerId, 10)} />;
}
