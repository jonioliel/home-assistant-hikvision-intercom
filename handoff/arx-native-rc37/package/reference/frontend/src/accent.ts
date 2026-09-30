/** Fixed accessible pairs; never apply an unvalidated CSS value from storage. */
export const accents = ["green", "blue", "purple", "teal", "orange", "rose"] as const;
export type Accent = (typeof accents)[number];
export const isAccent = (value: unknown): value is Accent =>
  typeof value === "string" && accents.includes(value as Accent);
export const accentKey = (user: string) => `hikvision-intercom:accent:v1:${user}`;
export function accentOverride(user?: string): Accent | null {
  if (!user) return null;
  try {
    const value = localStorage.getItem(accentKey(user));
    return isAccent(value) ? value : null;
  } catch {
    return null;
  }
}
export function saveAccent(user: string | undefined, accent: Accent | "default"): boolean {
  if (!user) return false;
  try {
    if (accent === "default") localStorage.removeItem(accentKey(user));
    else localStorage.setItem(accentKey(user), accent);
    return true;
  } catch {
    return false;
  }
}
export const accentPairs: Record<Accent, { light: string[]; dark: string[] }> = {
  green: { light: ["#087e70", "#e8f4ef", "#ffffff"], dark: ["#8bddbc", "#213d37", "#102c25"] },
  blue: { light: ["#235abb", "#edf3ff", "#ffffff"], dark: ["#a9c7ff", "#263750", "#142743"] },
  purple: { light: ["#6940b6", "#f2edfc", "#ffffff"], dark: ["#d0b5ff", "#382d49", "#271740"] },
  teal: { light: ["#006b80", "#e7f4f7", "#ffffff"], dark: ["#86d9e6", "#203b43", "#102d36"] },
  orange: { light: ["#a44708", "#fff1e6", "#ffffff"], dark: ["#ffc08b", "#443326", "#382109"] },
  rose: { light: ["#a93269", "#fceef4", "#ffffff"], dark: ["#ffb0d1", "#442b3a", "#381326"] },
};
export function applyAccent(element: HTMLElement, accent: Accent, appearance: string): void {
  const names = ["--wk4-accent", "--wk4-accent-soft", "--wk4-on-accent"];
  if (!appearance.startsWith("wiskey-")) {
    for (const name of names) element.style.removeProperty(name);
    return;
  }
  const palette = accentPairs[accent][appearance === "wiskey-dark" ? "dark" : "light"];
  names.forEach((name, index) => element.style.setProperty(name, palette[index]));
}
