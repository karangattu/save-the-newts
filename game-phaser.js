/* ===================================
   SAVE THE NEWTS
   Alma Bridge Road - Help Newts Cross!
   =================================== */

// ===== SUPABASE CONFIG =====
const supabaseUrl = window.SUPABASE_URL;
const supabaseKey = window.SUPABASE_ANON_KEY;
let supabaseClient = null;

if (supabaseUrl && supabaseKey && window.supabase) {
    supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);
    console.log("Supabase initialized for leaderboard");
} else {
    console.log("Supabase not configured. Leaderboard disabled.");
}

async function submitScore(name, score, isMultiplayer = false) {
    if (!supabaseClient) return false;
    try {
        const { error } = await supabaseClient
            .from('leaderboard')
            .insert([{ player_name: name, score: score, is_multiplayer: isMultiplayer }]);
        if (error) {
            console.error("Error submitting score:", error);
            return false;
        }
        return true;
    } catch (e) {
        console.error("Exception submitting score:", e);
        return false;
    }
}

async function getLeaderboard() {
    if (!supabaseClient) return [];
    try {
        const { data, error } = await supabaseClient
            .from('leaderboard')
            .select('player_name, score, is_multiplayer')
            .order('score', { ascending: false })
            .limit(5);
        if (error) return [];
        return data || [];
    } catch (e) {
        return [];
    }
}

// ===== SELECTED CHARACTER =====
let selectedCharacter = 'male'; // 'male' or 'female'

// ===== PLAYER NAME (collected before gameplay) =====
let playerName = '';

// ===== MULTIPLAYER STATE =====
let gameMode = 'single';
let isHost = false;
let roomCode = null;
let roomId = null;
let playerId = null;
let remotePlayerId = null;
let remoteCharacter = null;
let remotePlayerName = '';
let lastRemoteUpdate = 0;

let trysteroRoom = null;
let trysteroActions = null;

// Host world-snapshot sequence counters live outside the scene so a scene
// restart (e.g. window resize) can't reset them and desync the guest's
// out-of-order guard.
let gameStateSeq = 0;
let lastReceivedSeq = -1;

// ===== VOICE CHAT STATE =====
let localStream = null;
let remoteAudioEl = null;
let voiceChatActive = false;
let isMuted = false;

function generatePlayerId() {
    return 'player_' + Math.random().toString(36).substring(2, 15);
}

function generateRoomCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return code;
}

function applyRemoteLobbyIdentity(payload, peerId, role) {
    const isHostIdentity = role === 'host';
    remotePlayerId = payload[isHostIdentity ? 'hostId' : 'guestId'] || peerId;
    remoteCharacter = payload[isHostIdentity ? 'hostCharacter' : 'guestCharacter'] ||
        (isHostIdentity ? 'male' : 'female');
    remotePlayerName = payload[isHostIdentity ? 'hostName' : 'guestName'] || '';
}

function createGameRestartState(scene, width = scene.scale.width, height = scene.scale.height) {
    return {
        score: scene.score,
        teamScore: scene.teamScore,
        saved: scene.saved,
        lost: scene.lost,
        lives: scene.lives,
        difficulty: scene.difficulty,
        streak: scene.streak,
        maxStreak: scene.maxStreak,
        achievements: { ...scene.achievements },
        elapsedMs: Math.max(0, scene.time.now - scene.runStartTime),
        player: {
            xRatio: scene.player.x / width,
            yRatio: scene.player.y / height,
            scaleX: scene.player.scaleX
        },
        newts: scene.newts.getChildren().map(newt => ({
            id: newt.newtId,
            xRatio: newt.x / width,
            yRatio: newt.y / height,
            dest: newt.dest,
            dir: newt.dir,
            isCarried: newt.isCarried,
            carriedBy: newt.carriedBy || null
        })),
        cars: scene.cars.getChildren().map(car => ({
            id: car.carId,
            xRatio: car.x / width,
            yRatio: car.y / height,
            speedRatio: car.speed / width,
            type: car.type,
            color: car.carColor,
            dir: car.dir,
            lane: car.lane,
            w: car.w,
            h: car.h
        }))
    };
}

function applyGameRestartState(scene, state) {
    if (!state) return;
    scene.score = state.score;
    scene.teamScore = state.teamScore;
    scene.saved = state.saved;
    scene.lost = state.lost;
    scene.lives = state.lives;
    scene.difficulty = state.difficulty;
    scene.streak = state.streak;
    scene.maxStreak = state.maxStreak;
    scene.achievements = { ...state.achievements };
    scene.runStartTime = scene.time.now - state.elapsedMs;
}

async function getTrystero() {
    if (window.Trystero && typeof window.Trystero.joinRoom === 'function') {
        return window.Trystero;
    }
    try {
        const mod = await import('https://esm.sh/trystero@0.25.3/nostr');
        window.Trystero = mod;
        return mod;
    } catch (e) {
        try {
            const modTorrent = await import('https://esm.sh/trystero@0.25.3/torrent');
            window.Trystero = modTorrent;
            return modTorrent;
        } catch (err) {
            console.error('Trystero import failed:', err);
            return null;
        }
    }
}

function setRoomListener(room, eventName, handler) {
    if (!room) return;
    // Trystero >=0.22 exposes these as accessor properties (assignment replaces the
    // handler). Never *call* an accessor that currently holds a function — that would
    // invoke the previous handler with the new one as its argument.
    const desc = Object.getOwnPropertyDescriptor(room, eventName);
    if (desc && (desc.get || desc.set)) {
        room[eventName] = handler;
        return;
    }
    if (typeof room[eventName] === 'function') {
        try {
            room[eventName](handler);
            return;
        } catch (e) {}
    }
    room[eventName] = handler;
}

function createActionHandler(room, name) {
    if (!room || typeof room.makeAction !== 'function') {
        return {
            send: () => {},
            on: () => {}
        };
    }
    try {
        const act = room.makeAction(name);
        if (Array.isArray(act)) {
            const [sendFn, onFn] = act;
            return {
                send: (payload, target) => {
                    try {
                        if (typeof sendFn === 'function') sendFn(payload, target);
                    } catch (e) {
                        console.warn(`Action send failed for ${name}:`, e);
                    }
                },
                on: (callback) => {
                    if (typeof onFn === 'function') {
                        onFn((payload, peer) => {
                            const peerId = typeof peer === 'string' ? peer : (peer && peer.peerId ? peer.peerId : peer);
                            callback(payload, peerId);
                        });
                    }
                }
            };
        }
        if (act && typeof act === 'object') {
            const sendFn = typeof act.send === 'function' ? act.send.bind(act) : () => {};
            return {
                send: (payload, target) => {
                    try {
                        if (target) {
                            sendFn(payload, { target });
                        } else {
                            sendFn(payload);
                        }
                    } catch (e) {
                        console.warn(`Action send failed for ${name}:`, e);
                    }
                },
                on: (callback) => {
                    const handler = (payload, peer) => {
                        const peerId = typeof peer === 'string' ? peer : (peer && peer.peerId ? peer.peerId : peer);
                        callback(payload, peerId);
                    };
                    if (typeof act.on === 'function') {
                        act.on(handler);
                    } else {
                        act.onMessage = handler;
                    }
                }
            };
        }
    } catch (err) {
        console.error(`Failed to create action for ${name}:`, err);
    }
    return {
        send: () => {},
        on: () => {}
    };
}

function initTrysteroActions(room) {
    if (!room) return null;
    const playerUpdateAct = createActionHandler(room, 'player_update');
    const gameStateAct = createActionHandler(room, 'game_state');
    const newtPickupAct = createActionHandler(room, 'newt_pickup');
    const newtSaveAct = createActionHandler(room, 'newt_save');
    const playerDisconnectAct = createActionHandler(room, 'player_disconnect');
    const gameOverAct = createActionHandler(room, 'game_over');
    const playerNameAct = createActionHandler(room, 'player_name');
    const playerHitIntentAct = createActionHandler(room, 'player_hit_intent');
    const playerHitAct = createActionHandler(room, 'player_hit');
    const lobbyHandshakeAct = createActionHandler(room, 'lobby_handshake');

    trysteroActions = {
        sendPlayerUpdate: (payload, target) => playerUpdateAct.send(payload, target),
        onPlayerUpdate: (cb) => playerUpdateAct.on(cb),
        sendGameState: (payload, target) => gameStateAct.send(payload, target),
        onGameState: (cb) => gameStateAct.on(cb),
        sendNewtPickup: (payload, target) => newtPickupAct.send(payload, target),
        onNewtPickup: (cb) => newtPickupAct.on(cb),
        sendNewtSave: (payload, target) => newtSaveAct.send(payload, target),
        onNewtSave: (cb) => newtSaveAct.on(cb),
        sendPlayerDisconnect: (payload, target) => playerDisconnectAct.send(payload, target),
        onPlayerDisconnect: (cb) => playerDisconnectAct.on(cb),
        sendGameOver: (payload, target) => gameOverAct.send(payload, target),
        onGameOver: (cb) => gameOverAct.on(cb),
        sendPlayerName: (payload, target) => playerNameAct.send(payload, target),
        onPlayerName: (cb) => playerNameAct.on(cb),
        sendPlayerHitIntent: (payload, target) => playerHitIntentAct.send(payload, target),
        onPlayerHitIntent: (cb) => playerHitIntentAct.on(cb),
        sendPlayerHit: (payload, target) => playerHitAct.send(payload, target),
        onPlayerHit: (cb) => playerHitAct.on(cb),
        sendLobbyHandshake: (payload, target) => lobbyHandshakeAct.send(payload, target),
        onLobbyHandshake: (cb) => lobbyHandshakeAct.on(cb)
    };
    return trysteroActions;
}

async function initTrysteroRoom(code) {
    const trystero = await getTrystero();
    if (!trystero || typeof trystero.joinRoom !== 'function') {
        console.error('Trystero library unavailable');
        return null;
    }

    cleanupTrysteroRoom();

    const config = { appId: 'save-the-newts' };
    const room = trystero.joinRoom(config, 'stn-' + code);
    trysteroRoom = room;
    initTrysteroActions(room);
    return room;
}

async function createRoom(hostCharacter) {
    const hostId = generatePlayerId();
    const code = generateRoomCode();
    
    playerId = hostId;
    roomCode = code;
    roomId = code;
    isHost = true;

    const room = await initTrysteroRoom(code);
    if (!room) return null;

    return {
        id: code,
        room_code: code,
        host_id: hostId,
        host_character: hostCharacter,
        status: 'waiting'
    };
}

async function joinRoom(code, guestCharacter) {
    const guestId = generatePlayerId();
    playerId = guestId;
    roomCode = code;
    roomId = code;
    isHost = false;

    const room = await initTrysteroRoom(code);
    if (!room) return null;

    return {
        id: code,
        room_code: code,
        guest_id: guestId,
        guest_character: guestCharacter,
        status: 'playing'
    };
}

function cleanupVoiceChat() {
    if (trysteroRoom && localStream) {
        try {
            trysteroRoom.removeStream(localStream);
        } catch (e) {}
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    if (remoteAudioEl) {
        remoteAudioEl.srcObject = null;
        remoteAudioEl.remove();
        remoteAudioEl = null;
    }
    voiceChatActive = false;
    isMuted = false;
}

function cleanupTrysteroRoom() {
    cleanupVoiceChat();
    if (trysteroRoom) {
        try {
            trysteroRoom.leave();
        } catch (e) {}
        trysteroRoom = null;
    }
    trysteroActions = null;
}

function cleanupMultiplayerState() {
    cleanupTrysteroRoom();
    gameMode = 'single';
    isHost = false;
    roomCode = null;
    roomId = null;
    playerId = null;
    remotePlayerId = null;
    remoteCharacter = null;
    remotePlayerName = '';
    lastRemoteUpdate = 0;
    gameStateSeq = 0;
    lastReceivedSeq = -1;
}


// ===== REAL-TIME ALMA BRIDGE ROAD FACTS & CONSERVATION DATA =====
const ALMA_BRIDGE_FACTS = [
    {
        title: "36,000+ Documented Casualties",
        category: "Massive Roadkill Scale",
        fact: "Since 2017, BioBlitz Club Newt Patrol volunteers have recorded over 36,000 dead newts along a 4.2-mile stretch of Alma Bridge Road near Lexington Reservoir.",
        stat: "36,000+ lost since 2017",
        source: "BioBlitz Club Newt Patrol"
    },
    {
        title: "40% Crossing Mortality Rate",
        category: "High Risk Corridor",
        fact: "A scientific study found nearly 14,000 adult California newts attempted to cross Alma Bridge Road in a single season, with roughly 40% crushed by vehicles before reaching breeding waters.",
        stat: "~40% mortality without rescue",
        source: "Midpeninsula Regional Open Space District"
    },
    {
        title: "0.05 MPH: The Slow Crawl",
        category: "Biology & Speed",
        fact: "Pacific newts crawl at only 0.03 to 0.1 mph. It takes a newt 20 to 45 minutes to cross a 2-lane road, leaving them exposed to oncoming traffic for dangerously long periods.",
        stat: "20-45 mins to cross 2 lanes",
        source: "Amphibian Research Studies"
    },
    {
        title: "The Fallen Leaf Illusion",
        category: "Driver Awareness",
        fact: "Drivers often unknowingly run over newts because wet, dark-orange newts look identical to fallen autumn sycamore and oak leaves glistening in wet tire tracks.",
        stat: "Indistinguishable from wet leaves",
        source: "Newt Patrol Field Observations"
    },
    {
        title: "Potent Poison, Zero Armor",
        category: "Predator Defense vs. Cars",
        fact: "California newts produce powerful tetrodotoxin (TTX) that deters predators like birds and raccoons, but their toxin provides zero defense against 4,000-pound vehicles.",
        stat: "TTX protects against predators, not tires",
        source: "California Department of Fish and Wildlife"
    },
    {
        title: "The Newt Passage Project",
        category: "Conservation Solutions",
        fact: "Thanks to volunteer data, Midpeninsula Open Space and Santa Clara County are actively designing wildlife tunnels, elevated road spans, and directional fencing to save the population.",
        stat: "Wildlife underpasses in planning",
        source: "Alma Bridge Road Newt Passage Project"
    },
    {
        title: "First Rain Triggers Migration",
        category: "Seasonal Breeding",
        fact: "Pacific newts spend the dry summer underground in oak forests and begin their perilous trek to Lexington Reservoir upon the first heavy winter rains between November and March.",
        stat: "Winter rainy night migration",
        source: "Santa Clara County Parks"
    },
    {
        title: "Buckets & Flashlights in the Rain",
        category: "Community Science",
        fact: "Dedicated volunteers walk Alma Bridge Road in the dead of night through pouring rain, using headlamps and buckets to safely carry newts across and log real-time scientific data.",
        stat: "100+ volunteer nights per season",
        source: "bioblitz.club/newts"
    }
];

let lastFactIndex = -1;
function getRandomNewtFact() {
    let index;
    if (ALMA_BRIDGE_FACTS.length <= 1) return ALMA_BRIDGE_FACTS[0];
    do {
        index = Math.floor(Math.random() * ALMA_BRIDGE_FACTS.length);
    } while (index === lastFactIndex);
    lastFactIndex = index;
    return ALMA_BRIDGE_FACTS[index];
}

function showNewtFactModal(scene, customFactIndex = null, onClose = null) {
    if (scene._factModalContainer) {
        scene._factModalContainer.destroy();
        scene._factModalContainer = null;
    }

    const { width, height } = scene.scale;
    const isCompact = isCompactViewport(width, height);
    const isMobile = width < 500;

    let factIndex = (typeof customFactIndex === 'number' && customFactIndex >= 0 && customFactIndex < ALMA_BRIDGE_FACTS.length)
        ? customFactIndex
        : Math.floor(Math.random() * ALMA_BRIDGE_FACTS.length);

    const container = scene.add.container(0, 0).setDepth(600);
    scene._factModalContainer = container;

    // Dark dim background backdrop
    const backdrop = scene.add.rectangle(0, 0, width, height, 0x000000, 0.88)
        .setOrigin(0)
        .setInteractive(); // Blocks input underneath
    container.add(backdrop);

    const modalWidth = Math.min(width * 0.90, isMobile ? 320 : (isCompact ? 380 : 450));
    const modalHeight = isMobile ? 370 : (isCompact ? 390 : 420);
    const modalX = width / 2;
    const modalY = height / 2;

    const modalBg = scene.add.graphics();
    container.add(modalBg);

    const modalElements = [];
    function renderFactContent(idx) {
        // Clear previous dynamic elements
        modalElements.forEach(el => el.destroy());
        modalElements.length = 0;

        const currentFact = ALMA_BRIDGE_FACTS[idx];

        // Draw modal background
        modalBg.clear();
        modalBg.fillStyle(0x071b26, 0.98);
        modalBg.fillRoundedRect(modalX - modalWidth / 2, modalY - modalHeight / 2, modalWidth, modalHeight, 14);
        modalBg.lineStyle(3, 0x00ff88, 1);
        modalBg.strokeRoundedRect(modalX - modalWidth / 2, modalY - modalHeight / 2, modalWidth, modalHeight, 14);

        // Header icon & badge
        const headerIcon = scene.add.graphics();
        Icons.drawBulb(headerIcon, modalX - (isMobile ? 85 : 105), modalY - modalHeight / 2 + (isMobile ? 24 : 28), isMobile ? 18 : 22, 0xffcc00);
        modalElements.push(headerIcon);

        const headerTitle = scene.add.text(modalX + (isMobile ? 10 : 12), modalY - modalHeight / 2 + (isMobile ? 24 : 28), 'ALMA BRIDGE FACTS', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: isMobile ? '16px' : (isCompact ? '18px' : '21px'),
            color: '#ffcc00',
            fontStyle: 'bold'
        }).setOrigin(0.5);
        modalElements.push(headerTitle);

        // Category Tag Pill
        const tagText = scene.add.text(modalX + (isMobile ? 7 : 9), modalY - modalHeight / 2 + (isMobile ? 54 : 60), currentFact.category.toUpperCase(), {
            fontFamily: 'Outfit, sans-serif',
            fontSize: isMobile ? '10px' : '11px',
            color: '#00ffff',
            backgroundColor: 'rgba(0, 255, 255, 0.12)',
            padding: { left: 18, right: 8, top: 3, bottom: 3 }
        }).setOrigin(0.5);
        modalElements.push(tagText);

        const tagIcon = scene.add.graphics();
        Icons.drawPin(tagIcon, tagText.x - tagText.width / 2 + (isMobile ? 7 : 8), tagText.y, isMobile ? 12 : 14, 0x00ffff);
        modalElements.push(tagIcon);

        // Fact Title
        const titleText = scene.add.text(modalX, modalY - modalHeight / 2 + (isMobile ? 88 : 96), currentFact.title, {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: isMobile ? '16px' : (isCompact ? '18px' : '20px'),
            color: '#ffffff',
            align: 'center',
            wordWrap: { width: modalWidth - (isMobile ? 36 : 48) }
        }).setOrigin(0.5);
        modalElements.push(titleText);

        // Stat highlight card
        const statCardY = modalY - modalHeight / 2 + (isMobile ? 134 : 146);
        const statCardH = isMobile ? 32 : 36;
        const statCard = scene.add.graphics();
        statCard.fillStyle(0x0a2d33, 0.8);
        statCard.fillRoundedRect(modalX - (modalWidth - 40) / 2, statCardY - statCardH / 2, modalWidth - 40, statCardH, 8);
        statCard.lineStyle(1.5, 0x00ccff, 0.7);
        statCard.strokeRoundedRect(modalX - (modalWidth - 40) / 2, statCardY - statCardH / 2, modalWidth - 40, statCardH, 8);
        modalElements.push(statCard);

        const statText = scene.add.text(modalX + 8, statCardY, currentFact.stat, {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: isMobile ? '12px' : '13px',
            color: '#00ff88',
            align: 'center'
        }).setOrigin(0.5);
        modalElements.push(statText);

        const statIcon = scene.add.graphics();
        Icons.drawBolt(statIcon, statText.x - statText.width / 2 - 10, statCardY, isMobile ? 14 : 16, 0x00ff88);
        modalElements.push(statIcon);

        // Detailed Fact Narrative
        const narrativeY = modalY - modalHeight / 2 + (isMobile ? 210 : 225);
        const narrativeText = scene.add.text(modalX, narrativeY, currentFact.fact, {
            fontFamily: 'Outfit, sans-serif',
            fontSize: isMobile ? '12px' : (isCompact ? '13px' : '14px'),
            color: '#ddf5ee',
            align: 'center',
            lineSpacing: isMobile ? 3 : 5,
            wordWrap: { width: modalWidth - (isMobile ? 36 : 44) }
        }).setOrigin(0.5);
        modalElements.push(narrativeText);

        // Source Attribution Link
        const sourceY = modalY + modalHeight / 2 - (isMobile ? 76 : 82);
        const sourceText = scene.add.text(modalX, sourceY, `Source: ${currentFact.source}`, {
            fontFamily: 'Outfit, sans-serif',
            fontSize: isMobile ? '10px' : '11px',
            color: '#88bb99',
            fontStyle: 'italic'
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });
        sourceText.on('pointerdown', () => window.open('https://bioblitz.club/newts', '_blank'));
        modalElements.push(sourceText);

        // Action Buttons: "Next Fact ❯" and "Close"
        const btnY = modalY + modalHeight / 2 - (isMobile ? 32 : 36);
        const btnWidth = isMobile ? 105 : 125;
        const btnHeight = isMobile ? 36 : 40;
        const btnGap = isMobile ? 55 : 68;

        // Next Fact Button
        const nextBg = scene.add.rectangle(modalX - btnGap, btnY, btnWidth, btnHeight, 0x113a22, 0.95)
            .setStrokeStyle(2, 0x00ff88, 1)
            .setInteractive({ useHandCursor: true });
        modalElements.push(nextBg);

        const nextText = scene.add.text(modalX - btnGap, btnY, 'NEXT FACT ❯', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: isMobile ? '12px' : '13px',
            color: '#00ff88'
        }).setOrigin(0.5);
        modalElements.push(nextText);

        nextBg.on('pointerover', () => nextBg.setFillStyle(0x195230, 1));
        nextBg.on('pointerout', () => nextBg.setFillStyle(0x113a22, 0.95));
        nextBg.on('pointerdown', () => {
            factIndex = (factIndex + 1) % ALMA_BRIDGE_FACTS.length;
            renderFactContent(factIndex);
        });

        // Close Button
        const closeBg = scene.add.rectangle(modalX + btnGap, btnY, btnWidth, btnHeight, 0x222222, 0.95)
            .setStrokeStyle(2, 0x888888, 1)
            .setInteractive({ useHandCursor: true });
        modalElements.push(closeBg);

        const closeText = scene.add.text(modalX + btnGap, btnY, 'GOT IT! ✕', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: isMobile ? '12px' : '13px',
            color: '#ffffff'
        }).setOrigin(0.5);
        modalElements.push(closeText);

        const closeModal = () => {
            modalElements.forEach(el => el.destroy());
            container.destroy();
            scene._factModalContainer = null;
            if (typeof onClose === 'function') onClose();
        };

        closeBg.on('pointerover', () => closeBg.setFillStyle(0x333333, 1));
        closeBg.on('pointerout', () => closeBg.setFillStyle(0x222222, 0.95));
        closeBg.on('pointerdown', closeModal);

        // Corner Close X
        const cornerX = scene.add.text(modalX + modalWidth / 2 - 18, modalY - modalHeight / 2 + 18, '✕', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: '16px',
            color: '#888888'
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });
        cornerX.on('pointerdown', closeModal);
        cornerX.on('pointerover', () => cornerX.setColor('#ffffff'));
        cornerX.on('pointerout', () => cornerX.setColor('#888888'));
        modalElements.push(cornerX);
    }

    renderFactContent(factIndex);
    return container;
}


// Character-specific stats
const CHARACTER_STATS = {
    male: {
        speedMultiplier: 1.2,  // 20% faster
        carryCapacity: 1,
        description: 'FAST but carries 1 newt'
    },
    female: {
        speedMultiplier: 0.85, // 15% slower
        carryCapacity: 2,
        description: 'STEADY and carries 2 newts'
    }
};

