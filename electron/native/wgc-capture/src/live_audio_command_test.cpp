#include "live_audio_command.h"
#include <iostream>
int main() {
    double mic = 1, system = 1;
    if (!parseLiveAudioCommand("audio 0 0.5", mic, system) || mic != 0 || system != 0.5) return 1;
    if (!parseLiveAudioCommand("audio 1.4 1\r", mic, system) || mic != 1.4 || system != 1) return 2;
    for (const auto* command : {"audio nan 1", "audio inf 1", "audio -1 1", "audio 1 2.1", "audio 1", "audio 1 1 extra", "pause", "audio 1 1\nstop"}) {
        mic = 0.7; system = 0.8;
        if (parseLiveAudioCommand(command, mic, system) || mic != 0.7 || system != 0.8) return 3;
    }
    std::cout << "Live audio commands passed" << std::endl;
}
