import type { Poll } from "../types";

export function pollTotal(poll: Poll): number {
  return poll.options.reduce((sum, option) => sum + option.votes.length, 0);
}

export function pollPercent(count: number, total: number): number {
  return total ? Math.round((count / total) * 100) : 0;
}

export function hasUserVoted(poll: Poll, userKey: string): boolean {
  return poll.options.some((option) => option.votes.includes(userKey));
}

export function toggleLocalVote(poll: Poll, optionId: string, userKey: string): Poll {
  const selected = poll.options.find((option) => option.votes.includes(userKey))?.id;
  return {
    ...poll,
    options: poll.options.map((option) => {
      const votes = option.votes.filter((vote) => vote !== userKey);
      if (option.id === selected) return { ...option, votes };
      if (option.id === optionId) return { ...option, votes: [...votes, userKey] };
      return { ...option, votes };
    }),
  };
}