// ===== ICON UTILITY (Lucide Style) =====
const Icons = {
    drawHeart(g, x, y, size = 20, color = 0xff3366, stroke = 2) {
        const s = size / 2;
        // Draw heart using two circles and a triangle
        g.fillStyle(color);
        g.fillCircle(x - s * 0.3, y - s * 0.1, s * 0.45);
        g.fillCircle(x + s * 0.3, y - s * 0.1, s * 0.45);
        g.fillTriangle(x - s * 0.7, y, x + s * 0.7, y, x, y + s * 0.8);
    },
    drawMapPin(g, x, y, size = 20, color = 0xffffff, stroke = 2) {
        g.lineStyle(stroke, color);
        const s = size / 2;
        g.beginPath();
        g.arc(x, y - s * 0.3, s * 0.7, Math.PI * 0.8, Math.PI * 0.2, true);
        g.lineTo(x, y + s);
        g.closePath();
        g.strokePath();
        g.strokeCircle(x, y - s * 0.3, s * 0.25);
    },
    drawTrophy(g, x, y, size = 24, color = 0xffcc00, stroke = 2) {
        g.lineStyle(stroke, color);
        const s = size / 2;
        // Cup
        g.beginPath();
        g.moveTo(x - s * 0.6, y - s);
        g.lineTo(x + s * 0.6, y - s);
        g.lineTo(x + s * 0.5, y);
        g.arc(x, y, s * 0.5, 0, Math.PI, false);
        g.lineTo(x - s * 0.5, y);
        g.closePath();
        g.strokePath();
        // Base
        g.lineBetween(x, y + s * 0.5, x, y + s * 0.8);
        g.lineBetween(x - s * 0.4, y + s * 0.8, x + s * 0.4, y + s * 0.8);
        // Handles
        g.beginPath();
        g.arc(x - s * 0.6, y - s * 0.4, s * 0.3, Math.PI * 0.5, Math.PI * 1.5, false);
        g.strokePath();
        g.beginPath();
        g.arc(x + s * 0.6, y - s * 0.4, s * 0.3, Math.PI * 1.5, Math.PI * 0.5, false);
        g.strokePath();
    },
    drawSend(g, x, y, size = 20, color = 0x00ff00, stroke = 2) {
        g.lineStyle(stroke, color);
        const s = size / 2;
        g.beginPath();
        g.moveTo(x + s, y - s);
        g.lineTo(x - s * 0.8, y - s * 0.2);
        g.lineTo(x - s * 0.2, y + s * 0.2);
        g.closePath();
        g.strokePath();
        g.lineBetween(x + s, y - s, x - s * 0.2, y + s * 0.2);
    },
    drawRefresh(g, x, y, size = 20, color = 0x00ffff, stroke = 2) {
        g.lineStyle(stroke, color);
        const s = size / 2;
        // Draw 300 degree arc starting from top-right
        g.beginPath();
        g.arc(x, y, s, Math.PI * 1.5, Math.PI * 1.0, false); // Clockwise from 12 o'clock to 9 o'clock (gap at top-left) Nope, arc(x, y, radius, start, end)
        // Let's do standard CW refresh: Start at 60deg, go to 330deg
        // 0 is 3 o'clock.
        // Start: -0.8 rad (~45 deg up-right?)
        // End: 4.0 rad? 
        // Let's stick to easy math.
        // Start: 0.5 rad (bottom right). End: 5.5 rad (top right).
        g.arc(x, y, s * 0.9, 0.8, 5.8, false);
        g.strokePath();

        // Arrow head at the end (5.8 rads)
        const endX = x + Math.cos(5.8) * s * 0.9;
        const endY = y + Math.sin(5.8) * s * 0.9;
        // Direction vector is tangent. Tangent of circle at angle theta is theta + 90deg?
        // Arrow pointing CW.
        // Simple manual offset
        g.beginPath();
        g.moveTo(endX + 4, endY + 1);
        g.lineTo(endX, endY);
        g.lineTo(endX + 1, endY + 6);
        g.strokePath();
    },
    drawExternalLink(g, x, y, size = 18, color = 0x00ff88, stroke = 2) {
        g.lineStyle(stroke, color);
        const s = size / 2;

        // Box with gap at top-right
        g.beginPath();
        g.moveTo(x + s * 0.4, y - s); // Top edge start (leaving gap)
        g.lineTo(x - s, y - s);       // Top-Left corner
        g.lineTo(x - s, y + s);       // Bottom-Left corner
        g.lineTo(x + s, y + s);       // Bottom-Right corner
        g.lineTo(x + s, y - s * 0.4); // Right edge end (leaving gap)
        g.strokePath();

        // Arrow pointing top-right
        g.beginPath();
        g.moveTo(x - s * 0.2, y + s * 0.2); // Start inside
        g.lineTo(x + s + 1, y - s - 1);       // End outside
        g.strokePath();

        // Arrow head
        g.beginPath();
        g.moveTo(x + s + 1, y - s + 4);
        g.lineTo(x + s + 1, y - s - 1);
        g.lineTo(x + s - 4, y - s - 1);
        g.strokePath();
    },

    drawMic(g, x, y, size = 20, color = 0x00ff88, stroke = 2) {
        const s = size / 2;
        g.lineStyle(stroke, color);
        // Mic body (capsule)
        g.strokeRoundedRect(x - s * 0.25, y - s * 0.7, s * 0.5, s * 0.9, s * 0.25);
        // Holder arc
        g.beginPath();
        g.arc(x, y + s * 0.05, s * 0.45, Math.PI, 0, false);
        g.strokePath();
        // Stand
        g.lineBetween(x, y + s * 0.5, x, y + s * 0.8);
        g.lineBetween(x - s * 0.3, y + s * 0.8, x + s * 0.3, y + s * 0.8);
    },

    drawMicOff(g, x, y, size = 20, color = 0xff4444, stroke = 2) {
        const s = size / 2;
        g.lineStyle(stroke, color);
        g.strokeRoundedRect(x - s * 0.25, y - s * 0.7, s * 0.5, s * 0.9, s * 0.25);
        g.beginPath();
        g.arc(x, y + s * 0.05, s * 0.45, Math.PI, 0, false);
        g.strokePath();
        g.lineBetween(x, y + s * 0.5, x, y + s * 0.8);
        g.lineBetween(x - s * 0.3, y + s * 0.8, x + s * 0.3, y + s * 0.8);
        // Diagonal slash
        g.lineStyle(stroke + 0.5, color);
        g.lineBetween(x - s * 0.7, y - s * 0.9, x + s * 0.7, y + s * 0.9);
    },

    drawBulb(g, x, y, size = 20, color = 0xffcc00, stroke = 2) {
        const s = size / 2;
        g.lineStyle(stroke, color);
        // Bulb dome
        g.beginPath();
        g.arc(x, y - s * 0.2, s * 0.6, Math.PI * 0.75, Math.PI * 0.25, true);
        g.lineTo(x + s * 0.3, y + s * 0.35);
        g.lineTo(x - s * 0.3, y + s * 0.35);
        g.closePath();
        g.strokePath();
        // Bulb base threads
        g.lineBetween(x - s * 0.22, y + s * 0.55, x + s * 0.22, y + s * 0.55);
        g.lineBetween(x - s * 0.15, y + s * 0.75, x + s * 0.15, y + s * 0.75);
    },

    drawInfo(g, x, y, size = 20, color = 0x00ffff, stroke = 2) {
        const s = size / 2;
        g.lineStyle(stroke, color);
        g.strokeCircle(x, y, s * 0.85);
        g.fillStyle(color, 1);
        g.fillCircle(x, y - s * 0.35, s * 0.14);
        g.lineBetween(x, y - s * 0.05, x, y + s * 0.45);
    },

    drawUser(g, x, y, size = 20, color = 0x00ff88, stroke = 2) {
        const s = size / 2;
        g.lineStyle(stroke, color);
        // Head
        g.strokeCircle(x, y - s * 0.35, s * 0.35);
        // Shoulders
        g.beginPath();
        g.arc(x, y + s * 0.8, s * 0.75, Math.PI * 1.15, Math.PI * 1.85, false);
        g.strokePath();
    },

    drawUsers(g, x, y, size = 22, color = 0x00ccff, stroke = 2) {
        const s = size / 2;
        g.lineStyle(stroke, color);
        // Main user (center/left)
        g.strokeCircle(x - s * 0.25, y - s * 0.35, s * 0.3);
        g.beginPath();
        g.arc(x - s * 0.25, y + s * 0.8, s * 0.65, Math.PI * 1.15, Math.PI * 1.85, false);
        g.strokePath();
        // Secondary user (behind/right)
        g.strokeCircle(x + s * 0.45, y - s * 0.45, s * 0.25);
        g.beginPath();
        g.arc(x + s * 0.45, y + s * 0.7, s * 0.55, Math.PI * 1.3, Math.PI * 1.75, false);
        g.strokePath();
    },

    drawBolt(g, x, y, size = 20, color = 0x00ff88) {
        const w = size * 0.55;
        const h = size * 0.9;
        g.fillStyle(color, 1);
        g.beginPath();
        g.moveTo(x + w * 0.1, y - h * 0.55);
        g.lineTo(x - w * 0.5, y - h * 0.05);
        g.lineTo(x - w * 0.05, y - h * 0.05);
        g.lineTo(x - w * 0.5, y + h * 0.55);
        g.lineTo(x + w * 0.55, y + h * 0.05);
        g.lineTo(x + w * 0.1, y + h * 0.05);
        g.closePath();
        g.fillPath();
    },

    drawPin(g, x, y, size = 18, color = 0x00ffff, stroke = 2) {
        const s = size / 2;
        g.lineStyle(stroke, color);
        g.strokeCircle(x, y - s * 0.3, s * 0.35);
        g.beginPath();
        g.moveTo(x, y + s * 0.1);
        g.lineTo(x, y + s * 0.85);
        g.strokePath();
    }
};

// ===== GAME CONFIGURATION =====
const GAME_CONFIG = {
    PLAYER_SPEED: 300,
    PLAYER_LIVES: 3,

    CAR_SPAWN_RATE: 1500,
    CAR_MIN_SPEED: 200,
    CAR_MAX_SPEED: 380,

    NEWT_SPAWN_RATE: 1800,
    NEWT_SPEED: 55,
    NEWT_SIZE: 65,

    // Progressive difficulty thresholds
    DIFFICULTY_THRESHOLD: 1000,

    COLORS: {
        forest: 0x0a1d0a,
        lake: 0x0a1a2d,
        road: 0x111111,
        laneMarker: 0xffcc33,
        neonCyan: 0x00ffff,
        neonPink: 0xff00ff
    }
};

const MULTIPLAYER_CONFIG = {
    PLAYER_UPDATE_MS: 1000 / 60,
    WORLD_UPDATE_MS: 1000 / 20,
    SUPABASE_FALLBACK_PLAYER_UPDATE_MS: 125,
    SUPABASE_FALLBACK_WORLD_UPDATE_MS: 250,
    IDLE_HEARTBEAT_MS: 1500,
    RATIO_PRECISION: 1000,
    REMOTE_INTERPOLATION: 0.35,
    CAR_CORRECTION: 0.2,
    DATA_CHANNEL_RETRY_MS: 2500
};

function quantizeRatio(value) {
    return Math.round(value * MULTIPLAYER_CONFIG.RATIO_PRECISION) / MULTIPLAYER_CONFIG.RATIO_PRECISION;
}

function frameAdjustedLerp(baseAmount, delta) {
    return 1 - Math.pow(1 - baseAmount, delta / 16.67);
}

const isCompactViewport = (width, height) => Math.min(width, height) < 600;

function drawMalePlayerGlobal(g, isPlayer2 = false, expression = 'frowny') {
    g.fillStyle(0x000000, 0.4); g.fillEllipse(0, 28, 35, 12);
    g.fillStyle(0x2c3e50); g.fillRoundedRect(-12, 8, 10, 22, 3); g.fillRoundedRect(2, 8, 10, 22, 3);
    const skinColor = isPlayer2 ? 0xd4a574 : 0xfce4d6;
    g.fillStyle(skinColor);
    g.fillCircle(-20, -5, 6);
    g.fillCircle(20, -5, 6);
    const vestColor = isPlayer2 ? 0xff8800 : 0xccff00;
    const reflectiveSilver = 0xdddddd;
    const accentColor = isPlayer2 ? 0xffcc00 : 0xff6b00;

    g.fillStyle(vestColor);
    g.fillRoundedRect(-18, -18, 36, 32, 5);

    g.fillStyle(accentColor);
    g.fillRect(-14, -18, 12, 32);
    g.fillRect(2, -18, 12, 32);
    g.fillRect(-18, -4, 36, 12);

    g.fillStyle(reflectiveSilver);
    g.fillRect(-12, -18, 8, 32);
    g.fillRect(4, -18, 8, 32);
    g.fillRect(-18, -2, 36, 8);
    g.fillStyle(0x3d2314);
    g.fillEllipse(-12, -26, 6, 12);
    g.fillEllipse(12, -26, 6, 12);
    g.fillStyle(skinColor); g.fillCircle(0, -26, 14);
    g.fillStyle(0xffcccc, 0.4);
    g.fillCircle(-8, -23, 3);
    g.fillCircle(8, -23, 3);
    g.fillStyle(0xffffff);
    g.fillEllipse(-5, -28, 4, 3.5);
    g.fillEllipse(5, -28, 4, 3.5);
    const irisColor = isPlayer2 ? 0x0066cc : 0x4a3728;
    g.fillStyle(irisColor);
    g.fillCircle(-5, -28, 2.2);
    g.fillCircle(5, -28, 2.2);
    g.fillStyle(0x000000);
    g.fillCircle(-5, -28, 1.2);
    g.fillCircle(5, -28, 1.2);
    g.fillStyle(0xffffff);
    g.fillCircle(-4, -29, 0.8);
    g.fillCircle(6, -29, 0.8);
    g.lineStyle(1.5, 0x3d2314);
    g.beginPath();
    g.arc(-5, -34, 4, Math.PI * 0.15, Math.PI * 0.85, false);
    g.strokePath();
    g.beginPath();
    g.arc(5, -34, 4, Math.PI * 0.15, Math.PI * 0.85, false);
    g.strokePath();
    const noseColor = isPlayer2 ? 0xb8906a : 0xcc9988;
    g.fillStyle(noseColor); g.fillEllipse(0, -22, 4, 2);
    g.lineStyle(2, 0x2c3e50);
    g.beginPath();
    if (expression === 'smiley') {
        g.arc(0, -21, 5, 0.1 * Math.PI, 0.9 * Math.PI, false);
    } else {
        g.arc(0, -13, 5, 1.1 * Math.PI, 1.9 * Math.PI, false);
    }
    g.strokePath();
    const capColor = isPlayer2 ? 0x0066cc : 0xff0000;
    const capDarkColor = isPlayer2 ? 0x004499 : 0xcc0000;
    g.fillStyle(capColor); g.fillEllipse(0, -40, 26, 14);
    g.fillStyle(capDarkColor); g.fillRect(-13, -42, 26, 6);
}

function drawFemalePlayerGlobal(g, isPlayer2 = false, expression = 'frowny') {
    g.fillStyle(0x000000, 0.4); g.fillEllipse(0, 28, 35, 12);
    g.fillStyle(0x2c3e50); g.fillRoundedRect(-12, 8, 10, 22, 3); g.fillRoundedRect(2, 8, 10, 22, 3);
    const skinColor = isPlayer2 ? 0xd4a574 : 0xfce4d6;
    g.fillStyle(skinColor);
    g.fillCircle(-20, -5, 6);
    g.fillCircle(20, -5, 6);
    const vestColor = isPlayer2 ? 0x00ccaa : 0xccff00;
    const reflectiveSilver = 0xdddddd;
    const accentColor = isPlayer2 ? 0x00ffcc : 0xff6b00;

    g.fillStyle(vestColor);
    g.fillRoundedRect(-18, -18, 36, 32, 5);

    g.fillStyle(accentColor);
    g.fillRect(-14, -18, 12, 32);
    g.fillRect(2, -18, 12, 32);
    g.fillRect(-18, -4, 36, 12);

    g.fillStyle(reflectiveSilver);
    g.fillRect(-12, -18, 8, 32);
    g.fillRect(4, -18, 8, 32);
    g.fillRect(-18, -2, 36, 8);
    const hairColor = isPlayer2 ? 0x8b2500 : 0x3d2314;
    const hairHighlight = isPlayer2 ? 0xa83c14 : 0x5a3d2b;
    g.fillStyle(hairColor);
    g.fillEllipse(0, -30, 22, 18);
    g.fillEllipse(-14, -15, 12, 34);
    g.fillEllipse(14, -15, 12, 34);
    g.fillEllipse(-12, 5, 9, 16);
    g.fillEllipse(12, 5, 9, 16);
    g.fillStyle(hairHighlight);
    g.fillEllipse(-10, -22, 4, 20);
    g.fillEllipse(10, -22, 4, 20);
    g.fillStyle(skinColor); g.fillCircle(0, -26, 13);
    g.fillStyle(hairColor);
    g.fillEllipse(0, -34, 18, 8);
    g.fillEllipse(-6, -33, 8, 6);
    g.fillEllipse(6, -33, 8, 6);
    g.fillEllipse(0, -38, 20, 10);
    g.fillEllipse(0, -34, 18, 8);
    g.fillEllipse(-6, -33, 8, 6);
    g.fillEllipse(6, -33, 8, 6);
    g.fillEllipse(0, -38, 20, 10);
    g.fillEllipse(0, -34, 18, 8);
    g.fillEllipse(-6, -33, 8, 6);
    g.fillEllipse(6, -33, 8, 6);
    if (isPlayer2) {
        g.fillStyle(0x9933ff);
        g.fillRoundedRect(-14, -38, 28, 5, 2);
    }
    g.fillStyle(0xffcccc, 0.5);
    g.fillCircle(-8, -23, 4);
    g.fillCircle(8, -23, 4);
    g.fillStyle(0xffffff);
    g.fillEllipse(-5, -28, 4, 3.5);
    g.fillEllipse(5, -28, 4, 3.5);
    const irisColor = isPlayer2 ? 0x2e8b57 : 0x4a3728;
    g.fillStyle(irisColor);
    g.fillCircle(-5, -28, 2.2);
    g.fillCircle(5, -28, 2.2);
    g.fillStyle(0x000000);
    g.fillCircle(-5, -28, 1.2);
    g.fillCircle(5, -28, 1.2);
    g.fillStyle(0xffffff);
    g.fillCircle(-4, -29, 0.8);
    g.fillCircle(6, -29, 0.8);
    g.lineStyle(1.5, 0x000000);
    g.lineBetween(-7, -30, -8, -33);
    g.lineBetween(-5, -31, -5, -34);
    g.lineBetween(5, -31, 5, -34);
    g.lineBetween(7, -30, 8, -33);
    g.lineStyle(1.5, hairColor);
    g.beginPath();
    g.arc(-5, -34, 5, Math.PI * 0.15, Math.PI * 0.85, false);
    g.strokePath();
    g.beginPath();
    g.arc(5, -34, 5, Math.PI * 0.15, Math.PI * 0.85, false);
    g.strokePath();
    const noseColor = isPlayer2 ? 0xc4a088 : 0xe8c4b8;
    g.fillStyle(noseColor); g.fillEllipse(0, -24, 2.5, 1.5);
    g.lineStyle(2.5, 0xe07070);
    g.beginPath();
    if (expression === 'smiley') {
        g.arc(0, -21, 5, 0.1 * Math.PI, 0.9 * Math.PI, false);
    } else {
        g.arc(0, -13, 5, 1.1 * Math.PI, 1.9 * Math.PI, false);
    }
    g.strokePath();
}

// ===== SPLASH SCENE =====
class SplashScene extends Phaser.Scene {
    constructor() { super({ key: 'SplashScene' }); }

    preload() {
        this.load.image('poster', 'assets/poster.jpg');
        this.load.image('newt', 'assets/newt.png');
        this.load.audio('bgm_start', 'assets/bgm_start.mp3');
    }

    create() {
        const { width, height } = this.scale;
        const isCompact = isCompactViewport(width, height);

        this.add.rectangle(0, 0, width, height, 0x000000).setOrigin(0);

        // --- POSTER ---
        const poster = this.add.image(width / 2, height / 2, 'poster');
        const scale = Math.min(width / poster.width, height / poster.height);
        poster.setScale(isCompact ? scale * 0.92 : scale);
        poster.setAlpha(0);

        this.tweens.add({
            targets: poster, alpha: 1, duration: 800, ease: 'Power2'
        });

        // --- TUTORIAL VIDEO OVERLAY (Hidden initially) ---
        // Create HTML video element for the tutorial
        const tutorialVideo = document.createElement('video');
        tutorialVideo.src = 'assets/tutorial.mp4';
        tutorialVideo.muted = true;
        tutorialVideo.loop = true;
        tutorialVideo.playsInline = true;
        tutorialVideo.style.position = 'absolute';
        tutorialVideo.style.opacity = '0';
        tutorialVideo.style.transition = 'opacity 0.3s ease';
        tutorialVideo.style.borderRadius = '12px';
        tutorialVideo.style.boxShadow = '0 4px 20px rgba(0,0,0,0.5)';
        tutorialVideo.style.pointerEvents = 'none';
        
        // Video dimensions (720x1280 portrait)
        const videoAspect = 720 / 1280;
        const maxW = width * (isCompact ? 0.7 : 0.5);
        const maxH = height * (isCompact ? 0.75 : 0.8);
        let videoW, videoH;
        
        if (maxW / maxH > videoAspect) {
            videoH = maxH;
            videoW = videoH * videoAspect;
        } else {
            videoW = maxW;
            videoH = videoW / videoAspect;
        }
        
        tutorialVideo.style.width = videoW + 'px';
        tutorialVideo.style.height = videoH + 'px';
        
        // Position video centered in the game canvas
        const canvas = this.game.canvas;
        const canvasRect = canvas.getBoundingClientRect();
        tutorialVideo.style.left = (canvasRect.left + (width - videoW) / 2) + 'px';
        tutorialVideo.style.top = (canvasRect.top + (height - videoH) / 2) + 'px';
        tutorialVideo.style.zIndex = '1000';
        
        document.body.appendChild(tutorialVideo);
        this.tutorialVideo = tutorialVideo;

        // --- PROMPT TEXT ---
        const promptText = this.add.text(width / 2, height - (isCompact ? 52 : 70), 'TAP TO START', {
            fontFamily: 'Fredoka, sans-serif', fontSize: isCompact ? '22px' : '28px', color: '#ffffff', stroke: '#000000', strokeThickness: isCompact ? 3 : 4
        }).setOrigin(0.5).setDepth(20);

        this.tweens.add({
            targets: promptText, alpha: 0.4, duration: 600, yoyo: true, repeat: -1
        });

        // --- SOUND HINT (HTML Overlay) ---
        const soundHint = document.createElement('div');
        soundHint.innerHTML = '<i class="fa-solid fa-volume-up" aria-hidden="true"></i><span> Enable sound for best experience</span>';
        soundHint.style.position = 'absolute';
        soundHint.style.display = 'flex';
        soundHint.style.alignItems = 'center';
        soundHint.style.gap = '8px';
        soundHint.style.color = '#ffffff';
        soundHint.style.fontFamily = 'Outfit, sans-serif';
        soundHint.style.fontSize = isCompact ? '12px' : '14px';
        soundHint.style.padding = isCompact ? '6px 10px' : '8px 12px';
        soundHint.style.borderRadius = '999px';
        soundHint.style.background = 'rgba(0,0,0,0.55)';
        soundHint.style.boxShadow = '0 4px 14px rgba(0,0,0,0.4)';
        soundHint.style.border = '1px solid rgba(255,255,255,0.2)';
        soundHint.style.pointerEvents = 'none';
        soundHint.style.zIndex = '1001';

        const soundHintY = height - (isCompact ? 86 : 110);
        soundHint.style.left = (canvasRect.left + (width / 2)) + 'px';
        soundHint.style.top = (canvasRect.top + soundHintY) + 'px';
        soundHint.style.transform = 'translate(-50%, -50%)';
        document.body.appendChild(soundHint);
        this.soundHint = soundHint;

        // --- HIGH SCORE DISPLAY ---
        this.highScoreText = this.add.text(width / 2, height - (isCompact ? 24 : 30), 'BEAT THE CURRENT HIGH SCORE: ...', {
            fontFamily: 'Fredoka, sans-serif', fontSize: isCompact ? '16px' : '20px', color: '#ffcc00', stroke: '#000000', strokeThickness: isCompact ? 2 : 3
        }).setOrigin(0.5).setDepth(20);

        getLeaderboard().then(scores => {
            if (this.scene.isActive('SplashScene')) {
                const topScore = scores.length > 0 ? scores[0].score : 0;
                this.highScoreText.setText(`BEAT THE CURRENT HIGH SCORE: ${topScore}`);
            }
        });

        // --- AUDIO ---
        // Play start music if loaded
        if (this.cache.audio.exists('bgm_start')) {
            this.bgm = this.sound.add('bgm_start', { loop: true, volume: 0 });
            this.bgm.play();
            // Fade in over 1 second
            this.tweens.add({
                targets: this.bgm,
                volume: 0.5,
                duration: 1000
            });
        }

        // --- STATE MANAGEMENT ---
        let step = 0; // 0 = Poster, 1 = Tutorial, 2 = Starting

        const startGame = () => {
            console.log("Starting GameScene...");
            // Hide and remove the tutorial video
            if (this.tutorialVideo) {
                this.tutorialVideo.style.opacity = '0';
                this.tutorialVideo.pause();
                setTimeout(() => {
                    if (this.tutorialVideo && this.tutorialVideo.parentNode) {
                        this.tutorialVideo.parentNode.removeChild(this.tutorialVideo);
                        this.tutorialVideo = null;
                    }
                }, 300);
            }
            if (this.soundHint && this.soundHint.parentNode) {
                this.soundHint.parentNode.removeChild(this.soundHint);
                this.soundHint = null;
            }
            const fallback = this.time.delayedCall(500, () => {
                if (this.bgm) { this.bgm.stop(); this.bgm.destroy(); }
                if (this.scene.isActive('SplashScene')) this.scene.start('GameScene');
            });
            // Fade out music
            if (this.bgm) {
                this.tweens.add({
                    targets: this.bgm,
                    volume: 0,
                    duration: 300
                });
            }
            this.cameras.main.fadeOut(300, 0, 0, 0);
            this.cameras.main.once('camerafadeoutcomplete', () => {
                if (this.bgm) this.bgm.stop();
                fallback.destroy();
                this.scene.start('GameScene');
            });
        };

        const handleInput = () => {
            if (step === 0) {
                // Show Tutorial Video
                step = 1;
                promptText.setText('TAP TO PLAY');
                tutorialVideo.style.opacity = '1';
                tutorialVideo.play().catch(e => console.log('Video autoplay blocked:', e));
                this.tweens.add({ targets: poster, alpha: 0.3, duration: 300 }); // Dim poster
            } else if (step === 1) {
                // Go to Mode Selection
                step = 2;
                // Hide and remove the tutorial video
                if (this.tutorialVideo) {
                    this.tutorialVideo.style.opacity = '0';
                    this.tutorialVideo.pause();
                    setTimeout(() => {
                        if (this.tutorialVideo && this.tutorialVideo.parentNode) {
                            this.tutorialVideo.parentNode.removeChild(this.tutorialVideo);
                            this.tutorialVideo = null;
                        }
                    }, 300);
                }
                if (this.soundHint && this.soundHint.parentNode) {
                    this.soundHint.parentNode.removeChild(this.soundHint);
                    this.soundHint = null;
                }
                // Fade out music
                if (this.bgm) {
                    this.tweens.add({
                        targets: this.bgm,
                        volume: 0,
                        duration: 300
                    });
                }
                this.cameras.main.fadeOut(300, 0, 0, 0);
                this.cameras.main.once('camerafadeoutcomplete', () => {
                    if (this.bgm) this.bgm.stop();
                    this.scene.start('NameEntryScene');
                });
            }
        };

        // --- INPUTS ---
        const hitArea = this.add.rectangle(0, 0, width, height, 0x000000, 0).setOrigin(0).setInteractive({ useHandCursor: true });
        hitArea.on('pointerdown', handleInput);
        this.input.keyboard.on('keydown', handleInput);

        // --- QUIT BUTTON ---
        const quitBtn = this.add.text(width - (isCompact ? 16 : 20), isCompact ? 16 : 20, '✖ QUIT', {
            fontFamily: 'Outfit, sans-serif',
            fontSize: isCompact ? '13px' : '15px',
            color: '#ff6666',
            backgroundColor: 'rgba(51, 0, 0, 0.7)',
            padding: { left: 10, right: 10, top: 5, bottom: 5 }
        }).setOrigin(1, 0).setDepth(200).setInteractive({ useHandCursor: true });

        quitBtn.on('pointerover', () => quitBtn.setColor('#ffffff'));
        quitBtn.on('pointerout', () => quitBtn.setColor('#ff6666'));
        quitBtn.on('pointerdown', (pointer) => {
            if (pointer && pointer.event) pointer.event.stopPropagation();
            if (this.tutorialVideo) {
                this.tutorialVideo.style.opacity = '0';
                this.tutorialVideo.pause();
                if (this.tutorialVideo.parentNode) this.tutorialVideo.parentNode.removeChild(this.tutorialVideo);
                this.tutorialVideo = null;
            }
            if (this.soundHint && this.soundHint.parentNode) {
                this.soundHint.parentNode.removeChild(this.soundHint);
                this.soundHint = null;
            }
            if (this.bgm) { this.bgm.stop(); this.bgm.destroy(); }
            window.location.reload();
        });

        // --- ALMA BRIDGE FACTS BUTTON ---
        const factsBtn = this.add.text((isCompact ? 16 : 20) + 18, isCompact ? 16 : 20, 'DID YOU KNOW?', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: isCompact ? '12px' : '14px',
            color: '#00ff88',
            backgroundColor: 'rgba(0, 40, 20, 0.85)',
            padding: { left: 16, right: 10, top: 5, bottom: 5 }
        }).setOrigin(0, 0).setDepth(200).setInteractive({ useHandCursor: true });

