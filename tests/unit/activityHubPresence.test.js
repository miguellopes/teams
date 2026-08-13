'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');

const reactHandlerPath = require.resolve('../../app/browser/tools/reactHandler');
require.cache[reactHandlerPath] = {
  id: reactHandlerPath,
  filename: reactHandlerPath,
  loaded: true,
  exports: {},
};
const activityHub = require('../../app/browser/tools/activityHub');

describe('ActivityHub setPresenceStatus', () => {
  const originalDocument = global.document;

  afterEach(() => {
    global.document = originalDocument;
  });

  it('selects Teams presence controls by their exact data-tid', async () => {
    let profileClicked = false;
    let presenceClicked = false;
    let optionClicked = false;

    global.document = {
      querySelector(selector) {
        if (selector.includes('me-control-avatar-trigger')) {
          return { click: () => { profileClicked = true; } };
        }
        if (selector.includes('me-control-presence"')) {
          return { click: () => { presenceClicked = true; } };
        }
        if (selector.split(', ').includes('[data-tid="presence-busy"]')) {
          return { click: () => { optionClicked = true; } };
        }
        return null;
      },
    };

    const result = await activityHub.setPresenceStatus('busy');

    assert.strictEqual(result, true);
    assert.strictEqual(profileClicked, true);
    assert.strictEqual(presenceClicked, true);
    assert.strictEqual(optionClicked, true);
  });
});
