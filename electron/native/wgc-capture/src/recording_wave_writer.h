#pragma once

#include <cstdint>
#include <filesystem>
#include <fstream>
#include <limits>

// Lossless PCM16 tracks. A reserved JUNK block allows RF64 conversion for long
// takes without moving the samples. Each append updates the header so a killed
// helper leaves recoverable audio, rather than a zero-length WAV.
class RecordingWaveWriter {
public:
    bool open(const std::filesystem::path& path, uint32_t rate, uint16_t channels) {
        rate_ = rate;
        channels_ = channels;
        file_.open(path, std::ios::binary | std::ios::in | std::ios::out | std::ios::trunc);
        if (!file_ || !rate || !channels) return false;
        file_.write("RIFF", 4); put32(72); file_.write("WAVEJUNK", 8); put32(28);
        for (int i = 0; i < 28; ++i) file_.put(0);
        file_.write("fmt ", 4); put32(16); put16(1); put16(channels);
        put32(rate); put32(rate * channels * 2); put16(channels * 2); put16(16);
        file_.write("data", 4); put32(0);
        file_.flush();
        return static_cast<bool>(file_);
    }
    bool write(const void* data, uint32_t size) {
        if (!file_.is_open() || !data || size % (channels_ * 2) != 0) return false;
        file_.seekp(0, std::ios::end);
        file_.write(static_cast<const char*>(data), size);
        bytes_ += size;
        // Update once a second, keeping the capture disk cost bounded.
        if (bytes_ - checkpoint_ >= static_cast<uint64_t>(rate_) * channels_ * 2) {
            checkpoint_ = bytes_;
            return updateHeader();
        }
        return static_cast<bool>(file_);
    }
    bool finalize() {
        if (!file_.is_open()) return true;
        const bool ok = updateHeader();
        file_.close();
        return ok;
    }
    ~RecordingWaveWriter() { finalize(); }
private:
    void put16(uint16_t value) { for (int i = 0; i < 2; ++i) file_.put(static_cast<char>(value >> (8 * i))); }
    void put32(uint32_t value) { for (int i = 0; i < 4; ++i) file_.put(static_cast<char>(value >> (8 * i))); }
    void put64(uint64_t value) { for (int i = 0; i < 8; ++i) file_.put(static_cast<char>(value >> (8 * i))); }
    bool updateHeader() {
        constexpr uint32_t limit = std::numeric_limits<uint32_t>::max();
        const bool rf64 = bytes_ > limit - 72;
        file_.seekp(0); file_.write(rf64 ? "RF64" : "RIFF", 4);
        put32(rf64 ? limit : static_cast<uint32_t>(bytes_ + 72));
        if (rf64) {
            file_.seekp(12); file_.write("ds64", 4); put32(28);
            put64(bytes_ + 72); put64(bytes_); put64(bytes_ / (channels_ * 2)); put32(0);
        }
        file_.seekp(76); put32(rf64 ? limit : static_cast<uint32_t>(bytes_));
        file_.flush();
        return static_cast<bool>(file_);
    }
    std::fstream file_;
    uint32_t rate_ = 0;
    uint16_t channels_ = 0;
    uint64_t bytes_ = 0;
    uint64_t checkpoint_ = 0;
};