        const factsIcon = this.add.graphics().setDepth(201);
        Icons.drawBulb(factsIcon, factsBtn.x + 8, factsBtn.y + factsBtn.height / 2, isCompact ? 12 : 14, 0xffcc00);

        factsBtn.on('pointerover', () => factsBtn.setColor('#ffffff'));
        factsBtn.on('pointerout', () => factsBtn.setColor('#00ff88'));
        factsBtn.on('pointerdown', (pointer) => {
            if (pointer && pointer.event) pointer.event.stopPropagation();
            showNewtFactModal(this);
        });

        console.log("SplashScene ready. Two-step start active.");
    }
}

// ===== NAME ENTRY SCENE =====
class NameEntryScene extends Phaser.Scene {
    constructor() { super({ key: 'NameEntryScene' }); }

    create() {
        const { width, height } = this.scale;
        const isCompact = isCompactViewport(width, height);
        const isMobile = width < 500;

        // Background
        this.add.rectangle(0, 0, width, height, 0x0a1a2d).setOrigin(0);

        // Stars
        const starGraphics = this.add.graphics();
        starGraphics.fillStyle(0xffffff, 0.2);
        for (let i = 0; i < 50; i++) {
            starGraphics.fillCircle(
                Phaser.Math.Between(0, width),
                Phaser.Math.Between(0, height),
                Phaser.Math.Between(1, 2)
            );
        }

        // Newt icon at the top
        if (this.textures.exists('newt')) {
            const newtImg = this.add.image(width / 2, height * 0.14, 'newt');
            newtImg.setScale(Math.min(60 / newtImg.width, 60 / newtImg.height));
            newtImg.setAlpha(0.8);
        }

        // Title
        const titleSize = isMobile ? '22px' : (isCompact ? '28px' : '36px');
        this.add.text(width / 2, height * 0.24, 'WHAT\'S YOUR NAME?', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: titleSize,
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: isMobile ? 3 : 4
        }).setOrigin(0.5);

        // Subtitle
        this.add.text(width / 2, height * 0.31, 'So we can put you on the leaderboard!', {
            fontFamily: 'Outfit, sans-serif',
            fontSize: isMobile ? '13px' : (isCompact ? '15px' : '17px'),
            color: '#aaaaaa'
        }).setOrigin(0.5);

        // Disable Phaser key capture so typing works
        this.input.keyboard.removeCapture('W,A,S,D');
        this.input.keyboard.removeCapture([32, 37, 38, 39, 40]);

        // DOM input
        const canvasRect = this.game.canvas.getBoundingClientRect();
        const inputY = height * 0.42;
        const inputEl = document.createElement('input');
        inputEl.type = 'text';
        inputEl.placeholder = 'Enter your name';
        inputEl.maxLength = 15;
        inputEl.value = playerName || '';
        inputEl.style.cssText = `
            position: fixed;
            left: ${canvasRect.left + width / 2}px;
            top: ${canvasRect.top + inputY}px;
            transform: translate(-50%, -50%);
            padding: 14px 24px;
            font-size: ${isMobile ? '18px' : '22px'};
            font-family: 'Fredoka', sans-serif;
            border: 3px solid #00ffff;
            border-radius: 12px;
            background: rgba(0, 0, 0, 0.6);
            color: #ffffff;
            text-align: center;
            width: ${isMobile ? '200px' : '240px'};
            z-index: 10000;
            outline: none;
            transition: border-color 0.2s;
        `;
        document.body.appendChild(inputEl);
        inputEl.focus();

        // Glow effect on focus
        inputEl.addEventListener('focus', () => {
            inputEl.style.borderColor = '#00ffff';
            inputEl.style.boxShadow = '0 0 20px rgba(0, 255, 255, 0.3)';
        });
        inputEl.addEventListener('blur', () => {
            inputEl.style.boxShadow = 'none';
        });

        // Error text (hidden initially)
        const errorText = this.add.text(width / 2, inputY + (isMobile ? 32 : 38), '', {
            fontFamily: 'Outfit, sans-serif',
            fontSize: '14px',
            color: '#ff6666'
        }).setOrigin(0.5).setDepth(10);

        // Continue button
        const btnY = height * 0.58;
        const btnWidth = isMobile ? 200 : 240;
        const btnHeight = isMobile ? 50 : 56;

        const continueBg = this.add.rectangle(width / 2, btnY, btnWidth, btnHeight, 0x003333, 0.9)
            .setStrokeStyle(3, 0x00ffff, 1)
            .setInteractive({ useHandCursor: true });

        const continueText = this.add.text(width / 2, btnY, 'CONTINUE', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: isMobile ? '20px' : '24px',
            color: '#00ffff'
        }).setOrigin(0.5);

        continueBg.on('pointerover', () => {
            continueBg.setStrokeStyle(4, 0x00ffff, 1);
            continueBg.setFillStyle(0x004444, 0.9);
        });
        continueBg.on('pointerout', () => {
            continueBg.setStrokeStyle(3, 0x00ffff, 1);
            continueBg.setFillStyle(0x003333, 0.9);
        });

        const proceed = () => {
            const name = inputEl.value.trim();
            if (!name) {
                errorText.setText('Please enter your name to continue');
                inputEl.style.borderColor = '#ff6666';
                this.time.delayedCall(2000, () => {
                    errorText.setText('');
                    inputEl.style.borderColor = '#00ffff';
                });
                return;
            }
            playerName = name;
            inputEl.remove();
            this.cameras.main.fadeOut(300, 0, 0, 0);
            this.cameras.main.once('camerafadeoutcomplete', () => {
                this.scene.start('ModeSelectScene');
            });
        };

        continueBg.on('pointerdown', proceed);
        inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') proceed();
        });

        // Show top scores as motivation
        this.showTopScores(width, height, isMobile, isCompact);

        // Quit button
        const quitBtn = this.add.text(width - 20, 20, '✖ QUIT', {
            fontFamily: 'Outfit, sans-serif',
            fontSize: '14px',
            color: '#ff6666',
            backgroundColor: 'rgba(51, 0, 0, 0.7)',
            padding: { left: 10, right: 10, top: 5, bottom: 5 }
        }).setOrigin(1, 0).setDepth(200).setInteractive({ useHandCursor: true });

        quitBtn.on('pointerover', () => quitBtn.setColor('#ffffff'));
        quitBtn.on('pointerout', () => quitBtn.setColor('#ff6666'));
        quitBtn.on('pointerdown', () => {
            if (inputEl && inputEl.parentNode) inputEl.remove();
            this.cameras.main.fadeOut(200, 0, 0, 0);
            this.cameras.main.once('camerafadeoutcomplete', () => {
                this.scene.start('SplashScene');
            });
        });

        this.cameras.main.fadeIn(300);
    }

    async showTopScores(width, height, isMobile, isCompact) {
        const scores = await getLeaderboard();
        if (scores.length === 0) return;

        const startY = height * 0.72;
        const trophyIcon = this.add.graphics();
        Icons.drawTrophy(trophyIcon, width / 2 - 65, startY, 16, 0xffcc00);
        this.add.text(width / 2 + 5, startY, 'TOP SCORES', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: '15px',
            color: '#ffcc00'
        }).setOrigin(0.5);

        const lineHeight = isMobile ? 18 : 20;
        scores.slice(0, 3).forEach((s, i) => {
            const medal = i === 0 ? '1st' : i === 1 ? '2nd' : '3rd';
            const color = i === 0 ? '#ffd700' : i === 1 ? '#c0c0c0' : '#cd7f32';
            this.add.text(width / 2, startY + 28 + (i * lineHeight), `${medal}  ${s.player_name} — ${s.score}`, {
                fontFamily: 'Outfit, sans-serif',
                fontSize: '13px',
                color: color
            }).setOrigin(0.5);
        });
    }
}

// ===== MODE SELECT SCENE =====
class ModeSelectScene extends Phaser.Scene {
    constructor() { super({ key: 'ModeSelectScene' }); }

    create() {
        const { width, height } = this.scale;
        const isCompact = isCompactViewport(width, height);
        const isMobile = width < 500;

        // Background
        this.add.rectangle(0, 0, width, height, 0x0a1a2d).setOrigin(0);

        // Add subtle decoration
        const starGraphics = this.add.graphics();
        starGraphics.fillStyle(0xffffff, 0.2);
        for (let i = 0; i < 40; i++) {
            starGraphics.fillCircle(
                Phaser.Math.Between(0, width),
                Phaser.Math.Between(0, height),
                Phaser.Math.Between(1, 2)
            );
        }

        // Title
        const titleSize = isMobile ? '22px' : (isCompact ? '28px' : '36px');
        this.add.text(width / 2, height * 0.15, 'SELECT MODE', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: titleSize,
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: isMobile ? 3 : 4
        }).setOrigin(0.5);

        // Mode buttons
        const btnY = height * 0.45;
        const btnSpacing = isMobile ? 70 : (isCompact ? 90 : 110);
        const btnWidth = isMobile ? 200 : (isCompact ? 260 : 320);
        const btnHeight = isMobile ? 70 : (isCompact ? 85 : 100);

        // Single Player Button
        const singleY = btnY - btnSpacing / 2;
        const singleBg = this.add.rectangle(width / 2, singleY, btnWidth, btnHeight, 0x1a3a2a, 0.9)
            .setStrokeStyle(3, 0x00ff88, 1)
            .setInteractive({ useHandCursor: true });

        const singleText = this.add.text(width / 2 + 10, singleY - 12, 'SINGLE PLAYER', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: isMobile ? '18px' : (isCompact ? '22px' : '26px'),
            color: '#00ff88'
        }).setOrigin(0.5);

        const singleIcon = this.add.graphics();
        Icons.drawUser(singleIcon, singleText.x - singleText.width / 2 - (isMobile ? 12 : 16), singleY - 12, isMobile ? 18 : 22, 0x00ff88);

        this.add.text(width / 2, singleY + 16, 'Classic solo adventure', {
            fontFamily: 'Outfit, sans-serif',
            fontSize: isMobile ? '12px' : (isCompact ? '14px' : '16px'),
            color: '#aaffcc'
        }).setOrigin(0.5);

        // Multiplayer Button
        const multiY = btnY + btnSpacing / 2 + 20;
        const multiBg = this.add.rectangle(width / 2, multiY, btnWidth, btnHeight, 0x1a2a3a, 0.9)
            .setStrokeStyle(3, 0x00ccff, 1)
            .setInteractive({ useHandCursor: true });

        const multiText = this.add.text(width / 2 + 12, multiY - 12, 'MULTIPLAYER', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: isMobile ? '18px' : (isCompact ? '22px' : '26px'),
            color: '#00ccff'
        }).setOrigin(0.5);

        const multiIcon = this.add.graphics();
        Icons.drawUsers(multiIcon, multiText.x - multiText.width / 2 - (isMobile ? 14 : 18), multiY - 12, isMobile ? 20 : 24, 0x00ccff);

        this.add.text(width / 2, multiY + 16, 'Team up with a friend!', {
            fontFamily: 'Outfit, sans-serif',
            fontSize: isMobile ? '12px' : (isCompact ? '14px' : '16px'),
            color: '#aaccff'
        }).setOrigin(0.5);

        if (typeof window !== 'undefined' && !window.RTCPeerConnection) {
            multiBg.setAlpha(0.5);
            multiBg.disableInteractive();
            this.add.text(width / 2, multiY + 40, '(WebRTC not supported)', {
                fontFamily: 'Outfit, sans-serif',
                fontSize: '11px',
                color: '#666666'
            }).setOrigin(0.5);
        }

        // Button interactions
        singleBg.on('pointerover', () => singleBg.setStrokeStyle(4, 0x00ff88, 1));
        singleBg.on('pointerout', () => singleBg.setStrokeStyle(3, 0x00ff88, 1));
        singleBg.on('pointerdown', () => {
            gameMode = 'single';
            cleanupMultiplayerState();
            this.cameras.main.fadeOut(300, 0, 0, 0);
            this.cameras.main.once('camerafadeoutcomplete', () => {
                this.scene.start('CharacterSelectScene');
            });
        });

        multiBg.on('pointerover', () => multiBg.setStrokeStyle(4, 0x00ccff, 1));
        multiBg.on('pointerout', () => multiBg.setStrokeStyle(3, 0x00ccff, 1));
        multiBg.on('pointerdown', () => {
            gameMode = 'multi';
            this.cameras.main.fadeOut(300, 0, 0, 0);
            this.cameras.main.once('camerafadeoutcomplete', () => {
                this.scene.start('LobbyScene');
            });
        });

        // Back button (small, top-left)
        const backBtn = this.add.text(20, 20, '← BACK', {
            fontFamily: 'Outfit, sans-serif',
            fontSize: '14px',
            color: '#888888'
        }).setInteractive({ useHandCursor: true });

        backBtn.on('pointerover', () => backBtn.setColor('#ffffff'));
        backBtn.on('pointerout', () => backBtn.setColor('#888888'));
        backBtn.on('pointerdown', () => {
            this.cameras.main.fadeOut(200, 0, 0, 0);
            this.cameras.main.once('camerafadeoutcomplete', () => {
                this.scene.start('NameEntryScene');
            });
        });

        // Quit button
        const quitBtn = this.add.text(width - 20, 20, '✖ QUIT', {
            fontFamily: 'Outfit, sans-serif',
            fontSize: '14px',
            color: '#ff6666',
            backgroundColor: 'rgba(51, 0, 0, 0.7)',
            padding: { left: 10, right: 10, top: 5, bottom: 5 }
        }).setOrigin(1, 0).setDepth(200).setInteractive({ useHandCursor: true });

        quitBtn.on('pointerover', () => quitBtn.setColor('#ffffff'));
        quitBtn.on('pointerout', () => quitBtn.setColor('#ff6666'));
        quitBtn.on('pointerdown', () => {
            cleanupMultiplayerState();
            this.cameras.main.fadeOut(200, 0, 0, 0);
            this.cameras.main.once('camerafadeoutcomplete', () => {
                this.scene.start('SplashScene');
            });
        });

        // Show player name badge
        this.add.text(width / 2, height * 0.88, `Playing as: ${playerName}`, {
            fontFamily: 'Outfit, sans-serif',
            fontSize: '13px',
            color: '#666666'
        }).setOrigin(0.5);

        // Alma Bridge Facts button
        const factsBtn = this.add.text(width / 2 + 10, height * 0.94, 'Alma Bridge Road Facts', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: isMobile ? '12px' : '14px',
            color: '#00ff88',
            backgroundColor: 'rgba(0, 40, 20, 0.85)',
            padding: { left: 24, right: 12, top: 5, bottom: 5 }
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        const factsIcon = this.add.graphics().setDepth(201);
        Icons.drawBulb(factsIcon, factsBtn.x - factsBtn.width / 2 + 12, factsBtn.y, isMobile ? 13 : 15, 0xffcc00);

        factsBtn.on('pointerover', () => {
            factsBtn.setColor('#ffffff');
            factsBtn.setBackgroundColor('rgba(0, 80, 40, 0.95)');
        });
        factsBtn.on('pointerout', () => {
            factsBtn.setColor('#00ff88');
            factsBtn.setBackgroundColor('rgba(0, 40, 20, 0.85)');
        });
        factsBtn.on('pointerdown', () => {
            showNewtFactModal(this);
        });

        this.cameras.main.fadeIn(300);
    }
}

// ===== LOBBY SCENE =====
class LobbyScene extends Phaser.Scene {
    constructor() { super({ key: 'LobbyScene' }); }

    create() {
        const { width, height } = this.scale;
        const isCompact = isCompactViewport(width, height);
        const isMobile = width < 500;

        // Background
        this.add.rectangle(0, 0, width, height, 0x0a1a2d).setOrigin(0);

        // Title
        this.add.text(width / 2, height * 0.10, 'MULTIPLAYER LOBBY', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: isMobile ? '20px' : (isCompact ? '26px' : '32px'),
            color: '#00ccff',
            stroke: '#000000',
            strokeThickness: 3
        }).setOrigin(0.5);

        this.lobbyState = 'menu'; // 'menu', 'creating', 'waiting', 'joining'
        this.roomSubscription = null;
        this.inputEl = null;

        this.createLobbyMenu();

        // Back button
        const backBtn = this.add.text(20, 20, '← BACK', {
            fontFamily: 'Outfit, sans-serif',
            fontSize: '14px',
            color: '#888888'
        }).setInteractive({ useHandCursor: true });

        backBtn.on('pointerover', () => backBtn.setColor('#ffffff'));
        backBtn.on('pointerout', () => backBtn.setColor('#888888'));
        backBtn.on('pointerdown', () => {
            this.cleanup();
            this.cameras.main.fadeOut(200, 0, 0, 0);
            this.cameras.main.once('camerafadeoutcomplete', () => {
                this.scene.start('ModeSelectScene');
            });
        });

        // Quit button
        const quitBtn = this.add.text(width - 20, 20, '✖ QUIT', {
            fontFamily: 'Outfit, sans-serif',
            fontSize: '14px',
            color: '#ff6666',
            backgroundColor: 'rgba(51, 0, 0, 0.7)',
            padding: { left: 10, right: 10, top: 5, bottom: 5 }
        }).setOrigin(1, 0).setDepth(200).setInteractive({ useHandCursor: true });

        quitBtn.on('pointerover', () => quitBtn.setColor('#ffffff'));
        quitBtn.on('pointerout', () => quitBtn.setColor('#ff6666'));
        quitBtn.on('pointerdown', () => {
            this.cleanup();
            this.cameras.main.fadeOut(200, 0, 0, 0);
            this.cameras.main.once('camerafadeoutcomplete', () => {
                this.scene.start('SplashScene');
            });
        });

        this.events.once('shutdown', () => this.cleanup());
        this.cameras.main.fadeIn(300);
    }

    cleanup() {
        if (this.inputEl && this.inputEl.parentNode) {
            this.inputEl.parentNode.removeChild(this.inputEl);
            this.inputEl = null;
        }
        if (this.lobbyState !== 'playing') {
            this.lobbyState = 'closed';
            cleanupMultiplayerState();
        }
    }

    createLobbyMenu() {
        const { width, height } = this.scale;
        const isCompact = isCompactViewport(width, height);
        const isMobile = width < 500;

        if (this.menuContainer) {
            this.menuContainer.destroy();
        }
        this.menuContainer = this.add.container(0, 0);

        const btnWidth = isMobile ? 220 : (isCompact ? 280 : 340);
        const btnHeight = isMobile ? 60 : (isCompact ? 70 : 80);
        const btnY = height * 0.40;

        const createBg = this.add.rectangle(width / 2, btnY, btnWidth, btnHeight, 0x1a3a2a, 0.9)
            .setStrokeStyle(3, 0x00ff88, 1)
            .setInteractive({ useHandCursor: true });

        const createText = this.add.text(width / 2, btnY, '🏠 CREATE ROOM', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: isMobile ? '18px' : (isCompact ? '22px' : '26px'),
            color: '#00ff88'
        }).setOrigin(0.5);

        this.menuContainer.add([createBg, createText]);

        createBg.on('pointerover', () => createBg.setStrokeStyle(4, 0x00ff88, 1));
        createBg.on('pointerout', () => createBg.setStrokeStyle(3, 0x00ff88, 1));
        createBg.on('pointerdown', () => this.showCreateRoom());

        const joinY = btnY + btnHeight + 30;
        const joinBg = this.add.rectangle(width / 2, joinY, btnWidth, btnHeight, 0x1a2a3a, 0.9)
            .setStrokeStyle(3, 0x00ccff, 1)
            .setInteractive({ useHandCursor: true });

        const joinText = this.add.text(width / 2, joinY, '🔗 JOIN ROOM', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: isMobile ? '18px' : (isCompact ? '22px' : '26px'),
            color: '#00ccff'
        }).setOrigin(0.5);

        this.menuContainer.add([joinBg, joinText]);

        joinBg.on('pointerover', () => joinBg.setStrokeStyle(4, 0x00ccff, 1));
        joinBg.on('pointerout', () => joinBg.setStrokeStyle(3, 0x00ccff, 1));
        joinBg.on('pointerdown', () => this.showJoinRoom());

        const instrText = this.add.text(width / 2, height * 0.75, 
            'Create a room and share the code\nwith your friend to play together!', {
            fontFamily: 'Outfit, sans-serif',
            fontSize: isMobile ? '12px' : '14px',
            color: '#888888',
            align: 'center'
        }).setOrigin(0.5);
        this.menuContainer.add(instrText);
    }

    async showCreateRoom() {
        const { width, height } = this.scale;

        this.lobbyState = 'creating';
        this.menuContainer.destroy();
        this.menuContainer = this.add.container(0, 0);

        const creatingText = this.add.text(width / 2, height * 0.4, 'Creating room...', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: '20px',
            color: '#ffffff'
        }).setOrigin(0.5);
        this.menuContainer.add(creatingText);

        const room = await createRoom(selectedCharacter);

        if (this.lobbyState !== 'creating' || !this.scene.isActive()) {
            cleanupMultiplayerState();
            return;
        }
        
        if (!room) {
            creatingText.setText('Failed to create room.\nPlease try again.');
            creatingText.setColor('#ff6666');
            this.time.delayedCall(2000, () => {
                this.lobbyState = 'menu';
                this.createLobbyMenu();
            });
            return;
        }

        this.showWaitingForPlayer();
    }

    showWaitingForPlayer() {
        const { width, height } = this.scale;
        const isMobile = width < 500;

        this.lobbyState = 'waiting';
        this.menuContainer.destroy();
        this.menuContainer = this.add.container(0, 0);

        this.add.text(width / 2, height * 0.25, 'ROOM CODE', {
            fontFamily: 'Outfit, sans-serif',
            fontSize: '14px',
            color: '#888888'
        }).setOrigin(0.5);

        const codeBox = this.add.rectangle(width / 2, height * 0.35, 200, 70, 0x000000, 0.6)
            .setStrokeStyle(3, 0x00ff88, 1);

        const codeText = this.add.text(width / 2, height * 0.35, roomCode, {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: isMobile ? '36px' : '48px',
            color: '#00ff88',
            letterSpacing: 8
        }).setOrigin(0.5);

        this.menuContainer.add([codeBox, codeText]);

        const waitingText = this.add.text(width / 2, height * 0.50, 'Waiting for player to join...', {
            fontFamily: 'Outfit, sans-serif',
            fontSize: '16px',
            color: '#ffffff'
        }).setOrigin(0.5);
        this.menuContainer.add(waitingText);

        let dots = 0;
        this.dotsTimer = this.time.addEvent({
            delay: 500,
            callback: () => {
                dots = (dots + 1) % 4;
                waitingText.setText('Waiting for player to join' + '.'.repeat(dots));
            },
            loop: true
        });

        const shareText = this.add.text(width / 2, height * 0.60, 
            'Share this code with your friend!', {
            fontFamily: 'Outfit, sans-serif',
            fontSize: '14px',
            color: '#aaaaaa'
        }).setOrigin(0.5);
        this.menuContainer.add(shareText);

        const cancelBtn = this.add.text(width / 2, height * 0.75, 'CANCEL', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: '18px',
            color: '#ff6666',
            backgroundColor: '#330000',
            padding: { left: 20, right: 20, top: 8, bottom: 8 }
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });
        this.menuContainer.add(cancelBtn);

        cancelBtn.on('pointerdown', () => {
            if (this.dotsTimer) this.dotsTimer.destroy();
            cleanupMultiplayerState();
            this.lobbyState = 'menu';
            this.createLobbyMenu();
        });

        if (trysteroRoom && trysteroActions) {
            setRoomListener(trysteroRoom, 'onPeerJoin', () => {
                trysteroActions.sendLobbyHandshake({
                    type: 'host_ready',
                    hostId: playerId,
                    hostCharacter: selectedCharacter,
                    hostName: playerName
                });
            });

            trysteroActions.onLobbyHandshake((payload, peerId) => {
                if (payload && (payload.type === 'guest_join' || payload.type === 'guest_ready')) {
                    applyRemoteLobbyIdentity(payload, peerId, 'guest');
                    trysteroActions.sendLobbyHandshake({
                        type: 'host_welcome',
                        hostId: playerId,
                        hostCharacter: selectedCharacter,
                        hostName: playerName
                    });
                    this.startMultiplayerGame();
                }
            });
        }
    }

    showJoinRoom() {
        const { width, height } = this.scale;

        this.lobbyState = 'joining';
        this.menuContainer.destroy();
        this.menuContainer = this.add.container(0, 0);

        const labelText = this.add.text(width / 2, height * 0.30, 'ENTER ROOM CODE', {
            fontFamily: 'Outfit, sans-serif',
            fontSize: '14px',
            color: '#888888'
        }).setOrigin(0.5);
        this.menuContainer.add(labelText);

        const canvasRect = this.game.canvas.getBoundingClientRect();
        this.inputEl = document.createElement('input');
        this.inputEl.type = 'text';
        this.inputEl.placeholder = 'ABC234';
        this.inputEl.maxLength = 6;
        this.inputEl.style.cssText = `
            position: fixed;
            left: ${canvasRect.left + width / 2}px;
            top: ${canvasRect.top + height * 0.40}px;
            transform: translate(-50%, -50%);
            padding: 15px 25px;
            font-size: 32px;
            font-family: 'Fredoka', sans-serif;
            border: 3px solid #00ccff;
            border-radius: 12px;
            background: #111;
            color: #00ccff;
            text-align: center;
            width: 160px;
            letter-spacing: 8px;
            z-index: 10000;
            outline: none;
        `;
        document.body.appendChild(this.inputEl);
        this.inputEl.focus();

        this.input.keyboard.removeCapture('W,A,S,D');
        this.input.keyboard.removeCapture([32, 37, 38, 39, 40]);

        this.statusText = this.add.text(width / 2, height * 0.55, '', {
            fontFamily: 'Outfit, sans-serif',
            fontSize: '14px',
            color: '#ffffff'
        }).setOrigin(0.5);
        this.menuContainer.add(this.statusText);

        const joinBtn = this.add.text(width / 2, height * 0.65, 'JOIN', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: '22px',
            color: '#000000',
            backgroundColor: '#00ccff',
            padding: { left: 40, right: 40, top: 10, bottom: 10 }
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });
        this.menuContainer.add(joinBtn);

        joinBtn.on('pointerdown', () => this.attemptJoin());

        this.inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.attemptJoin();
            }
        });

        const cancelBtn = this.add.text(width / 2, height * 0.78, 'CANCEL', {
            fontFamily: 'Outfit, sans-serif',
            fontSize: '16px',
            color: '#888888'
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });
        this.menuContainer.add(cancelBtn);

        cancelBtn.on('pointerdown', () => {
            if (this.inputEl && this.inputEl.parentNode) {
                this.inputEl.parentNode.removeChild(this.inputEl);
                this.inputEl = null;
            }
            cleanupMultiplayerState();
            this.lobbyState = 'menu';
            this.createLobbyMenu();
        });
    }

    async attemptJoin() {
        const code = this.inputEl.value.trim().toUpperCase();
        
        if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) {
            this.statusText.setText('Enter the 6-character code');
            this.statusText.setColor('#ff6666');
            return;
        }

        this.statusText.setText('Connecting to room...');
        this.statusText.setColor('#ffffff');

        const room = await joinRoom(code, selectedCharacter);

        if (this.lobbyState !== 'joining' || !this.scene.isActive()) {
            cleanupMultiplayerState();
            return;
        }
        
        if (!room || !trysteroRoom || !trysteroActions) {
            this.statusText.setText('Connection failed. Try again.');
            this.statusText.setColor('#ff6666');
            return;
        }

        const sendGuestHandshake = () => {
            if (trysteroActions) {
                trysteroActions.sendLobbyHandshake({
                    type: 'guest_join',
                    guestId: playerId,
                    guestCharacter: selectedCharacter,
                    guestName: playerName
                });
            }
        };

        setRoomListener(trysteroRoom, 'onPeerJoin', () => {
            sendGuestHandshake();
        });

        let joined = false;
        trysteroActions.onLobbyHandshake((payload, peerId) => {
            if (joined) return;
            if (payload && (payload.type === 'host_welcome' || payload.type === 'host_ready')) {
                joined = true;
                applyRemoteLobbyIdentity(payload, peerId, 'host');
                if (payload.type === 'host_ready') {
                    sendGuestHandshake();
                }
                this.startMultiplayerGame();
            }
        });

        sendGuestHandshake();
        this.time.delayedCall(800, sendGuestHandshake);
        this.time.delayedCall(2000, sendGuestHandshake);
    }

    startMultiplayerGame() {
        // Mark as playing so the lobby's shutdown cleanup doesn't teardown the live room
        this.lobbyState = 'playing';
        if (this.dotsTimer) this.dotsTimer.destroy();
        if (this.inputEl && this.inputEl.parentNode) {
            this.inputEl.parentNode.removeChild(this.inputEl);
            this.inputEl = null;
        }

        this.cameras.main.fadeOut(300, 0, 0, 0);
        this.cameras.main.once('camerafadeoutcomplete', () => {
            this.scene.start('GameScene');
        });
    }
}

