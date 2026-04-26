import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const gameSource = readFileSync(new URL('../game-phaser.js', import.meta.url), 'utf8');
const sqlSource = readFileSync(new URL('../supabase_setup.sql', import.meta.url), 'utf8');

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

test('multiplayer sync is tuned for Supabase Realtime free-tier limits', () => {
    assertSourceMatches(gameSource, /PLAYER_UPDATE_MS:\s*125/, 'player updates should be capped at 8Hz');
    assertSourceMatches(gameSource, /WORLD_UPDATE_MS:\s*250/, 'world snapshots should be capped at 4Hz');
    assertSourceMatches(gameSource, /IDLE_HEARTBEAT_MS:\s*1500/, 'idle players should use a heartbeat instead of constant packets');
    assertSourceMatches(gameSource, /function quantizeRatio/, 'ratios should be quantized before broadcast');
    assertSourceMatches(gameSource, /shouldBroadcastPlayerState\(payload, force/, 'unchanged player states should be skipped');

    const playerBroadcast = sourceBetween('    broadcastPlayerState', '    broadcastGameState');
    assertSourceDoesNotMatch(playerBroadcast, /broadcastGameState\(/, 'player packets should not trigger full world snapshots');

    assertSourceMatches(gameSource, /gameStateBroadcastTimer[\s\S]*WORLD_UPDATE_MS/, 'host world snapshots should use their own lower-rate timer');
});

test('multiplayer avoids avoidable realtime events and lobby races', () => {
    assertSourceDoesNotMatch(gameSource, /Start voice chat\s*\n\s*this\.setupVoiceChat\(\)/, 'voice chat should not auto-start and spend signaling messages');
    assertSourceMatches(gameSource, /toggleMute\(\)[\s\S]*this\.setupVoiceChat\(\)/, 'mic button should opt into voice setup');
    assertSourceMatches(gameSource, /\.update\(\{[\s\S]*guest_id: guestId[\s\S]*status: 'playing'[\s\S]*\}\)[\s\S]*\.eq\('id', room\.id\)[\s\S]*\.eq\('status', 'waiting'\)[\s\S]*\.is\('guest_id', null\)/, 'join update should remain conditional to avoid double joins');
});

test('database setup supports cheap leaderboard and room lookups', () => {
    assertSourceMatches(sqlSource, /idx_leaderboard_score_desc/, 'leaderboard top-score query should be indexed');
    assertSourceMatches(sqlSource, /idx_game_rooms_cleanup/, 'room cleanup query should be indexed');
});