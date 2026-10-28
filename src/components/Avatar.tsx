import type { ReactNode } from "react";

export default function Avatar({
  children,
  color = "blue",
  small = false,
}: {
  children: ReactNode;
  color?: string;
  small?: boolean;
}) {
  return <div className={`avatar ${color} ${small ? "small" : ""}`}>{children}</div>;
}
