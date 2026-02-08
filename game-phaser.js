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
            .select('*')
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

// ===== MULTIPLAYER STATE =====
let gameMode = 'single'; // 'single' or 'multi'
let isHost = false;
let roomCode = null;
let roomId = null;
let playerId = null;
let remotePlayerId = null;
let remoteCharacter = null;
let multiplayerChannel = null;
let lastRemoteUpdate = 0;

// ===== AUDIO SHARING STATE =====
let audioPeerConnection = null;
let localAudioStream = null;
let remoteAudioStream = null;
let isAudioEnabled = false;
let isMuted = false;
let audioSignalingQueue = [];
let audioIceCandidatesQueue = [];
let audioConnectionStartTime = null;
let audioConnectionTimeoutId = null;
const MAX_ICE_QUEUE = 50;
const AUDIO_CONNECTION_TIMEOUT = 15000; // 15 seconds
let globalClickListenerAdded = false;
let audioRetryCount = 0;
const MAX_AUDIO_RETRIES = 5;
const BASE_RETRY_DELAY = 1000;
let audioRetryTimeoutId = null;
let audioQualityMonitorInterval = null;
let connectionQuality = 'unknown'; // unknown, excellent, good, fair, poor
let isReconnecting = false;

// Generate unique player ID
function generatePlayerId() {
    return 'player_' + Math.random().toString(36).substring(2, 15);
}

// Generate 4-digit room code
function generateRoomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

// Global click handler to help unlock audio on restricted browsers
function setupGlobalAudioResumeListener() {
    if (!globalClickListenerAdded) {
        const handler = () => {
            const remoteAudio = document.getElementById('remote-audio');
            if (remoteAudio && remoteAudio.paused) {
                remoteAudio.play().catch(() => {});
            }
        };
        window.addEventListener('click', handler);
        globalClickListenerAdded = true;
    }
}

function cleanupGlobalAudioResumeListener() {
    // Note: Cannot remove if added with anonymous function in original code
    // This can be improved by storing reference
}

// Room management functions
async function createRoom(hostCharacter) {
    if (!supabaseClient) return null;
    const code = generateRoomCode();
    const hostId = generatePlayerId();
    
    try {
        const { data, error } = await supabaseClient
            .from('game_rooms')
            .insert([{ 
                room_code: code, 
                host_id: hostId,
                host_character: hostCharacter,
                status: 'waiting'
            }])
            .select()
            .single();
        
        if (error) {
            console.error("Error creating room:", error);
            return null;
        }
        
        playerId = hostId;
        roomCode = code;
        roomId = data.id;
        isHost = true;
        
        return data;
    } catch (e) {
        console.error("Exception creating room:", e);
        return null;
    }
}

async function joinRoom(code, guestCharacter) {
    if (!supabaseClient) return null;
    const guestId = generatePlayerId();
    
    try {
        // First check if room exists and is waiting
        const { data: room, error: fetchError } = await supabaseClient
            .from('game_rooms')
            .select('*')
            .eq('room_code', code)
            .eq('status', 'waiting')
            .is('guest_id', null)
            .single();
        
        if (fetchError || !room) {
            console.error("Room not found or not available:", fetchError);
            return null;
        }
        
        // Update room with guest info
        const { data, error } = await supabaseClient
            .from('game_rooms')
            .update({ 
                guest_id: guestId,
                guest_character: guestCharacter,
                status: 'playing'
            })
            .eq('id', room.id)
            .select()
            .single();
        
        if (error) {
            console.error("Error joining room:", error);
            return null;
        }
        
        playerId = guestId;
        roomCode = code;
        roomId = data.id;
        isHost = false;
        remotePlayerId = data.host_id;
        remoteCharacter = data.host_character;
        
        return data;
    } catch (e) {
        console.error("Exception joining room:", e);
        return null;
    }
}

async function updateRoomStatus(status) {
    if (!supabaseClient || !roomId) return;
    try {
        await supabaseClient
            .from('game_rooms')
            .update({ status: status })
            .eq('id', roomId);
    } catch (e) {
        console.error("Error updating room status:", e);
    }
}

async function deleteRoom() {
    if (!supabaseClient || !roomId) return;
    try {
        await supabaseClient
            .from('game_rooms')
            .delete()
            .eq('id', roomId);
    } catch (e) {
        console.error("Error deleting room:", e);
    }
}

function cleanupMultiplayerState() {
    if (multiplayerChannel) {
        supabaseClient.removeChannel(multiplayerChannel);
        multiplayerChannel = null;
    }
    // Cleanup audio
    stopAudioSharing();
    gameMode = 'single';
    isHost = false;
    roomCode = null;
    roomId = null;
    playerId = null;
    remotePlayerId = null;
    remoteCharacter = null;
    lastRemoteUpdate = 0;
}

// ===== AUDIO SHARING FUNCTIONS =====
// Detect browser and platform
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
const isIOSSafari = isIOS && isSafari;
const isFirefox = /Firefox/.test(navigator.userAgent);
const isChrome = /Chrome/.test(navigator.userAgent) && !isSafari;

const WEBRTC_CONFIG = {
    iceServers: [
        // STUN servers for NAT discovery
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        // Public TURN servers as fallback for symmetric NAT
        { 
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        { 
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        }
    ],
    iceTransportPolicy: 'all', // Try all connection methods
    bundlePolicy: 'max-bundle', // Optimize bandwidth
    rtcpMuxPolicy: 'require' // Multiplex RTP/RTCP for efficiency
};

// Audio monitoring state
let audioLevelCheckInterval = null;
let lastAudioLevel = 0;
let silenceDetectionCount = 0;
const SILENCE_THRESHOLD = 0.01; // Audio level threshold
const MAX_SILENCE_CHECKS = 10; // 10 seconds of silence triggers warning

function calculateBackoffDelay(retryCount) {
    return BASE_RETRY_DELAY * Math.pow(2, retryCount);
}

async function initAudioSharing() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.warn('WebRTC not supported in this browser');
        showAudioError('WebRTC not supported in this browser');
        return false;
    }

    try {
        // Reuse existing stream if possible to avoid multiple permission prompts
        if (!localAudioStream || !localAudioStream.active) {
            console.log('Requesting microphone access (attempt', audioRetryCount + 1, ')...');
            try {
                // Browser-specific audio constraints
                let audioConstraints;
                if (isIOSSafari) {
                    // iOS Safari has limited constraint support
                    audioConstraints = { audio: true, video: false };
                    console.log('Using basic audio constraints for iOS Safari');
                } else if (isFirefox) {
                    // Firefox prefers these settings
                    audioConstraints = {
                        audio: {
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true
                        },
                        video: false
                    };
                } else {
                    // Chrome and others
                    audioConstraints = {
                        audio: {
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true,
                            sampleRate: 48000
                        },
                        video: false
                    };
                }
                
                localAudioStream = await navigator.mediaDevices.getUserMedia(audioConstraints);
                console.log('Microphone access granted');
                audioRetryCount = 0; // Reset on success
            } catch (permError) {
                // Handle specific permission errors
                if (permError.name === 'NotAllowedError') {
                    console.warn('User denied microphone permission');
                    showAudioError('Microphone access denied. Check browser permissions.');
                    audioRetryCount = 0; // Don't retry if user explicitly denied
                    return false;
                } else if (permError.name === 'NotFoundError') {
                    console.warn('No microphone found');
                    showAudioError('No microphone device found on this device.');
                    audioRetryCount = 0;
                    return false;
                } else if (permError.name === 'NotSupportedError') {
                    console.warn('getUserMedia not supported');
                    showAudioError('Audio not supported on this browser.');
                    audioRetryCount = 0;
                    return false;
                } else if (permError.name === 'AbortError' || permError.name === 'NotReadableError') {
                    // Temporary errors - can retry
                    console.warn('Microphone access interrupted:', permError);
                    if (audioRetryCount < MAX_AUDIO_RETRIES) {
                        const delayMs = calculateBackoffDelay(audioRetryCount);
                        console.log(`Retrying audio init in ${delayMs}ms (${audioRetryCount + 1}/${MAX_AUDIO_RETRIES})`);
                        audioRetryCount++;
                        showAudioError(`Audio interrupted. Retrying (${audioRetryCount}/${MAX_AUDIO_RETRIES})...`);
                        
                        audioRetryTimeoutId = setTimeout(() => {
                            initAudioSharing();
                        }, delayMs);
                        return false;
                    } else {
                        showAudioError('Audio initialization failed after multiple attempts.');
                        audioRetryCount = 0;
                        return false;
                    }
                } else {
                    console.error('Microphone error:', permError);
                    showAudioError('Microphone error: ' + permError.message);
                    return false;
                }
            }
        } else {
            console.log('Reusing existing microphone stream');
            audioRetryCount = 0;
        }
        
        // Create peer connection
        // Close existing one if it exists to avoid leaks
        if (audioPeerConnection) {
            audioPeerConnection.close();
        }
        audioPeerConnection = new RTCPeerConnection(WEBRTC_CONFIG);
        
        // Add local stream tracks to peer connection
        localAudioStream.getTracks().forEach(track => {
            audioPeerConnection.addTrack(track, localAudioStream);
        });
        
        // Handle incoming remote stream
        audioPeerConnection.ontrack = (event) => {
            console.log('Remote audio stream received', event.streams);
            
            // Prefer the stream from the event, otherwise create one if needed
            remoteAudioStream = event.streams[0] || new MediaStream([event.track]);
            
            // Cleanup existing remote audio if any
            const existingAudio = document.getElementById('remote-audio');
            if (existingAudio) {
                console.log('Replacing existing remote audio element');
                existingAudio.srcObject = null;
                existingAudio.remove();
            }

            // Create audio element for remote stream
            const remoteAudio = document.createElement('audio');
            remoteAudio.id = 'remote-audio';
            remoteAudio.srcObject = remoteAudioStream;
            remoteAudio.autoplay = true;
            remoteAudio.playsInline = true;
            remoteAudio.volume = 1.0;
            
            // iOS Safari specific attributes
            if (isIOSSafari) {
                remoteAudio.setAttribute('webkit-playsinline', 'true');
                remoteAudio.setAttribute('playsinline', 'true');
            }
            
            document.body.appendChild(remoteAudio);
            console.log('Remote audio element created');
            
            // Browser-specific playback handling
            const playAudio = () => {
                remoteAudio.play().then(() => {
                    console.log('Remote audio started successfully');
                    // Start monitoring audio levels
                    startAudioLevelMonitoring(remoteAudioStream);
                }).catch(err => console.error('Play failed:', err));
            };
            
            if (isIOSSafari) {
                // iOS Safari needs delay and user interaction
                setTimeout(() => {
                    playAudio();
                }, 500);
                
                const iosHandler = () => {
                    playAudio();
                    document.removeEventListener('touchend', iosHandler);
                    document.removeEventListener('click', iosHandler);
                };
                document.addEventListener('touchend', iosHandler);
                document.addEventListener('click', iosHandler);
            } else {
                // Desktop browsers
                playAudio();
                
                const retryHandler = () => {
                    playAudio();
                    window.removeEventListener('click', retryHandler);
                };
                window.addEventListener('click', retryHandler);
            }
        };
        
        // Handle ICE candidates
        audioPeerConnection.onicecandidate = (event) => {
            if (event.candidate && multiplayerChannel) {
                multiplayerChannel.send({
                    type: 'broadcast',
                    event: 'audio_ice_candidate',
                    payload: {
                        playerId: playerId,
                        candidate: event.candidate
                    }
                });
            }
        };
        
        // Handle connection state changes with reconnection logic
        audioPeerConnection.onconnectionstatechange = () => {
            const state = audioPeerConnection.connectionState;
            console.log('Audio connection state:', state);
            
            if (state === 'connected') {
                audioRetryCount = 0; // Reset retry count
                isReconnecting = false;
                connectionQuality = 'good';
                
                if (audioConnectionTimeoutId) {
                    clearTimeout(audioConnectionTimeoutId);
                    audioConnectionTimeoutId = null;
                }
                
                // Validate audio tracks
                validateAudioConnection();
                
                // Start quality monitoring
                startConnectionQualityMonitoring();
                
                console.log('Audio connection established successfully');
            } else if (state === 'failed') {
                // Connection failed - attempt reconnection
                connectionQuality = 'poor';
                
                if (!isReconnecting && audioRetryCount < MAX_AUDIO_RETRIES) {
                    isReconnecting = true;
                    const delayMs = calculateBackoffDelay(audioRetryCount);
                    console.error(`Audio connection failed. Reconnecting in ${delayMs}ms (${audioRetryCount + 1}/${MAX_AUDIO_RETRIES})`);
                    audioRetryCount++;
                    showAudioError(`Connection lost. Reconnecting (${audioRetryCount}/${MAX_AUDIO_RETRIES})...`);
                    
                    audioRetryTimeoutId = setTimeout(async () => {
                        stopAudioSharing();
                        const success = await initAudioSharing();
                        if (success && multiplayerChannel) {
                            // Re-initiate signaling
                            if (isHost) {
                                setTimeout(() => createAudioOffer(), 1000);
                            } else {
                                multiplayerChannel.send({
                                    type: 'broadcast',
                                    event: 'audio_request',
                                    payload: { playerId: playerId }
                                });
                            }
                        }
                        isReconnecting = false;
                    }, delayMs);
                } else if (audioRetryCount >= MAX_AUDIO_RETRIES) {
                    console.error('Audio connection failed after maximum retries');
                    showAudioError('Audio connection lost. Cannot reconnect.');
                    audioRetryCount = 0;
                    isReconnecting = false;
                }
            } else if (state === 'disconnected') {
                connectionQuality = 'fair';
                console.warn('Audio connection disconnected');
                // Give it a moment to reconnect on its own
                setTimeout(() => {
                    if (audioPeerConnection && audioPeerConnection.connectionState === 'disconnected') {
                        console.log('Connection still disconnected, triggering reconnection');
                        audioPeerConnection.dispatchEvent(new Event('connectionstatechange'));
                    }
                }, 3000);
            } else if (state === 'closed') {
                if (audioConnectionTimeoutId) {
                    clearTimeout(audioConnectionTimeoutId);
                }
                stopConnectionQualityMonitoring();
                stopAudioLevelMonitoring();
            }
            
            updateAudioStatusIndicator();
        };
        
        // Handle negotiation needed (for track changes)
        audioPeerConnection.onnegotiationneeded = async () => {
            if (!isHost) return; // Only host initiates renegotiation
            console.log('Renegotiation needed');
            try {
                await createAudioOffer();
            } catch (error) {
                console.error('Renegotiation failed:', error);
            }
        };
        
        isAudioEnabled = true;
        setupGlobalAudioResumeListener();

        // Set up connection timeout with retry logic
        audioConnectionStartTime = Date.now();
        audioConnectionTimeoutId = setTimeout(() => {
            if (audioPeerConnection && audioPeerConnection.connectionState === 'connecting') {
                console.error('Audio connection timeout after ' + AUDIO_CONNECTION_TIMEOUT + 'ms');
                
                if (audioRetryCount < MAX_AUDIO_RETRIES) {
                    const delayMs = calculateBackoffDelay(audioRetryCount);
                    audioRetryCount++;
                    showAudioError(`Connection timeout. Retrying (${audioRetryCount}/${MAX_AUDIO_RETRIES})...`);
                    
                    audioRetryTimeoutId = setTimeout(() => {
                        stopAudioSharing();
                        initAudioSharing();
                    }, delayMs);
                } else {
                    showAudioError('Connection timeout after multiple attempts.');
                    stopAudioSharing();
                    isAudioEnabled = false;
                    audioRetryCount = 0;
                }
            }
        }, AUDIO_CONNECTION_TIMEOUT);

        // Process any queued signaling messages
        processAudioSignalingQueue();

        return true;
        
    } catch (error) {
        console.error('Error initializing audio sharing:', error);
        return false;
    }
}

