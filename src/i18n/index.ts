export { enMessages } from './en';
export { afMessages } from './af';

export type SupportedLocale = 'en' | 'af';

export const SUPPORTED_LOCALES: { code: SupportedLocale; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'af', label: 'Afrikaans' },
];

export function getMessages(locale: SupportedLocale): Record<string, string> {
  switch (locale) {
    case 'af': return require('./af').afMessages;
    default: return require('./en').enMessages;
  }
}
