import type { VerifyDecision, VerifyObservation } from "../domain/types";

export function judgeVerification(observation: VerifyObservation): VerifyDecision {
  let mustPassed = 0;
  let mustTotal = 0;
  let shouldPassed = 0;
  let shouldTotal = 0;
  const reasons: string[] = [];
  const errors: string[] = [];

  for (const command of observation.commands_run) {
    if (command.exit_code !== 0) {
      errors.push(
        `${command.command}: exit ${command.exit_code}`
      );
    }
  }

  for (const result of observation.scenario_results) {
    if (result.priority === "must") {
      mustTotal += 1;
      if (result.status === "passed") {
        mustPassed += 1;
      } else if (result.status === "not_run") {
        errors.push(
          `${result.scenario}: ${result.evidence ?? result.status}`
        );
      } else {
        reasons.push(
          `${result.scenario}: ${result.evidence ?? result.status}`
        );
      }
      continue;
    }

    shouldTotal += 1;
    if (result.status === "passed") {
      shouldPassed += 1;
    } else if (result.status === "not_run") {
      errors.push(
        `${result.scenario}: ${result.evidence ?? result.status}`
      );
    }
  }

  return {
    status:
      reasons.length > 0
        ? "fail"
        : errors.length > 0
          ? "inconclusive"
          : "pass",
    must_passed: mustPassed,
    must_total: mustTotal,
    should_passed: shouldPassed,
    should_total: shouldTotal,
    reasons,
    errors
  };
}
