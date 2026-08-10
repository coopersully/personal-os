#!/usr/bin/env bash
set -Eeuo pipefail

api_scaling_resource="service/${ECS_CLUSTER}/${API_SERVICE}"
api_active_child_pid=""
api_captured_output=""
api_described_tasks='{"failures":[],"tasks":[]}'
api_scaling_suspension=""
api_service_drain_attempted=false
api_suspension_attempted=false
api_rollout_complete=false
api_deployment_heartbeat_pid=""
api_deployment_heartbeat_started=false
api_deployment_heartbeat_interval_seconds="${API_DEPLOYMENT_HEARTBEAT_INTERVAL_SECONDS:-30}"
api_deployment_heartbeat_retry_seconds="${API_DEPLOYMENT_HEARTBEAT_RETRY_SECONDS:-5}"
api_deployment_heartbeat_background_enabled="${API_DEPLOYMENT_HEARTBEAT_BACKGROUND_ENABLED:-true}"
api_deployment_heartbeat_failure_file=""
api_deployment_heartbeat_ready_file=""
api_recovery_entry=false
api_recovery_marker_persisted=false
api_recovery_cleanup_persisted=false
api_all_suspended_state="$(
  jq -nc '{
    DynamicScalingInSuspended: true,
    DynamicScalingOutSuspended: true,
    ScheduledScalingSuspended: true
  }'
)"

describe_task_definition() {
  capture_interruptible aws ecs describe-task-definition \
    --task-definition "$1" \
    --query taskDefinition \
    --output json
}

task_definition_has_shutdown_contract() {
  task_definition_json="$1"
  jq -e \
    '
      ([.containerDefinitions[] | select(.name == "api")] | length) == 1 and
      (
        [.containerDefinitions[] | select(.name == "api")][0] |
        .stopTimeout == 120 and
        ([.environment[]? | select(
          .name == "API_SHUTDOWN_TIMEOUT_MS" and
          .value == "105000"
        )] | length) == 1 and
        ([.environment[]? | select(
          .name == "API_SHUTDOWN_TIMEOUT_MS"
        )] | length) == 1
      )
    ' \
    <<<"$task_definition_json" \
    >/dev/null
}

run_interruptible() {
  api_active_child_pid="pending"
  "$@" &
  api_active_child_pid="$!"
  if wait "$api_active_child_pid"; then
    api_active_child_pid=""
    return 0
  else
    command_exit_code="$?"
    api_active_child_pid=""
    return "$command_exit_code"
  fi
}

publish_api_deployment_state() {
  deployment_state="$1"
  AWS_MAX_ATTEMPTS=3 aws cloudwatch put-metric-data \
    --namespace ilo/Deployments \
    --metric-data "MetricName=ApiDeploymentInProgress,Value=${deployment_state},Unit=Count" \
    --region "$AWS_REGION" \
    --cli-connect-timeout 5 \
    --cli-read-timeout 10
}

wait_for_api_deployment_alarm_state() {
  expected_state="$1"
  for alarm_state_delay in 0 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5; do
    if test "$alarm_state_delay" != "0"; then
      sleep "$alarm_state_delay"
    fi
    observed_state="$(
      AWS_MAX_ATTEMPTS=2 aws cloudwatch describe-alarms \
        --alarm-names "${ECS_CLUSTER}-api-deployment-in-progress" \
        --query 'MetricAlarms[0].StateValue' \
        --output text \
        --region "$AWS_REGION" \
        --cli-connect-timeout 5 \
        --cli-read-timeout 10
    )" || continue
    if test "$observed_state" = "$expected_state"; then
      return 0
    fi
  done
  return 1
}

start_api_deployment_heartbeat() {
  publish_api_deployment_state 1
  api_deployment_heartbeat_started=true
  if test "$api_deployment_heartbeat_background_enabled" = "true"; then
    api_deployment_heartbeat_failure_file="$(mktemp "${RUNNER_TEMP:-/tmp}/ilo-api-heartbeat.XXXXXX")"
    api_deployment_heartbeat_ready_file="$(mktemp "${RUNNER_TEMP:-/tmp}/ilo-api-heartbeat-ready.XXXXXX")"
    (
      trap - ERR EXIT INT TERM
      while true; do
        heartbeat_refreshed=false
        for heartbeat_attempt in 1 2 3; do
          if publish_api_deployment_state 1; then
            heartbeat_refreshed=true
            break
          fi
          if test "$heartbeat_attempt" != "3"; then
            /bin/sleep "$api_deployment_heartbeat_retry_seconds"
          fi
        done
        if test "$heartbeat_refreshed" != "true"; then
          printf '%s\n' "The API deployment heartbeat failed after three attempts." \
            >"$api_deployment_heartbeat_failure_file"
          exit 1
        fi
        printf '%s\n' ready >"$api_deployment_heartbeat_ready_file"
        /bin/sleep "$api_deployment_heartbeat_interval_seconds"
      done
    ) &
    api_deployment_heartbeat_pid="$!"
    for heartbeat_ready_attempt in {1..600}; do
      if test -s "$api_deployment_heartbeat_ready_file"; then
        break
      fi
      assert_api_deployment_heartbeat_healthy || return 1
      /bin/sleep 0.1
    done
    if test ! -s "$api_deployment_heartbeat_ready_file"; then
      echo "::error::The API deployment heartbeat worker did not become ready; aborting the rollout."
      return 1
    fi
  fi
  if ! wait_for_api_deployment_alarm_state ALARM; then
    stop_api_deployment_heartbeat || true
    echo "::error::The API deployment heartbeat alarm did not become active before drain."
    return 1
  fi
}

assert_api_deployment_heartbeat_healthy() {
  if {
    test -n "$api_deployment_heartbeat_failure_file" &&
      test -s "$api_deployment_heartbeat_failure_file"
  }; then
    echo "::error::The API deployment heartbeat could not be refreshed; aborting the rollout."
    return 1
  fi
  if {
    test "$api_deployment_heartbeat_background_enabled" = "true" &&
      test -n "$api_deployment_heartbeat_pid" &&
      ! kill -0 "$api_deployment_heartbeat_pid" 2>/dev/null
  }; then
    echo "::error::The API deployment heartbeat stopped unexpectedly; aborting the rollout."
    return 1
  fi
}

