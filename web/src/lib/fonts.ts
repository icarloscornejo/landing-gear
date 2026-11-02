import localFont from "next/font/local";

// One clean sans for body and display. Apple devices use San Francisco through
// the system stack in globals.css; everywhere else falls back to this bundled
// Inter (latin variable subset, vendored so an offline build never contacts Google).
export const inter = localFont({
  src: [{
    path: "../assets/fonts/inter/Inter-Latin-Variable.woff2",
    weight: "100 900",
    style: "normal",
  }],
  variable: "--font-inter",
  display: "swap",
});
