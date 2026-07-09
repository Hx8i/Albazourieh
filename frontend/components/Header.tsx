import { getDictionary, Locale } from "@/lib/i18n/dictionaries";
import { Globe } from "lucide-react";

export default async function Header({ locale = "ar" }: { locale?: Locale }) {
  const dict = getDictionary(locale);
  return (
    <header className="border-b bg-background">
      <div className="container flex h-14 items-center justify-between">
        <span className="font-bold">{dict.common.appName}</span>
        <a
          href={locale === "ar" ? "/en" : "/ar"}
          className="flex items-center gap-2 text-sm font-medium text-primary hover:underline"
        >
          <Globe className="size-4" />
          {dict.landing.switchLanguage}
        </a>
      </div>
    </header>
  );
}
