export interface MemberRankInput {
  userId: string;
  value: number;
  qty: number;
  joinedAt: number;
}

export type RankedMember<T extends MemberRankInput> = T & { rank: number };

export function rankMembers<T extends MemberRankInput>(rows: readonly T[]): RankedMember<T>[] {
  return [...rows]
    .sort(
      (left, right) =>
        right.value - left.value ||
        right.qty - left.qty ||
        left.joinedAt - right.joinedAt ||
        left.userId.localeCompare(right.userId),
    )
    .map((row, index) => ({ ...row, rank: index + 1 }));
}
