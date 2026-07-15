# Keep Needs Input an orchestration-owned circuit breaker

But Why? orchestration code records Needs Input only after it observes a code-owned durable blocker and exhausts every approved automatic recovery for that reason.
The transition preserves its evidence, a resumable checkpoint, and available recovery actions.
Agents never request Needs Input or change Task or Change lifecycle state; they make their best available decisions, record consequential Implementation Decisions, and continue their assigned work.
Later vertical slices should replace recurring Needs Input reasons with named automatic recovery paths so the circuit breaker becomes progressively rarer without removing graceful handling for external or safety failures that cannot be automated safely.