stop_api_deployment_heartbeat() {
  if test -n "$api_deployment_heartbeat_pid"; then
    kill -TERM "$api_deployment_heartbeat_pid" 2>/dev/null || true
    wait "$api_deployment_heartbeat_pid" 2>/dev/null || true
    api_deployment_heartbeat_pid=""
  fi
  if test "$api_deployment_heartbeat_started" = "true"; then
    publish_api_deployment_state 0
    api_deployment_heartbeat_started=false
  fi
  if test -n "$api_deployment_heartbeat_failure_file"; then
    rm -f "$api_deployment_heartbeat_failure_file"
    api_deployment_heartbeat_failure_file=""
  fi
  if test -n "$api_deployment_heartbeat_ready_file"; then
    rm -f "$api_deployment_heartbeat_ready_file"
    api_deployment_heartbeat_ready_file=""
  fi
}

capture_interruptible() {
  capture_file="$(mktemp "${RUNNER_TEMP:-/tmp}/ilo-api-deploy.XXXXXX")"
  api_captured_output=""
  if run_interruptible "$@" >"$capture_file"; then
    api_captured_output="$(<"$capture_file")"
    rm -f "$capture_file"
    return 0
  else
    command_exit_code="$?"
    rm -f "$capture_file"
    return "$command_exit_code"
  fi
}

describe_task_arns() {
  task_arns_json="$1"
  task_count="$(jq -r 'length' <<<"$task_arns_json")"
  described='{"failures":[],"tasks":[]}'
  for ((task_offset = 0; task_offset < task_count; task_offset += 100)); do
    task_batch=()
    while IFS= read -r task_arn; do
      task_batch+=("$task_arn")
    done < <(
      jq -r --argjson start "$task_offset" '.[$start:($start + 100)][]' \
        <<<"$task_arns_json"
    )
    capture_interruptible aws ecs describe-tasks \
      --cluster "$ECS_CLUSTER" \
      --tasks "${task_batch[@]}" \
      --output json
    batch_description="$api_captured_output"
    described="$(
      jq -nc \
        --argjson accumulated "$described" \
        --argjson batch "$batch_description" \
        '{
          failures: ($accumulated.failures + $batch.failures),
          tasks: ($accumulated.tasks + $batch.tasks)
        }'
    )"
  done
  api_described_tasks="$described"
}

current_scaling_suspension() {
  capture_interruptible aws application-autoscaling describe-scalable-targets \
    --service-namespace ecs \
    --resource-ids "$api_scaling_resource" \
    --scalable-dimension ecs:service:DesiredCount \
    --output json \
    --cli-connect-timeout 5 \
    --cli-read-timeout 20 ||
    return
  api_scaling_suspension="$(
    jq -ce '
      if (.ScalableTargets | length) != 1 then
        error("expected exactly one API scalable target")
      else
        .ScalableTargets[0].SuspendedState |
        {
          DynamicScalingInSuspended: (.DynamicScalingInSuspended // false),
          DynamicScalingOutSuspended: (.DynamicScalingOutSuspended // false),
          ScheduledScalingSuspended: (.ScheduledScalingSuspended // false)
        }
      end
    ' <<<"$api_captured_output"
  )"
}

persist_failed_rollout_marker() {
  recovery_registration_mode="${1:-normal}"
  if test "$api_recovery_marker_persisted" = "true"; then
    return 0
  fi
  recovery_marker="$(
    jq -nc \
      --arg failedTaskDefinitionArn "$API_TASK_DEFINITION" \
      '{version: 1, failedTaskDefinitionArn: $failedTaskDefinitionArn}'
  )"
  recovery_task_file="$(mktemp "${RUNNER_TEMP:-/tmp}/ilo-api-recovery.XXXXXX")"
  jq \
    --arg marker "$recovery_marker" \
    '
      .containerDefinitions |= map(
        if .name == "api" then
          .environment = (
            [
              .environment[]? |
              select(.name != "ILO_DEPLOYMENT_RECOVERY_MARKER")
            ] +
            [{name: "ILO_DEPLOYMENT_RECOVERY_MARKER", value: $marker}]
          )
        else . end
      ) |
      del(
        .compatibilities,
        .deregisteredAt,
        .registeredAt,
        .registeredBy,
        .requiresAttributes,
        .revision,
        .status,
        .taskDefinitionArn
      )
    ' \
    <<<"$api_final_task_definition_json" >"$recovery_task_file"
  api_recovery_registration=""
  recovery_registration_attempts=3
  recovery_registration_connect_timeout=5
  recovery_registration_read_timeout=20
  if test "$recovery_registration_mode" = "signal"; then
    recovery_registration_attempts=1
    recovery_registration_connect_timeout=1
    recovery_registration_read_timeout=2
  fi
  # RegisterTaskDefinition is not cancellable server-side. A client timeout may still leave a
  # committed revision, so recovery always discovers and validates the latest immutable marker.
  if AWS_MAX_ATTEMPTS="$recovery_registration_attempts" capture_interruptible aws ecs register-task-definition \
    --cli-input-json "file://${recovery_task_file}" \
    --query taskDefinition \
    --output json \
    --cli-connect-timeout "$recovery_registration_connect_timeout" \
    --cli-read-timeout "$recovery_registration_read_timeout"; then
    api_recovery_registration="$api_captured_output"
  fi
  rm -f "$recovery_task_file"
  if test -z "$api_recovery_registration"; then
    api_recovery_registration='{}'
  fi
  if ! jq -e \
    --arg marker "$recovery_marker" \
    '
      (.taskDefinitionArn | type) == "string" and
      (.taskDefinitionArn | length) > 0 and
      ([.containerDefinitions[] | select(.name == "api")] | length) == 1 and
      (
        [.containerDefinitions[] | select(.name == "api")][0] |
        ([.environment[]? | select(
          .name == "ILO_DEPLOYMENT_RECOVERY_MARKER" and
          .value == $marker
        )] | length) == 1
      )
    ' \
    <<<"$api_recovery_registration" \
    >/dev/null; then
    echo "::error::Could not persist and verify the failed-rollout recovery marker; operator recovery is required."
    return 1
  fi
  api_recovery_marker_persisted=true
}

clear_successful_recovery_marker() {
  if test "$api_recovery_cleanup_persisted" = "true"; then
    return 0
  fi
  cleared_restore_state="$(
    jq -c '
      .postDrainTaskDefinitionArns = [] |
      .recoveryAuthorized = false
    ' <<<"$api_restore_state"
  )"
  cleanup_task_file="$(mktemp "${RUNNER_TEMP:-/tmp}/ilo-api-recovery-clear.XXXXXX")"
  jq \
    --arg restore "$cleared_restore_state" \
    '
      .containerDefinitions |= map(
        if .name == "api" then
          .environment = (
            [
              .environment[]? |
              select(
                .name != "ILO_DEPLOYMENT_RECOVERY_MARKER" and
                .name != "ILO_DEPLOYMENT_RESTORE_STATE"
              )
            ] +
            [{name: "ILO_DEPLOYMENT_RESTORE_STATE", value: $restore}]
          )
        else . end
      ) |
      del(
        .compatibilities,
        .deregisteredAt,
        .registeredAt,
        .registeredBy,
        .requiresAttributes,
        .revision,
        .status,
        .taskDefinitionArn
      )
    ' \
    <<<"$api_final_task_definition_json" >"$cleanup_task_file"
  api_cleanup_registration=""
  # Success cleanup runs outside a signal handler and needs enough time for ECS retries.
  if AWS_MAX_ATTEMPTS=3 capture_interruptible aws ecs register-task-definition \
    --cli-input-json "file://${cleanup_task_file}" \
    --query taskDefinition \
    --output json \
    --cli-connect-timeout 5 \
    --cli-read-timeout 20; then
    api_cleanup_registration="$api_captured_output"
  fi
  rm -f "$cleanup_task_file"
  if test -z "$api_cleanup_registration"; then
    api_cleanup_registration='{}'
  fi
  if ! jq -e \
    --arg restore "$cleared_restore_state" \
    '
      (.taskDefinitionArn | type) == "string" and
      (.taskDefinitionArn | length) > 0 and
      ([.containerDefinitions[] | select(.name == "api")] | length) == 1 and
      (
        [.containerDefinitions[] | select(.name == "api")][0] |
        ([.environment[]? | select(
          .name == "ILO_DEPLOYMENT_RECOVERY_MARKER"
        )] | length) == 0 and
        ([.environment[]? | select(
          .name == "ILO_DEPLOYMENT_RESTORE_STATE" and
          .value == $restore
        )] | length) == 1
      )
    ' \
    <<<"$api_cleanup_registration" \
    >/dev/null; then
    echo "::error::Could not persist and verify recovery-marker cleanup; failing closed with a new marker."
    return 1
  fi
  api_recovery_cleanup_persisted=true
}

