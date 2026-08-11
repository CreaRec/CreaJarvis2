#include "jarvis_gateway.h"
#include "mic_convert.h"
#include "playback_drain.h"
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
// ~20s PCM16 mono @ 24 kHz — long weather replies arrive faster than realtime play.
static constexpr size_t kPlayRingBytes = 960 * 1024;

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
  if (!ensure_play_ring_(kPlayRingBytes)) {
    ESP_LOGW(TAG, "play ring alloc failed — playback may drop under load");
  }
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
  ESP_LOGCONFIG(TAG, "  play_ring: %u bytes",
                static_cast<unsigned>(play_ring_.cap));
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
        ESP_LOGD(TAG, "audio.delta %u pcm bytes (ring %u/%u)",
                 static_cast<unsigned>(pcm.size()),
                 static_cast<unsigned>(play_ring_.size()),
                 static_cast<unsigned>(play_ring_.cap));
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
    // Never leave ACK/SPEAKING on response.done alone — chunked audio.delta
    // can still be in flight, and speaker/resampler still holds PCM.
    if (fsm_.state == crea_jarvis::logic::State::ACK && !ack_heard_audio_ &&
        !playing_ && play_ring_.empty()) {
      ESP_LOGW(TAG, "response.done before ack audio — waiting for deltas");
      ack_audio_deadline_ms_ = millis() + 4000;
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
  const bool cancel =
      fsm_.state != crea_jarvis::logic::State::IDLE;
  ESP_LOGI(TAG, cancel ? "wake → cancel session" : "wake");
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
  self->play_ring_.clear();
  self->playing_ = false;
  self->ack_heard_audio_ = false;
  self->ack_audio_deadline_ms_ = 0;
  self->response_done_pending_ = false;
  self->audio_end_ms_ = 0;
  self->pending_goodbye_ = false;
  if (self->speaker_ && self->speaker_->is_running())
    self->speaker_->stop();
  self->set_phase_(LedPhase::IDLE);
  ESP_LOGI(TAG, "session.end");
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
  if (data.size() < 8)
    return;
  if (!fsm_.mic_allowed())
    return;

  // Voice PE i2s_mics: 32-bit stereo @ 16 kHz → PCM16 mono @ 24 kHz for VAD + Core.
  std::vector<int16_t> pcm;
  if (!crea_jarvis::logic::convert_voice_pe_mic_chunk(data.data(), data.size(),
                                                     &pcm)) {
    ESP_LOGD(TAG, "mic chunk skip len=%u", static_cast<unsigned>(data.size()));
    return;
  }

  float rms = crea_jarvis::logic::rms_int16(pcm.data(), pcm.size());
  float duration_ms =
      (static_cast<float>(pcm.size()) /
       static_cast<float>(crea_jarvis::logic::kGatewayPcmRate)) *
      1000.0f;
  float now = millis() / 1000.0f;
  fsm_.on_capture_chunk(rms, duration_ms, now);

  if (mic_streaming_ && fsm_.stream_to_gateway() && hello_ok_) {
    const auto *bytes = reinterpret_cast<const uint8_t *>(pcm.data());
    const size_t nbytes = pcm.size() * sizeof(int16_t);
    std::string b64 = crea_jarvis::logic::base64_encode(bytes, nbytes);
    std::string json = "{\"type\":\"audio.append\",\"audio\":\"" + b64 + "\"}";
    send_text_(json);
  }
}

bool JarvisGateway::ensure_play_ring_(size_t cap) {
  if (play_ring_.buf && play_ring_.cap >= cap)
    return true;
  free_play_ring_();
  uint8_t *buf = static_cast<uint8_t *>(
      heap_caps_malloc(cap, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
  if (!buf) {
    buf = static_cast<uint8_t *>(
        heap_caps_malloc(cap, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT));
  }
  if (!buf)
    return false;
  play_ring_.buf = buf;
  play_ring_.cap = cap;
  play_ring_.clear();
  return true;
}

void JarvisGateway::free_play_ring_() {
  if (play_ring_.buf) {
    heap_caps_free(play_ring_.buf);
    play_ring_.buf = nullptr;
  }
  play_ring_.cap = 0;
  play_ring_.clear();
}

void JarvisGateway::play_pcm_(const uint8_t *data, size_t len) {
  if (!speaker_ || len == 0)
    return;
  if (!ensure_play_ring_(kPlayRingBytes)) {
    ESP_LOGW(TAG, "play_pcm no ring — drop %u bytes", static_cast<unsigned>(len));
    return;
  }
  const size_t wrote = play_ring_.write(data, len);
  if (wrote < len) {
    ESP_LOGW(TAG, "play ring full — dropped %u of %u bytes (ring %u/%u)",
             static_cast<unsigned>(len - wrote), static_cast<unsigned>(len),
             static_cast<unsigned>(play_ring_.size()),
             static_cast<unsigned>(play_ring_.cap));
  }
}

void JarvisGateway::finish_playback_drain_(float now_s) {
  playing_ = false;
  audio_end_ms_ = 0;
  play_ring_.clear();
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
        play_ring_.empty() && !ack_heard_audio_) {
      ESP_LOGW(TAG, "ack audio timeout — entering listening");
      response_done_pending_ = false;
      fsm_.on_ack_finished(now_s);
    }
  }

  // Drain play ring into speaker (feed until speaker buffer is full).
  if (speaker_ && !play_ring_.empty()) {
    if (!playing_) {
      playing_ = true;
      // Set format once per utterance — resetting every chunk glitches the resampler.
      speaker_->set_audio_stream_info(audio::AudioStreamInfo(16, 1, TARGET_RATE));
      if (!speaker_->is_running())
        speaker_->start();
    }
    for (int spins = 0; spins < 16 && !play_ring_.empty(); spins++) {
      size_t cont = 0;
      const uint8_t *ptr = play_ring_.peek_contiguous(&cont);
      if (!ptr || cont == 0)
        break;
      size_t written = speaker_->play(ptr, cont);
      if (written == 0)
        break;
      play_ring_.consume(written);
      const uint32_t dur_ms =
          crea_jarvis::logic::pcm16_mono_duration_ms(written, TARGET_RATE);
      if (audio_end_ms_ < now_ms)
        audio_end_ms_ = now_ms;
      audio_end_ms_ += dur_ms;
      last_play_ms_ = now_ms;
    }
  } else if (playing_ && play_ring_.empty()) {
    // Do not end on inter-chunk gaps — wait until Core sent response.done and
    // the estimated speaker buffer has drained.
    if (crea_jarvis::logic::playback_drain_ready(
            response_done_pending_, now_ms, last_play_ms_, audio_end_ms_)) {
      finish_playback_drain_(now_s);
    } else if (!response_done_pending_ &&
               now_ms >=
                   last_play_ms_ + crea_jarvis::logic::kDefaultInterChunkGapMs) {
      ESP_LOGD(TAG, "playback gap waiting for more audio / response.done");
    }
  }
}

}  // namespace jarvis_gateway
}  // namespace esphome
