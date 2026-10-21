# Reaction Station 0.6 test build

This update combines playback recovery and creator editing changes in one Windows test installer.

- Media imports and source reordering retain the active recording. Pending seeks stop old decoder positions from overwriting the playhead; a seek stalled for five seconds triggers a bounded reload with the requested position restored. The error card offers Retry if recovery fails.
- Edit Clip has Play/Pause, a preview scrubber and Set start/end here controls. Apply saves changes; Cancel discards them.
- The horizontal recorder dock includes its language control inside the border.
- The transport displays elapsed/total kept footage, subtracting trim exclusions once, including while a trim handle is being dragged. The timeline ruler keeps the original footage positions so cuts remain editable.
- Images can move beyond any canvas edge. Selection handles can extend outside the preview; exported pixels stay within the output frame.
- Put the playhead inside a recording, right-click its clip and choose Split at playhead, or press Ctrl+B (changeable in Shortcuts). Select either half and open Layout in the inspector to choose its camera layout. Both sections keep the same source footage and their own saved preset.
- Windows includes a separate CPU speech runtime and automatically retries it if the GPU helper cannot start. CPU startup gets more time to load the model.

## Speech transcription

Whisper is speech-to-text: it turns recorded speech into a transcript; it does not generate a voice. Open a recording in the editor and use the Transcript pane's transcription action. The first run downloads the selected local speech model; later runs reuse it. After transcription, use the transcript editing/caption controls. CPU fallback can take longer than GPU transcription.

## Validation scope

Local tests, app/test type checks, translation checks and the renderer build are automated. Windows CI builds capture, compositor, both speech variants and the installer; it also checks packaged runtime dependencies, CPU helper loading and recorder containment. Real recording, playback listening, model inference, GPU preview/export and desktop interaction need a Windows test pass. This is a test installer, not a stable release.
