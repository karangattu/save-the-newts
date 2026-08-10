import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const gameSource = readFileSync(new URL('../game-phaser.js', import.meta.url), 'utf8');
const sqlSource = readFileSync(new URL('../supabase_setup.sql', import.meta.url), 'utf8');
const htmlSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function sourceBetween(startToken, endToken) {
    const start = gameSource.indexOf(startToken);
    const end = gameSource.indexOf(endToken, start + startToken.length);
    assert.notEqual(start, -1, `Missing ${startToken}`);
    assert.notEqual(end, -1, `Missing ${endToken}`);
    return gameSource.slice(start, end);
}

function assertSourceMatches(source, pattern, label) {
    assert.ok(pattern.test(source), label);
}

function assertSourceDoesNotMatch(source, pattern, label) {
    assert.ok(!pattern.test(source), label);
}

test('multiplayer sync uses 60Hz peer player updates and 20Hz world snapshots via Trystero WebRTC', () => {
    assertSourceMatches(gameSource, /PLAYER_UPDATE_MS:\s*1000\s*\/\s*60/, 'peer player updates should run at 60Hz');
    assertSourceMatches(gameSource, /WORLD_UPDATE_MS:\s*1000\s*\/\s*20/, 'peer world snapshots should run at 20Hz');
    assertSourceMatches(gameSource, /IDLE_HEARTBEAT_MS:\s*1500/, 'idle players should use a heartbeat instead of constant packets');
    assertSourceMatches(gameSource, /function quantizeRatio/, 'ratios should be quantized before broadcast');
    assertSourceMatches(gameSource, /shouldBroadcastPlayerState\(payload, force/, 'unchanged player states should be skipped');
    assertSourceMatches(gameSource, /getTrystero\(\)/, 'multiplayer should retrieve Trystero instance');
    assertSourceMatches(gameSource, /initTrysteroRoom\(code\)/, 'multiplayer should initialize Trystero room');
    assertSourceMatches(gameSource, /initTrysteroActions\(room\)/, 'multiplayer should declare Trystero action channels');
    assertSourceMatches(gameSource, /sendMultiplayerMessage\(event, payload, options = \{\}\)/, 'sync should route through shared action sender');

    const playerBroadcast = sourceBetween('    broadcastPlayerState', '    broadcastGameState');
    assertSourceDoesNotMatch(playerBroadcast, /broadcastGameState\(/, 'player packets should not trigger full world snapshots');
    assertSourceMatches(playerBroadcast, /sendMultiplayerMessage\('player_update', payload, \{ volatile: true \}\)/, 'player movement should use volatile action');

    assertSourceMatches(gameSource, /getWorldUpdateDelay\(\)[\s\S]*WORLD_UPDATE_MS/, 'world timer helper should choose peer world rate');
    assertSourceMatches(gameSource, /gameStateBroadcastTimer[\s\S]*getWorldUpdateDelay\(\)/, 'host world snapshots should use their own timer helper');
    assertSourceDoesNotMatch(gameSource, /multiplayerChannel/, 'game sync should not depend on Supabase realtime channels');
});

test('voice chat uses Trystero media streams and activates only on user interaction', () => {
    assertSourceDoesNotMatch(gameSource, /Start voice chat\s*\n\s*this\.setupVoiceChat\(\)/, 'voice chat should not auto-start');
    assertSourceMatches(gameSource, /toggleMute\(\)[\s\S]*this\.setupVoiceChat\(\)/, 'mic button should opt into voice setup');
    assertSourceMatches(gameSource, /trysteroRoom\.addStream\(localStream\)/, 'local microphone stream should be added to Trystero room');
    assertSourceMatches(gameSource, /'onPeerStream'/, 'remote audio stream should be handled via onPeerStream');
    assertSourceMatches(gameSource, /cleanupVoiceChat\(\)/, 'voice chat cleanup function should exist');
});

test('multiplayer lobby and room lifecycle are serverless P2P', () => {
    assertSourceMatches(htmlSource, /trystero\/nostr/, 'index.html should include Trystero nostr module');
    assertSourceMatches(gameSource, /createRoom\(hostCharacter\)/, 'createRoom should create a P2P room with code');
    assertSourceMatches(gameSource, /joinRoom\(code, guestCharacter\)/, 'joinRoom should connect to existing P2P room code');
    assertSourceMatches(gameSource, /cleanupMultiplayerState\(\)/, 'cleanupMultiplayerState should teardown room and state');
});

test('database setup keeps leaderboard reads cheap', () => {
    assertSourceMatches(sqlSource, /idx_leaderboard_score_desc/, 'leaderboard top-score query should be indexed');
});