fail_closed_api_deployment() {
  deployment_exit_code="$1"
  trap - ERR EXIT
  if test "$api_service_drain_attempted" = "true"; then
    api_failure_scaling_suspended=true
    AWS_MAX_ATTEMPTS=1 run_interruptible aws application-autoscaling register-scalable-target \
      --service-namespace ecs \
      --resource-id "$api_scaling_resource" \
      --scalable-dimension ecs:service:DesiredCount \
      --suspended-state "$api_all_suspended_state" \
      --cli-connect-timeout 1 \
      --cli-read-timeout 2 \
      >/dev/null ||
      api_failure_scaling_suspended=false
    api_failure_suspension_state=""
    if AWS_MAX_ATTEMPTS=1 current_scaling_suspension 2>/dev/null; then
      api_failure_suspension_state="$api_scaling_suspension"
    fi
    if test "$api_failure_suspension_state" != "$api_all_suspended_state"; then
      api_failure_scaling_suspended=false
    fi
    AWS_MAX_ATTEMPTS=1 run_interruptible aws ecs update-service \
      --cluster "$ECS_CLUSTER" \
      --service "$API_SERVICE" \
      --desired-count 0 \
      --cli-connect-timeout 1 \
      --cli-read-timeout 2 \
      >/dev/null ||
      true
    AWS_MAX_ATTEMPTS=1 run_interruptible aws ecs wait services-stable \
      --cluster "$ECS_CLUSTER" \
      --services "$API_SERVICE" \
      --cli-connect-timeout 1 \
      --cli-read-timeout 2 ||
      true
    api_failure_counts=""
    if AWS_MAX_ATTEMPTS=1 capture_interruptible aws ecs describe-services \
      --cluster "$ECS_CLUSTER" \
      --services "$API_SERVICE" \
      --query 'services[0].[desiredCount,runningCount,pendingCount]' \
      --output text \
      --cli-connect-timeout 1 \
      --cli-read-timeout 2 \
      2>/dev/null; then
      api_failure_counts="$api_captured_output"
    fi
    if {
      test "$api_failure_scaling_suspended" != "true" ||
        test "$api_failure_counts" != $'0\t0\t0'
    }; then
      echo "::error::Fail-closed recovery could not prove scaling re-suspension plus desired/running/pending zero: ${api_failure_counts:-unavailable}"
    else
      echo "::error::The API rollout failed after drain began; scaling was re-suspended and the service was stopped at desired/running/pending zero."
    fi
    persist_failed_rollout_marker || true
  fi
  stop_api_deployment_heartbeat || true
  trap - ERR EXIT INT TERM
  exit "$deployment_exit_code"
}

cleanup_api_deployment() {
  deployment_exit_code="$?"
  if {
    test "$api_service_drain_attempted" = "true" &&
      test "$api_rollout_complete" != "true"
  }; then
    fail_closed_api_deployment "$deployment_exit_code"
  elif {
    test "$api_suspension_attempted" = "true" &&
      test "$api_rollout_complete" != "true"
  }; then
    trap - ERR EXIT
    api_predrain_scaling_restored=true
    AWS_MAX_ATTEMPTS=1 run_interruptible aws application-autoscaling register-scalable-target \
      --service-namespace ecs \
      --resource-id "$api_scaling_resource" \
      --scalable-dimension ecs:service:DesiredCount \
      --suspended-state "$api_original_suspended_state" \
      --cli-connect-timeout 1 \
      --cli-read-timeout 2 \
      >/dev/null ||
      api_predrain_scaling_restored=false
    api_predrain_suspension_state=""
    if current_scaling_suspension 2>/dev/null; then
      api_predrain_suspension_state="$api_scaling_suspension"
    fi
    if {
      test "$api_predrain_scaling_restored" != "true" ||
        test "$api_predrain_suspension_state" != "$api_original_suspended_state"
    }; then
      echo "::error::Pre-drain failure preserved the old service but could not prove exact scaling-state restoration."
    fi
    stop_api_deployment_heartbeat || true
    trap - ERR EXIT INT TERM
  elif test "$api_deployment_heartbeat_started" = "true"; then
    stop_api_deployment_heartbeat || true
  fi
}

