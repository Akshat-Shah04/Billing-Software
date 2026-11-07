// Light / dark / system theme. "system" follows the device; light and dark are remembered in this browser.
export type ThemeChoice = "system" | "light" | "dark";

const KEY = "billing_theme";
const BAR_COLOR = { light: "#ffffff", dark: "#14171e" }; // the top bar colour, for the phone's status bar

export function getThemeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* private mode or blocked storage: fall back to the system setting */
  }
  return "system";
}

// Keeps the phone's status bar / browser chrome the same colour as the top bar.
function syncBarColor(choice: ThemeChoice) {
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    const forDark = meta.media.includes("dark");
    meta.content = choice === "system" ? BAR_COLOR[forDark ? "dark" : "light"] : BAR_COLOR[choice];
  });
}

/** Applies the saved choice on startup (the page's inline script has already set data-theme, so there is no flash). */
export function initTheme() {
  syncBarColor(getThemeChoice());
}

export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
  try {
    if (choice === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    /* ignore: the theme still applies for this visit */
  }
  syncBarColor(choice);
}
