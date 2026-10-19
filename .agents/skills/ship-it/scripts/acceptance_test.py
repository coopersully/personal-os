import copy
import json
import re
from pathlib import Path
import unittest
from acceptance import review_problems, evaluate_delivery, POLICY, POLICY_DIGEST

HEAD = 'a' * 40
BASE = 'b' * 40
MERGE = 'c' * 40


def acceptance_record():
    return {
        'policyRevision': POLICY['revision'], 'policyDigest': POLICY_DIGEST, 'headSha': HEAD, 'baseSha': BASE,
        'implementers': ['worker'], 'reviewers': ['reviewer'],
        'standards': [{'id': key, 'result': 'pass', 'rationale': 'Inspected affected behavior',
                       'evidence': ['review.json#' + key]} for key in POLICY['standards']],
        'productionPlan': {'required': True, 'owner': 'delivery-owner',
                           'criteria': ['task-create'], 'evidence': ['plan.json']},
    }


def delivery_state():
    return {'pr': {'state': 'MERGED', 'headSha': HEAD, 'baseSha': BASE},
            'acceptance': acceptance_record(),
            'reviewedProductionPlan': copy.deepcopy(acceptance_record()['productionPlan']),
            'mergeReceipt': {'sourceHeadSha': HEAD, 'mergeSha': MERGE, 'evidence': ['merge.json']},
            'production': {'deployedSha': MERGE, 'containsMerge': True,
                           'changePresent': True, 'deployment': 'SUCCESS', 'health': 'SUCCESS',
                           'evidence': ['controller.json', 'health.json'],
                           'criteria': [{'id': 'task-create', 'status': 'SUCCESS',
                                         'deployedSha': MERGE, 'evidence': ['smoke.json']}]},
            'reconciliation': {'complete': True, 'evidence': ['linear.json']}}


# Exact parsed independently reviewed frozen plan; no private files are needed by tests.
FROZEN_DETAILED_PLAN = json.loads(r'''
{
  "required": true,
  "owner": "local:01a14fe1-cca0-7d41-94ca-453ed406b227 /root delivery Lead; implementation owner remains available through postmerge acceptance",
  "candidateHead": "705a8acc3ec8be75770d353d956022ed3049bcfa",
  "candidateBase": "3569b167c02a97967cc4844316ba732343917df2",
  "reason": "Shared DatabaseClient.close lifecycle changes runtime; app.test-only split is not a runtime Finance feature.",
  "criteria": [
    {
      "id": "provenance",
      "action": "After protectedmerge verify actual merge/descendant contains accepted canonical database source and has not reverted it; record exact main push CI and controller deployed revision",
      "evidence": "Existing read-only deploy-status checker plus actual git blob comparison",
      "result": "pending_post_merge"
    },
    {
      "id": "health",
      "action": "Use existing public app, API readiness and MCP liveness checks tied to controller revision; healthy endpoint alone is insufficient provenance",
      "result": "pending_post_merge"
    },
    {
      "id": "shutdown_observation",
      "action": "Observe existing controller normal deployment/shutdown logs for graceful close completion, no new pg57P01/unhandled rejection or shutdown deadline failure. Do not stop production PostgreSQL, force restart or invent a drill. If no ordinary shutdown occurred record pending observation explicitly.",
      "result": "pending_post_merge"
    },
    {
      "id": "recovery",
      "action": "If existing deployment/controller reports blocked/retrying/unhealthy or shutdown errors, retain delivery ownership and report exact blocker; use current controller runbook recovery and obtain authority before disruptive action",
      "result": "planned"
    }
  ],
  "premerge_evidence": [
    "app254-final-worker-handoff.json",
    "app254-combined-review.json",
    "source39181502337 all10SUCCESS including real PostgreSQL fixtures"
  ],
  "review": "Independent final reviewer assessing exactplan; artifact to follow",
  "completion_boundary": "COO-123 remains InProgress until Lead distribution acceptance; no claimregistry modification or ownership closure onmerge; PR256 close only after combinedmerge+acceptance verified"
}
''')

def detailed_state():
    state = delivery_state()
    plan = copy.deepcopy(FROZEN_DETAILED_PLAN)
    state['pr'].update(headSha=plan['candidateHead'], baseSha=plan['candidateBase'])
    state['acceptance'].update(headSha=plan['candidateHead'], baseSha=plan['candidateBase'], productionPlan=plan)
    state['reviewedProductionPlan'] = copy.deepcopy(plan)
    state['mergeReceipt']['sourceHeadSha'] = plan['candidateHead']
    state['production']['criteria'] = [dict(id=row['id'], status='SUCCESS', deployedSha=MERGE, evidence=['observation.json']) for row in plan['criteria']]
    return state


