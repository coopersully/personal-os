import copy
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
            'mergeReceipt': {'sourceHeadSha': HEAD, 'mergeSha': MERGE, 'evidence': ['merge.json']},
            'production': {'deployedSha': MERGE, 'containsMerge': True,
                           'changePresent': True, 'deployment': 'SUCCESS', 'health': 'SUCCESS',
                           'evidence': ['controller.json', 'health.json'],
                           'criteria': [{'id': 'task-create', 'status': 'SUCCESS',
                                         'deployedSha': MERGE, 'evidence': ['smoke.json']}]},
            'reconciliation': {'complete': True, 'evidence': ['linear.json']}}


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
