import "server-only";

// App Teams spec - Member sum step 5 (AT6): above the member cap a team
// answers 422 TOO_MANY_MEMBERS, with no LiteLLM call.
export class MemberSumTooManyMembers extends Error {
  readonly code = "TOO_MANY_MEMBERS" as const;
  constructor(readonly members: number) {
    super("This team has more than 200 members, so its spend is not summed.");
    this.name = "MemberSumTooManyMembers";
  }
}
