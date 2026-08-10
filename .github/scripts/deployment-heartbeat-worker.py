#!/usr/bin/env python3

import ctypes
import os
from pathlib import Path
import signal
import subprocess
import sys
import time


def require_argument(index: int) -> str:
    try:
        value = sys.argv[index]
    except IndexError as error:
        raise SystemExit("Deployment heartbeat worker configuration is incomplete.") from error
    if not value:
        raise SystemExit("Deployment heartbeat worker configuration is incomplete.")
    return value


region = require_argument(1)
interval_seconds = float(require_argument(2))
retry_seconds = float(require_argument(3))
ready_file = Path(require_argument(4))
failure_file = Path(require_argument(5))
deployment_parent_pid = os.getppid()
active_child: subprocess.Popen[bytes] | None = None


def stop_worker(_signal_number: int, _frame: object) -> None:
    if active_child is not None and active_child.poll() is None:
        active_child.terminate()
        try:
            active_child.wait(timeout=2)
        except subprocess.TimeoutExpired:
            active_child.kill()
    raise SystemExit(0)


signal.signal(signal.SIGINT, stop_worker)
signal.signal(signal.SIGTERM, stop_worker)

if sys.platform.startswith("linux"):
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(1, signal.SIGTERM) != 0:
        failure_file.write_text("Could not bind the heartbeat worker to its parent.\n")
        raise SystemExit(1)
    if os.getppid() != deployment_parent_pid:
        raise SystemExit(0)

command = [
    "aws",
    "cloudwatch",
    "put-metric-data",
    "--namespace",
    "ilo/Deployments",
    "--metric-data",
    "MetricName=ApiDeploymentInProgress,Value=1,Unit=Count",
    "--region",
    region,
    "--cli-connect-timeout",
    "5",
    "--cli-read-timeout",
    "10",
]

while True:
    if os.getppid() != deployment_parent_pid:
        raise SystemExit(0)
    refreshed = False
    for attempt in range(3):
        child_environment = {
            **os.environ,
            "AWS_MAX_ATTEMPTS": "3",
            "ILO_DEPLOYMENT_HEARTBEAT_WORKER": "true",
        }
        active_child = subprocess.Popen(
            command,
            env=child_environment,
            stderr=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
        )
        refreshed = active_child.wait() == 0
        active_child = None
        if refreshed:
            break
        if attempt < 2:
            time.sleep(retry_seconds)
    if not refreshed:
        failure_file.write_text("The API deployment heartbeat failed after three attempts.\n")
        raise SystemExit(1)
    ready_file.write_text("ready\n")
    time.sleep(interval_seconds)
