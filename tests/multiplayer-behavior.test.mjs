import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const gameSource = readFileSync(new URL('../game-phaser.js', import.meta.url), 'utf8');

function loadGameApi() {
    const window = {
        addEventListener() {},
        innerWidth: 900,
        innerHeight: 700,
        supabase: null
    };
    const sandbox = {
        console: { log() {}, warn() {}, error() {} },
        window,
        navigator: {},
        document: {},
        setTimeout,
        clearTimeout,
        requestAnimationFrame() {},
        Phaser: {
            AUTO: 0,
            Scene: class {},
            Scale: { RESIZE: 0 }
        }
    };

    vm.runInNewContext(`${gameSource}
        globalThis.__gameTestApi = {
            generateRoomCode,
            GameScene,
            LobbyScene,
            applyRemoteLobbyIdentity:
                typeof applyRemoteLobbyIdentity === 'function' ? applyRemoteLobbyIdentity : null,
            createGameRestartState:
                typeof createGameRestartState === 'function' ? createGameRestartState : null,
            applyGameRestartState:
                typeof applyGameRestartState === 'function' ? applyGameRestartState : null,
            setNetworkState(next) {
                if ('gameMode' in next) gameMode = next.gameMode;
                if ('isHost' in next) isHost = next.isHost;
                if ('roomCode' in next) roomCode = next.roomCode;
                if ('playerId' in next) playerId = next.playerId;
                if ('remotePlayerId' in next) remotePlayerId = next.remotePlayerId;
                if ('trysteroRoom' in next) trysteroRoom = next.trysteroRoom;
            },
            getNetworkState() {
                return {
                    gameMode,
                    roomCode,
                    remotePlayerId,
                    remoteCharacter,
                    remotePlayerName:
                        typeof remotePlayerName === 'undefined' ? null : remotePlayerName
                };
            }
        };
    `, sandbox);

    return sandbox.__gameTestApi;
}

function makeSaveScene(api, newt, remoteY = 50) {
    return Object.assign(Object.create(api.GameScene.prototype), {
        teamScore: 0,
        saved: 0,
        topSafe: 100,
        botSafe: 400,
        remotePlayer: { y: remoteY, carried: newt ? [newt] : [] },
        newts: { getChildren: () => newt && newt.active ? [newt] : [] },
        cache: { audio: { exists: () => false } },
        createSuccessEffect() {},
        updateHUD() {}
    });
}

test('room codes use six easy-to-read characters', () => {
    const api = loadGameApi();

    for (let i = 0; i < 100; i++) {
        assert.match(api.generateRoomCode(), /^[A-HJ-NP-Z2-9]{6}$/);
    }
});

test('the host rejects a save for a newt that does not exist', () => {
    const api = loadGameApi();
    api.setNetworkState({ isHost: true, playerId: 'host', remotePlayerId: 'guest' });
    const scene = makeSaveScene(api, null);

    api.GameScene.prototype.handleNewtSave.call(scene, {
        playerId: 'guest',
        newtId: 'missing-newt',
        correct: true,
        x: 10,
        y: 10
    });

    assert.equal(scene.teamScore, 0);
    assert.equal(scene.saved, 0);
});

test('the host accepts one valid guest save', () => {
    const api = loadGameApi();
    api.setNetworkState({ isHost: true, playerId: 'host', remotePlayerId: 'guest' });
    const newt = {
        active: true,
        newtId: 'newt-1',
        isCarried: true,
        carriedBy: 'guest',
        dest: 'FOREST',
        destroy() { this.active = false; }
    };
    const scene = makeSaveScene(api, newt);
    const payload = {
        playerId: 'guest',
        newtId: 'newt-1',
        correct: true,
        x: 10,
        y: 10
    };

    api.GameScene.prototype.handleNewtSave.call(scene, payload);
    api.GameScene.prototype.handleNewtSave.call(scene, payload);

    assert.equal(scene.teamScore, 100);
    assert.equal(scene.saved, 1);
});

