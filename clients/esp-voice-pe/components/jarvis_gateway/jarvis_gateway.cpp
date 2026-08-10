#include "jarvis_gateway.h"
#include "esphome/core/log.h"
#include "esphome/core/application.h"
#include "esphome/components/audio/audio.h"

#include <esp_heap_caps.h>

#include <algorithm>
#include <cstdio>
#include <cstring>

namespace esphome {
namespace jarvis_gateway {

static const char *const TAG = "jarvis_gateway";
static constexpr int TARGET_RATE = 24000;
// Reassemble in PSRAM; leave 1 byte for NUL. Internal fallback is smaller.
static constexpr size_t kMaxRxPsram = 256 * 1024;
static constexpr size_t kMaxRxInternal = 48 * 1024;
static constexpr size_t kMaxPlayQueue = 6;

void websocket_event_handler(void *handler_args, esp_event_base_t base, int32_t event_id,
                             void *event_data) {
  auto *self = static_cast<JarvisGateway *>(handler_args);
  auto *data = static_cast<esp_websocket_event_data_t *>(event_data);
  switch (event_id) {
    case WEBSOCKET_EVENT_CONNECTED:
      self->on_ws_connected_();
      break;
    case WEBSOCKET_EVENT_DISCONNECTED:
    case WEBSOCKET_EVENT_ERROR:
      self->on_ws_disconnected_();
      break;
    case WEBSOCKET_EVENT_DATA:
      if (data->data_ptr && data->data_len > 0) {
        self->on_ws_data_(data);
      }
      break;
    default:
      break;
  }
}

void JarvisGateway::setup() {
  fsm_.cb.user = this;
  fsm_.cb.on_start_session = &JarvisGateway::cb_start_session_;
  fsm_.cb.on_end_session = &JarvisGateway::cb_end_session_;
  fsm_.cb.on_ack_play = &JarvisGateway::cb_ack_play_;
  fsm_.cb.on_commit = &JarvisGateway::cb_commit_;
  fsm_.cb.on_mic_gate = &JarvisGateway::cb_mic_gate_;
  fsm_.cb.on_state = &JarvisGateway::cb_state_;

  if (microphone_ != nullptr) {
    microphone_->add_data_callback([this](const std::vector<uint8_t> &data) {
      this->on_mic_data_(data);
    });
  }

  set_phase_(LedPhase::NOT_READY);
  // Delay past wifi/api/sendspin socket setup so LWIP acceptors can bind.
  this->set_timeout(8000, [this]() { this->connect_ws_(); });
}

void JarvisGateway::dump_config() {
  ESP_LOGCONFIG(TAG, "Jarvis Gateway:");
  ESP_LOGCONFIG(TAG, "  URL: %s", url_.c_str());
  ESP_LOGCONFIG(TAG, "  device_id: %s", device_id_.c_str());
  ESP_LOGCONFIG(TAG, "  display_name: %s", display_name_.c_str());
  ESP_LOGCONFIG(TAG, "  room: %s", room_.c_str());
  ESP_LOGCONFIG(TAG, "  kind: %s", kind_.c_str());
  ESP_LOGCONFIG(TAG, "  mic: %s", microphone_ ? "yes" : "no");
  ESP_LOGCONFIG(TAG, "  speaker: %s", speaker_ ? "yes" : "no");
}

void JarvisGateway::connect_ws_() {
  if (client_ != nullptr) {
    disconnect_ws_();
  }
  if (url_.empty()) {
    ESP_LOGE(TAG, "url empty");
    return;
  }
  esp_websocket_client_config_t cfg = {};
  cfg.uri = url_.c_str();
  // Keep WS task buffer small (internal RAM). Large frames are reassembled in PSRAM.
  cfg.buffer_size = 4096;
  cfg.disable_auto_reconnect = true;  // we manage backoff
  client_ = esp_websocket_client_init(&cfg);
  if (!client_) {
    ESP_LOGE(TAG, "ws init failed");
    schedule_reconnect_();
    return;
  }
  esp_websocket_register_events(client_, WEBSOCKET_EVENT_ANY, websocket_event_handler,
                                this);
  esp_err_t err = esp_websocket_client_start(client_);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "ws start failed: %s", esp_err_to_name(err));
    disconnect_ws_();
    schedule_reconnect_();
  } else {
    ESP_LOGI(TAG, "connecting to %s", url_.c_str());
  }
}