class AcceptanceTest(unittest.TestCase):
    def test_policy_inventory_matches_normative_documents(self):
        root = Path(__file__).resolve().parents[4]
        standards = (root / 'docs/engineering/code-standards.md').read_text()
        ids = re.findall(r'^\| (CS-\d+)\b', standards, re.M)
        self.assertEqual(ids, POLICY['standards'])
        for name in ('code-standards.md', 'acceptance-contract.md'):
            self.assertIn(f"Policy revision: {POLICY['revision']}",
                          (root / 'docs/engineering' / name).read_text())


    def test_review_requires_complete_current_independent_coverage(self):
        state = delivery_state()
        self.assertEqual(review_problems(state), [])
        for mutation in [lambda a: a.update(baseSha='d' * 40),
                         lambda a: a.update(policyRevision=0),
                         lambda a: a.update(reviewers=['worker']),
                         lambda a: a['standards'].pop(),
                         lambda a: a['standards'].append(copy.deepcopy(a['standards'][0])),
                         lambda a: a['standards'][0].update(evidence=[]),
                         lambda a: a['standards'][0].update(result='incomplete')]:
            bad = copy.deepcopy(state)
            mutation(bad['acceptance'])
            self.assertTrue(review_problems(bad))

    def test_deployment_pending_on_prior_revision_waits_without_claiming_shipped(self):
        state = delivery_state()
        state['production'].update(deployedSha=BASE, containsMerge=False,
                                   changePresent=False, deployment='PENDING')
        self.assertEqual(evaluate_delivery(state)['decision'], 'WAIT')
        state['production']['health'] = 'FAILURE'
        self.assertEqual(evaluate_delivery(state)['decision'], 'BLOCK')

    def test_pending_deployment_does_not_hide_current_criterion_failure(self):
        state = delivery_state()
        state['production']['deployment'] = 'PENDING'
        state['production']['criteria'][0]['status'] = 'FAILURE'
        self.assertEqual(evaluate_delivery(state)['decision'], 'BLOCK')

    def test_delivery_cannot_rewrite_the_reviewed_production_plan(self):
        state = delivery_state()
        state['acceptance']['productionPlan'] = {'required': False, 'owner': 'owner',
            'criteria': [], 'reason': 'Changed after merge', 'evidence': ['new-plan.json']}
        self.assertEqual(evaluate_delivery(state)['decision'], 'BLOCK')
        state = delivery_state()
        state['acceptance']['productionPlan']['criteria'] = ['different-check']
        self.assertTrue(review_problems(state))

    def test_merge_is_not_production_completion(self):
        state = delivery_state()
        self.assertEqual(evaluate_delivery(state)['decision'], 'SHIPPED')
        del state['production']
        self.assertEqual(evaluate_delivery(state)['decision'], 'WAIT')

    def test_production_requires_exact_revision_criteria_and_reconciliation(self):
        for mutation in [lambda s: s['production'].update(containsMerge=False),
                         lambda s: s['production'].update(changePresent=False),
                         lambda s: s['production'].update(health='FAILURE'),
                         lambda s: s['production'].update(criteria=[]),
                         lambda s: s['production']['criteria'][0].update(deployedSha=BASE),
                         lambda s: s['mergeReceipt'].update(sourceHeadSha=BASE),
                         lambda s: s['reconciliation'].update(complete=False)]:
            state = delivery_state()
            mutation(state)
            self.assertNotEqual(evaluate_delivery(state)['decision'], 'SHIPPED')

    def test_documentation_only_requires_reviewed_non_applicability(self):
        state = delivery_state()
        state['acceptance']['productionPlan'] = {'required': False, 'owner': 'owner',
            'criteria': [], 'reason': 'Documentation only', 'evidence': ['scope.json']}
        state['reviewedProductionPlan'] = copy.deepcopy(state['acceptance']['productionPlan'])
        del state['production']
        self.assertEqual(evaluate_delivery(state)['decision'], 'COMPLETE_NO_DEPLOY')
        del state['acceptance']['productionPlan']['reason']
        self.assertEqual(evaluate_delivery(state)['decision'], 'BLOCK')

    def test_malformed_records_fail_closed(self):
        for value in [None, [], 'pass', True]:
            state = delivery_state()
            state['acceptance'] = value
            self.assertTrue(review_problems(state))
            self.assertEqual(evaluate_delivery(state)['decision'], 'BLOCK')

    def test_exception_cannot_hide_incomplete_evidence_or_waive_invariant(self):
        state = delivery_state()
        row = state['acceptance']['standards'][0]
        row.update(result='fail', exception={'id': 'EX-1', 'approvedBy': 'human',
            'authorityEvidence': ['approval.json'], 'scopeEvidence': ['scope.json'],
            'containmentEvidence': ['checks.json'], 'owner': 'owner', 'issue': 'issue-url',
            'expiresOn': '2999-01-01', 'exitCondition': 'Remove duplication'})
        self.assertEqual(review_problems(state), [])
        row['exception']['approvedBy'] = 'worker'
        self.assertTrue(review_problems(state))
        row['exception']['approvedBy'] = 'human'
        row['exception']['expiresOn'] = '2000-01-01'
        self.assertTrue(review_problems(state))
        row['exception']['expiresOn'] = '2999-01-01'
        row['result'] = 'incomplete'
        self.assertTrue(review_problems(state))
        row['result'] = 'fail'
        protected = next(r for r in state['acceptance']['standards'] if r['id'] == 'CS-05')
        protected.update(result='fail', exception=row['exception'])
        self.assertTrue(review_problems(state))


