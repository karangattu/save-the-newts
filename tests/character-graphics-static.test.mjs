import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const gameSource = readFileSync(new URL('../game-phaser.js', import.meta.url), 'utf8');

function assertSourceMatches(source, pattern, label) {
    assert.ok(pattern.test(source), label);
}

test('character graphics and expression logic are implemented correctly', () => {
    // Check if the global draw functions exist
    assertSourceMatches(gameSource, /function drawMalePlayerGlobal\(/, 'drawMalePlayerGlobal helper should exist');
    assertSourceMatches(gameSource, /function drawFemalePlayerGlobal\(/, 'drawFemalePlayerGlobal helper should exist');

    // Check if GameScene has updatePlayerExpression method
    assertSourceMatches(gameSource, /updatePlayerExpression\(playerObj,\s*characterType/, 'updatePlayerExpression method should exist');

    // Check if updatePlayerExpression is called in updatePlayer
    assertSourceMatches(gameSource, /this\.updatePlayerExpression\(this\.player,\s*selectedCharacter/, 'should update local player expression in updatePlayer');
    assertSourceMatches(gameSource, /this\.updatePlayerExpression\(this\.remotePlayer,\s*remoteCharacter/, 'should update remote player expression in updatePlayer');

    // Check if CharacterSelectScene delegates to the global draw functions
    assertSourceMatches(gameSource, /drawMaleCharacter\([\s\S]*drawMalePlayerGlobal\(/, 'drawMaleCharacter should call drawMalePlayerGlobal');
    assertSourceMatches(gameSource, /drawFemaleCharacter\([\s\S]*drawFemalePlayerGlobal\(/, 'drawFemaleCharacter should call drawFemalePlayerGlobal');

    // Check if updateSelection updates facial expressions dynamically
    assertSourceMatches(
        gameSource,
        /updateSelection\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]*maleGraphics\.clear\(\);[\s\S]*femaleGraphics\.clear\(\);/m,
        'updateSelection should clear and redraw both character graphics objects'
    );
    assertSourceMatches(
        gameSource,
        /this\.drawMaleCharacter\(maleGraphics,\s*selected\s*===\s*'male'\s*\?\s*'smiley'\s*:\s*'frowny'\)/,
        'updateSelection should draw male character with smiley/frowny depending on selection'
    );
    assertSourceMatches(
        gameSource,
        /this\.drawFemaleCharacter\(femaleGraphics,\s*selected\s*===\s*'female'\s*\?\s*'smiley'\s*:\s*'frowny'\)/,
        'updateSelection should draw female character with smiley/frowny depending on selection'
    );
});
