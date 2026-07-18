'use client';

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getDictionary, Locale } from "@/lib/i18n/dictionaries";
import { cn } from "@/lib/utils";
import { Globe } from "lucide-react";

export default function Header({ locale = "ar" }: { locale?: Locale }) {
  const dict = getDictionary(locale);
  const pathname = usePathname();

  const isDashboard = pathname.includes('/admin-portal-x7b2') || pathname.includes('/dashboard');

  const targetLocale = locale === "ar" ? "en" : "ar";
  const newPathname = pathname.replace(
    new RegExp(`^/${locale}(?=/|$)`),
    `/${targetLocale}`,
  );

  // Public entry points only — the staff portals are never linked here.
  const modules: Array<{ href: string; label: string; active: boolean }> = [
    {
      href: `/${locale}`,
      label: dict.modules.warDamages,
      active: !pathname.startsWith(`/${locale}/syrian`) &&
        !pathname.startsWith(`/${locale}/lebanese`),
    },
    {
      href: `/${locale}/syrian/form`,
      label: dict.modules.syrian,
      active: pathname.startsWith(`/${locale}/syrian`),
    },
    {
      href: `/${locale}/lebanese/form`,
      label: dict.modules.lebanese,
      active: pathname.startsWith(`/${locale}/lebanese`),
    },
  ];

  return (
    <header className="border-b bg-background">
      <div className="container flex min-h-14 flex-wrap items-center justify-between gap-x-6 gap-y-2 py-2">
        <span className="font-bold">{dict.common.appName}</span>
        {!isDashboard ? (
          <nav
            aria-label={dict.modules.title}
            className="order-last flex w-full flex-wrap items-center gap-1 sm:order-none sm:w-auto"
          >
            {modules.map((module) => (
              <Link
                key={module.href}
                href={module.href}
                aria-current={module.active ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  module.active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {module.label}
              </Link>
            ))}
          </nav>
        ) : (
          <div className="flex-1" />
        )}
        <a
          href={newPathname}
          className="flex items-center gap-2 text-sm font-medium text-primary hover:underline"
        >
          <Globe className="size-4" />
          {dict.landing.switchLanguage}
        </a>
      </div>
    </header>
  );
}