test('the host rejects a save outside the correct safe area', () => {
    const api = loadGameApi();
    api.setNetworkState({ isHost: true, playerId: 'host', remotePlayerId: 'guest' });
    const newt = {
        active: true,
        newtId: 'newt-1',
        isCarried: true,
        carriedBy: 'guest',
        dest: 'FOREST',
        destroy() { this.active = false; }
    };
    const scene = makeSaveScene(api, newt, 200);

    api.GameScene.prototype.handleNewtSave.call(scene, {
        playerId: 'guest',
        newtId: 'newt-1',
        correct: true,
        x: 10,
        y: 10
    });

    assert.equal(scene.teamScore, 0);
    assert.equal(scene.saved, 0);
});

test('the lobby handshake keeps the remote player name', () => {
    const api = loadGameApi();
    const applyIdentity = api.applyRemoteLobbyIdentity || (() => {});

    applyIdentity({
        guestId: 'guest-player',
        guestCharacter: 'female',
        guestName: 'Guest'
    }, 'guest-peer', 'guest');

    const state = api.getNetworkState();
    assert.equal(state.gameMode, 'single');
    assert.equal(state.roomCode, null);
    assert.equal(state.remotePlayerId, 'guest-player');
    assert.equal(state.remoteCharacter, 'female');
    assert.equal(state.remotePlayerName, 'Guest');
});

test('leaving the guest lobby closes its peer room', () => {
    const api = loadGameApi();
    let leaveCount = 0;
    api.setNetworkState({
        gameMode: 'multi',
        isHost: false,
        roomCode: 'ABC234',
        trysteroRoom: { leave: () => leaveCount++ }
    });

    api.LobbyScene.prototype.cleanup.call({
        inputEl: null,
        lobbyState: 'joining'
    });

    assert.equal(leaveCount, 1);
    assert.equal(api.getNetworkState().gameMode, 'single');
    assert.equal(api.getNetworkState().roomCode, null);
});

test('a scene restart restores progress and elapsed time', () => {
    const api = loadGameApi();
    const createState = api.createGameRestartState || (() => null);
    const applyState = api.applyGameRestartState || (() => {});
    const source = {
        score: 150,
        teamScore: 500,
        saved: 5,
        lost: 2,
        lives: 2,
        difficulty: 3,
        streak: 4,
        maxStreak: 7,
        achievements: { firstSave: true },
        runStartTime: 1_000,
        time: { now: 6_000 },
        scale: { width: 1_000, height: 500 },
        player: { x: 250, y: 200, scaleX: -1 },
        newts: {
            getChildren: () => [{
                newtId: 'newt-1',
                x: 400,
                y: 150,
                dest: 'FOREST',
                dir: -1,
                isCarried: true,
                carriedBy: 'host'
            }]
        },
        cars: {
            getChildren: () => [{
                carId: 'car-1',
                x: 600,
                y: 250,
                speed: 200,
                type: 'car',
                carColor: 0xff0000,
                dir: 1,
                lane: 2,
                w: 80,
                h: 40
            }]
        }
    };
    const target = { time: { now: 9_000 } };

    const state = createState(source);
    applyState(target, state);

    assert.equal(target.score, 150);
    assert.equal(target.teamScore, 500);
    assert.equal(target.saved, 5);
    assert.equal(target.lost, 2);
    assert.equal(target.lives, 2);
    assert.equal(target.difficulty, 3);
    assert.equal(target.streak, 4);
    assert.equal(target.maxStreak, 7);
    assert.equal(target.achievements.firstSave, true);
    assert.equal(target.runStartTime, 4_000);
    assert.equal(state.player?.xRatio, 0.25);
    assert.equal(state.player?.yRatio, 0.4);
    assert.equal(state.player?.scaleX, -1);
    assert.equal(state.newts?.[0]?.id, 'newt-1');
    assert.equal(state.newts?.[0]?.xRatio, 0.4);
    assert.equal(state.newts?.[0]?.isCarried, true);
    assert.equal(state.cars?.[0]?.id, 'car-1');
    assert.equal(state.cars?.[0]?.speedRatio, 0.2);
});
