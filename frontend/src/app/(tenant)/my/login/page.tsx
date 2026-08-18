"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTenantAuth } from "@/contexts/tenantAuth";
import { ApiError } from "@/lib/api";
import { Button, Card, Field, FormError, Input } from "@/components/ui";

export default function TenantLoginPage() {
  const { login, isAuthenticated, isLoading } = useTenantAuth();
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isLoading && isAuthenticated) router.replace("/my");
  }, [isAuthenticated, isLoading, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(phone, password);
      router.replace("/my");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <div className="w-full max-w-sm">
        <h1 className="mb-6 text-center font-display text-2xl font-bold text-stone-900">Tenant login</h1>

        <Card padding="none" className="p-6 sm:p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <FormError>{error}</FormError>}

            <Field label="Phone number">
              <Input
                required
                type="tel"
                placeholder="Your registered phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </Field>

            <Field label="Password">
              <Input
                required
                type="password"
                placeholder="Your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>

            <Button type="submit" loading={loading} className="w-full">
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
