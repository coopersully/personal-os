#!/usr/bin/env bash
set -Eeuo pipefail

api_scaling_resource="service/${ECS_CLUSTER}/${API_SERVICE}"
api_service_drain_attempted=false
api_suspension_attempted=false
api_rollout_complete=false
api_all_suspended_state="$(
  jq -nc '{
    DynamicScalingInSuspended: true,
    DynamicScalingOutSuspended: true,
    ScheduledScalingSuspended: true
  }'
)"

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
    batch_description="$(
      aws ecs describe-tasks \
        --cluster "$ECS_CLUSTER" \
        --tasks "${task_batch[@]}" \
        --output json
    )"
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
  printf '%s\n' "$described"
}

current_scaling_suspension() {
  aws application-autoscaling describe-scalable-targets \
    --service-namespace ecs \
    --resource-ids "$api_scaling_resource" \
    --scalable-dimension ecs:service:DesiredCount \
    --output json |
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
    '
}

fail_closed_api_deployment() {
  deployment_exit_code="$1"
  trap - ERR EXIT INT TERM
  if test "$api_service_drain_attempted" = "true"; then
    api_failure_scaling_suspended=true
    AWS_MAX_ATTEMPTS=1 aws application-autoscaling register-scalable-target \
      --service-namespace ecs \
      --resource-id "$api_scaling_resource" \
      --scalable-dimension ecs:service:DesiredCount \
      --suspended-state "$api_all_suspended_state" \
      >/dev/null ||
      api_failure_scaling_suspended=false
    api_failure_suspension_state="$(
      current_scaling_suspension 2>/dev/null ||
        true
    )"
    if test "$api_failure_suspension_state" != "$api_all_suspended_state"; then
      api_failure_scaling_suspended=false
    fi
    aws ecs update-service \
      --cluster "$ECS_CLUSTER" \
      --service "$API_SERVICE" \
      --desired-count 0 \
      >/dev/null ||
      true
    aws ecs wait services-stable \
      --cluster "$ECS_CLUSTER" \
      --services "$API_SERVICE" ||
      true
    api_failure_counts="$(
      aws ecs describe-services \
        --cluster "$ECS_CLUSTER" \
        --services "$API_SERVICE" \
        --query 'services[0].[desiredCount,runningCount,pendingCount]' \
        --output text 2>/dev/null ||
        true
    )"
    if {
      test "$api_failure_scaling_suspended" != "true" ||
        test "$api_failure_counts" != $'0\t0\t0'
    }; then
      echo "::error::Fail-closed recovery could not prove scaling re-suspension plus desired/running/pending zero: ${api_failure_counts:-unavailable}"
    else
      echo "::error::The API rollout failed after drain began; scaling was re-suspended and the service was stopped at desired/running/pending zero."
    fi
  fi
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
    trap - ERR EXIT INT TERM
    api_predrain_scaling_restored=true
    AWS_MAX_ATTEMPTS=1 aws application-autoscaling register-scalable-target \
      --service-namespace ecs \
      --resource-id "$api_scaling_resource" \
      --scalable-dimension ecs:service:DesiredCount \
      --suspended-state "$api_original_suspended_state" \
      >/dev/null ||
      api_predrain_scaling_restored=false
    api_predrain_suspension_state="$(
      current_scaling_suspension 2>/dev/null ||
        true
    )"
    if {
      test "$api_predrain_scaling_restored" != "true" ||
        test "$api_predrain_suspension_state" != "$api_original_suspended_state"
    }; then
      echo "::error::Pre-drain failure preserved the old service but could not prove exact scaling-state restoration."
    fi
  fi
}

cancel_api_deployment() {
  cancellation_exit_code="$1"
  trap - ERR EXIT INT TERM
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
  exit "$cancellation_exit_code"
}

trap cleanup_api_deployment EXIT
trap 'cancel_api_deployment 130' INT
trap 'cancel_api_deployment 143' TERM

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
api_original_suspended_state="$(current_scaling_suspension)"

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
    test "$api_breaker_rollback" = "true"
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
api_drain_boundary="$(date -u +%Y-%m-%dT%H:%M:%S)"
api_suspension_attempted=true
aws application-autoscaling register-scalable-target \
  --service-namespace ecs \
  --resource-id "$api_scaling_resource" \
  --scalable-dimension ecs:service:DesiredCount \
  --suspended-state "$api_all_suspended_state" \
  >/dev/null
if test "$(current_scaling_suspension)" != "$api_all_suspended_state"; then
  echo "::error::Could not prove all API scaling modes are suspended before drain."
  false
fi
aws ecs wait services-stable \
  --cluster "$ECS_CLUSTER" \
  --services "$API_SERVICE"
api_suspended_service_state="$(
  aws ecs describe-services \
    --cluster "$ECS_CLUSTER" \
    --services "$API_SERVICE" \
    --output json
)"
api_suspended_running="$(
  jq -r '.services[0].runningCount' <<<"$api_suspended_service_state"
)"
api_suspended_pending="$(
  jq -r '.services[0].pendingCount' <<<"$api_suspended_service_state"
)"
if test "$api_suspended_pending" != "0"; then
  echo "::error::The API service gained pending work before exact drain capture."
  false
fi

api_stopped_before_drain="$(
  aws ecs list-tasks \
    --cluster "$ECS_CLUSTER" \
    --service-name "$API_SERVICE" \
    --desired-status STOPPED \
    --max-items 101 \
    --query taskArns \
    --output json
)"
if test "$(jq -r 'length' <<<"$api_stopped_before_drain")" -gt 100; then
  echo "::error::The post-suspension STOPPED task baseline exceeds the bounded 100-task drain audit."
  false
