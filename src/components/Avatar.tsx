import type { ReactNode } from "react";

export default function Avatar({
  children,
  color = "blue",
  small = false,
  src,
  alt,
}: {
  children: ReactNode;
  color?: string;
  small?: boolean;
  /** Signed URL of the profile photo. When missing, the letter or emoji is shown. */
  src?: string | null;
  alt?: string;
}) {
  return (
    <div className={`avatar ${color} ${small ? "small" : ""}`}>
      {src ? <img className="avatar-photo" src={src} alt={alt ?? ""} loading="lazy" decoding="async" /> : children}
    </div>
  );
}
