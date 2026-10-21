# Reaction Station recorder controls

The recorder has a branded two-row dock: session identity and status above the capture controls. Controls opens the audio mixer and recording hotkey settings. Horizontal and vertical docks keep their existing positioning and click-through behavior.

## Recording hotkeys

The recorder accepts these global shortcuts while it is open, including while another application has focus:

| Default | Action |
| --- | --- |
| Ctrl + Shift + R | Start / stop and save |
| Ctrl + Shift + P | Pause / resume |
| Ctrl + Shift + M | Mute / unmute microphone |
| Ctrl + Shift + S | Mute / unmute system audio |

On macOS, use Command instead of Ctrl. Change the combinations in Controls → Hotkeys between takes. Settings persist across app launches. Saving duplicate or occupied combinations keeps the previous bindings and settings. An occupied shortcut at startup is logged; other available shortcuts still register. Recording shortcuts are unregistered while the editor is open so they do not intercept editing or browser shortcuts; reopening the recorder restores the saved combinations.

## Live audio

Windows native capture and browser capture support independent voice and system-audio sliders and mute. Sliders run from 0–100% of the existing recording level; microphone gain staging remains unchanged at 100%. Mute preserves the slider value, and unmute restores it. The dock's microphone and speaker buttons become mute controls during a take.

Enable the desired audio sources before recording. Device selection and adding a source remain locked during a take. Muting keeps the capture source running, so it can be restored without interrupting or restarting the recording. Muting system audio changes the recorded sound, not the sound playing through your headphones.

The native macOS and Linux helpers do not yet support live gain commands; their live mixer controls are disabled. Newly added recorder copy uses English fallback text in non-English locales pending translation.

## Validation

Unit tests cover conflicting registrations, persistence failure, action swaps, input validation, pre-muted startup, live gain and mute restoration, and UI availability. The Windows packaging workflow compiles the changed helper, runs PCM output tests for live gain changes, and checks the packaged UI with Playwright, saving four interface previews.

Real Windows audio capture, a physical microphone, OS hotkeys while another app is focused, HUD click-through, and the capture-to-export flow must still be checked on the installed test build. Native computer control is unavailable in the current development environment; renderer automation does not establish these desktop checks.


## Separate recorded audio (0.3.0)

Windows native recordings save enabled microphone and desktop sources independently as lossless WAV files next to the video. Both use the mixer's source clock, including silence and pause/resume, and respect live gain/mute changes. Muted samples are silence; raising the editor volume cannot recover sound muted during capture. The video retains its original combined sound as a fallback.

A new recording opens with **Microphone** and **Desktop audio** on separate timeline rows. Select a track to adjust gain, mute, fade in/out, move, trim, or slip its source offset. The editor suppresses the video's embedded sound only after every available source has been imported and the document saved. If import/probing fails, it keeps the embedded mix and reports the failure. Deleting/muting a separate track keeps that source silent; it does not restore the fallback mix.

Separate tracks persist as normal project audio assets and use the existing project relinking/export paths. They follow video trims and speed changes in preview and native export, without automatic loudness normalization or desktop ducking. Imported music and separately recorded voiceovers keep their previous behavior. Recording sources are exempt from the sequential voiceover placement rule and cannot be looped in the inspector.

This first capture implementation is **Windows native only**. Browser capture and native macOS/Linux recordings still store a combined mix. Old recordings cannot be split into independent sources after the fact. WAV tracks need roughly 660 MiB per hour per enabled source at 48 kHz stereo; keep them with the video/project. Long tracks use RF64 when RIFF's 4 GiB limit is exceeded.

Validation includes source-channel PCM isolation and shared-clock tests, portable WAV header tests, atomic import/fallback and project round-trip tests, trim/speed export serialization, and a real decoder/mixer/stretch Rust test. The Windows packaging workflow also imports synthetic source files through the packaged editor and saves an editor preview. Real microphone/desktop capture and OS interaction still require the manual desktop pass.

## Editor keyboard customization

The editor app menu → Keyboard Shortcuts offers all editor command bindings, including Cut Selected, Add Trim, Undo/Redo (and alternate redo), Delete/Backspace, frame stepping, annotation navigation, project new/open/save, Export, and the shortcut dialog itself. Click a binding and press its replacement; conflicting editor commands offer Swap. Clear removes the keyboard binding while leaving toolbar/menu commands usable. Reset restores defaults when saved. Recorder global shortcuts remain in recorder settings and are suspended while the editor is active.

