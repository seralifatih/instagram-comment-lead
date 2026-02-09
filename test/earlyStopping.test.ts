import {
  updateLeadValueStats,
  shouldStopEarly,
  resetGlobalStats,
  resetEarlyStopState,
  setTargetLeadCountForTests
} from '../src/main.js';

describe('smart early stopping logic', () => {
  beforeEach(() => {
    resetGlobalStats();
    resetEarlyStopState();
    setTargetLeadCountForTests(2);
  });

  test('triggers early stop when high intent leads reach target', () => {
    updateLeadValueStats({ is_lead: true, leadScore: 'HIGH', audience_qualification: { tier: 'LOW_VALUE_AUDIENCE' } });
    expect(shouldStopEarly()).toBe(false);

    updateLeadValueStats({ is_lead: true, leadScore: 'HIGH', audience_qualification: { tier: 'LOW_VALUE_AUDIENCE' } });
    expect(shouldStopEarly()).toBe(true);
  });
});