async function createAudioOffer() {
    if (!audioPeerConnection || !isHost) return;
    
    try {
        const offer = await audioPeerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: false
        });
        await audioPeerConnection.setLocalDescription(offer);
        
        multiplayerChannel.send({
            type: 'broadcast',
            event: 'audio_offer',
            payload: {
                playerId: playerId,
                offer: offer
            }
        });
        console.log('Audio offer sent');
    } catch (error) {
        console.error('Error creating audio offer:', error);
    }
}

async function handleAudioOffer(data) {
    if (!audioPeerConnection || isHost) {
        if (!isHost) {
            console.log('Queuing audio offer - peer connection not ready');
            audioSignalingQueue.push({ type: 'offer', data });
        }
        return;
    }
    
    try {
        await audioPeerConnection.setRemoteDescription(data.offer);
        const answer = await audioPeerConnection.createAnswer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: false
        });
        await audioPeerConnection.setLocalDescription(answer);
        
        multiplayerChannel.send({
            type: 'broadcast',
            event: 'audio_answer',
            payload: {
                playerId: playerId,
                answer: answer
            }
        });
        console.log('Audio answer sent');
        
        // Now that remote description is set, process any queued ICE candidates
        processIceCandidatesQueue();
    } catch (error) {
        console.error('Error handling audio offer:', error);
    }
}

async function handleAudioAnswer(data) {
    if (!audioPeerConnection || !isHost) {
        if (isHost) {
            console.log('Queuing audio answer - peer connection not ready');
            audioSignalingQueue.push({ type: 'answer', data });
        }
        return;
    }
    
    try {
        await audioPeerConnection.setRemoteDescription(data.answer);
        console.log('Audio answer received and set');
        
        // Now that remote description is set, process any queued ICE candidates
        processIceCandidatesQueue();
    } catch (error) {
        console.error('Error handling audio answer:', error);
    }
}

async function handleAudioIceCandidate(data) {
    if (!audioPeerConnection) {
        console.log('Queuing ICE candidate - peer connection not ready');
        // Respect queue size limit
        if (audioIceCandidatesQueue.length < MAX_ICE_QUEUE) {
            audioIceCandidatesQueue.push(data.candidate);
        } else {
            console.warn('ICE candidate queue full, dropping oldest');
            audioIceCandidatesQueue.shift();
            audioIceCandidatesQueue.push(data.candidate);
        }
        return;
    }
    
    // Candidates can only be added AFTER setRemoteDescription
    if (audioPeerConnection.remoteDescription && audioPeerConnection.remoteDescription.type) {
        try {
            await audioPeerConnection.addIceCandidate(data.candidate);
        } catch (error) {
            console.error('Error adding ICE candidate:', error);
        }
    } else {
        console.log('Queuing ICE candidate - remote description not set');
        if (audioIceCandidatesQueue.length < MAX_ICE_QUEUE) {
            audioIceCandidatesQueue.push(data.candidate);
        }
    }
}

function processAudioSignalingQueue() {
    console.log('Processing audio signaling queue:', audioSignalingQueue.length);
    while (audioSignalingQueue.length > 0) {
        const item = audioSignalingQueue.shift();
        if (item.type === 'offer') {
            handleAudioOffer(item.data);
        } else if (item.type === 'answer') {
            handleAudioAnswer(item.data);
        }
    }
}

async function processIceCandidatesQueue() {
    if (!audioPeerConnection) return;
    console.log('Processing ICE candidates queue:', audioIceCandidatesQueue.length);
    while (audioIceCandidatesQueue.length > 0) {
        const candidate = audioIceCandidatesQueue.shift();
        try {
            await audioPeerConnection.addIceCandidate(candidate);
        } catch (error) {
            console.error('Error processing queued ICE candidate:', error);
        }
    }
}

function stopAudioSharing() {
    // Clear all timeouts
    if (audioRetryTimeoutId) {
        clearTimeout(audioRetryTimeoutId);
        audioRetryTimeoutId = null;
    }
    
    if (audioConnectionTimeoutId) {
        clearTimeout(audioConnectionTimeoutId);
        audioConnectionTimeoutId = null;
    }
    
    // Stop monitoring
    stopConnectionQualityMonitoring();
    stopAudioLevelMonitoring();
    
    // Stop local stream
    if (localAudioStream) {
        localAudioStream.getTracks().forEach(track => track.stop());
        localAudioStream = null;
    }
    
    // Close peer connection
    if (audioPeerConnection) {
        // Remove event handlers to prevent leaks
        audioPeerConnection.ontrack = null;
        audioPeerConnection.onicecandidate = null;
        audioPeerConnection.onconnectionstatechange = null;
        audioPeerConnection.onnegotiationneeded = null;
        audioPeerConnection.close();
        audioPeerConnection = null;
    }
    
    // Remove remote audio element safely
    const remoteAudio = document.getElementById('remote-audio');
    if (remoteAudio) {
        remoteAudio.srcObject = null;
        remoteAudio.pause();
        remoteAudio.remove();
    }
    
    // Clear queues
    audioSignalingQueue = [];
    audioIceCandidatesQueue = [];
    audioConnectionStartTime = null;
    connectionQuality = 'unknown';
    isReconnecting = false;

    isAudioEnabled = false;
    isMuted = false;
}

function toggleMute() {
    if (!localAudioStream) return;
    
    isMuted = !isMuted;
    localAudioStream.getAudioTracks().forEach(track => {
        track.enabled = !isMuted;
    });
    
    console.log(isMuted ? 'Microphone muted' : 'Microphone unmuted');
}

function updateAudioStatusIndicator() {
    // This will be called by the game scene to update UI
    const event = new CustomEvent('audioStatusChanged', { 
        detail: { 
            isEnabled: isAudioEnabled, 
            isMuted: isMuted,
            connectionState: audioPeerConnection?.connectionState || 'disconnected'
        } 
    });
    window.dispatchEvent(event);
}

function validateAudioConnection() {
    if (!audioPeerConnection) return false;
    
    // Check for actual audio tracks
    const receivers = audioPeerConnection.getReceivers();
    const audioTracks = receivers.filter(r => r.track && r.track.kind === 'audio');
    
    if (audioTracks.length === 0) {
        console.warn('No audio tracks received from peer');
        return false;
    }
    
    // Check if tracks are enabled
    const activeTracks = audioTracks.filter(t => t.track.enabled);
    console.log('Active audio tracks:', activeTracks.length);
    return activeTracks.length > 0;
}

function showAudioError(message) {
    console.error('Audio Error:', message);
    // Dispatch event for UI to show error
    const event = new CustomEvent('audioError', { detail: { message } });
    window.dispatchEvent(event);
}

function startAudioStatsMonitoring() {
    if (!audioPeerConnection) return;
    
    const statsInterval = setInterval(async () => {
        if (!audioPeerConnection) {
            clearInterval(statsInterval);
            return;
        }
        
        try {
            const stats = await audioPeerConnection.getStats();
            stats.forEach(report => {
                if (report.type === 'inbound-rtp' && report.mediaType === 'audio') {
                    if (report.bytesReceived > 0) {
                        console.log('Audio RTP - Bytes received:', report.bytesReceived, 
                                  'Packets lost:', report.packetsLost || 0,
                                  'Jitter:', (report.jitter || 0).toFixed(4));
                    }
                }
            });
        } catch (error) {
            console.warn('Error getting audio stats:', error);
            clearInterval(statsInterval);
        }
    }, 5000);
}

function startConnectionQualityMonitoring() {
    if (audioQualityMonitorInterval) return;
    
    audioQualityMonitorInterval = setInterval(async () => {
        if (!audioPeerConnection) {
            stopConnectionQualityMonitoring();
            return;
        }
        
        try {
            const stats = await audioPeerConnection.getStats();
            let packetsLost = 0;
            let packetsReceived = 0;
            let jitter = 0;
            
            stats.forEach(report => {
                if (report.type === 'inbound-rtp' && report.mediaType === 'audio') {
                    packetsLost = report.packetsLost || 0;
                    packetsReceived = report.packetsReceived || 0;
                    jitter = report.jitter || 0;
                }
            });
            
            // Calculate packet loss percentage
            const totalPackets = packetsReceived + packetsLost;
            const lossRate = totalPackets > 0 ? (packetsLost / totalPackets) * 100 : 0;
            
            // Determine quality
            if (lossRate < 1 && jitter < 0.03) {
                connectionQuality = 'excellent';
            } else if (lossRate < 3 && jitter < 0.05) {
                connectionQuality = 'good';
            } else if (lossRate < 5 && jitter < 0.1) {
                connectionQuality = 'fair';
            } else {
                connectionQuality = 'poor';
                if (lossRate > 10) {
                    console.warn('Poor audio quality detected:', lossRate.toFixed(1), '% packet loss');
                }
            }
            
            updateAudioStatusIndicator();
        } catch (error) {
            console.warn('Error monitoring connection quality:', error);
        }
    }, 2000); // Check every 2 seconds
}

function stopConnectionQualityMonitoring() {
    if (audioQualityMonitorInterval) {
        clearInterval(audioQualityMonitorInterval);
        audioQualityMonitorInterval = null;
    }
}

function startAudioLevelMonitoring(stream) {
    if (audioLevelCheckInterval || !stream) return;
    
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const analyser = audioContext.createAnalyser();
        const microphone = audioContext.createMediaStreamSource(stream);
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        
        microphone.connect(analyser);
        analyser.fftSize = 256;
        
        audioLevelCheckInterval = setInterval(() => {
            analyser.getByteFrequencyData(dataArray);
            
            // Calculate average audio level
            const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
            const normalizedLevel = average / 255;
            
            lastAudioLevel = normalizedLevel;
            
            // Detect prolonged silence
            if (normalizedLevel < SILENCE_THRESHOLD) {
                silenceDetectionCount++;
                if (silenceDetectionCount > MAX_SILENCE_CHECKS) {
                    console.warn('No audio detected for', MAX_SILENCE_CHECKS, 'seconds');
                    showAudioError('No audio detected. Check if partner is muted.');
                    silenceDetectionCount = 0; // Reset to avoid spam
                }
            } else {
                silenceDetectionCount = 0; // Reset when audio detected
            }
        }, 1000); // Check every second
        
    } catch (error) {
        console.warn('Could not start audio level monitoring:', error);
    }
}

