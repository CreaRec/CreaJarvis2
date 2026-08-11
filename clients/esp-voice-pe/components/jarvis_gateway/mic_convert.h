#pragma once
/**
 * Voice PE mic: i2s_mics is 32-bit stereo @ 16 kHz.
 * Gateway / OpenAI Realtime expect PCM16 mono @ 24 kHz.
 */
#include <cstddef>
#include <cstdint>
#include <vector>

namespace crea_jarvis {
namespace logic {

inline constexpr int kMicNativeRate = 16000;
inline constexpr int kGatewayPcmRate = 24000;

/** Average L/R int32 frames → int16 mono (>>16, I2S left-justified). */
inline void pcm32_stereo_to_pcm16_mono(const int32_t *frames, size_t n_frames,
                                       std::vector<int16_t> *out) {
  out->clear();
  out->reserve(n_frames);
  for (size_t i = 0; i < n_frames; i++) {
    const int32_t l = frames[i * 2] >> 16;
    const int32_t r = frames[i * 2 + 1] >> 16;
    int32_t m = (l + r) / 2;
    if (m > 32767)
      m = 32767;
    if (m < -32768)
      m = -32768;
    out->push_back(static_cast<int16_t>(m));
  }
}

/** Linear resample int16 mono from → to rate. */
inline void resample_pcm16_mono(const int16_t *in, size_t n_in, int from_rate,
                                int to_rate, std::vector<int16_t> *out) {
  out->clear();
  if (n_in == 0 || from_rate <= 0 || to_rate <= 0)
    return;
  if (from_rate == to_rate) {
    out->assign(in, in + n_in);
    return;
  }
  const size_t n_out =
      static_cast<size_t>((static_cast<uint64_t>(n_in) * to_rate) / from_rate);
  out->resize(n_out);
  for (size_t i = 0; i < n_out; i++) {
    const double src = static_cast<double>(i) * from_rate / to_rate;
    const size_t i0 = static_cast<size_t>(src);
    const size_t i1 = i0 + 1 < n_in ? i0 + 1 : i0;
    const double frac = src - static_cast<double>(i0);
    const double s =
        static_cast<double>(in[i0]) * (1.0 - frac) +
        static_cast<double>(in[i1]) * frac;
    int32_t v = static_cast<int32_t>(s);
    if (v > 32767)
      v = 32767;
    if (v < -32768)
      v = -32768;
    (*out)[i] = static_cast<int16_t>(v);
  }
}

/**
 * Convert one Voice PE mic callback buffer to gateway PCM16 mono @ 24 kHz.
 * Returns false if buffer length is not a valid stereo int32 frame count.
 */
inline bool convert_voice_pe_mic_chunk(const uint8_t *data, size_t len,
                                       std::vector<int16_t> *pcm24k) {
  pcm24k->clear();
  if (len < 8 || (len % 8) != 0)
    return false;
  const size_t n_frames = len / 8;
  const auto *frames = reinterpret_cast<const int32_t *>(data);
  std::vector<int16_t> mono16k;
  pcm32_stereo_to_pcm16_mono(frames, n_frames, &mono16k);
  resample_pcm16_mono(mono16k.data(), mono16k.size(), kMicNativeRate,
                      kGatewayPcmRate, pcm24k);
  return !pcm24k->empty();
}

}  // namespace logic
}  // namespace crea_jarvis
