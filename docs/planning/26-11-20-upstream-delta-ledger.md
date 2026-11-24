# Upstream delta ledger: every commit from 7bf098d7 to bad07e44

## Execution checkpoint

- Phase: planning record, written 20 November 2026 at React `f5114ec` on `prompt/full-figcraft-port`.
- Native range: `7bf098d75d187416633d9ebcceb9eb83fbb10df8` → `bad07e4433240cad046589129c084bd2fc36f097`, 254 commits excluding merges.
- Purpose: the [delta queue](26-11-15-upstream-delta.md) groups this range into eight rows by theme. Row 1 turned out to hold a change that no row named (point positions in vector edit mode). This ledger assigns every commit to an item, so that nothing in the range is left to be found by accident.
- Status: 39 items verified, 24 open (four of them, 2.6, 2.12, 2.17 and 2.18, wait for the interface of roadmap row 19), the rest outside the browser port or without product behaviour.
- Next action: work the open items in order, each as its own bounded slice under its row's plan. Row 2 is closed apart from the four items waiting for row 19 ([row 2 plan](26-11-20-delta-row-2-selection-canvas.md)); row 3 is planned in [the row 3 plan](26-11-21-delta-row-3-files-text-paint.md).
- Blockers: none.

## How to read it

Each line is one item: a change in behaviour with the commits that make it, including their tests, review follow-ups and documentation. The first number is the delta queue row. An item is assigned by its commit subjects and the files they touch; it has not been checked against React unless its status says verified. When an item is opened, read the whole upstream range for the files it touches before trusting this grouping, and move a commit if it belongs elsewhere.

Items marked as outside the browser port are not dismissed: the final audit reviews each native-only exclusion individually.

## Ledger

