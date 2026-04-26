# Save the Newts
An educational game demonstrating the impact of volunteer-assisted newt migration on Alma Bridge Road.

## Multiplayer Realtime Budget

Multiplayer uses Supabase Realtime for lobby coordination, critical gameplay events, and WebRTC signaling. High-frequency in-match movement uses a peer WebRTC data channel when it is available: player positions run at 60 Hz only when changed, idle players send a 1.5 second heartbeat, and host car/newt snapshots run at 20 Hz. If the peer channel cannot connect, the game falls back to Supabase Broadcast at 8 Hz player updates and 4 Hz host snapshots to stay friendly to the free tier. Voice chat signaling is opt-in from the mic button so matches do not spend WebRTC voice messages unless players want voice.


Get involved with [Newt Patrol](https://www.bioblitz.club/newts.com/)
