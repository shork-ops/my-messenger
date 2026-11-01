import { lazy, Suspense } from "react";
import type { ChatInfoPanelProps } from "./ChatInfoPanel";

// The chat panel is on screen from the start only on wide desktops, so its code is a chunk of its
// own and arrives a moment later. The boundary is its own as well: a dialog loading elsewhere must
// not blank the panel meanwhile.
const ChatInfoPanel = lazy(() => import("./ChatInfoPanel"));

export default function RightPanel(props: ChatInfoPanelProps) {
  return (
    <Suspense fallback={null}>
      <ChatInfoPanel {...props} />
    </Suspense>
  );
}