| Item | Change | Status | Commits |
|---|---|---|---|
| 1.1 | SVG compact arc flags | Verified at 55ad7e6 | `832e790c` |
| 1.2 | round_to keeps huge finite values finite | Verified at c56be59 | `c47de279` |
| 1.3 | Four-anchor ellipse | Verified at de054fa | `b33da8a7`, `4118be89`, `0774e44f`, `0c1fb11c`, `b1ee6535` |
| 1.4 | Pencil and Simplify keep to their input | Verified at 11b1a55 | `0aba3f76`, `61389cdd` |
| 1.5 | A boolean group's corner radius | Verified at 3c14182 | `c48d844d`, `4c91f908`, `529134b8`, `bae366ba`, `ec105d0f` |
| 1.6 | Path operation budgets | Verified at 4445294 | `554ad0ea` |
| 1.7 | Vector loops through a bridge, Flatten, mirror modes | Verified at 239a20a | `8e6c342f`, `a75d8bf0`, `35d46208`, `153fa08d`, `06ffeca8`, `641cc415`, `eeb1f404`, `b8e67b87`, `2c83448d` |
| 1.8 | Point positions in vector edit mode | Verified at d51ac59 | `6ac20c7d`, `8edcc02a`, `dc841f85`, `767ebb67`, `62e7e3a4`, `194a4a13` |
| 2.1 | Copy, cut and paste in vector edit mode act on the selected points and segments (#1875, #2105) | Verified at 6aebd59 | `0fec344f`, `87ce9612`, `ad701088` |
| 2.2 | Locked layers: no nudge, a locked parent's children stay locked, Select layer lists and picks them (#1560) | Verified at 056c09b; the Layers panel padlock waits for roadmap row 19 | `24cf7032`, `6cb015d4`, `39e3496f`, `87f7b7d9` |
| 2.3 | Marquee selection follows the measured rules | Verified at f66ead9 | `cb526214`, `604c7846` |
| 2.4 | Polygons and stars get a Count handle on the canvas | Verified at 4a89d45 | `89d8b50e`, `d773ab29` |
| 2.5 | Tidy up keeps order and sizes, evens and rounds gaps, handles overlapping rows and grids | Verified at 5e0c6b3 | `cfd6bf52`, `d3f7ae90`, `a7a9e627`, `1a68ded5`, `fc900783` |
| 2.6 | Tab while renaming moves only the rename and wraps (#2311) | Open; waits for roadmap row 19 ([deferred queue](26-11-07-full-port-resume.md#deferred-tests-and-reviews)) | `2408d0aa`, `d3688b9e` |
| 2.7 | Paste: over a selection just above the selected layer; in place, at the view's centre or in a selected frame | Verified at 893d8a5 | `c74bcd0b`, `476daeab`, `ebd463fa` |
| 2.8 | Escape clears the selection instead of stepping out to the parent | Verified at 2cb640a | `a285fd29`, `92cf9849`, `bceb5476` |
| 2.9 | Arrow keys pan 64 px, 320 with Shift | Verified at b374bfe | `75f54e0a`, `d036eb2f`, `9f51517f` |
| 2.10 | Zoom to selection leaves a 40 pt margin and clears the bottom toolbar | Verified at bac8b73 | `fceb6063`, `5d529269`, `53bf0a40` |
| 2.11 | Preferences: Invert zoom direction | Verified at 7648788 | `6fce958a`, `1ef0c16f`, `a69b27fd` |
| 2.12 | Layer icon double-click zooms to the layer, keeps a modified selection and becomes the range anchor | Open; waits for roadmap row 19 ([deferred queue](26-11-07-full-port-resume.md#deferred-tests-and-reviews)) | `9a29a3cb`, `cf80dc1a`, `6785be8a` |
| 2.13 | Smart guides snap within 4.5 screen pixels | Verified at a204eae | `a1980463`, `ebe0a8c2` |
| 2.14 | Shift while rotating lands on multiples of 15 degrees, also inside a rotated frame | Verified at 2c776c2 | `a1ac22f1`, `da81d55a` |
| 2.15 | Rotation field shows and sets the rotation on the page (node.set absoluteRotation) | Verified at 3a1c529 | `d0379dc7`, `cc367717`, `7e748d4a`, `accdfbae` |
| 2.16 | Scale tool: K focuses the field, drags pivot on the opposite handle, origin starts at the centre (#2146, #2148) | Verified at 9ee41a2 | `f0d39197`, `92145e6f`, `68564374`, `197a390a`, `7a8d422d`, `4254a3f3` |
| 2.17 | Sidebars' width limits (left 240 to 450, right 240 to 500) | Open; waits for roadmap row 19 ([deferred queue](26-11-07-full-port-resume.md#deferred-tests-and-reviews)) | `ad7a886e`, `1b7ce679` |
| 2.18 | A submenu opens as soon as its row is hovered | Open; waits for roadmap row 19 ([deferred queue](26-11-07-full-port-resume.md#deferred-tests-and-reviews)) | `35ac3a92`, `c4302902` |
| 2.19 | Command parameter refusals: negative, fractional and invalid indices and ids, non-numeric miterLimit, cornerSmoothing and paragraph props, signs and exponents in export sizes | Verified at 02cfbe5 | `04a6c76a`, `0ff3a368`, `82da8f51`, `10d97e27`, `6222fce8`, `db1bec08`, `386c6c1d` |
| 3.1 | .fig export writes text on a path with exact curves (#2323) | Verified at 5e0f123 | `88b63d1e`, `a243f0b8`, `193c3a35` |
| 3.2 | Lists: .fig export of list spacing, hanging punctuation, lists and vertical trim; a numbered list's start on import; Enter and typed-number starts (#2305, #2273) | Verified at ea403f6 | `a4e33077`, `bb480bdf`, `4e9b414c`, `b190e675`, `7c3f9ce7`, `b8f05d19` |
| 3.3 | .fig export writes image adjustments (#2297) | Verified at 616b51c | `b54df860`, `501df234` |
| 3.4 | .fig export writes vector region paints (#2302) | Verified at 048e1cb | `f1e92749`, `98f94626` |
| 3.5 | .fig export writes a page's prototype background (#2326) | Verified at fc7d9a3 | `fb9df220` |
| 3.6 | Crop: chosen in the fill menu or colour picker enters crop mode and a drag crops (#2307, #2150) | Verified at 286bea3 | `bdf6ff92`, `8330ffb3`, `91a76c72`, `a54eafc0` |
| 3.7 | Zoomed-out images draw from small copies that stay decoded | Open | `c82986b2`, `503823f9` |
| 3.8 | A vector point without a radius of its own takes the layer's on .fig import (#2114) | Verified at e0ae594 | `a6be897d` |
| 3.9 | A wrap style per paragraph and in text styles, overriding the layer's (#1827, #2094) | Verified at f1038dd | `136ca4cd`, `d14c637d`, `7e2752d5`, `071cc86b`, `654eb205` |
| 3.10 | A font loaded with text.loadFont wins over built-in and installed faces (#2092) | Verified at 9b9fbf2 | `34c44e60`, `a375ac06` |
| 3.11 | The text caret takes the text's fill colour, with fallbacks (#2156, #2190, #2163) | Verified at 0e82958 | `2beec8b3`, `06d03a54`, `3cdc5f7e`, `6920ea63`, `e3701d85` |
| 3.12 | The eyedropper picks a magnified image's pixel under the pointer (#2189) | Open | `30767bd2`, `0dac2311` |
| 3.13 | Selection colors shows for a layer with children from one colour (#2188, #2191) | Open | `dadd4dfc`, `21d05946`, `7e438913`, `c93d6c46` |
| 3.14 | Page background: translucent pages over a themed checkerboard, the sidebar paint field | Verified at d578735 | `481b6831`, `a45d932a`, `d9f52aab`, `67c232ea` |
| 3.15 | A background blur or glass exported on its own keeps the content behind it (#2213) | Verified at e183f76 | `020388cf`, `a1de7dcd` |
| 3.16 | Export: colour profile notes; export settings take back what node.get returns (snake_case aliases) | Verified at 4ac4ac7 | `297426c5`, `97f086e0`, `12ade9c7`, `016dba8c`, `3d4c798f`, `6c3ac0c5`, `3f39154a` |
| 3.17 | Import and export bounds: SVG export embeds each image once; SVG import budgets attributes, filter chains and layers; Penpot raw SVG allowance; render cache hash | Verified at 138f12a | `9032dc3e`, `64e91207`, `70ed6c16`, `4d3fe2aa`, `cf77dfda`, `2f8dd85f`, `81371f4a` |
| 3.18 | Paint rows: a click highlights a fill, stroke or effect row; Cmd/Ctrl+C and V copy and paste it; a programmatic paste after a property copy pastes no stale layers (#1494) | Verified at c0c2a9d | `375a7b8a`, `33ac1d14`, `b640fbc1`, `0ad70b95` |
| 4.1 | Grid Fill tracks share the space and let a fixed child overflow | Open | `a28c03d9`, `92753a8f`, `daa6b5b2` |
| 4.2 | A child dragged in auto layout passes a sibling when its leading edge reaches the sibling's middle (#2142) | Open | `cf567c3f`, `e415a3a0` |
| 4.3 | Align is unavailable for a layer in an auto layout frame's flow | Open | `76965c78` |
| 4.4 | Layout bounds: a grid past the snap budget is left out; snap lines from grids are bounded | Open | `9d486259`, `1935c3ea` |
| 5.1 | Inherited slot properties resolve by their defining component | Open | `a6d9b74d`, `a66946d1`, `2067a0b5` |
| 5.2 | An instance lists the properties its variant uses (#2022) | Open | `14670b99` |
| 5.3 | A connection dropped on a sibling variant creates Change to; grouped sets take none (#2158, #2161) | Open | `5c500252`, `36cd59da`, `499717d6` |
| 5.4 | Create multiple components and Create component set in the component button's menu, with refusals (#2088, #2095) | Open | `f5a52ea5`, `524ad8b1`, `253e0c3d`, `dda27030` |
| 5.5 | Variables: bulk Edit variables, Duplicate group, duplicate by exact id, slash rename nests with rollback, page modes with nothing selected (#2082, #2084, #2353, #2215) | Open | `a20415e1`, `9c3949fc`, `8a78214b`, `4313a60f`, `815cbf9f`, `7644de9f`, `70aeeee9`, `92d0ffdc`, `a60cb1a6` |
| 5.6 | Text styles: bind a number variable to the weight (#2174) | Open | `ccb33e0b`, `281918e2` |
| 5.7 | Import cost: layer paths per main worked out once; codeConnect.import indexes components by name | Open | `a8e34e75`, `6e9582c0` |
| 6.1 | Library links keep working when the project folder is moved or cloned (#2132) | Open | `7b34dbab` |
| 7.1 | Incoming peer names and colours are bounded | Verified at 6818860 | `a40c76ab`, `2cfd2a35` |
| 8.1 | Boards: mind maps, sticky text size and growth, board tables (#2226, #2157, #2172) | Open (roadmap row 16 unported) | `20f02bb7`, `e0e57dd4`, `57b885f8`, `1ee3087b`, `ff3e4e60`, `bb6d1c35`, `1ac46ba0` |
| 8.2 | .jam import: stickies and shapes with text come in as native board items (#1808) | Open (roadmap row 16 unported) | `100a6b7e`, `9e22cc7b`, `7cb5af01`, `4201fed2`, `a415598e` |
| 8.3 | Dev Mode: the Annotation tool (#1840, #2143) | Open (roadmap row 17 unported) | `2839497d`, `8b15c00f`, `ff730526`, `3c70b08f` |
| 8.4 | Code export: several fills as one layered CSS background; SwiftUI, Compose and Flutter write every fill; Tailwind max-width merge (#2271, #2272) | Open (roadmap row 17 unported) | `9467d235`, `e276b1e4`, `02199134`, `3d22c606` |
| 8.5 | Inspect works out a grid's cells once | Open (roadmap row 17 unported) | `6bc8bbae` |
| — | batch: bound how much referenced data one step's params copy (#2257) | The port has no batch command; review with the automation surface at the final audit | `3b9bf8c9` |
| — | Desktop application only: automation file roots, window caption, links opening in the system browser, updater, native icon sizes and cursors, Tamil and other interface catalogues of the native UI | Not browser-relevant; review individually at the final audit | `984270fb`, `966aa7b2`, `938f8b2a`, `97ceeca3`, `74698fa8`, `976e57a2`, `2446e871`, `57006fa7`, `898bfc2e`, `e2b6b4cd`, `ee11036d`, `70552482`, `19c8e018`, `98523185`, `ebcaa58c`, `6d128d33`, `d252d35f`, `50a76d09`, `6108efd4`, `b6739cd0`, `fbd313f4`, `bc2984a9`, `9c2c2cb7`, `e8b53e33` |
| — | CI, lint, formatting, test isolation and documentation only | No product behaviour | `d5cdba8d`, `34ccbc83`, `4084642c`, `eb660e77`, `af26ce1a`, `40360c4a`, `b72112ff`, `8415de0b`, `8f36c3f1`, `3cf7385f`, `39acc364`, `8ffa1bfb`, `e27d67fa`, `03bfdadb`, `293c9226`, `6d36c87c`, `fa4883ad`, `8e1a2ff2` |
| — | Widgets (user-deferred) | Deferred by the user | `9aaf7114` |

## Reproduction

```sh
git -C original/figcraft log --format='%h %s' --no-merges 7bf098d7..bad07e44
```

lists the 254 commits. Every abbreviated hash above appears in that list exactly once.