// ===== GAME SCENE =====
class GameScene extends Phaser.Scene {
    constructor() { super({ key: 'GameScene' }); }

    init(data = {}) {
        this.restartState = data.restartState || null;
    }

    preload() {
        this.load.image('newt', 'assets/newt.png');
        this.load.image('newtXing', 'assets/newt_Xing.png');
        this.load.audio('sfx_saved', 'assets/sfx_saved.mp3');
        this.load.audio('sfx_hit', 'assets/sfx_hit.mp3');
        this.load.audio('sfx_crash', 'assets/sfx_crash.mp3');
        this.load.audio('bgm_end', 'assets/bgm_end.mp3');
        this.load.audio('light_rain_sound', 'assets/light_rain_sound.mp3');
    }

    create() {
        console.log("GameScene.create started");
        this.score = 0;
        this.saved = 0;
        this.lost = 0;
        this.lives = GAME_CONFIG.PLAYER_LIVES;
        this.gameOver = false;
        this.difficulty = 1;
        this.runStartTime = this.time.now;

        // Multiplayer state
        this.isMultiplayer = gameMode === 'multi';
        this.teamScore = 0;
        this.remotePlayer = null;
        this.remotePlayerGraphics = null;
        this.remoteCarried = [];
        this.remoteCarriedCount = 0;
        this.lastSentPlayerState = null;
        this.lastPlayerBroadcastAt = 0;
        this.disconnectTimer = null;
        this.partnerDisconnected = false;
        this.partnerName = remotePlayerName;
        this.lastHitIntentAt = 0;
        this.lastHitByPlayer = new Map();

        // Achievement tracking
        this.streak = 0;
        this.maxStreak = 0;
        this.achievements = {
            firstSave: false,
            streak5: false,
            streak10: false,
            streak20: false,
            saved10: false,
            saved25: false,
            saved50: false,
            score500: false,
            score1000: false,
            perfectStart: true // Will be set to false if newt is lost
        };
        const restartState = this.restartState;
        applyGameRestartState(this, restartState);

        this.calculateLayout();

        this.cars = this.add.group();
        this.newts = this.add.group();

        this.createEnvironment();
        this.createPlayer();
        
        // Create remote player for multiplayer
        if (this.isMultiplayer) {
            this.createRemotePlayer();
        }

        if (restartState) {
            this.restoreRestartWorld(restartState);
        }

        if (this.isMultiplayer) {
            this.setupMultiplayerSync();
        }
        this.restartState = null;
        
        this.createHUD();
        this.createControls();

        const sceneWidth = this.scale.width;
        const sceneHeight = this.scale.height;
        const handleResize = () => {
            // Don't restart during game over to preserve the name input form
            if (!this.gameOver) {
                this.scene.restart({
                    restartState: createGameRestartState(this, sceneWidth, sceneHeight)
                });
            }
        };
        this.scale.on('resize', handleResize);
        this.events.once('shutdown', () => this.scale.off('resize', handleResize));

        // Only host spawns cars and newts in multiplayer
        if (!this.isMultiplayer || isHost) {
            this.carTimer = this.time.addEvent({
                delay: GAME_CONFIG.CAR_SPAWN_RATE,
                callback: this.spawnCar,
                callbackScope: this,
                loop: true
            });
            this.time.addEvent({ delay: GAME_CONFIG.NEWT_SPAWN_RATE, callback: this.spawnNewt, callbackScope: this, loop: true });
            if (!restartState) this.spawnNewt();
        }

        this.cameras.main.fadeIn(300);

        // Rain effect
        this.raindrops = [];
        for (let i = 0; i < this.rainDropCount; i++) {
            this.raindrops.push({
                x: Phaser.Math.Between(0, this.scale.width),
                y: Phaser.Math.Between(0, this.scale.height),
                speed: Phaser.Math.Between(300, 600),
                length: Phaser.Math.Between(8, 18)
            });
        }
        this.rainGraphics = this.add.graphics().setDepth(100);
        if (this.isCompact) {
            this.rainGraphics.setAlpha(0.8);
        }
        if (this.cache.audio.exists('light_rain_sound')) {
            this.rainBgm = this.sound.add('light_rain_sound', { loop: true, volume: 0.15 });
            this.rainBgm.play();
        }
    }

    calculateLayout() {
        const { width, height } = this.scale;
        this.isCompact = isCompactViewport(width, height);
        this.layoutScale = this.isCompact ? 0.78 : 1;
        this.roadHeight = Math.min(height * 0.55, this.isCompact ? 360 : 450);
        this.roadY = (height - this.roadHeight) / 2;
        this.laneHeight = this.roadHeight / 4;
        this.topSafe = this.roadY;
        this.botSafe = this.roadY + this.roadHeight;
        this.rainDropCount = this.isCompact ? 40 : 80;
        this.rainLayerCount = this.isCompact ? 3 : 5;
        this.forestLayerCount = this.isCompact ? 2 : 3;
    }

    createEnvironment() {
        const { width, height } = this.scale;
        const g = this.add.graphics();

        // Open Space Preserve (top) - High Res Forest
        g.fillGradientStyle(0x051805, 0x051805, 0x0a2a0a, 0x0a2a0a);
        g.fillRect(0, 0, width, this.topSafe);

        // Draw dense forest with depth
        const layers = this.forestLayerCount;
        for (let l = 0; l < layers; l++) {
            const density = this.isCompact ? 55 : 40; // Horizontal spacing
            // Darker in back, lighter in front
            const brightness = 0.4 + (l * 0.2);
            const baseColor = Phaser.Display.Color.GetColor(30 * brightness, 80 * brightness, 40 * brightness);

            for (let x = -20; x < width + 20; x += density * (0.8 + Math.random() * 0.4)) {
                const height = (this.isCompact ? 32 : 40) + (l * 10) + Math.random() * 15;
                const w = (this.isCompact ? 20 : 25) + (l * 5);

                g.fillStyle(baseColor);

                // Draw Pine Tree (3 triangles stacked)
                // Bottom tier
                g.fillTriangle(x, this.topSafe, x + w / 2, this.topSafe - height * 0.4, x + w, this.topSafe);
                // Middle tier
                g.fillTriangle(x + w * 0.1, this.topSafe - height * 0.3, x + w / 2, this.topSafe - height * 0.7, x + w * 0.9, this.topSafe - height * 0.3);
                // Top tier
                g.fillTriangle(x + w * 0.2, this.topSafe - height * 0.6, x + w / 2, this.topSafe - height, x + w * 0.8, this.topSafe - height * 0.6);
            }
        }

        // Lexington Reservoir (bottom) - High Res Water
        // Deep water base
        g.fillGradientStyle(0x001133, 0x001133, 0x002244, 0x002244);
        g.fillRect(0, this.botSafe, width, height - this.botSafe);

        // Procedural Waves - Multiple layers for "high res" feel
        const waveLayers = this.rainLayerCount;
        for (let l = 0; l < waveLayers; l++) {
            const yBase = this.botSafe + 10 + (l * ((height - this.botSafe) / waveLayers));
            g.lineStyle(2, 0x44aadd, 0.3 - (l * 0.05)); // Fades out slightly at bottom
            g.fillStyle(0x003366, 0.3); // Semi-transparent fill for depth

            g.beginPath();
            g.moveTo(0, height);
            g.lineTo(0, yBase);

            // Draw sine wave across width
            const freq = 0.02 + (l * 0.005);
            const amp = 5 + (l * 2);
            for (let x = 0; x <= width; x += this.isCompact ? 16 : 10) {
                const y = yBase + Math.sin(x * freq + l) * amp;
                g.lineTo(x, y);
            }
            g.lineTo(width, height);
            g.closePath();
            g.fillPath();
            g.strokePath();

            // Add shimmering highlights
            g.fillStyle(0xffffff, 0.1);
            const shimmerStep = this.isCompact ? 80 : 50;
            for (let x = 0; x < width; x += shimmerStep + Math.random() * shimmerStep) {
                const y = yBase + Math.sin(x * freq + l) * amp;
                g.fillCircle(x, y, 1.5);
            }
        }

        // Road
        g.fillStyle(0x111111);
        g.fillRect(0, this.roadY, width, this.roadHeight);

        g.lineStyle(3, 0x00ffff, 0.4);
        g.lineBetween(0, this.roadY, width, this.roadY);
        g.lineBetween(0, this.botSafe, width, this.botSafe);

        // Lane dividers
        for (let i = 1; i < 4; i++) {
            const y = this.roadY + i * this.laneHeight;
            for (let x = 20; x < width; x += 70) {
                g.fillStyle(0xffcc33, 0.7);
                g.fillRoundedRect(x, y - 3, 35, 6, 3);
            }
        }

        // Road name - subtle in center
        this.add.text(width / 2, this.roadY + this.roadHeight / 2, 'ALMA BRIDGE ROAD', {
            fontFamily: 'Outfit, sans-serif', fontSize: this.isCompact ? '12px' : '14px', color: '#333333', fontStyle: 'italic'
        }).setOrigin(0.5).setAlpha(0.5);

        // Location labels with MapPing icons
        // Fancy styling as requested
        const fancyStyle = {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: this.isCompact ? '14px' : '18px',
            fontStyle: 'bold',
            stroke: '#000000',
            strokeThickness: this.isCompact ? 3 : 4,
            shadow: { offsetX: 2, offsetY: 2, color: '#000000', blur: 4, fill: true }
        };

        const topTextOffset = this.isCompact ? 18 : 25;
        const topText = this.add.text(width / 2 + 12, this.topSafe - topTextOffset, 'OPEN SPACE PRESERVE', { ...fancyStyle, color: '#44dd66' }).setOrigin(0.5);
        const topIcon = this.add.graphics();
        Icons.drawMapPin(topIcon, topText.x - topText.width / 2 - (this.isCompact ? 12 : 18), this.topSafe - topTextOffset - 1, this.isCompact ? 14 : 18, 0x44dd66);

        const botTextOffset = this.isCompact ? 18 : 25;
        const botText = this.add.text(width / 2 + 12, this.botSafe + botTextOffset, 'LEXINGTON RESERVOIR', { ...fancyStyle, color: '#44aadd' }).setOrigin(0.5);
        const botIcon = this.add.graphics();
        Icons.drawMapPin(botIcon, botText.x - botText.width / 2 - (this.isCompact ? 12 : 18), this.botSafe + botTextOffset - 1, this.isCompact ? 14 : 18, 0x44aadd);

        // Newt crossing signs - diagonally opposite (top-left and bottom-right at road edges)
        const signSize = this.isCompact ? 40 : 50;
        const signOffset = this.isCompact ? 34 : 45;
        this.add.image(signOffset, this.topSafe - topTextOffset, 'newtXing').setDisplaySize(signSize, signSize);
        this.add.image(width - signOffset, this.botSafe - topTextOffset, 'newtXing').setDisplaySize(signSize, signSize);
    }

    createCrossingSign(x, y) {
        const g = this.add.graphics();
        // Yellow diamond background
        g.fillStyle(0xffcc00);
        g.beginPath();
        g.moveTo(x, y - 22);
        g.lineTo(x + 18, y);
        g.lineTo(x, y + 22);
        g.lineTo(x - 18, y);
        g.closePath();
        g.fillPath();
        // Black border
        g.lineStyle(2, 0x000000, 1);
        g.beginPath();
        g.moveTo(x, y - 22);
        g.lineTo(x + 18, y);
        g.lineTo(x, y + 22);
        g.lineTo(x - 18, y);
        g.closePath();
        g.strokePath();
        // Newt silhouette
        g.lineStyle(2, 0x000000, 1);
        g.beginPath();
        g.moveTo(x - 8, y); g.lineTo(x + 8, y);
        g.moveTo(x + 8, y); g.lineTo(x + 10, y - 2);
        g.moveTo(x + 8, y); g.lineTo(x + 10, y + 2);
        g.moveTo(x - 8, y); g.lineTo(x - 12, y + 4);
        g.moveTo(x + 4, y); g.lineTo(x + 6, y - 6);
        g.moveTo(x + 4, y); g.lineTo(x + 6, y + 6);
        g.moveTo(x - 4, y); g.lineTo(x - 6, y - 6);
        g.moveTo(x - 4, y); g.lineTo(x - 6, y + 6);
        g.strokePath();
    }

    createPlayer() {
        const { width } = this.scale;
        this.player = this.add.container(width / 2, this.botSafe + 60);
        this.player.setDepth(50);
        this.player.setScale(this.layoutScale);
        const g = this.add.graphics();
        
        if (selectedCharacter === 'female') {
            this.drawFemalePlayer(g);
        } else {
            this.drawMalePlayer(g);
        }
        
        this.player.add(g);
        this.player.graphics = g;
        
        // Apply character-specific stats
        const stats = CHARACTER_STATS[selectedCharacter];
        this.player.speed = GAME_CONFIG.PLAYER_SPEED * stats.speedMultiplier * (this.isCompact ? 0.92 : 1);
        this.player.carryCapacity = stats.carryCapacity;
        
        this.player.carried = [];
        this.player.invincible = false;
        this.walkTime = 0;
    }

    updatePlayerExpression(playerObj, characterType, isPlayer2 = false) {
        if (!playerObj || !playerObj.graphics) return;
        const carriedCount = playerObj.carried ? playerObj.carried.length : 0;
        const expression = carriedCount > 0 ? 'smiley' : 'frowny';
        if (playerObj.lastExpression !== expression) {
            playerObj.lastExpression = expression;
            playerObj.graphics.clear();
            if (characterType === 'female') {
                this.drawFemalePlayer(playerObj.graphics, isPlayer2, expression);
            } else {
                this.drawMalePlayer(playerObj.graphics, isPlayer2, expression);
            }
        }
    }

    createRemotePlayer() {
        const { width } = this.scale;
        // Remote player starts on opposite side
        const startX = isHost ? width / 2 + 60 : width / 2 - 60;
        
        this.remotePlayer = this.add.container(startX, this.botSafe + 60);
        this.remotePlayer.setDepth(49); // Slightly below local player
        this.remotePlayer.setScale(this.layoutScale);
        
        const g = this.add.graphics();
        
        // Draw remote player with P2 colors
        if (remoteCharacter === 'female') {
            this.drawFemalePlayer(g, true); // true = isPlayer2
        } else {
            this.drawMalePlayer(g, true);
        }
        
        this.remotePlayer.add(g);
        this.remotePlayer.graphics = g;
        this.remotePlayer.netTargetX = startX;
        this.remotePlayer.netTargetY = this.botSafe + 60;
        this.remotePlayer.lastNetUpdateAt = 0;
        
        // Apply remote character stats
        const remoteStats = CHARACTER_STATS[remoteCharacter] || CHARACTER_STATS['male'];
        this.remotePlayer.carryCapacity = remoteStats.carryCapacity;
        this.remotePlayer.carried = [];
        
        // Add P2 label above remote player
        const label = this.add.text(0, -55, 'P2', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: '12px',
            color: '#00ccff',
            stroke: '#000000',
            strokeThickness: 2
        }).setOrigin(0.5);
        this.remotePlayer.add(label);
        
