'use client';

import { usePathname } from "next/navigation";
import { getDictionary, Locale } from "@/lib/i18n/dictionaries";
import { Globe } from "lucide-react";

export default function Header({ locale = "ar" }: { locale?: Locale }) {
  const dict = getDictionary(locale);
  const pathname = usePathname();

  const targetLocale = locale === "ar" ? "en" : "ar";
  const newPathname = pathname.replace(
    new RegExp(`^/${locale}(?=/|$)`),
    `/${targetLocale}`,
  );

  return (
    <header className="border-b bg-background">
      <div className="container flex h-14 items-center justify-between">
        <span className="font-bold">{dict.common.appName}</span>
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