void JarvisGateway::disconnect_ws_() {
  hello_ok_ = false;
  ws_connected_ = false;
  rx_drop_ = false;
  rx_len_ = 0;
  if (client_) {
    esp_websocket_client_stop(client_);
    esp_websocket_client_destroy(client_);
    client_ = nullptr;
  }
}

void JarvisGateway::schedule_reconnect_() {
  set_phase_(LedPhase::NOT_READY);
  next_reconnect_ms_ = millis() + reconnect_delay_ms_;
  reconnect_delay_ms_ = std::min<uint32_t>(reconnect_delay_ms_ * 2, 60000u);
  ESP_LOGW(TAG, "reconnect in %u ms", static_cast<unsigned>(reconnect_delay_ms_));
}

void JarvisGateway::on_ws_connected_() {
  ESP_LOGI(TAG, "websocket connected");
  ws_connected_ = true;
  reconnect_delay_ms_ = 1000;
  send_hello_();
}

void JarvisGateway::on_ws_disconnected_() {
  ESP_LOGW(TAG, "websocket disconnected");
  bool was_ok = hello_ok_;
  hello_ok_ = false;
  ws_connected_ = false;
  stop_mic_();
  if (was_ok || client_) {
    // destroy handle on next connect
  }
  if (fsm_.state != crea_jarvis::logic::State::IDLE) {
    fsm_.force_idle();
  }
  schedule_reconnect_();
}

void JarvisGateway::free_rx_buf_() {
  if (rx_buf_) {
    heap_caps_free(rx_buf_);
    rx_buf_ = nullptr;
  }
  rx_cap_ = 0;
  rx_len_ = 0;
}

