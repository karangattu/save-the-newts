import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const gameSource = readFileSync(new URL('../game-phaser.js', import.meta.url), 'utf8');

function assertSourceMatches(source, pattern, label) {
    assert.ok(pattern.test(source), label);
}

function assertSourceDoesNotMatch(source, pattern, label) {
    assert.ok(!pattern.test(source), label);
}

test('fullscreen is opt-in via a toggle, not automatic', () => {
    assertSourceDoesNotMatch(
        gameSource,
        /window\.addEventListener\('pointerdown'[\s\S]*requestFullscreen\(/,
        'should not request fullscreen automatically on pointerdown'
    );
    assertSourceMatches(
        gameSource,
        /function toggleFullscreen\(/,
        'should expose a fullscreen toggle the player can choose'
    );
    assertSourceMatches(
        gameSource,
        /id\s*=\s*'fullscreen-toggle'|id:\s*'fullscreen-toggle'|id="fullscreen-toggle"/,
        'should render a visible fullscreen control'
    );
    assertSourceMatches(
        gameSource,
        /window\.addEventListener\('resize'[\s\S]*window\.innerWidth\s*<\s*window\.innerHeight[\s\S]*exitFullscreen\(/,
        'should still exit fullscreen when rotating to portrait'
    );
});
