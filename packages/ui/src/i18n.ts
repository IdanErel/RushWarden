/**
 * Strings live in `packages/ui/i18n/<lang>.json` (GDD §8). `t()` fills `{name}` placeholders and
 * a minimal ICU plural, `{n, plural, one {...} other {...}}` with `#` for the number. English only
 * in Phase 1; plural rules come from `Intl.PluralRules`.
 */
import en from '../i18n/en.json';

export type StringKey = keyof typeof en;
type Vars = Readonly<Record<string, string | number>>;

const tables: Record<string, Readonly<Record<string, string>>> = { en };
let lang = 'en';

export function setLanguage(l: string): void {
  if (tables[l]) lang = l;
}

const PLURAL = /\{(\w+), plural, ((?:\w+ \{[^}]*\}\s*)+)\}/g;

export function format(template: string, vars: Vars = {}, locale = lang): string {
  const rules = new Intl.PluralRules(locale);
  const plural = template.replace(PLURAL, (_m, name: string, body: string) => {
    const n = Number(vars[name] ?? 0);
    const forms = new Map<string, string>();
    for (const m of body.matchAll(/(\w+) \{([^}]*)\}/g)) forms.set(m[1] ?? '', m[2] ?? '');
    const form = forms.get(rules.select(n)) ?? forms.get('other') ?? '';
    return form.replace(/#/g, String(n));
  });
  return plural.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

export function t(key: StringKey, vars?: Vars): string {
  const table = tables[lang] ?? en;
  return format(table[key] ?? en[key], vars);
}
