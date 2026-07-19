import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const gameSource = readFileSync(new URL('../game-phaser.js', import.meta.url), 'utf8');

function assertSourceMatches(source, pattern, label) {
    assert.ok(pattern.test(source), label);
}

test('background music loads, plays, and cleans up properly', () => {
    assertSourceMatches(gameSource, /this\.load\.audio\('light_rain_sound',\s*'assets\/light_rain_sound\.mp3'\)/, 'should preload light rain sound');
    assertSourceMatches(gameSource, /this\.rainBgm\s*=\s*this\.sound\.add\('light_rain_sound',\s*\{\s*loop:\s*true,\s*volume:\s*0\.15\s*\}\)/, 'should add light rain sound with loop and subtle volume');
    assertSourceMatches(gameSource, /this\.rainBgm\.play\(\)/, 'should play light rain sound');
    
    // Check cleanup in showGameOver
    assertSourceMatches(gameSource, /showGameOver\(\)[\s\S]*this\.rainBgm\.stop\(\)[\s\S]*this\.rainBgm\.destroy\(\)/, 'should stop and destroy rainBgm in showGameOver');
    
    // Check cleanup on shutdown
    assertSourceMatches(gameSource, /'shutdown'[\s\S]*this\.rainBgm\.stop\(\)[\s\S]*this\.rainBgm\.destroy\(\)/, 'should stop and destroy rainBgm on shutdown');
});
