import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const gameSource = readFileSync(new URL('../game-phaser.js', import.meta.url), 'utf8');

function assertSourceMatches(source, pattern, label) {
    assert.ok(pattern.test(source), label);
}

test('Alma Bridge Road facts dataset and interactive modal are properly defined', () => {
    // Verify facts dataset exists and contains key statistics
    assertSourceMatches(gameSource, /const ALMA_BRIDGE_FACTS = \[/, 'ALMA_BRIDGE_FACTS array should be defined');
    assertSourceMatches(gameSource, /36,000\+ Documented Casualties/, 'Should include 36,000+ casualties fact');
    assertSourceMatches(gameSource, /40% Crossing Mortality Rate/, 'Should include 40% mortality rate fact');
    assertSourceMatches(gameSource, /0\.05 MPH: The Slow Crawl/, 'Should include speed & crossing duration fact');
    assertSourceMatches(gameSource, /The Fallen Leaf Illusion/, 'Should include leaf illusion fact');
    assertSourceMatches(gameSource, /The Newt Passage Project/, 'Should include Newt Passage Project fact');
    assertSourceMatches(gameSource, /BioBlitz Club Newt Patrol/, 'Should cite BioBlitz Club Newt Patrol');

    // Verify modal helper and random picker functions exist
    assertSourceMatches(gameSource, /function getRandomNewtFact\(\)/, 'getRandomNewtFact helper should exist');
    assertSourceMatches(gameSource, /function showNewtFactModal\(scene,/, 'showNewtFactModal helper should exist');
    assertSourceMatches(gameSource, /Icons\.drawBulb\(/, 'drawBulb icon method should exist');

    // Verify GameScene game over integration
    assertSourceMatches(gameSource, /showNewtFactModal\(this\)/, 'showNewtFactModal should be called from GameScene');
    assertSourceMatches(gameSource, /DID YOU KNOW\?/, 'Game over screen should display Did You Know fact card');

    // Verify SplashScene and ModeSelectScene fact button triggers
    assertSourceMatches(gameSource, /SplashScene[\s\S]*showNewtFactModal\(this\)/, 'SplashScene should have fact modal trigger');
    assertSourceMatches(gameSource, /ModeSelectScene[\s\S]*showNewtFactModal\(this\)/, 'ModeSelectScene should have fact modal trigger');
});
