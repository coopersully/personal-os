"""Offline acceptance decisions. Evidence references must be inspected by the owner."""
import argparse
import hashlib
import json
import re
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
POLICY_FILES = ('acceptance-policy.json', 'acceptance-contract.md', 'code-standards.md', 'code-placement.md')
POLICY = json.loads((ROOT / 'docs/engineering/acceptance-policy.json').read_text())
POLICY_DIGEST = hashlib.sha256(b'\0'.join(
    (ROOT / 'docs/engineering' / name).read_bytes() for name in POLICY_FILES)).hexdigest()


def mapping(value):
    return value if isinstance(value, dict) else {}


def strings(value):
    return isinstance(value, list) and bool(value) and all(
        isinstance(item, str) and item.strip() for item in value)


def sha(value):
    return isinstance(value, str) and re.fullmatch(r'[0-9a-f]{40}', value) is not None


def exception_valid(row, implementers):
    exception = mapping(row.get('exception'))
    if row.get('id') in POLICY['nonExceptionStandards'] or row.get('result') != 'fail':
        return False
    if any(not isinstance(exception.get(k), str) or not exception[k].strip() for k in
           ('id', 'approvedBy', 'owner', 'issue', 'exitCondition')):
        return False
    if exception['approvedBy'] in implementers:
        return False
    if not all(strings(exception.get(k)) for k in
               ('authorityEvidence', 'scopeEvidence', 'containmentEvidence')):
        return False
    try:
        return date.fromisoformat(exception.get('expiresOn', '')) >= date.today()
    except (TypeError, ValueError):
        return False


def production_criterion_ids(plan, pr):
    """Validate either reviewed schema and return IDs without changing the plan."""
    criteria = plan.get('criteria')
    if (type(plan.get('required')) is not bool or not isinstance(plan.get('owner'), str)
            or not plan['owner'].strip() or not isinstance(criteria, list)):
        return None
    if all(isinstance(c, str) and c.strip() for c in criteria):
        if not strings(plan.get('evidence')) or len(criteria) != len(set(criteria)):
            return None
        return criteria
    if (plan['required'] is not True or not criteria
            or not all(isinstance(c, dict) for c in criteria)
            or not strings(plan.get('premerge_evidence'))
            or not all(sha(pr.get(k)) and plan.get(field) == pr[k]
                       for field, k in (('candidateHead', 'headSha'), ('candidateBase', 'baseSha')))):
        return None
    for row in criteria:
        if (any(not isinstance(row.get(k), str) or not row[k].strip() for k in ('id', 'action'))
                or row.get('result') not in ('planned', 'pending_post_merge')):
            return None
        if 'evidence' in row:
            evidence = row['evidence']
            if not ((isinstance(evidence, str) and evidence.strip()) or strings(evidence)):
                return None
    ids = [row['id'] for row in criteria]
    return ids if len(ids) == len(set(ids)) else None


def review_problems(state):
    state = mapping(state)
    pr = mapping(state.get('pr'))
    record = mapping(state.get('acceptance'))
    errors = []
    if (record.get('policyRevision') != POLICY['revision']
            or record.get('policyDigest') != POLICY_DIGEST):
        errors.append('Acceptance policy revision is missing or stale')
    if not all(sha(pr.get(k)) and record.get(k) == pr[k] for k in ('headSha', 'baseSha')):
        errors.append('Acceptance is not bound to the current head and base')
    implementers = record.get('implementers')
    reviewers = record.get('reviewers')
    if (not strings(implementers) or not strings(reviewers)
            or set(implementers or []) & set(reviewers or [])):
        errors.append('Independent reviewer and implementer identities are required')
    rows = record.get('standards')
    if not isinstance(rows, list) or not all(isinstance(r, dict) for r in rows):
        return errors + ['Standard coverage is missing or malformed']
    ids = [r.get('id') for r in rows]
    if (not all(isinstance(i, str) for i in ids) or len(ids) != len(set(ids))
            or set(ids) != set(POLICY['standards'])):
        errors.append('Every standard requires exactly one disposition')
    for row in rows:
        if not strings(row.get('evidence')) or not isinstance(row.get('rationale'), str) or not row['rationale'].strip():
            errors.append(f"Missing evidence or applicability rationale: {row.get('id')}")
        status = row.get('result')
        if status not in ('pass', 'not_applicable') and not exception_valid(row, implementers if strings(implementers) else []):
            errors.append(f"Unaccepted standard: {row.get('id')}")
        if row.get('exception') is not None and status != 'fail':
            errors.append('An exception must retain the underlying failed conformance result')
    plan = mapping(record.get('productionPlan'))
    if not plan or state.get('reviewedProductionPlan') != plan:
        errors.append('Production plan differs from the independently retained review snapshot')
    criteria = production_criterion_ids(plan, pr)
    if criteria is None:
        errors.append('Reviewed production plan is missing or malformed')
    elif plan['required'] and not criteria:
        errors.append('Runtime changes need explicit production acceptance criteria')
    elif not plan['required'] and (criteria or not isinstance(plan.get('reason'), str) or not plan['reason'].strip()):
        errors.append('Non-deployment scope needs a reason and no runtime criteria')
    return errors


