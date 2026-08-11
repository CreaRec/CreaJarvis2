#pragma once
/** Playback drain timing for chunked audio.delta streams. */
#include <algorithm>
#include <cstdint>

namespace crea_jarvis {
namespace logic {

inline constexpr uint32_t kDefaultSpeakerDrainGraceMs = 80;
inline constexpr uint32_t kDefaultInterChunkGapMs = 2500;

/**
 * True when queue is empty, response.done seen, and speaker buffer estimate
 * has elapsed — safe to leave ACK/SPEAKING.
 */
inline bool playback_drain_ready(bool response_done_pending, uint32_t now_ms,
                                 uint32_t last_play_ms, uint32_t audio_end_ms,
                                 uint32_t drain_grace_ms = kDefaultSpeakerDrainGraceMs) {
  if (!response_done_pending)
    return false;
  const uint32_t ready_at =
      std::max(last_play_ms + drain_grace_ms, audio_end_ms + drain_grace_ms);
  return now_ms >= ready_at;
}

/** PCM16 mono duration in ms for `bytes` at `rate_hz`. */
inline uint32_t pcm16_mono_duration_ms(size_t bytes, int rate_hz) {
  if (rate_hz <= 0 || bytes == 0)
    return 0;
  return static_cast<uint32_t>((bytes * 1000u) /
                               static_cast<uint32_t>(rate_hz * 2));
}

}  // namespace logic
}  // namespace crea_jarvis
