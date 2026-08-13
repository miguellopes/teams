'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const HomeAssistantDiscovery = require('../../app/mqtt/homeAssistantDiscovery');

describe('Home Assistant status select discovery', () => {
	it('publishes a select that sends validated set-status commands', async () => {
		const published = [];
		const mqttClient = new EventEmitter();
		mqttClient.isConnected = false;
		mqttClient.publish = async (topic, config) => published.push({topic, config});
		const discovery = new HomeAssistantDiscovery(mqttClient, {
			mqtt: {
				clientId: 'test-client', topicPrefix: 'teams', statusTopic: 'status',
				commandTopic: 'command', homeAssistant: {}, mediaTopics: {},
			}
		});

		await discovery.publishDiscovery();
		const select = published.find(({topic}) => topic.endsWith('/select/test-client/set_status/config'));
		assert.ok(select);
		assert.deepStrictEqual(select.config.options, [
			'available', 'busy', 'do_not_disturb', 'away', 'be_right_back', 'offline'
		]);
		assert.strictEqual(select.config.command_topic, 'teams/command');
		assert.match(select.config.command_template, /set-status/);
	});
});
