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

async function submitScore(name, score) {
    if (!supabaseClient) return false;
    try {
        const { error } = await supabaseClient
            .from('leaderboard')
            .insert([{ player_name: name, score: score }]);
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
            .select('*')
            .order('score', { ascending: false })
            .limit(5);
        if (error) return [];
        return data || [];
    } catch (e) {
        return [];
    }
}

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

const isCompactViewport = (width, height) => Math.min(width, height) < 600;

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
                // Start Game
                step = 2;
                startGame();
            }
        };

        // --- INPUTS ---
        const hitArea = this.add.rectangle(0, 0, width, height, 0x000000, 0).setOrigin(0).setInteractive({ useHandCursor: true });
        hitArea.on('pointerdown', handleInput);
        this.input.keyboard.on('keydown', handleInput);

        console.log("SplashScene ready. Two-step start active.");
    }
}

// ===== GAME SCENE =====
class GameScene extends Phaser.Scene {
    constructor() { super({ key: 'GameScene' }); }

    preload() {
        this.load.image('newt', 'assets/newt.png');
        this.load.image('newtXing', 'assets/newt_Xing.png');
        this.load.audio('sfx_saved', 'assets/sfx_saved.mp3');
        this.load.audio('sfx_hit', 'assets/sfx_hit.mp3');
        this.load.audio('sfx_crash', 'assets/sfx_crash.mp3');
        this.load.audio('bgm_end', 'assets/bgm_end.mp3');
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

        this.calculateLayout();

        this.cars = this.add.group();
        this.newts = this.add.group();

        this.createEnvironment();
        this.createPlayer();
        this.createHUD();
        this.createControls();

        this.scale.on('resize', () => {
            // Don't restart during game over to preserve the name input form
            if (!this.gameOver) {
                this.scene.restart();
            }
        });

        this.carTimer = this.time.addEvent({
            delay: GAME_CONFIG.CAR_SPAWN_RATE,
            callback: this.spawnCar,
            callbackScope: this,
            loop: true
        });
        this.time.addEvent({ delay: GAME_CONFIG.NEWT_SPAWN_RATE, callback: this.spawnNewt, callbackScope: this, loop: true });

        this.spawnNewt();
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
        g.fillStyle(0x000000, 0.4); g.fillEllipse(0, 28, 35, 12);
        g.fillStyle(0x2c3e50); g.fillRoundedRect(-12, 8, 10, 22, 3); g.fillRoundedRect(2, 8, 10, 22, 3);
        // Hands
        g.fillStyle(0xfce4d6);
        g.fillCircle(-20, -5, 6); // Left hand
        g.fillCircle(20, -5, 6);  // Right hand
        // Safety Vest
        const vestGreen = 0xccff00;
        const reflectiveSilver = 0xdddddd;
        const safetyOrange = 0xff6b00;

        g.fillStyle(vestGreen);
        g.fillRoundedRect(-18, -18, 36, 32, 5); // Main vest body

        // Reflective Strips - Orange Borders
        g.fillStyle(safetyOrange);
        g.fillRect(-14, -18, 12, 32); // Left vertical border
        g.fillRect(2, -18, 12, 32);   // Right vertical border
        g.fillRect(-18, -4, 36, 12);  // Horizontal waist band border

        // Reflective Strips - Silver 
        g.fillStyle(reflectiveSilver);
        g.fillRect(-12, -18, 8, 32); // Left vertical
        g.fillRect(4, -18, 8, 32);   // Right vertical
        g.fillRect(-18, -2, 36, 8);  // Horizontal waist band
        g.fillStyle(0xfce4d6); g.fillCircle(0, -26, 14);
        g.fillStyle(0x000000); g.fillCircle(-5, -28, 2.5); g.fillCircle(5, -28, 2.5);
        g.fillStyle(0xcc9988); g.fillEllipse(0, -22, 4, 2);
        // More prominent cap/hat
        g.fillStyle(0xff0000); g.fillEllipse(0, -40, 26, 14); // Main cap
        g.fillStyle(0xcc0000); g.fillRect(-13, -42, 26, 6); // Cap brim
        this.player.add(g);
        this.player.graphics = g;
        this.player.speed = GAME_CONFIG.PLAYER_SPEED * (this.isCompact ? 0.92 : 1);
        this.player.carried = [];
        this.player.invincible = false;
        this.walkTime = 0;
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

        this.scoreText.setText(`${this.score}`);

        // Update carrying display (Text based)
        if (this.carryIconGroup) {
            this.carryIconGroup.clear(true, true);
            this.carryIconGroup.destroy();
            this.carryIconGroup = null;
        }
        const c = this.player.carried.length;
        const carryCount = Math.min(c, 2);
        this.carryText.setText(`Carrying ${carryCount} of 2 Newts`);

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
            this.carryBg.lineStyle(2, 0x00ffff, 0.45);
            this.carryBg.strokeRoundedRect(bgX, bgY, bgWidth, bgHeight, bgHeight / 2);
        }

