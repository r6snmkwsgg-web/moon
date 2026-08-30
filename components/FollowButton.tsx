"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserCheck, UserPlus } from "lucide-react";
import { toggleFollow } from "@/app/u/[username]/actions";

/** Follow/unfollow a trader — their big prints land in your alerts. */
export default function FollowButton({
  profileId,
  username,
  following,
  signedIn,
}: {
  profileId: string;
  username: string;
  following: boolean;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (!signedIn) {
      router.push(`/login?next=/u/${username}`);
      return;
    }
    startTransition(async () => {
      await toggleFollow(profileId, username);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      title={
        following
          ? "Following — big trades land in your alerts"
          : "Follow: their big trades land in your alerts"
      }
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-xs font-semibold transition-colors disabled:opacity-50 ${
        following
          ? "border-terminal-accent/60 bg-terminal-accent/10 text-terminal-accent"
          : "border-terminal-line text-terminal-muted hover:border-terminal-muted hover:text-terminal-text"
      }`}
    >
      {following ? <UserCheck size={12} /> : <UserPlus size={12} />}
      {following ? "following" : "follow"}
    </button>
  );
}