class DetailedPlanTest(unittest.TestCase):
    def test_exact_frozen_plan_is_accepted_without_mutation_and_still_needs_delivery(self):
        state = detailed_state()
        before = copy.deepcopy(state)
        self.assertEqual(review_problems(state), [])
        self.assertEqual(evaluate_delivery(state)['decision'], 'SHIPPED')
        self.assertEqual(state, before)
        del state['production']
        self.assertEqual(evaluate_delivery(state)['decision'], 'WAIT')
        state['pr']['state'] = 'OPEN'
        self.assertEqual(evaluate_delivery(state)['decision'], 'WAIT')

    def test_detailed_schema_fails_closed(self):
        mutations = [lambda p: p.pop('premerge_evidence'),
            lambda p: p.update(premerge_evidence=[]), lambda p: p.update(premerge_evidence=[' ']),
            lambda p: p.update(premerge_evidence='receipt'), lambda p: p.update(owner=' '),
            lambda p: p.pop('candidateHead'), lambda p: p.pop('candidateBase'),
            lambda p: p.update(required=1), lambda p: p.update(criteria=None),
            lambda p: p.update(candidateHead=BASE), lambda p: p.update(candidateBase=HEAD),
            lambda p: p.update(required=False), lambda p: p.update(criteria=[]),
            lambda p: p['criteria'].append('mixed'),
            lambda p: p['criteria'].append(copy.deepcopy(p['criteria'][0])),
            lambda p: p['criteria'][0].update(id=' '), lambda p: p['criteria'][0].update(id=[]),
            lambda p: p['criteria'][0].update(action=' '),
            lambda p: p['criteria'][0].update(result='SUCCESS'),
            lambda p: p['criteria'][0].pop('action'), lambda p: p['criteria'][0].pop('result')]
        for invalid in [None, '', ' ', [], [' '], [None], True, {}]:
            mutations.append(lambda p, invalid=invalid: p['criteria'][0].update(evidence=invalid))
        for mutate in mutations:
            state = detailed_state()
            mutate(state['acceptance']['productionPlan'])
            state['reviewedProductionPlan'] = copy.deepcopy(state['acceptance']['productionPlan'])
            with self.subTest(plan=state['reviewedProductionPlan']):
                self.assertEqual(evaluate_delivery(state)['decision'], 'BLOCK')

    def test_optional_criterion_evidence_accepts_only_explicit_references(self):
        for evidence in ['receipt.json', ['receipt.json']]:
            state = detailed_state()
            state['acceptance']['productionPlan']['criteria'][0]['evidence'] = evidence
            state['reviewedProductionPlan'] = copy.deepcopy(state['acceptance']['productionPlan'])
            self.assertEqual(review_problems(state), [])

    def test_any_snapshot_drift_blocks(self):
        for mutate in [lambda p: p.update(owner='other'), lambda p: p['criteria'].pop(),
            lambda p: p['criteria'][2].update(action='Force restart production'),
            lambda p: p.update(completion_boundary='Close ownership on merge'),
            lambda p: p.update(premerge_evidence=['different'])]:
            state = detailed_state()
            mutate(state['acceptance']['productionPlan'])
            self.assertEqual(evaluate_delivery(state)['decision'], 'BLOCK')

    def test_exact_production_coverage_and_revision_remain_required(self):
        mutations = [lambda s: s['production']['criteria'].pop(),
            lambda s: s['production']['criteria'].append(dict(s['production']['criteria'][0], id='extra')),
            lambda s: s['production']['criteria'].append(copy.deepcopy(s['production']['criteria'][0])),
            lambda s: s['production']['criteria'][0].update(deployedSha=BASE),
            lambda s: s['production']['criteria'][0].update(evidence=[]),
            lambda s: s['production']['criteria'][0].update(status='UNKNOWN')]
        for mutate in mutations:
            state = detailed_state()
            mutate(state)
            self.assertEqual(evaluate_delivery(state)['decision'], 'BLOCK')
        state = detailed_state()
        state['production']['criteria'][0]['status'] = 'PENDING'
        self.assertEqual(evaluate_delivery(state)['decision'], 'WAIT')
        state['production'].update(deployment='PENDING')
        state['production']['criteria'][0]['status'] = 'FAILURE'
        self.assertEqual(evaluate_delivery(state)['decision'], 'BLOCK')
        state['production'].update(deployedSha=BASE, containsMerge=False, changePresent=False)
        self.assertEqual(evaluate_delivery(state)['decision'], 'WAIT')