Existing saved assignments are retained. If an old custom assignment occupies a newly configurable command's default key, that new command starts unassigned instead of taking over the key. Changes also update native File/Edit menu accelerators and toolbar hints. Text inputs keep standard text editing and dialogs keep Enter/Escape and focus navigation. Mouse wheel gestures and operating system/window shortcuts are separate from editor command bindings.

This change is included in the combined 0.4.0 Windows test installer.

## Creator workspace batch

The recorder's Hide and Close buttons are inside the dock header in horizontal and vertical layouts. Timeline items expose right-click menus (also Shift+F10 on a focused item): video clips offer Duplicate, Delete and Edit clip; audio layers offer Duplicate, Delete and Mute/Unmute; effect/trim regions offer Duplicate and Delete. Actions use normal document saves and undo history. Video duplication preserves source edits; audio duplication keeps its source offset, gain, mute and fades in an independent group. A region copy is placed in the next available same-lane gap with a frame of separation; a full lane reports that there is no room.

Workspace sits beside the app dropdown. It saves snapping, timeline guide and waveform visibility, and individual magnets for the playhead, item edges and clip boundaries. Moving effects/audio can snap from either edge, resizing snaps the edited edge, and the radius stays eight screen pixels at every zoom level. Shift temporarily bypasses snapping; Alt audio slipping retains its source-window behavior. Clip cards remain a contiguous reorder lane. Timeline guides are editing aids and never appear in exports. Fit timeline to window, Reset workspace and Keyboard Shortcuts are also available.

Defaults: G toggles snapping, Ctrl/Cmd+Shift+G toggles guides, and Home fits the timeline. These commands join the editable shortcut list. The Windows package smoke script checks dock Close containment and the saved Workspace/menu wiring in the next combined build. The combined 0.4.0 Windows test installer is queued on feat/creator-workspace-build. Real Windows capture, OS click-through, and capture-to-export checks are pending user testing; no stable release is promoted.


## Timeline media batch — 0.5.0

The timeline keeps its saved panel height when layers are duplicated or added. Eight default lanes are reserved (five effects, two audio rows and the main clip track). Overlapping image/video annotations pack onto separate rows, and extra audio/visual rows remain accessible through a visible vertical scrollbar. The fixed ruler and playhead compensate for the scroll gutter.

Drop video, image or audio files from the desktop onto the timeline. The main clip track inserts visual media into the contiguous sequence; upper lanes create visual overlays at the drop time. Audio always creates an audio track. Images start at five seconds: sequence images become cached VP9 lossless-mode still clips through bundled FFmpeg, compatible with both Chromium media previews and the native compositor, while image overlays embed their bytes in the document. Overlays require an existing main sequence and are clamped to its end. Video overlay sound is placed on a separate, independently editable audio lane; moving or trimming either lane edits that lane independently.

Edit clip exposes None, Fade, Rise, Pop, Slide Left and Pulse for sequence video/still clips. Image/video overlays expose these presets in the inspector. Typewriter remains a text-only effect. Visual presets animate the entrance (700 ms; pulse is a brief emphasis); the compositor applies the same geometry/opacity in preview and export. Overlay video frames decode through the shared software FFmpeg decoder and upload as RGBA sprites on all three GPU backends. Large or numerous simultaneous video overlays may need performance tuning after desktop testing.

Source offsets and animation time continue across main clip boundaries. Body moves retain the overlay's source head; resizing its left edge advances source time. Duplicating a visual layer creates a separately selectable layer at the same span, including on a full timeline. Main clip cuts keep the original animation head rather than replaying the entrance for each derived playback segment.

The repository rename to Clatasha/Reaction-Station was verified on GitHub; homepage, About, update checks, installer feed and README links use the new repository. One combined Windows test package is prepared on feat/timeline-media-drop. Automated unit/type checks and FFmpeg image import tests cover their stated scope; native compilation, GPU output and real desktop input require the Windows build and desktop pass. This is a test installer, not a stable release.


Playhead scrubbing also uses the Workspace item/clip magnets and the same eight-screen-pixel radius. It snaps to item starts/ends and clip boundaries without sticking to its own previous position. Shift bypasses magnets for precise free scrubbing; the snap guide clears on release and is hidden when Show guidelines is disabled. Playback, frame stepping and typed seeks remain continuous.
