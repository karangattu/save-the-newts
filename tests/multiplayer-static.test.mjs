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

test('multiplayer sync uses 60Hz peer transport with a Supabase-safe fallback', () => {
    assertSourceMatches(gameSource, /PLAYER_UPDATE_MS:\s*1000\s*\/\s*60/, 'peer player updates should run at 60Hz');
    assertSourceMatches(gameSource, /WORLD_UPDATE_MS:\s*1000\s*\/\s*20/, 'peer world snapshots should run at 20Hz');
    assertSourceMatches(gameSource, /SUPABASE_FALLBACK_PLAYER_UPDATE_MS:\s*125/, 'Supabase fallback player updates should stay capped at 8Hz');
    assertSourceMatches(gameSource, /SUPABASE_FALLBACK_WORLD_UPDATE_MS:\s*250/, 'Supabase fallback world snapshots should stay capped at 4Hz');
    assertSourceMatches(gameSource, /IDLE_HEARTBEAT_MS:\s*1500/, 'idle players should use a heartbeat instead of constant packets');
    assertSourceMatches(gameSource, /function quantizeRatio/, 'ratios should be quantized before broadcast');
    assertSourceMatches(gameSource, /shouldBroadcastPlayerState\(payload, force/, 'unchanged player states should be skipped');
    assertSourceMatches(gameSource, /setupGameDataChannel\(\)/, 'game sync should establish a WebRTC data channel');
    assertSourceMatches(gameSource, /createDataChannel\('game-sync'/, 'host should create a dedicated game-sync data channel');
    assertSourceMatches(gameSource, /sendMultiplayerMessage\(event, payload, options = \{\}\)/, 'volatile sync should route through a shared transport helper');
    assertSourceMatches(gameSource, /volatile && this\.isGameDataChannelReady\(\)/, 'volatile sync should prefer the peer data channel');

    const playerBroadcast = sourceBetween('    broadcastPlayerState', '    broadcastGameState');
    assertSourceDoesNotMatch(playerBroadcast, /broadcastGameState\(/, 'player packets should not trigger full world snapshots');
    assertSourceMatches(playerBroadcast, /sendMultiplayerMessage\('player_update', payload, \{ volatile: true \}\)/, 'player movement should use the volatile transport');

    assertSourceMatches(gameSource, /getWorldUpdateDelay\(\)[\s\S]*WORLD_UPDATE_MS/, 'world timer helper should choose the peer world rate');
    assertSourceMatches(gameSource, /gameStateBroadcastTimer[\s\S]*getWorldUpdateDelay\(\)/, 'host world snapshots should use their own lower-rate timer helper');
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