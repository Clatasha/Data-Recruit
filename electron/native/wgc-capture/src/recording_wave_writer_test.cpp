#include "recording_wave_writer.h"
#include <array>
#include <iostream>
#include <vector>
int main() {
    const auto path = std::filesystem::temp_directory_path() / "reaction-station-wave-test.wav";
    RecordingWaveWriter writer;
    if (!writer.open(path, 48000, 2)) return 1;
    const std::array<int16_t, 8> samples{1000, -1000, 0, 0, 2000, -2000, 0, 0};
    if (!writer.write(samples.data(), sizeof(samples)) || !writer.finalize()) return 2;
    std::ifstream file(path, std::ios::binary);
    const std::vector<unsigned char> data((std::istreambuf_iterator<char>(file)), {});
    if (data.size() != 96 || data[4] != 88 || data[76] != 16 || data[80] != 0xe8 || data[81] != 3) return 3;
    file.close(); std::filesystem::remove(path);
    std::cout << "Separate recording WAV passed" << std::endl;
}