        // Add P1 label above local player
        const p1Label = this.add.text(0, -55, 'P1', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: '12px',
            color: '#00ff88',
            stroke: '#000000',
            strokeThickness: 2
        }).setOrigin(0.5);
        this.player.add(p1Label);
        
        this.remoteWalkTime = 0;
    }

    restoreRestartWorld(state) {
        const width = this.scale.width;
        const height = this.scale.height;

        if (state.player) {
            this.player.x = state.player.xRatio * width;
            this.player.y = state.player.yRatio * height;
            this.player.scaleX = state.player.scaleX;
        }

        (state.newts || []).forEach(data => {
            const newt = this.add.image(data.xRatio * width, data.yRatio * height, 'newt');
            newt.setDisplaySize(GAME_CONFIG.NEWT_SIZE, GAME_CONFIG.NEWT_SIZE);
            newt.setDepth(data.isCarried ? 55 : 25);
            newt.dir = data.dir;
            newt.dest = data.dest;
            newt.isCarried = data.isCarried;
            newt.carriedBy = data.carriedBy;
            newt.newtId = data.id;
            newt.rotation = newt.dir === 1 ? Math.PI / 2 : -Math.PI / 2;
            this.newts.add(newt);

            const carriedByLocal = data.isCarried &&
                ((!this.isMultiplayer && data.carriedBy === 'local') || data.carriedBy === playerId);
            if (carriedByLocal) {
                this.player.carried.push(newt);
            } else if (data.isCarried && this.remotePlayer) {
                this.remotePlayer.carried.push(newt);
            }
        });

        (state.cars || []).forEach(data => {
            this.createCarFromData({
                ...data,
                x: data.xRatio * width,
                y: data.yRatio * height,
                speed: data.speedRatio * width
            });
        });
    }

    setupMultiplayerSync() {
        if (!roomCode) return;

        if (trysteroRoom && !trysteroActions) {
            initTrysteroActions(trysteroRoom);
        }

        if (trysteroActions) {
            trysteroActions.onPlayerUpdate((payload) => {
                this.handleMultiplayerMessage('player_update', payload);
            });
            trysteroActions.onGameState((payload) => {
                this.handleMultiplayerMessage('game_state', payload);
            });
            trysteroActions.onNewtPickup((payload) => {
                this.handleMultiplayerMessage('newt_pickup', payload);
            });
            trysteroActions.onNewtSave((payload) => {
                this.handleMultiplayerMessage('newt_save', payload);
            });
            trysteroActions.onPlayerDisconnect((payload) => {
                this.handleMultiplayerMessage('player_disconnect', payload);
            });
            trysteroActions.onGameOver((payload) => {
                this.handleMultiplayerMessage('game_over', payload);
            });
            trysteroActions.onPlayerName((payload) => {
                this.handleMultiplayerMessage('player_name', payload);
            });
            trysteroActions.onPlayerHitIntent((payload) => {
                this.handleMultiplayerMessage('player_hit_intent', payload);
            });
            trysteroActions.onPlayerHit((payload) => {
                this.handleMultiplayerMessage('player_hit', payload);
            });
        }

        if (trysteroRoom) {
            setRoomListener(trysteroRoom, 'onPeerLeave', (peerId) => {
                this.handleMultiplayerMessage('player_disconnect', { playerId: peerId });
            });
        }

        this.broadcastPlayerName(playerName);
        this.configureMultiplayerTimers(true);

        lastRemoteUpdate = Date.now();
        this.disconnectCheckTimer = this.time.addEvent({
            delay: 1000,
            callback: this.checkPartnerConnection,
            callbackScope: this,
            loop: true
        });

        this.updateMicButton();
    }

    handleMultiplayerMessage(event, payload) {
        if (!payload) return;

        switch (event) {
            case 'player_update':
                if (payload.playerId !== playerId) this.handleRemotePlayerUpdate(payload);
                break;
            case 'game_state':
                if (!isHost) this.handleGameStateUpdate(payload);
                break;
            case 'newt_pickup':
                if (payload.playerId !== playerId) this.handleRemoteNewtPickup(payload);
                break;
            case 'newt_save':
                if (isHost || payload.playerId !== playerId) this.handleNewtSave(payload);
                break;
            case 'player_disconnect':
                if (payload.playerId !== playerId) this.handlePartnerDisconnect();
                break;
            case 'game_over':
                if (payload.playerId !== playerId && !this.gameOver) this.handleRemoteGameOver(payload);
                break;
            case 'player_name':
                if (payload.playerId !== playerId) this.handlePartnerName(payload);
                break;
            case 'player_hit_intent':
                if (isHost) this.handlePlayerHitIntent(payload);
                break;
            case 'player_hit':
                this.handlePlayerHitOutcome(payload);
                break;
            default:
                break;
        }
    }

    isGameDataChannelReady() {
        return Boolean(trysteroRoom && trysteroActions);
    }

    getPlayerUpdateDelay() {
        return MULTIPLAYER_CONFIG.PLAYER_UPDATE_MS;
    }

    getWorldUpdateDelay() {
        return MULTIPLAYER_CONFIG.WORLD_UPDATE_MS;
    }

    configureMultiplayerTimers(forceBroadcast = false) {
        if (this.gameOver) return;

        if (this.broadcastTimer) this.broadcastTimer.destroy();
        if (this.gameStateBroadcastTimer) this.gameStateBroadcastTimer.destroy();

        this.broadcastTimer = this.time.addEvent({
            delay: this.getPlayerUpdateDelay(),
            callback: this.broadcastPlayerState,
            callbackScope: this,
            loop: true
        });

        if (isHost) {
            this.gameStateBroadcastTimer = this.time.addEvent({
                delay: this.getWorldUpdateDelay(),
                callback: this.broadcastGameState,
                callbackScope: this,
                loop: true
            });
        }

        if (forceBroadcast) {
            this.broadcastPlayerState(true);
            if (isHost) this.broadcastGameState();
        }
    }

    sendMultiplayerMessage(event, payload, options = {}) {
        if (!trysteroActions) return false;
        try {
            switch (event) {
                case 'player_update':
                    trysteroActions.sendPlayerUpdate(payload);
                    return true;
                case 'game_state':
                    trysteroActions.sendGameState(payload);
                    return true;
                case 'newt_pickup':
                    trysteroActions.sendNewtPickup(payload);
                    return true;
                case 'newt_save':
                    trysteroActions.sendNewtSave(payload);
                    return true;
                case 'player_disconnect':
                    trysteroActions.sendPlayerDisconnect(payload);
                    return true;
                case 'game_over':
                    trysteroActions.sendGameOver(payload);
                    return true;
                case 'player_name':
                    trysteroActions.sendPlayerName(payload);
                    return true;
                case 'player_hit_intent':
                    trysteroActions.sendPlayerHitIntent(payload);
                    return true;
                case 'player_hit':
                    trysteroActions.sendPlayerHit(payload);
                    return true;
                default:
                    return false;
            }
        } catch (err) {
            console.warn('Multiplayer send error:', err);
            return false;
        }
    }

    broadcastPlayerState(force = false) {
        if (!this.isGameDataChannelReady() || this.gameOver) return;
        
        const width = this.scale.width;
        const height = this.scale.height;
        const now = Date.now();
        
        const payload = {
            playerId: playerId,
            xRatio: quantizeRatio(this.player.x / width),
            yRatio: quantizeRatio(this.player.y / height),
            scaleX: this.player.scaleX,
            carriedCount: this.player.carried.length,
            timestamp: now
        };

        if (!this.shouldBroadcastPlayerState(payload, force)) return;

        this.sendMultiplayerMessage('player_update', payload, { volatile: true });

        this.lastSentPlayerState = payload;
        this.lastPlayerBroadcastAt = now;
    }

    shouldBroadcastPlayerState(payload, force = false) {
        if (force || !this.lastSentPlayerState) return true;
        if (payload.timestamp - this.lastPlayerBroadcastAt >= MULTIPLAYER_CONFIG.IDLE_HEARTBEAT_MS) return true;

        return payload.xRatio !== this.lastSentPlayerState.xRatio ||
            payload.yRatio !== this.lastSentPlayerState.yRatio ||
            payload.scaleX !== this.lastSentPlayerState.scaleX ||
            payload.carriedCount !== this.lastSentPlayerState.carriedCount;
    }

    broadcastGameState() {
        if (!this.isGameDataChannelReady() || !isHost || this.gameOver) return;
        
        const width = this.scale.width;
        const height = this.scale.height;
        
        const newtsData = this.newts.getChildren().map(n => ({
            id: n.newtId,
            xRatio: quantizeRatio(n.x / width),
            yRatio: quantizeRatio(n.y / height),
            dest: n.dest,
            dir: n.dir,
            isCarried: n.isCarried,
            carriedBy: n.carriedBy || null
        }));

        const carsData = this.cars.getChildren().map(c => ({
            id: c.carId,
            xRatio: quantizeRatio(c.x / width),
            yRatio: quantizeRatio(c.y / height),
            speedRatio: quantizeRatio(c.speed / width),
            type: c.type,
            color: c.carColor,
            dir: c.dir,
            lane: c.lane,
            w: c.w,
            h: c.h
        }));

        gameStateSeq++;
        const payload = {
            seq: gameStateSeq,
            teamScore: this.teamScore,
            lives: this.lives,
            saved: this.saved,
            lost: this.lost,
            difficulty: this.difficulty,
            newts: newtsData,
            cars: carsData
        };

        this.sendMultiplayerMessage('game_state', payload, { volatile: true });
    }

    handleRemotePlayerUpdate(data) {
        if (!this.remotePlayer || this.gameOver) return;
        
        lastRemoteUpdate = Date.now();
        
        const w = this.scale.width;
        const h = this.scale.height;
        
        // Convert normalized coordinates to local screen coordinates
        const targetX = data.xRatio * w;
        const targetY = data.yRatio * h;

        const previousUpdateAt = this.remotePlayer.lastNetUpdateAt || 0;
        this.remotePlayer.netTargetX = targetX;
        this.remotePlayer.netTargetY = targetY;
        this.remotePlayer.lastNetUpdateAt = Date.now();

        if (!previousUpdateAt || this.remotePlayer.lastNetUpdateAt - previousUpdateAt > 1000) {
            this.remotePlayer.x = targetX;
            this.remotePlayer.y = targetY;
        }
        
        this.remotePlayer.scaleX = data.scaleX;
        
        // Update remote carried count for display
        const previousCarriedCount = this.remoteCarriedCount || 0;
        this.remoteCarriedCount = data.carriedCount || 0;
        if (this.remotePlayer && this.remotePlayer.carried) {
            while (this.remotePlayer.carried.length > this.remoteCarriedCount) {
                const extra = this.remotePlayer.carried.pop();
                if (extra) {
                    extra.isCarried = false;
                    extra.carriedBy = null;
                    extra.destroy();
                }
            }
        }
        if (previousCarriedCount !== this.remoteCarriedCount) this.updateHUD();
    }

    interpolateRemotePlayer(delta) {
        if (!this.remotePlayer || this.gameOver) return;
        if (this.remotePlayer.netTargetX === undefined || this.remotePlayer.netTargetY === undefined) return;

        const correction = frameAdjustedLerp(MULTIPLAYER_CONFIG.REMOTE_INTERPOLATION, delta);
        const previousX = this.remotePlayer.x;
        const previousY = this.remotePlayer.y;
        this.remotePlayer.x = Phaser.Math.Linear(this.remotePlayer.x, this.remotePlayer.netTargetX, correction);
        this.remotePlayer.y = Phaser.Math.Linear(this.remotePlayer.y, this.remotePlayer.netTargetY, correction);

        if (Math.abs(this.remotePlayer.x - this.remotePlayer.netTargetX) < 0.5) this.remotePlayer.x = this.remotePlayer.netTargetX;
        if (Math.abs(this.remotePlayer.y - this.remotePlayer.netTargetY) < 0.5) this.remotePlayer.y = this.remotePlayer.netTargetY;

        const moved = Math.abs(this.remotePlayer.x - previousX) + Math.abs(this.remotePlayer.y - previousY) > 0.25;
        this.remoteWalkTime = (this.remoteWalkTime || 0) + delta * 0.015;
        this.remotePlayer.graphics.y = moved ? Math.sin(this.remoteWalkTime) * 3 : Math.sin(this.time.now * 0.003) * 1.5;

        if (this.remotePlayer.carried) {
            this.remotePlayer.carried.forEach((newt, index) => {
                newt.x = this.remotePlayer.x + (index === 0 ? -22 : 22);
                newt.y = this.remotePlayer.y - 18;
            });
        }
    }

    handleGameStateUpdate(data) {
        if (isHost || this.gameOver) return;
        
        // Drop out-of-order messages
        if (data.seq !== undefined && data.seq <= lastReceivedSeq) return;
        if (data.seq !== undefined) lastReceivedSeq = data.seq;
        
        // Host is the authoritative source for all game state on the guest
        this.teamScore = data.teamScore;
        this.lives = data.lives;
        this.saved = data.saved;
        this.lost = data.lost;
        this.difficulty = data.difficulty;
        
        // Sync newts and cars (for guest)
        this.syncNewts(data.newts);
        if (data.cars) {
            this.syncCars(data.cars);
        }
        this.updateHUD();
    }

    syncNewts(newtsData) {
        if (!newtsData) return;
        
        const w = this.scale.width;
        const h = this.scale.height;
        
        // Build map of current newts
        const currentNewts = new Map();
        this.newts.getChildren().forEach(n => {
            if (n.newtId) currentNewts.set(n.newtId, n);
        });
        
        newtsData.forEach(nData => {
            const existing = currentNewts.get(nData.id);
            
            // Convert normalized coordinates to local screen
            const localX = nData.xRatio * w;
            const localY = nData.yRatio * h;
            
            if (existing) {
                // Update position only if not carried
                if (!nData.isCarried) {
                    existing.x = localX;
                    existing.y = localY;
                    existing.visible = true;
                } else {
                    // Newt is carried - position it with the carrier
                    if (nData.carriedBy === playerId) {
                        // We're carrying this newt, local player will position it
                        existing.visible = true;
                    } else if (nData.carriedBy && nData.carriedBy !== playerId) {
                        // Remote player is carrying it
                        if (this.remotePlayer && !this.remotePlayer.carried.includes(existing)) {
                            this.remotePlayer.carried.push(existing);
                        }
                        existing.visible = true;
                    }
                }
                existing.isCarried = nData.isCarried;
                existing.carriedBy = nData.carriedBy;
                existing.dir = nData.dir || existing.dir;
                existing.dest = nData.dest || existing.dest;
                currentNewts.delete(nData.id);
            } else if (!nData.isCarried) {
                // Create new newt on guest
                const newt = this.add.image(localX, localY, 'newt');
                newt.setDisplaySize(GAME_CONFIG.NEWT_SIZE, GAME_CONFIG.NEWT_SIZE);
                newt.setDepth(25);
                newt.dir = nData.dir || 1;
                newt.dest = nData.dest;
                newt.isCarried = false;
                newt.newtId = nData.id;
                newt.rotation = newt.dir === 1 ? Math.PI / 2 : -Math.PI / 2;
                this.newts.add(newt);
            }
        });
        
        // Remove newts that no longer exist on host
        currentNewts.forEach(n => n.destroy());
        
        // Clean up remote player's carried array
        if (this.remotePlayer && this.remotePlayer.carried) {
            this.remotePlayer.carried = this.remotePlayer.carried.filter(n => n && n.active && n.isCarried);
        }
    }

    syncCars(carsData) {
        if (!carsData) return;
        
        const w = this.scale.width;
        const h = this.scale.height;
        
        // Build map of current cars
        const currentCars = new Map();
        this.cars.getChildren().forEach(c => {
            if (c.carId) currentCars.set(c.carId, c);
        });
        
        carsData.forEach(cData => {
            const existing = currentCars.get(cData.id);
            
            // Convert normalized coordinates to local screen
            const localX = cData.xRatio * w;
            const localY = cData.yRatio * h;
            const localSpeed = cData.speedRatio ? cData.speedRatio * w : cData.speed;
            
            if (existing) {
                // Store target position and speed for local interpolation
                existing.targetX = localX;
                existing.targetY = localY;
                existing.speed = localSpeed;
                currentCars.delete(cData.id);
            } else {
                // Create new car on guest with local coordinates
                this.createCarFromData({
                    ...cData,
                    x: localX,
                    y: localY,
                    speed: localSpeed
                });
            }
        });
        
        // Remove cars that no longer exist on host
        currentCars.forEach(c => c.destroy());
    }

    createCarFromData(data) {
        const container = this.add.container(data.x, data.y);
        container.setDepth(30);

        const g = this.add.graphics();
        const color = data.color;
        const dir = data.dir;

        if (data.type === 'car') this.draw3DCar(g, color, dir);
        else if (data.type === 'truck') this.draw3DTruck(g, color, dir);
        else if (data.type === 'motorbike') this.draw3DMotorbike(g, color, dir);

        container.add(g);
        container.speed = data.speed;
        container.type = data.type;
        container.carColor = color;
        container.dir = dir;
        container.lane = data.lane;
        container.carId = data.id;
        container.w = data.w;
        container.h = data.h;

        this.cars.add(container);
    }

    handleNewtSpawn(data) {
        if (isHost) return; // Host spawns locally
        
        const newt = this.add.image(data.x, data.y, 'newt');
        newt.setDisplaySize(GAME_CONFIG.NEWT_SIZE, GAME_CONFIG.NEWT_SIZE);
        newt.setDepth(25);
        newt.dir = data.dir;
        newt.dest = data.dest;
        newt.isCarried = false;
        newt.newtId = data.id;
        newt.rotation = newt.dir === 1 ? Math.PI / 2 : -Math.PI / 2;
        this.newts.add(newt);
    }

    handleRemoteNewtPickup(data) {
        // Find the newt and mark it as carried by remote
        const newt = this.newts.getChildren().find(n => n.newtId === data.newtId);
        if (newt && !newt.isCarried) {
            // If the local player also picked this up in the same frame, resolve conflict:
            // the newt stays with whoever claimed it first. Since remote already claimed it,
            // remove from local player's carried list if present.
            const localIdx = this.player.carried.indexOf(newt);
            if (localIdx !== -1) {
                this.player.carried.splice(localIdx, 1);
            }
            newt.isCarried = true;
            newt.carriedBy = data.playerId; // Use actual playerId for proper sync
            if (this.remotePlayer) {
                if (!this.remotePlayer.carried.includes(newt)) {
                    this.remotePlayer.carried.push(newt);
                }
            }
            this.createPickupEffect(newt.x, newt.y);
        }
    }

    handleNewtSave(data) {
        if (isHost && data.playerId === playerId) {
            return;
        }
        const savedNewt = data.newtId
            ? this.newts.getChildren().find(n => n.newtId === data.newtId)
            : null;

        if (isHost && !this.isValidRemoteNewtSave(data, savedNewt)) {
            return;
        }

        if (savedNewt) {
            if (this.remotePlayer && this.remotePlayer.carried) {
                this.remotePlayer.carried = this.remotePlayer.carried.filter(n => n !== savedNewt);
            }
            savedNewt.destroy();
        }

        // Update team score and stats
        if (data.correct) {
            this.teamScore += 100;
            this.saved++;
            if (this.cache.audio.exists('sfx_saved')) this.sound.play('sfx_saved', { volume: 0.6 });
            this.createSuccessEffect(data.x, data.y);
        }
        this.updateHUD();
    }

    isValidRemoteNewtSave(data, newt) {
        if (!data || data.playerId !== remotePlayerId || !data.correct) return false;
        if (!newt || newt.active === false || !newt.isCarried || newt.carriedBy !== data.playerId) return false;
        if (!this.remotePlayer) return false;

        const remoteY = this.remotePlayer.netTargetY ?? this.remotePlayer.y;
        if (!Number.isFinite(remoteY)) return false;

        return (newt.dest === 'FOREST' && remoteY < this.topSafe) ||
            (newt.dest === 'LAKE' && remoteY > this.botSafe);
    }

    requestPlayerHit() {
        if (!this.isMultiplayer || isHost || this.gameOver) return;
        const now = Date.now();
        if (now - this.lastHitIntentAt < 1000) return;
        this.lastHitIntentAt = now;
        this.sendMultiplayerMessage('player_hit_intent', { playerId: playerId, timestamp: now });
    }

    handlePlayerHitIntent(data) {
        if (!isHost || this.gameOver || !data || !data.playerId) return;
        const now = Date.now();
        const last = this.lastHitByPlayer.get(data.playerId) || 0;
        if (now - last < 1000) return;
        this.lastHitByPlayer.set(data.playerId, now);

        this.lives--;
        this.streak = 0;
        this.updateHUD();

        if (data.playerId !== playerId && this.remotePlayer && this.remotePlayer.carried) {
            this.remotePlayer.carried.forEach(n => n && n.destroy());
            this.remotePlayer.carried = [];
        }

        if (this.lives <= 0) {
            this.gameOver = true;
            this.showGameOver();
        }

        this.sendMultiplayerMessage('player_hit', { playerId: data.playerId, lives: this.lives });
    }

    handlePlayerHitOutcome(data) {
        if (!data || data.playerId !== playerId || this.gameOver) return;
        if (typeof data.lives === 'number') {
            this.lives = data.lives;
        }
        this.applyHitEffects(false);
    }

    applyHitEffects(decrementLives = true) {
        if (this.gameOver) return;
        if (decrementLives) {
            this.lives--;
        }
        this.updateHUD();

        this.streak = 0;

        if (this.cache.audio.exists('sfx_crash')) {
            this.sound.play('sfx_crash', { volume: 0.7 });
        } else if (this.cache.audio.exists('sfx_hit')) {
            this.sound.play('sfx_hit', { volume: 0.7 });
        }

        this.cameras.main.shake(400, 0.03);
        this.cameras.main.flash(100, 255, 80, 80, false);

        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

        this.player.carried.forEach(n => n.destroy()); this.player.carried = [];
        this.cameras.main.flash(150, 255, 50, 50, false);
        this.player.invincible = true;
        this.time.delayedCall(2000, () => { this.player.invincible = false; this.player.alpha = 1; });
        this.player.x = this.scale.width / 2;
        this.player.y = this.botSafe + 60;
        if (this.lives <= 0) { this.gameOver = true; this.showGameOver(); }
    }

    checkPartnerConnection() {
        if (this.gameOver || this.partnerDisconnected) return;
        
        const timeSinceUpdate = Date.now() - lastRemoteUpdate;
        if (timeSinceUpdate > 10000) {
            this.handlePartnerDisconnect();
        }
    }

    handlePartnerDisconnect() {
        if (this.partnerDisconnected) return;
        this.partnerDisconnected = true;
        
        const { width, height } = this.scale;
        
        this.add.rectangle(0, 0, width, height, 0x000000, 0.8).setOrigin(0).setDepth(400);
        this.add.text(width / 2, height / 2 - 30, 'Partner Disconnected', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: '28px',
            color: '#ff6666',
            stroke: '#000000',
            strokeThickness: 4
        }).setOrigin(0.5).setDepth(401);
        
        this.add.text(width / 2, height / 2 + 10, 'Game ending...', {
            fontFamily: 'Outfit, sans-serif',
            fontSize: '16px',
            color: '#ffffff'
        }).setOrigin(0.5).setDepth(401);
        
        this.time.delayedCall(2000, () => {
            this.gameOver = true;
            this.score = this.teamScore;
            this.showGameOver();
        });
    }

    broadcastDisconnect() {
        this.sendMultiplayerMessage('player_disconnect', { playerId: playerId });
    }

    broadcastGameOver() {
        this.sendMultiplayerMessage('game_over', { 
            playerId: playerId,
            teamScore: this.teamScore,
            saved: this.saved,
            lost: this.lost,
            maxStreak: this.maxStreak
        });
    }

    handleRemoteGameOver(data) {
        if (this.gameOver) return;
        
        if (data.teamScore !== undefined) this.teamScore = data.teamScore;
        if (data.saved !== undefined) this.saved = data.saved;
        if (data.lost !== undefined) this.lost = data.lost;
        if (data.maxStreak !== undefined) this.maxStreak = data.maxStreak;
        
        this.gameOver = true;
        this.score = this.teamScore;
        this.showGameOver();
    }

    broadcastPlayerName(name) {
        this.sendMultiplayerMessage('player_name', { playerId: playerId, name: name });
    }

    handlePartnerName(data) {
        if (data.name) {
            this.partnerName = data.name;
            remotePlayerName = data.name;
        }
    }
    async setupVoiceChat() {
        if (!this.isMultiplayer || this.voiceChatStarting) return;
        if (!trysteroRoom) return;

        this.voiceChatStarting = true;
        this.voiceChatAvailable = Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
        this.updateMicButton();

        if (!this.voiceChatAvailable) {
            this.voiceChatStarting = false;
            this.updateMicButton();
            return;
        }

        try {
            if (!localStream) {
                localStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true
                    },
                    video: false
                });
            }

            setRoomListener(trysteroRoom, 'onPeerStream', (stream, peerId) => {
                if (!remoteAudioEl) {
                    remoteAudioEl = document.createElement('audio');
                    remoteAudioEl.autoplay = true;
                    remoteAudioEl.playsInline = true;
                    remoteAudioEl.style.display = 'none';
                    document.body.appendChild(remoteAudioEl);
                }
                remoteAudioEl.srcObject = stream;
                voiceChatActive = true;
                this.updateMicButton();
            });

            trysteroRoom.addStream(localStream);
            voiceChatActive = true;
            this.voiceChatReady = true;
            this.voiceChatAvailable = true;
            this.voiceChatStarting = false;
            this.updateMicButton();
        } catch (err) {
            console.warn('Voice chat mic unavailable:', err.message);
            this.voiceChatAvailable = false;
            this.voiceChatStarting = false;
            this.updateMicButton();
        }
    }

    toggleMute() {
        if (!this.isMultiplayer || this.voiceChatStarting) return;
        if (!this.voiceChatReady || !localStream) {
            this.setupVoiceChat();
            return;
        }
        if (!this.voiceChatAvailable) return;
        isMuted = !isMuted;
        localStream.getAudioTracks().forEach(track => {
            track.enabled = !isMuted;
        });
        this.updateMicButton();
    }

    updateMicButton() {
        if (!this.micBtnGraphics) return;
        this.micBtnGraphics.clear();

        const x = this.micBtnX;
        const y = this.micBtnY;
        const size = this.isCompact ? 16 : 20;
        const btnRadius = this.isCompact ? 18 : 22;

        if (this.voiceChatStarting) {
            this.micBtnGraphics.fillStyle(0x1a3344, 0.8);
            this.micBtnGraphics.fillCircle(x, y, btnRadius);
            this.micBtnGraphics.lineStyle(2, 0x00ccff, 0.8);
            this.micBtnGraphics.strokeCircle(x, y, btnRadius);
            Icons.drawMic(this.micBtnGraphics, x, y, size, 0x00ccff);
        } else if (!this.voiceChatAvailable) {
            this.micBtnGraphics.fillStyle(0x333333, 0.7);
            this.micBtnGraphics.fillCircle(x, y, btnRadius);
            Icons.drawMicOff(this.micBtnGraphics, x, y, size, 0x666666);
        } else if (!localStream || !trysteroRoom) {
            this.micBtnGraphics.fillStyle(0x223344, 0.8);
            this.micBtnGraphics.fillCircle(x, y, btnRadius);
            this.micBtnGraphics.lineStyle(2, 0x00ccff, 0.8);
            this.micBtnGraphics.strokeCircle(x, y, btnRadius);
            Icons.drawMic(this.micBtnGraphics, x, y, size, 0x00ccff);
        } else if (isMuted) {
            this.micBtnGraphics.fillStyle(0x442222, 0.8);
            this.micBtnGraphics.fillCircle(x, y, btnRadius);
            this.micBtnGraphics.lineStyle(2, 0xff4444, 0.8);
            this.micBtnGraphics.strokeCircle(x, y, btnRadius);
            Icons.drawMicOff(this.micBtnGraphics, x, y, size, 0xff4444);
        } else {
            this.micBtnGraphics.fillStyle(0x224422, 0.8);
            this.micBtnGraphics.fillCircle(x, y, btnRadius);
            this.micBtnGraphics.lineStyle(2, 0x00ff88, 0.8);
            this.micBtnGraphics.strokeCircle(x, y, btnRadius);
            Icons.drawMic(this.micBtnGraphics, x, y, size, 0x00ff88);
        }
    }

    drawMalePlayer(g, isPlayer2 = false, expression = 'frowny') {
        drawMalePlayerGlobal(g, isPlayer2, expression);
    }

    drawFemalePlayer(g, isPlayer2 = false, expression = 'frowny') {
        drawFemalePlayerGlobal(g, isPlayer2, expression);
    }

    createHUD() {
        const padding = this.isCompact ? 12 : 20;
        const style = { fontFamily: 'Fredoka, sans-serif', fontSize: this.isCompact ? '16px' : '20px', color: '#ffffff', stroke: '#000', strokeThickness: this.isCompact ? 2 : 3 };

        this.livesIconGroup = this.add.group();

        // Score display - made more prominent with background panel
        this.scoreBg = this.add.graphics().setDepth(199);
        this.scoreBg.fillStyle(0x000000, 0.7);
        const scoreWidth = this.isCompact ? 98 : 120;
        const scoreHeight = this.isCompact ? 40 : 50;
        const scoreX = this.scale.width - scoreWidth - padding;
        const scoreY = padding - 6;
        this.scoreBg.fillRoundedRect(scoreX, scoreY, scoreWidth, scoreHeight, 10);
        this.scoreBg.lineStyle(2, 0xffcc00, 0.8);
        this.scoreBg.strokeRoundedRect(scoreX, scoreY, scoreWidth, scoreHeight, 10);

        this.scoreText = this.add.text(this.scale.width - padding - 6, padding + (this.isCompact ? 12 : 18), '', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: this.isCompact ? '26px' : '35px',  // Increased by 75%
            color: '#ffcc00',
            stroke: '#000000',
            strokeThickness: this.isCompact ? 3 : 4,
            shadow: { offsetX: 2, offsetY: 2, color: '#000000', blur: 4, fill: true }
        }).setOrigin(1, 0).setDepth(200);

        // "SCORE" label above the number
        this.add.text(this.scale.width - padding - 6, padding - 2, 'SCORE', {
            fontFamily: 'Outfit, sans-serif',
            fontSize: this.isCompact ? '10px' : '12px',
            color: '#aaaaaa'
        }).setOrigin(1, 0).setDepth(200);

        this.carryText = this.add.text(this.scale.width / 2, padding, '', {
            ...style,
            color: '#00ffff',
            shadow: { offsetX: 2, offsetY: 2, color: '#000000', blur: 3, fill: true }
        }).setOrigin(0.5, 0).setDepth(200);

        // Carrying label background pill
        this.carryBg = this.add.graphics().setDepth(199);

        // Stats panel with semi-transparent dark background
        this.statsBg = this.add.graphics().setDepth(199);
        this.statsBg.fillStyle(0x000000, 0.75);
        const statsWidth = this.isCompact ? 170 : 200;
        const statsHeight = this.isCompact ? 38 : 45;
        const statsX = padding - 2;
        const statsY = this.scale.height - statsHeight - padding + 4;
        this.statsBg.fillRoundedRect(statsX, statsY, statsWidth, statsHeight, 10);
        this.statsBg.lineStyle(2, 0x00ffff, 0.5);
        this.statsBg.strokeRoundedRect(statsX, statsY, statsWidth, statsHeight, 10);

        this.statsText = this.add.text(padding + 2, this.scale.height - padding - 2, '', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: this.isCompact ? '18px' : '22px',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: this.isCompact ? 2 : 3
        }).setOrigin(0, 1).setDepth(200);

        // Room code display for multiplayer (top-left corner below hearts)
        if (this.isMultiplayer && roomCode) {
            this.roomCodeText = this.add.text(padding, this.isCompact ? 50 : 60, `ROOM: ${roomCode}`, {
                fontFamily: 'Outfit, sans-serif',
                fontSize: this.isCompact ? '12px' : '14px',
                color: '#00ccff',
                stroke: '#000000',
                strokeThickness: 2
            }).setOrigin(0, 0).setDepth(200);
        }

        // Voice chat mic button (multiplayer only)
        if (this.isMultiplayer) {
            this.voiceChatAvailable = Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.RTCPeerConnection);
            this.voiceChatStarting = false;
            const btnRadius = this.isCompact ? 18 : 22;
            this.micBtnX = this.scale.width - padding - btnRadius;
            this.micBtnY = this.isCompact ? 56 : 68;

            this.micBtnGraphics = this.add.graphics().setDepth(200);

            // Invisible interactive hit area
            this.micHitArea = this.add.circle(
                this.micBtnX, this.micBtnY, btnRadius + 4, 0x000000, 0
            ).setDepth(201).setInteractive({ useHandCursor: true });

            this.micHitArea.on('pointerdown', () => {
                this.toggleMute();
            });

            this.updateMicButton();
        }

        // In-game Quit button (top-right next to score box / mic button)
        const quitBtnX = this.scale.width - padding - scoreWidth - 12;
        const quitBtnY = padding + 2;
        this.quitBtn = this.add.text(quitBtnX, quitBtnY, '✖ QUIT', {
            fontFamily: 'Outfit, sans-serif',
            fontSize: this.isCompact ? '12px' : '14px',
            color: '#ff6666',
            backgroundColor: 'rgba(51, 0, 0, 0.75)',
            padding: { left: 8, right: 8, top: 4, bottom: 4 }
        }).setOrigin(1, 0).setDepth(200).setInteractive({ useHandCursor: true });

        this.quitBtn.on('pointerover', () => this.quitBtn.setColor('#ffffff'));
        this.quitBtn.on('pointerout', () => this.quitBtn.setColor('#ff6666'));
        this.quitBtn.on('pointerdown', () => {
            this.confirmQuitGame();
        });

        this.updateHUD();
    }

    updateHUD() {
        if (this.gameOver) return;

        // Update Heart Icons
        this.livesIconGroup.clear(true, true);
        const heartSize = this.isCompact ? 16 : 20;
        const heartSpacing = this.isCompact ? 22 : 28;
        const heartStartX = this.isCompact ? 22 : 30;
        const heartY = this.isCompact ? 26 : 32;
        for (let i = 0; i < GAME_CONFIG.PLAYER_LIVES; i++) {
            const g = this.add.graphics().setDepth(200);
            const color = i < this.lives ? 0xff3366 : 0x333333;
            Icons.drawHeart(g, heartStartX + i * heartSpacing, heartY, heartSize, color, 2.5);
            this.livesIconGroup.add(g);
        }

        // Display team score in multiplayer, regular score otherwise
        const displayScore = this.isMultiplayer ? this.teamScore : this.score;
        this.scoreText.setText(`${displayScore}`);

        // Update carrying display
        if (this.carryIconGroup) {
            this.carryIconGroup.clear(true, true);
            this.carryIconGroup.destroy();
            this.carryIconGroup = null;
        }
        
        // In multiplayer, show both players' carry status
        if (this.isMultiplayer) {
            const p1Count = this.player.carried.length;
            const p1Max = this.player.carryCapacity;
            const p2Count = this.remoteCarriedCount || 0;
            const p2Max = this.remotePlayer ? this.remotePlayer.carryCapacity : 1;
            this.carryText.setText(`P1: newts x ${p1Count} | P2: newts x ${p2Count}`);
        } else {
            const c = this.player.carried.length;
            const maxCapacity = this.player.carryCapacity;
            const carryCount = Math.min(c, maxCapacity);
            this.carryText.setText(`Carrying ${carryCount} of ${maxCapacity} Newt${maxCapacity > 1 ? 's' : ''}`);
        }

        // Draw pill background sized to text
        if (this.carryBg) {
            const padX = this.isCompact ? 10 : 12;
            const padY = this.isCompact ? 5 : 7;
            const bounds = this.carryText.getBounds();
            const bgWidth = bounds.width + padX * 2;
            const bgHeight = bounds.height + padY * 2;
            const bgX = bounds.centerX - bgWidth / 2;
            const bgY = bounds.y - padY;

            this.carryBg.clear();
            this.carryBg.fillStyle(0x000000, 0.6);
            this.carryBg.fillRoundedRect(bgX, bgY, bgWidth, bgHeight, bgHeight / 2);
            this.carryBg.lineStyle(2, this.isMultiplayer ? 0x00ccff : 0x00ffff, 0.45);
            this.carryBg.strokeRoundedRect(bgX, bgY, bgWidth, bgHeight, bgHeight / 2);
        }

        this.statsText.setText(`SAVED: ${this.saved} | LOST: ${this.lost}`);
        
        // Update room code display in multiplayer
        if (this.isMultiplayer && this.roomCodeText) {
            this.roomCodeText.setText(`ROOM: ${roomCode}`);
        }
    }

    updateDifficulty() {
        const scoreToUse = this.isMultiplayer ? this.teamScore : this.score;
        if (scoreToUse >= GAME_CONFIG.DIFFICULTY_THRESHOLD) {
            const excess = scoreToUse - GAME_CONFIG.DIFFICULTY_THRESHOLD;
            this.difficulty = 1 + (excess / 1000) * 0.5;
            this.difficulty = Math.min(this.difficulty, 2.5);
            const newDelay = Math.max(600, GAME_CONFIG.CAR_SPAWN_RATE / this.difficulty);
            if (this.carTimer) this.carTimer.delay = newDelay;
        }
    }

    createControls() {
        this.inputData = { active: false, x: 0, y: 0, sx: 0, sy: 0 };
        this.cursors = this.input.keyboard.createCursorKeys();
        this.wasd = this.input.keyboard.addKeys('W,A,S,D');
        const joyBaseSize = this.isCompact ? 45 : 55;
        const joyThumbSize = this.isCompact ? 22 : 28;
        this.joyBase = this.add.circle(0, 0, joyBaseSize, 0xffffff, 0.15).setStrokeStyle(2, 0x00ffff, 0.5).setVisible(false).setDepth(500);
        this.joyThumb = this.add.circle(0, 0, joyThumbSize, 0x00ffff, 0.4).setVisible(false).setDepth(501);
        this.input.on('pointerdown', p => {
            if (p.y < (this.isCompact ? 80 : 100) || this.gameOver) return;
            this.inputData.active = true;
            this.inputData.sx = p.x;
            this.inputData.sy = p.y;
            this.joyBase.setPosition(p.x, p.y).setVisible(true);
            this.joyThumb.setPosition(p.x, p.y).setVisible(true);
        });
        this.input.on('pointermove', p => {
            if (!this.inputData.active) return;
            const dx = p.x - this.inputData.sx;
            const dy = p.y - this.inputData.sy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const max = 45;
            const clamped = Math.min(dist, max);
            if (dist > 0) {
                this.inputData.x = (dx / dist) * (clamped / max);
                this.inputData.y = (dy / dist) * (clamped / max);
                this.joyThumb.setPosition(this.inputData.sx + dx * (clamped / dist), this.inputData.sy + dy * (clamped / dist));
            }
        });
        this.input.on('pointerup', () => {
            this.inputData.active = false;
            this.inputData.x = 0;
            this.inputData.y = 0;
            this.joyBase.setVisible(false);
            this.joyThumb.setVisible(false);
        });
    }

    update(time, delta) {
        if (this.gameOver) return;
        this.updatePlayer(time, delta);
        if (this.isMultiplayer) this.interpolateRemotePlayer(delta);
        // Host moves cars locally; guest interpolates from synced data
        if (!this.isMultiplayer || isHost) {
            this.updateCars(delta);
        } else {
            // Guest: interpolate car positions locally for smoothness
            this.interpolateCars(delta);
        }
        this.updateNewts(delta);
        this.checkCollisions();
        this.updateRain(delta);
    }

    updateRain(delta) {
        if (this.isCompact) {
            this.rainFrameSkip = (this.rainFrameSkip || 0) + 1;
            if (this.rainFrameSkip % 2 !== 0) return;
        }
        this.rainGraphics.clear();
        this.rainGraphics.lineStyle(1, 0x6688aa, 0.4);

        this.raindrops.forEach(drop => {
            drop.y += drop.speed * (delta / 1000);
            if (drop.y > this.scale.height) {
                drop.y = -drop.length;
                drop.x = Phaser.Math.Between(0, this.scale.width);
            }
            this.rainGraphics.lineBetween(drop.x, drop.y, drop.x - 2, drop.y + drop.length);
        });
    }

    updatePlayer(time, delta) {
        // Skip WASD input if game is over (allows typing in name input)
        if (this.gameOver) return;

        let dx = 0, dy = 0;
        if (this.cursors.left.isDown || this.wasd.A.isDown) dx = -1; else if (this.cursors.right.isDown || this.wasd.D.isDown) dx = 1;
        if (this.cursors.up.isDown || this.wasd.W.isDown) dy = -1; else if (this.cursors.down.isDown || this.wasd.S.isDown) dy = 1;
        if (this.inputData.active) { dx = this.inputData.x; dy = this.inputData.y; }
        if (dx !== 0 || dy !== 0) {
            const mag = Math.sqrt(dx * dx + dy * dy);
            this.player.x += (dx / mag) * this.player.speed * (delta / 1000);
            this.player.y += (dy / mag) * this.player.speed * (delta / 1000);
            if (dx !== 0) this.player.scaleX = dx > 0 ? 1 : -1;
            this.walkTime += delta * 0.015;
            this.player.graphics.y = Math.sin(this.walkTime) * 3;
        } else {
            this.player.graphics.y = Math.sin(time * 0.003) * 1.5;
        }
        this.player.x = Phaser.Math.Clamp(this.player.x, 25, this.scale.width - 25);
        this.player.y = Phaser.Math.Clamp(this.player.y, 25, this.scale.height - 25);
        this.player.carried.forEach((n, i) => {
            n.x = this.player.x + (i === 0 ? -22 : 22);
            n.y = this.player.y - 18;
        });
        
        // Also update remote player's carried newts position
        if (this.isMultiplayer && this.remotePlayer && this.remotePlayer.carried) {
            this.remotePlayer.carried.forEach((n, i) => {
                n.x = this.remotePlayer.x + (i === 0 ? -22 : 22);
                n.y = this.remotePlayer.y - 18;
            });
        }
        
        if (this.player.invincible) {
            this.player.alpha = (Math.floor(time / 100) % 2 === 0) ? 0.4 : 0.9;
        }
        this.updatePlayerExpression(this.player, selectedCharacter, false);
        if (this.isMultiplayer && this.remotePlayer) {
            this.updatePlayerExpression(this.remotePlayer, remoteCharacter || 'male', true);
        }
    }

    updateCars(delta) {
        const cars = this.cars.getChildren();
        const dt = delta / 1000;

        cars.forEach(car => {
            // Move car based on current speed
            car.x += car.speed * dt;

            // Target speed depends on type
            const targetSpeed = car.type === 'motorbike' ?
                (GAME_CONFIG.CAR_MAX_SPEED * 1.4 * this.difficulty * Math.sign(car.speed)) :
                (car.type === 'truck' ?
                    (GAME_CONFIG.CAR_MIN_SPEED * 0.8 * this.difficulty * Math.sign(car.speed)) :
                    (GAME_CONFIG.CAR_MIN_SPEED * 1.2 * this.difficulty * Math.sign(car.speed)));

            // Smoothly accelerate to target speed (unless blocked)
            car.speed = Phaser.Math.Linear(car.speed, targetSpeed, 0.02);

            const dir = Math.sign(car.speed);
            const lookAheadDist = 200;

            // Check for cars ahead
            let carAhead = null;
            let minDist = Infinity;

            cars.forEach(other => {
                if (car === other) return;

                // Same lane check
                if (Math.abs(car.y - other.y) < 10) {
                    const dx = other.x - car.x;
                    if (dir === 1 && dx > 0 && dx < lookAheadDist) {
                        if (dx < minDist) { minDist = dx; carAhead = other; }
                    } else if (dir === -1 && dx < 0 && dx > -lookAheadDist) {
                        const dist = Math.abs(dx);
                        if (dist < minDist) { minDist = dist; carAhead = other; }
                    }
                }
            });

            if (carAhead) {
                // Brake if too close
                if (minDist < 120) {
                    car.speed = Phaser.Math.Linear(car.speed, carAhead.speed, 0.1);
                }

                // Try to overtake if stuck and moving slow
                if (!car.isChangingLane && minDist < 100 && Math.abs(car.speed) < Math.abs(targetSpeed) * 0.8) {
                    this.tryOvertake(car, cars, dir);
                }
            }

            if (dir === 1 && car.x > this.scale.width + 200) car.destroy();
            else if (dir === -1 && car.x < -200) car.destroy();
        });
    }

    // Guest-side car interpolation for smooth movement
    interpolateCars(delta) {
        const dt = delta / 1000;
        const cars = this.cars.getChildren();
        const correction = frameAdjustedLerp(MULTIPLAYER_CONFIG.CAR_CORRECTION, delta);
        
        cars.forEach(car => {
            // Move car locally based on speed for smooth animation
            car.x += car.speed * dt;
            
            // If we have a target position from host, smoothly correct towards it
            if (car.targetX !== undefined) {
                const diff = car.targetX - car.x;
                // Only correct if we're drifting too far from expected position
                if (Math.abs(diff) > 5) {
                    car.x += diff * correction;
                }
            }

            if (car.targetY !== undefined) {
                const laneDrift = car.targetY - car.y;
                if (Math.abs(laneDrift) > 1) {
                    car.y += laneDrift * correction;
                }
            }
            
            // Destroy cars that are off-screen
            if (car.x > this.scale.width + 200 || car.x < -200) {
                car.destroy();
            }
        });
    }

    tryOvertake(car, allCars, dir) {
        const laneIndex = Math.round((car.y - this.roadY - this.laneHeight / 2) / this.laneHeight);
        const candidates = [];

        // Only switch to lanes with same direction
        if (dir === 1) {
            if (laneIndex === 0) candidates.push(1);
            if (laneIndex === 1) candidates.push(0);
        } else {
            if (laneIndex === 2) candidates.push(3);
            if (laneIndex === 3) candidates.push(2);
        }

        for (const targetLane of candidates) {
            const targetY = this.roadY + targetLane * this.laneHeight + this.laneHeight / 2;
            let safe = true;

            // Check target lane safety
            for (const other of allCars) {
                if (Math.abs(other.y - targetY) < 10) {
                    const dx = Math.abs(other.x - car.x);
                    if (dx < 250) { safe = false; break; }
                }
            }

            if (safe) {
                car.isChangingLane = true;
                this.tweens.add({
                    targets: car,
                    y: targetY,
                    duration: 600,
                    ease: 'Power2',
                    onComplete: () => { car.isChangingLane = false; }
                });
                break;
            }
        }
    }

    spawnCar() {
        if (this.gameOver) return;

        const typeRoll = Math.random();
        let type = 'car';
        if (typeRoll > 0.85) type = 'motorbike';
        else if (typeRoll > 0.65) type = 'truck';

        const lane = Phaser.Math.Between(0, 3);
        const dir = lane < 2 ? 1 : -1;

        const y = this.roadY + lane * this.laneHeight + this.laneHeight / 2;
        const x = dir === 1 ? -150 : this.scale.width + 150;

        const safeDistance = 250;
        let safeToSpawn = true;
        this.cars.getChildren().forEach(c => {
            if (Math.abs(c.y - y) < 10) {
                if (dir === 1 && c.x < -150 + safeDistance) safeToSpawn = false;
                if (dir === -1 && c.x > this.scale.width + 150 - safeDistance) safeToSpawn = false;
            }
        });

        if (!safeToSpawn) return;

        const baseSpeed = Phaser.Math.Between(GAME_CONFIG.CAR_MIN_SPEED, GAME_CONFIG.CAR_MAX_SPEED);
        let speedMultiplier = 1;
        if (type === 'motorbike') speedMultiplier = 1.4;
        if (type === 'truck') speedMultiplier = 0.8;

        const speed = baseSpeed * this.difficulty * dir * speedMultiplier;

        const container = this.add.container(x, y);
        container.setDepth(30);

        const g = this.add.graphics();
        // Tesla-inspired paint palette (pearl white, solid black, midnight silver, deep blue, multi-coat red, etc.)
        const colors = [
            0xf2f2f2, // Pearl White
            0x1a1a1a, // Solid Black
            0x6b7280, // Midnight Silver Metallic
            0xc5c9ce, // Quicksilver
            0x1e3a5f, // Deep Blue Metallic
            0xb91c1c, // Red Multi-Coat
            0x374151, // Stealth Grey
            0x0f172a  // Ultra Blue / dark navy
        ];
        const mainColor = colors[Phaser.Math.Between(0, colors.length - 1)];

        if (type === 'car') this.draw3DCar(g, mainColor, dir);
        else if (type === 'truck') this.draw3DTruck(g, mainColor, dir);
        else if (type === 'motorbike') this.draw3DMotorbike(g, mainColor, dir);

        container.add(g);
        container.speed = speed;
        container.type = type;
        container.carColor = mainColor;
        container.dir = dir;
        container.lane = lane;
        container.carId = 'car_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);

        if (type === 'truck') { container.w = 140; container.h = 45; }
        else if (type === 'motorbike') { container.w = 50; container.h = 20; }
        else { container.w = 90; container.h = 35; }

        this.cars.add(container);
    }

    // Soft shade helpers for layered vehicle paint
    shadeColor(color, amount) {
        const c = Phaser.Display.Color.ValueToColor(color);
        if (amount >= 0) return c.lighten(amount).color;
        return c.darken(Math.abs(amount)).color;
    }

    drawAlloyWheel(g, x, y, w, h) {
        // Tire
        g.fillStyle(0x0a0a0a, 0.95);
        g.fillRoundedRect(x, y, w, h, 3);
        // Rim
        g.fillStyle(0x9ca3af, 0.95);
        g.fillRoundedRect(x + 2, y + 1.5, w - 4, h - 3, 2);
        // Hub
        g.fillStyle(0x374151);
        g.fillRoundedRect(x + w * 0.35, y + 2, w * 0.3, h - 4, 1);
        // Spoke highlight
        g.fillStyle(0xe5e7eb, 0.7);
        g.fillRect(x + 3, y + h * 0.35, w - 6, 1.2);
    }

    draw3DCar(g, color, dir) {
        // Tesla Model 3 / Y inspired top-down EV sedan
        const dark = this.shadeColor(color, -35);
        const mid = this.shadeColor(color, -12);
        const bright = this.shadeColor(color, 22);
        const glass = 0x0c1a28;
        const glassReflect = 0x4a90b8;
        const s = dir; // travel direction (+1 right, -1 left)

        // Soft ground shadow
        g.fillStyle(0x000000, 0.38);
        g.fillEllipse(0, 2, 100, 42);
        g.fillStyle(0x000000, 0.18);
        g.fillEllipse(0, 10, 88, 28);

        // Alloy wheels (partially under body)
        this.drawAlloyWheel(g, -34, -26, 18, 7);
        this.drawAlloyWheel(g, 16, -26, 18, 7);
        this.drawAlloyWheel(g, -34, 19, 18, 7);
        this.drawAlloyWheel(g, 16, 19, 18, 7);

        // Lower body / rocker panel depth
        g.fillStyle(0x111111, 0.9);
        g.fillRoundedRect(-50, -18, 100, 36, 12);

        // Main body shell — long, smooth Tesla silhouette
        g.fillStyle(dark);
        g.fillRoundedRect(-49, -19, 98, 38, 14);
        g.fillStyle(color);
        g.fillRoundedRect(-48, -18, 96, 34, 13);

        // Subtle paint highlight along upper edge (sun reflection)
        g.fillStyle(bright, 0.45);
        g.fillRoundedRect(-42, -17, 84, 5, 3);
        // Side shoulder crease
        g.fillStyle(mid, 0.55);
        g.fillRect(-40, -8, 80, 1.5);
        g.fillRect(-40, 6, 80, 1.5);

        // Front bumper taper (aerodynamic nose)
        const frontX = s === 1 ? 38 : -50;
        g.fillStyle(dark);
        g.fillRoundedRect(frontX, -14, 12, 28, 8);
        g.fillStyle(color);
        g.fillRoundedRect(frontX + (s === 1 ? 1 : 0), -13, 11, 26, 7);

        // Rear bumper
        const rearX = s === 1 ? -50 : 38;
        g.fillStyle(dark);
        g.fillRoundedRect(rearX, -14, 12, 28, 6);

        // Continuous LED headlight bar (Tesla signature)
        const headX = s === 1 ? 46 : -49;
        g.fillStyle(0xffffff, 0.95);
        g.fillRoundedRect(headX, -11, 4, 22, 2);
        g.fillStyle(0xa5f3fc, 0.85);
        g.fillRoundedRect(headX + 0.5, -9, 2.5, 18, 1.5);
        // Glow
        g.fillStyle(0x67e8f9, 0.35);
        g.fillEllipse(headX + 2, 0, 10, 26);

        // Continuous red taillight bar
        const tailX = s === 1 ? -50 : 46;
        g.fillStyle(0x7f1d1d);
        g.fillRoundedRect(tailX, -11, 4, 22, 2);
        g.fillStyle(0xef4444, 0.95);
        g.fillRoundedRect(tailX + 0.5, -9, 2.5, 18, 1.5);
        g.fillStyle(0xfca5a5, 0.4);
        g.fillEllipse(tailX + 2, 0, 8, 22);

        // Panoramic glass roof (Tesla signature)
        g.fillStyle(0x050a10, 0.95);
        g.fillRoundedRect(-18, -13, 42, 26, 7);
        g.fillStyle(glass, 0.92);
        g.fillRoundedRect(-16, -11.5, 38, 23, 6);
        // Glass reflection streak
        g.fillStyle(glassReflect, 0.35);
        g.fillRoundedRect(-12, -10, 12, 20, 4);
        g.fillStyle(0xffffff, 0.12);
        g.fillRoundedRect(-10, -9, 5, 18, 2);

        // Front windshield
        const windX = s === 1 ? 20 : -32;
        g.fillStyle(0x0a1620, 0.95);
        g.fillRoundedRect(windX, -11, 14, 22, 4);
        g.fillStyle(glassReflect, 0.28);
        g.fillRoundedRect(windX + 2, -9, 5, 18, 2);

        // Rear glass
        const rearGlassX = s === 1 ? -30 : 16;
        g.fillStyle(0x0a1620, 0.9);
        g.fillRoundedRect(rearGlassX, -10, 10, 20, 3);
        g.fillStyle(glassReflect, 0.2);
        g.fillRoundedRect(rearGlassX + 1, -8, 4, 16, 2);

        // Door seam lines
        g.lineStyle(1, dark, 0.55);
        g.lineBetween(-4, -16, -4, 16);
        g.lineBetween(10, -16, 10, 16);

        // Flush door handles (minimal Tesla style)
        g.fillStyle(dark, 0.8);
        g.fillRoundedRect(-2, -15.5, 6, 1.5, 1);
        g.fillRoundedRect(-2, 14, 6, 1.5, 1);
        g.fillRoundedRect(12, -15.5, 6, 1.5, 1);
        g.fillRoundedRect(12, 14, 6, 1.5, 1);

        // Side mirrors
        g.fillStyle(dark);
        g.fillRoundedRect(s === 1 ? 22 : -30, -22, 8, 4, 2);
        g.fillRoundedRect(s === 1 ? 22 : -30, 18, 8, 4, 2);
        g.fillStyle(0x1e293b);
        g.fillRoundedRect(s === 1 ? 23 : -29, -21, 5, 2, 1);
        g.fillRoundedRect(s === 1 ? 23 : -29, 19, 5, 2, 1);

        // Hood center crease
        g.fillStyle(bright, 0.25);
        g.fillRect(s === 1 ? 30 : -42, -1, 12, 2);

        // Charge-port hint on rear quarter (subtle)
        g.fillStyle(0x111827, 0.7);
        g.fillCircle(s === 1 ? -38 : 38, -14, 2.2);
        g.fillStyle(0x22c55e, 0.5);
        g.fillCircle(s === 1 ? -38 : 38, -14, 1.1);
    }

    draw3DTruck(g, color, dir) {
        // Modern electric semi (Tesla Semi inspired) + trailer
        const dark = this.shadeColor(color, -40);
        const bright = this.shadeColor(color, 18);
        const s = dir;
        const cabFront = s === 1 ? 68 : -118;
        const trailerX = s === 1 ? -55 : -35;

        // Ground shadow
        g.fillStyle(0x000000, 0.4);
        g.fillEllipse(s === 1 ? 15 : -15, 4, 155, 48);
        g.fillStyle(0x000000, 0.2);
        g.fillEllipse(s === 1 ? 10 : -10, 12, 140, 30);

        // Trailer wheels (dual axles)
        const trailerWheelsX = s === 1 ? [-35, -5, 25] : [-5, 25, 55];
        trailerWheelsX.forEach(wx => {
            this.drawAlloyWheel(g, wx, -30, 20, 9);
            this.drawAlloyWheel(g, wx, 21, 20, 9);
        });
        // Cab wheels
        const cabWheelX = s === 1 ? 78 : -98;
        this.drawAlloyWheel(g, cabWheelX, -28, 20, 9);
        this.drawAlloyWheel(g, cabWheelX, 19, 20, 9);

        // Trailer body — corrugated modern freight box
        g.fillStyle(0x1f2937);
        g.fillRoundedRect(trailerX, -24, 95, 48, 4);
        g.fillStyle(0xd1d5db);
        g.fillRoundedRect(trailerX + 1, -23, 93, 44, 3);
        // Roof highlight
        g.fillStyle(0xf3f4f6, 0.9);
        g.fillRoundedRect(trailerX + 3, -22, 89, 8, 2);
        // Side panel ribs
        g.fillStyle(0x9ca3af, 0.55);
        for (let i = 0; i < 7; i++) {
            const rx = trailerX + 10 + i * 12;
            g.fillRect(rx, -13, 2, 30);
        }
        // Rear doors
        const doorX = s === 1 ? trailerX : trailerX + 88;
        g.fillStyle(0x6b7280);
        g.fillRect(doorX, -20, 6, 38);
        g.fillStyle(0x4b5563);
        g.fillRect(doorX + 2.5, -18, 1, 34);
        // Marker lights along trailer
        g.fillStyle(0xfbbf24, 0.9);
        g.fillCircle(trailerX + 8, -22, 2);
        g.fillCircle(trailerX + 87, -22, 2);
        g.fillCircle(trailerX + 8, 20, 2);
        g.fillCircle(trailerX + 87, 20, 2);

        // Fifth-wheel / hitch
        g.fillStyle(0x374151);
        g.fillRoundedRect(s === 1 ? 38 : -58, -8, 18, 16, 3);

        // Cab — sleek electric semi cabin
        g.fillStyle(0x0a0a0a);
        g.fillRoundedRect(cabFront, -22, 52, 44, 8);
        g.fillStyle(dark);
        g.fillRoundedRect(cabFront + 1, -21, 50, 40, 7);
        g.fillStyle(color);
        g.fillRoundedRect(cabFront + 2, -20, 48, 36, 7);
        // Paint highlight
        g.fillStyle(bright, 0.4);
        g.fillRoundedRect(cabFront + 6, -19, 40, 5, 2);

        // Wraparound windshield (angular Semi style)
        const windX = s === 1 ? cabFront + 30 : cabFront + 4;
        g.fillStyle(0x0c1a28, 0.95);
        g.fillRoundedRect(windX, -16, 16, 32, 5);
        g.fillStyle(0x38bdf8, 0.3);
        g.fillRoundedRect(windX + 2, -13, 6, 26, 3);
        g.fillStyle(0xffffff, 0.12);
        g.fillRoundedRect(windX + 3, -11, 3, 12, 1);

        // Side glass
        g.fillStyle(0x0c1a28, 0.85);
        g.fillRoundedRect(s === 1 ? cabFront + 12 : cabFront + 22, -18, 14, 4, 1);
        g.fillRoundedRect(s === 1 ? cabFront + 12 : cabFront + 22, 14, 14, 4, 1);

        // Continuous LED light bar
        const headX = s === 1 ? cabFront + 48 : cabFront;
        g.fillStyle(0xffffff, 0.95);
        g.fillRoundedRect(headX, -14, 4, 28, 2);
        g.fillStyle(0xa5f3fc, 0.85);
        g.fillRoundedRect(headX + 0.5, -12, 2.5, 24, 1);
        g.fillStyle(0x67e8f9, 0.35);
        g.fillEllipse(headX + 2, 0, 12, 30);

        // Side mirrors (tall truck mirrors)
        g.fillStyle(dark);
        g.fillRoundedRect(s === 1 ? cabFront + 28 : cabFront + 12, -28, 6, 8, 1);
        g.fillRoundedRect(s === 1 ? cabFront + 28 : cabFront + 12, 20, 6, 8, 1);
        g.fillStyle(0x1e293b);
        g.fillRect(s === 1 ? cabFront + 29 : cabFront + 13, -26, 3, 5);
        g.fillRect(s === 1 ? cabFront + 29 : cabFront + 13, 22, 3, 5);

        // Cab door seam
        g.lineStyle(1, dark, 0.5);
        g.lineBetween(cabFront + 22, -18, cabFront + 22, 18);
    }

    draw3DMotorbike(g, color, dir) {
        // Modern electric sport motorcycle, top-down
        const dark = this.shadeColor(color, -30);
        const bright = this.shadeColor(color, 20);
        const s = dir;

        // Shadow
        g.fillStyle(0x000000, 0.32);
        g.fillEllipse(0, 4, 58, 22);
        g.fillStyle(0x000000, 0.15);
        g.fillEllipse(0, 8, 48, 14);

        // Wheels with detailed rims
        const frontWx = s === 1 ? 16 : -26;
        const rearWx = s === 1 ? -26 : 16;
        // Front tire
        g.fillStyle(0x0a0a0a);
        g.fillRoundedRect(frontWx, -5, 12, 10, 4);
        g.fillStyle(0x6b7280);
        g.fillRoundedRect(frontWx + 2.5, -3, 7, 6, 2);
        g.fillStyle(0xd1d5db);
        g.fillCircle(frontWx + 6, 0, 1.8);
        // Rear tire (wider)
        g.fillStyle(0x0a0a0a);
        g.fillRoundedRect(rearWx, -6, 12, 12, 4);
        g.fillStyle(0x6b7280);
        g.fillRoundedRect(rearWx + 2.5, -3.5, 7, 7, 2);
        g.fillStyle(0xd1d5db);
        g.fillCircle(rearWx + 6, 0, 1.8);

        // Swingarm / frame rails
        g.lineStyle(3.5, 0x1f2937, 0.95);
        g.lineBetween(rearWx + 10, 0, frontWx + 2, 0);
        g.lineStyle(2, 0x4b5563, 0.8);
        g.lineBetween(rearWx + 10, -2, 0, -4);
        g.lineBetween(rearWx + 10, 2, 0, 4);

        // Battery pack / underbody (EV look)
        g.fillStyle(0x111827);
        g.fillRoundedRect(-12, -5, 24, 10, 3);

        // Body / fairing
        g.fillStyle(dark);
        g.fillEllipse(0, 0, 30, 14);
        g.fillStyle(color);
        g.fillEllipse(0, 0, 26, 11);
        g.fillStyle(bright, 0.4);
        g.fillEllipse(-2, -2, 14, 4);

        // Seat
        g.fillStyle(0x1f2937);
        g.fillRoundedRect(s === 1 ? -16 : 4, -5, 12, 10, 3);
        g.fillStyle(0x374151);
        g.fillRoundedRect(s === 1 ? -14 : 6, -3.5, 8, 7, 2);

        // Rider — helmet + jacket + arms
        g.fillStyle(0x1e293b);
        g.fillEllipse(s === 1 ? -4 : 4, 0, 14, 12); // torso
        // Helmet
        g.fillStyle(0x0f172a);
        g.fillCircle(s === 1 ? 2 : -2, 0, 7);
        g.fillStyle(0x334155);
        g.fillCircle(s === 1 ? 2 : -2, 0, 5.5);
        // Visor
        g.fillStyle(0x22d3ee, 0.55);
        g.fillEllipse(s === 1 ? 4 : -4, 0, 5, 7);
        g.fillStyle(0xffffff, 0.2);
        g.fillEllipse(s === 1 ? 3 : -3, -1.5, 2, 3);
        // Arms to bars
        g.fillStyle(0x1e293b);
        g.fillRoundedRect(s === 1 ? 4 : -12, -9, 10, 3.5, 1.5);
        g.fillRoundedRect(s === 1 ? 4 : -12, 5.5, 10, 3.5, 1.5);
        // Gloves
        g.fillStyle(0x0f172a);
        g.fillCircle(s === 1 ? 14 : -14, -7, 2.5);
        g.fillCircle(s === 1 ? 14 : -14, 7, 2.5);

        // Handlebars
        g.lineStyle(2.5, 0x6b7280);
        g.lineBetween(s === 1 ? 12 : -12, -10, s === 1 ? 12 : -12, 10);
        g.fillStyle(0x9ca3af);
        g.fillCircle(s === 1 ? 12 : -12, -10, 2);
        g.fillCircle(s === 1 ? 12 : -12, 10, 2);

        // Front fairing / LED headlight
        g.fillStyle(dark);
        g.fillRoundedRect(s === 1 ? 20 : -28, -6, 8, 12, 3);
        g.fillStyle(color);
        g.fillRoundedRect(s === 1 ? 21 : -27, -5, 6, 10, 2);
        g.fillStyle(0xffffff, 0.95);
        g.fillCircle(s === 1 ? 26 : -26, 0, 3.5);
        g.fillStyle(0xa5f3fc, 0.8);
        g.fillCircle(s === 1 ? 26 : -26, 0, 2.2);
        g.fillStyle(0x67e8f9, 0.3);
        g.fillEllipse(s === 1 ? 28 : -28, 0, 10, 12);

        // Tail light
        g.fillStyle(0xef4444, 0.9);
        g.fillRoundedRect(s === 1 ? -28 : 22, -3, 4, 6, 1.5);
        g.fillStyle(0xfca5a5, 0.45);
        g.fillEllipse(s === 1 ? -26 : 24, 0, 6, 8);
    }

    spawnNewt() {
        if (this.gameOver) return;
        const fromTop = Math.random() < 0.5;
        const x = Phaser.Math.Between(60, this.scale.width - 60);
        const y = fromTop ? this.topSafe - 25 : this.botSafe + 25;
        const newt = this.add.image(x, y, 'newt');
        newt.setDisplaySize(GAME_CONFIG.NEWT_SIZE, GAME_CONFIG.NEWT_SIZE);
        newt.setDepth(25);
        newt.dir = fromTop ? 1 : -1;
        newt.dest = fromTop ? 'LAKE' : 'FOREST';
        newt.isCarried = false;
        newt.newtId = 'newt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
        newt.rotation = newt.dir === 1 ? Math.PI / 2 : -Math.PI / 2;
        this.newts.add(newt);
        // Note: Newts are synced via game_state broadcast, no need for individual spawn events
    }

    updateNewts(delta) {
        this.newts.getChildren().forEach(newt => {
            if (!newt.isCarried) {
                newt.y += newt.dir * GAME_CONFIG.NEWT_SPEED * (delta / 1000);
                if (!this.isCompact) {
                    newt.rotation = (newt.dir === 1 ? Math.PI / 2 : -Math.PI / 2) + Math.sin(this.time.now * 0.01) * 0.15;
                } else {
                    newt.rotation = newt.dir === 1 ? Math.PI / 2 : -Math.PI / 2;
                }
                if ((newt.dir === 1 && newt.y > this.botSafe + 30) || (newt.dir === -1 && newt.y < this.topSafe - 30)) { newt.destroy(); }
            } else if (!this.isMultiplayer || newt.carriedBy === playerId) {
                const idx = this.player.carried.indexOf(newt);
                if (idx === -1) {
                    newt.isCarried = false;
                    newt.carriedBy = null;
                    return;
                }
                newt.x = this.player.x + (idx === 0 ? -25 : 25);
                newt.y = this.player.y - 15;
                newt.setDepth(55);
                if (!this.isCompact) {
                    newt.rotation = Math.sin(this.time.now * 0.008) * 0.2;
                } else {
                    newt.rotation = 0;
                }
            }
        });
        
        if (this.isMultiplayer && this.remotePlayer && this.remotePlayer.carried) {
            this.remotePlayer.carried = this.remotePlayer.carried.filter(n => n && n.active && n.isCarried);
        }
    }

    checkCollisions() {
        if (this.gameOver) return;
        this.cars.getChildren().forEach(car => {
            if (!this.player.invincible && Math.abs(this.player.x - car.x) < car.w / 2 && Math.abs(this.player.y - car.y) < car.h / 2) {
                if (!this.isMultiplayer || isHost) {
                    this.hitPlayer();
                } else {
                    this.requestPlayerHit();
                }
            }
            if (!this.isMultiplayer || isHost) {
                this.newts.getChildren().forEach(newt => {
                    if (!newt.isCarried && Math.abs(newt.x - car.x) < car.w / 2 && Math.abs(newt.y - car.y) < car.h / 2) { this.splatterNewt(newt); }
                });
            }
        });
        this.newts.getChildren().forEach(newt => {
            if (!newt.isCarried && !newt.carriedBy && this.player.carried.length < this.player.carryCapacity) {
                const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, newt.x, newt.y);
                if (dist < 50) {
                    // In multiplayer, check remote player hasn't already claimed this newt
                    if (this.isMultiplayer && this.remotePlayer && this.remotePlayer.carried) {
                        if (this.remotePlayer.carried.some(n => n && n.newtId === newt.newtId)) return;
                    }
                    newt.isCarried = true;
                    newt.carriedBy = playerId || 'local'; // Use playerId for multiplayer sync
                    this.player.carried.push(newt);
                    this.createPickupEffect(newt.x, newt.y);
                    this.updateHUD();
                    
                    if (this.isMultiplayer) {
                        this.sendMultiplayerMessage('newt_pickup', {
                            playerId: playerId,
                            newtId: newt.newtId
                        });
                    }
                }
            }
        });
        if (this.player.carried.length > 0) {
            const inForest = this.player.y < this.topSafe;
            const inLake = this.player.y > this.botSafe;
            if (inForest || inLake) {
                this.player.carried.forEach(newt => {
                    const correct = (newt.dest === 'FOREST' && inForest) || (newt.dest === 'LAKE' && inLake);
                    if (correct) {
                        this.streak++;
                        if (this.streak > this.maxStreak) this.maxStreak = this.streak;
                        
                        if (this.isMultiplayer) {
                            if (isHost) {
                                this.teamScore += 100;
                                this.saved++;
                            }
                        } else {
                            this.score += 100;
                            this.saved++;
                        }
                        
                        if (this.cache.audio.exists('sfx_saved')) this.sound.play('sfx_saved', { volume: 0.6 });
                        
                        if (navigator.vibrate) navigator.vibrate(30);
                        
                        this.createSuccessEffect(newt.x, newt.y);
                        this.checkAchievements();
                        this.updateDifficulty();
                        
                        if (this.isMultiplayer) {
                            this.sendMultiplayerMessage('newt_save', {
                                playerId: playerId,
                                newtId: newt.newtId,
                                correct: true,
                                x: newt.x,
                                y: newt.y
                            });
                        }
                    }
                    newt.destroy();
                });
                this.player.carried = [];
                this.updateHUD();
            }
        }
    }



    hitPlayer() {
        this.applyHitEffects(true);
    }

    splatterNewt(newt) {
        this.lost++;
        this.streak = 0; // Reset streak when newt is lost
        this.achievements.perfectStart = false;
        if (this.isMultiplayer) {
            this.teamScore = Math.max(0, this.teamScore - 10);
        } else {
            this.score = Math.max(0, this.score - 10);
        }
        this.showFloatingText(newt.x, newt.y, '-10', '#ff0000', true);
        if (this.cache.audio.exists('sfx_hit')) this.sound.play('sfx_hit', { volume: 0.7 });
        
        // Light haptic feedback for newt lost
        if (navigator.vibrate) navigator.vibrate(50);
        
        this.updateHUD();

        for (let i = 0; i < 10; i++) {
            const p = this.add.circle(newt.x, newt.y, Phaser.Math.Between(3, 6), 0xff3366, 0.8);
            this.tweens.add({
                targets: p, x: newt.x + Phaser.Math.Between(-40, 40), y: newt.y + Phaser.Math.Between(-40, 40),
                alpha: 0, scale: 0.3, duration: 500 + Math.random() * 300, onComplete: () => p.destroy()
            });
        }
        newt.destroy();
    }

    createSuccessEffect(x, y) {
        // More prominent floating text for saving newts
        this.showFloatingText(x, y, '+100 PTS', '#00ff00', true);

        // Show streak if active
        if (this.streak > 1) {
            this.time.delayedCall(200, () => {
                this.showFloatingText(x, y - 40, `${this.streak}x STREAK!`, '#ffff00', false);
            });
        }

        // Visual pulse ring effect
        const ring = this.add.circle(x, y, 20, 0x00ff88, 0.6).setDepth(100);
        this.tweens.add({
            targets: ring,
            scale: 3,
            alpha: 0,
            duration: 500,
            ease: 'Power2',
            onComplete: () => ring.destroy()
        });

        // Particle burst
        for (let i = 0; i < 12; i++) {
            const star = this.add.star(x, y, 5, 4, 8, 0x00ff88);
            star.setAlpha(0.9);
            this.tweens.add({
                targets: star, x: x + Phaser.Math.Between(-50, 50), y: y - Phaser.Math.Between(30, 80),
                rotation: 2, alpha: 0, scale: 0.4, duration: 600 + Math.random() * 400, onComplete: () => star.destroy()
            });
        }
    }

    checkAchievements() {
        // First save achievement
        if (!this.achievements.firstSave && this.saved === 1) {
            this.achievements.firstSave = true;
            this.showAchievement('FIRST RESCUE!', 'You saved your first newt!', 'fa-frog');
        }

        // Streak achievements
        if (!this.achievements.streak5 && this.streak >= 5) {
            this.achievements.streak5 = true;
            this.showAchievement('5x STREAK!', 'On fire!', 'fa-fire');
        }
        if (!this.achievements.streak10 && this.streak >= 10) {
            this.achievements.streak10 = true;
            this.showAchievement('10x STREAK!', 'Unstoppable!', 'fa-bolt');
            if (navigator.vibrate) navigator.vibrate([50, 30, 50, 30, 50]);
        }
        if (!this.achievements.streak20 && this.streak >= 20) {
            this.achievements.streak20 = true;
            this.showAchievement('20x STREAK!', 'LEGENDARY!', 'fa-trophy');
            if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 100]);
        }

        // Total saved achievements
        if (!this.achievements.saved10 && this.saved >= 10) {
            this.achievements.saved10 = true;
            this.showAchievement('10 NEWTS SAVED!', 'Great progress!', 'fa-leaf');
        }
        if (!this.achievements.saved25 && this.saved >= 25) {
            this.achievements.saved25 = true;
            this.showAchievement('25 NEWTS SAVED!', 'Conservation hero!', 'fa-star');
        }
        if (!this.achievements.saved50 && this.saved >= 50) {
            this.achievements.saved50 = true;
            this.showAchievement('50 NEWTS SAVED!', 'Newt whisperer!', 'fa-crown');
            if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 100]);
        }

        // Score achievements
        if (!this.achievements.score500 && this.score >= 500) {
            this.achievements.score500 = true;
            this.showAchievement('500 POINTS!', 'Nice score!', 'fa-coins');
        }
        if (!this.achievements.score1000 && this.score >= 1000) {
            this.achievements.score1000 = true;
            this.showAchievement('1000 POINTS!', 'Pro player!', 'fa-bullseye');
        }
    }

    showAchievement(title, subtitle, iconClass = 'fa-award') {
        const { width, height } = this.scale;
        const isCompact = this.isCompact;

        // Achievement banner container
        const bannerY = isCompact ? 100 : 120;
        const bannerW = isCompact ? 280 : 340;
        const bannerH = isCompact ? 70 : 80;

        // Create DOM element for achievement banner with Font Awesome icon
        const canvas = this.game.canvas;
        const canvasRect = canvas.getBoundingClientRect();
        
        const banner = document.createElement('div');
        banner.className = 'achievement-banner';
        banner.innerHTML = `
            <div class="achievement-icon"><i class="fas ${iconClass}"></i></div>
            <div class="achievement-content">
                <div class="achievement-title">${title}</div>
                <div class="achievement-subtitle">${subtitle}</div>
            </div>
        `;
        
        // Style the banner
        banner.style.cssText = `
            position: absolute;
            left: ${canvasRect.left + (width - bannerW) / 2}px;
            top: ${canvasRect.top + bannerY - bannerH / 2}px;
            width: ${bannerW}px;
            height: ${bannerH}px;
            background: rgba(0, 0, 0, 0.9);
            border: 3px solid #ffcc00;
            border-radius: 12px;
            display: flex;
            align-items: center;
            padding: 0 ${isCompact ? 12 : 16}px;
            gap: ${isCompact ? 10 : 14}px;
            z-index: 2000;
            opacity: 0;
            transform: translateY(10px) scale(0.95);
            transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
            box-shadow: 0 4px 20px rgba(255, 204, 0, 0.3);
            font-family: 'Fredoka', sans-serif;
            pointer-events: none;
        `;
        
        // Style the icon
        const iconEl = banner.querySelector('.achievement-icon');
        iconEl.style.cssText = `
            font-size: ${isCompact ? 28 : 34}px;
            color: #ffcc00;
            text-shadow: 0 0 10px rgba(255, 204, 0, 0.5);
            min-width: ${isCompact ? 40 : 48}px;
            text-align: center;
        `;
        
        // Style the content
        const contentEl = banner.querySelector('.achievement-content');
        contentEl.style.cssText = `
            flex: 1;
        `;
        
        // Style the title
        const titleEl = banner.querySelector('.achievement-title');
        titleEl.style.cssText = `
            font-size: ${isCompact ? 18 : 22}px;
            font-weight: 600;
            color: #ffcc00;
            text-shadow: 1px 1px 2px #000;
            line-height: 1.2;
        `;
        
        // Style the subtitle
        const subtitleEl = banner.querySelector('.achievement-subtitle');
        subtitleEl.style.cssText = `
            font-size: ${isCompact ? 13 : 15}px;
            color: #ffffff;
            text-shadow: 1px 1px 1px #000;
            line-height: 1.2;
        `;
        
        document.body.appendChild(banner);
        
        // Animate in
        requestAnimationFrame(() => {
            banner.style.opacity = '1';
            banner.style.transform = 'translateY(0) scale(1)';
        });
        
        // Animate out and remove after delay
        setTimeout(() => {
            banner.style.opacity = '0';
            banner.style.transform = 'translateY(-20px) scale(0.95)';
            setTimeout(() => {
                if (banner.parentNode) {
                    banner.parentNode.removeChild(banner);
                }
            }, 400);
        }, 2500);

        // Sparkle effect around the banner (using Phaser graphics)
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const sparkX = width / 2 + Math.cos(angle) * (bannerW / 2 + 20);
            const sparkY = bannerY + Math.sin(angle) * (bannerH / 2 + 10);
            const spark = this.add.star(sparkX, sparkY, 4, 3, 6, 0xffcc00).setDepth(200).setAlpha(0);

            this.tweens.add({
                targets: spark,
                alpha: 1,
                scale: 1.5,
                duration: 200,
                delay: i * 50,
                yoyo: true,
                onComplete: () => spark.destroy()
            });
        }
    }

    createPickupEffect(x, y) {
        // Pickup sparkle effect when collecting a newt
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const spark = this.add.circle(x, y, 4, 0x00ffff, 0.9).setDepth(60);
            this.tweens.add({
                targets: spark,
                x: x + Math.cos(angle) * 40,
                y: y + Math.sin(angle) * 40,
                alpha: 0,
                scale: 0.3,
                duration: 400,
                ease: 'Power2',
                onComplete: () => spark.destroy()
            });
        }

        // Quick flash on player
        const flash = this.add.circle(this.player.x, this.player.y, 50, 0x00ffff, 0.3).setDepth(49);
        this.tweens.add({
            targets: flash,
            scale: 1.5,
            alpha: 0,
            duration: 300,
            onComplete: () => flash.destroy()
        });

        // "PICKED UP!" mini text
        const pickupText = this.add.text(x, y - 20, 'PICKED UP!', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: '16px',
            color: '#00ffff',
            stroke: '#000000',
            strokeThickness: 2
        }).setOrigin(0.5).setDepth(100);

        this.tweens.add({
            targets: pickupText,
            y: y - 50,
            alpha: 0,
            duration: 600,
            onComplete: () => pickupText.destroy()
        });
    }

    showFloatingText(x, y, message, color, isLarge = false) {
        const fontSize = isLarge ? '32px' : '24px';
        const text = this.add.text(x, y, message, {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: fontSize,
            color: color,
            stroke: '#000',
            strokeThickness: isLarge ? 5 : 3,
            shadow: isLarge ? { offsetX: 2, offsetY: 2, color: '#000000', blur: 4, fill: true } : null
        }).setOrigin(0.5).setDepth(150);

        // Scale up animation for large text
        if (isLarge) {
            text.setScale(0.5);
            this.tweens.add({
                targets: text,
                scale: 1.2,
                duration: 150,
                yoyo: true,
                ease: 'Back.easeOut'
            });
        }

        this.tweens.add({
            targets: text,
            y: y - 60,
            alpha: 0,
            duration: 1200,
            onComplete: () => text.destroy()
        });
    }

    async showGameOver() {
        if (this.rainBgm) {
            this.rainBgm.stop();
            this.rainBgm.destroy();
            this.rainBgm = null;
        }
        // Cleanup multiplayer
        if (this.isMultiplayer) {
            // Broadcast game over to partner (not disconnect)
            this.broadcastGameOver();
            if (this.broadcastTimer) this.broadcastTimer.destroy();
            if (this.gameStateBroadcastTimer) this.gameStateBroadcastTimer.destroy();
            if (this.disconnectCheckTimer) this.disconnectCheckTimer.destroy();
        }

        if (this.cache.audio.exists('bgm_end')) {
            this.bgmEnd = this.sound.add('bgm_end', { volume: 0.6, loop: true });
            this.bgmEnd.play();
        }

        // Ensure cleanup when the scene is restarted or shut down
        this.events.once('shutdown', () => {
            if (this.bgmEnd) {
                this.bgmEnd.stop();
                this.bgmEnd.destroy();
            }
            if (this.rainBgm) {
                this.rainBgm.stop();
                this.rainBgm.destroy();
                this.rainBgm = null;
            }
            if (this.isMultiplayer) {
                cleanupMultiplayerState();
            }
        });

        const { width, height } = this.scale;
        const isCompact = this.isCompact;

        // Use team score in multiplayer
        const finalScore = this.isMultiplayer ? this.teamScore : this.score;

        // Determine the display name for score submission
        let displayName = playerName || 'Anonymous';
        if (this.isMultiplayer && this.partnerName) {
            displayName = `${playerName} & ${this.partnerName}`;
        }

        // Auto-submit score immediately
        let submitSuccess = false;
        if (supabaseClient) {
            if (this.isMultiplayer) {
                // Only host submits to avoid duplicates
                if (isHost) {
                    submitSuccess = await submitScore(displayName, finalScore, true);
                } else {
                    submitSuccess = true; // Guest trusts host submitted
                }
            } else {
                submitSuccess = await submitScore(displayName, finalScore, false);
            }
        }

        // --- OVERLAY ---
        this.add.rectangle(0, 0, width, height, 0x000000, 0.92).setOrigin(0).setDepth(300);
        this.add.text(width / 2, height * 0.06, 'GAME OVER', {
            fontFamily: 'Fredoka, sans-serif', fontSize: isCompact ? '36px' : '44px', color: '#ff3366', fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(301);

        const scoreLabel = this.isMultiplayer ? 'TEAM SCORE' : 'FINAL SCORE';
        this.add.text(width / 2, height * 0.13, `${scoreLabel}: ${finalScore}`, {
            fontFamily: 'Fredoka, sans-serif', fontSize: isCompact ? '22px' : '26px', color: '#ffffff'
        }).setOrigin(0.5).setDepth(301);

        // --- RUN SUMMARY ---
        const runSeconds = Math.max(0, (this.time.now - this.runStartTime) / 1000);
        const formatTime = seconds => {
            const mins = Math.floor(seconds / 60);
            const secs = Math.floor(seconds % 60);
            return `${mins}:${secs.toString().padStart(2, '0')}`;
        };
        const totalNewts = this.saved + this.lost;
        const rescueRate = totalNewts > 0 ? Math.round((this.saved / totalNewts) * 100) : 0;

        const summaryTitleY = height * 0.18;
        const summaryTitle = this.isMultiplayer ? 'TEAM SUMMARY' : 'RUN SUMMARY';
        this.add.text(width / 2, summaryTitleY, summaryTitle, {
            fontFamily: 'Outfit, sans-serif',
            fontSize: isCompact ? '12px' : '14px',
            color: '#aaaaaa',
            letterSpacing: 1
        }).setOrigin(0.5).setDepth(301);

        const summaryLines = [
            { label: 'Time Survived', value: formatTime(runSeconds) },
            { label: 'Newts Saved', value: `${this.saved}` },
            { label: 'Newts Lost', value: `${this.lost}` },
            { label: 'Rescue Rate', value: `${rescueRate}%` },
            { label: 'Max Streak', value: `${this.maxStreak}x` }
        ];

        const summaryFont = isCompact ? 12 : 14;
        const lineHeight = isCompact ? 16 : 20;
        const summaryPadX = isCompact ? 12 : 16;
        const summaryPadY = isCompact ? 8 : 10;
        const summaryBoxWidth = Math.min(width * 0.78, isCompact ? 300 : 360);
        const summaryBoxHeight = lineHeight * summaryLines.length + summaryPadY * 2;
        const summaryBoxY = summaryTitleY + (isCompact ? 14 : 16) + summaryBoxHeight / 2;

        const summaryBg = this.add.graphics().setDepth(301);
        summaryBg.fillStyle(0x000000, 0.6);
        summaryBg.fillRoundedRect(width / 2 - summaryBoxWidth / 2, summaryBoxY - summaryBoxHeight / 2, summaryBoxWidth, summaryBoxHeight, 10);
        summaryBg.lineStyle(2, this.isMultiplayer ? 0x00ccff : 0x00ffff, 0.6);
        summaryBg.strokeRoundedRect(width / 2 - summaryBoxWidth / 2, summaryBoxY - summaryBoxHeight / 2, summaryBoxWidth, summaryBoxHeight, 10);

        const labelText = summaryLines.map(line => line.label).join('\n');
        const valueText = summaryLines.map(line => line.value).join('\n');

        this.add.text(width / 2 - summaryBoxWidth / 2 + summaryPadX, summaryBoxY - summaryBoxHeight / 2 + summaryPadY, labelText, {
            fontFamily: 'Outfit, sans-serif',
            fontSize: `${summaryFont}px`,
            color: '#cccccc',
            lineSpacing: isCompact ? 2 : 4
        }).setOrigin(0, 0).setDepth(302);

        this.add.text(width / 2 + summaryBoxWidth / 2 - summaryPadX, summaryBoxY - summaryBoxHeight / 2 + summaryPadY, valueText, {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: `${summaryFont}px`,
            color: '#ffffff',
            align: 'right',
            lineSpacing: isCompact ? 2 : 4
        }).setOrigin(1, 0).setDepth(302);

        // --- LEADERBOARD WITH RANK HIGHLIGHT ---
        const leaderboardStartY = summaryBoxY + summaryBoxHeight / 2 + (isCompact ? 14 : 20);
        await this.showGameOverLeaderboard(width, height, isCompact, leaderboardStartY, finalScore, displayName, submitSuccess);

        // --- DID YOU KNOW? REAL-TIME ALMA BRIDGE FACT CARD ---
        const factData = getRandomNewtFact();
        const factCardY = Math.min(height * 0.77, leaderboardStartY + (isCompact ? 150 : 180));
        const factCardW = Math.min(width * 0.86, isCompact ? 320 : 380);
        const factCardH = isCompact ? 38 : 46;

        const factCardBg = this.add.graphics().setDepth(301);
        factCardBg.fillStyle(0x061e24, 0.95);
        factCardBg.fillRoundedRect(width / 2 - factCardW / 2, factCardY - factCardH / 2, factCardW, factCardH, 8);
        factCardBg.lineStyle(1.5, 0x00ff88, 0.8);
        factCardBg.strokeRoundedRect(width / 2 - factCardW / 2, factCardY - factCardH / 2, factCardW, factCardH, 8);

        const factIcon = this.add.graphics().setDepth(302);
        Icons.drawBulb(factIcon, width / 2 - factCardW / 2 + (isCompact ? 18 : 22), factCardY, isCompact ? 16 : 18, 0xffcc00);

        const factTextContent = isCompact
            ? `DID YOU KNOW? ${factData.stat}`
            : `DID YOU KNOW? ${factData.title} · Tap for more`;

        const factCardText = this.add.text(width / 2 + (isCompact ? 8 : 10), factCardY, factTextContent, {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: isCompact ? '11px' : '13px',
            color: '#aaffdd'
        }).setOrigin(0.5).setDepth(302);

        const factCardHit = this.add.rectangle(width / 2, factCardY, factCardW, factCardH, 0x000000, 0)
            .setDepth(303)
            .setInteractive({ useHandCursor: true });

        factCardHit.on('pointerover', () => {
            factCardBg.clear();
            factCardBg.fillStyle(0x0c313b, 1);
            factCardBg.fillRoundedRect(width / 2 - factCardW / 2, factCardY - factCardH / 2, factCardW, factCardH, 8);
            factCardBg.lineStyle(2, 0x00ffff, 1);
            factCardBg.strokeRoundedRect(width / 2 - factCardW / 2, factCardY - factCardH / 2, factCardW, factCardH, 8);
            factCardText.setColor('#00ffff');
        });
        factCardHit.on('pointerout', () => {
            factCardBg.clear();
            factCardBg.fillStyle(0x061e24, 0.95);
            factCardBg.fillRoundedRect(width / 2 - factCardW / 2, factCardY - factCardH / 2, factCardW, factCardH, 8);
            factCardBg.lineStyle(1.5, 0x00ff88, 0.8);
            factCardBg.strokeRoundedRect(width / 2 - factCardW / 2, factCardY - factCardH / 2, factCardW, factCardH, 8);
            factCardText.setColor('#aaffdd');
        });
        factCardHit.on('pointerdown', () => {
            showNewtFactModal(this);
        });

        // --- VOLUNTEER LINK ---
        const volunteerY = Math.min(height * 0.85, factCardY + (isCompact ? 44 : 52));
        const volunteerBg = this.add.rectangle(width / 2, volunteerY, width * 0.82, isCompact ? 40 : 48, 0x004422, 0.9).setStrokeStyle(2, 0x00ff88).setOrigin(0.5).setDepth(301);
        this.add.text(width / 2, volunteerY - (isCompact ? 6 : 8), 'Want to help real newts?', { fontFamily: 'Fredoka, sans-serif', fontSize: isCompact ? '12px' : '14px', color: '#ffffff' }).setOrigin(0.5).setDepth(302);
        const volunteerLink = this.add.text(width / 2 + 10, volunteerY + (isCompact ? 8 : 10), 'Volunteer at bioblitz.club/newts', { fontFamily: 'Fredoka, sans-serif', fontSize: isCompact ? '13px' : '15px', color: '#00ff88', fontStyle: 'bold' }).setOrigin(0.5).setDepth(302).setInteractive({ useHandCursor: true });
        const volunteerIcon = this.add.graphics().setDepth(303);
        Icons.drawExternalLink(volunteerIcon, volunteerLink.x - volunteerLink.width / 2 - 18, volunteerY + (isCompact ? 8 : 10), 14, 0x00ff88);
        volunteerLink.on('pointerdown', () => { window.open('https://bioblitz.club/newts', '_blank'); });

        // --- TRY AGAIN & QUIT BUTTONS ---
        const retryY = Math.min(height * 0.94, volunteerY + (isCompact ? 42 : 52));
        const btnSpacing = isCompact ? 75 : 95;

        // Try Again Button
        const retryBtnText = this.add.text(width / 2 - btnSpacing + 10, retryY, 'TRY AGAIN', {
            fontFamily: 'Fredoka, sans-serif', fontSize: isCompact ? '16px' : '20px', color: '#00ffff', backgroundColor: '#222', padding: { left: 35, right: 15, top: 8, bottom: 8 }
        }).setOrigin(0.5).setDepth(301).setInteractive({ useHandCursor: true });
        const retryIcon = this.add.graphics().setDepth(302);
        Icons.drawRefresh(retryIcon, retryBtnText.x - retryBtnText.width / 2 + 18, retryY, 18, 0x00ffff);
        retryBtnText.on('pointerdown', () => {
            if (this.isMultiplayer) {
                cleanupMultiplayerState();
                this.scene.start('ModeSelectScene');
            } else {
                this.scene.restart();
            }
        });

        // Quit Button (returns to ModeSelectScene or SplashScene)
        const quitGameBtnText = this.add.text(width / 2 + btnSpacing, retryY, 'QUIT', {
            fontFamily: 'Fredoka, sans-serif', fontSize: isCompact ? '16px' : '20px', color: '#ff6666', backgroundColor: '#330000', padding: { left: 20, right: 20, top: 8, bottom: 8 }
        }).setOrigin(0.5).setDepth(301).setInteractive({ useHandCursor: true });
        quitGameBtnText.on('pointerdown', () => {
            if (this.isMultiplayer) {
                cleanupMultiplayerState();
            }
            this.scene.start('ModeSelectScene');
        });
    }

    async showGameOverLeaderboard(width, height, isCompact, startY, playerScore, displayName, submitted) {
        const boxWidth = Math.min(width * 0.85, isCompact ? 320 : 380);
        const headerY = startY;

        // Header
        const trophyIcon = this.add.graphics().setDepth(301);
        Icons.drawTrophy(trophyIcon, width / 2 - (isCompact ? 65 : 75), headerY, isCompact ? 16 : 18, 0xffcc00);
        this.add.text(width / 2 + 5, headerY, 'LEADERBOARD', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: isCompact ? '15px' : '18px',
            color: '#ffcc00'
        }).setOrigin(0.5).setDepth(301);

        if (!supabaseClient || !submitted) {
            const msg = !supabaseClient ? 'Leaderboard not available' : 'Could not save score';
            this.add.text(width / 2, headerY + 30, msg, {
                fontFamily: 'Outfit, sans-serif', fontSize: '13px', color: '#666'
            }).setOrigin(0.5).setDepth(301);
            return;
        }

        // Fetch fresh leaderboard after our score was submitted
        const scores = await getLeaderboard();
        const entryHeight = isCompact ? 24 : 28;
        const entryFont = isCompact ? 13 : 15;
        const entriesStartY = headerY + (isCompact ? 22 : 28);

        if (scores.length === 0) {
            this.add.text(width / 2, entriesStartY + 10, 'You set the first high score!', {
                fontFamily: 'Outfit, sans-serif', fontSize: '14px', color: '#00ff88'
            }).setOrigin(0.5).setDepth(301);
            return;
        }

        // Find if player made it into top 5
        let playerRankInTop5 = -1;
        for (let i = 0; i < scores.length; i++) {
            if (scores[i].player_name === displayName && scores[i].score === playerScore) {
                playerRankInTop5 = i;
                break;
            }
        }

        // Draw leaderboard box background
        const lbBoxHeight = entryHeight * scores.length + 16;
        const lbBg = this.add.graphics().setDepth(301);
        lbBg.fillStyle(0x000000, 0.5);
        lbBg.fillRoundedRect(width / 2 - boxWidth / 2, entriesStartY - 6, boxWidth, lbBoxHeight, 8);

        // Render each score entry
        scores.forEach((s, i) => {
            const y = entriesStartY + (i * entryHeight) + 4;
            const isPlayer = (i === playerRankInTop5);
            const medal = i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : `${i + 1}th`;
            const medalColors = ['#ffd700', '#c0c0c0', '#cd7f32', '#888888', '#888888'];

            // Highlight row for the player
            if (isPlayer) {
                const rowBg = this.add.graphics().setDepth(301);
                rowBg.fillStyle(0x00ffff, 0.12);
                rowBg.fillRoundedRect(width / 2 - boxWidth / 2 + 4, y - 4, boxWidth - 8, entryHeight - 2, 4);
                rowBg.lineStyle(1, 0x00ffff, 0.5);
                rowBg.strokeRoundedRect(width / 2 - boxWidth / 2 + 4, y - 4, boxWidth - 8, entryHeight - 2, 4);
            }

            // Rank medal
            this.add.text(width / 2 - boxWidth / 2 + 16, y, medal, {
                fontFamily: 'Fredoka, sans-serif',
                fontSize: `${entryFont}px`,
                color: medalColors[i] || '#888888',
                fontStyle: isPlayer ? 'bold' : 'normal'
            }).setOrigin(0, 0).setDepth(302);

            // Player name
            const nameColor = isPlayer ? '#00ffff' : '#ffffff';
            const nameStr = s.player_name.length > 12 ? s.player_name.substring(0, 11) + '..' : s.player_name;
            this.add.text(width / 2 - boxWidth / 2 + 56, y, nameStr, {
                fontFamily: 'Outfit, sans-serif',
                fontSize: `${entryFont}px`,
                color: nameColor,
                fontStyle: isPlayer ? 'bold' : 'normal'
            }).setOrigin(0, 0).setDepth(302);

            // Score
            this.add.text(width / 2 + boxWidth / 2 - 16, y, `${s.score}`, {
                fontFamily: 'Fredoka, sans-serif',
                fontSize: `${entryFont}px`,
                color: isPlayer ? '#00ffff' : '#aaaaaa',
                fontStyle: isPlayer ? 'bold' : 'normal'
            }).setOrigin(1, 0).setDepth(302);

            // "YOU" tag
            if (isPlayer) {
                this.add.text(width / 2 + boxWidth / 2 - 16, y - (isCompact ? 10 : 12), 'YOU', {
                    fontFamily: 'Fredoka, sans-serif',
                    fontSize: '9px',
                    color: '#00ffff',
                    backgroundColor: 'rgba(0,255,255,0.15)',
                    padding: { left: 4, right: 4, top: 1, bottom: 1 }
                }).setOrigin(1, 0).setDepth(303);
            }
        });

        // Result message below leaderboard
        const messageY = entriesStartY + lbBoxHeight + (isCompact ? 6 : 10);
        if (playerRankInTop5 >= 0) {
            // Player made it to top 5
            const rankWord = playerRankInTop5 === 0 ? '1st' : playerRankInTop5 === 1 ? '2nd' : playerRankInTop5 === 2 ? '3rd' : `${playerRankInTop5 + 1}th`;
            const celebMsg = playerRankInTop5 === 0 ? 'NEW HIGH SCORE!' : `You made ${rankWord} place!`;
            const celebColor = playerRankInTop5 === 0 ? '#ffd700' : '#00ff88';
            this.add.text(width / 2, messageY, celebMsg, {
                fontFamily: 'Fredoka, sans-serif',
                fontSize: isCompact ? '15px' : '18px',
                color: celebColor,
                fontStyle: 'bold'
            }).setOrigin(0.5).setDepth(301);
        } else {
            // Player didn't make top 5 - show their score context
            const lowestTop5 = scores.length >= 5 ? scores[4].score : 0;
            const diff = lowestTop5 - playerScore;
            let missMsg = '';
            if (scores.length >= 5 && diff > 0) {
                missMsg = `${diff} points away from top 5 — keep going!`;
            } else {
                missMsg = 'Score saved! Keep playing to climb higher!';
            }
            this.add.text(width / 2, messageY, missMsg, {
                fontFamily: 'Outfit, sans-serif',
                fontSize: isCompact ? '12px' : '14px',
                color: '#aaaaaa'
            }).setOrigin(0.5).setDepth(301);
        }
    }

    confirmQuitGame() {
        if (this.quitModalContainer) return;

        const { width, height } = this.scale;
        const isCompact = this.isCompact;

        // Container overlay with high depth
        const container = this.add.container(0, 0).setDepth(400);
        this.quitModalContainer = container;

        // Dark dim backdrop
        const backdrop = this.add.rectangle(0, 0, width, height, 0x000000, 0.75)
            .setOrigin(0)
            .setInteractive(); // Blocks input underneath

        // Modal box
        const boxW = Math.min(width * 0.85, isCompact ? 280 : 340);
        const boxH = isCompact ? 160 : 180;
        const boxBg = this.add.graphics();
        boxBg.fillStyle(0x0a1a2d, 0.95);
        boxBg.fillRoundedRect(width / 2 - boxW / 2, height / 2 - boxH / 2, boxW, boxH, 12);
        boxBg.lineStyle(2, 0xff3366, 1);
        boxBg.strokeRoundedRect(width / 2 - boxW / 2, height / 2 - boxH / 2, boxW, boxH, 12);

        // Warning title
        const titleText = this.add.text(width / 2, height / 2 - boxH / 2 + (isCompact ? 20 : 25), 'QUIT GAME?', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: isCompact ? '20px' : '24px',
            color: '#ff3366',
            fontStyle: 'bold'
        }).setOrigin(0.5);

        // Subtitle message
        const messageText = this.add.text(width / 2, height / 2 - (isCompact ? 10 : 12),
            this.isMultiplayer ? 'Leave the multiplayer game?' : 'Your current run progress will be lost.', {
            fontFamily: 'Outfit, sans-serif',
            fontSize: isCompact ? '13px' : '15px',
            color: '#cccccc',
            align: 'center'
        }).setOrigin(0.5);

        // Buttons
        const btnY = height / 2 + boxH / 2 - (isCompact ? 30 : 35);
        const btnW = isCompact ? 95 : 115;
        const btnH = isCompact ? 36 : 42;
        const spacing = isCompact ? 60 : 75;

        // Cancel button
        const cancelBtnBg = this.add.rectangle(width / 2 - spacing, btnY, btnW, btnH, 0x222222, 0.9)
            .setStrokeStyle(2, 0x888888, 1)
            .setInteractive({ useHandCursor: true });

        const cancelText = this.add.text(width / 2 - spacing, btnY, 'CANCEL', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: isCompact ? '14px' : '16px',
            color: '#ffffff'
        }).setOrigin(0.5);

        cancelBtnBg.on('pointerdown', () => {
            container.destroy();
            this.quitModalContainer = null;
        });

        // Confirm Quit button
        const confirmBtnBg = this.add.rectangle(width / 2 + spacing, btnY, btnW, btnH, 0x660022, 0.9)
            .setStrokeStyle(2, 0xff3366, 1)
            .setInteractive({ useHandCursor: true });

        const confirmText = this.add.text(width / 2 + spacing, btnY, 'YES, QUIT', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: isCompact ? '14px' : '16px',
            color: '#ff6666'
        }).setOrigin(0.5);

        confirmBtnBg.on('pointerdown', () => {
            container.destroy();
            this.quitModalContainer = null;
            if (this.isMultiplayer) {
                this.sendMultiplayerMessage('player_disconnect', { playerId: playerId });
                cleanupMultiplayerState();
            }
            if (this.rainBgm) {
                this.rainBgm.stop();
                this.rainBgm.destroy();
                this.rainBgm = null;
            }
            this.cameras.main.fadeOut(300, 0, 0, 0);
            this.cameras.main.once('camerafadeoutcomplete', () => {
                this.scene.start('ModeSelectScene');
            });
        });

        container.add([backdrop, boxBg, titleText, messageText, cancelBtnBg, cancelText, confirmBtnBg, confirmText]);
    }
}