fi
api_stopped_before_details="$(describe_task_arns "$api_stopped_before_drain")"
if test "$(jq -r '.failures | length' <<<"$api_stopped_before_details")" != "0"; then
  echo "::error::Could not inspect service tasks already marked for stop before drain."
  false
fi
api_proven_stopped_before="$(
  jq -c \
    --arg boundary "$api_drain_boundary" \
    '[
      .tasks[] |
      select(
        .lastStatus == "STOPPED" and
        ((.stoppedAt // "")[0:19] < $boundary)
      ) |
      .taskArn
    ]' \
    <<<"$api_stopped_before_details"
)"
api_active_stopping_before="$(
  jq -c \
    --argjson proven "$api_proven_stopped_before" \
    '[.tasks[] | select(.taskArn as $arn | $proven | index($arn) | not) | .taskArn]' \
    <<<"$api_stopped_before_details"
)"
# ECS desiredStatus is only RUNNING or STOPPED. This RUNNING query also
# captures tasks whose lastStatus is still PENDING; the service-count
# comparison below detects a pending/replacement race after stabilization.
api_running_before="$(
  aws ecs list-tasks \
    --cluster "$ECS_CLUSTER" \
    --service-name "$API_SERVICE" \
    --desired-status RUNNING \
    --query taskArns \
    --output json
)"
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
aws ecs update-service \
  --cluster "$ECS_CLUSTER" \
  --service "$API_SERVICE" \
  --desired-count 0 \
  >/dev/null
aws ecs wait services-stable \
  --cluster "$ECS_CLUSTER" \
  --services "$API_SERVICE"
api_counts="$(
  aws ecs describe-services \
    --cluster "$ECS_CLUSTER" \
    --services "$API_SERVICE" \
    --query 'services[0].[desiredCount,runningCount,pendingCount]' \
    --output text
)"
test "$api_counts" = $'0\t0\t0' || {
  echo "::error::The old API service did not drain completely: ${api_counts}"
  false
}

api_stopped_after_drain=""
api_stopped_inventory_stable=0
api_stopped_inventory_attempt=0
for reconciliation_delay in 1 2 4 8 16 32 32 32; do
  sleep "$reconciliation_delay"
  api_stopped_inventory_attempt=$((api_stopped_inventory_attempt + 1))
  api_stopped_inventory="$(
    aws ecs list-tasks \
      --cluster "$ECS_CLUSTER" \
      --service-name "$API_SERVICE" \
      --desired-status STOPPED \
      --max-items 101 \
      --query taskArns \
      --output json |
      jq -c 'sort'
  )"
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
    test "$api_stopped_inventory_attempt" -ge 6 &&
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
  aws ecs wait tasks-stopped \
    --cluster "$ECS_CLUSTER" \
    --tasks "${api_drain_tasks[@]}"
  api_stopped_tasks="$(
    aws ecs describe-tasks \
      --cluster "$ECS_CLUSTER" \
      --tasks "${api_drain_tasks[@]}" \
      --output json
  )"
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
aws ecs update-service \
  --cluster "$ECS_CLUSTER" \
  --service "$API_SERVICE" \
  --deployment-configuration "$api_breaker_disabled_configuration" \
  >/dev/null
api_disabled_breaker="$(
  aws ecs describe-services \
    --cluster "$ECS_CLUSTER" \
    --services "$API_SERVICE" \
    --query 'services[0].deploymentConfiguration.deploymentCircuitBreaker.[enable,rollback]' \
    --output text
)"
if test "$api_disabled_breaker" != $'True\tFalse'; then
  echo "::error::Could not prove circuit-breaker rollback is disabled before migration startup."
  false
fi

aws ecs update-service \
  --cluster "$ECS_CLUSTER" \
  --service "$API_SERVICE" \
  --task-definition "$API_TASK_DEFINITION" \
  --desired-count 1 \
  >/dev/null
aws ecs wait services-stable \
  --cluster "$ECS_CLUSTER" \
  --services "$API_SERVICE"
api_service_state="$(
  aws ecs describe-services \
    --cluster "$ECS_CLUSTER" \
    --services "$API_SERVICE" \
    --output json
)"
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
if ! {
  test "$api_primary_count" = "1" &&
    test "$api_primary_task" = "$API_TASK_DEFINITION" &&
    test "$api_primary_rollout" = "COMPLETED"
}; then
  aws ecs update-service \
    --cluster "$ECS_CLUSTER" \
    --service "$API_SERVICE" \
    --desired-count 0 \
    >/dev/null
  aws ecs wait services-stable \
    --cluster "$ECS_CLUSTER" \
    --services "$API_SERVICE"
  echo "::error::The new API task did not remain the sole completed primary deployment; the service was stopped and scaling remains suspended."
  false
fi

aws ecs update-service \
  --cluster "$ECS_CLUSTER" \
  --service "$API_SERVICE" \
  --deployment-configuration "$api_iac_deployment_configuration" \
  >/dev/null
api_restored_configuration="$(
  aws ecs describe-services \
    --cluster "$ECS_CLUSTER" \
    --services "$API_SERVICE" \
    --output json
)"
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

aws application-autoscaling register-scalable-target \
  --service-namespace ecs \
  --resource-id "$api_scaling_resource" \
  --scalable-dimension ecs:service:DesiredCount \
  --suspended-state "$api_original_suspended_state" \
  >/dev/null
if test "$(current_scaling_suspension)" != "$api_original_suspended_state"; then
  echo "::error::The API scalable target did not restore its exact pre-drain suspension state."
  false
fi
api_rollout_complete=true
trap - ERR EXIT INT TERM
