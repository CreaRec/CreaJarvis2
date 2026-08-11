#pragma once

#include "esphome/core/component.h"
#include "esphome/core/automation.h"
#include "esphome/core/helpers.h"
#include "esphome/components/microphone/microphone.h"
#include "esphome/components/speaker/speaker.h"

#include "fsm.h"
#include "goodbye.h"
#include "base64.h"

#include <esp_websocket_client.h>

#include <deque>
#include <string>
#include <vector>

namespace esphome {
namespace jarvis_gateway {

/** LED phase ids matching Voice PE substitutions (idle/listen/think/reply/error). */
enum class LedPhase : int {
  IDLE = 1,
  WAITING = 2,
  LISTENING = 3,
  THINKING = 4,
  REPLYING = 5,
  NOT_READY = 10,
  ERROR = 11,
  NOTIFY = 12,
};

class JarvisGateway : public Component {
 public:
  void set_url(const std::string &url) { url_ = url; }
  void set_token(const std::string &token) { token_ = token; }
  void set_device_id(const std::string &id) { device_id_ = id; }
  void set_display_name(const std::string &n) { display_name_ = n; }
  void set_room(const std::string &r) { room_ = r; }
  void set_kind(const std::string &k) { kind_ = k; }
  void set_microphone(microphone::Microphone *mic) { microphone_ = mic; }
  void set_speaker(speaker::Speaker *spk) { speaker_ = spk; }

  void setup() override;
  void loop() override;
  void dump_config() override;
  float get_setup_priority() const override { return setup_priority::AFTER_WIFI; }

  /** Public action: wake / center button / microWakeWord. */
  void wake();

  /** True after hello.ok — Core Voice Gateway session ready. */
  bool is_ready() const { return hello_ok_; }

  /** LED phase id for Voice PE control_leds (lambda). */
  int voice_phase() const { return static_cast<int>(phase_); }

 protected:
  friend void websocket_event_handler(void *handler_args, esp_event_base_t base,
                                      int32_t event_id, void *event_data);

  void connect_ws_();
  void disconnect_ws_();
  void schedule_reconnect_();
  void send_text_(const std::string &json);
  void send_hello_();
  void handle_message_(const char *msg, size_t len);
  void on_ws_connected_();
  void on_ws_disconnected_();
  void on_ws_data_(const esp_websocket_event_data_t *data);
  bool ensure_rx_buf_(size_t need_cap);
  void free_rx_buf_();

  void start_mic_();
  void stop_mic_();
  void on_mic_data_(const std::vector<uint8_t> &data);
  void play_pcm_(const uint8_t *data, size_t len);
  void finish_playback_drain_(float now_s);
  void set_phase_(LedPhase p);

  // FSM callbacks
  static void cb_start_session_(void *user);
  static void cb_end_session_(void *user);
  static void cb_ack_play_(void *user);
  static void cb_commit_(void *user);
  static void cb_mic_gate_(bool stream, void *user);
  static void cb_state_(crea_jarvis::logic::State old_s, crea_jarvis::logic::State new_s,
                        void *user);

  std::string url_;
  std::string token_;
  std::string device_id_;
  std::string display_name_{"Voice PE"};
  std::string room_{"kitchen_living"};
  std::string kind_{"esp"};

  microphone::Microphone *microphone_{nullptr};
  speaker::Speaker *speaker_{nullptr};

  esp_websocket_client_handle_t client_{nullptr};
  bool ws_connected_{false};
  bool hello_ok_{false};
  bool mic_streaming_{false};
  bool pending_goodbye_{false};
  bool notify_pulse_{false};
  bool ack_heard_audio_{false};
  uint32_t ack_audio_deadline_ms_{0};
  uint32_t notify_until_ms_{0};

  uint32_t reconnect_delay_ms_{1000};
  uint32_t next_reconnect_ms_{0};
  uint32_t last_idle_poll_ms_{0};

  crea_jarvis::logic::VoiceFsm fsm_{};
  LedPhase phase_{LedPhase::NOT_READY};

  std::deque<std::vector<uint8_t>> play_queue_;
  size_t play_offset_{0};
  bool playing_{false};
  bool response_done_pending_{false};
  uint32_t last_play_ms_{0};
  /** Estimated millis() when speaker buffer finishes currently written PCM. */
  uint32_t audio_end_ms_{0};

  // PSRAM (preferred) receive reassembly — never grow via throwing std::string::append
  char *rx_buf_{nullptr};
  size_t rx_cap_{0};
  size_t rx_len_{0};
  bool rx_drop_{false};
};

template <typename... Ts>
class WakeAction : public Action<Ts...> {
 public:
  explicit WakeAction(JarvisGateway *parent) : parent_(parent) {}
  void play(const Ts &...x) override { this->parent_->wake(); }

 protected:
  JarvisGateway *parent_;
};

}  // namespace jarvis_gateway
}  // namespace esphome
