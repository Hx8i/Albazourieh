'use client';

import * as React from 'react';
import { Eye, EyeOff, Loader2, LogOut, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { staffLogin } from '@/lib/api';
import {
  StaffSession,
  clearStaffSession,
  getStaffSession,
  setStaffSession,
} from '@/lib/auth';
import { Dictionary } from '@/lib/i18n/dictionaries';

interface StaffGateProps {
  dict: Dictionary;
  children: (session: StaffSession, logout: () => void) => React.ReactNode;
}

/**
 * Client-side JWT gate for municipality pages: renders the login form
 * until a valid staff session exists, then renders its children with
 * the session. Any 401 from the API clears the stored session (see
 * lib/api.ts), and the next render lands back here.
 */
export function StaffGate({ dict, children }: StaffGateProps): React.JSX.Element {
  const t = dict.login;
  const [session, setSession] = React.useState<StaffSession | null>(null);
  const [hydrated, setHydrated] = React.useState(false);

  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [rememberMe, setRememberMe] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setSession(getStaffSession());
    setHydrated(true);
  }, []);

  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const result = await staffLogin(
      email.trim().toLowerCase(),
      password,
      rememberMe,
    );
    setSubmitting(false);

    if (result.ok) {
      setStaffSession(result.data, rememberMe);
      setSession(result.data);
      setPassword('');
      setShowPassword(false);
    } else {
      setError(result.error.status === 401 ? t.failed : result.error.message);
    }
  };

  const logout = (): void => {
    clearStaffSession();
    setSession(null);
  };

  if (!hydrated) {
    return (
      <div className="flex items-center justify-center gap-2 p-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        {dict.common.loading}
      </div>
    );
  }

  if (!session) {
    return (
      <Card className="mx-auto w-full max-w-md">
        <CardHeader className="items-center text-center">
          <ShieldCheck className="h-10 w-10 text-primary" />
          <CardTitle>{t.title}</CardTitle>
          <CardDescription>{t.subtitle}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="staff-email">{t.emailLabel}</Label>
              <Input
                id="staff-email"
                type="email"
                autoComplete="username"
                required
                dir="ltr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="staff-password">{t.passwordLabel}</Label>
              <div className="relative" dir="ltr">
                <Input
                  id="staff-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  className="pe-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((previous) => !previous)}
                  aria-label={showPassword ? t.hidePassword : t.showPassword}
                  aria-pressed={showPassword}
                  className="absolute end-0 top-0 flex h-full w-10 items-center justify-center rounded-e-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="staff-remember"
                className="h-5 w-5"
                checked={rememberMe}
                onCheckedChange={(checked) => setRememberMe(checked === true)}
              />
              <Label
                htmlFor="staff-remember"
                className="cursor-pointer text-sm font-normal"
              >
                {t.rememberMe}
              </Label>
            </div>
            {error ? (
              <p className="rounded-lg bg-destructive/10 p-3 text-center text-sm font-medium text-destructive">
                {error}
              </p>
            ) : null}
            <Button type="submit" size="lg" className="w-full" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> {t.submitting}
                </>
              ) : (
                t.submit
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-3 text-sm text-muted-foreground">
        <span>
          {session.user.fullName} — {session.user.municipalityName}
        </span>
        <Button variant="ghost" size="sm" onClick={logout}>
          <LogOut className="h-4 w-4" />
          {dict.common.logout}
        </Button>
      </div>
      {children(session, logout)}
    </div>
  );
}
