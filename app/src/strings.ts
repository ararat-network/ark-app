// The strings the app shows. Every string a member reads is a resource, never
// text inside a component, so a language is a translation and not a build.
// They are here until the `i18n` package is built and holds them for every
// language; this screen is the scaffold's own and goes when signup arrives.
export const strings = {
  "scaffold.title": "Ark",
  "scaffold.keystore": "Keystore core",
  "scaffold.keystore.ok": "Built in, and it answers rightly",
  "scaffold.keystore.failed": "Built in, and it answers wrongly",
  "scaffold.keystore.unavailable": "Not in this build",
} as const;

export type StringKey = keyof typeof strings;
