import en from "./en.json";
import ar from "./ar.json";

export const locales = ["en", "ar"] as const;
export type Locale = (typeof locales)[number];

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

type DictionaryShape<T> = {
  [K in keyof T]: T[K] extends string ? string : DictionaryShape<T[K]>;
};

/** Structure of `en`, with every leaf widened from its literal to `string`. */
export type Dictionary = DictionaryShape<typeof en>;

const dictionaries: Record<Locale, Dictionary> = { en, ar };

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}

/** Tiny interpolation helper: fill('{count} items', { count: 3 }). */
export function fill(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = values[key];
    return value === undefined ? match : String(value);
  });
}