function stopAudioLevelMonitoring() {
    if (audioLevelCheckInterval) {
        clearInterval(audioLevelCheckInterval);
        audioLevelCheckInterval = null;
    }
    lastAudioLevel = 0;
    silenceDetectionCount = 0;
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
    // User icon (single person)
    drawUser(g, x, y, size = 20, color = 0x00ff88, stroke = 2) {
        g.lineStyle(stroke, color);
        const s = size / 2;
        // Head (circle)
        g.strokeCircle(x, y - s * 0.5, s * 0.4);
        // Body (arc/shoulders)
        g.beginPath();
        g.arc(x, y + s * 0.8, s * 0.7, Math.PI * 1.2, Math.PI * 1.8, false);
        g.strokePath();
    },
    // Users icon (two people)
    drawUsers(g, x, y, size = 20, color = 0x00ccff, stroke = 2) {
        g.lineStyle(stroke, color);
        const s = size / 2;
        // Front person head
        g.strokeCircle(x - s * 0.2, y - s * 0.4, s * 0.35);
        // Front person body
        g.beginPath();
        g.arc(x - s * 0.2, y + s * 0.7, s * 0.55, Math.PI * 1.2, Math.PI * 1.8, false);
        g.strokePath();
        // Back person head (slightly behind)
        g.strokeCircle(x + s * 0.5, y - s * 0.55, s * 0.3);
        // Back person body
        g.beginPath();
        g.arc(x + s * 0.5, y + s * 0.5, s * 0.45, Math.PI * 1.25, Math.PI * 1.75, false);
        g.strokePath();
    },
    // Home icon
    drawHome(g, x, y, size = 20, color = 0x00ff88, stroke = 2) {
        g.lineStyle(stroke, color);
        const s = size / 2;
        // Roof (triangle)
        g.beginPath();
        g.moveTo(x, y - s);
        g.lineTo(x + s, y);
        g.lineTo(x - s, y);
        g.closePath();
        g.strokePath();
        // House body
        g.strokeRect(x - s * 0.7, y, s * 1.4, s * 0.9);
        // Door
        g.strokeRect(x - s * 0.2, y + s * 0.3, s * 0.4, s * 0.6);
    },
    // Link icon
    drawLink(g, x, y, size = 20, color = 0x00ccff, stroke = 2) {
        g.lineStyle(stroke, color);
        const s = size / 2;
        // First chain link
        g.beginPath();
        g.arc(x - s * 0.4, y - s * 0.2, s * 0.4, Math.PI * 0.75, Math.PI * 1.75, false);
        g.arc(x - s * 0.1, y + s * 0.1, s * 0.4, Math.PI * 1.75, Math.PI * 0.75, false);
        g.closePath();
        g.strokePath();
        // Second chain link
        g.beginPath();
        g.arc(x + s * 0.4, y + s * 0.2, s * 0.4, Math.PI * 1.75, Math.PI * 0.75, false);
        g.arc(x + s * 0.1, y - s * 0.1, s * 0.4, Math.PI * 0.75, Math.PI * 1.75, false);
        g.closePath();
        g.strokePath();
    },
    // Chevron Left (back arrow)
    drawChevronLeft(g, x, y, size = 16, color = 0x888888, stroke = 2) {
        g.lineStyle(stroke, color);
        const s = size / 2;
        g.beginPath();
        g.moveTo(x + s * 0.4, y - s);
        g.lineTo(x - s * 0.4, y);
        g.lineTo(x + s * 0.4, y + s);
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
        if (this.textures.exists('poster')) {
            const poster = this.add.image(width / 2, height / 2, 'poster');
            const scale = Math.min(width / poster.width, height / poster.height);
            poster.setScale(isCompact ? scale * 0.92 : scale);
            poster.setAlpha(0);

            this.tweens.add({
                targets: poster, alpha: 1, duration: 800, ease: 'Power2'
            });
        }

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
            // Check if scene and highScoreText still exist to avoid console errors or crashes
            if (this.scene && this.scene.isActive('SplashScene') && this.highScoreText && this.highScoreText.active) {
                const topScore = scores && scores.length > 0 ? scores[0].score : 0;
                this.highScoreText.setText(`BEAT THE CURRENT HIGH SCORE: ${topScore}`);
            }
        }).catch(err => {
            console.warn('Leaderboard fetch failed (expected if local or offline):', err);
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
                    this.scene.start('ModeSelectScene');
                });
            }
        };

        // --- INPUTS ---
        const hitArea = this.add.rectangle(0, 0, width, height, 0x000000, 0).setOrigin(0).setInteractive({ useHandCursor: true });
        hitArea.on('pointerdown', handleInput);
        this.input.keyboard.on('keydown', handleInput);

        console.log("SplashScene ready. Two-step start active.");
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

        const singleText = this.add.text(width / 2 + 12, singleY - 12, 'SINGLE PLAYER', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: isMobile ? '18px' : (isCompact ? '22px' : '26px'),
            color: '#00ff88'
        }).setOrigin(0.5);
        
        // User icon for single player
        const singleIcon = this.add.graphics();
        const singleIconSize = isMobile ? 18 : (isCompact ? 22 : 26);
        Icons.drawUser(singleIcon, singleText.x - singleText.width/2 - singleIconSize, singleY - 12, singleIconSize, 0x00ff88, 2);

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

        // Users icon for multiplayer
        const multiIcon = this.add.graphics();
        const multiIconSize = isMobile ? 20 : (isCompact ? 24 : 28);
        Icons.drawUsers(multiIcon, multiText.x - multiText.width/2 - multiIconSize, multiY - 12, multiIconSize, 0x00ccff, 2);

        this.add.text(width / 2, multiY + 16, 'Team up with a friend!', {
            fontFamily: 'Outfit, sans-serif',
            fontSize: isMobile ? '12px' : (isCompact ? '14px' : '16px'),
            color: '#aaccff'
        }).setOrigin(0.5);

        // Multiplayer availability check
        if (!supabaseClient) {
            multiBg.setAlpha(0.5);
            multiBg.disableInteractive();
            this.add.text(width / 2, multiY + 40, '(Requires online connection)', {
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
        const backBtn = this.add.text(36, 20, 'BACK', {
            fontFamily: 'Outfit, sans-serif',
            fontSize: '14px',
            color: '#888888'
        }).setInteractive({ useHandCursor: true });
        
        const backIcon = this.add.graphics();
        Icons.drawChevronLeft(backIcon, 20, 27, 14, 0x888888, 2);

        backBtn.on('pointerover', () => {
            backBtn.setColor('#ffffff');
            backIcon.clear();
            Icons.drawChevronLeft(backIcon, 20, 27, 14, 0xffffff, 2);
        });
        backBtn.on('pointerout', () => {
            backBtn.setColor('#888888');
            backIcon.clear();
            Icons.drawChevronLeft(backIcon, 20, 27, 14, 0x888888, 2);
        });
        backBtn.on('pointerdown', () => {
            this.cameras.main.fadeOut(200, 0, 0, 0);
            this.cameras.main.once('camerafadeoutcomplete', () => {
                this.scene.start('SplashScene');
            });
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
        const backBtn = this.add.text(36, 20, 'BACK', {
            fontFamily: 'Outfit, sans-serif',
            fontSize: '14px',
            color: '#888888'
        }).setInteractive({ useHandCursor: true });

        const backIcon = this.add.graphics();
        Icons.drawChevronLeft(backIcon, 20, 27, 14, 0x888888, 2);

        backBtn.on('pointerover', () => {
            backBtn.setColor('#ffffff');
            backIcon.clear();
            Icons.drawChevronLeft(backIcon, 20, 27, 14, 0xffffff, 2);
        });
        backBtn.on('pointerout', () => {
            backBtn.setColor('#888888');
            backIcon.clear();
            Icons.drawChevronLeft(backIcon, 20, 27, 14, 0x888888, 2);
        });
        backBtn.on('pointerdown', () => {
            this.cleanup();
            this.cameras.main.fadeOut(200, 0, 0, 0);
            this.cameras.main.once('camerafadeoutcomplete', () => {
                this.scene.start('ModeSelectScene');
            });
        });

        this.events.once('shutdown', () => this.cleanup());
        this.cameras.main.fadeIn(300);
    }

    cleanup() {
        if (this.roomSubscription) {
            supabaseClient.removeChannel(this.roomSubscription);
            this.roomSubscription = null;
        }
        if (this.inputEl && this.inputEl.parentNode) {
            this.inputEl.parentNode.removeChild(this.inputEl);
            this.inputEl = null;
        }
        // If we created a room but didn't start, delete it
        if (isHost && roomId && this.lobbyState === 'waiting') {
            deleteRoom();
        }
    }

    createLobbyMenu() {
        const { width, height } = this.scale;
        const isCompact = isCompactViewport(width, height);
        const isMobile = width < 500;

        // Container for menu items (so we can destroy and recreate)
        if (this.menuContainer) {
            this.menuContainer.destroy();
        }
        this.menuContainer = this.add.container(0, 0);

        const btnWidth = isMobile ? 220 : (isCompact ? 280 : 340);
        const btnHeight = isMobile ? 60 : (isCompact ? 70 : 80);
        const btnY = height * 0.40;

        // Create Room Button
        const createBg = this.add.rectangle(width / 2, btnY, btnWidth, btnHeight, 0x1a3a2a, 0.9)
            .setStrokeStyle(3, 0x00ff88, 1)
            .setInteractive({ useHandCursor: true });

        const createText = this.add.text(width / 2 + 14, btnY, 'CREATE ROOM', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: isMobile ? '18px' : (isCompact ? '22px' : '26px'),
            color: '#00ff88'
        }).setOrigin(0.5);

        // Home icon for create room
        const createIcon = this.add.graphics();
        const createIconSize = isMobile ? 20 : (isCompact ? 24 : 28);
        Icons.drawHome(createIcon, createText.x - createText.width/2 - createIconSize, btnY, createIconSize, 0x00ff88, 2);

        this.menuContainer.add([createBg, createText, createIcon]);

        createBg.on('pointerover', () => createBg.setStrokeStyle(4, 0x00ff88, 1));
        createBg.on('pointerout', () => createBg.setStrokeStyle(3, 0x00ff88, 1));
        createBg.on('pointerdown', () => this.showCreateRoom());

        // Join Room Button
        const joinY = btnY + btnHeight + 30;
        const joinBg = this.add.rectangle(width / 2, joinY, btnWidth, btnHeight, 0x1a2a3a, 0.9)
            .setStrokeStyle(3, 0x00ccff, 1)
            .setInteractive({ useHandCursor: true });

        const joinText = this.add.text(width / 2 + 14, joinY, 'JOIN ROOM', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: isMobile ? '18px' : (isCompact ? '22px' : '26px'),
            color: '#00ccff'
        }).setOrigin(0.5);

        // Link icon for join room
        const joinIcon = this.add.graphics();
        const joinIconSize = isMobile ? 20 : (isCompact ? 24 : 28);
        Icons.drawLink(joinIcon, joinText.x - joinText.width/2 - joinIconSize, joinY, joinIconSize, 0x00ccff, 2);

        this.menuContainer.add([joinBg, joinText, joinIcon]);

        joinBg.on('pointerover', () => joinBg.setStrokeStyle(4, 0x00ccff, 1));
        joinBg.on('pointerout', () => joinBg.setStrokeStyle(3, 0x00ccff, 1));
        joinBg.on('pointerdown', () => this.showJoinRoom());

        // Instructions
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
        const isCompact = isCompactViewport(width, height);
        const isMobile = width < 500;

        this.lobbyState = 'creating';
        this.menuContainer.destroy();
        this.menuContainer = this.add.container(0, 0);

        // Show creating message
        const creatingText = this.add.text(width / 2, height * 0.4, 'Creating room...', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: '20px',
            color: '#ffffff'
        }).setOrigin(0.5);
        this.menuContainer.add(creatingText);

        // Create the room
        const room = await createRoom(selectedCharacter);
        
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
        const isCompact = isCompactViewport(width, height);
        const isMobile = width < 500;

        this.lobbyState = 'waiting';
        this.menuContainer.destroy();
        this.menuContainer = this.add.container(0, 0);

        // Room code display
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

        // Copy button
        const copyLabel = this.add.text(width / 2, height * 0.42, 'CLICK TO COPY', {
            fontFamily: 'Outfit, sans-serif',
            fontSize: '10px',
            color: '#00ccff',
            backgroundColor: '#000000',
            padding: { left: 8, right: 8, top: 4, bottom: 4 }
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        this.menuContainer.add([codeBox, codeText, copyLabel]);

        const copyToClipboard = () => {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(roomCode).then(() => {
                    copyLabel.setText('COPIED!');
                    copyLabel.setColor('#ffffff');
                    copyLabel.setBackgroundColor('#008800');
                    this.time.delayedCall(2000, () => {
                        if (copyLabel.active) {
                            copyLabel.setText('CLICK TO COPY');
                            copyLabel.setColor('#00ccff');
                            copyLabel.setBackgroundColor('#000000');
                        }
                    });
                });
            } else {
                // Fallback for older browsers
                const textArea = document.createElement("textarea");
                textArea.value = roomCode;
                document.body.appendChild(textArea);
                textArea.select();
                try {
                    document.execCommand('copy');
                    copyLabel.setText('COPIED!');
                } catch (err) {
                    console.error('Fallback copy failed', err);
                }
                document.body.removeChild(textArea);
            }
        };

        codeBox.setInteractive({ useHandCursor: true });
        codeText.setInteractive({ useHandCursor: true });
        
        codeBox.on('pointerdown', copyToClipboard);
        codeText.on('pointerdown', copyToClipboard);
        copyLabel.on('pointerdown', copyToClipboard);

        // Waiting message with animation
        const waitingText = this.add.text(width / 2, height * 0.50, 'Waiting for player to join...', {
            fontFamily: 'Outfit, sans-serif',
            fontSize: '16px',
            color: '#ffffff'
        }).setOrigin(0.5);
        this.menuContainer.add(waitingText);

        // Animated dots
        let dots = 0;
        this.dotsTimer = this.time.addEvent({
            delay: 500,
            callback: () => {
                dots = (dots + 1) % 4;
                waitingText.setText('Waiting for player to join' + '.'.repeat(dots));
            },
            loop: true
        });

        // Share instructions
        const shareText = this.add.text(width / 2, height * 0.60, 
            'Share this code with your friend!', {
            fontFamily: 'Outfit, sans-serif',
            fontSize: '14px',
            color: '#aaaaaa'
        }).setOrigin(0.5);
        this.menuContainer.add(shareText);

        // Cancel button
        const cancelBtn = this.add.text(width / 2, height * 0.75, 'CANCEL', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: '18px',
            color: '#ff6666',
            backgroundColor: '#330000',
            padding: { left: 20, right: 20, top: 8, bottom: 8 }
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });
        this.menuContainer.add(cancelBtn);

        cancelBtn.on('pointerdown', async () => {
            if (this.dotsTimer) this.dotsTimer.destroy();
            await deleteRoom();
            cleanupMultiplayerState();
            this.lobbyState = 'menu';
            this.createLobbyMenu();
        });

        // Subscribe to room changes (wait for guest to join)
        this.roomSubscription = supabaseClient
            .channel(`room-${roomId}`)
            .on('postgres_changes', 
                { event: 'UPDATE', schema: 'public', table: 'game_rooms', filter: `id=eq.${roomId}` },
                (payload) => {
                    console.log('Room updated:', payload);
                    if (payload.new.guest_id && payload.new.status === 'playing') {
                        // Guest joined!
                        remotePlayerId = payload.new.guest_id;
                        remoteCharacter = payload.new.guest_character;
                        this.startMultiplayerGame();
                    }
                }
            )
            .subscribe();
    }

    showJoinRoom() {
        const { width, height } = this.scale;
        const isCompact = isCompactViewport(width, height);
        const isMobile = width < 500;

        this.lobbyState = 'joining';
        this.menuContainer.destroy();
        this.menuContainer = this.add.container(0, 0);

        // Input label
        const labelText = this.add.text(width / 2, height * 0.30, 'ENTER ROOM CODE', {
            fontFamily: 'Outfit, sans-serif',
            fontSize: '14px',
            color: '#888888'
        }).setOrigin(0.5);
        this.menuContainer.add(labelText);

        // Create DOM input for room code
        const canvasRect = this.game.canvas.getBoundingClientRect();
        this.inputEl = document.createElement('input');
        this.inputEl.type = 'text';
        this.inputEl.placeholder = '0000';
        this.inputEl.maxLength = 4;
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

        // Disable keyboard capture for typing
        this.input.keyboard.removeCapture('W,A,S,D');
        this.input.keyboard.removeCapture([32, 37, 38, 39, 40]);

        // Status text
        this.statusText = this.add.text(width / 2, height * 0.55, '', {
            fontFamily: 'Outfit, sans-serif',
            fontSize: '14px',
            color: '#ffffff'
        }).setOrigin(0.5);
        this.menuContainer.add(this.statusText);

        // Join button
        const joinBtn = this.add.text(width / 2, height * 0.65, 'JOIN', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: '22px',
            color: '#000000',
            backgroundColor: '#00ccff',
            padding: { left: 40, right: 40, top: 10, bottom: 10 }
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });
        this.menuContainer.add(joinBtn);

        joinBtn.on('pointerdown', () => this.attemptJoin());

        // Also allow Enter key to join
        this.inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.attemptJoin();
            }
        });

        // Cancel button
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
            this.lobbyState = 'menu';
            this.createLobbyMenu();
        });
    }

    async attemptJoin() {
        const code = this.inputEl.value.trim();
        
        if (code.length !== 4 || !/^\d{4}$/.test(code)) {
            this.statusText.setText('Please enter a 4-digit code');
            this.statusText.setColor('#ff6666');
            return;
        }

        this.statusText.setText('Joining room...');
        this.statusText.setColor('#ffffff');

        const room = await joinRoom(code, selectedCharacter);
        
        if (!room) {
            this.statusText.setText('Room not found or already full');
            this.statusText.setColor('#ff6666');
            return;
        }

        // Successfully joined - go to character select then game
        if (this.inputEl && this.inputEl.parentNode) {
            this.inputEl.parentNode.removeChild(this.inputEl);
            this.inputEl = null;
        }

        this.startMultiplayerGame();
    }

    startMultiplayerGame() {
        if (this.dotsTimer) this.dotsTimer.destroy();
        if (this.roomSubscription) {
            supabaseClient.removeChannel(this.roomSubscription);
            this.roomSubscription = null;
        }
        if (this.inputEl && this.inputEl.parentNode) {
            this.inputEl.parentNode.removeChild(this.inputEl);
            this.inputEl = null;
        }

        // Both players now go to character select (but their choice is already made)
        // For simplicity, we'll skip character select in multiplayer and go straight to game
        this.cameras.main.fadeOut(300, 0, 0, 0);
        this.cameras.main.once('camerafadeoutcomplete', () => {
            this.scene.start('GameScene');
        });
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
        this.load.audio('rain_ambient', 'assets/rain_background.mp3');
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
        this.displayedScore = 0;

        // Multiplayer state
        this.isMultiplayer = gameMode === 'multi';
        this.teamScore = 0;
        this.remotePlayer = null;
        this.remotePlayerGraphics = null;
        this.remoteCarried = [];
        this.lastBroadcastTime = 0;
        this.disconnectTimer = null;
        this.partnerDisconnected = false;
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

        this.calculateLayout();

        this.cars = this.add.group();
        this.newts = this.add.group();

        this.createEnvironment();
        this.createPlayer();
        
        // Create remote player for multiplayer
        if (this.isMultiplayer) {
            this.createRemotePlayer();
            this.setupMultiplayerSync();
            // Initialize audio sharing for multiplayer
            this.initMultiplayerAudio();
        }
        
        this.createHUD();
        this.createControls();

        // Track dimensions for resize logic
        this.lastWidth = this.scale.width;
        this.lastHeight = this.scale.height;

        this.scale.on('resize', (gameSize) => {
            // Don't restart during game over to preserve the name input form
            if (this.gameOver) return;

            // In multiplayer, browser bars (like the microphone permission bar) can trigger 
            // resize events. Restarting the scene breaks the real-time sync.
            // We ignore small height changes usually caused by browser UI elements.
            const heightDiff = Math.abs(gameSize.height - this.lastHeight);
            const widthDiff = Math.abs(gameSize.width - this.lastWidth);
            
            if (this.isMultiplayer && heightDiff < 120 && widthDiff < 20) {
                console.log('Ignoring small resize (likely browser UI change) during multiplayer');
                return;
            }

            this.lastWidth = gameSize.width;
            this.lastHeight = gameSize.height;
            this.scene.restart();
        });

        // Only host spawns cars and newts in multiplayer
        if (!this.isMultiplayer || isHost) {
            this.carTimer = this.time.addEvent({
                delay: GAME_CONFIG.CAR_SPAWN_RATE,
                callback: this.spawnCar,
                callbackScope: this,
                loop: true
            });
            this.time.addEvent({ delay: GAME_CONFIG.NEWT_SPAWN_RATE, callback: this.spawnNewt, callbackScope: this, loop: true });
            this.spawnNewt();
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

        // Rain ambient sound with fade-in
        if (this.cache.audio.exists('rain_ambient')) {
            this.rainSound = this.sound.add('rain_ambient', { loop: true, volume: 0 });
            this.rainSound.play();
            // Fade in over 2 seconds
            this.tweens.add({
                targets: this.rainSound,
                volume: 0.4,
                duration: 2000,
                ease: 'Power2'
            });
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
        
        // Safety check for texture before creating images
        if (this.textures.exists('newtXing')) {
            this.add.image(signOffset, this.topSafe - topTextOffset, 'newtXing').setDisplaySize(signSize, signSize);
            this.add.image(width - signOffset, this.botSafe - topTextOffset, 'newtXing').setDisplaySize(signSize, signSize);
        }
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

    async initMultiplayerAudio() {
        console.log('Initializing multiplayer audio...');
        
        // Initialize WebRTC audio
        const audioInitialized = await initAudioSharing();
        
        if (audioInitialized) {
            console.log('Audio initialized, checking for partner...');
            
            // Start monitoring audio quality
            startAudioStatsMonitoring();
            
            // If we are the guest, send a request to the host to start signaling
            // If the host is already in the channel, they will reply with an offer
            if (!isHost && multiplayerChannel) {
                console.log('Guest sending audio request...');
                multiplayerChannel.send({
                    type: 'broadcast',
                    event: 'audio_request',
                    payload: { playerId: playerId }
                });
            } else if (isHost) {
                // Host still waits a bit just in case guest is already there
                this.time.delayedCall(2000, () => {
                    console.log('Host sending initial audio offer...');
                    createAudioOffer();
                });
            }
            
            // Add mute button to HUD
            this.createMuteButton();
        } else {
            console.warn('Failed to initialize audio - microphone permission may be denied');
        }
    }

    createMuteButton() {
        const { width } = this.scale;
        const padding = this.isCompact ? 12 : 20;
        
        // Create mute button in top-right area, below score
        const muteBtnSize = this.isCompact ? 32 : 40;
        const muteBtnX = width - padding - muteBtnSize / 2;
        const muteBtnY = padding + (this.isCompact ? 50 : 65);
        
        // Button background
        this.muteBtnBg = this.add.rectangle(muteBtnX, muteBtnY, muteBtnSize, muteBtnSize, 0x000000, 0.8)
            .setStrokeStyle(2, 0x00ccff, 0.8)
            .setInteractive({ useHandCursor: true })
            .setDepth(200);
        
        // Mute icon (using graphics)
        this.muteIcon = this.add.graphics().setDepth(201);
        this.updateMuteIcon();
        
        // Click handler
        this.muteBtnBg.on('pointerdown', () => {
            toggleMute();
            this.updateMuteIcon();
        });
        
        // Tooltip text
        this.muteTooltip = this.add.text(muteBtnX, muteBtnY + muteBtnSize / 2 + 10, 'Mute', {
            fontFamily: 'Outfit, sans-serif',
            fontSize: '10px',
            color: '#ffffff'
        }).setOrigin(0.5).setDepth(200).setAlpha(0);
        
        // Show tooltip on hover
        this.muteBtnBg.on('pointerover', () => {
            this.muteBtnBg.setAlpha(1);
            this.muteTooltip.setAlpha(1);
        });
        
        this.muteBtnBg.on('pointerout', () => {
            this.muteBtnBg.setAlpha(0.8);
            this.muteTooltip.setAlpha(0);
        });
        
        // Listen for audio status changes
        window.addEventListener('audioStatusChanged', (event) => {
            this.updateMuteIcon();
        });
    }

    updateMuteIcon() {
        if (!this.muteIcon || !this.muteBtnBg) return;
        
        const { width } = this.scale;
        const padding = this.isCompact ? 12 : 20;
        const muteBtnSize = this.isCompact ? 32 : 40;
        const muteBtnX = width - padding - muteBtnSize / 2;
        const muteBtnY = padding + (this.isCompact ? 50 : 65);
        
        this.muteIcon.clear();
        
        // Get connection state
        const connState = audioPeerConnection?.connectionState || 'disconnected';
        let borderColor = 0x00ccff; // Default cyan
        let tooltipText = isMuted ? 'Unmute' : 'Mute';
        
        if (connState === 'connected') {
            borderColor = 0x00ff88; // Neon green
            tooltipText += ' (Connected)';
        } else if (connState === 'connecting' || connState === 'new') {
            borderColor = 0xffcc00; // Gold/Yellow
            tooltipText += ' (Connecting...)';
        } else if (connState === 'failed' || connState === 'closed') {
            borderColor = 0xff3366; // Pink/Red
            tooltipText += ' (Failed/Closed)';
        } else if (connState === 'disconnected') {
            borderColor = 0x888888; // Gray
            tooltipText += ' (Disconnected)';
        }

        this.muteBtnBg.setStrokeStyle(2, borderColor, 0.8);
        if (this.muteTooltip) this.muteTooltip.setText(tooltipText);
        
        if (isMuted) {
            // Muted icon - microphone with slash
            this.drawMutedIcon(this.muteIcon, muteBtnX, muteBtnY, this.isCompact ? 16 : 20, 0xff3366);
        } else {
            // Unmuted icon - microphone
            this.drawMicIcon(this.muteIcon, muteBtnX, muteBtnY, this.isCompact ? 16 : 20, borderColor);
        }
    }

    drawMicIcon(g, x, y, size, color) {
        // Microphone icon
        const s = size / 2;
        g.lineStyle(2, color);
        
        // Mic body (rounded rectangle)
        g.strokeRoundedRect(x - s * 0.3, y - s * 0.5, s * 0.6, s * 0.8, s * 0.15);
        
        // Mic arc at bottom
        g.beginPath();
        g.arc(x, y + s * 0.3, s * 0.4, 0, Math.PI, false);
        g.strokePath();
        
        // Stand
        g.lineBetween(x, y + s * 0.7, x, y + s * 0.5);
        
        // Base
        g.lineBetween(x - s * 0.3, y + s * 0.7, x + s * 0.3, y + s * 0.7);
    }

    drawMutedIcon(g, x, y, size, color) {
        // Muted microphone icon
        const s = size / 2;
        g.lineStyle(2, color);
        
        // Mic body (rounded rectangle)
        g.strokeRoundedRect(x - s * 0.3, y - s * 0.5, s * 0.6, s * 0.8, s * 0.15);
        
        // Mic arc at bottom
        g.beginPath();
        g.arc(x, y + s * 0.3, s * 0.4, 0, Math.PI, false);
        g.strokePath();
        
        // Slash line
        g.lineStyle(3, 0xff6666);
        g.lineBetween(x - s * 0.5, y - s * 0.5, x + s * 0.5, y + s * 0.5);
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

    setupMultiplayerSync() {
        if (!supabaseClient || !roomCode) return;
        
        // Cleanup old channel if exists (e.g. on scene restart)
        if (multiplayerChannel) {
            console.log('Cleaning up old channel before restart');
            supabaseClient.removeChannel(multiplayerChannel);
        }

        // Create broadcast channel for real-time sync
        multiplayerChannel = supabaseClient.channel(`game-${roomCode}`, {
            config: {
                broadcast: { self: false }
            }
        });

        // Listen for remote player updates
        multiplayerChannel.on('broadcast', { event: 'player_update' }, (payload) => {
            if (payload.payload.playerId !== playerId) {
                this.handleRemotePlayerUpdate(payload.payload);
            }
        });

        // Listen for game state updates (from host)
        multiplayerChannel.on('broadcast', { event: 'game_state' }, (payload) => {
            if (!isHost) {
                this.handleGameStateUpdate(payload.payload);
            }
        });

        // Note: newt_spawn events removed - newts are synced via game_state broadcast

        // Listen for newt pickup events
        multiplayerChannel.on('broadcast', { event: 'newt_pickup' }, (payload) => {
            if (payload.payload.playerId !== playerId) {
                this.handleRemoteNewtPickup(payload.payload);
            }
        });

        // Listen for newt save events
        multiplayerChannel.on('broadcast', { event: 'newt_save' }, (payload) => {
            if (isHost || payload.payload.playerId !== playerId) {
                this.handleNewtSave(payload.payload);
            }
        });

        // Listen for partner disconnect
        multiplayerChannel.on('broadcast', { event: 'player_disconnect' }, (payload) => {
            if (payload.payload.playerId !== playerId) {
                this.handlePartnerDisconnect();
            }
        });

        // Listen for game over event (normal end of game)
        multiplayerChannel.on('broadcast', { event: 'game_over' }, (payload) => {
            if (payload.payload.playerId !== playerId && !this.gameOver) {
                this.handleRemoteGameOver(payload.payload);
            }
        });

        // Listen for partner's name during game over screen
        multiplayerChannel.on('broadcast', { event: 'player_name' }, (payload) => {
            if (payload.payload.playerId !== playerId) {
                this.handlePartnerName(payload.payload);
            }
        });

        // Listen for score submission confirmation
        multiplayerChannel.on('broadcast', { event: 'score_submitted' }, (payload) => {
            this.handleScoreSubmitted(payload.payload);
        });

        // Guest -> host hit intent, host -> guest hit outcome
        multiplayerChannel.on('broadcast', { event: 'player_hit_intent' }, (payload) => {
            if (isHost) {
                this.handlePlayerHitIntent(payload.payload);
            }
        });

        multiplayerChannel.on('broadcast', { event: 'player_hit' }, (payload) => {
            this.handlePlayerHitOutcome(payload.payload);
        });

        // Audio sharing signaling
        multiplayerChannel.on('broadcast', { event: 'audio_request' }, (payload) => {
            if (isHost && payload.payload.playerId !== playerId) {
                console.log('Received audio request from guest, creating offer...');
                createAudioOffer();
            }
        });

        multiplayerChannel.on('broadcast', { event: 'audio_offer' }, (payload) => {
            if (payload.payload.playerId !== playerId) {
                handleAudioOffer(payload.payload);
            }
        });

        multiplayerChannel.on('broadcast', { event: 'audio_answer' }, (payload) => {
            if (payload.payload.playerId !== playerId) {
                handleAudioAnswer(payload.payload);
            }
        });

        multiplayerChannel.on('broadcast', { event: 'audio_ice_candidate' }, (payload) => {
            if (payload.payload.playerId !== playerId) {
                handleAudioIceCandidate(payload.payload);
            }
        });

        multiplayerChannel.subscribe((status) => {
            console.log('Multiplayer channel status:', status);
            if (status === 'SUBSCRIBED') {
                // Start broadcasting position
                this.broadcastTimer = this.time.addEvent({
                    delay: 50, // 20Hz broadcast rate
                    callback: this.broadcastPlayerState,
                    callbackScope: this,
                    loop: true
                });
                
                // Start disconnect detection
                lastRemoteUpdate = Date.now();
                this.disconnectCheckTimer = this.time.addEvent({
                    delay: 1000,
                    callback: this.checkPartnerConnection,
                    callbackScope: this,
                    loop: true
                });
            }
        });
    }

    broadcastPlayerState() {
        if (!multiplayerChannel || this.gameOver) return;
        
        const w = this.scale.width;
        const h = this.scale.height;
        
        const payload = {
            playerId: playerId,
            xRatio: this.player.x / w,  // Normalized 0-1
            yRatio: this.player.y / h,
            scaleX: this.player.scaleX,
            carriedCount: this.player.carried.length,
            timestamp: Date.now()
        };

        multiplayerChannel.send({
            type: 'broadcast',
            event: 'player_update',
            payload: payload
        });

        // Host also broadcasts game state
        if (isHost) {
            this.broadcastGameState();
        }
    }

    broadcastGameState() {
        if (!multiplayerChannel || !isHost) return;
        
        const w = this.scale.width;
        const h = this.scale.height;
        
        const newtsData = this.newts.getChildren().map(n => ({
            id: n.newtId,
            xRatio: n.x / w,  // Normalized 0-1
            yRatio: n.y / h,
            dest: n.dest,
            dir: n.dir,
            isCarried: n.isCarried,
            carriedBy: n.carriedBy || null
        }));

        const carsData = this.cars.getChildren().map(c => ({
            id: c.carId,
            xRatio: c.x / w,  // Normalized 0-1
            yRatio: c.y / h,
            speed: c.speed,
            speedRatio: c.speed / w,  // Speed relative to screen width
            type: c.type,
            color: c.carColor,
            dir: c.dir,
            lane: c.lane,
            w: c.w,
            h: c.h
        }));

        const payload = {
            teamScore: this.teamScore,
            lives: this.lives,
            saved: this.saved,
            lost: this.lost,
            difficulty: this.difficulty,
            newts: newtsData,
            cars: carsData
        };

        multiplayerChannel.send({
            type: 'broadcast',
            event: 'game_state',
            payload: payload
        });
    }

    handleRemotePlayerUpdate(data) {
        if (!this.remotePlayer || this.gameOver) return;
        
        lastRemoteUpdate = Date.now();
        
        const w = this.scale.width;
        const h = this.scale.height;
        
        // Convert normalized coordinates to local screen coordinates
        const targetX = data.xRatio * w;
        const targetY = data.yRatio * h;
        
        // Smoothly interpolate to new position
        this.tweens.add({
            targets: this.remotePlayer,
            x: targetX,
            y: targetY,
            duration: 50,
            ease: 'Linear'
        });
        
        this.remotePlayer.scaleX = data.scaleX;
        
        // Update remote carried count for display
        this.remoteCarriedCount = data.carriedCount;
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
        this.updateHUD();
    }

    handleGameStateUpdate(data) {
        if (isHost || this.gameOver) return;
        
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
                if (this.textures.exists('newt')) {
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
        if (data.newtId) {
            const savedNewt = this.newts.getChildren().find(n => n.newtId === data.newtId);
            if (savedNewt) {
                if (this.remotePlayer && this.remotePlayer.carried) {
                    this.remotePlayer.carried = this.remotePlayer.carried.filter(n => n !== savedNewt);
                }
                savedNewt.destroy();
            }
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

    requestPlayerHit() {
        if (!multiplayerChannel || !this.isMultiplayer || isHost || this.gameOver) return;
        const now = Date.now();
        if (now - this.lastHitIntentAt < 1000) return;
        this.lastHitIntentAt = now;
        multiplayerChannel.send({
            type: 'broadcast',
            event: 'player_hit_intent',
            payload: { playerId: playerId, timestamp: now }
        });
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

        multiplayerChannel.send({
            type: 'broadcast',
            event: 'player_hit',
            payload: { playerId: data.playerId, lives: this.lives }
        });
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

        // Enhanced impact particle explosion
        this.createImpactExplosion(this.player.x, this.player.y);

        this.player.carried.forEach(n => n.destroy()); this.player.carried = [];
        this.cameras.main.flash(150, 255, 50, 50, false);
        this.player.invincible = true;
        this.time.delayedCall(2000, () => { this.player.invincible = false; this.player.alpha = 1; });
        this.player.x = this.scale.width / 2;
        this.player.y = this.botSafe + 60;
        if (this.lives <= 0) { this.gameOver = true; this.showGameOver(); }
    }

    createImpactExplosion(x, y) {
        // Create a dramatic explosion effect when player is hit
        const centerX = x;
        const centerY = y;
        
        // Central flash
        const flash = this.add.circle(centerX, centerY, 60, 0xffffff, 0.9);
        flash.setDepth(200);
        this.tweens.add({
            targets: flash,
            scale: 3,
            alpha: 0,
            duration: 300,
            ease: 'Power2',
            onComplete: () => flash.destroy()
        });
        
        // Expanding shockwave ring
        const shockwave = this.add.ellipse(centerX, centerY, 40, 20, 0xff6600, 0);
        shockwave.setStrokeStyle(4, 0xff6600, 0.8);
        shockwave.setDepth(199);
        this.tweens.add({
            targets: shockwave,
            scaleX: 8,
            scaleY: 4,
            alpha: 0,
            duration: 500,
            ease: 'Power2',
            onComplete: () => shockwave.destroy()
        });
        
        // Fire particles - fast moving
        for (let i = 0; i < 20; i++) {
            const angle = (Math.random() * Math.PI * 2);
            const speed = Phaser.Math.Between(100, 250);
            const size = Phaser.Math.Between(6, 14);
            const particle = this.add.circle(
                centerX, centerY, size,
                Phaser.Display.Color.GetColor(
                    255,
                    Phaser.Math.Between(50, 150),
                    0
                ),
                0.9
            );
            particle.setDepth(198);
            
            const targetX = centerX + Math.cos(angle) * speed;
            const targetY = centerY + Math.sin(angle) * speed;
            
            this.tweens.add({
                targets: particle,
                x: targetX,
                y: targetY,
                scale: 0.2,
                alpha: 0,
                duration: 400 + Math.random() * 300,
                ease: 'Power2',
                onComplete: () => particle.destroy()
            });
        }
        
        // Smoke particles - slower, darker
        for (let i = 0; i < 12; i++) {
            const angle = (Math.random() * Math.PI * 2);
            const speed = Phaser.Math.Between(50, 120);
            const particle = this.add.circle(
                centerX, centerY,
                Phaser.Math.Between(8, 16),
                0x333333,
                0.6
            );
            particle.setDepth(197);
            
            const targetX = centerX + Math.cos(angle) * speed;
            const targetY = centerY + Math.sin(angle) * speed - 30; // Drift upward
            
            this.tweens.add({
                targets: particle,
                x: targetX,
                y: targetY,
                scale: 1.5,
                alpha: 0,
                duration: 800 + Math.random() * 400,
                ease: 'Power2',
                onComplete: () => particle.destroy()
            });
        }
        
        // Sparks - small, fast, bright
        for (let i = 0; i < 15; i++) {
            const angle = (Math.random() * Math.PI * 2);
            const speed = Phaser.Math.Between(80, 180);
            const spark = this.add.rectangle(centerX, centerY, 4, 4, 0xffff00, 0.9);
            spark.setDepth(201);
            
            const targetX = centerX + Math.cos(angle) * speed;
            const targetY = centerY + Math.sin(angle) * speed;
            
            this.tweens.add({
                targets: spark,
                x: targetX,
                y: targetY,
                rotation: Math.random() * Math.PI * 4,
                scale: 0.1,
                alpha: 0,
                duration: 300 + Math.random() * 200,
                ease: 'Power2',
                onComplete: () => spark.destroy()
            });
        }
        
        // Debris chunks
        for (let i = 0; i < 8; i++) {
            const angle = (Math.random() * Math.PI * 2);
            const speed = Phaser.Math.Between(60, 140);
            const debris = this.add.rectangle(
                centerX, centerY,
                Phaser.Math.Between(6, 12),
                Phaser.Math.Between(6, 12),
                Phaser.Math.Between(0x333333, 0x666666),
                0.8
            );
            debris.setDepth(196);
            
            const targetX = centerX + Math.cos(angle) * speed;
            const targetY = centerY + Math.sin(angle) * speed;
            
            this.tweens.add({
                targets: debris,
                x: targetX,
                y: targetY,
                rotation: Math.random() * Math.PI * 6,
                alpha: 0,
                duration: 600 + Math.random() * 300,
                ease: 'Power2',
                onComplete: () => debris.destroy()
            });
        }
    }

    checkPartnerConnection() {
        if (this.gameOver || this.partnerDisconnected) return;
        
        const timeSinceUpdate = Date.now() - lastRemoteUpdate;
        // Increased timeout to 30s to allow for browser mic prompts and scene restarts
        if (timeSinceUpdate > 30000) { 
            this.handlePartnerDisconnect();
        }
    }

    handlePartnerDisconnect() {
        if (this.partnerDisconnected) return;
        this.partnerDisconnected = true;
        
        // Show disconnect message and end game
        const { width, height } = this.scale;
        
        const overlay = this.add.rectangle(0, 0, width, height, 0x000000, 0.8).setOrigin(0).setDepth(400);
        const disconnectText = this.add.text(width / 2, height / 2 - 30, 'Partner Disconnected', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: '28px',
            color: '#ff6666',
            stroke: '#000000',
            strokeThickness: 4
        }).setOrigin(0.5).setDepth(401);
        
        const subText = this.add.text(width / 2, height / 2 + 10, 'Game ending...', {
            fontFamily: 'Outfit, sans-serif',
            fontSize: '16px',
            color: '#ffffff'
        }).setOrigin(0.5).setDepth(401);
        
        this.time.delayedCall(2000, () => {
            this.gameOver = true;
            this.score = this.teamScore; // Use team score for leaderboard
            this.showGameOver();
        });
    }

    broadcastDisconnect() {
        if (multiplayerChannel) {
            multiplayerChannel.send({
                type: 'broadcast',
                event: 'player_disconnect',
                payload: { playerId: playerId }
            });
        }
    }

    broadcastGameOver() {
        if (multiplayerChannel) {
            multiplayerChannel.send({
                type: 'broadcast',
                event: 'game_over',
                payload: { 
                    playerId: playerId,
                    teamScore: this.teamScore,
                    saved: this.saved,
                    lost: this.lost,
                    maxStreak: this.maxStreak
                }
            });
        }
    }

    handleRemoteGameOver(data) {
        if (this.gameOver) return;
        
        // Sync final stats from the host/partner
        if (data.teamScore !== undefined) this.teamScore = data.teamScore;
        if (data.saved !== undefined) this.saved = data.saved;
        if (data.lost !== undefined) this.lost = data.lost;
        if (data.maxStreak !== undefined) this.maxStreak = data.maxStreak;
        
        this.gameOver = true;
        this.score = this.teamScore; // Use team score for leaderboard
        this.showGameOver();
    }

    broadcastPlayerName(name) {
        if (multiplayerChannel) {
            multiplayerChannel.send({
                type: 'broadcast',
                event: 'player_name',
                payload: { playerId: playerId, name: name }
            });
        }
    }

    handlePartnerName(data) {
        if (data.name) {
            this.partnerName = data.name;
            this.updateSubmitButtonState();
        }
    }

    broadcastScoreSubmitted(combinedName, success) {
        if (multiplayerChannel) {
            multiplayerChannel.send({
                type: 'broadcast',
                event: 'score_submitted',
                payload: { combinedName: combinedName, success: success }
            });
        }
    }

    handleScoreSubmitted(data) {
        if (this.multiplayerSubmitBtn && data.success) {
            this.multiplayerSubmitBtn.setText('Submitted!');
            this.multiplayerSubmitBtn.disableInteractive();
            if (this.multiplayerInputEl && this.multiplayerInputEl.parentNode) {
                this.multiplayerInputEl.remove();
            }
            if (this.multiplayerSubmitIcon) {
                this.multiplayerSubmitIcon.clear();
            }
            this.multiplayerSubmitted = true;
            this.refreshLeaderboard();
        }
    }

    updateSubmitButtonState() {
        if (!this.multiplayerSubmitBtn || this.multiplayerSubmitted) return;
        
        const myName = this.myName || '';
        const partnerName = this.partnerName || '';
        
        if (myName && partnerName) {
            this.multiplayerSubmitBtn.setText('SUBMIT TEAM SCORE');
            this.multiplayerSubmitBtn.setColor('#00ff00');
            this.multiplayerSubmitBtn.setInteractive({ useHandCursor: true });
        } else if (myName && !partnerName) {
            this.multiplayerSubmitBtn.setText('Waiting for partner...');
            this.multiplayerSubmitBtn.setColor('#ffaa00');
            this.multiplayerSubmitBtn.disableInteractive();
        } else {
            this.multiplayerSubmitBtn.setText('Enter your name');
            this.multiplayerSubmitBtn.setColor('#888888');
            this.multiplayerSubmitBtn.disableInteractive();
        }
    }

    drawMalePlayer(g, isPlayer2 = false) {
        // Shadow
        g.fillStyle(0x000000, 0.4); g.fillEllipse(0, 28, 35, 12);
        // Legs
        g.fillStyle(0x2c3e50); g.fillRoundedRect(-12, 8, 10, 22, 3); g.fillRoundedRect(2, 8, 10, 22, 3);
        // Hands - different skin tone for P2
        const skinColor = isPlayer2 ? 0xd4a574 : 0xfce4d6;
        g.fillStyle(skinColor);
        g.fillCircle(-20, -5, 6); // Left hand
        g.fillCircle(20, -5, 6);  // Right hand
        // Safety Vest - P2 gets orange vest instead of green
        const vestColor = isPlayer2 ? 0xff8800 : 0xccff00;
        const reflectiveSilver = 0xdddddd;
        const accentColor = isPlayer2 ? 0xffcc00 : 0xff6b00;

        g.fillStyle(vestColor);
        g.fillRoundedRect(-18, -18, 36, 32, 5); // Main vest body

        // Reflective Strips - accent color borders
        g.fillStyle(accentColor);
        g.fillRect(-14, -18, 12, 32); // Left vertical border
        g.fillRect(2, -18, 12, 32);   // Right vertical border
        g.fillRect(-18, -4, 36, 12);  // Horizontal waist band border

        // Reflective Strips - Silver 
        g.fillStyle(reflectiveSilver);
        g.fillRect(-12, -18, 8, 32); // Left vertical
        g.fillRect(4, -18, 8, 32);   // Right vertical
        g.fillRect(-18, -2, 36, 8);  // Horizontal waist band
        // Head - different skin tone for P2
        g.fillStyle(skinColor); g.fillCircle(0, -26, 14);
        // Eyes
        g.fillStyle(0x000000); g.fillCircle(-5, -28, 2.5); g.fillCircle(5, -28, 2.5);
        // Nose
        const noseColor = isPlayer2 ? 0xb8906a : 0xcc9988;
        g.fillStyle(noseColor); g.fillEllipse(0, -22, 4, 2);
        // Cap - P2 gets blue cap instead of red
        const capColor = isPlayer2 ? 0x0066cc : 0xff0000;
        const capDarkColor = isPlayer2 ? 0x004499 : 0xcc0000;
        g.fillStyle(capColor); g.fillEllipse(0, -40, 26, 14); // Main cap
        g.fillStyle(capDarkColor); g.fillRect(-13, -42, 26, 6); // Cap brim
    }

    drawFemalePlayer(g, isPlayer2 = false) {
        // Shadow
        g.fillStyle(0x000000, 0.4); g.fillEllipse(0, 28, 35, 12);
        // Legs
        g.fillStyle(0x2c3e50); g.fillRoundedRect(-12, 8, 10, 22, 3); g.fillRoundedRect(2, 8, 10, 22, 3);
        // Hands - different skin tone for P2
        const skinColor = isPlayer2 ? 0xd4a574 : 0xfce4d6;
        g.fillStyle(skinColor);
        g.fillCircle(-20, -5, 6); // Left hand
        g.fillCircle(20, -5, 6);  // Right hand
        // Safety Vest - P2 gets teal vest instead of green
        const vestColor = isPlayer2 ? 0x00ccaa : 0xccff00;
        const reflectiveSilver = 0xdddddd;
        const accentColor = isPlayer2 ? 0x00ffcc : 0xff6b00;

        g.fillStyle(vestColor);
        g.fillRoundedRect(-18, -18, 36, 32, 5); // Main vest body

        // Reflective Strips - accent color borders
        g.fillStyle(accentColor);
        g.fillRect(-14, -18, 12, 32); // Left vertical border
        g.fillRect(2, -18, 12, 32);   // Right vertical border
        g.fillRect(-18, -4, 36, 12);  // Horizontal waist band border

        // Reflective Strips - Silver 
        g.fillStyle(reflectiveSilver);
        g.fillRect(-12, -18, 8, 32); // Left vertical
        g.fillRect(4, -18, 8, 32);   // Right vertical
        g.fillRect(-18, -2, 36, 8);  // Horizontal waist band
        // Hair base - P2 gets different hair color (auburn/red)
        const hairColor = isPlayer2 ? 0x8b2500 : 0x3d2314;
        const hairHighlight = isPlayer2 ? 0xa83c14 : 0x5a3d2b;
        g.fillStyle(hairColor); // Hair base
        g.fillEllipse(0, -30, 22, 18); // Scalp coverage
        g.fillEllipse(-14, -15, 12, 34); // Left side hair
        g.fillEllipse(14, -15, 12, 34); // Right side hair
        g.fillEllipse(-12, 5, 9, 16); // Left hair tips
        g.fillEllipse(12, 5, 9, 16); // Right hair tips
        // Hair highlights
        g.fillStyle(hairHighlight);
        g.fillEllipse(-10, -22, 4, 20);
        g.fillEllipse(10, -22, 4, 20);
        // Head - different skin tone for P2
        g.fillStyle(skinColor); g.fillCircle(0, -26, 13);
        // Hairline and top hair (drawn over head for attachment)
        g.fillStyle(hairColor);
        g.fillEllipse(0, -34, 18, 8);
        g.fillEllipse(-6, -33, 8, 6);
        g.fillEllipse(6, -33, 8, 6);
        g.fillEllipse(0, -38, 20, 10);
        // Hairline and top hair (drawn over head for attachment)
        g.fillStyle(hairColor);
        g.fillEllipse(0, -34, 18, 8);
        g.fillEllipse(-6, -33, 8, 6);
        g.fillEllipse(6, -33, 8, 6);
        g.fillEllipse(0, -38, 20, 10);
        // Hairline and bangs (drawn over head for attachment)
        g.fillStyle(hairColor);
        g.fillEllipse(0, -34, 18, 8);
        g.fillEllipse(-6, -33, 8, 6);
        g.fillEllipse(6, -33, 8, 6);
        // P2 headband - purple instead of none
        if (isPlayer2) {
            g.fillStyle(0x9933ff);
            g.fillRoundedRect(-14, -38, 28, 5, 2);
        }
        // Rosy cheeks
        g.fillStyle(0xffcccc, 0.5);
        g.fillCircle(-8, -23, 4);
        g.fillCircle(8, -23, 4);
        // Eyes (larger, more expressive)
        g.fillStyle(0xffffff);
        g.fillEllipse(-5, -28, 4, 3.5);
        g.fillEllipse(5, -28, 4, 3.5);
        // Eye color - P2 gets green eyes
        const irisColor = isPlayer2 ? 0x2e8b57 : 0x4a3728;
        g.fillStyle(irisColor);
        g.fillCircle(-5, -28, 2.2);
        g.fillCircle(5, -28, 2.2);
        g.fillStyle(0x000000); // Pupil
        g.fillCircle(-5, -28, 1.2);
        g.fillCircle(5, -28, 1.2);
        g.fillStyle(0xffffff); // Eye shine
        g.fillCircle(-4, -29, 0.8);
        g.fillCircle(6, -29, 0.8);
        // Eyelashes
        g.lineStyle(1.5, 0x000000);
        g.lineBetween(-7, -30, -8, -33);
        g.lineBetween(-5, -31, -5, -34);
        g.lineBetween(5, -31, 5, -34);
        g.lineBetween(7, -30, 8, -33);
        // Eyebrows (subtle, feminine)
        g.lineStyle(1.5, hairColor);
        g.beginPath();
        g.arc(-5, -34, 5, Math.PI * 0.15, Math.PI * 0.85, false);
        g.strokePath();
        g.beginPath();
        g.arc(5, -34, 5, Math.PI * 0.15, Math.PI * 0.85, false);
        g.strokePath();
        // Nose (small, cute)
        const noseColor = isPlayer2 ? 0xc4a088 : 0xe8c4b8;
        g.fillStyle(noseColor); g.fillEllipse(0, -24, 2.5, 1.5);
        // Lips (fuller, with color)
        g.fillStyle(0xe07070);
        g.fillEllipse(0, -19, 5, 2);
        g.fillStyle(0xd06060);
        g.fillEllipse(0, -18.5, 4, 1.2);
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
        this.animateScoreChange(displayScore);

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
        
        cars.forEach(car => {
            // Move car locally based on speed for smooth animation
            car.x += car.speed * dt;
            
            // If we have a target position from host, smoothly correct towards it
            if (car.targetX !== undefined) {
                const diff = car.targetX - car.x;
                // Only correct if we're drifting too far from expected position
                if (Math.abs(diff) > 5) {
                    car.x += diff * 0.15; // Smooth correction
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
        const colors = [0xe74c3c, 0x3498db, 0x2ecc71, 0x9b59b6, 0xf39c12, 0x1abc9c, 0xbdc3c7, 0x34495e];
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
        
        if (this.textures.exists('newt')) {
            const newt = this.add.image(x, y, 'newt');
            newt.setDisplaySize(GAME_CONFIG.NEWT_SIZE, GAME_CONFIG.NEWT_SIZE);
            newt.setDepth(25);
            newt.dir = fromTop ? 1 : -1;
            newt.dest = fromTop ? 'LAKE' : 'FOREST';
            newt.isCarried = false;
            newt.newtId = 'newt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
            newt.rotation = newt.dir === 1 ? Math.PI / 2 : -Math.PI / 2;
            this.newts.add(newt);
        }
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
                    newt.isCarried = true;
                    newt.carriedBy = playerId || 'local'; // Use playerId for multiplayer sync
                    this.player.carried.push(newt);
                    this.createPickupEffect(newt.x, newt.y);
                    this.updateHUD();
                    
                    // Broadcast pickup in multiplayer
                    if (this.isMultiplayer && multiplayerChannel) {
                        multiplayerChannel.send({
                            type: 'broadcast',
                            event: 'newt_pickup',
                            payload: {
                                playerId: playerId,
                                newtId: newt.newtId
                            }
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
                        this.saved++;
                        this.streak++;
                        if (this.streak > this.maxStreak) this.maxStreak = this.streak;
                        
                        // Use teamScore in multiplayer, score in single player
                        if (this.isMultiplayer) {
                            this.teamScore += 100;
                        } else {
                            this.score += 100;
                        }
                        
                        if (this.cache.audio.exists('sfx_saved')) this.sound.play('sfx_saved', { volume: 0.6 });
                        
                        // Haptic feedback for save (gentle pulse)
                        if (navigator.vibrate) navigator.vibrate(30);
                        
                        // Create splash effect if saved at lake
                        if (inLake) {
                            this.createSplashEffect(newt.x, newt.y);
                        }
                        
                        this.createSuccessEffect(newt.x, newt.y);
                        this.checkAchievements();
                        this.updateDifficulty();
                        
                        // Broadcast save in multiplayer
                        if (this.isMultiplayer && multiplayerChannel) {
                            multiplayerChannel.send({
                                type: 'broadcast',
                                event: 'newt_save',
                                payload: {
                                    playerId: playerId,
                                    newtId: newt.newtId,
                                    correct: true,
                                    x: newt.x,
                                    y: newt.y
                                }
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

        // Sparkle particle burst
        for (let i = 0; i < 15; i++) {
            const color = Phaser.Math.RND.pick([0x00ff88, 0xffffff, 0xccff00]);
            const star = this.add.star(x, y, 5, 2, 6, color);
            star.setAlpha(1);
            star.setDepth(101);
            
            const angle = Math.random() * Math.PI * 2;
            const dist = Phaser.Math.Between(30, 70);
            
            this.tweens.add({
                targets: star,
                x: x + Math.cos(angle) * dist,
                y: y + Math.sin(angle) * dist - 20,
                rotation: Math.random() * Math.PI * 2,
                alpha: 0,
                scale: 0.1,
                duration: 500 + Math.random() * 500,
                ease: 'Cubic.easeOut',
                onUpdate: () => {
                    // Flicker effect
                    if (Math.random() > 0.8) star.setAlpha(0.2);
                    else star.setAlpha(1);
                },
                onComplete: () => star.destroy()
            });
        }
    }

    createSplashEffect(x, y) {
        // Water splash effect when newt reaches the lake
        const splashColor = 0x44aadd;
        const waterColor = 0x88ccff;
        
        // Create expanding ripple rings
        for (let i = 0; i < 3; i++) {
            const ring = this.add.ellipse(x, y, 20, 10, splashColor, 0.6 - i * 0.15);
            ring.setDepth(50);
            this.tweens.add({
                targets: ring,
                scaleX: 4 + i,
                scaleY: 2 + i * 0.5,
                alpha: 0,
                duration: 800 + i * 200,
                delay: i * 100,
                ease: 'Power2',
                onComplete: () => ring.destroy()
            });
        }
        
        // Water droplets shooting upward
        for (let i = 0; i < 15; i++) {
            const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI; // Upward arc
            const speed = Phaser.Math.Between(80, 150);
            const droplet = this.add.circle(x, y, Phaser.Math.Between(3, 6), waterColor, 0.8);
            droplet.setDepth(51);
            
            const targetX = x + Math.cos(angle) * speed;
            const targetY = y + Math.sin(angle) * speed;
            
            this.tweens.add({
                targets: droplet,
                x: targetX,
                y: targetY,
                alpha: 0,
                scale: 0.5,
                duration: 600 + Math.random() * 200,
                ease: 'Power2',
                onComplete: () => droplet.destroy()
            });
        }
        
        // Splash crown effect (water shooting up in a circle)
        const crownCount = 8;
        for (let i = 0; i < crownCount; i++) {
            const angle = (i / crownCount) * Math.PI; // Semi-circle upward
            const distance = Phaser.Math.Between(30, 60);
            const droplet = this.add.circle(x, y, Phaser.Math.Between(4, 8), 0xffffff, 0.9);
            droplet.setDepth(52);
            
            const targetX = x + Math.cos(angle) * distance;
            const targetY = y - Math.sin(angle) * distance * 0.5; // Flattened arc
            
            this.tweens.add({
                targets: droplet,
                x: targetX,
                y: targetY,
                alpha: 0,
                scale: 0.3,
                duration: 500,
                ease: 'Power2',
                onComplete: () => droplet.destroy()
            });
        }
        
        // Small bubbles rising
        for (let i = 0; i < 6; i++) {
            const bubble = this.add.circle(
                x + Phaser.Math.Between(-20, 20),
                y,
                Phaser.Math.Between(2, 5),
                0xaaddff,
                0.5
            );
            bubble.setDepth(49);
            
            this.tweens.add({
                targets: bubble,
                y: y - Phaser.Math.Between(30, 60),
                x: bubble.x + Phaser.Math.Between(-10, 10),
                alpha: 0,
                duration: 1000 + Math.random() * 500,
                ease: 'Sine.easeOut',
                onComplete: () => bubble.destroy()
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

    animateScoreChange(targetScore) {
        // Kill existing score tween if any
        if (this.scoreTween) {
            this.scoreTween.stop();
        }
        
        // Determine if score increased or decreased
        const scoreDiff = targetScore - this.displayedScore;
        const duration = Math.min(800, Math.abs(scoreDiff) * 5); // Cap at 800ms
        
        // Create a tween object to animate the score
        this.scoreTween = this.tweens.add({
            targets: this,
            displayedScore: targetScore,
            duration: duration,
            ease: 'Power2',
            onUpdate: () => {
                this.scoreText.setText(`${Math.round(this.displayedScore)}`);
            },
            onComplete: () => {
                this.scoreText.setText(`${targetScore}`);
                this.scoreTween = null;
                
                // Pulse effect on score change completion
                this.tweens.add({
                    targets: this.scoreText,
                    scaleX: 1.2,
                    scaleY: 1.2,
                    duration: 100,
                    yoyo: true,
                    ease: 'Back.easeOut'
                });
                
                // Flash the score background
                if (this.scoreBg) {
                    this.scoreBg.clear();
                    this.scoreBg.fillStyle(scoreDiff >= 0 ? 0x00ff00 : 0xff0000, 0.5);
                    const padding = this.isCompact ? 12 : 20;
                    const scoreWidth = this.isCompact ? 98 : 120;
                    const scoreHeight = this.isCompact ? 40 : 50;
                    const scoreX = this.scale.width - scoreWidth - padding;
                    const scoreY = padding - 6;
                    this.scoreBg.fillRoundedRect(scoreX, scoreY, scoreWidth, scoreHeight, 10);
                    this.scoreBg.lineStyle(2, scoreDiff >= 0 ? 0x00ff00 : 0xff0000, 1);
                    this.scoreBg.strokeRoundedRect(scoreX, scoreY, scoreWidth, scoreHeight, 10);
                    
                    // Fade back to normal
                    this.time.delayedCall(200, () => {
                        if (this.scoreBg) {
                            this.scoreBg.clear();
                            this.scoreBg.fillStyle(0x000000, 0.7);
                            this.scoreBg.fillRoundedRect(scoreX, scoreY, scoreWidth, scoreHeight, 10);
                            this.scoreBg.lineStyle(2, 0xffcc00, 0.8);
                            this.scoreBg.strokeRoundedRect(scoreX, scoreY, scoreWidth, scoreHeight, 10);
                        }
                    });
                }
            }
        });
    }

    async showGameOver() {
        // Cleanup multiplayer
        if (this.isMultiplayer) {
            // Broadcast game over to partner (not disconnect)
            this.broadcastGameOver();
            if (this.broadcastTimer) this.broadcastTimer.destroy();
            if (this.disconnectCheckTimer) this.disconnectCheckTimer.destroy();
            await updateRoomStatus('finished');
        }
        
        if (this.cache.audio.exists('bgm_end')) {
            this.bgmEnd = this.sound.add('bgm_end', { volume: 0.6, loop: true });
            this.bgmEnd.play();
        }

        // Fade out rain sound on game over
        if (this.rainSound && this.rainSound.isPlaying) {
            this.tweens.add({
                targets: this.rainSound,
                volume: 0,
                duration: 1500,
                ease: 'Power2',
                onComplete: () => {
                    if (this.rainSound) {
                        this.rainSound.stop();
                    }
                }
            });
        }

        // Ensure cleanup when the scene is restarted or shut down
        this.events.once('shutdown', () => {
            if (this.bgmEnd) {
                this.bgmEnd.stop();
                this.bgmEnd.destroy();
            }
            if (this.rainSound) {
                this.rainSound.stop();
                this.rainSound.destroy();
            }
            if (this.isMultiplayer) {
                cleanupMultiplayerState();
            }
        });

        const { width, height } = this.scale;
        const isCompact = this.isCompact;
        
        // Use team score in multiplayer
        const finalScore = this.isMultiplayer ? this.teamScore : this.score;
        
        this.add.rectangle(0, 0, width, height, 0x000000, 0.92).setOrigin(0).setDepth(300);
        this.add.text(width / 2, height * 0.08, 'GAME OVER', {
            fontFamily: 'Fredoka, sans-serif', fontSize: '44px', color: '#ff3366', fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(301);
        
        const scoreLabel = this.isMultiplayer ? 'TEAM SCORE' : 'FINAL SCORE';
        this.add.text(width / 2, height * 0.16, `${scoreLabel}: ${finalScore}`, {
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
        const summaryTitle = this.isMultiplayer ? 'TEAM SUMMARY' : 'RUN SUMMARY';
        this.add.text(width / 2, summaryTitleY, summaryTitle, {
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
        summaryBg.lineStyle(2, this.isMultiplayer ? 0x00ccff : 0x00ffff, 0.6);
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

            // Different prompt for multiplayer
            const promptText = this.isMultiplayer ? 'Enter your name (team submission):' : 'Enter your name:';
            this.add.text(width / 2, namePromptY, promptText, {
                fontFamily: 'Outfit, sans-serif', fontSize: '16px', color: '#aaaaaa'
            }).setOrigin(0.5).setDepth(301);

            const inputEl = document.createElement('input');
            inputEl.type = 'text'; inputEl.placeholder = 'Your Name'; inputEl.maxLength = 15;
            const canvasRect = this.game.canvas.getBoundingClientRect();
            const borderColor = this.isMultiplayer ? '#00ccff' : '#00ffff';
            inputEl.style.cssText = `position: fixed; left: ${canvasRect.left + width / 2}px; top: ${canvasRect.top + inputY}px; transform: translate(-50%, -50%); padding: 10px 18px; font-size: 16px; font-family: 'Fredoka', sans-serif; border: 2px solid ${borderColor}; border-radius: 8px; background: #111; color: #fff; text-align: center; width: 180px; z-index: 10000; outline: none;`;
            document.body.appendChild(inputEl); inputEl.focus();

            const initialBtnText = this.isMultiplayer ? 'Enter your name' : 'SUBMIT SCORE';
            const initialBtnColor = this.isMultiplayer ? '#888888' : '#00ff00';
            const submitBtnText = this.add.text(width / 2 + 15, submitY, initialBtnText, {
                fontFamily: 'Fredoka, sans-serif', fontSize: '20px', color: initialBtnColor, backgroundColor: '#222', padding: { left: 45, right: 18, top: 8, bottom: 8 }
            }).setOrigin(0.5).setDepth(301);

            // Only make interactive for single player initially
            if (!this.isMultiplayer) {
                submitBtnText.setInteractive({ useHandCursor: true });
            }

            const submitIcon = this.add.graphics().setDepth(302);
            Icons.drawSend(submitIcon, submitBtnText.x - submitBtnText.width / 2 + 22, submitY, 18, this.isMultiplayer ? 0x888888 : 0x00ff00);

            if (this.isMultiplayer) {
                // Multiplayer: coordinate name submission between both players
                this.myName = '';
                this.partnerName = '';
                this.multiplayerSubmitBtn = submitBtnText;
                this.multiplayerInputEl = inputEl;
                this.multiplayerSubmitIcon = submitIcon;
                this.multiplayerSubmitted = false;

                // When user types their name, broadcast it to partner
                inputEl.addEventListener('input', () => {
                    const name = inputEl.value.trim();
                    this.myName = name;
                    if (name) {
                        this.broadcastPlayerName(name);
                    }
                    this.updateSubmitButtonState();
                });

                // Also broadcast on blur in case they tab away
                inputEl.addEventListener('blur', () => {
                    const name = inputEl.value.trim();
                    if (name) {
                        this.myName = name;
                        this.broadcastPlayerName(name);
                        this.updateSubmitButtonState();
                    }
                });

                submitBtnText.on('pointerdown', async () => {
                    if (this.multiplayerSubmitted) return;
                    if (!this.myName || !this.partnerName) return;

                    const combinedName = `${this.myName} & ${this.partnerName}`;
                    this.multiplayerSubmitted = true;
                    submitBtnText.setText('Submitting...');
                    submitBtnText.disableInteractive();

                    // Only the host actually submits to avoid duplicates
                    let success = false;
                    if (isHost) {
                        success = await submitScore(combinedName, this.teamScore, true);
                    } else {
                        // Guest waits for host to submit, assume success
                        success = true;
                    }

                    // Broadcast submission result to partner
                    this.broadcastScoreSubmitted(combinedName, success);

                    if (success) {
                        submitBtnText.setText('Submitted!');
                        inputEl.remove();
                        submitIcon.clear();
                        this.refreshLeaderboard();
                    } else {
                        submitBtnText.setText('Error - Try Again');
                        this.multiplayerSubmitted = false;
                        this.updateSubmitButtonState();
                    }
                });
            } else {
                // Single player: original behavior
                let submitted = false;
                submitBtnText.on('pointerdown', async () => {
                    if (submitted) return;
                    const name = inputEl.value.trim() || 'Anonymous';
                    submitted = true;
                    submitBtnText.setText('Submitting...');
                    submitBtnText.disableInteractive();
                    const success = await submitScore(name, this.score, false);
                    if (success) { submitBtnText.setText('Submitted!'); inputEl.remove(); submitIcon.clear(); this.refreshLeaderboard(); }
                    else { submitBtnText.setText('Error - Try Again'); submitted = false; submitBtnText.setInteractive({ useHandCursor: true }); }
                });
            }

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
            // In multiplayer, go back to mode select; in single player, restart game
            if (this.isMultiplayer) {
                cleanupMultiplayerState();
                this.scene.start('ModeSelectScene');
            } else {
                this.scene.restart();
            }
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
                this.add.text(width / 2, startY + 35 + (i * 22), `${medal}  ${s.player_name} - ${s.score}`, { fontFamily: 'Outfit, sans-serif', fontSize: '15px', color: '#ffffff' }).setOrigin(0.5).setDepth(301);
            });
        }
    }

    async refreshLeaderboard() {
        this.scene.restart(); // Simple refresh for now to clear graphics
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
        const charSpacing = isMobile ? 85 : (isCompact ? 120 : 165);
        const charScale = isMobile ? 1.5 : (isCompact ? 1.8 : 2.2);
        const boxWidth = isMobile ? 120 : (isCompact ? 145 : 180);
        const boxHeight = isMobile ? 150 : (isCompact ? 175 : 210);

        // Male character preview with animation
        const maleX = width / 2 - charSpacing;
        const maleContainer = this.add.container(maleX, charY);
        const maleGraphics = this.add.graphics();
        this.drawMaleCharacter(maleGraphics);
        maleContainer.add(maleGraphics);
        maleContainer.setScale(charScale);

        // Male idle animation (gentle bounce)
        this.tweens.add({
            targets: maleContainer,
            y: charY - 5,
            duration: 800,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });

        // Male selection box with glow effect
        const maleBox = this.add.rectangle(maleX, charY, boxWidth, boxHeight, 0x000000, 0.3)
            .setStrokeStyle(3, 0x00ffff, 1)
            .setInteractive({ useHandCursor: true });

        // Male glow effect (hidden initially)
        const maleGlow = this.add.ellipse(maleX, charY, boxWidth + 20, boxHeight + 20, 0x00ffff, 0);
        maleGlow.setDepth(-1);

        // Male label
        const labelSize = isMobile ? '14px' : (isCompact ? '16px' : '20px');
        const labelOffset = isMobile ? 85 : (isCompact ? 100 : 125);
        this.add.text(maleX, charY + labelOffset, 'VOLUNTEER A', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: labelSize,
            color: '#00ffff',
            stroke: '#000000',
            strokeThickness: 2
        }).setOrigin(0.5);

        // Male stats with animated bars
        const statsSize = isMobile ? '11px' : (isCompact ? '12px' : '14px');
        const statsOffset = isMobile ? 105 : (isCompact ? 125 : 155);
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
        const maleStatsText = this.add.text(maleX + 10, charY + statsOffset, 'FAST | Carries 1', statsStyle)
            .setOrigin(0.5)
            .setColor('#8feaff')
            .setShadow(0, 2, '#000000', 4, true, true);
        const maleIcon = this.add.graphics();
        const maleBadgeSize = isMobile ? 16 : 20;
        const maleIconX = maleStatsText.x - maleStatsText.width / 2 - (isMobile ? 12 : 14);
        const maleIconY = charY + statsOffset;
        drawStatBadge(maleIcon, maleIconX, maleIconY, maleBadgeSize, 0x6de6ff);
        drawBoltIcon(maleIcon, maleIconX, maleIconY, maleBadgeSize * 0.7, 0x6de6ff);

        // Male stat bars
        const maleStatBarsY = charY + statsOffset + (isMobile ? 22 : 28);
        const barWidth = isMobile ? 80 : 100;
        const barHeight = isMobile ? 8 : 10;
        const barSpacing = isMobile ? 18 : 22;
        
        this.createStatBar(maleX - barWidth/2, maleStatBarsY, barWidth, barHeight, 0.9, 0x00ffff, 'SPEED');
        this.createStatBar(maleX - barWidth/2, maleStatBarsY + barSpacing, barWidth, barHeight, 0.5, 0x00ffff, 'CARRY');

        // Female character preview with animation
        const femaleX = width / 2 + charSpacing;
        const femaleContainer = this.add.container(femaleX, charY);
        const femaleGraphics = this.add.graphics();
        this.drawFemaleCharacter(femaleGraphics);
        femaleContainer.add(femaleGraphics);
        femaleContainer.setScale(charScale);

        // Female idle animation (gentle sway)
        this.tweens.add({
            targets: femaleContainer,
            y: charY - 3,
            x: femaleX + 3,
            duration: 1000,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });

        // Female selection box with glow effect
        const femaleBox = this.add.rectangle(femaleX, charY, boxWidth, boxHeight, 0x000000, 0.3)
            .setStrokeStyle(3, 0xff00ff, 1)
            .setInteractive({ useHandCursor: true });

        // Female glow effect (hidden initially)
        const femaleGlow = this.add.ellipse(femaleX, charY, boxWidth + 20, boxHeight + 20, 0xff00ff, 0);
        femaleGlow.setDepth(-1);

        // Female label
        this.add.text(femaleX, charY + labelOffset, 'VOLUNTEER B', {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: labelSize,
            color: '#ff00ff',
            stroke: '#000000',
            strokeThickness: 2
        }).setOrigin(0.5);

        // Female stats
        const femaleStatsText = this.add.text(femaleX + 10, charY + statsOffset, 'STEADY | Carries 2', statsStyle)
            .setOrigin(0.5)
            .setColor('#ffb6de')
            .setShadow(0, 2, '#000000', 4, true, true);
        const femaleIcon = this.add.graphics();
        const femaleBadgeSize = isMobile ? 16 : 20;
        const femaleIconX = femaleStatsText.x - femaleStatsText.width / 2 - (isMobile ? 12 : 14);
        const femaleIconY = charY + statsOffset;
        drawStatBadge(femaleIcon, femaleIconX, femaleIconY, femaleBadgeSize, 0xffa1d4, 0x1a0b1b);
        drawHeartIcon(femaleIcon, femaleIconX, femaleIconY, femaleBadgeSize * 0.75, 0xffa1d4);

        // Female stat bars
        this.createStatBar(femaleX - barWidth/2, maleStatBarsY, barWidth, barHeight, 0.6, 0xff00ff, 'SPEED');
        this.createStatBar(femaleX - barWidth/2, maleStatBarsY + barSpacing, barWidth, barHeight, 1.0, 0xff00ff, 'CARRY');

        // Selection indicator with glow animation
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
            
            // Update glow effects
            maleGlow.setFillStyle(0x00ffff, selected === 'male' ? 0.3 : 0);
            femaleGlow.setFillStyle(0xff00ff, selected === 'female' ? 0.3 : 0);
            
            // Pulse animation for selected glow
            if (selected === 'male') {
                this.tweens.add({
                    targets: maleGlow,
                    alpha: { from: 0.3, to: 0.5 },
                    scaleX: { from: 1, to: 1.05 },
                    scaleY: { from: 1, to: 1.05 },
                    duration: 800,
                    yoyo: true,
                    repeat: -1,
                    ease: 'Sine.easeInOut'
                });
                this.tweens.killTweensOf(femaleGlow);
                femaleGlow.setScale(1);
            } else {
                this.tweens.add({
                    targets: femaleGlow,
                    alpha: { from: 0.3, to: 0.5 },
                    scaleX: { from: 1, to: 1.05 },
                    scaleY: { from: 1, to: 1.05 },
                    duration: 800,
                    yoyo: true,
                    repeat: -1,
                    ease: 'Sine.easeInOut'
                });
                this.tweens.killTweensOf(maleGlow);
                maleGlow.setScale(1);
            }
        };

        // Initial selection
        updateSelection(selectedCharacter);

        // Click handlers with visual feedback and character animation
        maleBox.on('pointerdown', () => {
            selectedCharacter = 'male';
            updateSelection('male');
            // Bounce animation on selection
            this.tweens.add({
                targets: maleContainer,
                scaleX: charScale * 1.15,
                scaleY: charScale * 1.15,
                duration: 100,
                yoyo: true,
                ease: 'Back.easeOut'
            });
            // Particle burst effect
            this.createSelectionParticles(maleX, charY, 0x00ffff);
        });

        femaleBox.on('pointerdown', () => {
            selectedCharacter = 'female';
            updateSelection('female');
            // Bounce animation on selection
            this.tweens.add({
                targets: femaleContainer,
                scaleX: charScale * 1.15,
                scaleY: charScale * 1.15,
                duration: 100,
                yoyo: true,
                ease: 'Back.easeOut'
            });
            // Particle burst effect
            this.createSelectionParticles(femaleX, charY, 0xff00ff);
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

        this.cameras.main.fadeIn(300);
    }

    createStatBar(x, y, width, height, fillPercent, color, label) {
        // Background bar with a slight outer glow/stroke for depth
        const bgBar = this.add.graphics();
        bgBar.fillStyle(0x000000, 0.6);
        bgBar.fillRoundedRect(x, y, width, height, height / 2);
        bgBar.lineStyle(2, color, 0.2);
        bgBar.strokeRoundedRect(x - 1, y - 1, width + 2, height + 2, (height + 2) / 2);

        // Fill bar with animation and a brighter gradient-like look
        const fillBar = this.add.graphics();
        const fillWidth = width * fillPercent;
        
        // Animate fill
        this.tweens.add({
            targets: { progress: 0 },
            progress: 1,
            duration: 800,
            ease: 'Cubic.easeOut',
            onUpdate: (tween, target) => {
                fillBar.clear();
                // Main fill
                fillBar.fillStyle(color, 0.9);
                fillBar.fillRoundedRect(x, y, fillWidth * target.progress, height, height / 2);
                
                // Brighter top highlight for 3D effect
                fillBar.fillStyle(0xffffff, 0.3);
                fillBar.fillRoundedRect(x + 2, y + 1, Math.max(0, (fillWidth * target.progress) - 4), height / 2.5, height / 5);
            }
        });

        // Label - larger, brighter, and better font weight
        this.add.text(x + width / 2, y - 4, label, {
            fontFamily: 'Fredoka, sans-serif',
            fontSize: '11px',
            color: '#ffffff',
            fontWeight: '600',
            stroke: '#000000',
            strokeThickness: 2
        }).setOrigin(0.5, 1).setAlpha(0.9);

        return { bgBar, fillBar };
    }

    createSelectionParticles(x, y, color) {
        for (let i = 0; i < 15; i++) {
            const angle = (i / 15) * Math.PI * 2;
            const distance = Phaser.Math.Between(30, 60);
            const particle = this.add.circle(x, y, Phaser.Math.Between(3, 6), color, 0.8);
            
            this.tweens.add({
                targets: particle,
                x: x + Math.cos(angle) * distance,
                y: y + Math.sin(angle) * distance,
                alpha: 0,
                scale: 0.3,
                duration: 400 + Math.random() * 200,
                ease: 'Power2',
                onComplete: () => particle.destroy()
            });
        }
    }

    drawMaleCharacter(g) {
        // Shadow
        g.fillStyle(0x000000, 0.4); g.fillEllipse(0, 28, 35, 12);
        // Legs
        g.fillStyle(0x2c3e50); g.fillRoundedRect(-12, 8, 10, 22, 3); g.fillRoundedRect(2, 8, 10, 22, 3);
        // Hands
        g.fillStyle(0xfce4d6);
        g.fillCircle(-20, -5, 6);
        g.fillCircle(20, -5, 6);
        // Safety Vest
        const vestGreen = 0xccff00;
        const reflectiveSilver = 0xdddddd;
        const safetyOrange = 0xff6b00;
        g.fillStyle(vestGreen);
        g.fillRoundedRect(-18, -18, 36, 32, 5);
        g.fillStyle(safetyOrange);
        g.fillRect(-14, -18, 12, 32);
        g.fillRect(2, -18, 12, 32);
        g.fillRect(-18, -4, 36, 12);
        g.fillStyle(reflectiveSilver);
        g.fillRect(-12, -18, 8, 32);
        g.fillRect(4, -18, 8, 32);
        g.fillRect(-18, -2, 36, 8);
        // Head
        g.fillStyle(0xfce4d6); g.fillCircle(0, -26, 14);
        // Eyes
        g.fillStyle(0x000000); g.fillCircle(-5, -28, 2.5); g.fillCircle(5, -28, 2.5);
        // Nose
        g.fillStyle(0xcc9988); g.fillEllipse(0, -22, 4, 2);
        // Cap
        g.fillStyle(0xff0000); g.fillEllipse(0, -40, 26, 14);
        g.fillStyle(0xcc0000); g.fillRect(-13, -42, 26, 6);
    }

    drawFemaleCharacter(g) {
        // Shadow
        g.fillStyle(0x000000, 0.4); g.fillEllipse(0, 28, 35, 12);
        // Legs
        g.fillStyle(0x2c3e50); g.fillRoundedRect(-12, 8, 10, 22, 3); g.fillRoundedRect(2, 8, 10, 22, 3);
        // Hands
        g.fillStyle(0xfce4d6);
        g.fillCircle(-20, -5, 6);
        g.fillCircle(20, -5, 6);
        // Safety Vest
        const vestGreen = 0xccff00;
        const reflectiveSilver = 0xdddddd;
        const safetyOrange = 0xff6b00;
        g.fillStyle(vestGreen);
        g.fillRoundedRect(-18, -18, 36, 32, 5);
        g.fillStyle(safetyOrange);
        g.fillRect(-14, -18, 12, 32);
        g.fillRect(2, -18, 12, 32);
        g.fillRect(-18, -4, 36, 12);
        g.fillStyle(reflectiveSilver);
        g.fillRect(-12, -18, 8, 32);
        g.fillRect(4, -18, 8, 32);
        g.fillRect(-18, -2, 36, 8);
        // Hair base (drawn behind head, anchored to scalp)
        g.fillStyle(0x3d2314); // Dark brown base
        g.fillEllipse(0, -30, 22, 18); // Scalp coverage
        g.fillEllipse(-14, -15, 12, 34); // Left side hair
        g.fillEllipse(14, -15, 12, 34); // Right side hair
        g.fillEllipse(-12, 5, 9, 16); // Left hair tips
        g.fillEllipse(12, 5, 9, 16); // Right hair tips
        // Hair highlights
        g.fillStyle(0x5a3d2b); // Lighter brown highlights
        g.fillEllipse(-10, -22, 4, 20);
        g.fillEllipse(10, -22, 4, 20);
        // Head
        g.fillStyle(0xfce4d6); g.fillCircle(0, -26, 13);
        // Hairline and top hair (drawn over head for attachment)
        g.fillStyle(0x3d2314);
        g.fillEllipse(0, -34, 18, 8);
        g.fillEllipse(-6, -33, 8, 6);
        g.fillEllipse(6, -33, 8, 6);
        g.fillEllipse(0, -38, 20, 10);
        // Rosy cheeks
        g.fillStyle(0xffcccc, 0.5);
        g.fillCircle(-8, -23, 4);
        g.fillCircle(8, -23, 4);
        // Eyes (larger, more expressive)
        g.fillStyle(0xffffff);
        g.fillEllipse(-5, -28, 4, 3.5);
        g.fillEllipse(5, -28, 4, 3.5);
        g.fillStyle(0x4a3728); // Brown iris
        g.fillCircle(-5, -28, 2.2);
        g.fillCircle(5, -28, 2.2);
        g.fillStyle(0x000000); // Pupil
        g.fillCircle(-5, -28, 1.2);
        g.fillCircle(5, -28, 1.2);
        g.fillStyle(0xffffff); // Eye shine
        g.fillCircle(-4, -29, 0.8);
        g.fillCircle(6, -29, 0.8);
        // Eyelashes
        g.lineStyle(1.5, 0x000000);
        g.lineBetween(-7, -30, -8, -33);
        g.lineBetween(-5, -31, -5, -34);
        g.lineBetween(5, -31, 5, -34);
        g.lineBetween(7, -30, 8, -33);
        // Eyebrows (subtle, feminine)
        g.lineStyle(1.5, 0x3d2314);
        g.beginPath();
        g.arc(-5, -34, 5, Math.PI * 0.15, Math.PI * 0.85, false);
        g.strokePath();
        g.beginPath();
        g.arc(5, -34, 5, Math.PI * 0.15, Math.PI * 0.85, false);
        g.strokePath();
        // Nose (small, cute)
        g.fillStyle(0xe8c4b8); g.fillEllipse(0, -24, 2.5, 1.5);
        // Lips (fuller, with color)
        g.fillStyle(0xe07070);
        g.fillEllipse(0, -19, 5, 2);
        g.fillStyle(0xd06060);
        g.fillEllipse(0, -18.5, 4, 1.2);
    }
}

const config = {
    type: Phaser.AUTO, backgroundColor: '#000000', scale: { mode: Phaser.Scale.RESIZE, parent: 'game-container' },
    dom: { createContainer: true }, scene: [SplashScene, ModeSelectScene, LobbyScene, CharacterSelectScene, GameScene]
};
window.addEventListener('load', () => {
    new Phaser.Game(config);
    // Add global promise error handling to catch Supabase/WebRTC rogue errors
    window.addEventListener('unhandledrejection', (event) => {
        console.warn('Unhandled promise rejection:', event.reason);
    });
});
