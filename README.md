# Save the Newts
An educational game demonstrating the impact of volunteer-assisted newt migration on Alma Bridge Road.

## Multiplayer Realtime Budget

Multiplayer uses Supabase Realtime broadcast for in-match sync and a low-frequency Postgres Changes subscription only while the host waits in the lobby. To stay friendly to the Supabase free tier, player positions are sent at 8 Hz only when changed, idle players send a 1.5 second heartbeat, and the host sends authoritative car/newt snapshots at 4 Hz. Voice chat signaling is opt-in from the mic button so matches do not spend WebRTC signaling messages unless players want voice.


Get involved with [Newt Patrol](https://www.bioblitz.club/newts.com/)
