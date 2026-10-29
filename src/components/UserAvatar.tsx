import { useAvatarUrl } from "../hooks/useAvatarUrl";
import Avatar from "./Avatar";

/**
 * Someone else's avatar.
 *
 * The signing hook is called per row, which is fine because the URLs are cached
 * by path: forty conversations with forty people produce forty requests once,
 * not on every render or mount.
 */
export default function UserAvatar({
  name,
  letter,
  avatarPath,
  color = "blue",
  small = false,
}: {
  name: string;
  letter: string;
  avatarPath?: string | null;
  color?: string;
  small?: boolean;
}) {
  const url = useAvatarUrl(avatarPath);
  return (
    <Avatar color={color} small={small} src={url} alt={url ? `Фото профиля: ${name}` : undefined}>
      {letter}
    </Avatar>
  );
}
