#pragma once
/**
 * Voice session FSM — mirrors clients/desktop/jarvis_client/fsm.py
 * Header-only for host unit tests and ESP firmware.
 */
#include <cmath>
#include <cstddef>
#include <cstdint>

namespace crea_jarvis {
namespace logic {

enum class State : uint8_t {
  IDLE = 0,
  CONNECTING,
  ACK,
  LISTENING,
  PROCESSING,
  SPEAKING,
  ARMED,
};

struct FsmConfig {
  float idle_timeout_s = 5.0f * 60.0f;
  float silence_eos_ms = 700.0f;
  float min_utterance_ms = 250.0f;
  float speech_rms_threshold = 500.0f;
};

struct FsmCallbacks {
  void (*on_state)(State old_s, State new_s, void *user) = nullptr;
  void (*on_start_session)(void *user) = nullptr;
  void (*on_end_session)(void *user) = nullptr;
  void (*on_ack_play)(void *user) = nullptr;
  void (*on_commit)(void *user) = nullptr;
  void (*on_mic_gate)(bool stream_to_gateway, void *user) = nullptr;
  void *user = nullptr;
};

class VoiceFsm {
 public:
  FsmConfig config{};
  FsmCallbacks cb{};
  State state = State::IDLE;

  bool mic_allowed() const {
    return state == State::LISTENING || state == State::ARMED;
  }

  bool stream_to_gateway() const { return state == State::LISTENING; }

  void touch(float now_s) { last_active_s_ = now_s; }

  void on_wake(float now_s) {
    // Session already open (including ARMED) → cancel / session.end.
    if (state != State::IDLE) {
      go_idle_(true);
      return;
    }
    touch(now_s);
    set_state_(State::CONNECTING);
    if (cb.on_start_session)
      cb.on_start_session(cb.user);
  }

  void on_session_ready(float now_s) {
    if (state != State::CONNECTING)
      return;
    touch(now_s);
    set_state_(State::ACK);
    if (cb.on_mic_gate)
      cb.on_mic_gate(false, cb.user);
    if (cb.on_ack_play)
      cb.on_ack_play(cb.user);
  }

  void on_ack_finished(float now_s) {
    if (state != State::ACK)
      return;
    touch(now_s);
    begin_listening_();
  }

  void on_capture_chunk(float rms, float duration_ms, float now_s) {
    if (state == State::ARMED) {
      if (rms >= config.speech_rms_threshold) {
        touch(now_s);
        begin_listening_();
      } else {
        return;
      }
    }
    if (state != State::LISTENING)
      return;

    const bool speaking = rms >= config.speech_rms_threshold;
    if (speaking) {
      heard_speech_ = true;
      utterance_ms_ += duration_ms;
      silence_ms_ = 0.0f;
      touch(now_s);
    } else if (heard_speech_) {
      silence_ms_ += duration_ms;
      if (silence_ms_ >= config.silence_eos_ms &&
          utterance_ms_ >= config.min_utterance_ms) {
        set_state_(State::PROCESSING);
        if (cb.on_mic_gate)
          cb.on_mic_gate(false, cb.user);
        if (cb.on_commit)
          cb.on_commit(cb.user);
      }
    }
  }

  void on_audio_delta(float now_s) {
    if (state == State::PROCESSING || state == State::SPEAKING ||
        state == State::ACK) {
      if (state == State::PROCESSING)
        set_state_(State::SPEAKING);
      touch(now_s);
    }
  }

  void on_response_done(float now_s) {
    if (state == State::PROCESSING) {
      enter_armed_(now_s);
    }
  }

  void on_playback_drained(float now_s) {
    if (state == State::ACK)
      return;
    if (state == State::SPEAKING || state == State::PROCESSING)
      enter_armed_(now_s);
  }

  void force_idle() { go_idle_(true); }

  bool poll_idle(float now_s) {
    if (state == State::IDLE)
      return false;
    if (now_s - last_active_s_ >= config.idle_timeout_s) {
      go_idle_(true);
      return true;
    }
    return false;
  }

 private:
  float last_active_s_ = 0.0f;
  float utterance_ms_ = 0.0f;
  float silence_ms_ = 0.0f;
  bool heard_speech_ = false;

  void set_state_(State neu) {
    if (state == neu)
      return;
    State old = state;
    state = neu;
    if (cb.on_mic_gate)
      cb.on_mic_gate(stream_to_gateway(), cb.user);
    if (cb.on_state)
      cb.on_state(old, neu, cb.user);
  }

  void begin_listening_() {
    utterance_ms_ = 0.0f;
    silence_ms_ = 0.0f;
    heard_speech_ = false;
    set_state_(State::LISTENING);
  }

  void enter_armed_(float now_s) {
    touch(now_s);
    set_state_(State::ARMED);
    if (cb.on_mic_gate)
      cb.on_mic_gate(false, cb.user);
  }

  void go_idle_(bool end_session) {
    set_state_(State::IDLE);
    if (cb.on_mic_gate)
      cb.on_mic_gate(false, cb.user);
    if (end_session && cb.on_end_session)
      cb.on_end_session(cb.user);
  }
};

inline float rms_int16(const int16_t *samples, size_t count) {
  if (count == 0)
    return 0.0f;
  double sum = 0.0;
  for (size_t i = 0; i < count; i++) {
    const double v = static_cast<double>(samples[i]);
    sum += v * v;
  }
  return static_cast<float>(std::sqrt(sum / static_cast<double>(count)));
}

}  // namespace logic
}  // namespace crea_jarvis
