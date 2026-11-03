import { Award, Medal, Trophy } from "lucide-react";

type RankCellProps = {
  rank: number;
};

const MEDALS = { 1: Trophy, 2: Medal, 3: Award } as const;

function isMedalRank(rank: number): rank is keyof typeof MEDALS {
  return rank === 1 || rank === 2 || rank === 3;
}

// Design System -- Component Inventory, `RankingList`: a leaderboard with medal
// icons for the top three. The icon is decorative; the text label names the rank.
export function RankCell({ rank }: RankCellProps) {
  if (!isMedalRank(rank)) {
    return <span className="font-mono tabular-nums">{rank}</span>;
  }

  const Icon = MEDALS[rank];
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="text-foreground size-4" aria-hidden />
      <span className="font-mono tabular-nums" aria-hidden>
        {rank}
      </span>
      <span className="sr-only">{`Rank ${rank}`}</span>
    </span>
  );
}