        this.statsText.setText(`SAVED: ${this.saved} | LOST: ${this.lost}`);
    }

    updateDifficulty() {
        if (this.score >= GAME_CONFIG.DIFFICULTY_THRESHOLD) {
            const excess = this.score - GAME_CONFIG.DIFFICULTY_THRESHOLD;
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
        this.updateCars(delta);
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
        if (this.player.invincible) {
            this.player.alpha = (Math.floor(time / 100) % 2 === 0) ? 0.4 : 0.9;
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
        const colors = [0xe74c3c, 0x3498db, 0x2ecc71, 0x9b59b6, 0xf39c12, 0x1abc9c, 0xbdc3c7, 0x34495e];
        const mainColor = colors[Phaser.Math.Between(0, colors.length - 1)];

        if (type === 'car') this.draw3DCar(g, mainColor, dir);
        else if (type === 'truck') this.draw3DTruck(g, mainColor, dir);
        else if (type === 'motorbike') this.draw3DMotorbike(g, mainColor, dir);

        container.add(g);
        container.speed = speed;
        container.type = type;

        if (type === 'truck') { container.w = 140; container.h = 45; }
        else if (type === 'motorbike') { container.w = 50; container.h = 20; }
        else { container.w = 90; container.h = 35; }

        this.cars.add(container);
    }

    draw3DCar(g, color, dir) {
        const dark = Phaser.Display.Color.ValueToColor(color).darken(30).color;
        const bright = Phaser.Display.Color.ValueToColor(color).lighten(20).color;

        // Shadow
        g.fillStyle(0x000000, 0.3);
        g.fillEllipse(0, 22, 95, 18);

        // Body base (3D side depth)
        g.fillStyle(dark);
        g.fillRoundedRect(-48, -16, 96, 36, 10);

        // Main body (Top surface)
        g.fillGradientStyle(color, color, bright, bright);
        g.fillRoundedRect(-48, -20, 96, 34, 10);

        // Roof
        g.fillStyle(bright);
        g.fillRoundedRect(-15, -16, 45, 26, 6);
        g.fillStyle(color);
        g.fillRoundedRect(-12, -14, 39, 22, 5);

        // Windshieds
        g.fillStyle(0x1a2530);
        g.fillRect(dir === 1 ? 18 : -32, -12, 14, 18); // Front
        g.fillRect(dir === 1 ? -22 : 8, -12, 8, 18); // Back

        // Windows (sides)
        g.fillRect(-10, -13, 22, 2);
        g.fillRect(-10, 7, 22, 2);

        // Lights
        g.fillStyle(0xffffcc);
        g.fillCircle(dir === 1 ? 44 : -44, -10, 5);
        g.fillCircle(dir === 1 ? 44 : -44, 4, 5);
        g.fillStyle(0xff3333);
        g.fillCircle(dir === 1 ? -44 : 44, -12, 4);
        g.fillCircle(dir === 1 ? -44 : 44, 6, 4);

        // Wheels
        g.fillStyle(0x111111);
        g.fillRoundedRect(-35, 14, 16, 6, 2);
        g.fillRoundedRect(20, 14, 16, 6, 2);
        g.fillRoundedRect(-35, -24, 16, 6, 2);
        g.fillRoundedRect(20, -24, 16, 6, 2);
    }

    draw3DTruck(g, color, dir) {
        const dark = Phaser.Display.Color.ValueToColor(color).darken(40).color;
        const bright = Phaser.Display.Color.ValueToColor(color).lighten(15).color;

        // Shadow
        g.fillStyle(0x000000, 0.35);
        g.fillEllipse(0, 25, 145, 25);

        // Trailer (Main box)
        g.fillStyle(0xd5d5d5);
        g.fillRoundedRect(-20, -24, 90, 48, 4);
        g.fillStyle(0xeeeeee);
        g.fillRoundedRect(-20, -24, 90, 44, 4);

        // Cab (Front part)
        const cabX = dir === 1 ? 70 : -70;
        g.fillStyle(dark);
        g.fillRoundedRect(dir === 1 ? 65 : -115, -22, 50, 44, 6);
        g.fillStyle(color);
        g.fillRoundedRect(dir === 1 ? 65 : -115, -22, 50, 40, 6);

        // Cab Windows
        g.fillStyle(0x1a2530);
        g.fillRect(dir === 1 ? 95 : -110, -18, 12, 32); // Front
        g.fillRect(dir === 1 ? 75 : -85, -19, 15, 3); // Sides
        g.fillRect(dir === 1 ? 75 : -85, 12, 15, 3);

        // Wheels (6 wheels)
        g.fillStyle(0x111111);
        const wheelY = [18, -28];
        const wheelX = [-10, 25, 60, 95];
        wheelY.forEach(wy => {
            wheelX.forEach(wx => {
                const finalX = dir === 1 ? wx : -wx - 50;
                g.fillRoundedRect(finalX, wy, 18, 8, 2);
            });
        });

        // Details
        g.fillStyle(0xffcc00);
        g.fillCircle(dir === 1 ? 110 : -110, -15, 6);
        g.fillCircle(dir === 1 ? 110 : -110, 11, 6);
    }

    draw3DMotorbike(g, color, dir) {
        const dark = Phaser.Display.Color.ValueToColor(color).darken(30).color;

        // Shadow
        g.fillStyle(0x000000, 0.25);
        g.fillEllipse(0, 15, 50, 10);

        // Body
        g.lineStyle(6, 0x222222);
        g.lineBetween(-20, 0, 20, 0); // Frame

        g.fillStyle(color);
        g.fillEllipse(0, 0, 25, 10); // Fuel tank/Body

        // Rider (Top down)
        g.fillStyle(0x333333);
        g.fillCircle(-5, 0, 10); // Helmet/Body
        g.fillStyle(0xddccbb);
        g.fillCircle(-2, 0, 7); // Arms/Hands area

        // Handlebars
        g.lineStyle(2, 0x555555);
        g.lineBetween(10, -10, 10, 10);

        // Wheels
        g.fillStyle(0x111111);
        g.fillRoundedRect(-22, -3, 10, 6, 2);
        g.fillRoundedRect(12, -3, 10, 6, 2);

        // Headlight
        g.fillStyle(0xffffcc);
        g.fillCircle(dir === 1 ? 22 : -22, 0, 4);
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
        newt.rotation = newt.dir === 1 ? Math.PI / 2 : -Math.PI / 2;
        this.newts.add(newt);
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
            } else {
                const idx = this.player.carried.indexOf(newt);
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
    }

    checkCollisions() {
        if (this.gameOver) return;
        this.cars.getChildren().forEach(car => {
            if (!this.player.invincible && Math.abs(this.player.x - car.x) < car.w / 2 && Math.abs(this.player.y - car.y) < car.h / 2) { this.hitPlayer(); }
            this.newts.getChildren().forEach(newt => {
                if (!newt.isCarried && Math.abs(newt.x - car.x) < car.w / 2 && Math.abs(newt.y - car.y) < car.h / 2) { this.splatterNewt(newt); }
            });
        });
        this.newts.getChildren().forEach(newt => {
            if (!newt.isCarried && this.player.carried.length < 2) {
                const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, newt.x, newt.y);
                if (dist < 50) {
                    newt.isCarried = true;
                    this.player.carried.push(newt);
                    this.createPickupEffect(newt.x, newt.y);
                    this.updateHUD();
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
                        this.saved++;
                        this.streak++;
                        if (this.streak > this.maxStreak) this.maxStreak = this.streak;
                        this.score += 100;
                        if (this.cache.audio.exists('sfx_saved')) this.sound.play('sfx_saved', { volume: 0.6 });
                        
                        // Haptic feedback for save (gentle pulse)
                        if (navigator.vibrate) navigator.vibrate(30);
                        
                        this.createSuccessEffect(newt.x, newt.y);
                        this.checkAchievements();
                        this.updateDifficulty();
                    }
                    newt.destroy();
                });
                this.player.carried = [];
                this.updateHUD();
            }
        }
    }



    hitPlayer() {
        if (this.gameOver) return;
        this.lives--; this.updateHUD();

        // Reset streak on player hit
        this.streak = 0;

        if (this.cache.audio.exists('sfx_crash')) {
            this.sound.play('sfx_crash', { volume: 0.7 });
        } else if (this.cache.audio.exists('sfx_hit')) {
            // Fallback if sfx_crash missing
            this.sound.play('sfx_hit', { volume: 0.7 });
        }

        // Screen shake for impact
        this.cameras.main.shake(300, 0.02);

        // Haptic feedback for mobile (strong vibration pattern)
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

        this.player.carried.forEach(n => n.destroy()); this.player.carried = [];
        this.cameras.main.flash(150, 255, 50, 50, false);
        this.player.invincible = true;
        this.time.delayedCall(2000, () => { this.player.invincible = false; this.player.alpha = 1; });
        this.player.x = this.scale.width / 2;
        this.player.y = this.botSafe + 60;
        if (this.lives <= 0) { this.gameOver = true; this.showGameOver(); }
    }

    splatterNewt(newt) {
        this.lost++;
        this.streak = 0; // Reset streak when newt is lost
        this.achievements.perfectStart = false;
        this.score = Math.max(0, this.score - 10); // Deduct 10 points
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
        });

        const { width, height } = this.scale;
        const isCompact = this.isCompact;
        this.add.rectangle(0, 0, width, height, 0x000000, 0.92).setOrigin(0).setDepth(300);
        this.add.text(width / 2, height * 0.08, 'GAME OVER', {
            fontFamily: 'Fredoka, sans-serif', fontSize: '44px', color: '#ff3366', fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(301);
        this.add.text(width / 2, height * 0.16, `FINAL SCORE: ${this.score}`, {
            fontFamily: 'Fredoka, sans-serif', fontSize: '26px', color: '#ffffff'
        }).setOrigin(0.5).setDepth(301);

        const runSeconds = Math.max(0, (this.time.now - this.runStartTime) / 1000);
        const formatTime = seconds => {
            const mins = Math.floor(seconds / 60);
            const secs = Math.floor(seconds % 60);
            return `${mins}:${secs.toString().padStart(2, '0')}`;
        };
        const totalNewts = this.saved + this.lost;
        const rescueRate = totalNewts > 0 ? Math.round((this.saved / totalNewts) * 100) : 0;

        const summaryTitleY = height * (isCompact ? 0.22 : 0.21);
        this.add.text(width / 2, summaryTitleY, 'RUN SUMMARY', {
            fontFamily: 'Outfit, sans-serif',
            fontSize: isCompact ? '14px' : '16px',
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

        const summaryFont = isCompact ? 14 : 16;
        const lineHeight = isCompact ? 18 : 22;
        const summaryPadX = isCompact ? 14 : 18;
        const summaryPadY = isCompact ? 10 : 12;
        const summaryBoxWidth = Math.min(width * 0.78, isCompact ? 320 : 380);
        const summaryBoxHeight = lineHeight * summaryLines.length + summaryPadY * 2;
        const summaryBoxY = summaryTitleY + (isCompact ? 16 : 20) + summaryBoxHeight / 2;

        const summaryBg = this.add.graphics().setDepth(301);
        summaryBg.fillStyle(0x000000, 0.6);
        summaryBg.fillRoundedRect(width / 2 - summaryBoxWidth / 2, summaryBoxY - summaryBoxHeight / 2, summaryBoxWidth, summaryBoxHeight, 12);
        summaryBg.lineStyle(2, 0x00ffff, 0.6);
        summaryBg.strokeRoundedRect(width / 2 - summaryBoxWidth / 2, summaryBoxY - summaryBoxHeight / 2, summaryBoxWidth, summaryBoxHeight, 12);

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

        const nextSectionY = summaryBoxY + summaryBoxHeight / 2 + (isCompact ? 18 : 24);

        if (supabaseClient) {
            // Disable Phaser key capture so typing works in the DOM input
            this.input.keyboard.removeCapture('W,A,S,D');
            this.input.keyboard.removeCapture([32, 37, 38, 39, 40]); // Space + Arrow keys

            const namePromptY = nextSectionY;
            const inputY = namePromptY + (isCompact ? 26 : 32);
            const submitY = inputY + (isCompact ? 40 : 48);

            this.add.text(width / 2, namePromptY, 'Enter your name:', {
                fontFamily: 'Outfit, sans-serif', fontSize: '16px', color: '#aaaaaa'
            }).setOrigin(0.5).setDepth(301);

            const inputEl = document.createElement('input');
            inputEl.type = 'text'; inputEl.placeholder = 'Your Name'; inputEl.maxLength = 15;
            const canvasRect = this.game.canvas.getBoundingClientRect();
            inputEl.style.cssText = `position: fixed; left: ${canvasRect.left + width / 2}px; top: ${canvasRect.top + inputY}px; transform: translate(-50%, -50%); padding: 10px 18px; font-size: 16px; font-family: 'Fredoka', sans-serif; border: 2px solid #00ffff; border-radius: 8px; background: #111; color: #fff; text-align: center; width: 180px; z-index: 10000; outline: none;`;
            document.body.appendChild(inputEl); inputEl.focus();

            const submitBtnText = this.add.text(width / 2 + 15, submitY, 'SUBMIT SCORE', {
                fontFamily: 'Fredoka, sans-serif', fontSize: '20px', color: '#00ff00', backgroundColor: '#222', padding: { left: 45, right: 18, top: 8, bottom: 8 }
            }).setOrigin(0.5).setDepth(301).setInteractive({ useHandCursor: true });

            const submitIcon = this.add.graphics().setDepth(302);
            Icons.drawSend(submitIcon, submitBtnText.x - submitBtnText.width / 2 + 22, submitY, 18, 0x00ff00);

            let submitted = false;
            submitBtnText.on('pointerdown', async () => {
                if (submitted) return;
                const name = inputEl.value.trim() || 'Anonymous';
                submitted = true;
                submitBtnText.setText('Submitting...');
                submitBtnText.disableInteractive();
                const success = await submitScore(name, this.score);
                if (success) { submitBtnText.setText('Submitted!'); inputEl.remove(); submitIcon.clear(); this.refreshLeaderboard(); }
                else { submitBtnText.setText('Error - Try Again'); submitted = false; submitBtnText.setInteractive({ useHandCursor: true }); }
            });
            this.events.once('shutdown', () => { if (inputEl && inputEl.parentNode) inputEl.remove(); });

            this.leaderboardY = submitY + (isCompact ? 55 : 65);
            await this.showLeaderboard();
        } else {
            this.add.text(width / 2, nextSectionY, '(Leaderboard not configured)', {
                fontFamily: 'Outfit, sans-serif', fontSize: '14px', color: '#555'
            }).setOrigin(0.5).setDepth(301);
            this.leaderboardY = nextSectionY + (isCompact ? 24 : 30);
        }

        const desiredVolunteerY = supabaseClient ? height * 0.78 : height * 0.66;
        const minVolunteerY = this.leaderboardY + (isCompact ? 90 : 110);
        const volunteerY = Math.min(height * 0.88, Math.max(desiredVolunteerY, minVolunteerY));
        const volunteerBg = this.add.rectangle(width / 2, volunteerY, width * 0.85, 60, 0x004422, 0.9).setStrokeStyle(2, 0x00ff88).setOrigin(0.5).setDepth(301);
        this.add.text(width / 2, volunteerY - 10, 'Want to help real newts?', { fontFamily: 'Fredoka, sans-serif', fontSize: '16px', color: '#ffffff' }).setOrigin(0.5).setDepth(302);
        const volunteerLink = this.add.text(width / 2 + 10, volunteerY + 12, 'Volunteer at bioblitz.club/newts', { fontFamily: 'Fredoka, sans-serif', fontSize: '18px', color: '#00ff88', fontStyle: 'bold' }).setOrigin(0.5).setDepth(302).setInteractive({ useHandCursor: true });
        const volunteerIcon = this.add.graphics().setDepth(303);
        Icons.drawExternalLink(volunteerIcon, volunteerLink.x - volunteerLink.width / 2 - 18, volunteerY + 12, 16, 0x00ff88);
        volunteerLink.on('pointerdown', () => { window.open('https://bioblitz.club/newts', '_blank'); });

        const retryBtnText = this.add.text(width / 2 + 15, height * 0.92, 'TRY AGAIN', {
            fontFamily: 'Fredoka, sans-serif', fontSize: '24px', color: '#00ffff', backgroundColor: '#222', padding: { left: 45, right: 22, top: 10, bottom: 10 }
        }).setOrigin(0.5).setDepth(301).setInteractive({ useHandCursor: true });
        const retryIcon = this.add.graphics().setDepth(302);
        Icons.drawRefresh(retryIcon, retryBtnText.x - retryBtnText.width / 2 + 22, height * 0.92, 22, 0x00ffff);
        retryBtnText.on('pointerdown', () => {
            this.scene.restart();
        });
    }

    async showLeaderboard() {
        const { width } = this.scale;
        const startY = this.leaderboardY;
        const trophyIcon = this.add.graphics().setDepth(301);
        Icons.drawTrophy(trophyIcon, width / 2 - 75, startY, 20, 0xffcc00);
        this.add.text(width / 2 + 10, startY, 'TOP SCORES', { fontFamily: 'Fredoka, sans-serif', fontSize: '18px', color: '#ffcc00' }).setOrigin(0.5).setDepth(301);

        const scores = await getLeaderboard();
        if (scores.length === 0) {
            this.add.text(width / 2, startY + 30, 'Be the first to set a high score!', { fontFamily: 'Outfit, sans-serif', fontSize: '14px', color: '#666' }).setOrigin(0.5).setDepth(301);
        } else {
            scores.forEach((s, i) => {
                const medal = i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : `${i + 1}th`;
                this.add.text(width / 2, startY + 35 + (i * 22), `${medal}  ${s.player_name} — ${s.score}`, { fontFamily: 'Outfit, sans-serif', fontSize: '15px', color: '#ffffff' }).setOrigin(0.5).setDepth(301);
            });
        }
    }

    async refreshLeaderboard() {
        this.scene.restart(); // Simple refresh for now to clear graphics
    }
}

const config = {
    type: Phaser.AUTO, backgroundColor: '#000000', scale: { mode: Phaser.Scale.RESIZE, parent: 'game-container' },
    dom: { createContainer: true }, scene: [SplashScene, GameScene]
};
window.addEventListener('load', () => new Phaser.Game(config));
