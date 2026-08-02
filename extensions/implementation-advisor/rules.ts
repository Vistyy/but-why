export const implementationAdvisorRules = [
  { id: "authority.explicit-conflict", instruction: "Advise only when supplied or discovered authority explicitly conflicts with the implementation and requires an Implementation Blocker." },
  { id: "external-mutation.reconcile-before-retry", instruction: "Advise when uncertain external mutation is retried or work proceeds without authoritative postcondition reconciliation." },
  { id: "current-system.remove-retired-concept", instruction: "Advise only when approved intent explicitly replaces or removes a concept, based on changed and directly related artifacts." },
  { id: "verification.proportional-evidence", instruction: "Advise only when verification changes or supports a confidence claim and a concrete Material Risk is tied to a Verification Claim, changed evidence, or Task Verification Contract." },
] as const;

export type ImplementationAdvisorRuleId = (typeof implementationAdvisorRules)[number]["id"];