cancel_api_deployment() {
  cancellation_exit_code="$1"
  trap - ERR EXIT INT TERM
  if test "$api_active_child_pid" = "pending"; then
    while IFS= read -r active_job_pid; do
      kill -TERM "$active_job_pid" 2>/dev/null || true
    done < <(jobs -pr)
    wait 2>/dev/null || true
    api_active_child_pid=""
  elif test -n "$api_active_child_pid"; then
    kill -TERM "$api_active_child_pid" 2>/dev/null || true
    wait "$api_active_child_pid" 2>/dev/null || true
    api_active_child_pid=""
  fi
  if test "$api_service_drain_attempted" = "true"; then
    AWS_MAX_ATTEMPTS=1 aws application-autoscaling register-scalable-target \
      --service-namespace ecs \
      --resource-id "$api_scaling_resource" \
      --scalable-dimension ecs:service:DesiredCount \
      --suspended-state "$api_all_suspended_state" \
      --cli-connect-timeout 1 \
      --cli-read-timeout 2 \
      >/dev/null ||
      true
    AWS_MAX_ATTEMPTS=1 aws ecs update-service \
      --cluster "$ECS_CLUSTER" \
      --service "$API_SERVICE" \
      --desired-count 0 \
      --cli-connect-timeout 1 \
      --cli-read-timeout 2 \
      >/dev/null ||
      true
    persist_failed_rollout_marker signal || true
  elif test "$api_suspension_attempted" = "true"; then
    AWS_MAX_ATTEMPTS=1 aws application-autoscaling register-scalable-target \
      --service-namespace ecs \
      --resource-id "$api_scaling_resource" \
      --scalable-dimension ecs:service:DesiredCount \
      --suspended-state "$api_original_suspended_state" \
      --cli-connect-timeout 1 \
      --cli-read-timeout 2 \
      >/dev/null ||
      true
  fi
  stop_api_deployment_heartbeat || true
  exit "$cancellation_exit_code"
}

trap cleanup_api_deployment EXIT
trap 'cancel_api_deployment 130' INT
trap 'cancel_api_deployment 143' TERM

# The final task definition is also the durable recovery record. A failed
# post-drain run leaves the service at zero/all-suspended, while the latest
# immutable task definition retains the desired count and exact scaling state
# observed before that drain. A later run must inherit this record rather than
# misclassifying the emergency posture as operator intent.
describe_task_definition "$API_TASK_DEFINITION"
api_final_task_definition_json="$api_captured_output"
if ! task_definition_has_shutdown_contract "$api_final_task_definition_json"; then
  echo "::error::The migration-capable API task definition did not inherit the prerequisite 120-second/105-second shutdown contract."
  exit 1
fi
api_restore_state="$(
  jq -cer '
    [.containerDefinitions[] | select(.name == "api")][0] |
    [.environment[]? | select(.name == "ILO_DEPLOYMENT_RESTORE_STATE") | .value][0] |
    fromjson |
    select(
      (.desiredCount | type) == "number" and
      (.desiredCount | floor) == .desiredCount and
      .desiredCount > 0 and
      .desiredCount <= 100 and
      (.suspendedState | type) == "object" and
      (.postDrainTaskDefinitionArns | type) == "array" and
      (.postDrainTaskDefinitionArns | length) <= 100 and
      (.postDrainTaskDefinitionArns | unique | length) ==
        (.postDrainTaskDefinitionArns | length) and
      (.recoveryAuthorized | type) == "boolean" and
      all(
        .postDrainTaskDefinitionArns[];
        type == "string" and length > 0
      )
    ) |
    {
      desiredCount,
      suspendedState: {
        DynamicScalingInSuspended: (.suspendedState.DynamicScalingInSuspended // false),
        DynamicScalingOutSuspended: (.suspendedState.DynamicScalingOutSuspended // false),
        ScheduledScalingSuspended: (.suspendedState.ScheduledScalingSuspended // false)
      },
      postDrainTaskDefinitionArns,
      recoveryAuthorized
    }
  ' <<<"$api_final_task_definition_json"
)" || {
  echo "::error::The migration-capable API task definition lacks a valid persisted restore intent."
  exit 1
}
api_restore_desired_count="$(jq -r '.desiredCount' <<<"$api_restore_state")"
api_restore_suspended_state="$(jq -c '.suspendedState' <<<"$api_restore_state")"
api_post_drain_task_definitions="$(
  jq -c '.postDrainTaskDefinitionArns' <<<"$api_restore_state"
)"
api_recovery_authorized="$(jq -r '.recoveryAuthorized' <<<"$api_restore_state")"
api_candidate_marker_count="$(
  jq -r '
    [.containerDefinitions[] | select(.name == "api")][0] |
    [.environment[]? | select(.name == "ILO_DEPLOYMENT_RECOVERY_MARKER")] |
    length
  ' <<<"$api_final_task_definition_json"
)"
api_candidate_failed_definition="$(
  jq -er '
    [.containerDefinitions[] | select(.name == "api")][0] |
    [.environment[]? | select(.name == "ILO_DEPLOYMENT_RECOVERY_MARKER") | .value][0] |
    fromjson |
    select(
      .version == 1 and
      (.failedTaskDefinitionArn | type) == "string" and
      (.failedTaskDefinitionArn | length) > 0
    ) |
    .failedTaskDefinitionArn
  ' <<<"$api_final_task_definition_json" 2>/dev/null || true
)"
if {
  test "$api_recovery_authorized" = "true" &&
    {
      test "$api_candidate_marker_count" != "1" ||
        test -z "$api_candidate_failed_definition" ||
        ! jq -e \
          --arg definition "$api_candidate_failed_definition" \
          'index($definition) != null' \
          <<<"$api_post_drain_task_definitions" \
          >/dev/null
    }
}; then
  echo "::error::The authorized recovery candidate lacks its exact unconsumed failed-rollout marker (marker count: ${api_candidate_marker_count}; failed definition: ${api_candidate_failed_definition:-missing}; authorized definitions: ${api_post_drain_task_definitions})."
  exit 1
elif {
  test "$api_recovery_authorized" = "false" &&
    test "$api_candidate_marker_count" != "0"
}; then
  echo "::error::A normal migration-capable task definition must not carry a recovery marker."
  exit 1