def evaluate_delivery(state):
    state = mapping(state)
    errors = review_problems(state)
    if errors:
        return {'decision': 'BLOCK', 'reasons': errors}
    pr = state['pr']
    merge = mapping(state.get('mergeReceipt'))
    if pr.get('state') != 'MERGED':
        return {'decision': 'WAIT', 'reasons': ['Merge has not been verified']}
    if (merge.get('sourceHeadSha') != pr['headSha'] or not sha(merge.get('mergeSha'))
            or not strings(merge.get('evidence'))):
        return {'decision': 'BLOCK', 'reasons': ['Audited source head and merge receipt are required']}
    plan = state['acceptance']['productionPlan']
    if plan['required']:
        production = mapping(state.get('production'))
        if not production:
            return {'decision': 'WAIT', 'reasons': ['Production evidence is pending']}
        criteria = production.get('criteria')
        if isinstance(criteria, list) and any(
                isinstance(row, dict) and row.get('deployedSha') == production.get('deployedSha')
                and row.get('status') not in ('SUCCESS', 'PENDING') for row in criteria):
            return {'decision': 'BLOCK', 'reasons': ['Current production criterion failed or is unknown']}
        candidate_present = (sha(production.get('deployedSha'))
                             and production.get('containsMerge') is True
                             and production.get('changePresent') is True)
        if (not candidate_present and production.get('deployment') == 'PENDING'
                and production.get('health') in ('SUCCESS', 'PENDING')):
            return {'decision': 'WAIT', 'reasons': ['Deployment is active; the prior revision may still be serving']}
        if (not sha(production.get('deployedSha')) or production.get('containsMerge') is not True
                or production.get('changePresent') is not True or not strings(production.get('evidence'))):
            return {'decision': 'BLOCK', 'reasons': ['Deployed revision and retained change are unverified']}
        statuses = [production.get('deployment'), production.get('health')]
        rows = production.get('criteria')
        if not isinstance(rows, list) or not all(isinstance(r, dict) for r in rows):
            return {'decision': 'BLOCK', 'reasons': ['Production criteria evidence is missing']}
        ids = [r.get('id') for r in rows]
        if (not all(isinstance(i, str) for i in ids) or len(ids) != len(set(ids)) or set(ids) != set(production_criterion_ids(plan, pr))
                or any(r.get('deployedSha') != production['deployedSha'] or not strings(r.get('evidence')) for r in rows)):
            return {'decision': 'BLOCK', 'reasons': ['Production coverage does not match the reviewed plan/revision']}
        statuses.extend(r.get('status') for r in rows)
        if any(s not in ('SUCCESS', 'PENDING') for s in statuses):
            return {'decision': 'BLOCK', 'reasons': ['Production acceptance failed or is unknown']}
        if 'PENDING' in statuses:
            return {'decision': 'WAIT', 'reasons': ['Deployment or observation is still pending']}
    reconciliation = mapping(state.get('reconciliation'))
    if reconciliation.get('complete') is not True or not strings(reconciliation.get('evidence')):
        return {'decision': 'WAIT', 'reasons': ['Tracker/ownership reconciliation is pending']}
    return {'decision': 'SHIPPED' if plan['required'] else 'COMPLETE_NO_DEPLOY', 'reasons': []}


def main():
    parser = argparse.ArgumentParser(description='Evaluate production delivery offline; never collect or mutate')
    parser.add_argument('--state', required=True)
    parser.add_argument('--output')
    args = parser.parse_args()
    try:
        state = json.loads(Path(args.state).read_text())
        result = evaluate_delivery(state)
    except (OSError, ValueError, TypeError) as error:
        result = {'decision': 'BLOCK', 'reasons': [f'Invalid delivery input: {type(error).__name__}']}
    serialized = json.dumps(result, indent=2) + '\n'
    if args.output:
        Path(args.output).write_text(serialized)
    else:
        print(serialized, end='')


if __name__ == '__main__':
    main()