// ===== CHARACTER SELECT SCENE =====
class CharacterSelectScene extends Phaser.Scene {
    constructor() { super({ key: 'CharacterSelectScene' }); }

    create() {
        const { width, height } = this.scale;
        const isCompact = isCompactViewport(width, height);
        const isMobile = width < 500;

        // Background with gradient effect
        this.add.rectangle(0, 0, width, height, 0x0a1a2d).setOrigin(0);
        
        // Add subtle stars/dots for visual interest
        const starGraphics = this.add.graphics();
        starGraphics.fillStyle(0xffffff, 0.3);
        for (let i = 0; i < 30; i++) {
            starGraphics.fillCircle(
                Phaser.Math.Between(0, width),
                Phaser.Math.Between(0, height * 0.4),
                Phaser.Math.Between(1, 2)
            );
        }

        // Title - responsive sizing
        const titleSize = isMobile ? '20px' : (isCompact ? '24px' : '32px');
        this.add.text(width / 2, height * (isMobile ? 0.08 : 0.10), 'CHOOSE YOUR VOLUNTEER', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: titleSize,
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: isMobile ? 2 : (isCompact ? 3 : 4)
        }).setOrigin(0.5);

        // Character preview area - responsive positioning
        const charY = height * (isMobile ? 0.42 : 0.45);
        const charSpacing = isMobile ? 70 : (isCompact ? 100 : 140);
        const charScale = isMobile ? 1.5 : (isCompact ? 1.8 : 2.2);
        const boxWidth = isMobile ? 100 : (isCompact ? 120 : 150);
        const boxHeight = isMobile ? 135 : (isCompact ? 160 : 200);

