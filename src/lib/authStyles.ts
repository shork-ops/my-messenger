import type { CSSProperties } from "react";

/**
 * The look shared by every screen before the app opens: checking the session, sign-in and the
 * authenticator step. Kept apart so the gate itself stays in the first chunk without pulling the
 * sign-in forms in with it.
 */
export const authBaseStyles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    padding: 24,
    background: "radial-gradient(ellipse at top, #1b1a10 0%, #090a0c 48%, #070809 100%)",
    color: "#f4f4f5",
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  card: {
    width: "min(100%, 420px)",
    padding: "42px 34px",
    border: "1px solid #303136",
    borderRadius: 22,
    background: "#0b0c0eee",
    boxShadow: "0 25px 90px #0009",
    textAlign: "center",
  },
  mark: {
    display: "grid",
    placeItems: "center",
    width: 62,
    height: 62,
    margin: "0 auto 24px",
    borderRadius: 18,
    background: "#ffd400",
    color: "#101010",
    fontSize: 42,
    fontWeight: 900,
    fontStyle: "italic",
  },
  eyebrow: { color: "#ffd400", fontSize: 11, fontWeight: 800, letterSpacing: 3 },
  title: { margin: "12px 0", fontSize: "clamp(25px, 5vw, 34px)", letterSpacing: -1 },
  subtitle: { color: "#a6a7ae", fontSize: 14, lineHeight: 1.6 },
};
