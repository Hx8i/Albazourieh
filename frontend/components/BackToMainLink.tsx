import * as React from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dictionary, Locale } from '@/lib/i18n/dictionaries';

interface BackToMainLinkProps {
  dict: Dictionary;
  locale: Locale;
}

/**
 * The escape hatch shown above every standalone public form: one clearly
 * labelled control returning the visitor to the landing hub. Width-matched
 * to the wizard cards (max-w-xl) so it aligns with the form below it.
 */
export function BackToMainLink({
  dict,
  locale,
}: BackToMainLinkProps): React.JSX.Element {
  return (
    <div className="mx-auto w-full max-w-xl">
      <Button
        asChild
        variant="ghost"
        size="sm"
        className="-ms-2 text-muted-foreground hover:text-foreground"
      >
        <Link href={`/${locale}`}>
          <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
          {dict.common.backToMain}
        </Link>
      </Button>
    </div>
  );
}