bool JarvisGateway::ensure_rx_buf_(size_t need_cap) {
  if (need_cap < 64)
    need_cap = 64;
  // +1 for NUL terminator used by string helpers
  need_cap += 1;
  if (rx_buf_ && rx_cap_ >= need_cap)
    return true;
  free_rx_buf_();
  size_t cap = need_cap;
  if (cap > kMaxRxPsram)
    return false;
  char *p = static_cast<char *>(
      heap_caps_malloc(cap, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
  if (!p) {
    if (cap > kMaxRxInternal)
      cap = kMaxRxInternal;
    p = static_cast<char *>(malloc(cap));
  }
  if (!p) {
    ESP_LOGE(TAG, "rx buf alloc failed need=%u free=%u",
             static_cast<unsigned>(need_cap),
             static_cast<unsigned>(esp_get_free_heap_size()));
    return false;
  }
  rx_buf_ = p;
  rx_cap_ = cap;
  rx_len_ = 0;
  return true;
}

void JarvisGateway::on_ws_data_(const esp_websocket_event_data_t *data) {
  // Text (0x01), binary (0x02), or continuation (0x00). Close/ping/pong ignored.
  if (!(data->op_code == 0x01 || data->op_code == 0x02 || data->op_code == 0x00))
    return;

  const int total = data->payload_len > 0 ? data->payload_len : data->data_len;
  if (data->payload_offset == 0) {
    rx_len_ = 0;
    rx_drop_ = false;
    if (total <= 0 || static_cast<size_t>(total) + 1 > kMaxRxPsram) {
      ESP_LOGW(TAG, "drop oversized ws payload %d", total);
      rx_drop_ = true;
      return;
    }
    if (!ensure_rx_buf_(static_cast<size_t>(total))) {
      rx_drop_ = true;
      return;
    }
  }
  if (rx_drop_ || !rx_buf_)
    return;
  if (rx_len_ + static_cast<size_t>(data->data_len) + 1 > rx_cap_) {
    ESP_LOGW(TAG, "rx overflow — dropping message");
    rx_drop_ = true;
    rx_len_ = 0;
    return;
  }
  memcpy(rx_buf_ + rx_len_, data->data_ptr, data->data_len);
  rx_len_ += static_cast<size_t>(data->data_len);

  // esp_websocket_client posts oversized payloads across multiple DATA events.
  if (data->payload_len > 0 &&
      (data->payload_offset + data->data_len) < data->payload_len)
    return;

  rx_buf_[rx_len_] = '\0';
  handle_message_(rx_buf_, rx_len_);
  rx_len_ = 0;
}

void JarvisGateway::send_text_(const std::string &json) {
  if (!client_ || !ws_connected_)
    return;
  esp_websocket_client_send_text(client_, json.c_str(), json.size(), pdMS_TO_TICKS(2000));
}

void JarvisGateway::send_hello_() {
  // Minimal JSON — fields match voice-protocol.ts
  char buf[768];
  snprintf(buf, sizeof(buf),
           "{\"type\":\"hello\",\"token\":\"%s\",\"deviceId\":\"%s\","
           "\"displayName\":\"%s\",\"room\":\"%s\",\"kind\":\"%s\","
           "\"caps\":{\"voice\":true,\"notify\":true}}",
           token_.c_str(), device_id_.c_str(), display_name_.c_str(), room_.c_str(),
           kind_.c_str());
  send_text_(buf);
  ESP_LOGI(TAG, "sent hello");
}

static const char *find_bytes(const char *hay, size_t hay_len, const char *needle,
                              size_t nlen) {
  if (!hay || !needle || nlen == 0 || hay_len < nlen)
    return nullptr;
  for (size_t i = 0; i + nlen <= hay_len; i++) {
    if (memcmp(hay + i, needle, nlen) == 0)
      return hay + i;
  }
  return nullptr;
}

static bool json_type_is(const char *msg, size_t len, const char *type) {
  char needle[64];
  int n = snprintf(needle, sizeof(needle), "\"type\":\"%s\"", type);
  if (n <= 0)
    return false;
  return find_bytes(msg, len, needle, static_cast<size_t>(n)) != nullptr;
}

static bool json_string_field_view(const char *msg, size_t len, const char *key,
                                   const char **out, size_t *out_len) {
  char needle[64];
  int n = snprintf(needle, sizeof(needle), "\"%s\":\"", key);
  if (n <= 0)
    return false;
  const char *p = find_bytes(msg, len, needle, static_cast<size_t>(n));
  if (!p)
    return false;
  p += n;
  size_t rem = len - static_cast<size_t>(p - msg);
  const char *end = static_cast<const char *>(memchr(p, '"', rem));
  if (!end)
    return false;
  *out = p;
  *out_len = static_cast<size_t>(end - p);
  return true;
}

void JarvisGateway::handle_message_(const char *msg, size_t len) {
  float now = millis() / 1000.0f;

  if (json_type_is(msg, len, "hello.ok")) {
    hello_ok_ = true;
    set_phase_(LedPhase::IDLE);
    ESP_LOGI(TAG, "hello.ok");
    return;
  }
  if (json_type_is(msg, len, "error")) {
    ESP_LOGE(TAG, "error msg (%u bytes)", static_cast<unsigned>(len));
    set_phase_(LedPhase::ERROR);
    return;
  }
  if (json_type_is(msg, len, "ready")) {
    ack_heard_audio_ = false;
    fsm_.on_session_ready(now);
    ESP_LOGI(TAG, "session ready → ack.play");
    return;
  }
  if (json_type_is(msg, len, "session.busy")) {
    ESP_LOGW(TAG, "session.busy");
    set_phase_(LedPhase::ERROR);
    fsm_.force_idle();
    return;
  }
  if (json_type_is(msg, len, "audio.delta")) {
    const char *b64 = nullptr;
    size_t b64_len = 0;
    if (json_string_field_view(msg, len, "audio", &b64, &b64_len) && b64_len > 0) {
      std::vector<uint8_t> pcm;
      if (crea_jarvis::logic::base64_decode(b64, b64_len, pcm) && !pcm.empty()) {
        if (fsm_.state == crea_jarvis::logic::State::ACK) {
          ack_heard_audio_ = true;
          ack_audio_deadline_ms_ = 0;
        }
        fsm_.on_audio_delta(now);
        play_pcm_(pcm.data(), pcm.size());
        ESP_LOGD(TAG, "audio.delta %u pcm bytes (queue %u)",
                 static_cast<unsigned>(pcm.size()),
                 static_cast<unsigned>(play_queue_.size()));
      } else {
        ESP_LOGW(TAG, "audio.delta decode failed (b64 len %u)",
                 static_cast<unsigned>(b64_len));
      }
    } else {
      ESP_LOGW(TAG, "audio.delta missing audio field (msg %u bytes)",
               static_cast<unsigned>(len));
    }
    return;
  }
  if (json_type_is(msg, len, "response.done")) {
    response_done_pending_ = true;
    fsm_.on_response_done(now);
    // If nothing queued/playing, treat as drained — but do not skip ACK audio:
    // response.done can race ahead of fragmented audio.delta frames.
    if (!playing_ && play_queue_.empty()) {
      if (fsm_.state == crea_jarvis::logic::State::ACK) {
        if (!ack_heard_audio_) {
          ESP_LOGW(TAG, "response.done before ack audio — waiting for deltas");
          ack_audio_deadline_ms_ = millis() + 4000;
          return;
        }
        fsm_.on_ack_finished(now);
      } else {
        fsm_.on_playback_drained(now);
        if (pending_goodbye_) {
          pending_goodbye_ = false;
          fsm_.force_idle();
        }
      }
    }
    return;
  }
  if (json_type_is(msg, len, "transcript")) {
    const char *role_p = nullptr;
    size_t role_n = 0;
    const char *text_p = nullptr;
    size_t text_n = 0;
    json_string_field_view(msg, len, "role", &role_p, &role_n);
    json_string_field_view(msg, len, "text", &text_p, &text_n);
    if (role_p && role_n == 4 && memcmp(role_p, "user", 4) == 0 && text_p) {
      std::string text(text_p, text_n);
      if (crea_jarvis::logic::is_goodbye_utterance(text.c_str())) {
        ESP_LOGI(TAG, "goodbye detected");
        pending_goodbye_ = true;
        if (fsm_.state == crea_jarvis::logic::State::ARMED) {
          pending_goodbye_ = false;
          fsm_.force_idle();
        }
      }
    }
    return;
  }
  if (json_type_is(msg, len, "reminder.fired") ||
      json_type_is(msg, len, "reminder.missed_digest") ||
      json_type_is(msg, len, "plan.today_digest")) {
    // Notify without screen: LED pulse + short beep via speaker if idle
    ESP_LOGI(TAG, "notify event");
    notify_pulse_ = true;
    notify_until_ms_ = millis() + 2500;
    set_phase_(LedPhase::NOTIFY);
    if (speaker_ && fsm_.state == crea_jarvis::logic::State::IDLE) {
      // Short synthetic beep: 1kHz square-ish PCM ~100ms @ 24kHz
      std::vector<uint8_t> beep(24000 / 10 * 2);
      for (size_t i = 0; i < beep.size() / 2; i++) {
        int16_t s = ((i / 12) % 2) ? 4000 : -4000;
        beep[i * 2] = static_cast<uint8_t>(s & 0xff);
        beep[i * 2 + 1] = static_cast<uint8_t>((s >> 8) & 0xff);
      }
      play_pcm_(beep.data(), beep.size());
    }
    return;
  }
  if (json_type_is(msg, len, "session.ended")) {
    ESP_LOGI(TAG, "session.ended");
    return;
  }
}

void JarvisGateway::wake() {
  if (!hello_ok_) {
    ESP_LOGW(TAG, "wake ignored — not hello.ok yet");
    set_phase_(LedPhase::ERROR);
    return;
  }
  ESP_LOGI(TAG, "wake");
  ack_heard_audio_ = false;
  float now = millis() / 1000.0f;
  fsm_.on_wake(now);
}

void JarvisGateway::cb_start_session_(void *user) {
  auto *self = static_cast<JarvisGateway *>(user);
  self->ack_heard_audio_ = false;
  self->send_text_("{\"type\":\"session.start\"}");
  self->set_phase_(LedPhase::WAITING);
  ESP_LOGI(TAG, "session.start");
}

void JarvisGateway::cb_end_session_(void *user) {
  auto *self = static_cast<JarvisGateway *>(user);
  self->send_text_("{\"type\":\"session.end\"}");
  self->stop_mic_();
  self->set_phase_(LedPhase::IDLE);
}

void JarvisGateway::cb_ack_play_(void *user) {
  auto *self = static_cast<JarvisGateway *>(user);
  self->send_text_("{\"type\":\"ack.play\"}");
  self->set_phase_(LedPhase::REPLYING);
  ESP_LOGI(TAG, "ack.play sent");
}

void JarvisGateway::cb_commit_(void *user) {
  auto *self = static_cast<JarvisGateway *>(user);
  self->send_text_("{\"type\":\"audio.commit\"}");
  self->set_phase_(LedPhase::THINKING);
}

void JarvisGateway::cb_mic_gate_(bool stream, void *user) {
  auto *self = static_cast<JarvisGateway *>(user);
  self->mic_streaming_ = stream;
  if (stream)
    self->start_mic_();
  else if (self->fsm_.state != crea_jarvis::logic::State::LISTENING &&
           self->fsm_.state != crea_jarvis::logic::State::ARMED)
    self->stop_mic_();
  else if (self->fsm_.mic_allowed())
    self->start_mic_();
}

void JarvisGateway::cb_state_(crea_jarvis::logic::State old_s, crea_jarvis::logic::State new_s,
                              void *user) {
  auto *self = static_cast<JarvisGateway *>(user);
  ESP_LOGD(TAG, "fsm %d -> %d", static_cast<int>(old_s), static_cast<int>(new_s));
  using S = crea_jarvis::logic::State;
  switch (new_s) {
    case S::IDLE:
      self->set_phase_(LedPhase::IDLE);
      break;
    case S::CONNECTING:
      self->set_phase_(LedPhase::WAITING);
      break;
    case S::ACK:
      self->set_phase_(LedPhase::REPLYING);
      break;
    case S::LISTENING:
      self->set_phase_(LedPhase::LISTENING);
      break;
    case S::PROCESSING:
      self->set_phase_(LedPhase::THINKING);
      break;
    case S::SPEAKING:
      self->set_phase_(LedPhase::REPLYING);
      break;
    case S::ARMED:
      self->set_phase_(LedPhase::IDLE);
      break;
  }
}

void JarvisGateway::start_mic_() {
  if (!microphone_)
    return;
  if (!microphone_->is_running()) {
    microphone_->start();
  }
}

void JarvisGateway::stop_mic_() {
  mic_streaming_ = false;
  if (microphone_ && microphone_->is_running() &&
      fsm_.state == crea_jarvis::logic::State::IDLE) {
    microphone_->stop();
  }
}

void JarvisGateway::on_mic_data_(const std::vector<uint8_t> &data) {
  if (data.size() < 2)
    return;
  if (!fsm_.mic_allowed())
    return;

  const auto *samples = reinterpret_cast<const int16_t *>(data.data());
  size_t n = data.size() / 2;
  float rms = crea_jarvis::logic::rms_int16(samples, n);
  float duration_ms = (static_cast<float>(n) / static_cast<float>(TARGET_RATE)) * 1000.0f;
  float now = millis() / 1000.0f;
  fsm_.on_capture_chunk(rms, duration_ms, now);

  if (mic_streaming_ && fsm_.stream_to_gateway() && hello_ok_) {
    std::string b64 = crea_jarvis::logic::base64_encode(data.data(), data.size());
    std::string json = "{\"type\":\"audio.append\",\"audio\":\"" + b64 + "\"}";
    send_text_(json);
  }
}

void JarvisGateway::play_pcm_(const uint8_t *data, size_t len) {
  if (!speaker_ || len == 0)
    return;
  // Core sends PCM16 mono @ 24 kHz; Voice PE hardware path is 48 kHz via resampler.
  speaker_->set_audio_stream_info(audio::AudioStreamInfo(16, 1, TARGET_RATE));
  while (play_queue_.size() >= kMaxPlayQueue) {
    play_queue_.pop_front();
    play_offset_ = 0;
  }
  play_queue_.emplace_back(data, data + len);
}

void JarvisGateway::set_phase_(LedPhase p) {
  phase_ = p;
  // Voice PE YAML binds voice_assistant_phase global; expose via optional global write
  // Users map control_leds to jarvis phase in overlay YAML.
}

void JarvisGateway::loop() {
  uint32_t now_ms = millis();
  float now_s = now_ms / 1000.0f;

  if (!ws_connected_ && next_reconnect_ms_ != 0 && now_ms >= next_reconnect_ms_) {
    next_reconnect_ms_ = 0;
    connect_ws_();
  }

  if (now_ms - last_idle_poll_ms_ > 1000) {
    last_idle_poll_ms_ = now_ms;
    fsm_.poll_idle(now_s);
  }

  if (notify_pulse_ && now_ms > notify_until_ms_) {
    notify_pulse_ = false;
    if (fsm_.state == crea_jarvis::logic::State::IDLE)
      set_phase_(LedPhase::IDLE);
  }

  if (ack_audio_deadline_ms_ != 0 && now_ms >= ack_audio_deadline_ms_) {
    ack_audio_deadline_ms_ = 0;
    if (fsm_.state == crea_jarvis::logic::State::ACK && !playing_ &&
        play_queue_.empty()) {
      ESP_LOGW(TAG, "ack audio timeout — entering listening");
      fsm_.on_ack_finished(now_s);
    }
  }

  // Drain playback queue into speaker
  if (speaker_ && !play_queue_.empty()) {
    if (!playing_) {
      playing_ = true;
      play_offset_ = 0;
      if (!speaker_->is_running())
        speaker_->start();
    }
    auto &chunk = play_queue_.front();
    size_t remain = chunk.size() - play_offset_;
    size_t written = speaker_->play(chunk.data() + play_offset_, remain);
    play_offset_ += written;
    if (play_offset_ >= chunk.size()) {
      play_queue_.pop_front();
      play_offset_ = 0;
    }
    last_play_ms_ = now_ms;
  } else if (playing_ && play_queue_.empty()) {
    // Assume drain complete ~150ms after last write when queue empty
    if (now_ms - last_play_ms_ > 150) {
      playing_ = false;
      if (speaker_ && speaker_->is_running())
        speaker_->finish();
      if (fsm_.state == crea_jarvis::logic::State::ACK) {
        fsm_.on_ack_finished(now_s);
      } else {
        fsm_.on_playback_drained(now_s);
        if (pending_goodbye_) {
          pending_goodbye_ = false;
          fsm_.force_idle();
        }
      }
      response_done_pending_ = false;
    }
  }
}

}  // namespace jarvis_gateway
}  // namespace esphome
