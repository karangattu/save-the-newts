import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const gameSource = readFileSync(new URL('../game-phaser.js', import.meta.url), 'utf8');

function assertSourceMatches(source, pattern, label) {
    assert.ok(pattern.test(source), label);
}

test('automatic fullscreen is implemented correctly', () => {
    // Check if pointerdown listener requests fullscreen in landscape mode
    assertSourceMatches(
        gameSource,
        /window\.addEventListener\('pointerdown'[\s\S]*window\.innerWidth\s*>\s*window\.innerHeight[\s\S]*requestFullscreen\(/,
        'should register pointerdown listener that requests fullscreen in landscape mode'
    );

    // Check if resize listener exits fullscreen when rotating back to portrait mode
    assertSourceMatches(
        gameSource,
        /window\.addEventListener\('resize'[\s\S]*window\.innerWidth\s*<\s*window\.innerHeight[\s\S]*exitFullscreen\(/,
        'should register resize listener that exits fullscreen when rotating to portrait mode'
    );
});
