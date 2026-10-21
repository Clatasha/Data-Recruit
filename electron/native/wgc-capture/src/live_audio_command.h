#pragma once
#include <cmath>
#include <sstream>
#include <string>

// Reject malformed, non-finite and out-of-range commands before touching the mixer.
inline bool parseLiveAudioCommand(const std::string& line, double& microphone, double& system) {
    std::istringstream input(line);
    std::string command, extra;
    double mic = 0, sys = 0;
    if (!(input >> command >> mic >> sys) || command != "audio" || (input >> extra)) return false;
    if (!std::isfinite(mic) || !std::isfinite(sys) || mic < 0 || mic > 2 || sys < 0 || sys > 2) return false;
    microphone = mic;
    system = sys;
    return true;
}