fi

capture_interruptible aws ecs describe-services \
  --cluster "$ECS_CLUSTER" \
  --services "$API_SERVICE" \
  --output json
api_gate_service="$api_captured_output"
api_gate_desired="$(
  jq -r '.services[0].desiredCount' <<<"$api_gate_service"
)"
api_gate_running="$(
  jq -r '.services[0].runningCount' <<<"$api_gate_service"
)"
api_gate_pending="$(
  jq -r '.services[0].pendingCount' <<<"$api_gate_service"
)"
api_current_primary="$(
  jq -r '
    [.services[0].deployments[] | select(.status == "PRIMARY")][0].taskDefinition // ""
  ' <<<"$api_gate_service"
)"
if test -z "$api_current_primary"; then
  echo "::error::The API service lacks an observable primary task definition."
  exit 1
fi
describe_task_definition "$api_current_primary"
api_current_task_definition_json="$api_captured_output"
if ! task_definition_has_shutdown_contract "$api_current_task_definition_json"; then
  echo "::error::The live API primary has not completed the prerequisite 120-second/105-second shutdown rollout."
  exit 1
fi
api_current_image="$(
  jq -r '[.containerDefinitions[] | select(.name == "api")][0].image' \
    <<<"$api_current_task_definition_json"
)"
current_scaling_suspension
api_gate_suspended_state="$api_scaling_suspension"
if {
  test "$api_gate_desired" = "0" &&
    test "$api_gate_running" = "0" &&
    test "$api_gate_pending" = "0" &&
    test "$api_gate_suspended_state" = "$api_all_suspended_state"
}; then
  if test "$api_recovery_authorized" != "true"; then
    echo "::error::The API is zero/all-suspended without consumed failed-rollout authorization; preserving the stop."
    exit 1
  fi
  api_recovery_entry=true
elif ! {
  test "$api_gate_desired" -gt 0 &&
    test "$api_gate_desired" = "$api_gate_running" &&
    test "$api_gate_pending" = "0"
}; then
  echo "::error::The live API service is neither a healthy bootstrapped primary nor a recognized fail-closed recovery state."
  exit 1
fi
if {
  test "$api_recovery_entry" != "true" &&
    {
      test "$api_restore_desired_count" != "$api_gate_desired" ||
      test "$api_restore_suspended_state" != "$api_gate_suspended_state" ||
        test "$api_post_drain_task_definitions" != "[]" ||
        test "$api_recovery_authorized" != "false"
    }
}; then
  echo "::error::The release restore intent does not match the live pre-drain desired/scaling state."
  exit 1
fi

if test "$api_recovery_entry" != "true"; then
  capture_interruptible aws ecs list-tasks \
    --cluster "$ECS_CLUSTER" \
    --service-name "$API_SERVICE" \
    --desired-status RUNNING \
    --query taskArns \
    --output json
  api_gate_running_arns="$api_captured_output"
  if test "$(jq -r 'length' <<<"$api_gate_running_arns")" != "$api_gate_running"; then
    echo "::error::The drain-protocol gate could not capture the exact running API task set."
    exit 1
  fi
  describe_task_arns "$api_gate_running_arns"
  api_gate_tasks="$api_described_tasks"
  if ! jq -e \
    --arg definition "$api_current_primary" \
    --arg image "$api_current_image" \
    --argjson expected "$api_gate_running" \
    '
      (.failures | length) == 0 and
      (.tasks | length) == $expected and
      ([
        .tasks[].containers[] |
        select(.name == "api") |
        .imageDigest |
        select(type == "string" and length > 0)
      ] | length) == $expected and
      ([
        .tasks[].containers[] |
        select(.name == "api") |
        .imageDigest
      ] | unique | length) == 1 and
      all(
        .tasks[];
        .taskDefinitionArn == $definition and
        ([.containers[] | select(
          .name == "api" and
          .lastStatus == "RUNNING" and
          .image == $image
        )] | length) == 1
      )
    ' \
    <<<"$api_gate_tasks" \
    >/dev/null; then
    echo "::error::Every live API task must match the bootstrapped primary definition/image and one identical nonempty image digest before drain."
    exit 1
  fi
  capture_interruptible curl \
    --fail \
    --silent \
    --show-error \
    --dump-header - \
    --output /dev/null \
    "${API_URL}/health/ready"
  api_drain_protocol="$(
    awk '
      tolower($1) == "x-ilo-drain-protocol:" { value = $2 }
      END {
        gsub("\r", "", value)
        print value
      }
    ' <<<"$api_captured_output"
  )"
  if test "$api_drain_protocol" != "quiesce-v1"; then
    echo "::error::The live API readiness endpoint did not prove drain protocol quiesce-v1."
    exit 1
  fi
fi

# Prove list authority before changing scaling or desired count. The
# exact result is captured again after scaling is suspended.
aws ecs list-tasks \
  --cluster "$ECS_CLUSTER" \
  --service-name "$API_SERVICE" \
  --desired-status RUNNING \
  --query taskArns \
  --output json \
  >/dev/null
api_stopped_preflight="$(
  aws ecs list-tasks \
    --cluster "$ECS_CLUSTER" \
    --service-name "$API_SERVICE" \
    --desired-status STOPPED \
    --max-items 101 \
    --query taskArns \
    --output json
)"
if test "$(jq -r 'length' <<<"$api_stopped_preflight")" -gt 100; then
  echo "::error::The recent STOPPED task baseline exceeds the bounded 100-task drain audit."
  exit 1
fi
describe_task_arns "$api_stopped_preflight"
api_stopped_preflight_details="$api_described_tasks"
if test "$(jq -r '.failures | length' <<<"$api_stopped_preflight_details")" != "0"; then
  echo "::error::Could not inspect the initial STOPPED task baseline."
  exit 1
