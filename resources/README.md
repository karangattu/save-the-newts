# Android launcher icon

The source artwork is `icon.png`, generated with the built-in imagegen tool.
The files under `android/res/` contain the legacy, round, and adaptive Android
launcher resources for all five screen densities.

After creating or syncing the Android project, run `npm run android:brand`.
The release workflow runs this automatically. It also sets Android's version
name from `package.json` and its version code to major × 10000 + minor × 100 + patch.

Adaptive foregrounds place the artwork in the central 72 dp of the 108 dp
canvas so the launcher mask preserves the rescue scene.

## Generation prompt

Use case: illustration-story
Asset type: square Android launcher app icon for Save the Newts.
Primary request: a person saving a California newt from incoming traffic while crossing a road.
Scene/backdrop: a simple two-lane California road, a single approaching car visible behind the rescue.
Subject: a crouching adult volunteer gently scooping a small California newt away from the roadway toward the safe verge. The newt has a brown back, a vivid orange underside, four small legs and a long tapering tail, recognizable as a newt rather than a lizard. Make the hand and newt large and clearly legible.
Style/medium: polished bold editorial illustration, simplified shapes, strong silhouette, crisp edges, friendly conservation game aesthetic.
Composition/framing: square full-bleed image, compact central composition with person, newt and approaching car all readable; key subjects within the central 60 percent so Android circular masks preserve them. Full background to every edge. No rounded frame or pre-applied app icon mask.
Lighting/mood: daylight, urgent rescue with a hopeful feeling, no collision or injuries.
Constraints: no text, no letters, no logos, no watermark, no extra limbs.
