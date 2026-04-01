import { describe, expect, it } from "vitest";

import { judgeVerification } from "../../src/runtime/verification";
import type { VerifyObservation } from "../../src/domain/types";

describe("verification judgment", () => {
  it("passes when all must scenarios pass", () => {
    const observation: VerifyObservation = {
      verification_spec_id: "verify-1",
      commands_run: [],
      scenario_results: [
        {
          scenario: "build passes",
          priority: "must",
          status: "passed"
        },
        {
          scenario: "warning-free output",
          priority: "should",
          status: "failed",
          evidence: "one warning"
        }
      ],
      generated_artifacts: [],
      summary: "build passed with one warning"
    };

    expect(judgeVerification(observation)).toEqual({
      status: "pass",
      must_passed: 1,
      must_total: 1,
      should_passed: 0,
      should_total: 1,
      reasons: [],
      errors: []
    });
  });

  it("fails when any must scenario fails and reports evidence", () => {
    const observation: VerifyObservation = {
      verification_spec_id: "verify-1",
      commands_run: [],
      scenario_results: [
        {
          scenario: "tests pass",
          priority: "must",
          status: "failed",
          evidence: "exit 1"
        }
      ],
      generated_artifacts: [],
      summary: "tests failed"
    };

    expect(judgeVerification(observation)).toEqual({
      status: "fail",
      must_passed: 0,
      must_total: 1,
      should_passed: 0,
      should_total: 0,
      reasons: ["tests pass: exit 1"],
      errors: []
    });
  });

  it("returns inconclusive when a required scenario was not run", () => {
    const observation: VerifyObservation = {
      verification_spec_id: "verify-1",
      commands_run: [],
      scenario_results: [
        {
          scenario: "tests pass",
          priority: "must",
          status: "not_run",
          evidence: "worker timed out"
        }
      ],
      generated_artifacts: [],
      summary: "verification aborted"
    };

    expect(judgeVerification(observation)).toEqual({
      status: "inconclusive",
      must_passed: 0,
      must_total: 1,
      should_passed: 0,
      should_total: 0,
      reasons: [],
      errors: ["tests pass: worker timed out"]
    });
  });
});