fi
# Only tasks already observed with complete STOPPED evidence before any
# deployment mutation are historical. Every incomplete or later observation
# remains in the exact drain proof, avoiding cross-system clock assumptions.
api_proven_stopped_before="$(
  jq -c \
    '[
      .tasks[] |
      select(
        .lastStatus == "STOPPED" and
          ((.stoppedAt | type) == "string")
      ) |
      .taskArn
    ]' \
    <<<"$api_stopped_preflight_details"
)"
if test "$api_recovery_entry" = "true"; then
  # A prior migration-capable task may itself have failed after the old binary
  # already passed exit proof. Only task definitions accumulated explicitly in
  # immutable recovery metadata are exempted as prior failed rollout evidence.
  # Every other recent STOPPED task remains in the old-task exit proof.
  api_proven_stopped_before="$(
    jq -c \
      --argjson postDrainDefinitions "$api_post_drain_task_definitions" \
      '[
        .tasks[] |
        select(
          .lastStatus == "STOPPED" and
          ((.stoppedAt | type) == "string") and
          (.taskDefinitionArn as $definition |
            $postDrainDefinitions | index($definition))
        ) |
        .taskArn
      ]' \
      <<<"$api_stopped_preflight_details"
  )"
fi
api_unproven_stopped_at_preflight="$(
  jq -nc \
    --argjson listed "$api_stopped_preflight" \
    --argjson proven "$api_proven_stopped_before" \
    '[$listed[] | select(. as $arn | $proven | index($arn) | not)]'
)"
current_scaling_suspension
if test "$api_recovery_entry" = "true"; then
  api_original_suspended_state="$api_restore_suspended_state"
else
  api_original_suspended_state="$api_scaling_suspension"
fi

api_service_before="$(
  aws ecs describe-services \
    --cluster "$ECS_CLUSTER" \
    --services "$API_SERVICE" \
    --output json
)"
api_before_counts="$(
  jq -r '.services[0] | [.desiredCount, .runningCount, .pendingCount] | @tsv' \
    <<<"$api_service_before"
)"
api_before_desired="$(cut -f1 <<<"$api_before_counts")"
api_before_running="$(cut -f2 <<<"$api_before_counts")"
api_before_pending="$(cut -f3 <<<"$api_before_counts")"
if ! {
  test "$api_before_pending" = "0" &&
    test "$api_before_desired" = "$api_before_running"
}; then
  echo "::error::The API service must be stable before drain: ${api_before_counts}"
  exit 1
fi
api_minimum_healthy_percent="$(
  jq -r '.services[0].deploymentConfiguration.minimumHealthyPercent' \
    <<<"$api_service_before"
)"
api_maximum_percent="$(
  jq -r '.services[0].deploymentConfiguration.maximumPercent' \
    <<<"$api_service_before"
)"
api_breaker_enable="$(
  jq -r '.services[0].deploymentConfiguration.deploymentCircuitBreaker.enable' \
    <<<"$api_service_before"
)"
api_breaker_rollback="$(
  jq -r '.services[0].deploymentConfiguration.deploymentCircuitBreaker.rollback' \
    <<<"$api_service_before"
)"
if ! {
  test "$api_minimum_healthy_percent" = "0" &&
    test "$api_maximum_percent" = "200" &&
    test "$api_breaker_enable" = "true" &&
    {
      test "$api_breaker_rollback" = "true" ||
        {
          test "$api_recovery_entry" = "true" &&
            test "$api_breaker_rollback" = "false"
        }
    }
}; then
  echo "::error::The API deployment configuration does not match the required IaC state (minimum 0, maximum 200, circuit breaker enabled with rollback)."
  exit 1
fi
api_breaker_disabled_configuration="$(
  jq -nc \
    --argjson minimum "$api_minimum_healthy_percent" \
    --argjson maximum "$api_maximum_percent" \
    '{
      minimumHealthyPercent: $minimum,
      maximumPercent: $maximum,
      deploymentCircuitBreaker: {enable: true, rollback: false}
    }'
)"
api_iac_deployment_configuration="$(
  jq -nc \
    --argjson minimum "$api_minimum_healthy_percent" \
    --argjson maximum "$api_maximum_percent" \
    '{
      minimumHealthyPercent: $minimum,
      maximumPercent: $maximum,
      deploymentCircuitBreaker: {enable: true, rollback: true}
    }'
)"

# Stop and drain the old binary before the new task runs migrations.
# Connector lifecycle migrations invalidate cached authority and cannot
# safely coexist with a pre-fence process that is still in provider I/O.
start_api_deployment_heartbeat
assert_api_deployment_heartbeat_healthy
if test "$api_recovery_entry" = "true"; then
  # RegisterScalableTarget may enforce MinCapacity even when the request also
  # carries an all-suspended state. Recovery already entered from a proven
  # zero/all-suspended posture, so mutating the target here could restart the
  # failed primary before the corrected migration-capable definition launches.
  current_scaling_suspension
else
  api_suspension_attempted=true
  run_interruptible aws application-autoscaling register-scalable-target \
    --service-namespace ecs \
    --resource-id "$api_scaling_resource" \
    --scalable-dimension ecs:service:DesiredCount \
    --suspended-state "$api_all_suspended_state" \
    >/dev/null
  current_scaling_suspension
fi
if test "$api_scaling_suspension" != "$api_all_suspended_state"; then
  echo "::error::Could not prove all API scaling modes are suspended before drain."
  false
fi
if test "$api_recovery_entry" != "true"; then
  run_interruptible aws ecs wait services-stable \
    --cluster "$ECS_CLUSTER" \
    --services "$API_SERVICE"
fi
capture_interruptible aws ecs describe-services \
  --cluster "$ECS_CLUSTER" \
  --services "$API_SERVICE" \
  --output json
api_suspended_service_state="$api_captured_output"
api_suspended_desired="$(
  jq -r '.services[0].desiredCount' <<<"$api_suspended_service_state"
)"
api_suspended_running="$(
  jq -r '.services[0].runningCount' <<<"$api_suspended_service_state"
)"
api_suspended_pending="$(
  jq -r '.services[0].pendingCount' <<<"$api_suspended_service_state"
)"
if {
  test "$api_recovery_entry" = "true" &&
    ! {
      test "$api_suspended_desired" = "0" &&
        test "$api_suspended_running" = "0" &&
        test "$api_suspended_pending" = "0"
    }
}; then
  echo "::error::The API left its proven zero state before recovery drain capture; refusing to launch the candidate."
  false
fi
if test "$api_suspended_pending" != "0"; then
  echo "::error::The API service gained pending work before exact drain capture."
  false
fi

capture_interruptible aws ecs list-tasks \
  --cluster "$ECS_CLUSTER" \
  --service-name "$API_SERVICE" \
  --desired-status STOPPED \
  --max-items 101 \
  --query taskArns \
  --output json
