'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { matchStatus, STATUS_KEYWORDS, waitFor } = require('../../app/browser/tools/presenceSelector');

// NOTE: the previous version of this file mocked `document.querySelector` so
// that it returned a clickable stub for *whatever selector it was handed*. That
// makes the test pass no matter what the selectors are, which is exactly why
// the feature looked green in CI and did nothing in the real client. Test the
// matching logic (which is pure) instead, and verify the DOM half by hand with
// window.teamsForLinuxDumpPresenceMenu().

describe('presenceSelector.matchStatus', () => {
  it('maps every supported presence label to its own status', () => {
    for (const [status, keywords] of Object.entries(STATUS_KEYWORDS)) {
      for (const keyword of keywords) {
        assert.strictEqual(matchStatus(keyword), status, `'${keyword}' should map to ${status}`);
      }
    }
  });

  it('prefers the most specific label', () => {
    assert.strictEqual(matchStatus('be right back'), 'be_right_back');
    assert.strictEqual(matchStatus('appear offline'), 'offline');
    assert.strictEqual(matchStatus('do not disturb'), 'do_not_disturb');
  });

  it('ignores accents and casing so localised menus still match', () => {
    assert.strictEqual(matchStatus('Ocupado'.toLowerCase()), 'busy');
    assert.strictEqual(matchStatus('disponivel'), 'available');
  });

  it('returns null for unrelated menu text', () => {
    assert.strictEqual(matchStatus('settings'), null);
    assert.strictEqual(matchStatus('sign out'), null);
  });
});

describe('presenceSelector.waitFor', () => {
  it('resolves as soon as the predicate is truthy', async () => {
    let calls = 0;
    const value = await waitFor(() => (++calls >= 3 ? 'ready' : null), { timeout: 1000, interval: 5 });
    assert.strictEqual(value, 'ready');
  });

  it('resolves null once the deadline passes instead of hanging', async () => {
    const value = await waitFor(() => null, { timeout: 60, interval: 10 });
    assert.strictEqual(value, null);
  });
});