        // Male character preview
        const maleX = width / 2 - charSpacing;
        const maleContainer = this.add.container(maleX, charY);
        const maleGraphics = this.add.graphics();
        this.drawMaleCharacter(maleGraphics);
        maleContainer.add(maleGraphics);
        maleGraphics.y = 8;
        maleContainer.setScale(charScale);

        // Male selection box
        const maleBox = this.add.rectangle(maleX, charY, boxWidth, boxHeight, 0x000000, 0.3)
            .setStrokeStyle(3, 0x00ffff, 1)
            .setInteractive({ useHandCursor: true });

        // Male label
        const labelSize = isMobile ? '14px' : (isCompact ? '16px' : '20px');
        const labelOffset = isMobile ? 80 : (isCompact ? 95 : 120);
        this.add.text(maleX, charY + labelOffset, 'VOLUNTEER A', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: labelSize,
            color: '#00ffff',
            stroke: '#000000',
            strokeThickness: 2
        }).setOrigin(0.5);

        // Male stats
        const statsSize = isMobile ? '11px' : (isCompact ? '12px' : '14px');
        const statsOffset = isMobile ? 98 : (isCompact ? 115 : 143);
        const statsStyle = {
            fontFamily: 'Outfit, sans-serif',
            fontSize: statsSize,
            color: '#d8f5ff',
            fontStyle: 'bold'
        };
        const drawStatBadge = (g, x, y, size, accent, fill = 0x06131f) => {
            const radius = size / 2;
            g.fillStyle(fill, 0.9);
            g.fillCircle(x, y, radius);
            g.lineStyle(Math.max(1.5, size * 0.12), accent, 1);
            g.strokeCircle(x, y, radius);
        };
        const drawBoltIcon = (g, x, y, size, color) => {
            const w = size * 0.6;
            const h = size * 0.95;
            g.fillStyle(color, 1);
            g.beginPath();
            g.moveTo(x + w * 0.1, y - h * 0.6);
            g.lineTo(x - w * 0.5, y - h * 0.05);
            g.lineTo(x - w * 0.05, y - h * 0.05);
            g.lineTo(x - w * 0.5, y + h * 0.6);
            g.lineTo(x + w * 0.55, y + h * 0.05);
            g.lineTo(x + w * 0.1, y + h * 0.05);
            g.closePath();
            g.fillPath();
        };
        const drawHeartIcon = (g, x, y, size, color) => {
            Icons.drawHeart(g, x, y, size, color);
        };
        const maleStatsText = this.add.text(maleX + 10, charY + statsOffset, 'FAST · Carries 1', statsStyle)
            .setOrigin(0.5)
            .setColor('#8feaff')
            .setShadow(0, 2, '#000000', 4, true, true);
        const maleIcon = this.add.graphics();
        const maleBadgeSize = isMobile ? 16 : 20;
        const maleIconX = maleStatsText.x - maleStatsText.width / 2 - (isMobile ? 12 : 14);
        const maleIconY = charY + statsOffset;
        drawStatBadge(maleIcon, maleIconX, maleIconY, maleBadgeSize, 0x6de6ff);
        drawBoltIcon(maleIcon, maleIconX, maleIconY, maleBadgeSize * 0.7, 0x6de6ff);

        // Female character preview
        const femaleX = width / 2 + charSpacing;
        const femaleContainer = this.add.container(femaleX, charY);
        const femaleGraphics = this.add.graphics();
        this.drawFemaleCharacter(femaleGraphics);
        femaleContainer.add(femaleGraphics);
        femaleGraphics.y = 8;
        femaleContainer.setScale(charScale);

        // Female selection box
        const femaleBox = this.add.rectangle(femaleX, charY, boxWidth, boxHeight, 0x000000, 0.3)
            .setStrokeStyle(3, 0xff00ff, 1)
            .setInteractive({ useHandCursor: true });

        // Female label
        this.add.text(femaleX, charY + labelOffset, 'VOLUNTEER B', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: labelSize,
            color: '#ff00ff',
            stroke: '#000000',
            strokeThickness: 2
        }).setOrigin(0.5);

        // Female stats
        const femaleStatsText = this.add.text(femaleX + 10, charY + statsOffset, 'STEADY · Carries 2', statsStyle)
            .setOrigin(0.5)
            .setColor('#ffb6de')
            .setShadow(0, 2, '#000000', 4, true, true);
        const femaleIcon = this.add.graphics();
        const femaleBadgeSize = isMobile ? 16 : 20;
        const femaleIconX = femaleStatsText.x - femaleStatsText.width / 2 - (isMobile ? 12 : 14);
        const femaleIconY = charY + statsOffset;
        drawStatBadge(femaleIcon, femaleIconX, femaleIconY, femaleBadgeSize, 0xffa1d4, 0x1a0b1b);
        drawHeartIcon(femaleIcon, femaleIconX, femaleIconY, femaleBadgeSize * 0.75, 0xffa1d4);

        // Selection indicator
        const selectIndicator = this.add.graphics();
        const updateSelection = (selected) => {
            selectIndicator.clear();
            selectIndicator.lineStyle(4, selected === 'male' ? 0x00ffff : 0xff00ff, 1);
            const x = selected === 'male' ? maleX : femaleX;
            const selBoxW = boxWidth + 10;
            const selBoxH = boxHeight + 10;
            selectIndicator.strokeRoundedRect(x - selBoxW/2, charY - selBoxH/2, selBoxW, selBoxH, 12);
            
            // Update box styles
            maleBox.setStrokeStyle(selected === 'male' ? 4 : 2, 0x00ffff, selected === 'male' ? 1 : 0.5);
            femaleBox.setStrokeStyle(selected === 'female' ? 4 : 2, 0xff00ff, selected === 'female' ? 1 : 0.5);

            // Update facial expressions
            maleGraphics.clear();
            this.drawMaleCharacter(maleGraphics, selected === 'male' ? 'smiley' : 'frowny');
            femaleGraphics.clear();
            this.drawFemaleCharacter(femaleGraphics, selected === 'female' ? 'smiley' : 'frowny');
        };

        // Initial selection
        updateSelection(selectedCharacter);

        // Click handlers with visual feedback
        maleBox.on('pointerdown', () => {
            selectedCharacter = 'male';
            updateSelection('male');
            maleContainer.setScale(charScale * 1.05);
            this.time.delayedCall(100, () => maleContainer.setScale(charScale));
        });

        femaleBox.on('pointerdown', () => {
            selectedCharacter = 'female';
            updateSelection('female');
            femaleContainer.setScale(charScale * 1.05);
            this.time.delayedCall(100, () => femaleContainer.setScale(charScale));
        });

        // Tap instruction for mobile
        if (isMobile) {
            this.add.text(width / 2, charY + labelOffset + 35, 'Tap to select', {
                fontFamily: 'Outfit, sans-serif',
                fontSize: '12px',
                color: '#888888'
            }).setOrigin(0.5);
        }

        // Start button - responsive
        const btnSize = isMobile ? '22px' : (isCompact ? '26px' : '32px');
        const btnPadding = isMobile ? { left: 24, right: 24, top: 10, bottom: 10 } : { left: 30, right: 30, top: 12, bottom: 12 };
        const startBtn = this.add.text(width / 2, height * (isMobile ? 0.82 : 0.85), 'START GAME', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: btnSize,
            color: '#000000',
            backgroundColor: '#ccff00',
            padding: btnPadding
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        startBtn.on('pointerover', () => startBtn.setScale(1.05));
        startBtn.on('pointerout', () => startBtn.setScale(1));
        startBtn.on('pointerdown', () => {
            this.cameras.main.fadeOut(300, 0, 0, 0);
            this.cameras.main.once('camerafadeoutcomplete', () => {
                this.scene.start('GameScene');
            });
        });

        // Keyboard support
        this.input.keyboard.on('keydown-LEFT', () => {
            selectedCharacter = 'male';
            updateSelection('male');
        });
        this.input.keyboard.on('keydown-RIGHT', () => {
            selectedCharacter = 'female';
            updateSelection('female');
        });
        this.input.keyboard.on('keydown-ENTER', () => {
            this.cameras.main.fadeOut(300, 0, 0, 0);
            this.cameras.main.once('camerafadeoutcomplete', () => {
                this.scene.start('GameScene');
            });
        });
        this.input.keyboard.on('keydown-SPACE', () => {
            this.cameras.main.fadeOut(300, 0, 0, 0);
            this.cameras.main.once('camerafadeoutcomplete', () => {
                this.scene.start('GameScene');
            });
        });

        // Back button (small, top-left)
        const backBtn = this.add.text(20, 20, '← BACK', {
            fontFamily: 'Outfit, sans-serif',
            fontSize: '14px',
            color: '#888888'
        }).setInteractive({ useHandCursor: true });

        backBtn.on('pointerover', () => backBtn.setColor('#ffffff'));
        backBtn.on('pointerout', () => backBtn.setColor('#888888'));
        backBtn.on('pointerdown', () => {
            this.cameras.main.fadeOut(200, 0, 0, 0);
            this.cameras.main.once('camerafadeoutcomplete', () => {
                this.scene.start('ModeSelectScene');
            });
        });

        // Quit button (small, top-right)
        const quitBtn = this.add.text(width - 20, 20, '✖ QUIT', {
            fontFamily: 'Outfit, sans-serif',
            fontSize: '14px',
            color: '#ff6666',
            backgroundColor: 'rgba(51, 0, 0, 0.7)',
            padding: { left: 10, right: 10, top: 5, bottom: 5 }
        }).setOrigin(1, 0).setDepth(200).setInteractive({ useHandCursor: true });

        quitBtn.on('pointerover', () => quitBtn.setColor('#ffffff'));
        quitBtn.on('pointerout', () => quitBtn.setColor('#ff6666'));
        quitBtn.on('pointerdown', () => {
            cleanupMultiplayerState();
            this.cameras.main.fadeOut(200, 0, 0, 0);
            this.cameras.main.once('camerafadeoutcomplete', () => {
                this.scene.start('SplashScene');
            });
        });

        this.cameras.main.fadeIn(300);
    }

    drawMaleCharacter(g, expression = 'frowny') {
        drawMalePlayerGlobal(g, false, expression);
    }

    drawFemaleCharacter(g, expression = 'frowny') {
        drawFemalePlayerGlobal(g, false, expression);
    }
}

const config = {
    type: Phaser.AUTO, backgroundColor: '#000000', scale: { mode: Phaser.Scale.RESIZE, parent: 'game-container' },
    dom: { createContainer: true }, scene: [SplashScene, NameEntryScene, ModeSelectScene, LobbyScene, CharacterSelectScene, GameScene]
};
window.addEventListener('load', () => new Phaser.Game(config));

window.addEventListener('pointerdown', () => {
    if (window.innerWidth > window.innerHeight) {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
        }
    }
});

window.addEventListener('resize', () => {
    if (window.innerWidth < window.innerHeight) {
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
        }
    }
});