api_stopped_before_drain="$api_captured_output"
if test "$(jq -r 'length' <<<"$api_stopped_before_drain")" -gt 100; then
  echo "::error::The post-suspension STOPPED task baseline exceeds the bounded 100-task drain audit."
  false
fi
describe_task_arns "$api_stopped_before_drain"
api_stopped_before_details="$api_described_tasks"
if test "$(jq -r '.failures | length' <<<"$api_stopped_before_details")" != "0"; then
  echo "::error::Could not inspect service tasks already marked for stop before drain."
  false
fi
api_active_stopping_before="$(
  jq -c \
    --argjson proven "$api_proven_stopped_before" \
    --argjson initial "$api_unproven_stopped_at_preflight" \
    '$initial + [
      .tasks[] |
      select(.taskArn as $arn | $proven | index($arn) | not) |
      .taskArn
    ] | unique' \
    <<<"$api_stopped_before_details"
)"
# ECS desiredStatus is only RUNNING or STOPPED. This RUNNING query also
# captures tasks whose lastStatus is still PENDING; the service-count
# comparison below detects a pending/replacement race after stabilization.
capture_interruptible aws ecs list-tasks \
  --cluster "$ECS_CLUSTER" \
  --service-name "$API_SERVICE" \
  --desired-status RUNNING \
  --query taskArns \
  --output json
api_running_before="$api_captured_output"
api_pre_drain_task_arns="$(
  jq -nc \
    --argjson running "$api_running_before" \
    --argjson stopping "$api_active_stopping_before" \
    '$running + $stopping | unique'
)"
api_pre_drain_task_count="$(jq -r 'length' <<<"$api_pre_drain_task_arns")"
if test "$(jq -r 'length' <<<"$api_running_before")" != "$api_suspended_running"; then
  echo "::error::Exact running-task capture did not match the post-suspension stable count."
  false
fi
if test "$api_pre_drain_task_count" -gt 100; then
  echo "::error::Exact drain validation supports at most 100 API tasks per deployment."
  false
fi

api_service_drain_attempted=true
if test "$api_recovery_entry" != "true"; then
  run_interruptible aws ecs update-service \
    --cluster "$ECS_CLUSTER" \
    --service "$API_SERVICE" \
    --desired-count 0 \
    >/dev/null
  run_interruptible aws ecs wait services-stable \
    --cluster "$ECS_CLUSTER" \
    --services "$API_SERVICE"
fi
capture_interruptible aws ecs describe-services \
  --cluster "$ECS_CLUSTER" \
  --services "$API_SERVICE" \
  --query 'services[0].[desiredCount,runningCount,pendingCount]' \
  --output text
api_counts="$api_captured_output"
test "$api_counts" = $'0\t0\t0' || {
  echo "::error::The old API service did not drain completely: ${api_counts}"
  false
}

api_stopped_after_drain=""
api_stopped_inventory_stable=0
api_stopped_inventory_attempt=0
for reconciliation_delay in 1 2 4 8 16 32 32 32 32 32 32 32 32 32; do
  run_interruptible sleep "$reconciliation_delay"
  api_stopped_inventory_attempt=$((api_stopped_inventory_attempt + 1))
  capture_interruptible aws ecs list-tasks \
    --cluster "$ECS_CLUSTER" \
    --service-name "$API_SERVICE" \
    --desired-status STOPPED \
    --max-items 101 \
    --query taskArns \
    --output json
  api_stopped_inventory="$(jq -c 'sort' <<<"$api_captured_output")"
  if test "$(jq -r 'length' <<<"$api_stopped_inventory")" -gt 100; then
    echo "::error::The STOPPED task inventory exceeded the bounded 100-task drain audit."
    false
  fi
  if test "$api_stopped_inventory" = "$api_stopped_after_drain"; then
    api_stopped_inventory_stable=$((api_stopped_inventory_stable + 1))
  else
    api_stopped_inventory_stable=1
    api_stopped_after_drain="$api_stopped_inventory"
  fi
  if {
    test "$api_stopped_inventory_attempt" -ge 14 &&
      test "$api_stopped_inventory_stable" -ge 3
  }; then
    break
  fi
done
if test "$api_stopped_inventory_stable" -lt 3; then
  echo "::error::The exact STOPPED task inventory did not converge during bounded reconciliation."
  false
fi
api_drain_task_arns="$(
  jq -nc \
    --argjson captured "$api_pre_drain_task_arns" \
    --argjson provenStoppedBefore "$api_proven_stopped_before" \
    --argjson stoppedAfter "$api_stopped_after_drain" \
    '$captured + [$stoppedAfter[] | select(. as $arn | $provenStoppedBefore | index($arn) | not)] | unique'
)"
api_drain_task_count="$(jq -r 'length' <<<"$api_drain_task_arns")"
if test "$api_drain_task_count" -gt 100; then
  echo "::error::More than 100 exact API tasks ran across the bounded drain transition."
  false
fi

