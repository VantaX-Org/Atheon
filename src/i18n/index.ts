export { enMessages } from './en';
export { afMessages } from './af';

export type SupportedLocale = 'en' | 'af';

export const SUPPORTED_LOCALES: { code: SupportedLocale; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'af', label: 'Afrikaans' },
];

export async function getMessages(locale: SupportedLocale): Promise<Record<string, string>> {
  switch (locale) {
    case 'af': return (await import('./af')).afMessages;
    default: return (await import('./en')).enMessages;
  }
}