if test "$api_drain_task_count" -gt 0; then
  api_drain_tasks=()
  while IFS= read -r task_arn; do
    api_drain_tasks+=("$task_arn")
  done < <(jq -r '.[]' <<<"$api_drain_task_arns")
  run_interruptible aws ecs wait tasks-stopped \
    --cluster "$ECS_CLUSTER" \
    --tasks "${api_drain_tasks[@]}"
  capture_interruptible aws ecs describe-tasks \
    --cluster "$ECS_CLUSTER" \
    --tasks "${api_drain_tasks[@]}" \
    --output json
  api_stopped_tasks="$api_captured_output"
  if ! jq -e \
    --argjson expected "$api_drain_task_count" \
    '
      (.failures | length) == 0 and
      (.tasks | length) == $expected and
      all(
        .tasks[];
        .lastStatus == "STOPPED" and
        ([.containers[] | select(.name == "api")] | length) == 1 and
        ([.containers[] | select(.name == "api")][0] |
          .lastStatus == "STOPPED" and
          .exitCode == 0 and
          ((.reason // "") | test("kill|timeout"; "i") | not)
        ) and
        ((.stoppedReason // "") | test("kill|timeout"; "i") | not)
      )
    ' \
    <<<"$api_stopped_tasks" \
    >/dev/null; then
    echo "::error::At least one exact pre-drain API task lacks a successful essential-container exit."
    false
  fi
fi

# Rollback to the last completed (old) deployment is unsafe after
# migrations. Keep the circuit breaker enabled, but rollback disabled,
# until the exact new primary has completed and remained healthy.
run_interruptible aws ecs update-service \
  --cluster "$ECS_CLUSTER" \
  --service "$API_SERVICE" \
  --deployment-configuration "$api_breaker_disabled_configuration" \
  >/dev/null
capture_interruptible aws ecs describe-services \
  --cluster "$ECS_CLUSTER" \
  --services "$API_SERVICE" \
  --query 'services[0].deploymentConfiguration.deploymentCircuitBreaker.[enable,rollback]' \
  --output text
api_disabled_breaker="$api_captured_output"
if test "$api_disabled_breaker" != $'True\tFalse'; then
  echo "::error::Could not prove circuit-breaker rollback is disabled before migration startup."
  false
fi

run_interruptible aws ecs update-service \
  --cluster "$ECS_CLUSTER" \
  --service "$API_SERVICE" \
  --task-definition "$API_TASK_DEFINITION" \
  --desired-count 1 \
  >/dev/null
run_interruptible aws ecs wait services-stable \
  --cluster "$ECS_CLUSTER" \
  --services "$API_SERVICE"
assert_api_deployment_heartbeat_healthy
api_primary_completed=false
# ECS's services-stable waiter can return after desired/running counts converge but
# before the deployment control plane publishes rolloutState=COMPLETED. Keep the
# service serial and scaling suspended while that bounded final state converges.
for api_primary_completion_delay in 0 1 2 4 8 16 30 30 30 30; do
  if test "$api_primary_completion_delay" != "0"; then
    run_interruptible sleep "$api_primary_completion_delay"
  fi
  assert_api_deployment_heartbeat_healthy
  capture_interruptible aws ecs describe-services \
    --cluster "$ECS_CLUSTER" \
    --services "$API_SERVICE" \
    --output json
  api_service_state="$api_captured_output"
  api_primary_count="$(
    jq -r '[.services[0].deployments[] | select(.status == "PRIMARY")] | length' \
      <<<"$api_service_state"
  )"
  api_primary_task="$(
    jq -r '.services[0].deployments[] | select(.status == "PRIMARY") | .taskDefinition' \
      <<<"$api_service_state"
  )"
  api_primary_rollout="$(
    jq -r '.services[0].deployments[] | select(.status == "PRIMARY") | .rolloutState' \
      <<<"$api_service_state"
  )"
  api_primary_counts="$(
    jq -r '.services[0] | [.desiredCount, .runningCount, .pendingCount] | @tsv' \
      <<<"$api_service_state"
  )"
  if {
    test "$api_primary_count" = "1" &&
      test "$api_primary_task" = "$API_TASK_DEFINITION" &&
      test "$api_primary_rollout" = "COMPLETED" &&
      test "$api_primary_counts" = $'1\t1\t0'
  }; then
    api_primary_completed=true
    break
  fi
  if ! {
    test "$api_primary_count" = "1" &&
      test "$api_primary_task" = "$API_TASK_DEFINITION" &&
      test "$api_primary_rollout" = "IN_PROGRESS" &&
      test "$api_primary_counts" = $'1\t1\t0'
  }; then
    break
  fi
done
if test "$api_primary_completed" != "true"; then
  run_interruptible aws ecs update-service \
    --cluster "$ECS_CLUSTER" \
    --service "$API_SERVICE" \
    --desired-count 0 \
    >/dev/null
  run_interruptible aws ecs wait services-stable \
    --cluster "$ECS_CLUSTER" \
    --services "$API_SERVICE"
  echo "::error::The new API task did not remain the sole completed primary deployment; the service was stopped and scaling remains suspended."
  false
fi

run_interruptible aws ecs update-service \
  --cluster "$ECS_CLUSTER" \
  --service "$API_SERVICE" \
  --deployment-configuration "$api_iac_deployment_configuration" \
  >/dev/null
capture_interruptible aws ecs describe-services \
  --cluster "$ECS_CLUSTER" \
  --services "$API_SERVICE" \
  --output json
api_restored_configuration="$api_captured_output"
if ! jq -e \
  --argjson minimum "$api_minimum_healthy_percent" \
  --argjson maximum "$api_maximum_percent" \
  '
    .services[0].deploymentConfiguration |
    .minimumHealthyPercent == $minimum and
    .maximumPercent == $maximum and
    .deploymentCircuitBreaker.enable == true and
    .deploymentCircuitBreaker.rollback == true
  ' \
  <<<"$api_restored_configuration" \
  >/dev/null; then
  echo "::error::The healthy API service did not restore the declared circuit-breaker configuration."
  false
fi

if test "$api_restore_desired_count" != "1"; then
  run_interruptible aws ecs update-service \
    --cluster "$ECS_CLUSTER" \
    --service "$API_SERVICE" \
    --desired-count "$api_restore_desired_count" \
    >/dev/null
  run_interruptible aws ecs wait services-stable \
    --cluster "$ECS_CLUSTER" \
    --services "$API_SERVICE"
  capture_interruptible aws ecs describe-services \
    --cluster "$ECS_CLUSTER" \
    --services "$API_SERVICE" \
    --output json
  api_scaled_service_state="$api_captured_output"
  if ! jq -e \
    --arg definition "$API_TASK_DEFINITION" \
    --argjson desired "$api_restore_desired_count" \
    '
      .services[0] |
      .desiredCount == $desired and
      .runningCount == $desired and
      .pendingCount == 0 and
      ([.deployments[] | select(
        .status == "PRIMARY" and
        .taskDefinition == $definition and
        .rolloutState == "COMPLETED"
      )] | length) == 1
    ' \
    <<<"$api_scaled_service_state" \
    >/dev/null; then
    echo "::error::The healthy serial API primary did not scale to the persisted desired count."
    false
  fi
fi

if test "$api_recovery_authorized" = "true"; then
  clear_successful_recovery_marker
fi

assert_api_deployment_heartbeat_healthy

run_interruptible aws application-autoscaling register-scalable-target \
  --service-namespace ecs \
  --resource-id "$api_scaling_resource" \
  --scalable-dimension ecs:service:DesiredCount \
  --suspended-state "$api_original_suspended_state" \
  >/dev/null
current_scaling_suspension
if test "$api_scaling_suspension" != "$api_original_suspended_state"; then
  echo "::error::The API scalable target did not restore its exact pre-drain suspension state."
  false
fi
api_rollout_complete=true
stop_api_deployment_heartbeat
trap - ERR EXIT INT TERM
